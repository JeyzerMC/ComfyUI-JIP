"""Destination-path resolution for JIP nodes (#3).

Two base roots, chosen on JIP Load:
- "comfy_install" -> the ComfyUI install root (folder_paths.base_path).
- "extra_path"    -> the first `base_path:` declared in extra_model_paths.yaml
                     (falls back to the ComfyUI root when none is configured).

Final files land at:  <base_root>/<output_path>/<output_name><suffix>.png
"""

from __future__ import annotations

import os

import yaml

import folder_paths


def comfy_root() -> str:
    return folder_paths.base_path


def _candidate_yaml_paths() -> list[str]:
    paths = [os.path.join(folder_paths.base_path, "extra_model_paths.yaml")]
    try:
        paths.append(os.path.join(folder_paths.get_user_directory(), "extra_model_paths.yaml"))
    except Exception:
        pass
    return paths


def extra_root() -> str | None:
    """First `base_path` declared in an extra_model_paths.yaml, or None."""
    for path in _candidate_yaml_paths():
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as stream:
                config = yaml.safe_load(stream) or {}
        except Exception:
            continue
        for conf in config.values():
            if isinstance(conf, dict) and conf.get("base_path"):
                base = os.path.expandvars(os.path.expanduser(str(conf["base_path"])))
                if not os.path.isabs(base):
                    base = os.path.abspath(os.path.join(os.path.dirname(path), base))
                return base
    return None


def resolve_base(base_root: str) -> str:
    if base_root == "extra_path":
        return extra_root() or comfy_root()
    return comfy_root()


def build_output_path(base_root: str, output_path: str, output_name: str, suffix: str) -> str:
    """Absolute path for one output image, normalized."""
    rel = output_name.strip().lstrip("/\\")
    rel_path = (output_path or "").strip().strip("/\\")
    full = os.path.join(resolve_base(base_root), rel_path, f"{rel}{suffix}.png")
    return os.path.normpath(full)
