import { app } from "../../scripts/app.js";

// JIP Load: show a live "<base>/<output_path>/<output_name>.png" readout that
// updates as the output_name / output_path / base_dir widgets change (#2).
// The bespoke Load-Image button, image preview, and Flake-style hover buttons
// (remove / replace / edit) are layered on top of this in a follow-up.
app.registerExtension({
    name: "JeyzerMC.JIP",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== "JIPLoad") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);

            const get = (name) => this.widgets?.find((w) => w.name === name);
            const baseLabel = () => {
                const v = get("base_dir")?.value || "Comfy Install";
                return v === "Extra Path" ? "Extra Path: [D:/]" : "Comfy Install: [C:/]";
            };
            const preview = this.addWidget("text", "→ output", "", () => {}, { serialize: false });
            preview.disabled = true;

            const refresh = () => {
                const name = (get("output_name")?.value || "").trim();
                const path = (get("output_path")?.value || "cnets/").trim().replace(/^\/+|\/+$/g, "");
                preview.value = `${baseLabel()}/${path}/${name || "<name>"}.png`.replace(/\/{2,}/g, "/");
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
            refresh();
            return r;
        };
    },
});
