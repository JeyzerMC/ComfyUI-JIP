# ComfyUI-JIP

Composable image-preprocessing nodes for ComfyUI. Turn a source image into a set
of named controlnet-preprocessor images saved to disk, through a chain of optional
nodes so you only run the steps you need:

```
JIP Load → [JIP RMBG] → [JIP Resize] → [JIP CNet Preprocess] → JIP Save
```

Every node passes a single **JIP payload** on its primary pin (images + their
output-name suffixes, working dimensions, and the destination base/path/name), so
steps are optional and reorderable — connect `JIP Load → JIP Resize` directly if
you don't need background removal, etc.

## Nodes

| Node | Purpose |
|---|---|
| **JIP Load** | Select a source image; set `output_name`, `output_path` (default `input/cnets/`), and base directory (Comfy Install / Extra Path). Emits `IMAGE` + payload. |
| **JIP RMBG** | Remove the background via `rembg` (U²-Net); composite onto white/black/gray; stored as the payload's `_alt` image. |
| **JIP Resize** | Resize/crop every working image to exact target dims — `cover` (scale shortest edge + center-crop) or `stretch`. |
| **JIP CNet Preprocess** | Run selected controlnet preprocessors (DepthAnythingV2, DWPose, HED, DensePose, CannyEdge, LineArt; Manga2Anime/OpenPose off by default) via `comfyui_controlnet_aux`; appends one suffixed image each. |
| **JIP Save** | Write every payload image to `<base>/<output_path>/<output_name><suffix>.png` and show the output grid. |

### Base directory resolution
- **Comfy Install** → the ComfyUI install root.
- **Extra Path** → the first `base_path:` declared in `extra_model_paths.yaml`
  (falls back to the ComfyUI root when none is configured).

## Worked example

Load a Jojo pose image with `output_name = jjba/josuke`, base `Extra Path`,
`output_path = input/cnets/`, run RMBG + Resize, and CNet Preprocess with the
default six preprocessors. JIP Save writes, under `<extra base>/input/cnets/jjba/`:

```
josuke.png                 # base (resized)
josuke_alt.png             # background-removed
josuke_depthanythingv2.png
josuke_dwpose.png
josuke_hed.png
josuke_densepose.png
josuke_cannyedge.png
josuke_lineart.png
```

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/JeyzerMC/ComfyUI-JIP
pip install -r ComfyUI-JIP/requirements.txt   # Pillow, numpy, rembg
```

**JIP CNet Preprocess** additionally requires
[`comfyui_controlnet_aux`](https://github.com/Fannovel16/comfyui_controlnet_aux)
(Apache-2.0) installed in `custom_nodes/` — it is invoked at runtime, **not**
bundled. JIP RMBG uses `rembg` (MIT; default U²-Net weights Apache-2.0).

## License

[MIT](LICENSE). Third-party runtime dependencies and their licenses are listed in
[NOTICE](NOTICE).
