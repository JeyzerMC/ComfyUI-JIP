"""JIP RMBG node — background removal via rembg (#6).

Uses `rembg` (MIT) with the U²-Net family of models (Apache-2.0 weights) — a
permissive stack, deliberately NOT the GPL `comfyui-rmbg`. The bg-removed result
is composited onto a chosen background colour and stored as the payload's "_alt"
image. The 4-option grid + manual eraser overlay is deferred frontend polish.
"""

from __future__ import annotations

import numpy as np
import torch
from PIL import Image

from comfy_api.v0_0_2 import io, ui

from ..payload import JIPPayloadIO

MODELS = ["u2net", "u2netp", "isnet-general-use", "silueta"]
BACKGROUNDS = {"white": (255, 255, 255), "black": (0, 0, 0), "gray": (128, 128, 128)}

_SESSIONS: dict = {}


def _session(model_name: str):
    if model_name not in _SESSIONS:
        from rembg import new_session  # lazy: only needed at execute time
        _SESSIONS[model_name] = new_session(model_name)
    return _SESSIONS[model_name]


def _working_index(payload) -> int:
    """Index of the image to operate on: existing '_alt' if present, else base (0)."""
    names = getattr(payload, "names", [])
    for i, nm in enumerate(names):
        if nm == "_alt":
            return i
    return 0


class JIPRMBG(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPRMBG",
            display_name="JIP RMBG",
            category="JIP",
            description="Remove the background (rembg / U²-Net) and store the result as the payload's _alt image.",
            inputs=[
                JIPPayloadIO.Input("payload"),
                io.Combo.Input("model", options=MODELS),
                io.Combo.Input("background", options=list(BACKGROUNDS.keys())),
            ],
            outputs=[
                JIPPayloadIO.Output("payload"),
            ],
        )

    @classmethod
    def execute(cls, payload, model: str, background: str) -> io.NodeOutput:
        if payload is None or not getattr(payload, "images", None):
            raise ValueError("JIP RMBG: payload has no images (connect JIP Load).")

        try:
            from rembg import remove
        except Exception as exc:
            raise RuntimeError(
                "rembg not installed. `pip install rembg` (MIT; U²-Net weights are Apache-2.0) to use JIP RMBG."
            ) from exc

        src = payload.images[0]
        arr = (src[0].detach().clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
        cut = remove(Image.fromarray(arr), session=_session(model))  # RGBA
        bg = Image.new("RGBA", cut.size, BACKGROUNDS.get(background, (255, 255, 255)) + (255,))
        composited = Image.alpha_composite(bg, cut.convert("RGBA")).convert("RGB")
        alt = torch.from_numpy(np.array(composited).astype(np.float32) / 255.0)[None,]

        out = payload.copy()
        idx = _working_index(out)
        if out.names[idx] == "_alt":
            out.images[idx] = alt
        else:
            out.images.append(alt)
            out.names.append("_alt")
        return io.NodeOutput(out, ui=ui.PreviewImage(alt, cls=cls))
