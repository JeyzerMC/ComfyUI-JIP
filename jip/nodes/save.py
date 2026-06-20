"""JIP Save node — write payload images to disk with role-based names (#3, #17)."""

from __future__ import annotations

import os
import uuid

import numpy as np
from PIL import Image

import folder_paths
from comfy_api.v0_0_2 import io

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
        written: list[tuple[str, "torch.Tensor"]] = []  # (dest, tensor)
        saved = 0
        for role_suffix, tensor in roles:
            dest = os.path.join(directory, f"{nnn}_{stem}{role_suffix}.png")
            try:
                _to_pil(tensor).save(dest)
                written.append((dest, tensor))
                saved += 1
            except Exception as exc:  # surface a bad write instead of silently skipping (#17)
                print(f"[JIP] failed to save {dest}: {exc}")
        print(f"[JIP] saved {saved}/{len(roles)} image(s) under {os.path.abspath(directory)} (increment {nnn})")

        # Consume: move (not copy) the source — only after EVERY role wrote cleanly,
        # so a partial/failed save never deletes the original (#20).
        if getattr(payload, "consume", False) and saved == len(roles):
            src = getattr(payload, "source_path", "") or ""
            if src and os.path.isfile(src):
                try:
                    os.remove(src)
                    print(f"[JIP] consumed source image (moved): {src}")
                except Exception as exc:
                    print(f"[JIP] consume failed to delete {src}: {exc}")

        if not written:
            return io.NodeOutput()

        # Labelled grid: serve a temp copy of each written image for display, and
        # ship the real dest filename / path / dims alongside so the frontend can
        # label each cell (filename + full path on hover + dims) and show the
        # batch directory below — like Flake Generate (#18). Custom keys avoid the
        # default image-preview handler. execution.py flattens each ui value, so
        # every value must be a list.
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        images_ui: list[dict] = []
        meta: list[dict] = []
        for dest, tensor in written:
            pil = _to_pil(tensor)
            tmp = f"jip_{uuid.uuid4().hex[:12]}.png"
            try:
                pil.save(os.path.join(temp_dir, tmp))
            except Exception as exc:
                print(f"[JIP] failed to write preview for {dest}: {exc}")
                continue
            images_ui.append({"filename": tmp, "subfolder": "", "type": "temp"})
            meta.append({
                "filename": os.path.basename(dest),
                "path": os.path.abspath(dest),
                "width": pil.width,
                "height": pil.height,
            })

        return io.NodeOutput(ui={
            "jip_images": images_ui,
            "jip_meta": meta,
            "jip_dir": [os.path.abspath(directory)],
        })
