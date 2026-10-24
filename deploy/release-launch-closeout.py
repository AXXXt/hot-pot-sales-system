"""Reviewed root-only 20 -> 24 release or explicitly identified failed-release repair.

No public version-center dispatch may cross this boundary. No source freezing or
production execution is performed by preparing this file. Pass exact previously
verified backend/control image IDs; --preflight performs checks only.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import sys
import time
import uuid
from pathlib import Path

ROOT = Path('/opt/weiduoxian')
SOURCE, TARGET = 'ai-20261024-2', 'ai-20261024-4'
OLD_CONTROL, CONTROL = 'control-20261022-1', 'control-20261024-2'
FAILED_OPERATION = '50e73aac-36f5-440b-af4b-aa52c44f32df'
FAILED_TARGET = 'ai-20261024-3'
ADDITIONS = ['20261024040000_legal_consents', '20261024050000_lead_submission_link',
             '20261024060000_service_requests', '20261024070000_lead_submissions']
SNAPSHOT = r"""const{PrismaClient}=require('@prisma/client'),{createHash}=require('node:crypto');const p=new PrismaClient();const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'&&!v.toJSON?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');(async()=>{try{const models={};for(const name of ['user','staffCredential','brand','productCategory','product','productSku','customer','order','orderItem','stockAdjustment','stockMovement','stockBatch','stocktake','stocktakeItem','replenishmentPlan','aiConfig','role','userRole','rolePermission','systemConfig','customerPriceRule','customerVisibleProduct','lead','leadFollowUp']){const rows=await p[name].findMany();if(name==='lead')for(const r of rows)for(const k of ['customerId','submissionKey','submissionDigest'])delete r[k];models[name]={count:rows.length,hash:sha(rows.map(r=>JSON.stringify(canonical(r))).sort())}}const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(WX_|SMS_|TENCENT_SMS_|AI_|DATABASE_URL$|REDIS_URL$|JWT_|MINIO_)/.test(k)).sort(([a],[b])=>a.localeCompare(b)));console.log(JSON.stringify({models,environmentHash:sha(env)}));}finally{await p.$disconnect()}})().catch(()=>process.exitCode=1)"""
ACTOR = """const{PrismaClient}=require('@prisma/client');const{StaffAccessService}=require('./dist/src/auth/staff-access.service');const p=new PrismaClient();(async()=>{try{const users=await p.user.findMany({where:{tenantId:1,userType:'super_admin',status:'active'},select:{id:true}});if(users.length!==1)throw Error('Unique active administrator required');const a=await new StaffAccessService(p).actor(users[0].id);console.log(JSON.stringify({actorId:a.id,tenantId:a.tenantId,fingerprint:a.fingerprint}))}finally{await p.$disconnect()}})().catch(()=>process.exitCode=1)"""
ADDED_EMPTY = """const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{try{const counts={};for(const m of ['legalConsent','serviceRequest','leadSubmission'])counts[m]=await p[m].count();counts.changedHistoricalLead=await p.lead.count({where:{OR:[{customerId:{not:null}},{submissionKey:{not:null}},{submissionDigest:{not:null}}]}});if(Object.values(counts).some(x=>x!==0))throw Error('Unexpected additive data');console.log(JSON.stringify(counts))}finally{await p.$disconnect()}})().catch(()=>process.exitCode=1)"""
ADDED_SNAPSHOT = r"""const{PrismaClient}=require('@prisma/client'),{createHash}=require('node:crypto');const p=new PrismaClient();const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'&&!v.toJSON?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;const summary=rows=>({count:rows.length,hash:createHash('sha256').update(JSON.stringify(rows.map(r=>JSON.stringify(canonical(r))).sort())).digest('hex')});(async()=>{try{const models={};for(const name of ['legalConsent','serviceRequest','leadSubmission'])models[name]=summary(await p[name].findMany());models.leadNewFields=summary(await p.lead.findMany({select:{id:true,tenantId:true,customerId:true,submissionKey:true,submissionDigest:true}}));console.log(JSON.stringify(models))}finally{await p.$disconnect()}})().catch(()=>process.exitCode=1)"""


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def tree(directory):
    if directory.is_symlink():
        raise ValueError('Symlink site root rejected')
    result = {}
    for file in sorted(directory.rglob('*')):
        if file.is_symlink():
            raise ValueError('Symlink site member rejected')
        if file.is_file():
            result[file.relative_to(directory).as_posix()] = sha(file)
    return result


def validate_control_assets(directory, manifest_file, expected_hash):
    if manifest_file.is_symlink() or sha(manifest_file) != expected_hash:
        raise ValueError('Control manifest mismatch')
    manifest = json.loads(manifest_file.read_text())
    if manifest.get('release') != TARGET or not manifest.get('files'):
        raise ValueError('Control release mismatch')
    entries = {}
    for item in manifest['files']:
        name = item.get('path', '')
        relative = Path(name)
        if not name or relative.is_absolute() or '..' in relative.parts or '\\' in name or name in entries:
            raise ValueError('Control artifact path rejected')
        entries[name] = item.get('sha256')
    if 'platform.html' not in entries or entries != tree(directory):
        raise ValueError('Control artifact members or SHA mismatch')
    return manifest


def tag(text, key, value):
    updated, count = re.subn(r'^' + key + r'=.*$', key + '=' + value, text, flags=re.M)
    if count != 1:
        raise ValueError('Ambiguous release tag')
    return updated


def without_tags(text):
    return re.sub(r'^(?:RELEASE_TAG|PLATFORM_CONTROL_TAG)=.*\n?', '', text, flags=re.M)


def control_redis_compose(text):
    # Change only the platform block. Never replace the full live Compose with a local example.
    match = re.search(r'(?ms)^  platform:\n.*?(?=^  [A-Za-z][A-Za-z0-9_-]*:\n|\Z)', text)
    if not match:
        raise ValueError('Independent platform service missing')
    old = match.group(0)
    if old.count('      DATABASE_URL: ${DATABASE_URL:?required}\n') != 1:
        raise ValueError('Unexpected platform database mapping')
    new = old
    redis = '      REDIS_URL: ${REDIS_URL:?required}\n'
    if '      REDIS_URL:' in new:
        if new.count(redis) != 1:
            raise ValueError('Unexpected platform Redis mapping')
    else:
        needle = '      DATABASE_URL: ${DATABASE_URL:?required}\n'
        new = new.replace(needle, needle + redis)
    if '      redis: {condition: service_healthy}\n' not in new:
        needle = '    depends_on:\n      mysql: {condition: service_healthy}\n'
        if new.count(needle) != 1:
            raise ValueError('Unexpected platform dependencies')
        new = new.replace(needle, needle + '      redis: {condition: service_healthy}\n')
    return text[:match.start()] + new + text[match.end():]


def maintenance_api(text):
    guard = '    if ($request_method !~ "^(GET|HEAD|OPTIONS)$") { return 503; }\n'
    for marker in ['location ^~ /api/v1/platform/ {\n', 'location ^~ /api/v1/admin/ai/ {\n', 'location /api/v1/ {\n']:
        if text.count(marker) != 1:
            raise ValueError('Unexpected API location during maintenance preparation')
        text = text.replace(marker, marker + guard)
    return text


def write_bound_config(file, text, expected_hash):
    # Nginx binds this single file. Replacing its inode would leave the old config mounted.
    if file.is_symlink() or sha(file) != expected_hash:
        raise ValueError('Unexpected bound configuration before write')
    original = file.stat()
    descriptor = os.open(file, os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'r+', encoding='utf-8', newline='') as stream:
        opened = os.fstat(stream.fileno())
        if not stat.S_ISREG(opened.st_mode) or opened.st_uid != 0 or (opened.st_dev, opened.st_ino) != (original.st_dev, original.st_ino):
            raise ValueError('Bound configuration ownership or inode changed')
        stream.seek(0); stream.write(text); stream.truncate(); stream.flush(); os.fsync(stream.fileno())
    if (file.stat().st_dev, file.stat().st_ino) != (original.st_dev, original.st_ino):
        raise ValueError('Bound configuration inode unexpectedly replaced')


def verify_bound_api(w, expected_hash):
    actual = w.compose('exec', '-T', 'nginx', 'sha256sum', '/etc/nginx/api.inc').split()[0]
    if actual != expected_hash:
        raise ValueError('Nginx did not observe the intended API configuration')


def restore_bound_api(w, file, original, original_hash, guarded_hash):
    current_hash = sha(file)
    if current_hash == guarded_hash:
        write_bound_config(file, original, guarded_hash)
    elif current_hash != original_hash:
        raise ValueError('Bound API file changed outside the reviewed maintenance operation')
    verify_bound_api(w, original_hash)
    w.compose('exec', '-T', 'nginx', 'nginx', '-t')
    w.compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload')


def verify_write_gate(w):
    for suffix in ['', 'admin/ai/', 'platform/']:
        for attempt in range(3):
            code = w.command(['curl', '-sS', '--max-time', '10', '--resolve', 'admin.weiduoxian.cn:443:127.0.0.1',
                              '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST',
                              'https://admin.weiduoxian.cn/api/v1/' + suffix + '__qa_maintenance_probe__'])
            if code == '503':
                break
            if attempt == 2:
                raise ValueError('Write maintenance gate was not enforced')
            time.sleep(0.2)


def publish_site(w, folder, site):
    src, dst = folder / 'sites' / site, ROOT / 'sites' / site
    entry_name = 'platform.html' if site == 'platform' else 'index.html'
    # Retain historical hashed assets used by already-open pages; replace the entry point last.
    w.command(['rsync', '-rp', '--delay-updates', '--chmod=D755,F644', '--exclude=' + entry_name, str(src) + '/', str(dst) + '/'])
    temporary = dst / '.entry-closeout'
    w.command(['install', '-m', '644', str(src / entry_name), str(temporary)])
    os.replace(temporary, dst / entry_name)


def verify_https(w, manifests):
    domains = {'admin': 'admin.weiduoxian.cn', 'customer': 'app.weiduoxian.cn', 'official': 'weiduoxian.cn', 'platform': 'admin.weiduoxian.cn'}
    for site, manifest in manifests.items():
        host = domains[site]
        for item in manifest['files']:
            # Worker.command decodes text, so hash arbitrary binary images with a server-side curl pipeline instead.
            import subprocess
            route = '/platform-control/' + item['path'] if site == 'platform' else '/' + item['path']
            response = subprocess.run(['curl', '-fsS', '--max-time', '20', '--resolve', host + ':443:127.0.0.1',
                                       'https://' + host + route], capture_output=True, timeout=25, check=True)
            if hashlib.sha256(response.stdout).hexdigest() != item['sha256']:
                raise ValueError('Published HTTPS asset mismatch')


def verify_recovery_source(w, worker, installer, source, plan, target_schema):
    """One root-reviewed forward repair, never a public worker schema exception."""
    operation_file = w.state / 'operations' / (FAILED_OPERATION + '.json')
    if plan.get('recoveryOf') != FAILED_OPERATION or operation_file.is_symlink() or not operation_file.is_file():
        raise ValueError('Explicit known failed operation required for 24-to-24 repair')
    operation = json.loads(operation_file.read_text())
    if (operation.get('id'), operation.get('status'), operation.get('phase'), operation.get('type'), operation.get('source'), operation.get('target')) != (FAILED_OPERATION, 'failed', 'finished', 'update', SOURCE, FAILED_TARGET):
        raise ValueError('Unexpected recovery operation state')
    source_schema = installer.image_schema(SOURCE)
    if len(source_schema) != 20 or source_schema != source.get('schema') or source_schema != target_schema[:20]:
        raise ValueError('Recovery source image/catalog migration prefix mismatch')
    folder = ROOT / 'releases' / SOURCE
    if folder.is_symlink() or folder.resolve().parent != (ROOT / 'releases').resolve():
        raise ValueError('Recovery source directory rejected')
    manifest = worker.validate_assets(folder / 'sites/admin', folder / 'admin-manifest.json', source['manifestSha256'], SOURCE)
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', source.get('imageId', '')) or w.command(['docker', 'image', 'inspect', 'weiduoxian-backend:' + SOURCE, '--format', '{{.Id}}']) != source['imageId']:
        raise ValueError('Recovery source immutable image mismatch')
    return folder, manifest


def deploy(expected_backend, expected_control, preflight=False):
    if os.geteuid() != 0 or not all(re.fullmatch(r'sha256:[a-f0-9]{64}', value) for value in [expected_backend, expected_control]):
        raise ValueError('Root and exact verified image identities required')
    folder = ROOT / 'releases' / TARGET
    worker_file = ROOT / 'platform/control/platform-worker.py'
    worker = load('closeout_existing_worker', worker_file)
    installer = load('closeout_installer_helpers', folder / 'install-platform-control.py')
    w = worker.Worker(ROOT)
    plan = json.loads((folder / 'launch-plan.json').read_text())
    if (plan['release'], plan['source'], plan['control'], plan['oldControl']) != (TARGET, SOURCE, CONTROL, OLD_CONTROL) or plan['controlUiIncluded'] is not True:
        raise ValueError('Unexpected reviewed plan')
    if sha(worker_file) != plan['workerSha256']:
        raise ValueError('Installed worker differs; do not replace it implicitly')
    current_file, catalog_file = w.state / 'current.json', w.state / 'catalog.json'
    original_current, original_catalog = current_file.read_text(), catalog_file.read_text()
    if json.loads(original_current)['id'] != SOURCE:
        raise ValueError('Unexpected running business release')
    if any(w.queue.glob('*.request.json')) or any(w.queue.glob('*.running.json')) or (w.queue / 'active.lock').exists():
        raise ValueError('Another version operation is active')
    original_env, original_compose = (ROOT / '.env').read_text(), (ROOT / 'compose.yml').read_text()
    api_file = ROOT / 'nginx/api.inc'
    original_api = api_file.read_text()
    guarded_api = maintenance_api(original_api)
    original_api_hash = hashlib.sha256(original_api.encode()).hexdigest()
    guarded_api_hash = hashlib.sha256(guarded_api.encode()).hexdigest()
    if re.findall(r'^RELEASE_TAG=(.*)$', original_env, re.M) != [SOURCE] or re.findall(r'^PLATFORM_CONTROL_TAG=(.*)$', original_env, re.M) != [OLD_CONTROL]:
        raise ValueError('Unexpected original business/control tags')
    configured_compose = control_redis_compose(original_compose)
    for image, expected in [(TARGET, expected_backend), (CONTROL, expected_control)]:
        if w.command(['docker', 'image', 'inspect', 'weiduoxian-backend:' + image, '--format', '{{.Id}}']) != expected:
            raise ValueError('A verified image was retagged')
    before_schema, target_schema = w.control('schema'), installer.image_schema(TARGET)
    if len(target_schema) != 24 or [x['migration_name'] for x in target_schema[20:]] != ADDITIONS or target_schema != plan['migrations']:
        raise ValueError('Expected exact reviewed target 24-migration schema')
    recovery = before_schema == target_schema
    if plan.get('recoveryOf') is not None and not recovery:
        raise ValueError('A recovery plan requires the already-applied exact 24-migration schema')
    if not recovery and (len(before_schema) != 20 or target_schema[:20] != before_schema):
        raise ValueError('Expected reviewed 20-to-24 boundary or exact failed-release 24-to-24 repair')
    if installer.image_schema(CONTROL) != target_schema:
        raise ValueError('Control image Prisma schema is stale')
    catalog = json.loads(original_catalog)
    if any(x['id'] == TARGET for x in catalog['releases']):
        raise ValueError('Target is already registered')
    source = next(x for x in catalog['releases'] if x['id'] == SOURCE)
    source_folder, source_manifest = verify_recovery_source(w, worker, installer, source, plan, target_schema) if recovery else w.verify_release(source)
    manifests = {}
    for name in ['admin', 'customer', 'official', 'platform']:
        manifests[name] = validate_control_assets(folder / 'sites' / name, folder / (name + '-manifest.json'), plan['siteManifestSha256'][name]) if name == 'platform' else worker.validate_assets(folder / 'sites' / name, folder / (name + '-manifest.json'), plan['siteManifestSha256'][name], TARGET)
    control_ui_before, worker_before = tree(ROOT / 'sites/platform'), sha(worker_file)
    actor = json.loads(w.compose('exec', '-T', 'backend', 'node', input_text=ACTOR))
    if preflight:
        print(json.dumps({'preflight': 'passed', 'source': SOURCE, 'target': TARGET, 'migrationsBefore': len(before_schema), 'migrationsAfter': 24, 'recoveryOf': FAILED_OPERATION if recovery else None,
                          'backendImage': expected_backend, 'controlImage': expected_control, 'controlUiUpdated': True, 'workerPreserved': True}))
        return
    identity = str(uuid.uuid4())
    w.job = dict(id=identity, type='update', source=SOURCE, target=TARGET, **actor, status='queued', phase='preparing',
                 message='上线收口：已授权的增量迁移发布', createdAt=int(time.time() * 1000))
    w.log_file = w.state / 'logs' / (identity + '.log')
    w.control('audit', w.job)
    backup_name = w.backup()
    if not w.control('authorize', w.job)['allowed']:
        raise ValueError('Administrator authorization changed during backup')
    snapshot = ROOT / '.release-backups' / (TARGET + '-schema-boundary')
    snapshot.mkdir(mode=0o700)
    for name, data in [('.env', original_env), ('compose.yml', original_compose), ('catalog.json', original_catalog), ('current.json', original_current), ('api.inc', original_api)]:
        installer.write(snapshot / name, data, 0o600)
    for name in ['customer', 'official', 'platform']:
        shutil.copytree(ROOT / 'sites' / name, snapshot / ('site-' + name))
    installer.write(snapshot / 'control-ui-manifest.json', json.dumps(control_ui_before), 0o600)
    changed = False
    maintenance = False
    verified = False
    reopened = False
    active_file = w.queue / 'active.lock'
    lock_owned = False
    try:
        w.status('preparing', '完整备份完成，暂停业务写入并核对增量迁移', backup=backup_name)
        # The API can enqueue while the backup runs; never overwrite another operation's lock.
        with open(active_file, 'x', encoding='utf-8') as stream:
            json.dump({'id': identity}, stream)
        os.chmod(active_file, 0o600)
        lock_owned = True
        write_bound_config(api_file, guarded_api, original_api_hash)
        maintenance = True
        verify_bound_api(w, guarded_api_hash)
        w.compose('exec', '-T', 'nginx', 'nginx', '-t')
        w.compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload')
        verify_write_gate(w)
        changed = True
        w.compose('stop', 'backend')
        # Read through the old image after stopping API traffic. Existing rows remain authoritative.
        before = json.loads(w.compose('run', '--rm', '--no-deps', '-T', '--pull', 'never', 'backend', 'node', input_text=SNAPSHOT))
        installer.write(snapshot / 'business-before.json', json.dumps(before), 0o600)
        configured_env = tag(tag(original_env, 'RELEASE_TAG', TARGET), 'PLATFORM_CONTROL_TAG', CONTROL)
        installer.write(ROOT / '.env', configured_env, 0o600); installer.write(ROOT / 'compose.yml', configured_compose)
        w.compose('config', '--quiet')
        added_before = None
        if recovery:
            # The new image's Prisma client can read all already-applied fields; the old image cannot.
            # Preserve accepted data, including nonempty tables. Never reinitialize this boundary.
            added_before = json.loads(w.compose('run', '--rm', '--no-deps', '-T', '--pull', 'never', 'backend', 'node', input_text=ADDED_SNAPSHOT))
            installer.write(snapshot / 'additive-before.json', json.dumps(added_before), 0o600)
        else:
            w.compose('run', '--rm', '--no-deps', '-T', '--pull', 'never', 'backend', 'node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy')
        if w.control('schema') != target_schema:
            raise ValueError('Applied migrations mismatch')
        empty = None if recovery else json.loads(w.compose('run', '--rm', '--no-deps', '-T', '--pull', 'never', 'backend', 'node', input_text=ADDED_EMPTY))
        migrated = json.loads(w.compose('run', '--rm', '--no-deps', '-T', '--pull', 'never', 'backend', 'node', input_text=SNAPSHOT))
        if before != migrated:
            raise ValueError('An original row/environment changed during migration')
        info = json.loads((folder / 'release-info.json').read_text())
        target = dict(**info, ready=True, imageId=expected_backend, manifestSha256=plan['siteManifestSha256']['admin'], schema=target_schema)
        w.status('deploying', '迁移原数据保持，正在更新认证、业务及三站资源', backup=backup_name)
        w.apply(target, folder, manifests['admin'])
        w.compose('up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'platform')
        for name in ['customer', 'official', 'platform']:
            publish_site(w, folder, name)
        w.compose('exec', '-T', 'nginx', 'nginx', '-t'); w.compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload')
        verify_https(w, manifests)
        after = json.loads(w.compose('exec', '-T', 'backend', 'node', input_text=SNAPSHOT))
        if before != after:
            raise ValueError('Original rows changed during application switch; inspect concurrent activity')
        added_after = None
        if recovery:
            added_after = json.loads(w.compose('exec', '-T', 'backend', 'node', input_text=ADDED_SNAPSHOT))
            if added_before != added_after:
                raise ValueError('Accepted additive rows changed during forward repair')
            installer.write(snapshot / 'additive-after.json', json.dumps(added_after), 0o600)
        expected_control_files = tree(folder / 'sites/platform')
        actual_control = tree(ROOT / 'sites/platform')
        if any(actual_control.get(name) != digest for name, digest in expected_control_files.items()) or sha(worker_file) != worker_before:
            raise ValueError('New control UI or preserved worker mismatch')
        if any(actual_control.get(name) != digest for name, digest in control_ui_before.items() if name not in expected_control_files):
            raise ValueError('Historical control asset removed')
        if without_tags((ROOT / '.env').read_text()) != without_tags(original_env) or (ROOT / 'compose.yml').read_text() != configured_compose:
            raise ValueError('Unreviewed configuration change')
        for entry in catalog['releases']:
            entry['ready'] = False
        catalog['releases'].append(target)
        worker.atomic_json(catalog_file, catalog)
        worker.atomic_json(current_file, {'id': TARGET, 'changedAt': int(time.time() * 1000), 'operationId': identity})
        result = {'release': TARGET, 'operationId': identity, 'backup': backup_name, 'migrations': 24, 'businessBefore': before, 'businessAfter': after,
                  'newTableCountsAtMigration': empty, 'recoveryOf': FAILED_OPERATION if recovery else None, 'addedDataBefore': added_before, 'addedDataAfter': added_after,
                  'backendImage': expected_backend, 'controlImage': expected_control, 'controlUiUpdated': True, 'workerPreserved': True}
        installer.write(snapshot / 'verification.json', json.dumps(result), 0o600)
        verified = True
        restore_bound_api(w, api_file, original_api, original_api_hash, guarded_api_hash)
        maintenance = False
        reopened = True
        w.status('finished', '上线收口发布完成，原业务数据保持，独立控制界面与认证同步更新', 'succeeded', backup=backup_name, finishedAt=int(time.time() * 1000))
        # Do not roll back a verified, reopened application solely because its result audit needs retry.
        try:
            w.control('audit', w.job)
        except Exception:
            w.job['auditPending'] = True
            w.status('finished', '发布与数据校验完成，结果审计等待受控补记', 'succeeded', backup=backup_name, finishedAt=int(time.time() * 1000))
        print(json.dumps({key: value for key, value in result.items() if key not in ['businessBefore', 'businessAfter']}))
    except Exception:
        if verified:
            # Accepted business writes may already exist. Keep the validated application and finish forward.
            w.job.update({'phase': 'finished', 'status': 'succeeded' if reopened else 'failed', 'auditPending': True,
                          'message': '版本与数据已验证，收尾状态等待受控补记' if reopened else '版本与数据已验证并保留，维护门禁恢复需要运维处理',
                          'backup': backup_name, 'finishedAt': int(time.time() * 1000)})
            try:
                worker.atomic_json(w.state / 'operations' / (identity + '.json'), w.job)
            except Exception:
                pass
            try:
                w.control('audit', w.job)
            except Exception:
                pass
            raise
        # Keep all additive tables/columns and any accepted new records. Never restore a database dump.
        if changed:
            installer.write(ROOT / '.env', original_env, 0o600); installer.write(ROOT / 'compose.yml', original_compose)
            w.apply(source, source_folder, source_manifest)
            w.compose('up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'platform')
            for name in ['customer', 'official', 'platform']:
                w.command(['rsync', '-rp', '--delay-updates', '--chmod=D755,F644', str(snapshot / ('site-' + name)) + '/', str(ROOT / 'sites' / name) + '/'])
            # Old schema catalog entries are intentionally disabled until an operator completes forward repair.
            recovery_catalog = json.loads(original_catalog)
            for entry in recovery_catalog['releases']:
                entry['ready'] = False
            worker.atomic_json(catalog_file, recovery_catalog); installer.write(current_file, original_current, 0o644)
            w.compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload')
        w.status('finished', '发布失败，原应用已恢复；增量结构保留，旧结构版本切换已停用，需运维向前修复', 'failed', backup=backup_name, finishedAt=int(time.time() * 1000))
        try:
            w.control('audit', w.job)
        except Exception:
            w.job['auditPending'] = True
            w.status('finished', '发布失败，原应用已恢复；增量结构保留，结果审计等待受控补记', 'failed', backup=backup_name, finishedAt=int(time.time() * 1000))
        raise
    finally:
        if maintenance:
            restore_bound_api(w, api_file, original_api, original_api_hash, guarded_api_hash)
        if lock_owned and active_file.exists() and json.loads(active_file.read_text()).get('id') == identity:
            active_file.unlink()


if __name__ == '__main__':
    with open('/run/weiduoxian-platform.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        deploy(sys.argv[1], sys.argv[2], '--preflight' in sys.argv[3:])
