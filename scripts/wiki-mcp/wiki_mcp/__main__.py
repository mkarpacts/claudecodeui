"""python -m wiki_mcp            -> serve on :8000
   python -m wiki_mcp reset-auth -> remove /state/auth-state.json (then restart the container)"""
import logging
import os
import sys

import uvicorn

from .config import DEFAULT_STATE_DIR, ConfigError, load_settings
from .latch import Latch, clear_marker
from .server import build_server, create_app, startup_check
from .tools import WikiTools
from .upstream import WikiClient


def main(argv=None) -> int:
    args = sys.argv[1:] if argv is None else argv
    # stdout (not the default stderr): audit lines must land in the container's stdout log (spec 5.4)
    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if args[:1] == ["reset-auth"]:
        removed = clear_marker(os.environ.get("WIKI_STATE_DIR") or DEFAULT_STATE_DIR)
        print("auth marker removed; restart the container" if removed else "no auth marker present")
        return 0
    try:
        settings = load_settings(os.environ)
    except ConfigError as exc:
        logging.error("configuration error: %s", exc)
        return 2
    latch = Latch(settings.state_dir, settings.username, settings.password)
    client = WikiClient(settings.wiki_url, settings.username, settings.password, latch)
    state = startup_check(client, latch, settings.expected_login)
    server = build_server(WikiTools(client, settings.policy), latch, state)
    uvicorn.run(create_app(server), host="0.0.0.0", port=8000, workers=1, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
