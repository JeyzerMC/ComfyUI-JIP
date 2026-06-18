"""aiohttp routes for the JIP frontend.

Exposes the enumerated base roots so JIP Load can offer them as a dropdown and
show the real resolved paths (e.g. "Comfy Install: C:/.../ComfyUI"). Roots come
from the registered `jip` folder category, so extra roots configured via a
`jip:` key in extra_model_paths.yaml appear automatically (#9, #19).
"""

from __future__ import annotations

from aiohttp import web

from server import PromptServer

from .paths import list_roots

routes = PromptServer.instance.routes


@routes.get("/jip/roots")
async def _jip_roots(_request: web.Request) -> web.Response:
    return web.json_response({"roots": list_roots()})
