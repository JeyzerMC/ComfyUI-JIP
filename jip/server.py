"""aiohttp routes for the JIP frontend.

Exposes the enumerated base roots so JIP Load can offer them as a dropdown and
show the real resolved paths (e.g. "Comfy Install: C:/.../ComfyUI"). Roots come
from the registered `jip` folder category, so extra roots configured via a
`jip:` key in extra_model_paths.yaml appear automatically (#9, #19).
"""

from __future__ import annotations

from aiohttp import web

from server import PromptServer

from . import interactive
from .paths import list_roots

routes = PromptServer.instance.routes


@routes.get("/jip/roots")
async def _jip_roots(_request: web.Request) -> web.Response:
    return web.json_response({"roots": list_roots()})


@routes.post("/jip/interactive/resolve")
async def _jip_resolve(request: web.Request) -> web.Response:
    """Resume a paused interactive node with the user's overlay result (#22)."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)
    token = (body.get("token") or "").strip()
    if not token:
        return web.json_response({"error": "missing token"}, status=400)
    ok = interactive.resolve(token, body.get("result") or {})
    return web.json_response({"ok": ok})


@routes.post("/jip/interactive/cancel")
async def _jip_cancel(request: web.Request) -> web.Response:
    """Cancel a paused interactive node so its prompt stops cleanly (#22)."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)
    token = (body.get("token") or "").strip()
    if not token:
        return web.json_response({"error": "missing token"}, status=400)
    ok = interactive.cancel(token)
    return web.json_response({"ok": ok})
