"""JIP Save node — write payload images to disk and show the grid (#3)."""

from __future__ import annotations

import os

import numpy as np
import torch
from PIL import Image

from comfy_api.v0_0_2 import io, ui

from ..payload import JIPPayloadIO
from ..paths import build_output_path


class JIPSave(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPSave",
            display_name="JIP Save",
            category="JIP",
            description="Write each payload image to <base>/<output_path>/<output_name><suffix>.png and show an output grid.",
            inputs=[
                JIPPayloadIO.Input("payload"),
            ],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, payload) -> io.NodeOutput:
        images = getattr(payload, "images", None) or []
        if not images:
            return io.NodeOutput()
        if not getattr(payload, "output_name", "").strip():
            raise ValueError("JIP Save: output_name is empty — set it on JIP Load.")

        names = getattr(payload, "names", []) or []
        last_dir = None
        saved = 0
        for i, tensor in enumerate(images):
            suffix = names[i] if i < len(names) else ""
            dest = build_output_path(payload.base_root, payload.output_path, payload.output_name, suffix or "")
            last_dir = os.path.dirname(dest)
            try:
                os.makedirs(last_dir, exist_ok=True)
                arr = (tensor[0].detach().clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
                Image.fromarray(arr).save(dest)
                saved += 1
            except Exception as exc:  # surface a bad write instead of silently skipping (#17)
                print(f"[JIP] failed to save {dest}: {exc}")
        # Log the absolute directory so the files are easy to locate (#17).
        print(f"[JIP] saved {saved}/{len(images)} image(s) under {os.path.abspath(last_dir) if last_dir else '<none>'}")

        # Output grid: batch the images that share the first image's H/W.
        first = images[0]
        batch = [t for t in images if t.shape[1:] == first.shape[1:]]
        preview = torch.cat(batch, dim=0) if len(batch) > 1 else first
        return io.NodeOutput(ui=ui.PreviewImage(preview, cls=cls))
