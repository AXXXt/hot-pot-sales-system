// Keep local credentials and test SMS isolated from inherited production variables.
const path = require('node:path')
const { localConfig } = require('./local-environment.cjs')
const env = localConfig()
for (const key of Object.keys(process.env)) {
  if (/^(DATABASE_|REDIS_|MINIO_|JWT_|SMS_|WECHAT_|WX_|AI_)/.test(key)) delete process.env[key]
}
Object.assign(process.env, env, {
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000',
  CORS_ORIGIN: [3000, 5173, 5174, 5180].flatMap(port =>
    [`http://127.0.0.1:${port}`, `http://localhost:${port}`]).join(',')
})
process.chdir(path.resolve(__dirname, '../backend'))
if (process.argv.includes('--built')) require('../backend/dist/src/main.js')
else {
  process.argv = [process.execPath, require.resolve('../backend/node_modules/@nestjs/cli/bin/nest.js'), 'start', '--watch']
  require('../backend/node_modules/@nestjs/cli/bin/nest.js')
}
