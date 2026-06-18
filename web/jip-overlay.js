// JIP interactive overlay infrastructure (#22).
//   - subscribes to the backend "jip-interactive" event
//   - dispatches to a per-kind overlay handler (registered by RMBG/Resize)
//   - posts the user's result/cancel back to resume the paused node
//   - shared modal/button/canvas helpers used by the overlays
import { api } from "../../scripts/api.js";

const HANDLERS = {};
let _inited = false;

export function registerOverlay(kind, handler) {
    HANDLERS[kind] = handler;
}

export function viewURL(img) {
    return `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || "temp"}&subfolder=${encodeURIComponent(img.subfolder || "")}`;
}

export async function resolveToken(token, result) {
    try {
        await api.fetchApi("/jip/interactive/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, result }),
        });
    } catch (e) {
        console.error("[JIP] resolve failed", e);
    }
}

export async function cancelToken(token) {
    try {
        await api.fetchApi("/jip/interactive/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        });
    } catch (e) {
        console.error("[JIP] cancel failed", e);
    }
}

// Subscribe once; safe to call from every JIP module.
export function initInteractive() {
    if (_inited) return;
    _inited = true;
    api.addEventListener("jip-interactive", (e) => {
        const detail = e.detail || {};
        const handler = HANDLERS[detail.kind];
        if (!handler) {
            console.warn("[JIP] no overlay registered for kind:", detail.kind);
            cancelToken(detail.token);
            return;
        }
        try {
            handler(detail);
        } catch (err) {
            console.error("[JIP] overlay handler error:", err);
            cancelToken(detail.token);
        }
    });
}

// ── shared UI helpers ──────────────────────────────────────────────────────

export function createModal(title) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;";
    const panel = document.createElement("div");
    panel.style.cssText = "background:#1e1e1e;border:1px solid #444;border-radius:8px;max-width:94vw;max-height:94vh;min-width:380px;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.6);";
    const header = document.createElement("div");
    header.textContent = title || "";
    header.style.cssText = "padding:10px 14px;font-size:14px;font-weight:600;color:#eee;border-bottom:1px solid #333;";
    const body = document.createElement("div");
    body.style.cssText = "padding:12px 14px;overflow:auto;flex:1;color:#ddd;";
    const footer = document.createElement("div");
    footer.style.cssText = "padding:10px 14px;border-top:1px solid #333;display:flex;align-items:center;justify-content:flex-end;gap:8px;";
    panel.append(header, body, footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    return { overlay, panel, header, body, footer, close };
}

export function button(label, primary) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = `padding:6px 14px;border-radius:5px;cursor:pointer;font-size:13px;border:1px solid ${primary ? "#4a9eff" : "#555"};background:${primary ? "#2b6cb0" : "#2a2a2a"};color:${primary ? "#fff" : "#ccc"};`;
    return b;
}

// Load an image element from a /view ref and resolve once decoded.
export function loadImage(img) {
    return new Promise((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = viewURL(img);
    });
}
