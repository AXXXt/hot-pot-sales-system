"""Root-owned host worker. Only signed requests for pre-verified, local releases are executable."""
import base64
import hashlib
import hmac
import json
import os
import re
import stat
import subprocess
import time
from pathlib import Path

ID = re.compile(r"^ai-\d{8}-\d+$")
UUID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", re.I)
TERMINAL = {"succeeded", "failed", "rolled_back"}


def validate_request(envelope, secret, catalog_bytes, current, now_ms):
    if set(envelope) != {"payload", "signature"}:
        raise ValueError("Invalid envelope")
    payload = envelope["payload"]
    if not isinstance(payload, str) or len(payload) > 10000:
        raise ValueError("Invalid payload")
    expected = hmac.new(secret, ("platform-job\n" + payload).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, str(envelope["signature"])):
        raise ValueError("Invalid signature")
    job = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    keys = {"id", "type", "source", "target", "actorId", "tenantId", "fingerprint", "catalogDigest", "createdAt", "expiresAt", "status", "phase", "message"}
    if set(job) != keys or not UUID.fullmatch(job["id"]) or job["type"] not in {"update", "rollback"}:
        raise ValueError("Invalid operation")
    if any(not isinstance(job[k], str) or not ID.fullmatch(job[k]) for k in ("source", "target")):
        raise ValueError("Invalid release")
    if any(type(job[k]) is not int or job[k] <= 0 for k in ("actorId", "tenantId", "createdAt", "expiresAt")):
        raise ValueError("Invalid identity or timestamp")
    if job["expiresAt"] <= now_ms or job["createdAt"] > now_ms + 30000 or job["expiresAt"] - job["createdAt"] > 300000:
        raise ValueError("Expired operation")
    if job["catalogDigest"] != hashlib.sha256(catalog_bytes).hexdigest() or job["source"] != current["id"]:
        raise ValueError("Stale release confirmation")
    catalog = json.loads(catalog_bytes)
    releases = {r["id"]: r for r in catalog["releases"]}
    source, target = releases[job["source"]], releases[job["target"]]
    if not source.get("ready") or not target.get("ready") or source["id"] == target["id"]:
        raise ValueError("Release unavailable")
    if (job["type"] == "update") != (target["sequence"] > source["sequence"]):
        raise ValueError("Invalid operation direction")
    return job, source, target


def validate_assets(directory, manifest, expected_manifest_hash, release_id):
    if not ID.fullmatch(release_id) or manifest.is_symlink():
        raise ValueError("Invalid artifact")
    content = manifest.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected_manifest_hash:
        raise ValueError("Manifest changed")
    data = json.loads(content)
    if data["release"] != release_id or not data["files"] or not any(item["path"] == "index.html" for item in data["files"]):
        raise ValueError("Manifest release mismatch")
    base = directory.resolve(strict=True)
    for item in data["files"]:
        relative = Path(item["path"])
        if relative.is_absolute() or ".." in relative.parts or "\\" in item["path"]:
            raise ValueError("Artifact path rejected")
        file = directory / relative
        if file.is_symlink() or not file.resolve(strict=True).is_relative_to(base):
            raise ValueError("Artifact symlink rejected")
        if hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Artifact checksum mismatch")
    return data


def atomic_json(file, value):
    temporary = file.with_name(file.name + ".tmp")
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o644)
    os.replace(temporary, file)


class Worker:
    def __init__(self, root=Path("/opt/weiduoxian")):
        self.root = root.resolve()
        self.state = self.root / "platform"
        self.queue = self.state / "queue"
        self.job = None
        self.log_file = None

    def command(self, arguments, input_text=None, timeout=180):
        result = subprocess.run(arguments, cwd=self.root, input=input_text, text=True, capture_output=True, timeout=timeout, check=False)
        if self.log_file:
            with open(self.log_file, "a", encoding="utf-8") as log:
                log.write(result.stdout + result.stderr)
            os.chmod(self.log_file, 0o600)
        if result.returncode:
            raise RuntimeError("Release command failed")
        return result.stdout.strip()

    def compose(self, *arguments, **kwargs):
        return self.command(["docker", "compose", *arguments], **kwargs)

    def control(self, mode, value=None):
        return json.loads(self.compose("exec", "-T", "platform", "node", "/app/platform-api.cjs", mode, input_text=json.dumps(value) if value else None))

    def status(self, phase, message, status="running", **extra):
        self.job.update({"phase": phase, "message": message, "status": status, "updatedAt": int(time.time() * 1000), **extra})
        atomic_json(self.state / "operations" / (self.job["id"] + ".json"), self.job)

    def verify_release(self, release):
        identity = release["id"]
        if not ID.fullmatch(identity):
            raise ValueError("Release ID rejected")
        folder = self.root / "releases" / identity
        if folder.is_symlink() or folder.resolve().parent != (self.root / "releases").resolve():
            raise ValueError("Release directory rejected")
        manifest = validate_assets(folder / "sites" / "admin", folder / "admin-manifest.json", release["manifestSha256"], identity)
        actual_image = self.command(["docker", "image", "inspect", "weiduoxian-backend:" + identity, "--format", "{{.Id}}"])
        if actual_image != release["imageId"]:
            raise ValueError("Image identity changed")
        actual_schema = self.control("schema")
        if sorted(actual_schema, key=lambda r: r["migration_name"]) != sorted(release["schema"], key=lambda r: r["migration_name"]):
            raise ValueError("Database schema is incompatible")
        return folder, manifest

    def apply(self, release, folder, manifest):
        env_file = self.root / ".env"
        text = env_file.read_text()
        updated, count = re.subn(r"^RELEASE_TAG=.*$", "RELEASE_TAG=" + release["id"], text, flags=re.M)
        if count != 1:
            raise ValueError("Release environment is ambiguous")
        temporary = self.root / ".env.platform-tmp"
        temporary.write_text(updated)
        os.chmod(temporary, 0o600)
        os.replace(temporary, env_file)
        self.compose("config", "--quiet")
        self.compose("up", "-d", "--no-deps", "--pull", "never", "--wait", "--wait-timeout", "120", "backend")
        self.compose("exec", "-T", "nginx", "nginx", "-t")
        self.compose("exec", "-T", "nginx", "nginx", "-s", "reload")
        self.command(["rsync", "-rp", "--delay-updates", "--chmod=D755,F644", "--exclude=index.html", str(folder / "sites" / "admin") + "/", str(self.root / "sites" / "admin") + "/"])
        entry = self.root / "sites" / "admin" / ".index-platform"
        self.command(["install", "-m", "644", str(folder / "sites" / "admin" / "index.html"), str(entry)])
        os.replace(entry, self.root / "sites" / "admin" / "index.html")
        self.command(["curl", "-fsS", "--max-time", "20", "--resolve", "admin.weiduoxian.cn:443:127.0.0.1", "https://admin.weiduoxian.cn/health"])
        for item in manifest["files"]:
            result = subprocess.run(["curl", "-fsS", "--max-time", "20", "--resolve", "admin.weiduoxian.cn:443:127.0.0.1", "https://admin.weiduoxian.cn/" + item["path"]], capture_output=True, check=True, timeout=25)
            if hashlib.sha256(result.stdout).hexdigest() != item["sha256"]:
                raise ValueError("Published asset verification failed")

    def backup(self):
        self.command(["systemctl", "start", "weiduoxian-backup.service"])
        result = self.command(["systemctl", "show", "weiduoxian-backup.service", "-p", "Result", "-p", "ExecMainStatus"])
        if "Result=success" not in result or "ExecMainStatus=0" not in result:
            raise RuntimeError("Backup failed")
        return max(Path("/var/backups/weiduoxian").glob("*.tar.gz"), key=lambda p: p.stat().st_mtime).name

    def process(self, file, recovering=False):
        if file.stat().st_size > 16384:
            raise ValueError("Oversized request")
        envelope = json.loads(file.read_text())
        env = {}
        for line in (self.root / ".env").read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                env[key] = value.strip().strip("\"'")
        secret = base64.b64decode(env["PLATFORM_COMMAND_KEY"], validate=True)
        catalog_file = self.state / "catalog.json"
        metadata = catalog_file.stat()
        if metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) & 0o022 or catalog_file.is_symlink():
            raise ValueError("Catalog must be root-owned and protected")
        current = json.loads((self.state / "current.json").read_text())
        # A running job is a previously verified, claimed request. Recover only from durable root state.
        if recovering:
            record = self.state / "operations" / (file.name.split(".")[0] + ".json")
            job = json.loads(record.read_text())
            if record.stat().st_uid != 0 or job["status"] in TERMINAL:
                self.release_lock(job["id"])
                file.unlink(missing_ok=True)
                return
            self.job = job
            catalog = json.loads(catalog_file.read_bytes())
            source = next(r for r in catalog["releases"] if r["id"] == job["source"])
            self.log_file = self.state / "logs" / (job["id"] + ".log")
            folder, manifest = self.verify_release(source)
            self.status("recovering", "发布任务中断，正在恢复原版本")
            self.apply(source, folder, manifest)
            atomic_json(self.state / "current.json", {"id": source["id"], "changedAt": int(time.time() * 1000)})
            self.status("finished", "已恢复中断前的版本", "rolled_back", finishedAt=int(time.time() * 1000))
            self.finish(file)
            return
        job, source, target = validate_request(envelope, secret, catalog_file.read_bytes(), current, int(time.time() * 1000))
        if file.name != job["id"] + ".request.json":
            raise ValueError("Request filename mismatch")
        self.job = job
        self.log_file = self.state / "logs" / (job["id"] + ".log")
        running = file.with_name(job["id"] + ".running.json")
        os.replace(file, running)
        self.status("validating", "正在核对权限、版本文件和数据库兼容性", startedAt=int(time.time() * 1000))
        changed = False
        try:
            if not self.control("authorize", job).get("allowed"):
                raise PermissionError("Operator access changed")
            source_folder, source_manifest = self.verify_release(source)
            target_folder, target_manifest = self.verify_release(target)
            self.status("backup", "正在备份当前业务数据和配置")
            latest = self.backup()
            if not self.control("authorize", job).get("allowed"):
                raise PermissionError("Operator access changed during backup")
            self.status("deploying", "备份完成，正在切换业务版本", backup=latest)
            changed = True
            self.apply(target, target_folder, target_manifest)
            atomic_json(self.state / "current.json", {"id": target["id"], "changedAt": int(time.time() * 1000), "operationId": job["id"]})
            self.status("finished", "版本切换完成，业务数据已保留", "succeeded", finishedAt=int(time.time() * 1000))
        except Exception:
            if changed:
                try:
                    self.status("recovering", "切换未通过验证，正在恢复原版本")
                    self.apply(source, source_folder, source_manifest)
                    atomic_json(self.state / "current.json", {"id": source["id"], "changedAt": int(time.time() * 1000)})
                    self.status("finished", "切换未通过验证，已自动恢复原版本", "rolled_back", finishedAt=int(time.time() * 1000))
                except Exception:
                    self.status("finished", "恢复未完成，请联系运维检查；版本管理入口仍可使用", "failed", finishedAt=int(time.time() * 1000))
            else:
                self.status("finished", "发布前检查未通过，原版本与业务数据未变更", "failed", finishedAt=int(time.time() * 1000))
        self.finish(running)

    def release_lock(self, identity):
        lock = self.queue / "active.lock"
        if lock.exists() and json.loads(lock.read_text()).get("id") == identity:
            lock.unlink()

    def finish(self, file):
        try:
            self.control("audit", self.job)
        except Exception:
            self.job["auditPending"] = True
            atomic_json(self.state / "operations" / (self.job["id"] + ".json"), self.job)
        self.release_lock(self.job["id"])
        file.unlink(missing_ok=True)

    def run(self):
        for file in sorted(self.queue.glob("*.running.json")):
            identity = file.name.split(".")[0]
            if not UUID.fullmatch(identity) or not (self.state / "operations" / (identity + ".json")).is_file():
                file.unlink(missing_ok=True)
                continue
            self.process(file, recovering=True)
        for file in sorted(self.queue.glob("*.request.json")):
            try:
                self.process(file)
            except Exception:
                identity = file.name.split(".")[0]
                # Untrusted or stale requests never reach any deployment command.
                if UUID.fullmatch(identity):
                    record = self.state / "operations" / (identity + ".json")
                    if not record.exists():
                        atomic_json(record, {"id": identity, "tenantId": 1, "status": "failed", "phase": "finished", "message": "请求校验未通过，未执行版本切换", "finishedAt": int(time.time() * 1000)})
                        self.release_lock(identity)
                file.unlink(missing_ok=True)
        lock = self.queue / "active.lock"
        if lock.exists() and time.time() - lock.stat().st_mtime > 300:
            identity = json.loads(lock.read_text()).get("id", "")
            if UUID.fullmatch(identity) and not (self.queue / (identity + ".request.json")).exists() and not (self.queue / (identity + ".running.json")).exists():
                (self.queue / (identity + ".pending.json")).unlink(missing_ok=True)
                if not (self.state / "operations" / (identity + ".json")).exists():
                    atomic_json(self.state / "operations" / (identity + ".json"), {"id": identity, "tenantId": 1, "status": "failed", "phase": "finished", "message": "请求未完成入队，未执行版本切换，请重试", "finishedAt": int(time.time() * 1000)})
                self.release_lock(identity)
        for file in (self.state / "operations").glob("*.json"):
            job = json.loads(file.read_text())
            if job.get("auditPending"):
                try:
                    self.control("audit", job)
                    job["auditPending"] = False
                    atomic_json(file, job)
                except Exception:
                    pass


if __name__ == "__main__":
    import fcntl
    if os.geteuid() != 0:
        raise SystemExit("Host release worker must run as root")
    with open("/run/weiduoxian-platform.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit(0)
        Worker().run()
