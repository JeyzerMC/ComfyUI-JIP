"""JIP Save node — write payload images to disk with role-based names (#3, #17)."""

from __future__ import annotations

import os

import numpy as np
import torch
from PIL import Image

from comfy_api.v0_0_2 import io, ui

from ..payload import JIPPayloadIO
from ..paths import output_dir_and_stem, next_increment


def _to_pil(tensor) -> Image.Image:
    arr = (tensor[0].detach().clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
    return Image.fromarray(arr)


def _plan_roles(payload) -> list[tuple[str, "torch.Tensor"]]:
    """The ordered (role-suffix, tensor) files for one save.

    0_cover (copy of base) · 1_base (original) · 2_prep (working/filtered, a copy
    of base when no Resize/RMBG ran) · 3_<preproc> per preprocessor output.
    """
    base = payload.base_image()
    prep = payload.working_image()
    roles: list[tuple[str, torch.Tensor]] = [
        ("_0_cover", base),
        ("_1_base", base),
        ("_2_prep", prep),
    ]
    for name, img in payload.preprocessor_outputs():
        roles.append((f"_3_{name}", img))
    return roles


class JIPSave(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPSave",
            display_name="JIP Save",
            category="JIP",
            description="Write cover/base/prep/preprocessor images to <base>/<output_path>/ with a collision-safe increment, and show an output grid.",
            inputs=[
                JIPPayloadIO.Input("payload"),
            ],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, payload) -> io.NodeOutput:
        if payload is None or not getattr(payload, "images", None):
            return io.NodeOutput()
        if not getattr(payload, "output_name", "").strip():
            raise ValueError("JIP Save: output_name is empty — set it on JIP Load.")

        directory, stem = output_dir_and_stem(payload.base_root, payload.output_path, payload.output_name)
        inc = next_increment(directory, stem)
        nnn = f"{inc:03d}"

        os.makedirs(directory, exist_ok=True)
        roles = _plan_roles(payload)
        written: list["torch.Tensor"] = []
        saved = 0
        for role_suffix, tensor in roles:
            dest = os.path.join(directory, f"{stem}{role_suffix}_{nnn}.png")
            try:
                _to_pil(tensor).save(dest)
                written.append(tensor)
                saved += 1
            except Exception as exc:  # surface a bad write instead of silently skipping (#17)
                print(f"[JIP] failed to save {dest}: {exc}")
        print(f"[JIP] saved {saved}/{len(roles)} image(s) under {os.path.abspath(directory)} (increment {nnn})")

        # Output grid: batch the written images that share the first one's H/W.
        if not written:
            return io.NodeOutput()
        first = written[0]
        batch = [t for t in written if t.shape[1:] == first.shape[1:]]
        preview = torch.cat(batch, dim=0) if len(batch) > 1 else first
        return io.NodeOutput(ui=ui.PreviewImage(preview, cls=cls))
