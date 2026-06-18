"""JIP Resize node — interactive crop/resize overlay (#4, #12).

The node carries only the per-orientation default dimensions (Portrait W/H,
Landscape W/H). On run it pauses and the frontend opens an overlay: it draws an
outline at the default dims for the image's orientation and offers fit-to-outline,
crop-to-outline, manual crop, or stretch. The confirmed image (always at the
chosen output dims) becomes the payload's working/_alt image. No on-node preview.
"""

from __future__ import annotations

from comfy_api.v0_0_2 import io

from ..payload import JIPPayloadIO
from .. import interactive


class JIPResize(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPResize",
            display_name="JIP Resize",
            category="JIP",
            description="Pause and open a crop/resize overlay using the per-orientation default dimensions.",
            inputs=[
                JIPPayloadIO.Input("payload"),
                io.Int.Input("portrait_width", default=853, min=1, max=8192),
                io.Int.Input("portrait_height", default=1440, min=1, max=8192),
                io.Int.Input("landscape_width", default=1440, min=1, max=8192),
                io.Int.Input("landscape_height", default=853, min=1, max=8192),
            ],
            outputs=[
                JIPPayloadIO.Output("payload"),
            ],
        )

    @classmethod
    def execute(cls, payload, portrait_width: int, portrait_height: int,
                landscape_width: int, landscape_height: int) -> io.NodeOutput:
        if payload is None or not getattr(payload, "images", None):
            raise ValueError("JIP Resize: payload has no images (connect JIP Load).")

        src = payload.working_image()
        # tensor is [1, H, W, C]
        h, w = int(src.shape[1]), int(src.shape[2])
        portrait = h > w
        out_w, out_h = (portrait_width, portrait_height) if portrait else (landscape_width, landscape_height)

        result = interactive.request(
            "resize",
            [src],
            extra={
                "orientation": "portrait" if portrait else "landscape",
                "default_w": int(out_w),
                "default_h": int(out_h),
            },
        )
        edited = result.get("image")
        if not edited:
            raise RuntimeError("JIP Resize: overlay returned no image.")
        alt = interactive.decode_image(edited)

        out = payload.copy()
        out.set_working(alt)
        out.dims = (int(alt.shape[2]), int(alt.shape[1]))
        return io.NodeOutput(out)
