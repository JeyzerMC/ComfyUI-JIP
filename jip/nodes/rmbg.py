"""JIP RMBG node — multi-model background removal + pause-and-select overlay (#6, #11).

Uses `rembg` (MIT) with the U²-Net family of models (Apache-2.0 weights) — a
permissive stack, deliberately NOT the GPL `comfyui-rmbg`. Every selected model
is run; execution then pauses and the frontend shows all results so the user
picks one and optionally retouches it (eraser / magic-fill to the background
colour) before confirming. The confirmed image becomes the payload's `_alt`
(working/"filtered") image. No image is shown on the node.
"""

from __future__ import annotations

import numpy as np
import torch
from PIL import Image

from comfy_api.v0_0_2 import io

from ..payload import JIPPayloadIO
from .. import interactive

MODELS = ["u2net", "u2netp", "isnet-general-use", "silueta"]
BACKGROUNDS = {"white": (255, 255, 255), "black": (0, 0, 0), "gray": (128, 128, 128)}

_SESSIONS: dict = {}


def _session(model_name: str):
    if model_name not in _SESSIONS:
        from rembg import new_session  # lazy: only needed at execute time
        _SESSIONS[model_name] = new_session(model_name)
    return _SESSIONS[model_name]


class JIPRMBG(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPRMBG",
            display_name="JIP RMBG",
            category="JIP",
            description="Run the selected background-removal models, then pause and let you pick + retouch one result.",
            inputs=[
                JIPPayloadIO.Input("payload"),
                # Multi-select model grid (rendered as toggle boxes on the frontend).
                # All models default-on (#27) — the user picks one result in the overlay.
                # socketless: no input pin — the grid drives these (#27).
                *[io.Boolean.Input(m, default=True, socketless=True) for m in MODELS],
                io.Combo.Input("background", options=list(BACKGROUNDS.keys())),
            ],
            outputs=[
                JIPPayloadIO.Output("payload"),
            ],
        )

    @classmethod
    def execute(cls, payload, background: str, **toggles) -> io.NodeOutput:
        if payload is None or not getattr(payload, "images", None):
            raise ValueError("JIP RMBG: payload has no images (connect JIP Load).")

        try:
            from rembg import remove
        except Exception as exc:
            raise RuntimeError(
                "rembg not installed. `pip install rembg` (MIT; U²-Net weights are Apache-2.0) to use JIP RMBG."
            ) from exc

        selected = [m for m in MODELS if toggles.get(m, False)] or ["u2net"]
        bg_rgb = BACKGROUNDS.get(background, (255, 255, 255))

        src = payload.working_image()
        arr = (src[0].detach().clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
        src_pil = Image.fromarray(arr)

        results: list[torch.Tensor] = []
        labels: list[str] = []
        for model in selected:
            try:
                cut = remove(src_pil, session=_session(model))  # RGBA
                bg = Image.new("RGBA", cut.size, bg_rgb + (255,))
                composited = Image.alpha_composite(bg, cut.convert("RGBA")).convert("RGB")
                tensor = torch.from_numpy(np.array(composited).astype(np.float32) / 255.0)[None,]
                results.append(tensor)
                labels.append(model)
            except Exception as exc:  # one bad model shouldn't sink the run
                print(f"[JIP] RMBG model {model} failed: {exc!r}")

        if not results:
            raise RuntimeError("JIP RMBG: every selected model failed — see log.")

        # Pause: let the user pick one result and retouch it. The overlay returns
        # the final image (base64 PNG), which becomes the working/_alt image.
        # Prepend the source image (index 0) so the overlay can offer it as the
        # "Original" (no-removal) choice and as the Restore brush source (#35).
        overlay_images = [src] + results
        overlay_labels = ["Original"] + labels
        result = interactive.request(
            "rmbg",
            overlay_images,
            extra={"labels": overlay_labels, "base_index": 0, "background": background, "bg_color": list(bg_rgb)},
        )
        edited = result.get("image")
        alt = interactive.decode_image(edited) if edited else overlay_images[int(result.get("picked", 0))]

        out = payload.copy()
        out.set_working(alt)
        return io.NodeOutput(out)
