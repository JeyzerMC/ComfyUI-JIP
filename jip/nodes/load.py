"""JIP Load node — load a source image and emit the JIP payload (#2)."""

from __future__ import annotations

import os

import numpy as np
import torch
from PIL import Image, ImageOps

import folder_paths
import node_helpers
from comfy_api.v0_0_2 import io, ui

from ..payload import JIPPayload, JIPPayloadIO

BASE_DIR_OPTIONS = ["Comfy Install", "Extra Path"]
_BASE_ROOT_BY_LABEL = {"Comfy Install": "comfy_install", "Extra Path": "extra_path"}


class JIPLoad(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["image"])
        return io.Schema(
            node_id="JIPLoad",
            display_name="JIP Load",
            category="JIP",
            description="Load a source image and set its output name, output path, and base directory.",
            inputs=[
                io.Combo.Input(
                    "image",
                    options=sorted(files),
                    upload=io.UploadType.image,
                    image_folder=io.FolderType.input,
                    tooltip="Source image to preprocess.",
                ),
                io.String.Input("output_name", default="", tooltip="e.g. jjba/josuke"),
                io.String.Input("output_path", default="input/cnets/"),
                io.Combo.Input(
                    "base_dir",
                    options=BASE_DIR_OPTIONS,
                    tooltip="Destination root used by JIP Save: Comfy install or an extra model path.",
                ),
            ],
            outputs=[
                io.Image.Output("image"),
                JIPPayloadIO.Output("payload"),
            ],
        )

    @classmethod
    def validate_inputs(cls, image: str, **kwargs):
        if not image or not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True

    @classmethod
    def fingerprint_inputs(cls, image: str, output_name: str, output_path: str, base_dir: str):
        path = folder_paths.get_annotated_filepath(image)
        mtime = os.path.getmtime(path) if os.path.exists(path) else 0
        return (image, mtime, output_name, output_path, base_dir)

    @classmethod
    def execute(cls, image: str, output_name: str, output_path: str, base_dir: str) -> io.NodeOutput:
        image_path = folder_paths.get_annotated_filepath(image)
        img = node_helpers.pillow(Image.open, image_path)
        img = node_helpers.pillow(ImageOps.exif_transpose, img)
        rgb = img.convert("RGB")
        arr = np.array(rgb).astype(np.float32) / 255.0
        tensor = torch.from_numpy(arr)[None,]
        width, height = rgb.size

        payload = JIPPayload(
            images=[tensor],
            names=[""],
            dims=(width, height),
            base_root=_BASE_ROOT_BY_LABEL.get(base_dir, "comfy_install"),
            output_path=(output_path or "input/cnets/").strip(),
            output_name=output_name.strip(),
        )
        return io.NodeOutput(tensor, payload, ui=ui.PreviewImage(tensor, cls=cls))
