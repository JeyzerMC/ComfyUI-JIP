"""aiohttp routes for the JIP frontend.

Exposes the resolved base directories so the JIP Load readout can show the real
paths (e.g. "Comfy Install: C:/.../ComfyUI") instead of placeholders, and hide
the Extra Path option when no extra_model_paths base_path is configured (#9).
"""

from __future__ import annotations

from aiohttp import web

from server import PromptServer

from .paths import comfy_root, extra_root

routes = PromptServer.instance.routes


@routes.get("/jip/roots")
async def _jip_roots(_request: web.Request) -> web.Response:
    return web.json_response({
        "comfy_install": comfy_root(),
        "extra_path": extra_root(),  # null when no extra_model_paths base_path is set
    })
