"""Pause / await / resume handshake for interactive JIP nodes (#22).

A node calls :func:`request`, which persists preview images to the ComfyUI temp
dir, pushes a ``jip-interactive`` websocket event to the frontend, and blocks the
execution thread on a ``threading.Event``. The frontend opens an overlay and,
on confirm/cancel, POSTs to ``/jip/interactive/resolve`` (or ``/cancel``), which
calls :func:`resolve` to store the result and unblock the node.

This is safe because ``send_sync`` and the aiohttp resume route run on the server
event loop while the prompt executes on a separate worker thread — the blocking
wait never stalls the loop, so even a single interactive node resolves cleanly.
"""

from __future__ import annotations

import base64
import io as _io
import os
import threading
import uuid

import numpy as np
from PIL import Image

import folder_paths
from server import PromptServer

_EVENTS: dict[str, threading.Event] = {}
_RESULTS: dict[str, dict] = {}
_LOCK = threading.Lock()


def _save_temp(tensor) -> dict:
    """Write one [1,H,W,C] tensor to the temp dir and return a /view ref + dims."""
    arr = (tensor[0].detach().clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
    pil = Image.fromarray(arr)
    temp = folder_paths.get_temp_directory()
    os.makedirs(temp, exist_ok=True)
    name = f"jip_int_{uuid.uuid4().hex[:12]}.png"
    pil.save(os.path.join(temp, name))
    return {"filename": name, "subfolder": "", "type": "temp", "width": pil.width, "height": pil.height}


def request(kind: str, images: list, extra: dict | None = None, timeout: float = 600.0) -> dict:
    """Pause the node, show an overlay of ``images``, and return the user's result.

    ``kind`` selects the frontend overlay (e.g. "rmbg", "resize"). ``extra`` is
    merged into the event (labels, default dims, …). Raises on timeout/cancel so
    the node fails cleanly instead of silently continuing.
    """
    token = uuid.uuid4().hex
    event = threading.Event()
    with _LOCK:
        _EVENTS[token] = event

    message = {
        "token": token,
        "kind": kind,
        "images": [_save_temp(t) for t in images],
    }
    if extra:
        message.update(extra)
    PromptServer.instance.send_sync("jip-interactive", message)

    completed = event.wait(timeout)
    with _LOCK:
        _EVENTS.pop(token, None)
        result = _RESULTS.pop(token, None)

    if not completed:
        raise RuntimeError(f"JIP interactive ({kind}) timed out after {timeout:.0f}s")
    if result is None or result.get("cancelled"):
        raise RuntimeError(f"JIP interactive ({kind}) was cancelled")
    return result


def resolve(token: str, result: dict) -> bool:
    """Store the frontend result and unblock the waiting node. False if unknown."""
    with _LOCK:
        event = _EVENTS.get(token)
        if event is None:
            return False
        _RESULTS[token] = result or {}
    event.set()
    return True


def cancel(token: str) -> bool:
    """Cancel a pending request so the node raises and the prompt stops."""
    return resolve(token, {"cancelled": True})


def decode_image(data_url: str):
    """Decode a base64 PNG/JPEG data URL into a [1,H,W,C] float tensor in [0,1]."""
    import torch  # local: keep module import light

    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    raw = base64.b64decode(data_url)
    pil = Image.open(_io.BytesIO(raw)).convert("RGB")
    arr = np.array(pil).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]
