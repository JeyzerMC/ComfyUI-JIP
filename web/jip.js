import { app } from "../../scripts/app.js";

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
    },
});

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
        const baseLabel = () => {
            const v = get("base_dir")?.value || "Comfy Install";
            const r = rootByLabel(v);
            return `${v}: ${r ? fwd(r.path) : "(unknown)"}`;
        };

        // Consume toggle, styled like the CNet boxes, under the image (#20).
        makeToggleBox(this, "consume", "Consume (move source)");

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
        el.style.cssText = "width:100%;height:110px;object-fit:contain;background:#1a1a1a;border-radius:3px;";
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

// A single styled toggle box bound to one boolean widget (#20). Mirrors the
// look of the CNet toggle boxes; hides the native checkbox.
function makeToggleBox(node, widgetName, label) {
    const w = node.widgets?.find((x) => x.name === widgetName);
    if (!w) return;
    w.computeSize = () => [0, -4];
    w.type = "hidden";
    w.hidden = true;

    const box = document.createElement("div");
    const render = () => {
        const on = !!w.value;
        box.style.cssText = `box-sizing:border-box;min-height:26px;display:flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;user-select:none;text-align:center;padding:4px;line-height:1.15;border:1px solid ${on ? "#4a9eff" : "#444"};background:${on ? "rgba(74,158,255,0.18)" : "#2a2a2a"};color:${on ? "#cfe6ff" : "#9a9a9a"};`;
        box.textContent = label;
    };
    box.addEventListener("click", () => {
        w.value = !w.value;
        if (typeof w.callback === "function") w.callback(w.value);
        render();
        app.graph?.setDirtyCanvas(true, false);
    });
    render();

    const container = document.createElement("div");
    container.style.cssText = "padding:4px 6px;box-sizing:border-box;";
    container.appendChild(box);
    const widget = node.addDOMWidget(`${widgetName}_box`, "div", container, { serialize: false, margin: 4 });
    widget.computeSize = () => [node.size[0], 34];
}

// Hide the named boolean widgets and drive them from a grid of toggleable
// name boxes (#16). Each box reflects and flips its widget's value on click.
function makeToggleGrid(node, labels, widgetId) {
    const container = document.createElement("div");
    container.style.cssText = "display:grid;grid-template-columns:repeat(2, 1fr);gap:4px;padding:4px 6px;box-sizing:border-box;";

    let count = 0;
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
        box.addEventListener("click", () => {
            w.value = !w.value;
            if (typeof w.callback === "function") w.callback(w.value);
            render();
            app.graph?.setDirtyCanvas(true, false);
        });
        render();
        container.appendChild(box);
    }

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
