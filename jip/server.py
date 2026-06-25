"""aiohttp routes for the JIP frontend.

Exposes the enumerated base roots so JIP Load can offer them as a dropdown and
show the real resolved paths (e.g. "Comfy Install: C:/.../ComfyUI"). Roots come
from the registered `jip` folder category, so extra roots configured via a
`jip:` key in extra_model_paths.yaml appear automatically (#9, #19).
"""

from __future__ import annotations

import io as _io
import logging
import os
import re
import string
import subprocess
import sys

from aiohttp import web
from PIL import Image, ImageOps

from server import PromptServer

from . import interactive
from .paths import list_roots

# Extensions the Browse overlay treats as selectable source images (#42).
_IMAGE_EXTS = {
    ".png", ".jpg", ".jpeg", ".jfif", ".webp", ".bmp", ".gif",
    ".tif", ".tiff", ".avif", ".ppm",
}


def _is_image(name: str) -> bool:
    return os.path.splitext(name)[1].lower() in _IMAGE_EXTS


def _natural_key(name: str):
    """Fallback sort key (non-Windows): name ascending, numbers compared numeric.

    Splits digit runs out so "img2" sorts before "img10". Windows uses the real
    Explorer comparator instead — see ``_sort_names`` (#42).
    """
    return [int(tok) if tok.isdigit() else tok.lower()
            for tok in re.split(r"(\d+)", name)]


# On Windows, sort exactly like File Explorer by delegating to the same OS
# comparator it uses (StrCmpLogicalW in shlwapi). This reproduces Explorer's
# precise treatment of leading zeros, punctuation and case — which a hand-rolled
# natural sort can't fully match (#42). Falls back to _natural_key elsewhere.
try:
    if sys.platform.startswith("win"):
        import ctypes
        from functools import cmp_to_key

        _StrCmpLogicalW = ctypes.windll.shlwapi.StrCmpLogicalW
        _StrCmpLogicalW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
        _StrCmpLogicalW.restype = ctypes.c_int
        _EXPLORER_CMP = cmp_to_key(lambda a, b: _StrCmpLogicalW(a, b))
    else:
        _EXPLORER_CMP = None
except Exception:  # pragma: no cover - missing DLL / unexpected platform
    _EXPLORER_CMP = None


def _sort_names(entries: list[dict]) -> None:
    """Sort ``[{name, path}, …]`` in place to match the OS file explorer."""
    if _EXPLORER_CMP is not None:
        entries.sort(key=lambda e: _EXPLORER_CMP(e["name"]))
    else:
        entries.sort(key=lambda e: _natural_key(e["name"]))


def _windows_drives() -> list[dict]:
    """Existing drive roots (C:\\, D:\\, …) as folder entries — Windows only."""
    return [
        {"name": f"{d}:", "path": f"{d}:\\"}
        for d in string.ascii_uppercase
        if os.path.exists(f"{d}:\\")
    ]

routes = PromptServer.instance.routes


@routes.get("/jip/roots")
async def _jip_roots(_request: web.Request) -> web.Response:
    return web.json_response({"roots": list_roots()})


@routes.post("/jip/reveal")
async def _jip_reveal(request: web.Request) -> web.Response:
    """Open the OS file explorer at a saved image, selecting it when possible.

    The client posts the absolute ``path`` of a saved file (JIP Save ships it as
    ``meta[i].path``). JIP Save writes under the user-chosen ``output_path``,
    which can be anywhere on disk (#33), so the only check is that the path
    points at an existing regular file.
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)
    path = (body.get("path") or "").strip() if isinstance(body, dict) else ""
    if not path:
        return web.json_response({"error": "missing 'path'"}, status=400)

    real_target = os.path.realpath(path)
    if not os.path.isfile(real_target):
        return web.json_response({"error": "file not found"}, status=404)

    try:
        if sys.platform.startswith("win"):
            subprocess.Popen(["explorer", "/select,", real_target])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", real_target])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(real_target)])
    except Exception as exc:
        logging.exception("[JIP] failed to reveal %s", real_target)
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"ok": True, "path": real_target})


@routes.post("/jip/interactive/resolve")
async def _jip_resolve(request: web.Request) -> web.Response:
    """Resume a paused interactive node with the user's overlay result (#22)."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)
    token = (body.get("token") or "").strip()
    if not token:
        return web.json_response({"error": "missing token"}, status=400)
    ok = interactive.resolve(token, body.get("result") or {})
    return web.json_response({"ok": ok})


@routes.post("/jip/interactive/cancel")
async def _jip_cancel(request: web.Request) -> web.Response:
    """Cancel a paused interactive node so its prompt stops cleanly (#22)."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)
    token = (body.get("token") or "").strip()
    if not token:
        return web.json_response({"error": "missing token"}, status=400)
    ok = interactive.cancel(token)
    return web.json_response({"ok": ok})


@routes.post("/jip/browse")
async def _jip_browse(request: web.Request) -> web.Response:
    """List subfolders and image files of a folder for the JIP Load picker (#42).

    The listing runs server-side (``os.listdir``), so it sees real absolute
    paths the browser file dialog can never expose — that is what lets JIP Load
    take a true on-disk path. An empty/invalid path lists drive roots on Windows
    (else the user's home). ``parent`` is the dir to climb to ("" -> drive list).
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    raw = (body.get("path") or "").strip() if isinstance(body, dict) else ""

    # Empty path -> drive roots (Windows) or home dir (elsewhere).
    if not raw:
        if sys.platform.startswith("win"):
            return web.json_response(
                {"dir": "", "parent": None, "folders": _windows_drives(), "images": []}
            )
        raw = os.path.expanduser("~")

    target = os.path.realpath(raw)
    # If a file slipped through, browse its containing folder.
    if os.path.isfile(target):
        target = os.path.dirname(target)
    if not os.path.isdir(target):
        return web.json_response({"error": f"not a folder: {raw}"}, status=404)

    folders: list[dict] = []
    images: list[dict] = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                try:
                    if entry.is_dir():
                        folders.append({"name": entry.name, "path": entry.path})
                    elif entry.is_file() and _is_image(entry.name):
                        images.append({"name": entry.name, "path": entry.path})
                except OSError:
                    continue  # unreadable entry (permissions, broken link) — skip
    except PermissionError:
        return web.json_response({"error": f"permission denied: {target}"}, status=403)
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)

    _sort_names(folders)
    _sort_names(images)

    # Parent: "" when at a drive root (-> climb to drive list); None when there
    # is genuinely no parent (POSIX filesystem root).
    parent = os.path.dirname(target)
    if parent == target:
        parent = "" if sys.platform.startswith("win") else None

    return web.json_response({"dir": target, "parent": parent, "folders": folders, "images": images})


@routes.get("/jip/thumb")
async def _jip_thumb(request: web.Request) -> web.Response:
    """Serve a downscaled thumbnail of any image on disk for the picker grid (#42).

    ComfyUI's built-in ``/view`` only serves its input/output/temp dirs, so
    arbitrary browse paths need their own thumbnail route. The image is decoded
    and shrunk server-side so the grid never ships full-res files.
    """
    path = (request.query.get("path") or "").strip()
    try:
        size = max(32, min(512, int(request.query.get("size", "144"))))
    except ValueError:
        size = 144
    if not path:
        return web.json_response({"error": "missing 'path'"}, status=400)

    real = os.path.realpath(path)
    if not os.path.isfile(real) or not _is_image(real):
        return web.json_response({"error": "image not found"}, status=404)

    try:
        with Image.open(real) as im:
            im = ImageOps.exif_transpose(im)
            im = im.convert("RGB")
            im.thumbnail((size, size))
            buf = _io.BytesIO()
            im.save(buf, format="JPEG", quality=82)
    except Exception as exc:
        logging.warning("[JIP] thumb failed for %s: %r", real, exc)
        return web.json_response({"error": "could not render thumbnail"}, status=500)

    return web.Response(
        body=buf.getvalue(),
        content_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@routes.get("/jip/imageinfo")
async def _jip_imageinfo(request: web.Request) -> web.Response:
    """Return the original {width, height} of an image on disk (#42).

    The on-node preview shows a downscaled thumbnail, so its pixel size isn't the
    real resolution — this reports the true dimensions (after EXIF orientation,
    matching how JIP Load actually reads the file).
    """
    path = (request.query.get("path") or "").strip()
    if not path:
        return web.json_response({"error": "missing 'path'"}, status=400)

    real = os.path.realpath(path)
    if not os.path.isfile(real) or not _is_image(real):
        return web.json_response({"error": "image not found"}, status=404)

    try:
        with Image.open(real) as im:
            im = ImageOps.exif_transpose(im)
            width, height = im.size
    except Exception as exc:
        logging.warning("[JIP] imageinfo failed for %s: %r", real, exc)
        return web.json_response({"error": "could not read image"}, status=500)

    return web.json_response({"width": width, "height": height})
