"""ComfyUI-JIP: composable image-preprocessing nodes."""

import folder_paths

from .paths import FOLDER_KEY

# Register a `jip` folder category (flakes-style) so ComfyUI's
# extra_model_paths.yaml loader auto-adds extra base roots for a `jip:` key.
# The default root is the Comfy install root, so "Comfy Install" behaves exactly
# as before; configuring a `jip:` entry adds an "Extra Path N" (#19).
_default = folder_paths.base_path
if FOLDER_KEY in folder_paths.folder_names_and_paths:
    _paths, _exts = folder_paths.folder_names_and_paths[FOLDER_KEY]
    if _default not in _paths:
        _paths.append(_default)
else:
    folder_paths.folder_names_and_paths[FOLDER_KEY] = ([_default], set())

from .nodes import NODES  # noqa: E402
from . import server  # noqa: E402,F401  — registers the /jip/* aiohttp routes

__all__ = ["NODES"]
