"""Pure/controlled release safeguards. No Docker, network or production paths are used."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / 'release-launch-closeout.py'
spec = importlib.util.spec_from_file_location('launch_closeout_under_test', SCRIPT)
release = importlib.util.module_from_spec(spec)
# fcntl is only used in the executable entry point, never in these controlled tests.
try:
    import fcntl  # noqa: F401
    spec.loader.exec_module(release)
except ModuleNotFoundError as error:
    if error.name != 'fcntl':
        raise
    with patch.dict(sys.modules, {'fcntl': types.SimpleNamespace()}):
        spec.loader.exec_module(release)


API = '''# controlled fixture
location ^~ /api/v1/platform/ {
    proxy_pass http://platform:3001;
}
location ^~ /api/v1/admin/ai/ {
    proxy_pass http://backend:3000;
}
location /api/v1/ {
    proxy_pass http://backend:3000;
}
location = /health { proxy_pass http://backend:3000/health; }
'''
COMPOSE = '''services:
  backend:
    environment:
      DATABASE_URL: backend-unchanged
      REDIS_URL: backend-unchanged
  platform:
    environment:
      DATABASE_URL: ${DATABASE_URL:?required}
      JWT_ACCESS_SECRET: unchanged
    depends_on:
      mysql: {condition: service_healthy}
  nginx:
    volumes:
      - ./nginx/api.inc:/etc/nginx/api.inc:ro
'''
GUARD = 'if ($request_method !~ "^(GET|HEAD|OPTIONS)$") { return 503; }'


def digest(value):
    return hashlib.sha256(value).hexdigest()


class PureSafeguardTests(unittest.TestCase):
    def test_maintenance_guards_all_three_write_api_locations_without_touching_health(self):
        result = release.maintenance_api(API)
        self.assertEqual(result.count(GUARD), 3)
        self.assertEqual(result.replace('    ' + GUARD + '\n', ''), API)
        for marker in ['location ^~ /api/v1/platform/ {\n', 'location ^~ /api/v1/admin/ai/ {\n', 'location /api/v1/ {\n']:
            self.assertIn(marker + '    ' + GUARD, result)

    def test_maintenance_rejects_missing_duplicate_or_unexpected_location_layout(self):
        for marker in ['location ^~ /api/v1/platform/ {\n', 'location ^~ /api/v1/admin/ai/ {\n', 'location /api/v1/ {\n']:
            for text in [API.replace(marker, ''), API + marker + '}\n']:
                with self.subTest(marker=marker, duplicate=text.count(marker) > 1):
                    with self.assertRaises(ValueError):
                        release.maintenance_api(text)

    def test_redis_mapping_changes_only_platform_and_is_repeatable(self):
        result = release.control_redis_compose(COMPOSE)
        self.assertEqual(result.split('  platform:\n')[0], COMPOSE.split('  platform:\n')[0])
        self.assertEqual(result.split('  nginx:\n')[1], COMPOSE.split('  nginx:\n')[1])
        platform = result.split('  platform:\n')[1].split('  nginx:\n')[0]
        self.assertEqual(platform.count('      REDIS_URL: ${REDIS_URL:?required}\n'), 1)
        self.assertEqual(platform.count('      redis: {condition: service_healthy}\n'), 1)
        self.assertEqual(release.control_redis_compose(result), result)

    def test_redis_mapping_rejects_wrong_mapping_and_ambiguous_dependencies(self):
        variants = [
            COMPOSE.replace('  platform:\n', '  unsupported:\n'),
            COMPOSE.replace('      DATABASE_URL: ${DATABASE_URL:?required}\n', ''),
            COMPOSE.replace('      JWT_ACCESS_SECRET:', '      REDIS_URL: wrong-endpoint\n      JWT_ACCESS_SECRET:'),
            COMPOSE.replace('    depends_on:\n', '    unsupported_dependencies:\n'),
            COMPOSE.replace('      DATABASE_URL: ${DATABASE_URL:?required}\n', '      DATABASE_URL: ${DATABASE_URL:?required}\n' * 2),
        ]
        for text in variants:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    release.control_redis_compose(text)

    def artifact(self, directory):
        root = Path(directory)
        site = root / 'site'
        (site / 'assets').mkdir(parents=True)
        (site / 'platform.html').write_bytes(b'<html>control</html>')
        (site / 'assets/control.js').write_bytes(b'new control script')
        data = {'release': release.TARGET, 'files': [{'path': name, 'sha256': value} for name, value in release.tree(site).items()]}
        return site, root / 'manifest.json', data

    def validate(self, site, manifest, data):
        manifest.write_text(json.dumps(data), encoding='utf-8')
        return release.validate_control_assets(site, manifest, release.sha(manifest))

    def test_control_manifest_accepts_platform_html_instead_of_index_html(self):
        with tempfile.TemporaryDirectory() as directory:
            site, manifest, data = self.artifact(directory)
            self.assertEqual(self.validate(site, manifest, data), data)

    def test_control_manifest_rejects_changed_bytes_unlisted_members_or_wrong_release(self):
        with tempfile.TemporaryDirectory() as directory:
            site, manifest, data = self.artifact(directory)
            for mutate in ['content', 'unlisted', 'wrong-release', 'index-entry']:
                with self.subTest(mutate=mutate):
                    candidate = copy.deepcopy(data)
                    if mutate == 'content':
                        candidate['files'][0]['sha256'] = '0' * 64
                    elif mutate == 'unlisted':
                        (site / 'unlisted-secret.txt').write_text('test fixture only')
                    elif mutate == 'wrong-release':
                        candidate['release'] = release.SOURCE
                    else:
                        candidate['files'] = [{'path': 'index.html', 'sha256': digest(b'index')}]
                    with self.assertRaises(ValueError):
                        self.validate(site, manifest, candidate)
                    (site / 'unlisted-secret.txt').unlink(missing_ok=True)
            self.validate(site, manifest, data)
            with self.assertRaises(ValueError):
                release.validate_control_assets(site, manifest, '0' * 64)

    def test_control_manifest_rejects_duplicate_paths_and_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            site, manifest, data = self.artifact(directory)
            paths = ['', '../escape', 'assets/../../escape', '/absolute', 'assets\\escape.js', 'platform.html']
            for name in paths:
                with self.subTest(name=name):
                    candidate = copy.deepcopy(data)
                    candidate['files'].append({'path': name, 'sha256': '0' * 64})
                    with self.assertRaises(ValueError):
                        self.validate(site, manifest, candidate)

    def test_control_tree_rejects_symlink_members_and_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site, manifest, data = self.artifact(directory)
            try:
                (site / 'linked.js').symlink_to(site / 'assets/control.js')
                (root / 'linked-site').symlink_to(site, target_is_directory=True)
            except OSError:
                self.skipTest('This host does not allow local symbolic links')
            with self.assertRaises(ValueError):
                self.validate(site, manifest, data)
            with self.assertRaises(ValueError):
                release.tree(root / 'linked-site')

    def test_https_checks_platform_html_under_control_prefix_and_rejects_binary_mismatch(self):
        payload = b'\x89PNG\x00\xfffixture'
        manifest = {'platform': {'files': [{'path': 'platform.html', 'sha256': digest(payload)}]}}
        response = types.SimpleNamespace(stdout=payload)
        with patch('subprocess.run', return_value=response) as run:
            release.verify_https(None, manifest)
            self.assertIn('https://admin.weiduoxian.cn/platform-control/platform.html', run.call_args.args[0])
            run.return_value = types.SimpleNamespace(stdout=b'changed')
            with self.assertRaises(ValueError):
                release.verify_https(None, manifest)

    def test_bound_file_write_preserves_a_simulated_file_bind_and_rejects_stale_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            file, mounted = Path(directory) / 'api.inc', Path(directory) / 'mounted.inc'
            file.write_bytes(API.encode('utf-8')); os.link(file, mounted)
            original_inode = file.stat().st_ino
            guarded = release.maintenance_api(API)
            release.write_bound_config(file, guarded, digest(API.encode()))
            self.assertEqual(file.stat().st_ino, original_inode)
            self.assertEqual(mounted.read_bytes(), guarded.encode())
            with self.assertRaises(ValueError):
                release.write_bound_config(file, API, digest(API.encode()))
            self.assertEqual(mounted.read_bytes(), guarded.encode())

    def test_write_probe_requires_503_on_each_of_three_paths_and_retries_boundedly(self):
        for failed in ['', 'admin/ai/', 'platform/']:
            with self.subTest(failed=failed):
                calls = []
                def command(arguments):
                    calls.append(arguments[-1])
                    failed_url = 'https://admin.weiduoxian.cn/api/v1/' + failed + '__qa_maintenance_probe__'
                    return '404' if arguments[-1] == failed_url else '503'
                with patch.object(release.time, 'sleep'):
                    with self.assertRaises(ValueError):
                        release.verify_write_gate(types.SimpleNamespace(command=command))
                self.assertEqual(calls.count('https://admin.weiduoxian.cn/api/v1/' + failed + '__qa_maintenance_probe__'), 3)


class ControlledDeployment:
    """All commands terminate in this fake. File writes are restricted to one temp root."""
    backend_id = 'sha256:' + 'a' * 64
    control_id = 'sha256:' + 'b' * 64
    source_id = 'sha256:' + 'c' * 64

    def __init__(self, root, failure=None, recovery=False):
        self.root, self.failure = Path(root), failure
        self.recovery = recovery
        self.events, self.worker = [], None
        self.applied_migrations = 24 if recovery else 20
        self.active_gate = False
        self.original_env = f'RELEASE_TAG={release.SOURCE}\nPLATFORM_CONTROL_TAG={release.OLD_CONTROL}\nDATABASE_URL=placeholder-only\n'
        self.schema_original = [{'migration_name': f'20200101_{index:02}', 'checksum': '0' * 64} for index in range(20)]
        self.schema_after = self.schema_original + [{'migration_name': name, 'checksum': '1' * 64} for name in release.ADDITIONS]
        self.schema_before = copy.deepcopy(self.schema_after if recovery else self.schema_original)
        self.source_image_schema = copy.deepcopy(self.schema_original)
        self.snapshot = {'models': {'original': {'count': 1, 'hash': 'stable'}}, 'environmentHash': 'stable'}
        self.added_rows = {'legalConsent': [{'id': 1, 'version': 'saved-version', 'acceptedAt': '2026-10-24'}],
                           'serviceRequest': [{'id': 'fixture-request', 'version': 2, 'resolution': 'accepted customer progress'}],
                           'leadSubmission': [{'id': 'fixture-submission', 'payload': {'preserve': 'every field'}}],
                           'leadNewFields': [{'id': 42, 'tenantId': 1, 'customerId': 8, 'submissionKey': 'saved-key', 'submissionDigest': 'saved-digest'}]}
        self.state = self.root / 'platform'
        self.folder, self.source_folder = self.root / 'releases' / release.TARGET, self.root / 'releases' / release.SOURCE
        for relative in ['platform/queue', 'platform/operations', 'platform/logs', 'platform/control', 'nginx', '.release-backups']:
            (self.root / relative).mkdir(parents=True)
        self.folder.mkdir(parents=True); self.source_folder.mkdir(parents=True)
        (self.root / '.env').write_text(self.original_env)
        (self.root / 'compose.yml').write_text(COMPOSE)
        self.api_file = self.root / 'nginx/api.inc'
        # Production is Linux; preserve LF bytes even when these tests run on Windows.
        self.api_file.write_bytes(API.encode('utf-8'))
        # A hard link models the original inode seen by a single-file bind mount.
        self.mounted_api = self.root / 'mounted-api.inc'
        os.link(self.api_file, self.mounted_api)
        self.worker_file = self.state / 'control/platform-worker.py'
        self.worker_file.write_text('fixed worker fixture')
        self.catalog = {'releases': [{'id': release.SOURCE, 'ready': not recovery, 'version': 'old', 'sequence': 1,
                                     'schema': self.schema_original, 'imageId': self.source_id}]}
        (self.state / 'current.json').write_text(json.dumps({'id': release.SOURCE}))
        (self.state / 'catalog.json').write_text(json.dumps(self.catalog))
        self.manifest_hashes = {}
        for name in ['admin', 'customer', 'official', 'platform']:
            entry = 'platform.html' if name == 'platform' else 'index.html'
            for base, content in [(self.root, 'old'), (self.source_folder, 'old'), (self.folder, 'new')]:
                directory = base / 'sites' / name
                (directory / 'assets').mkdir(parents=True)
                (directory / entry).write_text(content + '-' + name)
                (directory / 'assets' / (content + '.js')).write_text(content + ' code')
            manifest = {'release': release.TARGET, 'files': [{'path': key, 'sha256': value} for key, value in release.tree(self.folder / 'sites' / name).items()]}
            file = self.folder / (name + '-manifest.json')
            file.write_text(json.dumps(manifest)); self.manifest_hashes[name] = release.sha(file)
        source_manifest = self.source_folder / 'admin-manifest.json'
        source_manifest.write_text(json.dumps({'release': release.SOURCE, 'files': [{'path': key, 'sha256': value} for key, value in release.tree(self.source_folder / 'sites/admin').items()]}))
        self.catalog['releases'][0]['manifestSha256'] = release.sha(source_manifest)
        (self.state / 'catalog.json').write_text(json.dumps(self.catalog))
        (self.folder / 'release-info.json').write_text(json.dumps({'id': release.TARGET, 'version': 'new', 'sequence': 2}))
        (self.folder / 'launch-plan.json').write_text(json.dumps({'release': release.TARGET, 'source': release.SOURCE, 'control': release.CONTROL,
            'oldControl': release.OLD_CONTROL, 'controlUiIncluded': True, 'workerSha256': release.sha(self.worker_file),
            'migrations': self.schema_after, 'siteManifestSha256': self.manifest_hashes,
            **({'recoveryOf': release.FAILED_OPERATION} if recovery else {})}))
        if recovery:
            self.operation_file = self.state / 'operations' / (release.FAILED_OPERATION + '.json')
            self.operation_file.write_text(json.dumps({'id': release.FAILED_OPERATION, 'status': 'failed', 'phase': 'finished', 'type': 'update', 'source': release.SOURCE, 'target': release.FAILED_TARGET}))

    def inside(self, file):
        path = Path(file).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise AssertionError('Controlled test attempted a non-temporary path')
        return Path(file)

    def write(self, file, value, mode=0o644):
        file = self.inside(file)
        self.events.append(('write', file.relative_to(self.root).as_posix()))
        temporary = file.with_name(file.name + '.fake-tmp')
        temporary.write_text(value, encoding='utf-8'); os.chmod(temporary, mode); os.replace(temporary, file)

    def atomic_json(self, file, data):
        self.write(file, json.dumps(data))

    def validator(self, directory, manifest, expected_hash, identity):
        if identity not in [release.TARGET, release.SOURCE] or release.sha(manifest) != expected_hash:
            raise ValueError('Fake manifest identity or hash mismatch')
        data = json.loads(manifest.read_text())
        if data['release'] != identity or any(release.sha(directory / item['path']) != item['sha256'] for item in data['files']):
            raise ValueError('Fake artifact bytes mismatch')
        return data

    def added_summary(self):
        return {name: {'count': len(rows), 'hash': digest(json.dumps(rows, sort_keys=True).encode())} for name, rows in self.added_rows.items()}

    def load(self, name, file):
        self.inside(file)
        if name == 'closeout_existing_worker':
            return types.SimpleNamespace(Worker=lambda root: self.make_worker(root), validate_assets=self.validator, atomic_json=self.atomic_json)
        if name == 'closeout_installer_helpers':
            return types.SimpleNamespace(write=self.write, image_schema=lambda identity: self.source_image_schema if identity == release.SOURCE else self.schema_after)
        raise AssertionError('Unexpected executable module requested')

    def sync(self, arguments):
        source, destination = self.inside(arguments[-2]), self.inside(arguments[-1])
        excluded = [arg.split('=', 1)[1] for arg in arguments if arg.startswith('--exclude=')]
        for file in source.rglob('*'):
            if file.is_file() and file.name not in excluded:
                target = destination / file.relative_to(source)
                target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(file, target)

    def make_worker(self, root):
        if Path(root) != self.root:
            raise AssertionError('Unexpected worker root')
        scenario = self

        class FakeWorker:
            def __init__(self):
                self.state, self.queue = scenario.state, scenario.state / 'queue'
                self.job, self.log_file = None, None

            def command(self, arguments, **_kwargs):
                scenario.events.append(('command', tuple(arguments)))
                if arguments[:3] == ['docker', 'image', 'inspect']:
                    if arguments[3] == 'weiduoxian-backend:' + release.SOURCE:
                        return 'sha256:' + 'd' * 64 if scenario.failure == 'source_image' else scenario.source_id
                    return scenario.control_id if arguments[3].endswith(release.CONTROL) else scenario.backend_id
                if arguments[0] == 'rsync':
                    scenario.sync(arguments); return ''
                if arguments[0] == 'install':
                    source, destination = scenario.inside(arguments[-2]), scenario.inside(arguments[-1])
                    shutil.copy2(source, destination); return ''
                if arguments[0] == 'curl':
                    if not arguments[-1].startswith('https://admin.weiduoxian.cn/api/v1/'):
                        raise AssertionError('Unexpected maintenance probe URL')
                    scenario.events.append(('write_probe', arguments[-1]))
                    return '503' if scenario.active_gate and scenario.failure != 'write_probe' else '404'
                raise AssertionError('Unrecognized command; real execution is forbidden')

            def control(self, mode, value=None):
                scenario.events.append(('control', mode))
                if mode == 'schema':
                    return scenario.schema_before if scenario.applied_migrations == (24 if scenario.recovery else 20) else scenario.schema_after[:scenario.applied_migrations]
                if mode == 'authorize':
                    return {'allowed': True}
                if mode == 'audit':
                    if scenario.failure == 'final_audit' and value.get('status') == 'succeeded':
                        raise RuntimeError('Synthetic final audit failure')
                    return {'ok': True}
                raise AssertionError('Unexpected control command')

            def backup(self):
                scenario.events.append(('backup',))
                if scenario.failure == 'foreign_lock_during_backup':
                    (self.queue / 'active.lock').write_text(json.dumps({'id': 'different-operation'}))
                return '20261024T000000Z.tar.gz'

            def verify_release(self, _source):
                scenario.events.append(('verify_source',))
                if _source['schema'] != scenario.schema_before:
                    raise ValueError('Fixed worker refuses schema-incompatible source')
                return scenario.source_folder, {'files': []}

            def status(self, phase, message, status='running', **extra):
                if status == 'succeeded' and scenario.failure == 'final_status' and not getattr(scenario, 'status_failed', False):
                    scenario.status_failed = True
                    raise RuntimeError('Synthetic result status persistence failure')
                self.job.update(phase=phase, message=message, status=status, **extra)
                scenario.events.append(('status', status, phase))
                scenario.atomic_json(self.state / 'operations' / (self.job['id'] + '.json'), self.job)
                if status == 'succeeded' and scenario.failure == 'foreign_lock_at_finish':
                    (self.queue / 'active.lock').write_text(json.dumps({'id': 'different-operation'}))

            def compose(self, *arguments, input_text=None):
                scenario.events.append(('compose', arguments))
                if input_text == release.ACTOR:
                    return json.dumps({'actorId': 7, 'tenantId': 1, 'fingerprint': 'fixed-fingerprint'})
                if input_text == release.SNAPSHOT:
                    return json.dumps(scenario.snapshot)
                if input_text == release.ADDED_EMPTY:
                    if scenario.recovery:
                        raise AssertionError('Accepted additive data must never be required empty during repair')
                    return json.dumps({'legalConsent': 0, 'serviceRequest': 0, 'leadSubmission': 0, 'changedHistoricalLead': 0})
                if input_text == release.ADDED_SNAPSHOT:
                    scenario.events.append(('added_snapshot',))
                    return json.dumps(scenario.added_summary())
                if 'migrate' in arguments:
                    scenario.events.append(('migration',))
                    scenario.applied_migrations = 24
                    if scenario.failure == 'migration':
                        scenario.applied_migrations = 23
                        raise RuntimeError('Synthetic additive migration failure')
                    return ''
                if arguments == ('stop', 'backend'):
                    if not scenario.active_gate:
                        raise AssertionError('Backend stopped before the mounted write gate was active')
                    if scenario.failure == 'stop':
                        raise RuntimeError('Synthetic stop error after the backend already stopped')
                    return ''
                if arguments[-2:] == ('nginx', '-t'):
                    if scenario.failure == 'nginx_validation' and not getattr(scenario, 'nginx_failed', False):
                        scenario.nginx_failed = True
                        raise RuntimeError('Synthetic nginx validation failure')
                    return ''
                if arguments[-3:] == ('nginx', '-s', 'reload'):
                    scenario.active_gate = GUARD in scenario.mounted_api.read_text()
                    scenario.events.append(('gate', scenario.active_gate))
                    return ''
                # Container-level SHA/cat assertions are read only; support them without executing a process.
                if 'sha256sum' in arguments:
                    return digest(scenario.mounted_api.read_bytes()) + '  /etc/nginx/api.inc'
                if 'cat' in arguments and '/etc/nginx/api.inc' in arguments:
                    return scenario.mounted_api.read_text()
                if arguments == ('config', '--quiet') or arguments == ('up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'platform'):
                    return ''
                raise AssertionError('Unrecognized compose operation; real execution is forbidden')

            def apply(self, target, folder, _manifest):
                identity = target['id']
                scenario.events.append(('apply', identity))
                if not scenario.active_gate:
                    raise AssertionError('Application changed while API writes were open')
                scenario.sync(['rsync', str(folder / 'sites/admin'), str(scenario.root / 'sites/admin')])
                if scenario.failure == 'apply' and identity == release.TARGET:
                    raise RuntimeError('Synthetic target health failure')
                if scenario.failure == 'additive_changed' and identity == release.TARGET:
                    scenario.added_rows['serviceRequest'][0]['resolution'] = 'Unexpected concurrent change'

        self.worker = FakeWorker()
        return self.worker

    def verify_https(self, _worker, _manifests):
        self.events.append(('https_verified',))
        if not self.active_gate:
            raise AssertionError('HTTPS verification occurred after reopening API writes')
        if self.failure == 'https':
            raise RuntimeError('Synthetic HTTPS failure')

    def run(self, preflight=False):
        # Every external boundary is replaced or blocked. Never spawn Docker/curl/subprocess here.
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(release, 'ROOT', self.root))
            stack.enter_context(patch.object(release, 'load', side_effect=self.load))
            stack.enter_context(patch.object(release, 'verify_https', side_effect=self.verify_https))
            stack.enter_context(patch.object(release.os, 'geteuid', return_value=0, create=True))
            stack.enter_context(patch('subprocess.run', side_effect=AssertionError('Real process execution forbidden')))
            stack.enter_context(patch.object(release.time, 'sleep'))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            return release.deploy(self.backend_id, self.control_id, preflight=preflight)


class ControlledDeploymentTests(unittest.TestCase):
    def scenario(self, failure=None, recovery=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        return ControlledDeployment(temporary.name, failure, recovery)

    def assert_restored(self, scenario):
        self.assertEqual((scenario.root / '.env').read_text(), scenario.original_env)
        self.assertEqual((scenario.root / 'compose.yml').read_text(), COMPOSE)
        self.assertEqual(scenario.api_file.read_text(), API)
        self.assertEqual(scenario.mounted_api.read_text(), API)
        self.assertFalse((scenario.state / 'queue/active.lock').exists())
        self.assertEqual(json.loads((scenario.state / 'current.json').read_text())['id'], release.SOURCE)

    def test_preflight_checks_only_and_never_installs_a_gate_or_runs_backup(self):
        scenario = self.scenario()
        scenario.run(preflight=True)
        self.assert_restored(scenario)
        self.assertNotIn(('backup',), scenario.events)
        self.assertFalse(any(event[0] in ['apply', 'migration', 'gate'] for event in scenario.events))

    def test_success_keeps_mounted_inode_and_gates_until_validation_then_restores_api(self):
        scenario = self.scenario()
        original_inode = scenario.api_file.stat().st_ino
        scenario.run()
        self.assertEqual(scenario.api_file.stat().st_ino, original_inode)
        self.assertEqual(scenario.api_file.read_text(), API)
        self.assertEqual(scenario.mounted_api.read_text(), API)
        self.assertFalse(scenario.active_gate)
        self.assertFalse((scenario.state / 'queue/active.lock').exists())
        events = scenario.events
        self.assertLess(events.index(('backup',)), events.index(('gate', True)))
        self.assertLess(events.index(('gate', True)), events.index(('migration',)))
        self.assertLess(events.index(('https_verified',)), events.index(('gate', False)))
        self.assertEqual(json.loads((scenario.state / 'current.json').read_text())['id'], release.TARGET)
        self.assertEqual(scenario.worker.job['status'], 'succeeded')
        self.assertEqual(scenario.applied_migrations, 24)
        self.assertTrue((scenario.root / 'sites/platform/assets/old.js').exists())
        self.assertEqual((scenario.root / 'sites/platform/platform.html').read_text(), 'new-platform')

    def test_failed_nginx_gate_validation_never_stops_backend_and_restores_owned_lock(self):
        scenario = self.scenario('nginx_validation')
        with self.assertRaises(RuntimeError):
            scenario.run()
        self.assert_restored(scenario)
        self.assertNotIn(('compose', ('stop', 'backend')), scenario.events)
        self.assertFalse(any(event[0] == 'apply' for event in scenario.events))

    def test_failed_external_write_probe_restores_api_without_switching_apps(self):
        scenario = self.scenario('write_probe')
        with self.assertRaises(ValueError):
            scenario.run()
        self.assert_restored(scenario)
        self.assertNotIn(('compose', ('stop', 'backend')), scenario.events)
        self.assertFalse(any(event[0] == 'apply' for event in scenario.events))

    def test_migration_failure_restores_apps_under_the_gate_without_restoring_database(self):
        scenario = self.scenario('migration')
        with self.assertRaises(RuntimeError):
            scenario.run()
        self.assert_restored(scenario)
        self.assertEqual(scenario.applied_migrations, 23)
        self.assertIn(('apply', release.SOURCE), scenario.events)
        self.assertTrue(all(not item.get('ready') for item in json.loads((scenario.state / 'catalog.json').read_text())['releases']))
        self.assertLess(scenario.events.index(('apply', release.SOURCE)), scenario.events.index(('gate', False)))

    def test_stop_failure_still_recovers_source_before_reopening_api_writes(self):
        scenario = self.scenario('stop')
        with self.assertRaises(RuntimeError):
            scenario.run()
        self.assert_restored(scenario)
        self.assertIn(('apply', release.SOURCE), scenario.events)
        self.assertLess(scenario.events.index(('apply', release.SOURCE)), scenario.events.index(('gate', False)))
        self.assertEqual(scenario.applied_migrations, 20)

    def test_target_or_https_failure_restores_all_site_entries_and_preserves_added_schema(self):
        for failure in ['apply', 'https']:
            with self.subTest(failure=failure):
                scenario = self.scenario(failure)
                with self.assertRaises(RuntimeError):
                    scenario.run()
                self.assert_restored(scenario)
                self.assertEqual(scenario.applied_migrations, 24)
                for site in ['admin', 'customer', 'official', 'platform']:
                    entry = 'platform.html' if site == 'platform' else 'index.html'
                    self.assertEqual((scenario.root / 'sites' / site / entry).read_text(), 'old-' + site)
                serialized = repr(scenario.events)
                self.assertNotIn('migrate reset', serialized)
                self.assertNotIn('mysql restore', serialized)

    def test_foreign_active_lock_created_during_backup_is_preserved_without_switching(self):
        scenario = self.scenario('foreign_lock_during_backup')
        with self.assertRaises(FileExistsError):
            scenario.run()
        self.assertEqual(json.loads((scenario.state / 'queue/active.lock').read_text())['id'], 'different-operation')
        self.assertEqual(scenario.api_file.read_text(), API)
        self.assertFalse(any(event[0] in ['apply', 'migration', 'gate'] for event in scenario.events))

    def test_foreign_lock_is_not_removed_by_this_operation_finally(self):
        scenario = self.scenario('foreign_lock_at_finish')
        scenario.run()
        self.assertEqual(json.loads((scenario.state / 'queue/active.lock').read_text())['id'], 'different-operation')

    def test_audit_failure_after_opening_traffic_does_not_roll_back_an_accepted_release(self):
        scenario = self.scenario('final_audit')
        scenario.run()
        self.assertEqual(json.loads((scenario.state / 'current.json').read_text())['id'], release.TARGET)
        self.assertEqual(scenario.worker.job['status'], 'succeeded')
        record = json.loads((scenario.state / 'operations' / (scenario.worker.job['id'] + '.json')).read_text())
        self.assertTrue(record.get('auditPending'))
        self.assertNotIn(('apply', release.SOURCE), scenario.events)
        self.assertEqual(scenario.api_file.read_text(), API)
        self.assertFalse((scenario.state / 'queue/active.lock').exists())

    def test_status_write_failure_after_opening_traffic_does_not_roll_back_accepted_release(self):
        scenario = self.scenario('final_status')
        try:
            scenario.run()
        except RuntimeError:
            # Reporting failure is acceptable; reverting an application accepting writes is not.
            pass
        self.assertEqual(json.loads((scenario.state / 'current.json').read_text())['id'], release.TARGET)
        self.assertNotIn(('apply', release.SOURCE), scenario.events)
        self.assertEqual(scenario.api_file.read_text(), API)
        self.assertFalse((scenario.state / 'queue/active.lock').exists())

    def test_exact_failed_24_to_24_recovery_preserves_nonempty_additive_rows_without_migrating(self):
        scenario = self.scenario(recovery=True)
        accepted = copy.deepcopy(scenario.added_rows)
        summary = scenario.added_summary()
        scenario.run()
        self.assertEqual(scenario.applied_migrations, 24)
        self.assertNotIn(('migration',), scenario.events)
        self.assertNotIn(('verify_source',), scenario.events)
        self.assertEqual(scenario.added_rows, accepted)
        self.assertEqual(scenario.events.count(('added_snapshot',)), 2)
        verification = json.loads((scenario.root / '.release-backups' / (release.TARGET + '-schema-boundary') / 'verification.json').read_text())
        self.assertEqual(verification['recoveryOf'], release.FAILED_OPERATION)
        self.assertEqual(verification['addedDataBefore'], summary)
        self.assertEqual(verification['addedDataAfter'], summary)
        self.assertIsNone(verification['newTableCountsAtMigration'])
        self.assertTrue(all(item['count'] > 0 for item in summary.values()))
        catalog = json.loads((scenario.state / 'catalog.json').read_text())['releases']
        self.assertFalse(next(item for item in catalog if item['id'] == release.SOURCE)['ready'])
        self.assertTrue(next(item for item in catalog if item['id'] == release.TARGET)['ready'])
        self.assertEqual(scenario.api_file.read_text(), API)
        self.assertFalse((scenario.state / 'queue/active.lock').exists())

    def test_recovery_preflight_is_read_only_and_does_not_require_empty_accepted_tables(self):
        scenario = self.scenario(recovery=True)
        accepted = copy.deepcopy(scenario.added_rows)
        scenario.run(preflight=True)
        self.assert_restored(scenario)
        self.assertEqual(scenario.added_rows, accepted)
        self.assertFalse(any(event[0] in ['backup', 'migration', 'apply', 'gate', 'added_snapshot'] for event in scenario.events))

    def test_24_recovery_rejects_missing_or_unreviewed_failed_operation_without_writing(self):
        for invalid in ['missing-file', 'no-plan-approval', 'unknown-plan-operation', 'wrong-id', 'not-failed', 'unfinished', 'wrong-type', 'wrong-source', 'wrong-target']:
            with self.subTest(invalid=invalid):
                scenario = self.scenario(recovery=True)
                operation = json.loads(scenario.operation_file.read_text())
                if invalid == 'missing-file':
                    scenario.operation_file.unlink()
                elif invalid in ['no-plan-approval', 'unknown-plan-operation']:
                    plan_file = scenario.folder / 'launch-plan.json'
                    plan = json.loads(plan_file.read_text()); plan.pop('recoveryOf')
                    if invalid == 'unknown-plan-operation':
                        plan['recoveryOf'] = 'unreviewed-operation'
                    plan_file.write_text(json.dumps(plan))
                else:
                    field, value = {'wrong-id': ('id', 'unknown'), 'not-failed': ('status', 'succeeded'), 'unfinished': ('phase', 'deploying'),
                                    'wrong-type': ('type', 'rollback'), 'wrong-source': ('source', release.FAILED_TARGET), 'wrong-target': ('target', release.TARGET)}[invalid]
                    operation[field] = value; scenario.operation_file.write_text(json.dumps(operation))
                with self.assertRaises(ValueError):
                    scenario.run()
                self.assertNotIn(('backup',), scenario.events)
                self.assertFalse(any(event[0] in ['write', 'apply', 'migration', 'gate'] for event in scenario.events))

    def test_recovery_rejects_unknown_database_schema_or_migration_checksum(self):
        for invalid in ['checksum', 'extra-migration', 'missing-migration']:
            with self.subTest(invalid=invalid):
                scenario = self.scenario(recovery=True)
                if invalid == 'checksum':
                    scenario.schema_before[-1]['checksum'] = '2' * 64
                elif invalid == 'extra-migration':
                    scenario.schema_before.append({'migration_name': 'unreviewed_extra', 'checksum': '2' * 64})
                else:
                    scenario.schema_before.pop()
                with self.assertRaises(ValueError):
                    scenario.run()
                self.assertNotIn(('backup',), scenario.events)
                self.assertEqual(scenario.added_rows['leadNewFields'][0]['submissionKey'], 'saved-key')

    def test_an_explicit_recovery_plan_cannot_silently_run_the_twenty_migration_path(self):
        scenario = self.scenario()
        plan_file = scenario.folder / 'launch-plan.json'
        plan = json.loads(plan_file.read_text()); plan['recoveryOf'] = release.FAILED_OPERATION
        plan_file.write_text(json.dumps(plan))
        with self.assertRaisesRegex(ValueError, 'already-applied exact 24'):
            scenario.run()
        self.assertNotIn(('backup',), scenario.events)
        self.assertNotIn(('migration',), scenario.events)

    def test_recovery_rejects_source_image_catalog_prefix_manifest_and_current_mismatch(self):
        for invalid in ['source-image-id', 'source-image-schema', 'source-catalog-schema', 'source-manifest', 'source-asset', 'current-release']:
            with self.subTest(invalid=invalid):
                scenario = self.scenario('source_image' if invalid == 'source-image-id' else None, recovery=True)
                if invalid == 'source-image-schema':
                    scenario.source_image_schema[0]['checksum'] = '2' * 64
                elif invalid == 'source-catalog-schema':
                    catalog_file = scenario.state / 'catalog.json'
                    catalog = json.loads(catalog_file.read_text()); catalog['releases'][0]['schema'][0]['checksum'] = '2' * 64
                    catalog_file.write_text(json.dumps(catalog))
                elif invalid == 'source-manifest':
                    (scenario.source_folder / 'admin-manifest.json').write_text('{}')
                elif invalid == 'source-asset':
                    (scenario.source_folder / 'sites/admin/index.html').write_text('unexpected source bytes')
                elif invalid == 'current-release':
                    (scenario.state / 'current.json').write_text(json.dumps({'id': release.FAILED_TARGET}))
                with self.assertRaises(ValueError):
                    scenario.run()
                self.assertNotIn(('backup',), scenario.events)

    def test_failed_recovery_restores_old_apps_and_keeps_all_24_migrations_and_accepted_data(self):
        for failure in ['stop', 'apply', 'https']:
            with self.subTest(failure=failure):
                scenario = self.scenario(failure, recovery=True)
                accepted = copy.deepcopy(scenario.added_rows)
                with self.assertRaises(RuntimeError):
                    scenario.run()
                self.assert_restored(scenario)
                self.assertEqual(scenario.applied_migrations, 24)
                self.assertEqual(scenario.added_rows, accepted)
                self.assertNotIn(('migration',), scenario.events)
                self.assertIn(('apply', release.SOURCE), scenario.events)
                self.assertTrue(all(not item['ready'] for item in json.loads((scenario.state / 'catalog.json').read_text())['releases']))

    def test_recovery_detects_changed_additive_field_without_erasing_or_restoring_that_data(self):
        scenario = self.scenario('additive_changed', recovery=True)
        with self.assertRaisesRegex(ValueError, 'Accepted additive rows changed'):
            scenario.run()
        self.assert_restored(scenario)
        self.assertEqual(scenario.added_rows['serviceRequest'][0]['resolution'], 'Unexpected concurrent change')
        self.assertEqual(scenario.added_rows['leadNewFields'][0]['submissionKey'], 'saved-key')
        self.assertNotIn(('migration',), scenario.events)

    def test_recovery_final_audit_failure_cannot_roll_back_an_open_validated_application(self):
        scenario = self.scenario('final_audit', recovery=True)
        accepted = copy.deepcopy(scenario.added_rows)
        scenario.run()
        self.assertEqual(scenario.worker.job['status'], 'succeeded')
        self.assertTrue(scenario.worker.job['auditPending'])
        self.assertEqual(scenario.added_rows, accepted)
        self.assertNotIn(('apply', release.SOURCE), scenario.events)
        self.assertNotIn(('migration',), scenario.events)


if __name__ == '__main__':
    unittest.main()
