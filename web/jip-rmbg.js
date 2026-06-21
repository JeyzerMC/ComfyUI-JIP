// JIP RMBG overlay (#11, #28, #35): pick one of the model results (or the
// original, no-removal image), then retouch it — eraser (paint background
// colour), magic-fill (flood-fill a region to the background colour), and
// restore (reverse eraser that brings back pixels from the original image).
// Supports undo/redo, a brush hover ring, zoom, and a magic-fill strength
// control. The confirmed canvas is returned as a base64 PNG and becomes the
// payload's working/_alt image.
import {
    registerOverlay, createModal, button, resolveToken, cancelToken, loadImage,
} from "./jip-overlay.js";

registerOverlay("rmbg", openRmbg);

async function openRmbg(detail) {
    const { token, images = [], labels = [], bg_color = [255, 255, 255], base_index = null } = detail;
    if (!images.length) { cancelToken(token); return; }

    const modal = createModal("JIP RMBG — pick a result, then retouch");
    let imgs;
    try {
        imgs = await Promise.all(images.map(loadImage));
    } catch (e) {
        console.error("[JIP] RMBG: failed to load results", e);
        modal.close(); cancelToken(token); return;
    }
    // The original (no-removal) image, used as the Restore brush source (#35).
    const baseImg = (base_index != null && imgs[base_index]) ? imgs[base_index] : null;

    // ── editing canvas in a centered, scrollable viewport (zoom support) ──
    const viewport = document.createElement("div");
    viewport.style.cssText = "display:flex;justify-content:center;align-items:flex-start;overflow:auto;max-width:72vw;max-height:64vh;margin:0 auto;";
    const canvasWrap = document.createElement("div");
    canvasWrap.style.cssText = "position:relative;display:inline-block;line-height:0;flex:0 0 auto;";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "background:#111;border:1px solid #333;border-radius:4px;cursor:crosshair;touch-action:none;display:block;";
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const ring = document.createElement("div");
    ring.style.cssText = "position:absolute;border:1px solid #4a9eff;border-radius:50%;pointer-events:none;display:none;transform:translate(-50%,-50%);box-shadow:0 0 0 1px rgba(0,0,0,0.5);";
    canvasWrap.append(canvas, ring);
    viewport.appendChild(canvasWrap);

    // ── zoom ──
    let fitScale = 1; // display scale that fits the image in the viewport
    let zoom = 1;     // user multiplier on top of fitScale (1 = fit)
    const applyZoom = () => {
        canvas.style.width = `${Math.max(1, Math.round(canvas.width * fitScale * zoom))}px`;
        canvas.style.height = "auto";
        positionRing(lastPointer);
    };
    const computeFit = () => {
        const maxW = window.innerWidth * 0.7, maxH = window.innerHeight * 0.6;
        fitScale = Math.min(maxW / canvas.width, maxH / canvas.height, 1) || 1;
    };

    // ── undo/redo history of canvas snapshots ──
    let history = [];
    let hindex = -1;
    const snapshot = () => ctx.getImageData(0, 0, canvas.width, canvas.height);
    const resetHistory = () => { history = [snapshot()]; hindex = 0; updateUndoButtons(); };
    const pushHistory = () => {
        history = history.slice(0, hindex + 1);
        history.push(snapshot());
        hindex = history.length - 1;
        updateUndoButtons();
    };
    const restoreHist = () => { ctx.putImageData(history[hindex], 0, 0); };
    const undo = () => { if (hindex > 0) { hindex--; restoreHist(); updateUndoButtons(); } };
    const redo = () => { if (hindex < history.length - 1) { hindex++; restoreHist(); updateUndoButtons(); } };

    let selected = 0;
    const loadInto = (i) => {
        selected = i;
        const im = imgs[i];
        canvas.width = im.naturalWidth;
        canvas.height = im.naturalHeight;
        ctx.drawImage(im, 0, 0);
        thumbs.forEach((t, k) => { t.style.outline = k === i ? "2px solid #4a9eff" : "2px solid transparent"; });
        computeFit(); applyZoom();
        resetHistory();
    };

    // ── thumbnails (original + one per model result), centered ──
    const thumbRow = document.createElement("div");
    thumbRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;justify-content:center;";
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

    // ── zoom row (centered, above the canvas) ──
    const zoomLabel = document.createElement("span");
    zoomLabel.style.cssText = "font-size:11px;color:#aaa;min-width:48px;text-align:center;";
    const setZoom = (z) => { zoom = Math.max(0.2, Math.min(8, z)); zoomLabel.textContent = `${Math.round(zoom * 100)}%`; applyZoom(); };
    const zoomOut = button("−");
    const zoomIn = button("+");
    const zoomFit = button("Fit");
    zoomOut.addEventListener("click", () => setZoom(zoom / 1.25));
    zoomIn.addEventListener("click", () => setZoom(zoom * 1.25));
    zoomFit.addEventListener("click", () => setZoom(1));
    const zoomRow = document.createElement("div");
    zoomRow.style.cssText = "display:flex;gap:6px;align-items:center;justify-content:center;margin-bottom:8px;";
    zoomRow.append(zoomOut, zoomLabel, zoomIn, zoomFit);

    // ── tools ──
    let tool = "eraser";  // "eraser" | "fill" | "restore"
    let brush = 28;       // eraser/restore diameter (canvas px)
    let strength = 36;    // magic-fill tolerance (per-channel)

    // left group: undo / redo
    const undoBtn = button("↶ Undo");
    const redoBtn = button("↷ Redo");
    undoBtn.title = "Undo (Ctrl+Z)";
    redoBtn.title = "Redo (Ctrl+Shift+Z)";
    undoBtn.addEventListener("click", undo);
    redoBtn.addEventListener("click", redo);
    const updateUndoButtons = () => {
        undoBtn.style.opacity = hindex > 0 ? "1" : "0.4";
        redoBtn.style.opacity = hindex < history.length - 1 ? "1" : "0.4";
    };
    const leftGroup = document.createElement("div");
    leftGroup.style.cssText = "display:flex;gap:6px;align-items:center;";
    leftGroup.append(undoBtn, redoBtn);

    // center group: size/strength slider + reset
    const sizeLabel = document.createElement("span");
    sizeLabel.style.cssText = "font-size:12px;color:#aaa;min-width:88px;text-align:right;";
    const slider = document.createElement("input");
    slider.type = "range";
    const reset = button("Reset");
    reset.addEventListener("click", () => loadInto(selected));
    const syncSlider = () => {
        if (tool === "fill") {
            slider.min = "1"; slider.max = "150"; slider.value = String(strength);
            sizeLabel.textContent = `Strength: ${strength}`;
        } else {
            slider.min = "2"; slider.max = "120"; slider.value = String(brush);
            sizeLabel.textContent = `Brush: ${brush}px`;
        }
    };
    slider.addEventListener("input", () => {
        if (tool === "fill") strength = +slider.value; else brush = +slider.value;
        syncSlider();
        positionRing(lastPointer);
    });
    const centerGroup = document.createElement("div");
    centerGroup.style.cssText = "display:flex;gap:10px;align-items:center;flex:1;justify-content:center;";
    centerGroup.append(sizeLabel, slider, reset);

    // right group: tool selection
    const eraserBtn = button("Eraser");
    const restoreBtn = button("Restore");
    const fillBtn = button("Magic fill");
    const setTool = (t) => {
        tool = t;
        eraserBtn.style.borderColor = t === "eraser" ? "#4a9eff" : "#555";
        restoreBtn.style.borderColor = t === "restore" ? "#4a9eff" : "#555";
        fillBtn.style.borderColor = t === "fill" ? "#4a9eff" : "#555";
        // Eraser/Restore show the brush ring (hide the cursor); fill uses a crosshair.
        canvas.style.cursor = t === "fill" ? "crosshair" : "none";
        ring.style.display = "none";
        syncSlider();
    };
    eraserBtn.addEventListener("click", () => setTool("eraser"));
    restoreBtn.addEventListener("click", () => setTool("restore"));
    fillBtn.addEventListener("click", () => setTool("fill"));
    const rightGroup = document.createElement("div");
    rightGroup.style.cssText = "display:flex;gap:8px;align-items:center;";
    rightGroup.append(eraserBtn);
    if (baseImg) rightGroup.append(restoreBtn);  // only when the base image is available
    rightGroup.append(fillBtn);

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;align-items:center;gap:10px;margin:10px 0;";
    toolbar.append(leftGroup, centerGroup, rightGroup);

    modal.body.append(thumbRow, zoomRow, viewport, toolbar);

    // ── brush hover ring (eraser + restore) ──
    let lastPointer = null;
    const positionRing = (e) => {
        if (!e || tool === "fill") { ring.style.display = "none"; return; }
        const r = canvas.getBoundingClientRect();
        const dispScale = r.width / canvas.width; // canvas px -> screen px
        const d = brush * dispScale;
        ring.style.width = `${d}px`;
        ring.style.height = `${d}px`;
        ring.style.left = `${e.clientX - r.left}px`;
        ring.style.top = `${e.clientY - r.top}px`;
        ring.style.display = "block";
    };

    // ── painting ──
    const toCanvas = (e) => {
        const r = canvas.getBoundingClientRect();
        return [
            Math.round((e.clientX - r.left) * (canvas.width / r.width)),
            Math.round((e.clientY - r.top) * (canvas.height / r.height)),
        ];
    };
    const paintAt = (x, y) => {
        if (tool === "restore" && baseImg) {
            // Reverse eraser: bring back the original image inside the brush (#35).
            ctx.save();
            ctx.beginPath(); ctx.arc(x, y, brush / 2, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
            ctx.restore();
        } else {
            ctx.fillStyle = `rgb(${bg_color[0]},${bg_color[1]},${bg_color[2]})`;
            ctx.beginPath();
            ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
            ctx.fill();
        }
    };
    let painting = false;
    canvas.addEventListener("pointerdown", (e) => {
        const [x, y] = toCanvas(e);
        if (tool === "fill") { floodFill(ctx, x, y, bg_color, strength); pushHistory(); return; }
        painting = true; canvas.setPointerCapture(e.pointerId); paintAt(x, y);
    });
    canvas.addEventListener("pointermove", (e) => {
        lastPointer = e;
        positionRing(e);
        if (painting) { const [x, y] = toCanvas(e); paintAt(x, y); }
    });
    const stop = () => { if (painting) { painting = false; pushHistory(); } };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", () => { ring.style.display = "none"; });

    // ── keyboard undo/redo ──
    const onKey = (e) => {
        const z = e.key === "z" || e.key === "Z";
        if ((e.ctrlKey || e.metaKey) && z) {
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
            e.preventDefault(); redo();
        }
    };
    document.addEventListener("keydown", onKey);
    const cleanup = () => document.removeEventListener("keydown", onKey);

    // ── footer ──
    const cancelBtn = button("Cancel");
    const confirmBtn = button("Confirm", true);
    cancelBtn.addEventListener("click", () => { cleanup(); modal.close(); cancelToken(token); });
    confirmBtn.addEventListener("click", () => {
        const dataUrl = canvas.toDataURL("image/png");
        cleanup(); modal.close();
        resolveToken(token, { image: dataUrl, picked: selected });
    });
    modal.footer.append(cancelBtn, confirmBtn);

    setTool("eraser");
    setZoom(1);
    // Default to the first model result (index 1) when the original is at 0.
    loadInto(base_index === 0 && imgs.length > 1 ? 1 : 0);
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
