"""ComfyUI-JIP: composable image-preprocessing nodes."""

from .nodes import NODES
from . import server  # noqa: F401  — registers the /jip/* aiohttp routes (#9)

__all__ = ["NODES"]
