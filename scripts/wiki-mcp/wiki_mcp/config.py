"""Environment -> validated Settings (spec 4.1, 8.1). Fails fast on any doubt."""
from dataclasses import dataclass
from typing import Mapping

from .policy import InvalidId, Policy, normalize_id


DEFAULT_STATE_DIR = "/state"


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Settings:
    wiki_url: str
    username: str
    password: str
    expected_login: str
    policy: Policy
    state_dir: str


def _required(env: Mapping[str, str], key: str) -> str:
    value = (env.get(key) or "").strip()
    if not value:
        raise ConfigError(f"{key} is not set")
    return value


def _ids(env: Mapping[str, str], key: str) -> list:
    raw = [x.strip() for x in (env.get(key) or "").split(",") if x.strip()]
    try:
        return [normalize_id(x) for x in raw]
    except InvalidId as exc:
        raise ConfigError(f"{key}: {exc}") from exc


def load_settings(env: Mapping[str, str]) -> Settings:
    url = _required(env, "WIKI_URL").rstrip("/")
    if not url.startswith("https://"):
        raise ConfigError("WIKI_URL must be https://")
    if "/lib/" in url:
        raise ConfigError("WIKI_URL must be the wiki root, e.g. https://wiki.cts-group.local")
    policy = Policy(
        read_namespaces=tuple(_ids(env, "WIKI_READ_NAMESPACES")),
        read_pages=frozenset(_ids(env, "WIKI_READ_PAGES")),
        write_pages=frozenset(_ids(env, "WIKI_WRITE_PAGES")),
    )
    if not policy.read_namespaces and not policy.read_pages:
        raise ConfigError("nothing is readable: set WIKI_READ_NAMESPACES and/or WIKI_READ_PAGES")
    for page in policy.write_pages:
        if not policy.can_read(page):
            raise ConfigError(f"WIKI_WRITE_PAGES entry {page} is not readable")
    return Settings(
        wiki_url=url,
        username=_required(env, "WIKI_USERNAME"),
        password=_required(env, "WIKI_PASSWORD"),
        expected_login=_required(env, "WIKI_EXPECTED_LOGIN"),
        policy=policy,
        state_dir=(env.get("WIKI_STATE_DIR") or DEFAULT_STATE_DIR),
    )
