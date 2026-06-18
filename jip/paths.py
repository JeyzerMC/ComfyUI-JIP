"""Destination-path resolution for JIP nodes (#3, #19).

Base roots are enumerated from a registered ``jip`` ``folder_paths`` category —
the same mechanism comfyui-flakes uses for its ``flakes``/``model_presets``
categories. The category's default dir is the ComfyUI install root, so:

- "Comfy Install" -> the ComfyUI install root (``folder_paths.base_path``).
- "Extra Path N"  -> any extra root contributed by a ``jip:`` key in
                     ``extra_model_paths.yaml`` (ComfyUI joins it onto that
                     block's ``base_path``). Without such a key only "Comfy
                     Install" is offered — exactly like flakes.

Final files land at:  <chosen base root>/<output_path>/<output_name><suffix>.png
"""

from __future__ import annotations

import os

import folder_paths

# Category key registered in jip/__init__.py.
FOLDER_KEY = "jip"


def comfy_root() -> str:
    return folder_paths.base_path


def _registered_roots() -> list[str]:
    try:
        roots = folder_paths.get_folder_paths(FOLDER_KEY)
    except Exception:
        roots = []
    if isinstance(roots, str):
        roots = [roots]
    return [r for r in roots if r and isinstance(r, str)]


def list_roots() -> list[dict]:
    """Selectable base roots as ``[{index, label, path}]`` (flakes parity).

    The first root under the Comfy install is "Comfy Install"; every other
    registered root becomes "Extra Path N". Always returns at least the Comfy
    install root.
    """
    base = os.path.realpath(comfy_root())
    comfy: dict | None = None
    extra: list[dict] = []
    for root in _registered_roots():
        real = os.path.realpath(root)
        if real == base or real.startswith(base + os.sep):
            if comfy is None:
                comfy = {"label": "Comfy Install", "path": root}
        else:
            extra.append({"label": "", "path": root})

    entries: list[dict] = [comfy or {"label": "Comfy Install", "path": comfy_root()}]
    for n, e in enumerate(extra, start=1):
        e["label"] = f"Extra Path {n}"
        entries.append(e)
    for idx, e in enumerate(entries):
        e["index"] = idx
    return entries


def root_labels() -> list[str]:
    return [e["label"] for e in list_roots()]


def resolve_base(base_dir: str) -> str:
    """Resolve a base_dir label (e.g. "Comfy Install", "Extra Path 1") to a path.

    Falls back to the Comfy install root. Accepts the legacy "Extra Path" /
    "extra_path" / "comfy_install" values from graphs saved before #19.
    """
    roots = list_roots()
    if base_dir in ("comfy_install", "Comfy Install", "", None):
        return roots[0]["path"]
    for e in roots:
        if e["label"] == base_dir:
            return e["path"]
    if base_dir in ("extra_path",) or str(base_dir).startswith("Extra Path"):
        extras = [e for e in roots if e["label"].startswith("Extra Path")]
        if extras:
            return extras[0]["path"]
    return roots[0]["path"]


def build_output_path(base_dir: str, output_path: str, output_name: str, suffix: str) -> str:
    """Absolute path for one output image, normalized."""
    rel = output_name.strip().lstrip("/\\")
    rel_path = (output_path or "").strip().strip("/\\")
    full = os.path.join(resolve_base(base_dir), rel_path, f"{rel}{suffix}.png")
    return os.path.normpath(full)
