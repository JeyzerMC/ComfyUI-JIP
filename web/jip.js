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
    },
});

function setupLoad(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const r = onNodeCreated?.apply(this, arguments);

        const get = (name) => this.widgets?.find((w) => w.name === name);

        // Real resolved roots, fetched from the backend (#9). Until they arrive,
        // fall back to the label name alone.
        let roots = { comfy_install: "", extra_path: null };
        const fwd = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "");
        const baseLabel = () => {
            const v = get("base_dir")?.value || "Comfy Install";
            if (v === "Extra Path") return `Extra Path: ${fwd(roots.extra_path) || "(none)"}`;
            return `Comfy Install: ${fwd(roots.comfy_install)}`;
        };

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

        // Pull the real base paths; drop the Extra Path option when unconfigured (#9).
        fetch("/jip/roots", { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => {
                roots = d || roots;
                const bw = get("base_dir");
                if (bw && !roots.extra_path) {
                    if (bw.options && Array.isArray(bw.options.values)) bw.options.values = ["Comfy Install"];
                    if (bw.value === "Extra Path") bw.value = "Comfy Install";
                }
                refresh();
            })
            .catch(() => {});

        refresh();
        return r;
    };
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
}
