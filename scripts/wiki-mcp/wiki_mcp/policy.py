"""Page-ID normalisation and the read/write access policy (spec 4.1-4.2)."""
import hashlib
import re
from dataclasses import dataclass

_VALID_ID = re.compile(r"^[a-z0-9_.-]+(:[a-z0-9_.-]+)*$")
_PHP_TRIM_CHARS = " \t\n\r\0\x0b"


class InvalidId(ValueError):
    pass


def normalize_id(raw) -> str:
    if not isinstance(raw, str):
        raise InvalidId("page id must be a string")
    value = raw.strip().lower().replace("/", ":").replace(";", ":").replace(" ", "_").strip(":")
    if not _VALID_ID.fullmatch(value) or any(seg in (".", "..") for seg in value.split(":")):
        raise InvalidId(f"invalid page id: {raw!r}")
    return value


def normalize_namespace(raw) -> str:
    if raw is None or (isinstance(raw, str) and raw.strip(" :") == ""):
        return ""
    return normalize_id(raw)


def php_trim(text: str) -> str:
    return text.strip(_PHP_TRIM_CHARS)


def content_hash(text: str) -> str:
    """Same value DokuWiki returns from core.getPageInfo(hash=true)."""
    return hashlib.md5(php_trim(text).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Policy:
    read_namespaces: tuple
    read_pages: frozenset
    write_pages: frozenset

    def _in_read_namespace(self, namespace: str) -> bool:
        return any(namespace == ns or namespace.startswith(ns + ":") for ns in self.read_namespaces)

    def can_read(self, page_id: str) -> bool:
        return page_id in self.read_pages or any(page_id.startswith(ns + ":") for ns in self.read_namespaces)

    def can_write(self, page_id: str) -> bool:
        return page_id in self.write_pages

    def can_list(self, namespace: str) -> bool:
        """Inside a readable namespace, or an ancestor of something readable (so the tree can be walked down)."""
        if self._in_read_namespace(namespace):
            return True
        return namespace == "" or any(t.startswith(namespace + ":") for t in (*self.read_pages, *self.read_namespaces))

    def search_scopes(self) -> list:
        """Namespaces a full-text search has to cover: the read namespaces plus the parent of every
        single readable page outside them ('' = whole wiki, only for a root-level page)."""
        scopes = list(self.read_namespaces)
        for page in sorted(self.read_pages):
            parent = page.rpartition(":")[0]
            if parent not in scopes and not self._in_read_namespace(parent):
                scopes.append(parent)
        return scopes

    def filter_readable(self, ids) -> list:
        out, seen = [], set()
        for raw in ids:
            try:
                page_id = normalize_id(raw)
            except InvalidId:
                continue
            if page_id not in seen and self.can_read(page_id):
                seen.add(page_id)
                out.append(page_id)
        return out
