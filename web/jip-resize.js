// JIP Resize overlay (#26): a freely resizable outline rectangle over the image.
//   - The rectangle starts at the node's per-orientation dims (default_w/h),
//     centered, clamped to the image.
//   - Drag the body to move; drag an edge to change one dimension; drag a corner
//     to change both (no aspect lock).
//   - Width/Height fields (bottom-left) show the rectangle's pixel dimensions,
//     update live as it resizes, and can be typed into to drive the rectangle.
//   - Crop to outline: output = the rectangle's image region at its W x H.
//   - Fit to outline (toggle): preview/output stretches the WHOLE image to the
//     rectangle's W x H (aspect ignored); deselecting returns to the crop view.
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

    const iw = img.naturalWidth, ih = img.naturalHeight;

    const maxW = Math.min(window.innerWidth * 0.7, 900);
    const maxH = window.innerHeight * 0.56;
    const scale = Math.min(maxW / iw, maxH / ih, 1);
    const dispW = Math.round(iw * scale), dispH = Math.round(ih * scale);

    const canvas = document.createElement("canvas");
    canvas.width = dispW; canvas.height = dispH;
    canvas.style.cssText = "background:#111;border:1px solid #333;border-radius:4px;touch-action:none;display:block;";
    const ctx = canvas.getContext("2d");

    const MIN = 8;            // minimum rectangle size in image px
    const HANDLE = 10 / scale; // hit radius in image px

    // Start rect = node dims (clamped to the image), centered.
    let rw = clamp(default_w, MIN, iw), rh = clamp(default_h, MIN, ih);
    let rect = { x: (iw - rw) / 2, y: (ih - rh) / 2, w: rw, h: rh };

    let mode = "crop"; // "crop" | "fit"

    const toImg = (e) => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
    };

    const redraw = () => {
        ctx.clearRect(0, 0, dispW, dispH);
        const rx = rect.x * scale, ry = rect.y * scale, rw2 = rect.w * scale, rh2 = rect.h * scale;
        if (mode === "fit") {
            // Preview the stretch: the whole image squeezed into the rectangle box.
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, dispW, dispH);
            ctx.drawImage(img, 0, 0, iw, ih, rx, ry, rw2, rh2);
        } else {
            ctx.drawImage(img, 0, 0, dispW, dispH);
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
        const nearL = Math.abs(x - rect.x) < HANDLE;
        const nearR = Math.abs(x - (rect.x + rect.w)) < HANDLE;
        const nearT = Math.abs(y - rect.y) < HANDLE;
        const nearB = Math.abs(y - (rect.y + rect.h)) < HANDLE;
        const inX = x > rect.x - HANDLE && x < rect.x + rect.w + HANDLE;
        const inY = y > rect.y - HANDLE && y < rect.y + rect.h + HANDLE;
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
    const applyDrag = (handle, x, y, orig, start) => {
        if (handle === "move") {
            rect.x = clamp(orig.x + (x - start.x), 0, iw - rect.w);
            rect.y = clamp(orig.y + (y - start.y), 0, ih - rect.h);
            return;
        }
        let { x: nx, y: ny, w: nw, h: nh } = orig;
        const right = orig.x + orig.w, bottom = orig.y + orig.h;
        if (handle.includes("l")) { nx = clamp(x, 0, right - MIN); nw = right - nx; }
        if (handle.includes("r")) { nw = clamp(x, orig.x + MIN, iw) - orig.x; nx = orig.x; }
        if (handle.includes("t")) { ny = clamp(y, 0, bottom - MIN); nh = bottom - ny; }
        if (handle.includes("b")) { nh = clamp(y, orig.y + MIN, ih) - orig.y; ny = orig.y; }
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

    // ── bottom row: W/H fields (left) + tool buttons (right) ──
    const dimInput = (val) => {
        const i = document.createElement("input");
        i.type = "number"; i.min = "1"; i.max = "8192"; i.value = String(val);
        i.style.cssText = "width:54px;box-sizing:border-box;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:4px;padding:3px 5px;font-size:12px;text-align:center;";
        return i;
    };
    const wIn = dimInput(Math.round(rect.w));
    const hIn = dimInput(Math.round(rect.h));
    const syncFields = () => { wIn.value = String(Math.round(rect.w)); hIn.value = String(Math.round(rect.h)); };
    const applyField = () => {
        let w = clamp(parseInt(wIn.value, 10) || rect.w, MIN, iw);
        let h = clamp(parseInt(hIn.value, 10) || rect.h, MIN, ih);
        // keep top-left anchored; clamp position so the rect stays in the image
        rect.w = w; rect.h = h;
        rect.x = clamp(rect.x, 0, iw - w);
        rect.y = clamp(rect.y, 0, ih - h);
        syncFields(); redraw();
    };
    wIn.addEventListener("change", applyField);
    hIn.addEventListener("change", applyField);

    const dims = document.createElement("div");
    dims.style.cssText = "display:flex;align-items:center;gap:6px;font-size:11px;color:#aaa;";
    const wl = document.createElement("span"); wl.textContent = "W";
    const hl = document.createElement("span"); hl.textContent = "H";
    dims.append(wl, wIn, hl, hIn);

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
    bottomRow.append(dims, buttons);

    const hint = document.createElement("div");
    hint.textContent = "Drag the rectangle to move, an edge to resize one side, a corner to resize freely. Fit to outline stretches the whole image to the W x H; Crop keeps the image and crops to the rectangle.";
    hint.style.cssText = "font-size:11px;color:#888;margin-top:6px;";

    modal.body.append(canvas, bottomRow, hint);

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
    syncFields();

    function exportImage() {
        const outW = Math.max(1, Math.round(rect.w));
        const outH = Math.max(1, Math.round(rect.h));
        const out = document.createElement("canvas");
        out.width = outW; out.height = outH;
        const octx = out.getContext("2d");
        octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, outW, outH);
        if (mode === "fit") {
            // stretch the whole image to the output dims (aspect ignored)
            octx.drawImage(img, 0, 0, iw, ih, 0, 0, outW, outH);
        } else {
            // crop: the rectangle's image region at its own pixel size
            octx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, outW, outH);
        }
        return out.toDataURL("image/png");
    }
}
