"""JIP RMBG node (stub — implemented in #6)."""

from comfy_api.v0_0_2 import io


class JIPRMBG(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPRMBG",
            display_name="JIP RMBG",
            category="JIP",
            description="Remove the background from the working image (permissive backend).",
            inputs=[
                io.Image.Input("image"),
            ],
            outputs=[
                io.Image.Output("image"),
            ],
        )

    @classmethod
    def execute(cls, image: io.Image.Type) -> io.NodeOutput:
        raise NotImplementedError("JIP RMBG not yet implemented (#6)")
