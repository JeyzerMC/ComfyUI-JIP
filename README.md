# ComfyUI-JIP

Composable image-preprocessing nodes for ComfyUI. Turn a source image into a set
of named controlnet-preprocessor images saved to disk, through a chain of optional
nodes so you only run the steps you need:

```
JIP Load → [JIP RMBG] → [JIP Resize] → [JIP CNet Preprocess] → JIP Save
```

## Nodes

| Node | Purpose |
|---|---|
| **JIP Load** | Load a source image; set output name, output path, and base directory. |
| **JIP RMBG** | Remove the background (permissive backend — not the GPL `comfyui-rmbg`). |
| **JIP Resize** | Resize/crop to target dimensions with an interactive overlay. |
| **JIP CNet Preprocess** | Run selected controlnet preprocessors (DepthAnythingV2, DWPose, HED, DensePose, CannyEdge, LineArt, Manga2Anime, OpenPose). |
| **JIP Save** | Write each image to `<base>/<output_path>/<output_name><suffix>.png` and show an output grid. |

## Status

🚧 Early development. Nodes are scaffolded; functionality is being implemented
issue-by-issue — see the [project board](https://github.com/users/JeyzerMC/projects/7).

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/JeyzerMC/ComfyUI-JIP
```

Controlnet preprocessing (JIP CNet Preprocess) calls
[`comfyui_controlnet_aux`](https://github.com/Fannovel16/comfyui_controlnet_aux)
(Apache-2.0) at runtime — install it separately. It is **not** bundled.

## License

[MIT](LICENSE). See NOTICE (added with the controlnet/RMBG integration) for
third-party attributions.
