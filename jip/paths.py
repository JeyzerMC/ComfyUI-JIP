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
import re

import folder_paths

# Category key registered in jip/__init__.py.
FOLDER_KEY = "jip"

# The role-suffix part of a JIP file name (always begins with "_"): one of
# _0_cover / _1_base / _2_prep / _3_<preproc>.
_ROLE_PART = r"_(?:0_cover|1_base|2_prep|3_\w+)"


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
    """Selectable base roots as ``[{index, label, path}]``.

    The Comfy install root is labelled "Comfy Install" (it resolves to the
    actual install folder on disk, not a folder literally named that). Every
    *other* registered root — i.e. any ``jip:`` entry in ``extra_model_paths.yaml``
    — is labelled "Extra Path: <disk path>" so the user can tell exactly where it
    points (#23). Always returns at least the Comfy install root.

    Earlier this only kept the first under-install root and dropped any others;
    now only the root that *equals* the install root is "Comfy Install" and
    everything else (including an extra path that happens to live under the
    install) is surfaced as its own Extra Path.
    """
    base = os.path.realpath(comfy_root())
    comfy: dict | None = None
    extra: list[dict] = []
    for root in _registered_roots():
        if os.path.realpath(root) == base and comfy is None:
            comfy = {"label": "Comfy Install", "path": root}
        else:
            extra.append({"path": root})

    entries: list[dict] = [comfy or {"label": "Comfy Install", "path": comfy_root()}]
    for e in extra:
        fwd = e["path"].replace("\\", "/").rstrip("/")
        e["label"] = f"Extra Path: {fwd}"
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


def output_dir_and_stem(output_path: str, output_name: str) -> tuple[str, str]:
    """Resolve the directory that holds a save and the file stem.

    The destination is ``output_path`` directly (#33): no install-root prefix —
    ``output_path`` may be relative (to the working directory) or absolute (any
    disk). ``output_name`` may contain subfolders (e.g. ``jjba/josuke``): the
    subfolder part joins the directory, the last segment is the stem.
    """
    rel = output_name.strip().lstrip("/\\")
    name_dir, stem = os.path.split(rel)
    base = (output_path or "").strip()
    directory = os.path.normpath(os.path.join(base, name_dir))
    return directory, stem


def next_increment(directory: str, stem: str) -> int:
    """Lowest free 3-digit increment for ``<NNN>_<stem>_<role>.png`` in directory.

    The increment is a leading prefix (#23): files are named
    ``<NNN>_<stem><role>.png`` (e.g. ``000_josuke_0_cover.png``). Returns
    ``max(existing) + 1`` (or 0 when none exist) so an identical re-save of the
    same name advances to the next slot (#17). Files written under the old
    trailing-increment convention are not matched and won't be counted.
    """
    if not os.path.isdir(directory):
        return 0
    pat = re.compile(r"^(\d{3})_" + re.escape(stem) + _ROLE_PART + r"\.png$")
    highest = -1
    try:
        for f in os.listdir(directory):
            m = pat.match(f)
            if m:
                highest = max(highest, int(m.group(1)))
    except OSError:
        return 0
    return highest + 1
