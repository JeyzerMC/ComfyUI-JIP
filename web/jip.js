import { app } from "../../scripts/app.js";
import { initInteractive } from "./jip-overlay.js";
import { addBrowseToLoad } from "./jip-browse.js";  // custom on-disk source picker (#42)
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
        else if (nodeData?.name === "JIPResize") setupResize(nodeType);
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

        // Custom on-disk source picker: a Browse button under the image_path
        // field that opens the folder overlay and writes the chosen absolute
        // path back into the widget (#42).
        addBrowseToLoad(this);

        // Consume row (label + toggle switch). Built without auto-placement;
        // the explicit ordering below seats it directly above output_name (#24).
        makeToggleBox(this, "consume", "Consume");

        // Plain grey label showing the destination, no field-name (#10). The
        // base_dir field was removed (#33): the destination is output_path +
        // output_name directly (output_path may be relative or absolute).
        const labelEl = document.createElement("div");
        labelEl.style.cssText = "padding:3px 8px;font-size:10px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;";
        const labelWidget = this.addDOMWidget("output_path_label", "div", labelEl, { serialize: false });
        labelWidget.computeSize = () => [this.size[0], 18];

        // Widget values can be non-strings on graphs saved by an older node
        // version (shifted widget order). Coerce before trimming so a stray
        // boolean/number never throws and aborts the whole workflow load (#42).
        const asStr = (v) => (typeof v === "string" ? v : "");
        const refresh = () => {
            const name = asStr(get("output_name")?.value).trim();
            const path = (asStr(get("output_path")?.value) || "input/cnets/").trim().replace(/\/+$/, "");
            const full = `${path}/${name || "<name>"}.png`.replace(/\/{2,}/g, "/");
            labelEl.textContent = full;
            labelEl.title = full;
            app.graph?.setDirtyCanvas(true, false);
        };

        for (const n of ["output_name", "output_path"]) {
            const w = get(n);
            if (!w) continue;
            const cb = w.callback;
            w.callback = function () {
                const res = cb?.apply(this, arguments);
                refresh();
                return res;
            };
        }

        refresh();

        // Final on-node widget order (#42). The native (hidden) `consume`
        // boolean is left out of this list so it falls to the end and never
        // opens a gap between the Consume toggle and output_name.
        const desired = [
            "image_path", "jip_browse_btn", "jip_selected_preview",
            "consume_box", "output_name", "output_path", "output_path_label",
        ];
        const byName = new Map();
        for (const w of this.widgets) if (!byName.has(w.name)) byName.set(w.name, w);
        const ordered = [];
        for (const n of desired) {
            const w = byName.get(n);
            if (w) { ordered.push(w); byName.delete(n); }
        }
        for (const w of this.widgets) if (byName.has(w.name)) { ordered.push(w); byName.delete(w.name); }
        this.widgets = ordered;

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

// JIP Resize: lay the four dimension ints out as a 2x2 grid (no input pins) (#25):
//             width   height
//   portrait  [ ]     [ ]
//   landscape [ ]     [ ]
function setupResize(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const r = onNodeCreated?.apply(this, arguments);
        makeDimGrid(this);
        return r;
    };
}

function makeDimGrid(node) {
    const rows = [
        ["portrait", "portrait_width", "portrait_height"],
        ["landscape", "landscape_width", "landscape_height"],
    ];

    const container = document.createElement("div");
    container.style.cssText = "display:grid;grid-template-columns:auto 1fr 1fr;gap:4px 6px;align-items:center;padding:4px 8px;box-sizing:border-box;";

    // Header row: blank corner + column headers.
    const corner = document.createElement("div");
    const hW = document.createElement("div"); hW.textContent = "width";
    const hH = document.createElement("div"); hH.textContent = "height";
    for (const h of [hW, hH]) h.style.cssText = "font-size:10px;color:#9a9a9a;text-align:center;";
    container.append(corner, hW, hH);

    const syncs = [];
    for (const [rowLabel, ...names] of rows) {
        const lab = document.createElement("div");
        lab.textContent = rowLabel;
        lab.style.cssText = "font-size:11px;color:#cfcfcf;";
        container.appendChild(lab);
        for (const name of names) {
            const w = node.widgets?.find((x) => x.name === name);
            const inp = document.createElement("input");
            inp.type = "number"; inp.min = "1"; inp.max = "8192";
            inp.style.cssText = "width:100%;box-sizing:border-box;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:4px;padding:2px 4px;font-size:11px;text-align:center;";
            if (w) {
                w.computeSize = () => [0, -4];
                w.type = "hidden"; w.hidden = true;
                const sync = () => { inp.value = String(w.value ?? ""); };
                sync(); syncs.push(sync);
                inp.addEventListener("change", () => {
                    let v = parseInt(inp.value, 10);
                    if (!Number.isFinite(v)) v = Number(w.value) || 1;
                    v = Math.max(1, Math.min(8192, v));
                    inp.value = String(v);
                    w.value = v;
                    if (typeof w.callback === "function") w.callback(v);
                    app.graph?.setDirtyCanvas(true, false);
                });
            }
            container.appendChild(inp);
        }
    }

    const widget = node.addDOMWidget("jip_dim_grid", "div", container, { serialize: false, margin: 4 });
    widget.computeSize = () => [node.size[0], 72];

    // Render the grid directly under the payload pin.
    const i = node.widgets.indexOf(widget);
    if (i > 0) { node.widgets.splice(i, 1); node.widgets.unshift(widget); }

    // Re-sync inputs after a graph load restores the int widget values (#25).
    const prevConfigure = node.onConfigure;
    node.onConfigure = function () {
        const r = prevConfigure?.apply(this, arguments);
        for (const s of syncs) s();
        app.graph?.setDirtyCanvas(true, false);
        return r;
    };

    requestAnimationFrame(() => {
        node.setSize([node.size[0], node.computeSize()[1]]);
        app.graph?.setDirtyCanvas(true, true);
    });
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
    // Match the native widget labels (output_name / output_path) so the toggle
    // row reads as one of them: same secondary text color, size and font that
    // litegraph draws widget names with, read from the active theme (#42).
    const LG = window.LiteGraph || {};
    const labelColor = LG.WIDGET_SECONDARY_TEXT_COLOR || "#b0b0b8";
    const labelSize = LG.NODE_TEXT_SIZE || 14;
    const labelFont = LG.NODE_TEXT_FONT || "Arial, sans-serif";
    lbl.style.cssText = `font-size:${labelSize}px;color:${labelColor};font-family:${labelFont};`;
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
