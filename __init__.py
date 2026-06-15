"""ComfyUI-JIP extension entrypoint (V3)."""

from comfy_api.v0_0_2 import io, ComfyExtension

from .jip.nodes import NODES

WEB_DIRECTORY = "./web"


class JIPExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return NODES


def comfy_entrypoint() -> ComfyExtension:
    return JIPExtension()
