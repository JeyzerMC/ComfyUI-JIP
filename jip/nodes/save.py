"""JIP Save node (stub — implemented in #3)."""

from comfy_api.v0_0_2 import io


class JIPSave(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPSave",
            display_name="JIP Save",
            category="JIP",
            description="Write the image(s) to <base>/<output_path>/<output_name><suffix>.png and show an output grid.",
            inputs=[
                io.Image.Input("image"),
            ],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image: io.Image.Type) -> io.NodeOutput:
        raise NotImplementedError("JIP Save not yet implemented (#3)")
