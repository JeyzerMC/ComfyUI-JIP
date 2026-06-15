"""JIP Resize node (stub — implemented in #4)."""

from comfy_api.v0_0_2 import io


class JIPResize(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPResize",
            display_name="JIP Resize",
            category="JIP",
            description="Resize and crop the working image to target dimensions.",
            inputs=[
                io.Image.Input("image"),
                io.Int.Input("width", default=853, min=1, max=8192),
                io.Int.Input("height", default=1440, min=1, max=8192),
            ],
            outputs=[
                io.Image.Output("image"),
            ],
        )

    @classmethod
    def execute(cls, image: io.Image.Type, width: int, height: int) -> io.NodeOutput:
        raise NotImplementedError("JIP Resize not yet implemented (#4)")
