"""JIP CNet Preprocess node — run controlnet preprocessors (#5).

Soft-depends on `comfyui_controlnet_aux` (Apache-2.0): its preprocessor node
classes are imported and invoked at runtime; nothing is vendored. Each enabled
preprocessor appends one suffixed image (e.g. "_depthanythingv2") to the payload.
"""

from __future__ import annotations

import importlib

import torch

from comfy_api.v0_0_2 import io

from ..payload import JIPPayloadIO

# label -> (controlnet_aux node-class key, default-on)
PREPROCESSORS = [
    ("DepthAnythingV2", "DepthAnythingV2Preprocessor", True),
    ("DWPose", "DWPreprocessor", True),
    ("HED", "HEDPreprocessor", True),
    ("DensePose", "DensePosePreprocessor", True),
    ("CannyEdge", "CannyEdgePreprocessor", True),
    ("LineArt", "LineArtPreprocessor", True),
    ("Manga2Anime", "Manga2Anime_LineArt_Preprocessor", False),
    ("OpenPose", "OpenposePreprocessor", False),
]


def _load_cnet_mappings():
    for name in ("comfyui_controlnet_aux", "custom_nodes.comfyui_controlnet_aux"):
        try:
            module = importlib.import_module(name)
        except Exception:
            continue
        mappings = getattr(module, "NODE_CLASS_MAPPINGS", None)
        if mappings:
            return mappings
    return None


def _unwrap_image(result):
    """Pull the IMAGE tensor out of a preprocessor's return value.

    comfyui_controlnet_aux preprocessors are ComfyUI nodes: most return a plain
    ``(tensor,)`` tuple, but the pose ones (DWPose, OpenPose) return a UI-wrapped
    ``{"result": (tensor, ...), "ui": {...}}`` dict so they can emit pose JSON.
    The old code passed that dict straight through, so a later ``.shape`` access
    raised ``'dict' object has no attribute 'shape'`` (#5/#6). Unwrap both shapes
    and return the tensor (or None when there isn't one).
    """
    if isinstance(result, dict):
        result = result.get("result", result.get("images"))
    if isinstance(result, (tuple, list)):
        result = result[0] if result else None
    return result


def _working_image(payload):
    """The image preprocessors run on: the edited '_alt' entry if present, else base."""
    for img, nm in zip(payload.images, getattr(payload, "names", [])):
        if nm == "_alt":
            return img
    return payload.images[0]


class JIPCNetPreprocess(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPCNetPreprocess",
            display_name="JIP CNet Preprocess",
            category="JIP",
            description="Run the selected controlnet preprocessors (via comfyui_controlnet_aux) and append their outputs to the payload.",
            inputs=[
                JIPPayloadIO.Input("payload"),
                *[io.Boolean.Input(label, default=default) for label, _node, default in PREPROCESSORS],
            ],
            outputs=[
                JIPPayloadIO.Output("payload"),
            ],
        )

    @classmethod
    def execute(cls, payload, **toggles) -> io.NodeOutput:
        if payload is None or not getattr(payload, "images", None):
            raise ValueError("JIP CNet Preprocess: payload has no images (connect JIP Load).")

        selected = [(label, node) for label, node, default in PREPROCESSORS if toggles.get(label, default)]
        if not selected:
            return io.NodeOutput(payload)

        mappings = _load_cnet_mappings()
        if mappings is None:
            raise RuntimeError(
                "comfyui_controlnet_aux not found. Install it into custom_nodes "
                "(https://github.com/Fannovel16/comfyui_controlnet_aux) to use JIP CNet Preprocess."
            )

        src = _working_image(payload)
        dims = getattr(payload, "dims", (0, 0)) or (0, 0)
        resolution = max(dims) if max(dims) > 0 else 512

        out = payload.copy()
        for label, node_key in selected:
            node_cls = mappings.get(node_key)
            if node_cls is None:
                print(f"[JIP] controlnet_aux missing preprocessor '{node_key}' — skipping {label}")
                continue
            fn = getattr(node_cls(), node_cls.FUNCTION)
            try:
                result = fn(image=src, resolution=resolution)
            except Exception as exc:  # one bad preprocessor shouldn't sink the run
                print(f"[JIP] preprocessor {label} failed: {exc}")
                continue
            image = _unwrap_image(result)
            if not isinstance(image, torch.Tensor):
                print(f"[JIP] preprocessor {label} returned no image tensor — skipping")
                continue
            out.images.append(image)
            out.names.append(f"_{label.lower()}")

        # No on-node preview (#16) — outputs flow through the payload to JIP Save.
        # Log what was appended so e.g. HED/LineArt producing output is visible (#14).
        appended = out.names[len(payload.names):]
        print(f"[JIP] CNet appended {len(appended)} output(s): {appended}")
        return io.NodeOutput(out)
