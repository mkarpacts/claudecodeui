"""The only way to talk to the wiki: NTLM JSON-RPC, whitelisted methods, one call at a time."""
import threading

import requests
from requests_ntlm import HttpNtlmAuth
from urllib3.exceptions import MaxRetryError, NewConnectionError

ALLOWED_METHODS = frozenset({
    "core.whoAmI", "core.getPage", "core.getPageInfo", "core.getPageLinks", "core.searchPages",
    "core.listPages", "core.lockPages", "core.unlockPages", "core.savePage",
})


class UpstreamError(Exception):
    pass


class AuthLocked(UpstreamError):
    """The latch is set; nothing was sent."""


class AuthFailed(UpstreamError):
    """IIS rejected the NTLM credentials just now; the latch is set; PHP never saw the request."""


class NotSent(UpstreamError):
    """No connection could be established; the request was definitely not processed."""


class Ambiguous(UpstreamError):
    """The request may have been processed; the outcome is unknown."""


class ApiError(UpstreamError):
    def __init__(self, code: int, message: str):
        super().__init__(f"{code} {message}")
        self.code = code
        self.message = message


def _is_connect_failure(exc: Exception) -> bool:
    reason = exc.args[0] if exc.args else None
    return isinstance(reason, MaxRetryError) and isinstance(reason.reason, NewConnectionError)


class WikiClient:
    def __init__(self, base_url, username, password, latch, session=None, timeout=(5, 20)):
        self._url = base_url.rstrip("/") + "/lib/exe/jsonrpc.php/"
        self._session = session or requests.Session()
        self._session.auth = HttpNtlmAuth(username, password)
        self._latch = latch
        self._timeout = timeout
        self._lock = threading.Lock()

    def call(self, method: str, params: dict | None = None):
        if method not in ALLOWED_METHODS:
            raise ValueError(f"method not allowed: {method}")
        with self._lock:
            if self._latch.locked:
                raise AuthLocked(self._latch.reason or "locked")
            try:
                resp = self._session.post(self._url + method, json=params or {}, timeout=self._timeout,
                                          allow_redirects=False)
            except requests.exceptions.ConnectTimeout as exc:
                raise NotSent(str(exc)) from exc
            except requests.exceptions.ConnectionError as exc:
                if _is_connect_failure(exc):
                    raise NotSent(str(exc)) from exc
                raise Ambiguous(str(exc)) from exc
            except requests.exceptions.RequestException as exc:
                raise Ambiguous(str(exc)) from exc
            except Exception as exc:
                # e.g. requests-ntlm PermissionError when the type-1 negotiate gets no challenge: only the
                # credential-free type-1 message was sent, so AD saw no login attempt and the latch stays untouched.
                raise Ambiguous(f"{type(exc).__name__}: {exc}") from exc
            try:
                data = resp.json()
            except ValueError:
                data = None
            if resp.status_code == 401 and not isinstance(data, dict):
                self._latch.trip("http_401", 401)
                raise AuthFailed("wiki rejected the service account credentials (HTTP 401)")
            if isinstance(data, dict):
                error = data.get("error")
                if error and not isinstance(error, dict):
                    raise Ambiguous(f"HTTP {resp.status_code}: malformed error object")
                if isinstance(error, dict) and error.get("code"):
                    try:
                        code = int(error["code"])
                    except (TypeError, ValueError) as exc:
                        raise Ambiguous(f"HTTP {resp.status_code}: malformed error object") from exc
                    raise ApiError(code, str(error.get("message", "")))
                if resp.status_code == 200:
                    return data.get("result")
            raise Ambiguous(f"HTTP {resp.status_code}: unexpected response")
