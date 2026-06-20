"""aiohttp routes for the JIP frontend.

Exposes the enumerated base roots so JIP Load can offer them as a dropdown and
show the real resolved paths (e.g. "Comfy Install: C:/.../ComfyUI"). Roots come
from the registered `jip` folder category, so extra roots configured via a
`jip:` key in extra_model_paths.yaml appear automatically (#9, #19).
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys

from aiohttp import web

from server import PromptServer

from . import interactive
from .paths import list_roots

routes = PromptServer.instance.routes


@routes.get("/jip/roots")
async def _jip_roots(_request: web.Request) -> web.Response:
    return web.json_response({"roots": list_roots()})


@routes.post("/jip/reveal")
async def _jip_reveal(request: web.Request) -> web.Response:
    """Open the OS file explorer at a saved image, selecting it when possible.

    The client posts the absolute ``path`` of a saved file (JIP Save ships it as
    ``meta[i].path``). JIP Save writes under the user-chosen ``output_path``,
    which can be anywhere on disk (#33), so the only check is that the path
    points at an existing regular file.
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)
    path = (body.get("path") or "").strip() if isinstance(body, dict) else ""
    if not path:
        return web.json_response({"error": "missing 'path'"}, status=400)

    real_target = os.path.realpath(path)
    if not os.path.isfile(real_target):
        return web.json_response({"error": "file not found"}, status=404)

    try:
        if sys.platform.startswith("win"):
            subprocess.Popen(["explorer", "/select,", real_target])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", real_target])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(real_target)])
    except Exception as exc:
        logging.exception("[JIP] failed to reveal %s", real_target)
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"ok": True, "path": real_target})


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
