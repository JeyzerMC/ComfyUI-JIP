// JIP Resize overlay (#26, #34): a freely resizable outline rectangle over the
// image (centered), with a uniform image-scale slider.
//   - Scale slider (left): uniformly resamples the source image, updating the
//     effective image dimensions; the outline keeps its dimensions and stays
//     centered on the image (a zoom inside a constant-size crop frame) (#38).
//   - The rectangle starts at the node's per-orientation dims (default_w/h),
//     centered, clamped to the image. Drag the body to move, an edge to change
//     one dimension, a corner to change both (no aspect lock).
//   - Width/Height fields (center) show the rectangle's pixel dimensions, update
//     live, and can be typed into. Fit/Crop buttons (right).
//   - Crop to outline: output = the rectangle's image region at its W x H.
//   - Fit to outline (toggle): output stretches the WHOLE image to the rectangle
//     W x H (aspect ignored).
// The confirmed image is returned as a base64 PNG at the rectangle's W x H;
// resize.py derives the output dims from it.
import {
    registerOverlay, createModal, button, resolveToken, cancelToken, loadImage,
} from "./jip-overlay.js";

registerOverlay("resize", openResize);

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

async function openResize(detail) {
    const { token, images = [], default_w = 512, default_h = 512, orientation = "" } = detail;
    if (!images.length) { cancelToken(token); return; }

    const modal = createModal(`JIP Resize — ${orientation}`);
    let img;
    try { img = await loadImage(images[0]); }
    catch (e) { console.error("[JIP] Resize: failed to load image", e); modal.close(); cancelToken(token); return; }

    // Natural (source) dims; effective dims = natural * imgScale.
    const iw0 = img.naturalWidth, ih0 = img.naturalHeight;
    let imgScale = 1;
    let iw = iw0, ih = ih0;

    // Display fit (recomputed whenever the effective image size changes).
    let scale = 1, dispW = iw, dispH = ih;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "background:#111;border:1px solid #333;border-radius:4px;touch-action:none;display:block;";
    const ctx = canvas.getContext("2d");

    const MIN = 8;       // minimum rectangle size in (effective) image px
    const MAX = 8192;    // upper bound for dimensions / coordinates (#36)

    // Start rect = node dims, centered. May exceed the image (#36).
    let rw = clamp(default_w, MIN, MAX), rh = clamp(default_h, MIN, MAX);
    let rect = { x: (iw - rw) / 2, y: (ih - rh) / 2, w: rw, h: rh };

    // View offset: the virtual canvas spans the union of the image and the
    // rectangle, so an outline dragged beyond the image stays visible (#36).
    let viewMinX = 0, viewMinY = 0;

    let mode = "crop"; // "crop" | "fit"

    const recomputeDisplay = () => {
        // Virtual area = union of the image [0,0,iw,ih] and the rectangle (#36).
        viewMinX = Math.min(0, rect.x);
        viewMinY = Math.min(0, rect.y);
        const vw = Math.max(iw, rect.x + rect.w) - viewMinX;
        const vh = Math.max(ih, rect.y + rect.h) - viewMinY;
        const maxW = Math.min(window.innerWidth * 0.7, 900);
        const maxH = window.innerHeight * 0.56;
        scale = Math.min(maxW / vw, maxH / vh, 1);
        dispW = Math.max(1, Math.round(vw * scale));
        dispH = Math.max(1, Math.round(vh * scale));
        canvas.width = dispW; canvas.height = dispH;
    };
    recomputeDisplay();

    const HANDLE = () => 10 / scale; // hit radius in (effective) image px

    const toImg = (e) => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) / scale + viewMinX, (e.clientY - r.top) / scale + viewMinY];
    };

    const redraw = () => {
        recomputeDisplay();
        ctx.clearRect(0, 0, dispW, dispH);
        const ix = (0 - viewMinX) * scale, iy = (0 - viewMinY) * scale;
        const iwD = iw * scale, ihD = ih * scale;
        const rx = (rect.x - viewMinX) * scale, ry = (rect.y - viewMinY) * scale, rw2 = rect.w * scale, rh2 = rect.h * scale;
        if (mode === "fit") {
            // Preview the stretch: the whole image squeezed into the rectangle box.
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, dispW, dispH);
            ctx.drawImage(img, 0, 0, iw0, ih0, rx, ry, rw2, rh2);
        } else {
            ctx.fillStyle = "#111";
            ctx.fillRect(0, 0, dispW, dispH);
            ctx.drawImage(img, 0, 0, iw0, ih0, ix, iy, iwD, ihD);
            // dim outside the rectangle
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.fillRect(0, 0, dispW, ry);
            ctx.fillRect(0, ry + rh2, dispW, dispH - ry - rh2);
            ctx.fillRect(0, ry, rx, rh2);
            ctx.fillRect(rx + rw2, ry, dispW - rx - rw2, rh2);
        }
        // border + handles (corners + edge midpoints)
        ctx.strokeStyle = "#4a9eff"; ctx.lineWidth = 2; ctx.strokeRect(rx, ry, rw2, rh2);
        ctx.fillStyle = "#4a9eff";
        const cx = rx + rw2 / 2, cy = ry + rh2 / 2;
        for (const [hx, hy] of [
            [rx, ry], [rx + rw2, ry], [rx, ry + rh2], [rx + rw2, ry + rh2], // corners
            [cx, ry], [cx, ry + rh2], [rx, cy], [rx + rw2, cy],             // edge mids
        ]) {
            ctx.fillRect(hx - 4, hy - 4, 8, 8);
        }
    };

    // Which handle (corner/edge) or body is under the pointer.
    const hitTest = (x, y) => {
        const H = HANDLE();
        const nearL = Math.abs(x - rect.x) < H;
        const nearR = Math.abs(x - (rect.x + rect.w)) < H;
        const nearT = Math.abs(y - rect.y) < H;
        const nearB = Math.abs(y - (rect.y + rect.h)) < H;
        const inX = x > rect.x - H && x < rect.x + rect.w + H;
        const inY = y > rect.y - H && y < rect.y + rect.h + H;
        if (nearT && nearL) return "tl";
        if (nearT && nearR) return "tr";
        if (nearB && nearL) return "bl";
        if (nearB && nearR) return "br";
        if (nearT && inX) return "t";
        if (nearB && inX) return "b";
        if (nearL && inY) return "l";
        if (nearR && inY) return "r";
        if (x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h) return "move";
        return null;
    };

    const CURSORS = { tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize", move: "move" };

    // Apply a drag for the active handle, keeping the opposite side(s) fixed.
    // The rectangle is free to extend past the image bounds (#36); only MIN/MAX
    // and a generous coordinate range constrain it.
    const applyDrag = (handle, x, y, orig, start) => {
        if (handle === "move") {
            rect.x = clamp(orig.x + (x - start.x), -MAX, MAX);
            rect.y = clamp(orig.y + (y - start.y), -MAX, MAX);
            return;
        }
        let { x: nx, y: ny, w: nw, h: nh } = orig;
        const right = orig.x + orig.w, bottom = orig.y + orig.h;
        if (handle.includes("l")) { nx = clamp(x, -MAX, right - MIN); nw = right - nx; }
        if (handle.includes("r")) { nw = clamp(x, orig.x + MIN, orig.x + MAX) - orig.x; nx = orig.x; }
        if (handle.includes("t")) { ny = clamp(y, -MAX, bottom - MIN); nh = bottom - ny; }
        if (handle.includes("b")) { nh = clamp(y, orig.y + MIN, orig.y + MAX) - orig.y; ny = orig.y; }
        rect = { x: nx, y: ny, w: nw, h: nh };
    };

    let drag = null; // { handle, orig, start }
    canvas.addEventListener("pointerdown", (e) => {
        const [x, y] = toImg(e);
        const handle = hitTest(x, y);
        if (!handle) return;
        drag = { handle, orig: { ...rect }, start: { x, y } };
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
        const [x, y] = toImg(e);
        if (!drag) {
            const h = hitTest(x, y);
            canvas.style.cursor = h ? CURSORS[h] : "default";
            return;
        }
        applyDrag(drag.handle, x, y, drag.orig, drag.start);
        syncFields();
        redraw();
    });
    const endDrag = () => { drag = null; };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    // ── centered canvas ──
    const canvasWrap = document.createElement("div");
    canvasWrap.style.cssText = "display:flex;justify-content:center;width:100%;";
    canvasWrap.appendChild(canvas);

    // ── bottom row: scale slider (left) · W/H fields (center) · buttons (right) ──
    // Scale slider — uniformly resamples the source image (#34).
    const scaleLabel = document.createElement("span");
    scaleLabel.style.cssText = "font-size:11px;color:#aaa;white-space:nowrap;";
    const scaleSlider = document.createElement("input");
    scaleSlider.type = "range"; scaleSlider.min = "25"; scaleSlider.max = "400"; scaleSlider.step = "1"; scaleSlider.value = "100";
    scaleSlider.style.cssText = "width:120px;vertical-align:middle;";
    const syncScaleLabel = () => { scaleLabel.textContent = `Scale ${Math.round(imgScale * 100)}% · ${iw}×${ih}`; };
    // Apply a uniform image scale (bounded to the slider's 25–400% range). The
    // outline keeps its dimensions and stays centered on the image, so scaling
    // zooms the image inside a constant-size crop frame (center crop) (#38).
    const applyScale = (next) => {
        imgScale = clamp(next, 0.25, 4);
        iw = Math.max(1, Math.round(iw0 * imgScale));
        ih = Math.max(1, Math.round(ih0 * imgScale));
        rect.x = (iw - rect.w) / 2;
        rect.y = (ih - rect.h) / 2;
        scaleSlider.value = String(Math.round(imgScale * 100));
        syncScaleLabel(); syncFields(); redraw();
    };
    scaleSlider.addEventListener("input", () => applyScale((+scaleSlider.value) / 100));
    // Fit the image to the outline's width / height respectively (#41).
    const fitWBtn = button("Fit W");
    const fitHBtn = button("Fit H");
    fitWBtn.addEventListener("click", () => applyScale(rect.w / iw0));
    fitHBtn.addEventListener("click", () => applyScale(rect.h / ih0));
    const scaleGroup = document.createElement("div");
    scaleGroup.style.cssText = "display:flex;align-items:center;gap:8px;";
    scaleGroup.append(scaleSlider, scaleLabel, fitWBtn, fitHBtn);

    // W/H fields — match the buttons' height/font, 20% wider than before (#34).
    const dimInput = (val) => {
        const i = document.createElement("input");
        i.type = "number"; i.min = "1"; i.max = "8192"; i.value = String(val);
        i.style.cssText = "width:65px;box-sizing:border-box;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:5px;padding:6px 8px;font-size:13px;text-align:center;";
        return i;
    };
    const wIn = dimInput(Math.round(rect.w));
    const hIn = dimInput(Math.round(rect.h));
    const syncFields = () => { wIn.value = String(Math.round(rect.w)); hIn.value = String(Math.round(rect.h)); };
    const applyField = () => {
        // Allow outline dimensions larger than the image (#36).
        const w = clamp(parseInt(wIn.value, 10) || rect.w, MIN, MAX);
        const h = clamp(parseInt(hIn.value, 10) || rect.h, MIN, MAX);
        rect.w = w; rect.h = h;
        syncFields(); redraw();
    };
    wIn.addEventListener("change", applyField);
    hIn.addEventListener("change", applyField);

    const dims = document.createElement("div");
    dims.style.cssText = "display:flex;align-items:center;gap:6px;font-size:12px;color:#aaa;";
    const wl = document.createElement("span"); wl.textContent = "W";
    const hl = document.createElement("span"); hl.textContent = "H";
    dims.append(wl, wIn, hl, hIn);
    const dimsCenter = document.createElement("div");
    dimsCenter.style.cssText = "flex:1;display:flex;justify-content:center;";
    dimsCenter.appendChild(dims);

    const fitB = button("Fit to outline");
    const cropB = button("Crop to outline");
    const setMode = (m) => {
        mode = m;
        fitB.style.borderColor = m === "fit" ? "#4a9eff" : "#555";
        cropB.style.borderColor = m === "crop" ? "#4a9eff" : "#555";
        redraw();
    };
    fitB.addEventListener("click", () => setMode(mode === "fit" ? "crop" : "fit"));
    cropB.addEventListener("click", () => setMode("crop"));

    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;gap:8px;";
    buttons.append(fitB, cropB);

    const bottomRow = document.createElement("div");
    bottomRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;";
    bottomRow.append(scaleGroup, dimsCenter, buttons);

    const hint = document.createElement("div");
    hint.textContent = "Scale the image inside the crop frame with the slider (the outline keeps its size); Fit W / Fit H scale it to the outline's width / height. Drag the rectangle to move, an edge to resize one side, a corner to resize freely. Fit to outline stretches the whole image to the W x H; Crop crops to the rectangle.";
    hint.style.cssText = "font-size:11px;color:#888;margin-top:6px;";

    modal.body.append(canvasWrap, bottomRow, hint);

    // ── footer ──
    const cancelBtn = button("Cancel");
    const confirmBtn = button("Confirm", true);
    cancelBtn.addEventListener("click", () => { modal.close(); cancelToken(token); });
    confirmBtn.addEventListener("click", () => {
        const dataUrl = exportImage();
        modal.close();
        resolveToken(token, { image: dataUrl });
    });
    modal.footer.append(cancelBtn, confirmBtn);

    setMode("crop");
    syncScaleLabel();
    syncFields();
    redraw();

    function exportImage() {
        const outW = Math.max(1, Math.round(rect.w));
        const outH = Math.max(1, Math.round(rect.h));
        const out = document.createElement("canvas");
        out.width = outW; out.height = outH;
        const octx = out.getContext("2d");
        octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, outW, outH);
        if (mode === "fit") {
            // stretch the whole (natural) image to the output dims (aspect ignored)
            octx.drawImage(img, 0, 0, iw0, ih0, 0, 0, outW, outH);
        } else {
            // crop: place the effective-size image into the output at its offset
            // relative to the rectangle. When the rectangle extends past the image
            // (#36) the uncovered area keeps the white fill (padding); output px
            // map 1:1 to effective px so -rect.x/-rect.y is the placement.
            octx.drawImage(img, 0, 0, iw0, ih0, -rect.x, -rect.y, iw, ih);
        }
        return out.toDataURL("image/png");
    }
}
