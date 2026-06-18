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
| **JIP Load** | Select a source image; set `output_name`, `output_path` (default `input/cnets/`), and base directory. `Consume` moves the source (deleted after a successful save) instead of copying. Emits the payload. |
| **JIP RMBG** | Multi-select background-removal models (`rembg` / U²-Net). Runs every selected model, **pauses**, and an overlay lets you pick one result and retouch it (eraser + magic-fill to the background colour). The confirmed image becomes the working/`_alt` image. |
| **JIP Resize** | Carries only Portrait/Landscape default dims. On run it **pauses** and a crop/resize overlay draws an outline at the default dims for the image's orientation, offering fit-to-outline, crop-to-outline (aspect-locked drag), and stretch. |
| **JIP CNet Preprocess** | Run selected controlnet preprocessors (DepthAnythingV2, DWPose, HED, DensePose, CannyEdge, LineArt; Manga2Anime/OpenPose off by default) via `comfyui_controlnet_aux`; appends one suffixed image each. |
| **JIP Save** | Write the role images (cover/base/prep + one per preprocessor) under `<base>/<output_path>/` with a collision-safe increment, and show a labelled grid (filename + full path on hover + dims). |

### Base directory resolution
JIP registers a `jip` folder category, so its base roots are enumerated the same
way comfyui-flakes enumerates its roots:

- **Comfy Install** → the ComfyUI install root (always available).
- **Extra Path N** → any extra root contributed by a `jip:` key in
  `extra_model_paths.yaml`. ComfyUI joins that key onto the block's `base_path`:

  ```yaml
  my_extra:
    base_path: D:/AI
    jip: cnets        # -> base root "Extra Path 1" = D:/AI/cnets
  ```

  Without a `jip:` entry only **Comfy Install** is offered (same requirement as
  flakes' `flakes:`/`model_presets:` keys).

## Worked example

Load a Jojo pose image with `output_name = jjba/josuke`, `output_path =
input/cnets/`, run Resize (crop overlay) + RMBG (pick + retouch), and CNet
Preprocess with the default six preprocessors. JIP Save writes, under
`<base>/input/cnets/jjba/` (shared increment `000`, then `001`, …):

```
josuke_0_cover_000.png            # copy of the original base (placeholder cover)
josuke_1_base_000.png             # the original, untouched image from JIP Load
josuke_2_prep_000.png             # the filtered/working image (after Resize + RMBG)
josuke_3_depthanythingv2_000.png
josuke_3_dwpose_000.png
josuke_3_hed_000.png
josuke_3_densepose_000.png
josuke_3_cannyedge_000.png
josuke_3_lineart_000.png
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
