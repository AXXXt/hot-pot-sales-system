"""Install the independent release controller, or stage another trusted local release.

Run as root only after verifying the uploaded archive SHA256. No public upload endpoint exists.
"""
import base64
import hashlib
import importlib.util
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path('/opt/weiduoxian')
STATE = ROOT / 'platform'
ID = re.compile(r'^ai-\d{8}-\d+$')


def command(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False, timeout=180)
    if result.returncode:
        raise RuntimeError('Installation command failed: ' + args[0])
    return result.stdout.strip()


def write(file, value, mode=0o644):
    temporary = file.with_name(file.name + '.install-tmp')
    temporary.write_text(value, encoding='utf-8')
    os.chmod(temporary, mode)
    os.replace(temporary, file)


def secure_tree(directory):
    if directory.is_symlink(): raise ValueError('Symlink release rejected')
    for file in [directory, *directory.rglob('*')]:
        if file.is_symlink(): raise ValueError('Symlink artifact rejected')
        os.chown(file, 0, 0)
        os.chmod(file, 0o755 if file.is_dir() else 0o644)


def image_schema(identity):
    script = "const fs=require('node:fs'),c=require('node:crypto');console.log(JSON.stringify(fs.readdirSync('/app/prisma/migrations').filter(x=>fs.existsSync('/app/prisma/migrations/'+x+'/migration.sql')).sort().map(x=>({migration_name:x,checksum:c.createHash('sha256').update(fs.readFileSync('/app/prisma/migrations/'+x+'/migration.sql')).digest('hex')}))))"
    return json.loads(command('docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node', 'weiduoxian-backend:' + identity, '-e', script))


def release_metadata(identity, schema, info, validator):
    if not ID.fullmatch(identity): raise ValueError('Invalid release ID')
    folder = ROOT / 'releases' / identity
    secure_tree(folder)
    manifest = folder / 'admin-manifest.json'
    digest = hashlib.sha256(manifest.read_bytes()).hexdigest()
    validator(folder / 'sites/admin', manifest, digest, identity)
    if image_schema(identity) != schema: raise ValueError('Image schema does not match the running database')
    image = command('docker', 'image', 'inspect', 'weiduoxian-backend:' + identity, '--format', '{{.Id}}')
    return {**info, 'id': identity, 'ready': True, 'imageId': image, 'manifestSha256': digest, 'schema': schema}


def install(identity, mode):
    if not ID.fullmatch(identity) or mode not in {'bootstrap', 'stage'}: raise ValueError('Invalid arguments')
    folder = ROOT / 'releases' / identity
    spec = importlib.util.spec_from_file_location('worker', folder / 'platform-worker.py')
    worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
    info = json.loads((folder / 'release-info.json').read_text())
    if info['id'] != identity or not re.fullmatch(r'\d+\.\d+\.\d+', info['version']) or type(info['sequence']) is not int:
        raise ValueError('Invalid release metadata')
    query = "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.$queryRawUnsafe('SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name').then(x=>console.log(JSON.stringify(x))).finally(()=>p.$disconnect())"
    schema = json.loads(command('docker', 'compose', 'exec', '-T', 'backend', 'node', '-e', query))
    target = release_metadata(identity, schema, info, worker.validate_assets)
    if mode == 'stage':
        catalog = json.loads((STATE / 'catalog.json').read_text())
        if any(r['id'] == identity or r['sequence'] == info['sequence'] for r in catalog['releases']): raise ValueError('Release already registered')
        catalog['releases'].append(target)
        write(STATE / 'catalog.json', json.dumps(catalog, ensure_ascii=False, indent=2))
        print('Trusted release staged; an administrator may review and switch in the version center')
        return
    if STATE.exists(): raise ValueError('Control plane already exists; use stage for future releases')
    env_file = ROOT / '.env'
    env = env_file.read_text()
    current_id = re.findall(r'^RELEASE_TAG=(.+)$', env, flags=re.M)
    if current_id != ['ai-20261021-2']: raise ValueError('Bootstrap requires the verified preceding release')
    source = release_metadata(current_id[0], schema, {'version': '1.1.0', 'sequence': 2, 'title': '商品、品牌与分类同步创建', 'notes': ['照片识别后可同步创建品牌、分类、商品和SKU', '商品草稿补充品牌与分类，保留权限检查与确认'], 'publishedAt': '2026-10-21T04:13:00Z', 'supportsControl': False}, worker.validate_assets)
    command('systemctl', 'start', 'weiduoxian-backup.service')
    backup_result = command('systemctl', 'show', 'weiduoxian-backup.service', '-p', 'Result', '-p', 'ExecMainStatus')
    if 'Result=success' not in backup_result or 'ExecMainStatus=0' not in backup_result: raise RuntimeError('Backup did not complete')
    snapshot = ROOT / '.release-backups/platform-control-v1'
    snapshot.mkdir(mode=0o700)
    for name in ['.env', 'compose.yml', 'nginx/api.inc', 'backup.sh']:
        dest = snapshot / name.replace('/', '-'); shutil.copy2(ROOT / name, dest); os.chmod(dest, 0o600)
    for directory, mode_bits in [('', 0o755), ('queue', 0o700), ('operations', 0o755), ('control', 0o700), ('logs', 0o700)]:
        (STATE / directory).mkdir(exist_ok=True); os.chmod(STATE / directory, mode_bits)
    os.chown(STATE / 'queue', 1000, 1000)
    write(STATE / 'catalog.json', json.dumps({'schema': 1, 'releases': [source, target]}, ensure_ascii=False, indent=2))
    write(STATE / 'current.json', json.dumps({'id': source['id'], 'changedAt': int(time.time() * 1000)}))
    shutil.copy2(folder / 'platform-worker.py', STATE / 'control/platform-worker.py'); os.chmod(STATE / 'control/platform-worker.py', 0o600)
    existing = re.findall(r'^PLATFORM_COMMAND_KEY=(.*)$', env, flags=re.M)
    if existing and len(base64.b64decode(existing[0], validate=True)) != 32: raise ValueError('Existing signing key invalid')
    if not existing: env += '\nPLATFORM_COMMAND_KEY=' + base64.b64encode(secrets.token_bytes(32)).decode() + '\n'
    env += 'PLATFORM_CONTROL_TAG=' + identity + '\n'
    compose_file = ROOT / 'compose.yml'; compose = compose_file.read_text()
    if '  platform:' in compose or compose.count('  nginx:\n') != 1: raise ValueError('Unexpected compose layout')
    service = '''  platform:
    <<: *service
    image: weiduoxian-backend:${PLATFORM_CONTROL_TAG:?required}
    command: ['node', '/app/platform-api.cjs']
    mem_limit: 192m
    memswap_limit: 256m
    environment:
      NODE_ENV: production
      PORT: '3001'
      NODE_OPTIONS: --max-old-space-size=96
      DATABASE_URL: ${DATABASE_URL:?required}
      JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET:?required}
      PLATFORM_COMMAND_KEY: ${PLATFORM_COMMAND_KEY:?required}
      PLATFORM_OWNER_TENANT_ID: '1'
    volumes:
      - ./platform:/platform:ro
      - ./platform/queue:/platform/queue:rw
    depends_on:
      mysql: {condition: service_healthy}
    healthcheck:
      test: ['CMD', 'node', '-e', 'fetch("http://localhost:3001/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))']
      interval: 20s
      timeout: 5s
      retries: 6
'''
    try:
        write(env_file, env, 0o600)
        write(compose_file, compose.replace('  nginx:\n', service + '  nginx:\n'))
        command('docker', 'compose', 'config', '--quiet')
        command('docker', 'compose', 'up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'platform')
        command('rsync', '-rp', '--delay-updates', '--chmod=D755,F644', str(folder / 'sites/platform') + '/', str(ROOT / 'sites/platform') + '/')
        api_file = ROOT / 'nginx/api.inc'
        routes = '''# Independent release control remains available across business rollbacks.
location ^~ /api/v1/platform/ {
    if ($host != admin.weiduoxian.cn) { return 404; }
    limit_req zone=api burst=40 nodelay;
    proxy_pass http://platform:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 30s;
}
location = /platform-updates {
    if ($host != admin.weiduoxian.cn) { return 404; }
    alias /srv/sites/platform/platform.html;
    default_type text/html;
    add_header Cache-Control no-store;
}
location ^~ /platform-control/ {
    if ($host != admin.weiduoxian.cn) { return 404; }
    alias /srv/sites/platform/;
    add_header X-Content-Type-Options nosniff always;
}
'''
        api_file.write_text(routes + api_file.read_text())  # Preserve the individual bind-mount inode.
        command('docker', 'compose', 'exec', '-T', 'nginx', 'nginx', '-t')
        command('docker', 'compose', 'exec', '-T', 'nginx', 'nginx', '-s', 'reload')
        backup_file = ROOT / 'backup.sh'
        original = backup_file.read_text()
        needle = 'tar -czf "$work/config.tar.gz" -C /opt/weiduoxian .env compose.yml nginx sites -C /etc letsencrypt'
        if needle not in original: raise ValueError('Unexpected backup script')
        write(backup_file, original.replace(needle, 'tar --exclude=platform/queue --exclude=platform/logs --exclude=platform/operations -czf "$work/config.tar.gz" -C /opt/weiduoxian .env compose.yml nginx sites platform -C /etc letsencrypt'), 0o700)
        for suffix in ['service', 'path', 'timer']:
            name = 'weiduoxian-platform-worker.' + suffix
            shutil.copy2(folder / name, Path('/etc/systemd/system') / name); os.chmod(Path('/etc/systemd/system') / name, 0o644)
        command('systemctl', 'daemon-reload')
        command('systemctl', 'enable', '--now', 'weiduoxian-platform-worker.path', 'weiduoxian-platform-worker.timer')
        print('Independent version control installed; business release is unchanged; target version is ready')
    except Exception:
        command('docker', 'compose', 'stop', 'platform')
        for name in ['.env', 'compose.yml', 'nginx/api.inc', 'backup.sh']:
            data = (snapshot / name.replace('/', '-')).read_bytes()
            (ROOT / name).write_bytes(data)
            os.chmod(ROOT / name, 0o600 if name == '.env' else 0o700 if name == 'backup.sh' else 0o644)
        command('docker', 'compose', 'exec', '-T', 'nginx', 'nginx', '-t')
        command('docker', 'compose', 'exec', '-T', 'nginx', 'nginx', '-s', 'reload')
        raise


if __name__ == '__main__':
    if os.geteuid() != 0: raise SystemExit('Root is required')
    install(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'bootstrap')
