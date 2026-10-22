/* ---------- Boutons et raccourcis ---------- */

$("btn-stop").onclick = () => {
    ui.interrupted = true;
    api.interrupt().catch(() => {});
};
$("btn-resume").onclick = () => {
    ui.interrupted = false;
    $("btn-resume").classList.add("hidden");
    send("Reprends la tâche précédente là où tu t'es arrêté (elle a été interrompue).");
};
$("btn-new").onclick = () => send("/new");
$("btn-clear").onclick = () => send("/clear");
$("btn-help").onclick = () => send("/help");
$("mode-select").onchange = (ev) => send(`/mode ${ev.target.value}`);
$("btn-model").onclick = (ev) => {
    ev.stopPropagation();
    toggleModelMenu();
};
$("st-model").onclick = () => toggleModelMenu();
$("btn-history").onclick = (ev) => {
    ev.stopPropagation();
    toggleHistoryMenu();
};
$("st-usage").onclick = () => {
    setAgentTab("usage");
};
$("st-usage").setAttribute("role", "button");
$("st-usage").tabIndex = 0;
$("st-usage").onkeydown = event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setAgentTab("usage"); }
};
$("btn-open-project").onclick = openProject;
$("btn-open-project-2").onclick = openProject;
$("btn-refresh-tree").onclick = () => renderTree();
$("btn-clear-output").onclick = () => {
    output.textContent = "";
};

function toggleSidebar() {
    const app = $("app");
    app.classList.toggle("no-sidebar");
    document.querySelector('[data-view="explorer"]').classList.toggle("active", !app.classList.contains("no-sidebar"));
}

document.querySelector('[data-view="explorer"]').onclick = toggleSidebar;
document.querySelector('[data-view="agent"]').onclick = () => input.focus();

const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent || "");
if (IS_MAC) document.documentElement.classList.add("mac");

document.addEventListener("keydown", (ev) => {
    if(document.querySelector("dialog[open]"))return;
    if (!(ev.ctrlKey || (IS_MAC && ev.metaKey))) {
        if (ev.key === "Escape" && ui.status.busy && document.activeElement !== input) {
            api.interrupt().catch(() => {});
        }
        return;
    }
    const key = ev.key.toLowerCase();
    if (ev.shiftKey && key === "e") {
        ev.preventDefault();
        toggleSidebar();
    } else if (ev.shiftKey && key === "a") {
        ev.preventDefault();
        input.focus();
    } else if (key === "s") {
        ev.preventDefault();
        saveCurrent();
    } else if (key === "o") {
        ev.preventDefault();
        openProject();
    } else if (key === "w") {
        ev.preventDefault();
        if (ui.active) closeTab(ui.active);
    } else if (key === "l") {
        ev.preventDefault();
        input.focus();
    }
});

window.addEventListener("beforeunload", (ev) => {
    if (ui.tabs.some((t) => t.dirty)) {
        ev.preventDefault();
        ev.returnValue = "";
    }
});

const LAYOUT_LIMITS = {
    "--left": { min: 150, max: 600 },
    "--right": { min: 280, max: 900 },
    "--bottom": { min: 60, max: 600 },
};
const CENTER_MIN_WIDTH = 320;
const EDITOR_MIN_HEIGHT = 160;

function layoutPx(cssVar) {
    const value = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10);
    return Number.isFinite(value) ? value : LAYOUT_LIMITS[cssVar].min;
}

function layoutHidden(cssVar) {
    const app = $("app");
    if (cssVar === "--left") return app.classList.contains("no-sidebar");
    if (cssVar === "--right") return app.classList.contains("no-agent");
    return app.classList.contains("no-panel");
}

function layoutMax(cssVar) {
    const limits = LAYOUT_LIMITS[cssVar];
    let room;
    if (cssVar === "--bottom") {
        const center = $("center");
        const height = center && center.clientHeight ? center.clientHeight : window.innerHeight;
        room = height - EDITOR_MIN_HEIGHT;
    } else {
        const other = cssVar === "--left" ? "--right" : "--left";
        const otherWidth = layoutHidden(other) ? 0 : layoutPx(other) + 4;
        room = window.innerWidth - 48 - 4 - otherWidth - CENTER_MIN_WIDTH;
    }
    return Math.max(limits.min, Math.min(limits.max, room));
}

function clampLayout() {
    for (const v of ["--right", "--left", "--bottom"]) {
        if (layoutHidden(v)) continue;
        const current = layoutPx(v);
        const next = Math.max(LAYOUT_LIMITS[v].min, Math.min(layoutMax(v), current));
        if (next !== current) document.documentElement.style.setProperty(v, `${next}px`);
    }
}

let layoutFrame = 0;

function scheduleClampLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        clampLayout();
    });
}

function dragResizer(id, cssVar, axis, invert) {
    const handle = $(id);
    if (!handle) return;
    handle.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        try {
            handle.setPointerCapture(ev.pointerId);
        } catch {
            // capture indisponible
        }
        const start = axis === "x" ? ev.clientX : ev.clientY;
        const initial = layoutPx(cssVar);
        const min = LAYOUT_LIMITS[cssVar].min;
        const max = layoutMax(cssVar);
        let last = start;
        let frame = 0;
        document.body.classList.add(axis === "x" ? "resizing-x" : "resizing-y");
        const apply = () => {
            frame = 0;
            const delta = last - start;
            const value = Math.max(min, Math.min(max, initial + (invert ? -delta : delta)));
            document.documentElement.style.setProperty(cssVar, `${value}px`);
        };
        const move = (e) => {
            last = axis === "x" ? e.clientX : e.clientY;
            if (!frame) frame = requestAnimationFrame(apply);
        };
        const up = () => {
            if (frame) {
                cancelAnimationFrame(frame);
                apply();
            }
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            handle.removeEventListener("pointercancel", up);
            document.body.classList.remove("resizing-x", "resizing-y");
            if (typeof saveLayout === "function") saveLayout();
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
    });
}

dragResizer("resizer-left", "--left", "x", false);
dragResizer("resizer-right", "--right", "x", true);
dragResizer("resizer-bottom", "--bottom", "y", true);

window.addEventListener("resize", scheduleClampLayout);
new MutationObserver(scheduleClampLayout).observe($("app"), { attributes: true, attributeFilter: ["class"] });
scheduleClampLayout();

/* ---------- Boîte de saisie ---------- */

function inputDialog(title, value = "") {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        const box = document.createElement("div");
        box.className = "modal";
        const heading = document.createElement("div");
        heading.className = "modal-title";
        heading.textContent = title;
        const field = document.createElement("input");
        field.type = "text";
        field.value = value;
        const buttons = document.createElement("div");
        buttons.className = "buttons";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "primary";
        ok.textContent = "OK";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Annuler";
        buttons.append(ok, cancel);
        box.append(heading, field, buttons);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const close = (result) => {
            overlay.remove();
            resolve(result);
        };
        ok.onclick = () => close(field.value.trim() || null);
        cancel.onclick = () => close(null);
        overlay.addEventListener("mousedown", (ev) => {
            if (ev.target === overlay) close(null);
        });
        field.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                close(field.value.trim() || null);
            } else if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                close(null);
            }
        });
        setTimeout(() => {
            field.focus();
            const slash = field.value.lastIndexOf("/");
            const dot = field.value.lastIndexOf(".");
            field.setSelectionRange(slash + 1, dot > slash + 1 ? dot : field.value.length);
        }, 0);
    });
}

