"""Tool logic behind the MCP surface: policy checks, consistent reads, guarded writes (spec 4-5)."""
import json
import logging
import threading
import time

from .policy import InvalidId, content_hash, normalize_id, normalize_namespace, php_trim
from .upstream import Ambiguous, ApiError, AuthFailed, AuthLocked, UpstreamError

log = logging.getLogger("wiki_mcp.audit")

NOT_FOUND_CODE = 121
AUTH_HINT = ("wiki-mcp přestal zkoušet přihlášení, aby se nezamkl účet. "
             "Správce: nové WIKI_PASSWORD do .env a `docker compose up -d wiki-mcp`, "
             "nebo po odemčení účtu `python -m wiki_mcp reset-auth` + restart.")


class ToolFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


def _revision_of(info):
    """Revision from a getPageInfo reply, or None when the reply is unusable."""
    value = info.get("revision") if isinstance(info, dict) else None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _info_params(page_id):
    """getPageInfo arguments for the write path: current revision, author and content hash."""
    return {"page": page_id, "hash": True, "author": True}


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False)


class WikiTools:
    def __init__(self, client, policy, sleep=time.sleep, clock=time.monotonic, verify_delays=(0, 5, 15, 30),
                 write_wait=30.0, write_budget=90.0, call_timeout=25.0):
        self._client = client
        self._policy = policy
        self._sleep = sleep
        self._clock = clock
        self._verify_delays = verify_delays
        self._write_wait = write_wait
        self._write_budget = write_budget      # whole core_savePage call, spec 5.2 (R3)
        self._call_timeout = call_timeout      # one upstream HTTP call: connect 5 s + read 20 s
        self._write_lock = threading.Lock()

    @property
    def policy(self):
        return self._policy

    # -- helpers -------------------------------------------------------------
    def _page(self, raw) -> str:
        try:
            page = normalize_id(raw)
        except InvalidId as exc:
            raise ToolFailure("INVALID_ID", str(exc)) from exc
        if not self._policy.can_read(page):
            raise ToolFailure("FORBIDDEN", f"page outside read policy: {page}")
        return page

    def _failure(self, exc, rejected=False, api_code="WIKI_ERROR") -> ToolFailure:
        """One upstream exception -> one ToolFailure. rejected=True: the call happened before savePage,
        so nothing was written and the client gets REJECTED <code>."""
        if isinstance(exc, (AuthLocked, AuthFailed)):
            code, message = "AUTH_LOCKED", f"{exc}. {AUTH_HINT}"
        elif isinstance(exc, ApiError) and not rejected and exc.code == NOT_FOUND_CODE:
            code, message = "NOT_FOUND", exc.message
        else:
            code = api_code if isinstance(exc, ApiError) else "WIKI_UNAVAILABLE"
            message = f"{exc}." if rejected else str(exc)
        return self._reject(code, message) if rejected else ToolFailure(code, message)

    def _read(self, method, params):
        try:
            return self._client.call(method, params)
        except UpstreamError as exc:
            raise self._failure(exc) from exc

    def _readable(self, items) -> list:
        """Items (dicts with 'id') the policy allows, deduplicated, original order."""
        allowed = set(self._policy.filter_readable([item.get("id") for item in items]))
        out, seen = [], set()
        for item in items:
            item_id = item.get("id")
            if item_id in allowed and item_id not in seen:
                seen.add(item_id)
                out.append(item)
        return out

    # -- read tools ----------------------------------------------------------
    def get_page_info(self, page, rev=0, author=False, hash=False) -> str:
        page = self._page(page)
        return _dump(self._read("core.getPageInfo", {"page": page, "rev": rev, "author": author, "hash": hash}))

    def get_page(self, page, rev=0) -> str:
        page = self._page(page)
        for _attempt in range(2):
            try:
                info = self._read("core.getPageInfo", {"page": page, "rev": rev, "hash": True})
            except ToolFailure as exc:
                if exc.code == "NOT_FOUND" and not rev:
                    return ""  # missing page: same as DokuWiki core.getPage (spec 4.3)
                raise
            revision, expected = info["revision"], info.get("hash")
            text = self._read("core.getPage", {"page": page, "rev": revision})
            if content_hash(text) == expected:
                return text
            if not rev:
                # Current revision without a changelog entry (external edit/import, spec F18): the rev-read
                # is empty, but the current file still carries this hash, so a plain read proves the pair.
                text = self._read("core.getPage", {"page": page})
                if content_hash(text) == expected:
                    return text
        raise ToolFailure("INCONSISTENT_READ", f"text of {page} does not match revision {revision}; try again")

    def get_page_links(self, page) -> str:
        page = self._page(page)
        return _dump(self._read("core.getPageLinks", {"page": page}))

    def search_pages(self, query) -> str:
        if not isinstance(query, str) or not query.strip() or len(query) > 200:
            raise ToolFailure("INVALID_ARGUMENT", "query must be 1-200 characters")
        hits = []
        for ns in self._policy.search_scopes():
            hits += self._read("core.searchPages", {"query": f"{query} @{ns}" if ns else query}) or []
        return _dump(self._readable(hits))

    def list_pages(self, namespace="", depth=1, hash=False) -> str:
        try:
            ns = normalize_namespace(namespace)
        except InvalidId as exc:
            raise ToolFailure("INVALID_ID", str(exc)) from exc
        if not self._policy.can_list(ns):
            raise ToolFailure("FORBIDDEN", f"namespace outside read policy: {ns or '(root)'}")
        pages = self._read("core.listPages", {"namespace": ns, "depth": depth, "hash": hash}) or []
        return _dump(self._readable(pages))

    # -- write tool ----------------------------------------------------------
    MAX_TEXT = 512 * 1024

    def _reject(self, sub, message):
        return ToolFailure(f"REJECTED {sub}", f"{message} Stránka se nezměnila.")

    @staticmethod
    def _unknown(detail):
        return ToolFailure("UNKNOWN", f"Zápis nelze potvrdit {detail}. Neopakuj ho automaticky; ověř stav stránky ve wiki.")

    def _audit(self, **fields):
        log.info(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **fields}, ensure_ascii=False))

    def _write_page(self, raw) -> str:
        try:
            page_id = normalize_id(raw)
        except InvalidId as exc:
            raise self._reject("INVALID_ID", str(exc)) from exc
        if not self._policy.can_write(page_id):
            raise self._reject("FORBIDDEN", f"page outside write policy: {page_id}.")
        return page_id

    def save_page(self, page, text, summary, expected_revision, isminor=False) -> str:
        started = time.monotonic()
        page_id = page  # replaced by the normalised id as soon as it is known; audit() reads it at call time

        def audit(outcome, code=None, new_revision=None):
            self._audit(page=page_id, outcome=outcome, code=code, expectedRevision=expected_revision,
                        newRevision=new_revision, summary=summary,
                        durationMs=int((time.monotonic() - started) * 1000))

        try:
            page_id = self._write_page(page)
            result = self._save_checked(page_id, text, summary, expected_revision, bool(isminor))
        except ToolFailure as exc:
            outcome, _, code = exc.code.partition(" ")
            audit(outcome, code or None)
            raise
        except Exception as exc:
            audit("ERROR", type(exc).__name__)
            raise
        audit(result["outcome"], None, result.get("newRevision"))
        return _dump(result)

    def _save_checked(self, page_id, text, summary, expected_revision, isminor):
        if not isinstance(text, str):
            raise self._reject("EMPTY_TEXT", "text must be a string.")
        text = text.replace("\r\n", "\n").replace("\r", "\n")  # exactly what DokuWiki cleanText does (spec F17)
        if not php_trim(text):
            raise self._reject("EMPTY_TEXT", "Empty text would delete the page.")
        if len(text.encode("utf-8")) > self.MAX_TEXT:
            raise self._reject("TOO_LARGE", "Text is larger than 512 KB.")
        if not isinstance(summary, str) or len(summary) > 255:
            raise self._reject("INVALID_ARGUMENT", "summary must be a string of at most 255 characters.")
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool) or expected_revision <= 0:
            raise self._reject("EXPECTED_REVISION_REQUIRED",
                               "Pass expected_revision = revision from core_getPageInfo used for reading.")
        new_hash = content_hash(text)
        deadline = self._clock() + self._write_budget  # spec 5.2 (R3): whole call, lock wait included
        if not self._write_lock.acquire(timeout=self._write_wait):
            raise self._reject("BUSY", "Another write is in progress.")
        try:
            return self._save_locked(page_id, text, summary, expected_revision, isminor, new_hash, deadline)
        finally:
            self._write_lock.release()

    def _pre_save(self, method, params):
        """Upstream call before savePage: any failure means nothing was written."""
        try:
            return self._client.call(method, params)
        except UpstreamError as exc:
            raise self._failure(exc, rejected=True, api_code="WIKI_UNAVAILABLE") from exc

    def _save_locked(self, page_id, text, summary, expected, isminor, new_hash, deadline):
        locked = self._pre_save("core.lockPages", {"pages": [page_id]})
        locked = locked if isinstance(locked, list) else []
        if page_id not in locked:
            raise self._reject("CONFLICT_LOCKED",
                               "Page is locked by another user, or the service account has no edit right on it (ACL).")
        try:
            current = self._pre_save("core.getPageInfo", _info_params(page_id))
            current_rev = _revision_of(current)
            if current_rev is None:
                raise self._reject("WIKI_UNAVAILABLE", "getPageInfo returned an unusable reply.")
            if current_rev != expected:
                raise self._reject("CONFLICT_CHANGED",
                                   f"Page changed since it was read: rev {current_rev} "
                                   f"by {current.get('author', '?')} (expected {expected}). Read it again.")
            if current.get("hash") == new_hash:
                return {"outcome": "SAVED_NO_CHANGE", "page": page_id, "revision": expected}
            if self._clock() + self._call_timeout > deadline:
                raise self._reject("BUDGET", "Write budget exhausted before the page could be saved; try again.")
            try:
                self._client.call("core.savePage", {"page": page_id, "text": text,
                                                    "summary": "[claudecodeui] " + summary, "isminor": isminor})
            except Ambiguous as exc:
                return self._resolve_unknown(page_id, expected, new_hash, f"savePage: {exc}", deadline)
            except UpstreamError as exc:
                raise self._failure(exc, rejected=True, api_code="SAVE_REFUSED") from exc
            return self._resolve_unknown(page_id, expected, new_hash, "save not confirmed", deadline)
        finally:
            try:
                self._client.call("core.unlockPages", {"pages": [page_id]})
            except UpstreamError as exc:
                log.warning("unlockPages failed for %s: %s", page_id, exc)

    def _resolve_unknown(self, page_id, expected, new_hash, reason, deadline):
        last, previous = None, 0
        for delay in self._verify_delays:
            wait = delay - previous
            if self._clock() + wait + self._call_timeout > deadline:
                reason = f"{reason}; časový rozpočet zápisu vyčerpán"  # spec 5.2 (R3)
                break
            self._sleep(wait)
            previous = delay
            try:
                last = self._client.call("core.getPageInfo", _info_params(page_id))
            except UpstreamError as exc:
                reason = f"{reason}; check failed: {exc}"
                continue
            last_rev = _revision_of(last)
            if last_rev is None:
                reason = f"{reason}; check returned an unusable reply"
                last = None
                continue
            if last_rev != expected:
                if last.get("hash") == new_hash:
                    return {"outcome": "SAVED", "page": page_id, "oldRevision": expected,
                            "newRevision": last_rev}
                raise self._unknown(f"({reason}): stránku mezitím změnil někdo jiný "
                                    f"(rev {last_rev}, autor {last.get('author', '?')})")
        seen = f"rev {_revision_of(last)}" if last else "stav nezjištěn"
        raise self._unknown(f"({reason}); poslední stav: {seen}")
