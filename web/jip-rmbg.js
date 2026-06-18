// JIP RMBG overlay (#11): pick one of the model results, then retouch it with an
// eraser (paint background colour) and a magic-fill (flood-fill a region to the
// background colour) before confirming. The confirmed canvas is returned as a
// base64 PNG and becomes the payload's working/_alt image.
import {
    registerOverlay, createModal, button, resolveToken, cancelToken, loadImage,
} from "./jip-overlay.js";

registerOverlay("rmbg", openRmbg);

async function openRmbg(detail) {
    const { token, images = [], labels = [], bg_color = [255, 255, 255] } = detail;
    if (!images.length) { cancelToken(token); return; }

    const modal = createModal("JIP RMBG — pick a result, then retouch");
    let imgs;
    try {
        imgs = await Promise.all(images.map(loadImage));
    } catch (e) {
        console.error("[JIP] RMBG: failed to load results", e);
        modal.close(); cancelToken(token); return;
    }

    // ── editing canvas ──
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "max-width:70vw;max-height:64vh;background:#111;border:1px solid #333;border-radius:4px;cursor:crosshair;touch-action:none;";
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    let selected = 0;
    const loadInto = (i) => {
        selected = i;
        const im = imgs[i];
        canvas.width = im.naturalWidth;
        canvas.height = im.naturalHeight;
        ctx.drawImage(im, 0, 0);
        thumbs.forEach((t, k) => { t.style.outline = k === i ? "2px solid #4a9eff" : "2px solid transparent"; });
    };

    // ── thumbnails (one per model result) ──
    const thumbRow = document.createElement("div");
    thumbRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;";
    const thumbs = imgs.map((im, i) => {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;border-radius:4px;outline:2px solid transparent;";
        const t = document.createElement("img");
        t.src = im.src;
        t.style.cssText = "width:84px;height:84px;object-fit:contain;background:#1a1a1a;border-radius:3px;";
        const cap = document.createElement("div");
        cap.textContent = labels[i] || `#${i}`;
        cap.style.cssText = "font-size:10px;color:#aaa;";
        wrap.append(t, cap);
        wrap.addEventListener("click", () => loadInto(i));
        thumbRow.appendChild(wrap);
        return wrap;
    });

    // ── tools ──
    let tool = "eraser";
    let brush = 28;
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap;";
    const eraserBtn = button("Eraser");
    const fillBtn = button("Magic fill");
    const setTool = (t) => {
        tool = t;
        eraserBtn.style.borderColor = t === "eraser" ? "#4a9eff" : "#555";
        fillBtn.style.borderColor = t === "fill" ? "#4a9eff" : "#555";
    };
    eraserBtn.addEventListener("click", () => setTool("eraser"));
    fillBtn.addEventListener("click", () => setTool("fill"));

    const sizeLabel = document.createElement("span");
    sizeLabel.style.cssText = "font-size:12px;color:#aaa;";
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "2"; slider.max = "120"; slider.value = String(brush);
    const syncSize = () => { brush = +slider.value; sizeLabel.textContent = `Brush: ${brush}px`; };
    slider.addEventListener("input", syncSize); syncSize();

    const reset = button("Reset");
    reset.addEventListener("click", () => loadInto(selected));
    toolbar.append(eraserBtn, fillBtn, sizeLabel, slider, reset);
    setTool("eraser");

    modal.body.append(thumbRow, canvas, toolbar);

    // ── painting ──
    const toCanvas = (e) => {
        const r = canvas.getBoundingClientRect();
        return [
            Math.round((e.clientX - r.left) * (canvas.width / r.width)),
            Math.round((e.clientY - r.top) * (canvas.height / r.height)),
        ];
    };
    const erase = (x, y) => {
        ctx.fillStyle = `rgb(${bg_color[0]},${bg_color[1]},${bg_color[2]})`;
        ctx.beginPath();
        ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
        ctx.fill();
    };
    let painting = false;
    canvas.addEventListener("pointerdown", (e) => {
        const [x, y] = toCanvas(e);
        if (tool === "fill") { floodFill(ctx, x, y, bg_color, 36); return; }
        painting = true; canvas.setPointerCapture(e.pointerId); erase(x, y);
    });
    canvas.addEventListener("pointermove", (e) => { if (painting) { const [x, y] = toCanvas(e); erase(x, y); } });
    const stop = () => { painting = false; };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);

    // ── footer ──
    const cancelBtn = button("Cancel");
    const confirmBtn = button("Confirm", true);
    cancelBtn.addEventListener("click", () => { modal.close(); cancelToken(token); });
    confirmBtn.addEventListener("click", () => {
        const dataUrl = canvas.toDataURL("image/png");
        modal.close();
        resolveToken(token, { image: dataUrl, picked: selected });
    });
    modal.footer.append(cancelBtn, confirmBtn);

    loadInto(0);
}

// Stack flood-fill: recolour the contiguous region around (x,y) to `fill`,
// within `tol` per-channel of the seed colour.
function floodFill(ctx, x, y, fill, tol) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const s = (y * w + x) * 4;
    const tr = d[s], tg = d[s + 1], tb = d[s + 2];
    if (Math.abs(tr - fill[0]) <= 1 && Math.abs(tg - fill[1]) <= 1 && Math.abs(tb - fill[2]) <= 1) return;
    const seen = new Uint8Array(w * h);
    const stack = [[x, y]];
    while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const p = cy * w + cx;
        if (seen[p]) continue;
        const o = p * 4;
        if (Math.abs(d[o] - tr) > tol || Math.abs(d[o + 1] - tg) > tol || Math.abs(d[o + 2] - tb) > tol) continue;
        seen[p] = 1;
        d[o] = fill[0]; d[o + 1] = fill[1]; d[o + 2] = fill[2]; d[o + 3] = 255;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    ctx.putImageData(id, 0, 0);
}
