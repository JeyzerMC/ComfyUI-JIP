"""JIP Load node (stub — implemented in #2)."""

from comfy_api.v0_0_2 import io


class JIPLoad(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPLoad",
            display_name="JIP Load",
            category="JIP",
            description="Load a source image and set its output name/path/base directory.",
            inputs=[
                io.String.Input("output_name", default="", placeholder="e.g. jjba/josuke"),
                io.String.Input("output_path", default="cnets/"),
                io.Combo.Input("base_dir", options=["Comfy Install", "Extra Path"]),
            ],
            outputs=[
                io.Image.Output("image"),
            ],
        )

    @classmethod
    def execute(cls, output_name: str, output_path: str, base_dir: str) -> io.NodeOutput:
        raise NotImplementedError("JIP Load not yet implemented (#2)")
