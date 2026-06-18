"""JIP Resize node — resize/crop the working image to target dimensions (#4).

The functional core (cover-crop / stretch to exact target dims) runs from the
width/height/mode widgets. The interactive overlay (live outline, drag-to-crop,
shortest-edge fit buttons) is deferred frontend polish layered on top.
"""

from __future__ import annotations

import numpy as np
import torch
from PIL import Image

from comfy_api.v0_0_2 import io, ui

from ..payload import JIPPayloadIO

MODES = ["cover", "stretch"]


def _resize_one(tensor, width: int, height: int, mode: str):
    arr = (tensor[0].detach().clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
    img = Image.fromarray(arr)
    if mode == "stretch":
        out = img.resize((width, height), Image.LANCZOS)
    else:  # cover: scale by the longer ratio so the image fills, then center-crop
        w, h = img.size
        scale = max(width / w, height / h)
        nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
        img = img.resize((nw, nh), Image.LANCZOS)
        left = (nw - width) // 2
        top = (nh - height) // 2
        out = img.crop((left, top, left + width, top + height))
    out_arr = np.array(out).astype(np.float32) / 255.0
    return torch.from_numpy(out_arr)[None,]


class JIPResize(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPResize",
            display_name="JIP Resize",
            category="JIP",
            description="Resize and crop the working image(s) to exact target dimensions.",
            inputs=[
                JIPPayloadIO.Input("payload"),
                io.Int.Input("width", default=853, min=1, max=8192),
                io.Int.Input("height", default=1440, min=1, max=8192),
                io.Combo.Input("mode", options=MODES, tooltip="cover = scale shortest edge then center-crop; stretch = exact resize."),
            ],
            outputs=[
                JIPPayloadIO.Output("payload"),
            ],
        )

    @classmethod
    def execute(cls, payload, width: int, height: int, mode: str) -> io.NodeOutput:
        if payload is None or not getattr(payload, "images", None):
            raise ValueError("JIP Resize: payload has no images (connect JIP Load).")
        out = payload.copy()
        # Resize the working image into _alt — never overwrite the original base,
        # so JIP Save still writes the true original as the base image (#17).
        resized = _resize_one(out.working_image(), width, height, mode)
        out.set_working(resized)
        out.dims = (width, height)
        return io.NodeOutput(out, ui=ui.PreviewImage(resized, cls=cls))
