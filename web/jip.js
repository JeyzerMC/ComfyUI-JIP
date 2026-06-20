import { app } from "../../scripts/app.js";
import { initInteractive } from "./jip-overlay.js";
import "./jip-rmbg.js";     // registers the "rmbg" overlay handler (#11)
import "./jip-resize.js";   // registers the "resize" overlay handler (#12)

// Subscribe to the backend pause/resume handshake once at load (#22).
initInteractive();

// ComfyUI-JIP frontend.
//   JIPLoad: a live "<base>/<output_path>/<output_name>.png" readout (#2).
//   JIPCNetPreprocess: a grid of toggleable controlnet boxes instead of a
//     column of boolean checkboxes, and no on-node image preview (#16).
app.registerExtension({
    name: "JeyzerMC.JIP",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === "JIPLoad") setupLoad(nodeType);
        else if (nodeData?.name === "JIPCNetPreprocess") setupCNet(nodeType);
        else if (nodeData?.name === "JIPSave") setupSave(nodeType);
        else if (nodeData?.name === "JIPRMBG") setupRMBG(nodeType);
    },
});

// JIP RMBG: model selection as a toggle grid (multi-select); no on-node image (#11).
const RMBG_MODELS = ["u2net", "u2netp", "isnet-general-use", "silueta"];
function setupRMBG(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const r = onNodeCreated?.apply(this, arguments);
        makeToggleGrid(this, RMBG_MODELS, "rmbg_models");
        return r;
    };
}

function setupLoad(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const r = onNodeCreated?.apply(this, arguments);

        const get = (name) => this.widgets?.find((w) => w.name === name);

        // Real resolved base roots, fetched from the backend (#9, #19). Each is
        // { index, label, path }. Until they arrive, fall back to the label name.
        let roots = [];
        const fwd = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "");
        const rootByLabel = (label) => roots.find((r) => r.label === label);
        // The readout shows the RESOLVED disk path of the selected root, not the
        // label — so "Comfy Install" reads as the actual install folder on disk
        // and an Extra Path reads as its real location (#23).
        const baseLabel = () => {
            const v = get("base_dir")?.value || "Comfy Install";
            const r = rootByLabel(v);
            return r ? fwd(r.path) : v;
        };

        // Consume row (label + toggle switch), placed directly under the image
        // widget and above output_name (#24).
        makeToggleBox(this, "consume", "Consume", "image");

        // Plain grey label showing the full output path, no field-name (#10).
        const labelEl = document.createElement("div");
        labelEl.style.cssText = "padding:3px 8px;font-size:10px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;";
        const labelWidget = this.addDOMWidget("output_path_label", "div", labelEl, { serialize: false });
        labelWidget.computeSize = () => [this.size[0], 18];

        const refresh = () => {
            const name = (get("output_name")?.value || "").trim();
            const path = (get("output_path")?.value || "cnets/").trim().replace(/^\/+|\/+$/g, "");
            const full = `${baseLabel()}/${path}/${name || "<name>"}.png`.replace(/\/{2,}/g, "/");
            labelEl.textContent = full;
            labelEl.title = full;
            app.graph?.setDirtyCanvas(true, false);
        };

        for (const n of ["output_name", "output_path", "base_dir"]) {
            const w = get(n);
            if (!w) continue;
            const cb = w.callback;
            w.callback = function () {
                const res = cb?.apply(this, arguments);
                refresh();
                return res;
            };
        }

        // Pull the real base roots and rebuild the base_dir options from them so
        // any configured Extra Path appears, and only configured ones do (#9, #19).
        fetch("/jip/roots", { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => {
                roots = (d && d.roots) || [];
                const labels = roots.map((r) => r.label);
                const bw = get("base_dir");
                if (bw && labels.length) {
                    if (bw.options && Array.isArray(bw.options.values)) bw.options.values = labels;
                    if (!labels.includes(bw.value)) bw.value = labels[0];
                }
                refresh();
            })
            .catch(() => {});

        refresh();
        return r;
    };
}

// JIPSave: a labelled output grid. Each cell shows the saved image, its filename
// (full absolute path on hover) and dimensions, with the batch directory below —
// mirroring comfyui-flakes' Flake Generate presentation (#18).
function setupSave(nodeType) {
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
        onExecuted?.apply(this, arguments);
        renderSaveGrid(this, message);
    };
}

function renderSaveGrid(node, message) {
    const images = message?.jip_images || [];
    const meta = message?.jip_meta || [];
    const dir = (message?.jip_dir && message.jip_dir[0]) || "";

    // One reused DOM widget for the grid.
    if (!node._jipSaveEl) {
        const root = document.createElement("div");
        root.style.cssText = "width:100%;box-sizing:border-box;padding:4px 6px;";
        const widget = node.addDOMWidget("jip_save_grid", "div", root, { serialize: false, margin: 4 });
        widget.computeSize = () => [node.size[0], node._jipSaveH || 60];
        node._jipSaveEl = root;
    }
    const root = node._jipSaveEl;
    root.replaceChildren();

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2, 1fr);gap:6px;";
    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const m = meta[i] || {};
        const cell = document.createElement("div");
        cell.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;";

        const el = document.createElement("img");
        el.src = `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || "temp"}&subfolder=${encodeURIComponent(img.subfolder || "")}`;
        el.style.cssText = "width:100%;height:110px;object-fit:contain;background:#1a1a1a;border-radius:3px;cursor:pointer;";
        // Double-click reveals the real saved file on disk (#32). The absolute
        // path comes from the meta the backend shipped; the server confines it
        // to the JIP roots before opening the OS explorer.
        if (m.path) {
            el.title = "Double-click to reveal in file explorer";
            el.addEventListener("dblclick", () => {
                fetch("/jip/reveal", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: m.path }),
                }).catch((e) => console.error("[JIP] reveal failed", e));
            });
        }
        cell.appendChild(el);

        const name = document.createElement("div");
        name.textContent = m.filename || img.filename;
        name.title = m.path || "";  // full absolute path on hover
        name.style.cssText = "width:100%;text-align:center;color:#ccc;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default;";
        cell.appendChild(name);

        const dims = document.createElement("div");
        dims.textContent = (m.width && m.height) ? `${m.width} × ${m.height}` : "";
        dims.style.cssText = "color:#888;font-size:10px;";
        cell.appendChild(dims);

        grid.appendChild(cell);
    }
    root.appendChild(grid);

    const dirLabel = document.createElement("div");
    dirLabel.textContent = dir;
    dirLabel.title = dir;
    dirLabel.style.cssText = "margin-top:6px;color:#888;font-size:10px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default;";
    root.appendChild(dirLabel);

    const rows = Math.ceil(images.length / 2);
    node._jipSaveH = rows * 140 + 30;
    requestAnimationFrame(() => {
        node.setSize([node.size[0], node.computeSize()[1]]);
        app.graph?.setDirtyCanvas(true, true);
    });
}

// The controlnet preprocessor labels, mirroring PREPROCESSORS in jip/nodes/cnet.py.
const CNET_LABELS = [
    "DepthAnythingV2", "DWPose", "HED", "DensePose",
    "CannyEdge", "LineArt", "Manga2Anime", "OpenPose",
];

function setupCNet(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const r = onNodeCreated?.apply(this, arguments);
        makeToggleGrid(this, CNET_LABELS, "cnet_grid");
        return r;
    };
}

// A label + toggle-switch row bound to one boolean widget (#24): the label sits
// on the left, an on/off switch on the right. Hides the native checkbox and can
// be positioned directly after another widget (e.g. under `image`).
function makeToggleBox(node, widgetName, label, afterName) {
    const w = node.widgets?.find((x) => x.name === widgetName);
    if (!w) return;
    w.computeSize = () => [0, -4];
    w.type = "hidden";
    w.hidden = true;

    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;box-sizing:border-box;cursor:pointer;user-select:none;";
    const lbl = document.createElement("span");
    lbl.textContent = label;
    lbl.style.cssText = "font-size:12px;color:#cfcfcf;";
    if (w.tooltip) row.title = w.tooltip;

    const sw = document.createElement("div");
    const knob = document.createElement("div");
    sw.appendChild(knob);
    const render = () => {
        const on = !!w.value;
        sw.style.cssText = `position:relative;width:38px;height:20px;border-radius:10px;background:${on ? "#4a9eff" : "#555"};transition:background .15s;flex:0 0 auto;`;
        knob.style.cssText = `position:absolute;top:2px;left:${on ? "20px" : "2px"};width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;`;
    };
    row.append(lbl, sw);
    render();

    row.addEventListener("click", () => {
        w.value = !w.value;
        if (typeof w.callback === "function") w.callback(w.value);
        render();
        app.graph?.setDirtyCanvas(true, false);
    });

    const widget = node.addDOMWidget(`${widgetName}_box`, "div", row, { serialize: false, margin: 4 });
    widget.computeSize = () => [node.size[0], 26];

    // Position the row directly after `afterName` (e.g. the image widget) so it
    // sits above output_name (#24). The DOM widget is serialize:false, so moving
    // it never affects the serialized order of the real widgets.
    if (afterName) {
        const widx = node.widgets.indexOf(widget);
        if (widx >= 0) node.widgets.splice(widx, 1);
        const ai = node.widgets.findIndex((x) => x.name === afterName);
        node.widgets.splice(ai >= 0 ? ai + 1 : node.widgets.length, 0, widget);
    }

    // Re-sync after a graph load restores the widget value (#24, mirrors #30).
    const prevConfigure = node.onConfigure;
    node.onConfigure = function () {
        const r = prevConfigure?.apply(this, arguments);
        render();
        app.graph?.setDirtyCanvas(true, false);
        return r;
    };
}

// Hide the named boolean widgets and drive them from a grid of toggleable
// name boxes (#16). Each box reflects and flips its widget's value on click.
function makeToggleGrid(node, labels, widgetId) {
    const container = document.createElement("div");
    container.style.cssText = "display:grid;grid-template-columns:repeat(2, 1fr);gap:4px;padding:4px 6px;box-sizing:border-box;";

    let count = 0;
    const renders = [];  // re-render every box from its widget value (#30)
    for (const label of labels) {
        const w = node.widgets?.find((x) => x.name === label);
        if (!w) continue;
        count++;

        // Collapse the native boolean widget; the box below drives it.
        w.computeSize = () => [0, -4];
        w.type = "hidden";
        w.hidden = true;

        const box = document.createElement("div");
        const render = () => {
            const on = !!w.value;
            box.style.cssText = `box-sizing:border-box;min-height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;user-select:none;text-align:center;padding:4px;line-height:1.15;word-break:break-word;border:1px solid ${on ? "#4a9eff" : "#444"};background:${on ? "rgba(74,158,255,0.18)" : "#2a2a2a"};color:${on ? "#cfe6ff" : "#9a9a9a"};`;
            box.textContent = label;
        };
        renders.push(render);
        box.addEventListener("click", () => {
            w.value = !w.value;
            if (typeof w.callback === "function") w.callback(w.value);
            render();
            app.graph?.setDirtyCanvas(true, false);
        });
        render();
        container.appendChild(box);
    }

    // After a graph load, ComfyUI restores the (socketless) boolean widget values
    // via configure() — which runs AFTER onNodeCreated, so the boxes built above
    // captured the schema defaults. Re-sync every box to the restored values so
    // the selection persists visually and matches what executes (#30).
    const prevConfigure = node.onConfigure;
    node.onConfigure = function () {
        const r = prevConfigure?.apply(this, arguments);
        for (const fn of renders) fn();
        app.graph?.setDirtyCanvas(true, false);
        return r;
    };

    const widget = node.addDOMWidget(widgetId, "div", container, { serialize: false, margin: 4 });
    widget.computeSize = () => [node.size[0], Math.ceil(count / 2) * 32 + 12];

    // Render the grid directly under the payload pin: move it ahead of the now
    // hidden boolean widgets so no empty band is left between them (#21).
    const i = node.widgets.indexOf(widget);
    if (i > 0) {
        node.widgets.splice(i, 1);
        node.widgets.unshift(widget);
    }
    // Tighten the node to its content so there is no trailing gap either.
    requestAnimationFrame(() => {
        node.setSize([node.size[0], node.computeSize()[1]]);
        app.graph?.setDirtyCanvas(true, true);
    });
}
