"""Persistent 'stop trying' latch so a bad password never locks the AD account (spec 8.2, R3).

Rule: nothing is sent to the wiki before the disk says this fingerprint is 'attempting'.
If the state cannot be persisted, the process locks itself instead of trying.
"""
import hashlib
import json
import logging
import os
import secrets
import threading
import time

STATE = "auth-state.json"
SALT = "salt"
log = logging.getLogger("wiki_mcp.latch")


def fingerprint(username: str, password: str, salt: bytes) -> str:
    material = (username + "\0" + password).encode("utf-8")
    return hashlib.scrypt(material, salt=salt, n=2 ** 14, r=8, p=1, dklen=32).hex()


def _fsync_write(path: str, data: bytes) -> None:
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_BINARY", 0), 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)


def clear_marker(state_dir: str) -> bool:
    try:
        os.remove(os.path.join(state_dir, STATE))
        return True
    except FileNotFoundError:
        return False


class Latch:
    def __init__(self, state_dir: str, username: str, password: str):
        self._dir = state_dir
        self._username = username
        self._password = password
        self._fingerprint = None
        self._io_lock = threading.Lock()
        self.locked = False
        self.reason = None

    # -- state file -----------------------------------------------------------
    def load(self) -> None:
        """Read salt and state. Any I/O problem locks (fail closed) without touching the wiki."""
        try:
            os.makedirs(self._dir, exist_ok=True)
            self._fingerprint = fingerprint(self._username, self._password, self._salt())
        except OSError as exc:
            self._lock("state_unwritable", f"cannot read or create {SALT} in {self._dir}: {exc}")
            return
        try:
            with open(os.path.join(self._dir, STATE), encoding="utf-8") as fh:
                marker = json.load(fh)
        except FileNotFoundError:
            return
        except (OSError, ValueError) as exc:
            self._lock("state_unreadable", f"{STATE}: {exc}")
            return
        if not isinstance(marker, dict) or marker.get("fingerprint") != self._fingerprint:
            return  # other credentials: a fresh attempt is allowed
        if marker.get("state") == "failed":
            self._lock(marker.get("reason") or "failed")
        elif marker.get("state") == "attempting":
            self._lock("unfinished_attempt", "previous attempt's outcome was never persisted")
        elif marker.get("state") != "ok":
            self._lock("state_unreadable", f"unknown state {marker.get('state')!r}")
        # 'ok': one new attempt is allowed; begin_attempt() records it first

    def begin_attempt(self) -> bool:
        """Persist 'attempting' BEFORE the first request. False (and locked) if that is impossible."""
        if self.locked:
            return False
        try:
            self._write("attempting")
        except OSError as exc:
            self._lock("state_unwritable", f"cannot persist 'attempting': {exc}")
            return False
        return True

    def mark_ok(self) -> bool:
        if self.locked:
            return False  # never overwrite a persisted 'failed'/'attempting' lock with 'ok'
        try:
            self._write("ok")
            return True
        except OSError as exc:
            log.error("cannot persist auth state 'ok': %s (next restart locks until reset-auth)", exc)
            return False

    def trip(self, reason: str, http_status=None) -> None:
        self._lock(reason)  # in-memory first: holds for the lifetime of this process
        try:
            self._write("failed", reason=reason, http_status=http_status)
        except OSError as exc:
            log.error("cannot persist auth state 'failed': %s (in-memory lock holds until restart)", exc)

    # -- helpers -------------------------------------------------------------
    def _lock(self, reason: str, detail: str | None = None) -> None:
        self.locked = True
        self.reason = reason
        log.error("auth latch LOCKED (%s)%s", reason, f": {detail}" if detail else "")

    def _write(self, state: str, reason=None, http_status=None) -> None:
        marker = {"fingerprint": self._fingerprint, "state": state,
                  "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "reason": reason, "httpStatus": http_status}
        with self._io_lock:
            _fsync_write(os.path.join(self._dir, STATE), json.dumps(marker).encode("utf-8"))

    def _salt(self) -> bytes:
        path = os.path.join(self._dir, SALT)
        if not os.path.exists(path):
            _fsync_write(path, secrets.token_bytes(16))
        with open(path, "rb") as fh:
            salt = fh.read()
        if len(salt) != 16:
            raise OSError(f"{SALT} in {self._dir} has {len(salt)} bytes, expected 16")
        return salt
