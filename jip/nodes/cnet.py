"""JIP CNet Preprocess node (stub — implemented in #5)."""

from comfy_api.v0_0_2 import io

# Preprocessor toggles. All on by default except Manga2Anime and OpenPose.
PREPROCESSORS = [
    ("DepthAnythingV2", True),
    ("DWPose", True),
    ("HED", True),
    ("DensePose", True),
    ("CannyEdge", True),
    ("LineArt", True),
    ("Manga2Anime", False),
    ("OpenPose", False),
]


class JIPCNetPreprocess(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="JIPCNetPreprocess",
            display_name="JIP CNet Preprocess",
            category="JIP",
            description="Run the selected controlnet preprocessors (via comfyui_controlnet_aux) on the working image.",
            inputs=[
                io.Image.Input("image"),
                *[io.Boolean.Input(name, default=default) for name, default in PREPROCESSORS],
            ],
            outputs=[
                io.Image.Output("image"),
            ],
        )

    @classmethod
    def execute(cls, image: io.Image.Type, **toggles) -> io.NodeOutput:
        raise NotImplementedError("JIP CNet Preprocess not yet implemented (#5)")
