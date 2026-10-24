// Explicit, missing-image-only local fallback. Never starts services or mounts data.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const release = 'RELEASE.2025-01-20T14-49-07Z'
const revision = '827004cd6d3da8f49a5320c94ae74ae128156ed6'
const originalTag = `minio/minio:${release}`
const localTag = `wdx-minio-source:${release}`
const ciTag = `wdx-minio-source-ci:${release}`
const builder = 'golang:1.24.13-bookworm'
const root = path.resolve(__dirname, '..')

// The official release points to this revision. Go authenticates its module and
// dependencies through sum.golang.org; build-info must retain the pinned revision.
// Sources: https://github.com/minio/minio/releases/tag/RELEASE.2025-01-20T14-49-07Z
const dockerfile = `FROM ${builder} AS build
ENV CGO_ENABLED=0 GOBIN=/out GOTOOLCHAIN=local \\
    GOPROXY=https://proxy.golang.org,direct GOSUMDB=sum.golang.org \\
    GOPRIVATE= GONOSUMDB= GONOPROXY= GOINSECURE=
RUN go install -trimpath -ldflags="-s -w" github.com/minio/minio@${release} \\
 && go version -m /out/minio > /out/build-info.txt \\
 && grep -F '${revision.slice(0, 12)}' /out/build-info.txt \\
 && grep -F 'h1:' /out/build-info.txt \\
 && module_version=$(awk '$1=="mod" && $2=="github.com/minio/minio" { print $3 }' /out/build-info.txt) \\
 && test -n "$module_version" \\
 && cp "/go/pkg/mod/github.com/minio/minio@$module_version/LICENSE" /out/LICENSE \\
 && /out/minio --version \\
 && sha256sum /out/minio > /out/binary.sha256
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \\
 && rm -rf /var/lib/apt/lists/* && mkdir -p /data
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /out/build-info.txt /out/binary.sha256 /out/LICENSE /usr/share/doc/minio-source/
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \\
      org.opencontainers.image.revision="${revision}" \\
      org.opencontainers.image.version="${release}" \\
      org.opencontainers.image.title="Local source build; not the upstream production image"
WORKDIR /data
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
`

function options(args) {
  let build = false, plan = false, tag = localTag
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--build') build = true
    else if (args[index] === '--plan') plan = true
    else if (args[index] === '--tag' && args[index + 1]) tag = args[++index]
    else throw new Error('Use --plan, or --build [--tag <documented image tag>]')
  }
  if (build && plan) throw new Error('--plan and --build cannot be combined')
  if (![localTag, originalTag, ciTag].includes(tag)) throw new Error('Only the pinned original, local source or CI-only source tag is allowed')
  return { build, tag }
}

function localEndpoint(endpoint) {
  if (/^unix:\/\/\//.test(endpoint)) return true
  if (/^npipe:\/{4}\.\/pipe\/[a-z0-9_.-]+$/i.test(endpoint)) return true
  try { const url = new URL(endpoint); return url.protocol === 'tcp:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) } catch { return false }
}

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 15000, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error('Local Docker check failed; no existing image or service was changed')
  return result.stdout.trim()
}

function requireMissing(tag) {
  if (docker(['image', 'ls', '--quiet', '--filter', `reference=${tag}`])) throw new Error('Target image already exists; reuse it. This helper refuses to overwrite an existing tag detected at either check')
}

function buildMissing(tag) {
  // Reject remote contexts even when environment overrides are present.
  if (process.env.BUILDX_BUILDER || process.env.BUILDKIT_HOST) throw new Error('Clear external builder overrides; only the local Docker default builder is allowed')
  if (process.env.DOCKER_HOST && !localEndpoint(process.env.DOCKER_HOST)) throw new Error('Only a local Docker daemon is allowed')
  const endpoint = JSON.parse(docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']))
  if (!localEndpoint(endpoint) || docker(['info', '--format', '{{.OSType}}']) !== 'linux') throw new Error('Select a local Docker Linux context before building')
  requireMissing(tag)
  const runId = randomUUID(), logRoot = path.join(root, '.wx-local-runtime', 'minio-source-build')
  fs.mkdirSync(logRoot, { recursive: true })
  const lockFile = path.join(logRoot, 'active.lock'), logFile = path.join(logRoot, `${runId}.log`)
  let context, log, lock, lockIdentity, lockWritten = false, temporaryRoot
  try {
    lock = fs.openSync(lockFile, 'wx', 0o600)
    lockIdentity = fs.fstatSync(lock)
    fs.writeFileSync(lock, runId); lockWritten = true
    fs.closeSync(lock); lock = undefined
    temporaryRoot = fs.realpathSync(os.tmpdir())
    requireMissing(tag)
    context = fs.mkdtempSync(path.join(temporaryRoot, 'weiduoxian-minio-source-'))
    fs.writeFileSync(path.join(context, 'Dockerfile'), dockerfile, { flag: 'wx' })
    log = fs.openSync(logFile, 'wx', 0o600)
    const staging = `wdx-minio-source-build:${runId}`
    console.log(`Building official pinned source into a new local image. Private log: ${logFile}`)
    console.log('No services, ports or volumes are changed; existing target tags are checked before and after the build.')
    const built = spawnSync('docker', ['build', '--pull=false', '--tag', staging, context], {
      stdio: ['ignore', log, log], timeout: 1800000, windowsHide: true
    })
    if (built.error || built.status !== 0) throw new Error(`Source build failed; private log retained: ${logFile}`)
    // A long build must not overwrite a tag created by another process meanwhile.
    requireMissing(tag)
    docker(['image', 'tag', staging, tag])
    const imageId = docker(['image', 'inspect', '--format', '{{.Id}}', tag])
    console.log(JSON.stringify({ image: tag, imageId, staging, sourceRelease: release, sourceRevision: revision,
      builder, logFile, productionImageBytesEquivalent: false, servicesStarted: false, dataMigrated: false }, null, 2))
  } finally {
    try {
      if (log !== undefined) fs.closeSync(log)
      if (context) {
        const resolved = fs.realpathSync(context)
        if (resolved !== path.resolve(context) || path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('weiduoxian-minio-source-')) throw new Error('Temporary context changed; refusing recursive cleanup')
        fs.rmSync(resolved, { recursive: true, force: true })
      }
    } finally {
      try { if (lock !== undefined) fs.closeSync(lock) } finally {
        if (lockIdentity && fs.existsSync(lockFile)) {
          const current = fs.lstatSync(lockFile)
          const sameFile = !current.isSymbolicLink() && current.dev === lockIdentity.dev && current.ino === lockIdentity.ino
          // A failed initial write can leave a prefix (or empty file) that this run created.
          if (sameFile) {
            const marker = fs.readFileSync(lockFile, 'utf8')
            if (marker === runId || (!lockWritten && runId.startsWith(marker))) fs.unlinkSync(lockFile)
          }
        }
      }
    }
  }
}

function main(args = process.argv.slice(2)) {
  const value = options(args)
  if (!value.build) {
    console.log(JSON.stringify({ mode: 'plan-only', image: value.tag, sourceRelease: release, sourceRevision: revision, builder,
      checksumDatabase: 'sum.golang.org', existingTagPolicy: 'refuse', dockerContacted: false, servicesStarted: false,
      dataMigrated: false, productionImageBytesEquivalent: false,
      concurrencyBoundary: 'This helper lock plus two missing-tag checks; do not concurrently retag images from another Docker client',
      buildCommand: `node scripts/build-local-minio.cjs --build --tag ${value.tag}` }, null, 2))
    return
  }
  buildMissing(value.tag)
}
if (require.main === module) { try { main() } catch (error) { console.error(error.message); process.exitCode = 1 } }
module.exports = { release, revision, originalTag, localTag, ciTag, builder, dockerfile, options, localEndpoint, main }
