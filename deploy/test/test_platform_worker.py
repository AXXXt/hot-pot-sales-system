import base64
import hashlib
import hmac
import importlib.util
import json
import os
import tempfile
import time
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[1] / 'platform-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class ReleaseValidationTests(unittest.TestCase):
    def setUp(self):
        self.key = b'k' * 32
        self.catalog = json.dumps({'releases': [{'id': 'ai-20261021-2', 'sequence': 2, 'ready': True}, {'id': 'ai-20261021-3', 'sequence': 3, 'ready': True}]}).encode()
        self.job = {'id': '00000000-0000-4000-8000-000000000001', 'type': 'update', 'source': 'ai-20261021-2', 'target': 'ai-20261021-3', 'actorId': 1, 'tenantId': 1, 'fingerprint': 'fresh', 'catalogDigest': hashlib.sha256(self.catalog).hexdigest(), 'createdAt': 1000000, 'expiresAt': 1300000, 'status': 'queued', 'phase': 'queued', 'message': 'ready'}

    def envelope(self, job=None):
        payload = base64.urlsafe_b64encode(json.dumps(job or self.job, separators=(',', ':')).encode()).decode().rstrip('=')
        return {'payload': payload, 'signature': hmac.new(self.key, ('platform-job\n' + payload).encode(), hashlib.sha256).hexdigest()}

    def validate(self, envelope=None, **kwargs):
        return worker.validate_request(envelope or self.envelope(), self.key, kwargs.get('catalog', self.catalog), kwargs.get('current', {'id': 'ai-20261021-2'}), kwargs.get('now', 1000001))

    def test_valid_signed_update_and_rollback(self):
        self.assertEqual(self.validate()[2]['id'], 'ai-20261021-3')
        self.job.update(type='rollback', source='ai-20261021-3', target='ai-20261021-2')
        self.assertEqual(self.validate(current={'id': 'ai-20261021-3'})[2]['id'], 'ai-20261021-2')

    def test_signature_expiry_snapshot_direction_and_paths(self):
        bad = self.envelope(); bad['payload'] += 'x'
        for envelope, kwargs in [(bad, {}), (self.envelope(), {'now': 1300000}), (self.envelope(), {'catalog': self.catalog + b' '}), (self.envelope(), {'current': {'id': 'ai-20261021-3'}})]:
            with self.assertRaises(ValueError): self.validate(envelope, **kwargs)
        for field, value in [('type', 'rollback'), ('target', '../../etc/passwd'), ('actorId', -1), ('expiresAt', 1400000)]:
            job = {**self.job, field: value}
            with self.assertRaises(ValueError): self.validate(self.envelope(job))

    def test_artifact_hash_and_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'index.html').write_bytes(b'index')
            manifest = root / 'manifest.json'
            data = {'release': 'ai-20261021-3', 'files': [{'path': 'index.html', 'sha256': hashlib.sha256(b'index').hexdigest()}]}
            def validate():
                manifest.write_text(json.dumps(data))
                return worker.validate_assets(root, manifest, hashlib.sha256(manifest.read_bytes()).hexdigest(), data['release'])
            self.assertEqual(len(validate()['files']), 1)
            (root / 'index.html').write_bytes(b'tampered')
            with self.assertRaises(ValueError): validate()
            data['files'].append({'path': '../secret', 'sha256': 'x'})
            (root / 'index.html').write_bytes(b'index')
            with self.assertRaises(ValueError): validate()

    def test_apply_only_changes_release_and_never_restores_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'sites/admin').mkdir(parents=True)
            (root / '.env').write_text('RELEASE_TAG=ai-20261021-2\nDATABASE_URL=preserved\nAI_ENCRYPTION_KEY=preserved\n')
            class Fake(worker.Worker):
                def command(self, arguments, **kwargs):
                    commands.append(arguments)
                    if arguments[0] == 'install': Path(arguments[-1]).write_text('entry')
                    return ''
            commands = []; instance = Fake(root)
            instance.apply({'id': 'ai-20261021-3'}, root, {'files': []})
            self.assertEqual((root / '.env').read_text(), 'RELEASE_TAG=ai-20261021-3\nDATABASE_URL=preserved\nAI_ENCRYPTION_KEY=preserved\n')
            serialized = json.dumps(commands)
            self.assertNotIn('migrate', serialized); self.assertNotIn('mysql', serialized); self.assertNotIn('restore', serialized)

    def scenario(self, fail_target=False, fail_backup=False, revoked=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['queue', 'operations', 'logs']: (root / 'platform' / name).mkdir(parents=True, exist_ok=True)
            state = root / 'platform'
            (state / 'catalog.json').write_bytes(self.catalog); (state / 'catalog.json').chmod(0o644)
            (state / 'current.json').write_text(json.dumps({'id': 'ai-20261021-2'}))
            (root / '.env').write_text('PLATFORM_COMMAND_KEY=' + base64.b64encode(self.key).decode())
            self.job.update(createdAt=int(time.time() * 1000), expiresAt=int(time.time() * 1000) + 300000)
            request = state / 'queue' / (self.job['id'] + '.request.json'); request.write_text(json.dumps(self.envelope()))
            (state / 'queue/active.lock').write_text(json.dumps({'id': self.job['id']}))
            calls = []
            class Fake(worker.Worker):
                def control(self, mode, value=None):
                    calls.append(mode)
                    return {'allowed': not revoked or calls.count('authorize') == 1, 'ok': True}
                def verify_release(self, release): return root, {'files': []}
                def backup(self):
                    calls.append('backup')
                    if fail_backup: raise RuntimeError('backup failed')
                    return 'verified-backup.tar.gz'
                def apply(self, release, folder, manifest):
                    calls.append(release['id'])
                    if fail_target and release['id'] == 'ai-20261021-3': raise RuntimeError('unhealthy deployment')
            Fake(root).process(request)
            operation = json.loads((state / 'operations' / (self.job['id'] + '.json')).read_text())
            current = json.loads((state / 'current.json').read_text())
            self.assertFalse((state / 'queue/active.lock').exists())
            return operation, current, calls

    @unittest.skipIf(os.name == 'nt', 'Root ownership and POSIX mode checks are verified on Linux')
    def test_success_failure_recovery_and_no_switch_without_backup_or_fresh_permission(self):
        operation, current, calls = self.scenario()
        self.assertEqual(operation['status'], 'succeeded'); self.assertEqual(current['id'], 'ai-20261021-3')
        self.assertLess(calls.index('backup'), calls.index('ai-20261021-3'))
        operation, current, calls = self.scenario(fail_target=True)
        self.assertEqual(operation['status'], 'rolled_back'); self.assertEqual(current['id'], 'ai-20261021-2')
        self.assertEqual(calls[-3:], ['ai-20261021-3', 'ai-20261021-2', 'audit'])
        for options in [{'fail_backup': True}, {'revoked': True}]:
            operation, current, calls = self.scenario(**options)
            self.assertEqual(operation['status'], 'failed'); self.assertEqual(current['id'], 'ai-20261021-2')
            self.assertNotIn('ai-20261021-3', calls)


if __name__ == '__main__': unittest.main()
