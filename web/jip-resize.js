// JIP Resize overlay (#12): the output is always the default dims (the outline).
// Tools control how the source maps into it:
//   Fit to outline  — whole image contained (letterboxed white)
//   Crop to outline — drag an aspect-locked crop rectangle (starts as cover)
//   Stretch         — whole image stretched to the outline (ignores aspect)
// Confirm renders to an out_w×out_h canvas and returns it as a base64 PNG.
import {
    registerOverlay, createModal, button, resolveToken, cancelToken, loadImage,
} from "./jip-overlay.js";

registerOverlay("resize", openResize);

async function openResize(detail) {
    const { token, images = [], default_w = 512, default_h = 512, orientation = "" } = detail;
    if (!images.length) { cancelToken(token); return; }

    const modal = createModal(`JIP Resize — ${orientation} · outline ${default_w} × ${default_h}`);
    let img;
    try { img = await loadImage(images[0]); }
    catch (e) { console.error("[JIP] Resize: failed to load image", e); modal.close(); cancelToken(token); return; }

    const iw = img.naturalWidth, ih = img.naturalHeight;
    const aspect = default_w / default_h;

    const maxW = Math.min(window.innerWidth * 0.7, 900);
    const maxH = window.innerHeight * 0.56;
    const scale = Math.min(maxW / iw, maxH / ih, 1);
    const dispW = Math.round(iw * scale), dispH = Math.round(ih * scale);

    const canvas = document.createElement("canvas");
    canvas.width = dispW; canvas.height = dispH;
    canvas.style.cssText = "background:#111;border:1px solid #333;border-radius:4px;touch-action:none;display:block;";
    const ctx = canvas.getContext("2d");

    // Largest aspect-locked rect that fits inside the image (used for crop start).
    const coverRect = () => {
        let w, h;
        if (iw / ih > aspect) { h = ih; w = ih * aspect; } else { w = iw; h = iw / aspect; }
        return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
    };

    let mode = "crop";
    let crop = coverRect();  // in image pixels

    const toImg = (e) => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
    };

    const redraw = () => {
        ctx.clearRect(0, 0, dispW, dispH);
        ctx.drawImage(img, 0, 0, dispW, dispH);
        if (mode === "crop") {
            const rx = crop.x * scale, ry = crop.y * scale, rw = crop.w * scale, rh = crop.h * scale;
            // dim outside the crop
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.fillRect(0, 0, dispW, ry);
            ctx.fillRect(0, ry + rh, dispW, dispH - ry - rh);
            ctx.fillRect(0, ry, rx, rh);
            ctx.fillRect(rx + rw, ry, dispW - rx - rw, rh);
            // border + handles
            ctx.strokeStyle = "#4a9eff"; ctx.lineWidth = 2; ctx.strokeRect(rx, ry, rw, rh);
            ctx.fillStyle = "#4a9eff";
            for (const [hx, hy] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]]) {
                ctx.fillRect(hx - 5, hy - 5, 10, 10);
            }
        } else {
            // fit/stretch: show the outline framing the whole image
            ctx.strokeStyle = "#4a9eff"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, dispW - 2, dispH - 2);
        }
    };

    // ── crop rect interaction (move + corner resize, aspect-locked) ──
    let drag = null;  // { kind:'move'|'corner', corner, startX, startY, orig }
    const HANDLE = 10 / scale;
    canvas.addEventListener("pointerdown", (e) => {
        if (mode !== "crop") return;
        const [x, y] = toImg(e);
        const corners = { tl: [crop.x, crop.y], tr: [crop.x + crop.w, crop.y], bl: [crop.x, crop.y + crop.h], br: [crop.x + crop.w, crop.y + crop.h] };
        for (const k in corners) {
            if (Math.abs(x - corners[k][0]) < HANDLE && Math.abs(y - corners[k][1]) < HANDLE) {
                drag = { kind: "corner", corner: k }; canvas.setPointerCapture(e.pointerId); return;
            }
        }
        if (x > crop.x && x < crop.x + crop.w && y > crop.y && y < crop.y + crop.h) {
            drag = { kind: "move", startX: x, startY: y, orig: { ...crop } };
            canvas.setPointerCapture(e.pointerId);
        }
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const [x, y] = toImg(e);
        if (drag.kind === "move") {
            crop.x = clamp(drag.orig.x + (x - drag.startX), 0, iw - crop.w);
            crop.y = clamp(drag.orig.y + (y - drag.startY), 0, ih - crop.h);
        } else {
            // Resize from the opposite corner, keeping aspect; clamp to image.
            const fixed = oppositeCorner(crop, drag.corner);
            let nw = Math.abs(x - fixed[0]);
            let nh = nw / aspect;
            if (nh > Math.abs(y - fixed[1])) { nh = Math.abs(y - fixed[1]); nw = nh * aspect; }
            const nx = (x < fixed[0]) ? fixed[0] - nw : fixed[0];
            const ny = (y < fixed[1]) ? fixed[1] - nh : fixed[1];
            if (nx >= 0 && ny >= 0 && nx + nw <= iw && ny + nh <= ih && nw > 8) {
                crop = { x: nx, y: ny, w: nw, h: nh };
            }
        }
        redraw();
    });
    const endDrag = () => { drag = null; };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    // ── tool buttons ──
    const fitB = button("Fit to outline");
    const cropB = button("Crop to outline");
    const stretchB = button("Stretch");
    const setMode = (m) => {
        mode = m;
        if (m === "crop") crop = coverRect();
        for (const [b, mm] of [[fitB, "fit"], [cropB, "crop"], [stretchB, "stretch"]]) {
            b.style.borderColor = mode === mm ? "#4a9eff" : "#555";
        }
        canvas.style.cursor = m === "crop" ? "move" : "default";
        redraw();
    };
    fitB.addEventListener("click", () => setMode("fit"));
    cropB.addEventListener("click", () => setMode("crop"));
    stretchB.addEventListener("click", () => setMode("stretch"));

    const tools = document.createElement("div");
    tools.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;";
    tools.append(fitB, cropB, stretchB);
    const hint = document.createElement("div");
    hint.textContent = "Crop mode: drag the rectangle to move, drag a corner to resize (aspect locked).";
    hint.style.cssText = "font-size:11px;color:#888;margin-top:6px;";
    modal.body.append(canvas, tools, hint);

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

    function exportImage() {
        const out = document.createElement("canvas");
        out.width = default_w; out.height = default_h;
        const octx = out.getContext("2d");
        octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, default_w, default_h);
        if (mode === "fit") {
            const s = Math.min(default_w / iw, default_h / ih);
            const w = iw * s, h = ih * s;
            octx.drawImage(img, 0, 0, iw, ih, (default_w - w) / 2, (default_h - h) / 2, w, h);
        } else if (mode === "stretch") {
            octx.drawImage(img, 0, 0, iw, ih, 0, 0, default_w, default_h);
        } else { // crop
            octx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, default_w, default_h);
        }
        return out.toDataURL("image/png");
    }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function oppositeCorner(crop, corner) {
    switch (corner) {
        case "tl": return [crop.x + crop.w, crop.y + crop.h];
        case "tr": return [crop.x, crop.y + crop.h];
        case "bl": return [crop.x + crop.w, crop.y];
        default: return [crop.x, crop.y]; // br
    }
}
