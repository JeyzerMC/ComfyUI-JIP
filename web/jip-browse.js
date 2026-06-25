// JIP Load source picker (#42).
//
// A custom folder browser that sidesteps the browser file-dialog sandbox: the
// folder listing is done server-side (/jip/browse), so the node receives the
// real absolute path of the chosen image instead of an uploaded copy. The image
// is read in place — ComfyUI never copies it into input/ — so JIP Load's
// `consume` can delete the one real file on disk.
import { app } from "../../scripts/app.js";
import { createModal, button } from "./jip-overlay.js";

const LS_DIR = "jip.browse.dir"; // last-visited folder
const LS_TILE = "jip.browse.tile"; // grid zoom (tile width in px)
const TILE_MIN = 80;
const TILE_MAX = 280;
const THUMB_PX = 256; // server thumbnail size (crisp up to TILE_MAX)

function clampTile(v) {
  v = parseInt(v, 10);
  if (!Number.isFinite(v)) v = 120;
  return Math.max(TILE_MIN, Math.min(TILE_MAX, v));
}

// Open the browse overlay starting at folder `startDir`; resolves to
// { path, dir, name } for the chosen image, or null if cancelled.
function openBrowse(startDir) {
  return new Promise((resolve) => {
    const { overlay, panel, body, footer, close } = createModal(
      "Select source image",
    );
    panel.style.width = "min(88vw, 960px)";

    let upTarget = null; // dir to climb to: "" = drive list, null = none
    let currentDir = ""; // folder currently listed (for the chosen result)
    let selected = null; // { path, dir, name } of the highlighted image
    let settled = false;
    let tile = clampTile(localStorage.getItem(LS_TILE));
    const done = (val) => {
      if (settled) return;
      settled = true;
      close();
      resolve(val);
    };

    // ── path bar ────────────────────────────────────────────────────────
    const bar = document.createElement("div");
    bar.style.cssText =
      "display:flex;gap:6px;margin-bottom:10px;align-items:center;";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type or paste a folder path, then Open";
    input.style.cssText =
      "flex:1;min-width:0;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:5px;padding:5px 8px;font-size:12px;";
    const upBtn = button("↑ Up");
    const openBtn = button("Open", true);
    bar.append(input, upBtn, openBtn);

    const grid = document.createElement("div");
    grid.style.cssText =
      "display:grid;gap:8px;align-content:start;min-height:120px;";
    body.append(bar, grid);
    body.style.cssText += "max-height:70vh;";

    // ── zoom applied to the grid (tile width drives columns + thumb size) ─
    const applyZoom = () => {
      grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${tile}px, 1fr))`;
      const imgH = Math.round(tile * 0.7);
      const iconH = Math.round(tile * 0.42);
      for (const t of grid.children) {
        const img = t.querySelector("img");
        if (img) img.style.height = imgH + "px";
        const icon = t.querySelector("[data-folder-icon]");
        if (icon) {
          icon.style.height = iconH + "px";
          icon.style.lineHeight = iconH + "px";
          icon.style.fontSize = Math.round(tile * 0.32) + "px";
        }
      }
    };

    const tile_ = (label, title) => {
      const t = document.createElement("div");
      t.title = title || label;
      t.style.cssText =
        "display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px;border:1px solid #3a3a3a;border-radius:6px;cursor:pointer;background:#242424;min-width:0;";
      t.addEventListener("mouseenter", () => {
        t.style.borderColor = "#4a9eff";
      });
      t.addEventListener("mouseleave", () => {
        t.style.borderColor = "#3a3a3a";
      });
      const cap = document.createElement("div");
      cap.textContent = label;
      cap.style.cssText =
        "width:100%;text-align:center;color:#ccc;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      t._caption = cap;
      return t;
    };

    const render = (data) => {
      grid.replaceChildren();
      upTarget = data.parent; // may be "" (drives) or null (no parent)
      upBtn.disabled = upTarget === null;
      upBtn.style.opacity = upTarget === null ? "0.45" : "1";

      for (const f of data.folders || []) {
        const t = tile_(f.name, f.path);
        const icon = document.createElement("div");
        icon.textContent = "📁";
        icon.dataset.folderIcon = "1";
        t.prepend(icon);
        t.appendChild(t._caption);
        t.addEventListener("click", () => load(f.path));
        grid.appendChild(t);
      }
      for (const im of data.images || []) {
        const t = tile_(im.name, im.path);
        t._path = im.path;
        const thumb = document.createElement("img");
        thumb.loading = "lazy";
        thumb.src = `/jip/thumb?path=${encodeURIComponent(im.path)}&size=${THUMB_PX}`;
        thumb.style.cssText =
          "width:100%;object-fit:contain;background:#1a1a1a;border-radius:3px;";
        t.prepend(thumb);
        t.appendChild(t._caption);
        const pick = () => ({ path: im.path, dir: currentDir, name: im.name });
        t.addEventListener("dblclick", () => done(pick()));
        t.addEventListener("click", () => {
          for (const el of grid.children) el.style.outline = "none";
          t.style.outline = "2px solid #4a9eff";
          selected = pick();
          chooseBtn.disabled = false;
          chooseBtn.style.opacity = "1";
        });
        grid.appendChild(t);
      }
      if (!(data.folders || []).length && !(data.images || []).length) {
        grid.textContent = "(no folders or images here)";
        grid.style.color = "#888";
      }
      applyZoom();
    };

    const load = async (path) => {
      grid.replaceChildren();
      grid.textContent = "Loading…";
      grid.style.color = "#888";
      selected = null;
      chooseBtn.disabled = true;
      chooseBtn.style.opacity = "0.45";
      let data;
      try {
        const r = await fetch("/jip/browse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: path || "" }),
        });
        data = await r.json();
      } catch (e) {
        grid.textContent = "Error: " + e;
        return;
      }
      if (data.error) {
        grid.textContent = data.error;
        return;
      }
      currentDir = data.dir || "";
      input.value = currentDir;
      if (currentDir) localStorage.setItem(LS_DIR, currentDir);
      grid.style.color = "#ccc";
      render(data);
    };

    upBtn.onclick = () => {
      if (upTarget !== null) load(upTarget);
    };
    openBtn.onclick = () => load(input.value.trim());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        load(input.value.trim());
      }
    });

    // ── footer: zoom slider (left) + actions (right) ─────────────────────
    footer.style.justifyContent = "space-between";
    const zoomWrap = document.createElement("div");
    zoomWrap.style.cssText =
      "display:flex;align-items:center;gap:8px;color:#9a9a9a;font-size:12px;";
    const zoomLbl = document.createElement("span");
    zoomLbl.textContent = "Zoom";
    const zoom = document.createElement("input");
    zoom.type = "range";
    zoom.min = String(TILE_MIN);
    zoom.max = String(TILE_MAX);
    zoom.step = "10";
    zoom.value = String(tile);
    zoom.style.cssText = "width:150px;cursor:pointer;";
    zoom.addEventListener("input", () => {
      tile = clampTile(zoom.value);
      localStorage.setItem(LS_TILE, String(tile));
      applyZoom();
    });
    zoomWrap.append(zoomLbl, zoom);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;";
    const cancelBtn = button("Cancel");
    cancelBtn.onclick = () => done(null);
    const chooseBtn = button("Select", true);
    chooseBtn.disabled = true;
    chooseBtn.style.opacity = "0.45";
    chooseBtn.onclick = () => {
      if (selected) done(selected);
    };
    actions.append(cancelBtn, chooseBtn);
    footer.append(zoomWrap, actions);

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) done(null);
    });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", esc);
        done(null);
      }
    });

    // Start at the node's folder, else the last-used folder.
    load((startDir || "").trim() || localStorage.getItem(LS_DIR) || "");
  });
}

// Widget values can be non-strings on graphs saved by an older node version
// (shifted widget order). Coerce before any string op so a stray boolean/number
// never throws and aborts the workflow load (#42).
const asStr = (v) => (typeof v === "string" ? v : "");

// Build the full source path from the folder + file-name widgets. When no name
// is set, the folder field is treated as a full file path (hand-pasted) (#42).
function fullPath(folder, name) {
  folder = asStr(folder).trim();
  name = asStr(name).trim();
  if (folder && name) return folder.replace(/[\\/]+$/, "") + "/" + name;
  return folder;
}

function baseName(p) {
  const parts = asStr(p)
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

// Add the Browse button + an on-node thumbnail of the selected image to a JIP
// Load node, bound to the image_path (folder) and image_name (file) widgets (#42).
export function addBrowseToLoad(node) {
  const w = node.widgets?.find((x) => x.name === "image_path");
  if (!w) return;
  const nameW = node.widgets?.find((x) => x.name === "image_name");
  // The file name lives on the preview as a grey caption, not as a field.
  if (nameW) {
    nameW.computeSize = () => [0, -4];
    nameW.type = "hidden";
    nameW.hidden = true;
  }

  // ── on-node preview of the currently selected image + filename caption ───
  const prevRoot = document.createElement("div");
  prevRoot.style.cssText =
    "padding:2px 8px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:3px;";
  const prevImg = document.createElement("img");
  prevImg.style.cssText =
    "max-width:100%;max-height:740px;object-fit:contain;background:#1a1a1a;border-radius:4px;display:none;";
  const prevCap = document.createElement("div");
  prevCap.style.cssText =
    "max-width:100%;text-align:center;color:#9a9a9a;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;";
  const prevDims = document.createElement("div");
  prevDims.style.cssText =
    "max-width:100%;text-align:center;color:#777;font-size:10px;white-space:nowrap;display:none;";
  const prevEmpty = document.createElement("div");
  prevEmpty.textContent = "No image selected";
  prevEmpty.style.cssText = "color:#777;font-size:11px;padding:6px;";
  prevRoot.append(prevImg, prevCap, prevDims, prevEmpty);

  const prevWidget = node.addDOMWidget(
    "jip_selected_preview",
    "div",
    prevRoot,
    { serialize: false, margin: 4 },
  );
  node._jipPrevH = 22;
  prevWidget.computeSize = () => [node.size[0], node._jipPrevH];

  let dimsReq = 0; // guards against a stale dims response landing after a newer pick
  const updatePreview = () => {
    const folder = asStr(w.value).trim();
    const name = asStr(nameW?.value).trim();
    const full = fullPath(folder, name);
    const caption = name || baseName(folder);
    if (full) {
      // cache-bust so re-picking the same path after an edit refreshes.
      prevImg.src = `/jip/thumb?path=${encodeURIComponent(full)}&size=512&t=${Date.now()}`;
      prevImg.style.display = "block";
      prevCap.textContent = caption;
      prevCap.title = full;
      prevCap.style.display = caption ? "block" : "none";
      prevEmpty.style.display = "none";

      // Real (full-res) dimensions under the filename — the thumbnail's own
      // pixel size isn't the source resolution (#42).
      prevDims.textContent = "";
      prevDims.style.display = "none";
      const reqId = ++dimsReq;
      fetch(`/jip/imageinfo?path=${encodeURIComponent(full)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((info) => {
          if (reqId !== dimsReq || !info || !info.width) return;
          prevDims.textContent = `${info.width} × ${info.height}`;
          prevDims.style.display = "block";
        })
        .catch(() => {});
    } else {
      dimsReq++; // invalidate any in-flight dims fetch
      prevImg.removeAttribute("src");
      prevImg.style.display = "none";
      prevCap.style.display = "none";
      prevDims.style.display = "none";
      prevEmpty.textContent = "No image selected";
      prevEmpty.style.display = "block";
      node._jipPrevH = 22;
      node.setSize([node.size[0], node.computeSize()[1]]);
      app.graph?.setDirtyCanvas(true, false);
    }
  };
  prevImg.onload = () => {
    const ratio = prevImg.naturalWidth
      ? prevImg.naturalHeight / prevImg.naturalWidth
      : 0.66;
    const imgH = Math.min(
      740,
      Math.max(60, Math.round((node.size[0] - 16) * ratio)),
    );
    node._jipPrevH = imgH + 40; // + filename caption + dimensions rows
    node.setSize([node.size[0], node.computeSize()[1]]);
    app.graph?.setDirtyCanvas(true, false);
  };
  prevImg.onerror = () => {
    prevImg.style.display = "none";
    prevCap.style.display = "none";
    prevDims.style.display = "none";
    prevEmpty.textContent = "Preview unavailable";
    prevEmpty.style.display = "block";
  };

  // Refresh the preview whenever the folder widget changes (typing).
  const origCb = w.callback;
  w.callback = function () {
    const res = origCb?.apply(this, arguments);
    updatePreview();
    return res;
  };

  // ── Browse button ────────────────────────────────────────────────────────
  const row = document.createElement("div");
  row.style.cssText = "padding:2px 8px 4px;box-sizing:border-box;";
  const btn = button("📁 Browse…", true);
  btn.style.width = "100%";
  btn.onclick = async (e) => {
    e.preventDefault();
    const picked = await openBrowse(asStr(w.value).trim());
    if (picked) {
      w.value = picked.dir || "";
      if (nameW) nameW.value = picked.name || "";
      if (typeof w.callback === "function") w.callback(w.value);
      updatePreview();
      app.graph?.setDirtyCanvas(true, false);
    }
  };
  row.appendChild(btn);
  const btnWidget = node.addDOMWidget("jip_browse_btn", "div", row, {
    serialize: false,
    margin: 4,
  });
  btnWidget.computeSize = () => [node.size[0], 28];

  // Order under image_path: [ Browse button ][ preview ].
  const place = (widget, afterName) => {
    const wi = node.widgets.indexOf(widget);
    if (wi >= 0) node.widgets.splice(wi, 1);
    const ai = node.widgets.findIndex((x) => x.name === afterName);
    node.widgets.splice(ai >= 0 ? ai + 1 : node.widgets.length, 0, widget);
  };
  place(btnWidget, "image_path");
  place(prevWidget, "jip_browse_btn");

  // Restore the preview after a graph load (configure runs after creation).
  const prevConfigure = node.onConfigure;
  node.onConfigure = function () {
    const r = prevConfigure?.apply(this, arguments);
    updatePreview();
    return r;
  };

  updatePreview();
}
