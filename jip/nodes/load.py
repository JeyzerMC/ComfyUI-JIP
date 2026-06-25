"""JIP Load node — load a source image and emit the JIP payload (#2).

The source is chosen by absolute path, not ComfyUI's upload widget (#42): the
custom Browse overlay (web/jip-browse.js, backed by /jip/browse + /jip/thumb)
lets the user pick any image on disk, and the node reads its pixels straight
from that path. Because nothing is uploaded, ComfyUI never copies the file into
its ``input/`` dir — so consume can delete the one real file outright.
"""

from __future__ import annotations

import os

import numpy as np
import torch
from PIL import Image, ImageOps

import node_helpers
from comfy_api.v0_0_2 import io

from ..payload import JIPPayload, JIPPayloadIO


class JIPLoad(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPLoad",
            display_name="JIP Load",
            category="JIP",
            description="Load a source image by absolute path (pick it with Browse) and set its output name and output path.",
            inputs=[
                io.String.Input(
                    "image_path",
                    default="",
                    # The *folder* holding the source image (set by the Browse
                    # overlay; also hand-typable). Kept separate from the file
                    # name so Browse can still reopen the folder after consume
                    # deletes the file (#42).
                    tooltip="Folder containing the source image. Use Browse to pick any image on disk — it is read in place, never copied into ComfyUI's input/.",
                ),
                io.String.Input(
                    "image_name",
                    default="",
                    # The file name within image_path; surfaced on-node as a grey
                    # label under the preview, not as an editable field (#42).
                    tooltip="Source image file name (set by Browse).",
                ),
                io.Boolean.Input(
                    "consume",
                    default=False,
                    socketless=True,  # no input pin — driven by the on-node toggle (#24)
                    tooltip="After a successful JIP Save, delete the source file from disk (the base copy is kept as the _1_base output).",
                ),
                io.String.Input("output_name", default="", tooltip="e.g. jjba/josuke"),
                io.String.Input("output_path", default="input/cnets/"),
            ],
            outputs=[
                # The image travels inside the payload, so no separate image pin
                # is needed — downstream JIP nodes read it from there (#8).
                JIPPayloadIO.Output("payload"),
            ],
        )

    @staticmethod
    def _full_path(image_path: str, image_name: str) -> str:
        """Join the folder + file name into one source path.

        If no name is given the folder field is treated as a full file path —
        so a hand-pasted absolute path still works (#42).
        """
        folder = (image_path or "").strip()
        name = (image_name or "").strip()
        return os.path.join(folder, name) if name else folder

    @classmethod
    def validate_inputs(cls, image_path: str, image_name: str = "", **kwargs):
        full = cls._full_path(image_path, image_name)
        if not full or not os.path.isfile(full):
            return f"Invalid image file: {full or '(none selected)'}"
        return True

    @classmethod
    def fingerprint_inputs(cls, image_path: str, image_name: str, consume: bool, output_name: str, output_path: str):
        full = cls._full_path(image_path, image_name)
        mtime = os.path.getmtime(full) if full and os.path.exists(full) else 0
        return (full, mtime, consume, output_name, output_path)

    @classmethod
    def execute(cls, image_path: str, image_name: str, consume: bool, output_name: str, output_path: str) -> io.NodeOutput:
        image_path = os.path.realpath(cls._full_path(image_path, image_name))
        # Read the pixels inside a context manager so the source file handle is
        # released before the payload travels downstream. A lingering handle
        # blocks consume's os.remove on Windows, which made external-drive
        # sources look "copied not moved" rather than moved (#37).
        with node_helpers.pillow(Image.open, image_path) as opened:
            img = node_helpers.pillow(ImageOps.exif_transpose, opened)
            rgb = img.convert("RGB")
            arr = np.array(rgb).astype(np.float32) / 255.0
            width, height = rgb.size
        tensor = torch.from_numpy(arr)[None,]

        payload = JIPPayload(
            images=[tensor],
            names=[""],
            dims=(width, height),
            # base_root defaults to the Comfy install root (the base_dir field was
            # removed — #33); JIP Save always writes under the install root.
            output_path=(output_path or "input/cnets/").strip(),
            output_name=output_name.strip(),
            consume=bool(consume),
            source_path=image_path,
        )
        # No ui.PreviewImage here: the on-node Browse preview already shows the
        # selected image (with its filename + dimensions), so emitting a second
        # post-run preview would duplicate it (#42).
        return io.NodeOutput(payload)
