"""Trusted root deployment across the 19 -> 20 migration boundary.

Run this saved file only after verifying and extracting the release archive and
loading the matching image. Only the reviewed public template mappings are added.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import time
import uuid
from pathlib import Path

ROOT = Path('/opt/weiduoxian')
SOURCE = 'ai-20261022-2'
TARGET = 'ai-20261022-3'
CONTROL = 'control-20261022-1'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def replace_tag(text, name, value):
    updated, count = re.subn(r'^' + name + r'=.*$', name + '=' + value, text, flags=re.M)
    if count != 1:
        raise ValueError('Ambiguous release configuration')
    return updated


def without_tags(text):
    return re.sub(r'^(?:RELEASE_TAG|PLATFORM_CONTROL_TAG)=.*\n?', '', text, flags=re.M)


SNAPSHOT = """const{PrismaClient}=require('@prisma/client'),{createHash}=require('node:crypto');const p=new PrismaClient();(async()=>{try{const result={};for(const name of ['user','staffCredential','stocktake','stocktakeItem','replenishmentPlan','brand','productCategory','product','productSku','customer','order','orderItem','stockAdjustment','stockMovement','stockBatch','aiConfig']){const rows=await p[name].findMany();result[name]={count:rows.length,sha256:createHash('sha256').update(rows.map(x=>JSON.stringify(x)).sort().join('\\n')).digest('hex')}}console.log(JSON.stringify(result))}finally{await p.$disconnect()}})().catch(()=>process.exitCode=1)"""
ACTOR = """const{PrismaClient}=require('@prisma/client');const{StaffAccessService}=require('./dist/src/auth/staff-access.service');const p=new PrismaClient();(async()=>{try{const users=await p.user.findMany({where:{tenantId:1,userType:'super_admin',status:'active'},select:{id:true}});if(users.length!==1)throw Error('Unique active administrator required');const a=await new StaffAccessService(p).actor(users[0].id);console.log(JSON.stringify({actorId:a.id,tenantId:a.tenantId,fingerprint:a.fingerprint}))}finally{await p.$disconnect()}})().catch(()=>process.exitCode=1)"""


def deploy(expected_image, preflight=False):
    if os.geteuid() != 0 or not re.fullmatch(r'sha256:[a-f0-9]{64}', expected_image):
        raise ValueError('Root and exact verified image identity required')
    folder = ROOT / 'releases' / TARGET
    worker = load('password_release_worker', folder / 'platform-worker.py')
    installer = load('password_release_installer', folder / 'install-platform-control.py')
    installer.secure_tree(folder)
    w = worker.Worker(ROOT)
    current_path, catalog_path = w.state / 'current.json', w.state / 'catalog.json'
    original_current, original_catalog = current_path.read_text(), catalog_path.read_text()
    if json.loads(original_current)['id'] != SOURCE:
        raise ValueError('Unexpected current release; inspect before continuing')
    if any(w.queue.glob('*.request.json')) or any(w.queue.glob('*.running.json')) or (w.queue / 'active.lock').exists():
        raise ValueError('A version operation is already active')
    original_env = (ROOT / '.env').read_text()
    original_compose = (ROOT / 'compose.yml').read_text()
    templates = json.loads((folder / 'wechat-order-templates.json').read_text())
    if templates['appId'] != 'wx09cca054a9642d35':
        raise ValueError('Template application mismatch')
    extra = {}
    for name in ['quote', 'approved']:
        item = templates[name]
        if not re.fullmatch(r'[A-Za-z0-9_-]{10,128}', item['templateId']):
            raise ValueError('Invalid public template identity')
        extra['WX_SUBSCRIBE_TPL_' + name.upper()] = item['templateId']
        extra['WX_SUBSCRIBE_FIELDS_' + name.upper()] = json.dumps(item['fields'], separators=(',', ':'))
    if any(re.search(r'^' + key + '=', original_env, re.M) for key in extra):
        raise ValueError('New template configuration already exists; inspect before continuing')
    configured_env = original_env + ('' if original_env.endswith('\n') else '\n')
    configured_env += ''.join(key + '=' + value + '\n' for key, value in extra.items())
    marker = '      WX_MINIPROGRAM_STATE: ${WX_MINIPROGRAM_STATE:-}\n'
    if original_compose.count(marker) != 1:
        raise ValueError('Unexpected Wechat Compose mapping')
    mappings = ''.join('      ' + key + ': ${' + key + ':-}\n' for key in extra)
    configured_compose = original_compose.replace(marker, marker + mappings)
    if re.findall(r'^RELEASE_TAG=(.*)$', original_env, re.M) != [SOURCE]:
        raise ValueError('Source image configuration mismatch')
    if w.command(['docker', 'image', 'inspect', 'weiduoxian-backend:' + TARGET, '--format', '{{.Id}}']) != expected_image:
        raise ValueError('Target image identity mismatch')
    source = next(r for r in json.loads(original_catalog)['releases'] if r['id'] == SOURCE)
    source_folder, source_manifest = w.verify_release(source)
    if re.findall(r'^PLATFORM_CONTROL_TAG=(.*)$', original_env, re.M) != [CONTROL]:
        raise ValueError('Independent control version must remain pinned')
    before_schema = w.control('schema')
    target_schema = installer.image_schema(TARGET)
    if len(before_schema) != 19 or len(target_schema) != 20:
        raise ValueError('Expected the reviewed 19-to-20 schema boundary')
    expected_old = [x for x in target_schema if x['migration_name'] != '20261022080000_customer_notifications']
    if expected_old != before_schema:
        raise ValueError('An existing migration changed')
    info = json.loads((folder / 'release-info.json').read_text())
    manifest_path = folder / 'admin-manifest.json'
    manifest_digest = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    manifest = worker.validate_assets(folder / 'sites/admin', manifest_path, manifest_digest, TARGET)
    actor = json.loads(w.compose('exec', '-T', 'backend', 'node', input_text=ACTOR))
    if preflight:
        print(json.dumps({'preflight': 'passed', 'source': SOURCE, 'target': TARGET, 'migrationsBefore': 19, 'migrationsAfter': 20, 'imageId': expected_image}))
        return
    identity = str(uuid.uuid4())
    w.job = dict(id=identity, type='update', source=SOURCE, target=TARGET, **actor,
                 status='queued', phase='preparing', message='订单关键提醒：已授权的增量迁移发布', createdAt=int(time.time() * 1000))
    w.log_file = w.state / 'logs' / (identity + '.log')
    w.control('audit', w.job)
    before = json.loads(w.compose('exec', '-T', 'backend', 'node', input_text=SNAPSHOT))
    backup_name = w.backup()
    if not w.control('authorize', w.job)['allowed']:
        raise ValueError('Administrator access changed during backup')
    snapshot = ROOT / '.release-backups' / (TARGET + '-schema-boundary')
    snapshot.mkdir(mode=0o700)
    shutil.copy2(ROOT / '.env', snapshot / '.env')
    shutil.copy2(ROOT / 'compose.yml', snapshot / 'compose.yml')
    installer.write(snapshot / 'business-summary.json', json.dumps(before), 0o600)
    installer.write(snapshot / 'catalog.json', original_catalog, 0o600)
    w.status('preparing', '备份完成，正在增加客户站内消息表', backup=backup_name)
    changed = False
    try:
        changed = True
        w.compose('stop', 'backend')
        updated = replace_tag(configured_env, 'RELEASE_TAG', TARGET)
        installer.write(ROOT / '.env', updated, 0o600)
        installer.write(ROOT / 'compose.yml', configured_compose)
        w.compose('config', '--quiet')
        w.compose('run', '--rm', '--no-deps', '-T', '--pull', 'never', 'backend', 'node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy')
        if w.control('schema') != target_schema:
            raise ValueError('Migration verification failed')
        target = dict(**info, ready=True, imageId=expected_image, manifestSha256=manifest_digest, schema=target_schema)
        w.status('deploying', '迁移已核对，正在发布订单提醒服务', backup=backup_name)
        w.apply(target, folder, manifest)
        w.compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload')
        after = json.loads(w.compose('exec', '-T', 'backend', 'node', input_text=SNAPSHOT))
        if before != after:
            raise ValueError('Existing business rows changed during deployment')
        if without_tags((ROOT / '.env').read_text()) != without_tags(configured_env):
            raise ValueError('Unrelated environment configuration changed')
        if (ROOT / 'compose.yml').read_text() != configured_compose:
            raise ValueError('Unexpected Compose change')
        catalog = json.loads(original_catalog)
        for entry in catalog['releases']:
            entry['ready'] = False
        catalog['releases'].append(target)
        worker.atomic_json(catalog_path, catalog)
        worker.atomic_json(current_path, {'id': TARGET, 'changedAt': int(time.time() * 1000), 'operationId': identity})
        w.status('finished', '订单提醒发布完成，原商品、库存、订单及配置已核对保留', 'succeeded', backup=backup_name, finishedAt=int(time.time() * 1000))
        w.control('audit', w.job)
        installer.write(snapshot / 'verification.json', json.dumps({'before': before, 'after': after, 'imageId': expected_image, 'backup': backup_name}), 0o600)
        print(json.dumps({'release': TARGET, 'operationId': identity, 'backup': backup_name, 'businessDataUnchanged': True, 'migrations': 20}))
    except Exception:
        # Additive schema remains; never restore an older database over business data.
        if changed:
            installer.write(ROOT / '.env', original_env, 0o600)
            installer.write(ROOT / 'compose.yml', original_compose)
            w.apply(source, source_folder, source_manifest)
            w.compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload')
            installer.write(catalog_path, original_catalog)
            installer.write(current_path, original_current)
        w.status('finished', '发布校验失败，原应用已恢复；增量迁移保留，需运维向前修复', 'failed', backup=backup_name, finishedAt=int(time.time() * 1000))
        w.control('audit', w.job)
        raise


if __name__ == '__main__':
    with open('/run/weiduoxian-platform.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        deploy(sys.argv[1], '--preflight' in sys.argv[2:])
