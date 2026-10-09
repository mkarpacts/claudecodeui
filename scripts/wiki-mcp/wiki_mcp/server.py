"""MCP surface (tool names/params as the DokuWiki API), health endpoint and the startup login check."""
import logging
import time

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.mcpserver.tools import Tool
from pydantic import ConfigDict
from starlette.requests import Request
from starlette.responses import JSONResponse

from .tools import ToolFailure
from .upstream import Ambiguous, ApiError, AuthFailed, AuthLocked, NotSent

log = logging.getLogger("wiki_mcp")


def _instructions(policy) -> str:
    readable = [f"{ns}:*" for ns in policy.read_namespaces] + sorted(policy.read_pages)
    writable = ", ".join(sorted(policy.write_pages)) or "nothing"
    return (f"CTS wiki through wiki-mcp. Readable: {', '.join(readable)}. Writable: {writable} only. "
            "For a consistent read call core_getPageInfo, then core_getPage(page, rev=<revision>); "
            "pass that revision as expected_revision to core_savePage.")


def startup_check(client, latch, expected_login, sleep=time.sleep, backoff=(30, 60, 120, 300)):
    """One whoAmI login check. Returns 'READY' or 'LOCKED'; retries forever while the wiki is unreachable."""
    latch.load()
    if latch.locked:
        log.error("auth latch set (%s): not contacting the wiki", latch.reason)
        return "LOCKED"
    if not latch.begin_attempt():  # spec 8.2 (R3): the disk must say 'attempting' before any request
        return "LOCKED"
    attempt = 0
    while True:
        try:
            who = client.call("core.whoAmI") or {}
        except (AuthFailed, AuthLocked):
            return "LOCKED"
        except ApiError as exc:
            latch.trip("api_error")
            log.error("whoAmI refused by DokuWiki: %s", exc)
            return "LOCKED"
        except (NotSent, Ambiguous) as exc:
            delay = backoff[min(attempt, len(backoff) - 1)]
            log.warning("wiki unavailable (%s), retry in %ss", exc, delay)
            sleep(delay)
            attempt += 1
            continue
        if str(who.get("login", "")).lower() != expected_login.lower():
            latch.trip("unexpected_login")
            log.error("logged in as %r, expected %r", who.get("login"), expected_login)
            return "LOCKED"
        latch.mark_ok()  # failure only logged: READY now, LOCKED (unfinished_attempt) after the next restart
        return "READY"


def _strict(fn) -> Tool:
    tool = Tool.from_function(fn, structured_output=False)
    base = tool.fn_metadata.arg_model
    tool.fn_metadata.arg_model = type(base.__name__, (base,), {"model_config": ConfigDict(**base.model_config,
                                                                                          extra="forbid")})
    return tool


def _run(fn, *args):
    try:
        return fn(*args)
    except ToolFailure as exc:
        raise ToolError(str(exc)) from exc


def build_server(tools, latch, startup_state) -> MCPServer:
    def core_getPage(page: str, rev: int = 0) -> str:
        """Raw DokuWiki text of exactly one revision (rev=0: current)."""
        return _run(tools.get_page, page, rev)

    def core_getPageInfo(page: str, rev: int = 0, author: bool = False, hash: bool = False) -> str:
        """Page metadata (revision, size, author, md5 hash) as JSON."""
        return _run(tools.get_page_info, page, rev, author, hash)

    def core_getPageLinks(page: str) -> str:
        """Links on a page, split into local and extern, as JSON."""
        return _run(tools.get_page_links, page)

    def core_searchPages(query: str) -> str:
        """Full-text search limited to readable pages, as JSON."""
        return _run(tools.search_pages, query)

    def core_listPages(namespace: str = "", depth: int = 1, hash: bool = False) -> str:
        """Readable pages in a namespace, as JSON."""
        return _run(tools.list_pages, namespace, depth, hash)

    def core_savePage(page: str, text: str, summary: str, expected_revision: int, isminor: bool = False) -> str:
        """Overwrite the one writable page; expected_revision is required. Outcome SAVED, SAVED_NO_CHANGE,
        REJECTED <code> (nothing changed) or UNKNOWN (do not retry, check the wiki)."""
        return _run(tools.save_page, page, text, summary, expected_revision, isminor)

    server = MCPServer("dokuwiki", instructions=_instructions(tools.policy), tools=[
        _strict(f) for f in (core_getPage, core_getPageInfo, core_getPageLinks, core_searchPages,
                             core_listPages, core_savePage)])

    @server.custom_route("/healthz", methods=["GET"])
    async def healthz(request: Request) -> JSONResponse:
        state = "LOCKED" if latch.locked else startup_state
        return JSONResponse({"state": state}, status_code=200 if state == "READY" else 503)

    return server


def create_app(server: MCPServer):
    return server.streamable_http_app(stateless_http=True, json_response=True, host="0.0.0.0")
