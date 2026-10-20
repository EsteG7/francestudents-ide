/* ---------- Panneau du bas : sortie de l'agent et terminal ---------- */

ui.panel = "output";

/* Terminaux multiples (comme VS Code) : chaque terminal a sa sortie colorée (ANSI),
   son dossier courant, son historique et au plus une commande en cours. */
const termInput = $("terminal-input");
const termViews = $("term-views");
const termList = $("term-list");
const terms = [];
const termByProc = new Map();
const earlyData = new Map();
const exitedProcs = new Map();
let termSeq = 0;
let activeTermKey = null;

/* ---------- Vrai terminal : xterm.js + pseudo-terminal (node-pty) ----------
   Chaque onglet lance un shell interactif (zsh/bash, PowerShell sous Windows).
   Repli automatique sur le terminal simple ci-dessous si node-pty ou xterm.js
   est indisponible. */
const termByPty = new Map();
const earlyPty = new Map();
const exitedPty = new Map();
let ptyBroken = false;
const XTERM_THEME = {
    background: "#181818",
    foreground: "#cccccc",
    cursor: "#aeafad",
    cursorAccent: "#181818",
    selectionBackground: "#264f78",
    black: "#000000", red: "#cd3131", green: "#0dbc79", yellow: "#e5e510",
    blue: "#2472c8", magenta: "#bc3fbc", cyan: "#11a8cd", white: "#e5e5e5",
    brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b", brightYellow: "#f5f543",
    brightBlue: "#3b8eea", brightMagenta: "#d670d6", brightCyan: "#29b8db", brightWhite: "#ffffff"
};

function xtermSupported() {
    return !ptyBroken
        && typeof window.Terminal === "function"
        && Boolean(window.FitAddon && window.FitAddon.FitAddon)
        && typeof api.ptyCreate === "function";
}

/** Ajuste xterm à la taille de son conteneur et prévient le shell (SIGWINCH). */
function fitTerm(term) {
    if (!term || !term.xterm || !term.el.isConnected || term.el.classList.contains("hidden")) return;
    if (!term.el.clientWidth || !term.el.clientHeight) return;
    try {
        term.fit.fit();
    } catch {
        return;
    }
    const { cols, rows } = term.xterm;
    if (term.ptyId && (cols !== term.lastCols || rows !== term.lastRows)) {
        term.lastCols = cols;
        term.lastRows = rows;
        api.ptyResize(term.ptyId, cols, rows).catch(() => {});
    }
}

function focusTerm(term = terms.find((t) => t.key === activeTermKey)) {
    if (term && term.xterm) term.xterm.focus();
    else termInput.focus();
}

function clearTerm(term) {
    if (!term) return;
    if (term.xterm) term.xterm.clear();
    else term.el.replaceChildren();
}

function disposeXterm(term) {
    if (!term || !term.xterm) return;
    if (term.ptyId) {
        termByPty.delete(term.ptyId);
        api.ptyKill(term.ptyId).catch(() => {});
        term.ptyId = null;
    }
    if (term.resizeObs) term.resizeObs.disconnect();
    try {
        term.xterm.dispose();
    } catch {
        // déjà libéré
    }
    term.xterm = null;
}

function startPty(term) {
    const xterm = term.xterm;
    if (!ui.workspace) {
        xterm.writeln("\x1b[33mAucun projet ouvert : ouvrez un dossier puis un nouveau terminal (+).\x1b[0m");
        return;
    }
    api.ptyCreate(".", xterm.cols, xterm.rows).then((res) => {
        if (!terms.includes(term) || !term.xterm) {
            api.ptyKill(res.id).catch(() => {});
            return;
        }
        term.ptyId = res.id;
        term.lastCols = xterm.cols;
        term.lastRows = xterm.rows;
        term.name = `${res.shell || "Terminal"} ${term.key}`;
        termByPty.set(res.id, term);
        if (earlyPty.has(res.id)) {
            xterm.write(earlyPty.get(res.id));
            earlyPty.delete(res.id);
        }
        if (exitedPty.has(res.id)) {
            const data = exitedPty.get(res.id);
            exitedPty.delete(res.id);
            ptyExit(data);
        }
        renderTermList();
        fitTerm(term);
    }).catch((err) => {
        const message = err && err.message ? err.message : String(err);
        xterm.writeln(`\x1b[31mTerminal indisponible : ${message}\x1b[0m`);
        if (/node-pty/i.test(message)) {
            ptyBroken = true;
            xterm.writeln("\x1b[90mLes prochains terminaux (+) utiliseront le mode simple.\x1b[0m");
        }
    });
}

function createXtermTerminal(focus) {
    const el = document.createElement("div");
    el.className = "term-view xterm-host";
    termViews.appendChild(el);
    const term = {
        key: termSeq,
        name: `Terminal ${termSeq}`,
        cwd: ".",
        root: ui.workspace || null,
        el,
        procId: null,
        ptyId: null,
        history: [],
        historyIndex: 0,
        style: {},
        pending: "",
        draft: ""
    };
    const xterm = new window.Terminal({
        cursorBlink: true,
        fontFamily: "Menlo, Monaco, 'SF Mono', Consolas, 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 1.15,
        scrollback: 5000,
        macOptionIsMeta: true,
        theme: XTERM_THEME
    });
    const fit = new window.FitAddon.FitAddon();
    xterm.loadAddon(fit);
    term.xterm = xterm;
    term.fit = fit;
    terms.push(term);
    selectTerminal(term.key, false);
    xterm.open(el);
    // Laisse passer les raccourcis globaux de l'application (Ctrl+², Ctrl+J, Ctrl+P…).
    xterm.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown" || !(ev.ctrlKey || ev.metaKey)) return true;
        const k = String(ev.key || "").toLowerCase();
        if (ev.code === "Backquote" || k === "`" || k === "²") return false;
        if (k === "j" || k === "p") return false;
        if (ev.metaKey && (k === "c" || k === "v")) return false;
        return true;
    });
    xterm.onData((data) => {
        if (term.ptyId) api.ptyWrite(term.ptyId, data).catch(() => {});
    });
    term.resizeObs = new ResizeObserver(() => fitTerm(term));
    term.resizeObs.observe(el);
    fitTerm(term);
    startPty(term);
    if (focus) setTimeout(() => focusTerm(term), 0);
    return term;
}

/** Sortie d'un pseudo-terminal (événement ptyData). */
function ptyData(data) {
    if (!data || data.id === undefined || data.id === null || typeof data.data !== "string") return;
    const term = termByPty.get(data.id);
    if (term && term.xterm) {
        term.xterm.write(data.data);
        return;
    }
    earlyPty.set(data.id, (earlyPty.get(data.id) || "") + data.data);
    while (earlyPty.size > 50) earlyPty.delete(earlyPty.keys().next().value);
}

function ptyExit(data) {
    if (!data || data.id === undefined || data.id === null) return;
    const term = termByPty.get(data.id);
    if (!term) {
        exitedPty.set(data.id, data);
        while (exitedPty.size > 50) exitedPty.delete(exitedPty.keys().next().value);
        return;
    }
    termByPty.delete(data.id);
    term.ptyId = null;
    if (term.xterm) {
        const how = data.signal ? `signal ${data.signal}` : `code ${data.code}`;
        term.xterm.writeln(`\r\n\x1b[90m[shell terminé, ${how}] · + pour ouvrir un nouveau terminal\x1b[0m`);
    }
    renderTermList();
}

const ANSI_COLORS = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5"];
const ANSI_BRIGHT = ["#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];

function ansi256(n) {
    if (n < 8) return ANSI_COLORS[n];
    if (n < 16) return ANSI_BRIGHT[n - 8];
    if (n < 232) {
        const v = n - 16;
        const c = (x) => (x ? 55 + x * 40 : 0);
        return `rgb(${c(Math.floor(v / 36))},${c(Math.floor(v / 6) % 6)},${c(v % 6)})`;
    }
    const g = 8 + (n - 232) * 10;
    return `rgb(${g},${g},${g})`;
}

function applySgr(style, params) {
    const p = params.length ? params : [0];
    for (let i = 0; i < p.length; i++) {
        const n = p[i];
        if (n === 0) Object.assign(style, { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false });
        else if (n === 1) style.bold = true;
        else if (n === 2) style.dim = true;
        else if (n === 3) style.italic = true;
        else if (n === 4) style.underline = true;
        else if (n === 7) style.inverse = true;
        else if (n === 22) { style.bold = false; style.dim = false; }
        else if (n === 23) style.italic = false;
        else if (n === 24) style.underline = false;
        else if (n === 27) style.inverse = false;
        else if (n >= 30 && n <= 37) style.fg = ANSI_COLORS[n - 30];
        else if (n === 39) style.fg = null;
        else if (n >= 40 && n <= 47) style.bg = ANSI_COLORS[n - 40];
        else if (n === 49) style.bg = null;
        else if (n >= 90 && n <= 97) style.fg = ANSI_BRIGHT[n - 90];
        else if (n >= 100 && n <= 107) style.bg = ANSI_BRIGHT[n - 100];
        else if (n === 38 || n === 48) {
            let color = null;
            if (p[i + 1] === 5) { color = ansi256(p[i + 2] || 0); i += 2; }
            else if (p[i + 1] === 2) { color = `rgb(${p[i + 2] || 0},${p[i + 3] || 0},${p[i + 4] || 0})`; i += 4; }
            if (n === 38) style.fg = color;
            else style.bg = color;
        }
    }
}

/** Ajoute du texte (avec séquences ANSI) à la sortie d'un terminal. */
function termAppend(term, text) {
    if (!term || !text) return;
    let data = term.pending + String(text);
    term.pending = "";
    const cut = /\x1b(\[[0-9;?]*)?$/.exec(data);
    if (cut) {
        term.pending = cut[0];
        data = data.slice(0, cut.index);
    }
    data = data.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "").split("\r\n").join("\n");
    const el = term.el;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    const frag = document.createDocumentFragment();
    const flush = (chunk) => {
        const part = chunk.replace(/[^\n\r]*\r/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
        if (!part) return;
        const s = term.style;
        if (!s.fg && !s.bg && !s.bold && !s.dim && !s.italic && !s.underline && !s.inverse) {
            frag.appendChild(document.createTextNode(part));
            return;
        }
        const span = document.createElement("span");
        span.textContent = part;
        let fg = s.fg;
        let bg = s.bg;
        if (s.inverse) {
            fg = s.bg || "#181818";
            bg = s.fg || "#cccccc";
        }
        if (fg) span.style.color = fg;
        if (bg) span.style.backgroundColor = bg;
        if (s.bold) span.style.fontWeight = "bold";
        if (s.dim) span.style.opacity = "0.7";
        if (s.italic) span.style.fontStyle = "italic";
        if (s.underline) span.style.textDecoration = "underline";
        frag.appendChild(span);
    };
    const re = /\x1b\[([0-9;?]*)([ -/]*)([@-~])/g;
    let last = 0;
    let m;
    while ((m = re.exec(data))) {
        flush(data.slice(last, m.index));
        last = re.lastIndex;
        if (m[3] === "m" && !m[1].includes("?")) {
            applySgr(term.style, m[1].split(";").filter((x) => x !== "").map(Number));
        }
    }
    flush(data.slice(last));
    el.appendChild(frag);
    while (el.childNodes.length > 4000) el.removeChild(el.firstChild);
    if (atBottom) el.scrollTop = el.scrollHeight;
}

function termPrompt(term) {
    const root = String(ui.workspace || "").split(/[\\/]/).filter(Boolean).pop() || "projet";
    return `PS ${term.cwd === "." ? root : `${root}/${term.cwd}`}>`;
}

function createTerminal(focus = true) {
    termSeq++;
    if (xtermSupported()) {
        try {
            return createXtermTerminal(focus);
        } catch (err) {
            console.warn("[terminal] xterm.js indisponible, repli sur le terminal simple :", err);
            ptyBroken = true;
            const broken = terms.find((t) => t.key === termSeq);
            if (broken) {
                disposeXterm(broken);
                broken.el.remove();
                terms.splice(terms.indexOf(broken), 1);
            }
        }
    }
    const el = document.createElement("pre");
    el.className = "output term-view";
    termViews.appendChild(el);
    const term = {
        key: termSeq,
        name: `PowerShell ${termSeq}`,
        cwd: ".",
        root: ui.workspace || null,
        el,
        procId: null,
        history: [],
        historyIndex: 0,
        style: {},
        pending: "",
        draft: ""
    };
    applySgr(term.style, [0]);
    terms.push(term);
    selectTerminal(term.key, focus);
    termAppend(term, "\x1b[90mPowerShell dans le dossier du projet · « cd » change de dossier · « cls » ou Ctrl+L efface · Ctrl+C arrête.\x1b[0m\n");
    return term;
}

function activeTerm() {
    return terms.find((t) => t.key === activeTermKey) || terms[0] || createTerminal(false);
}

function selectTerminal(key, focus = false) {
    const prev = terms.find((t) => t.key === activeTermKey);
    if (prev && prev.key !== key) prev.draft = termInput.value;
    activeTermKey = key;
    const term = terms.find((t) => t.key === key);
    for (const t of terms) t.el.classList.toggle("hidden", t !== term);
    if (term && prev !== term) termInput.value = term.draft || "";
    // La ligne de saisie simple ne sert qu'au terminal de repli : xterm gère sa propre saisie.
    const line = document.querySelector("#terminal .terminal-line");
    if (line) line.classList.toggle("hidden", Boolean(term && term.xterm));
    renderTermList();
    updateKillButton();
    if (term && term.xterm) requestAnimationFrame(() => fitTerm(term));
    if (focus) setTimeout(() => focusTerm(term), 0);
}

function renderTermList() {
    termList.replaceChildren();
    termList.classList.toggle("hidden", terms.length < 2);
    for (const t of terms) {
        const row = document.createElement("div");
        row.className = `term-item${t.key === activeTermKey ? " active" : ""}${t.procId ? " running" : ""}`;
        row.title = t.cwd === "." ? t.name : `${t.name} — ${t.cwd}`;
        const dot = document.createElement("span");
        dot.className = "term-dot";
        const label = document.createElement("span");
        label.className = "term-name";
        label.textContent = t.name;
        const close = document.createElement("button");
        close.type = "button";
        close.className = "term-close";
        close.textContent = "×";
        close.title = "Fermer ce terminal";
        close.onclick = (ev) => {
            ev.stopPropagation();
            closeTerminal(t.key);
        };
        row.append(dot, label, close);
        row.onclick = () => selectTerminal(t.key, true);
        termList.appendChild(row);
    }
    const term = terms.find((t) => t.key === activeTermKey);
    $("terminal-ps").textContent = term ? termPrompt(term) : "PS>";
}

function closeTerminal(key) {
    const index = terms.findIndex((t) => t.key === key);
    if (index < 0) return;
    const term = terms[index];
    if (term.procId && term.procId !== "pending") {
        termByProc.delete(term.procId);
        api.killTerminal(term.procId).catch(() => {});
    }
    disposeXterm(term);
    term.el.remove();
    terms.splice(index, 1);
    if (!terms.length) {
        activeTermKey = null;
        createTerminal(ui.panel === "terminal");
        return;
    }
    if (activeTermKey === key) selectTerminal(terms[Math.min(index, terms.length - 1)].key, true);
    else renderTermList();
}

function selectPanel(name, focus = false) {
    ui.panel = name;
    $("app").classList.remove("no-panel");
    $("tab-output").classList.toggle("active", name === "output");
    $("tab-terminal").classList.toggle("active", name === "terminal");
    $("tab-changes").classList.toggle("active", name === "changes");
    output.classList.toggle("hidden", name !== "output");
    $("terminal").classList.toggle("hidden", name !== "terminal");
    $("changes").classList.toggle("hidden", name !== "changes");
    if (name === "changes") renderChangesList();
    if (name === "terminal" && !terms.length) createTerminal(focus);
    updateKillButton();
    if (name === "terminal") {
        const current = terms.find((t) => t.key === activeTermKey);
        if (current && current.xterm) requestAnimationFrame(() => fitTerm(current));
    }
    if (focus && name === "terminal") setTimeout(() => focusTerm(), 0);
    saveLayout();
}

function togglePanel(name) {
    const app = $("app");
    if (!app.classList.contains("no-panel") && (!name || name === ui.panel)) {
        app.classList.add("no-panel");
        saveLayout();
        return;
    }
    selectPanel(name || ui.panel, true);
}

function updateKillButton() {
    const term = terms.find((t) => t.key === activeTermKey);
    const running = Boolean(term && term.procId && term.procId !== "pending");
    const onTerminal = ui.panel === "terminal";
    $("btn-kill-terminal").classList.toggle("hidden", !running || !onTerminal);
    $("btn-new-terminal").classList.toggle("hidden", !onTerminal);
    $("btn-close-terminal").classList.toggle("hidden", !onTerminal);
    $("terminal").classList.toggle("running", running);
}

$("tab-output").onclick = () => selectPanel("output");
$("tab-terminal").onclick = () => selectPanel("terminal", true);
$("tab-changes").onclick = () => selectPanel("changes");
$("btn-undo").onclick = () => send("/undo");
$("btn-clear-output").onclick = () => {
    if (ui.panel === "terminal") clearTerm(activeTerm());
    else if (ui.panel === "changes") clearChanges();
    else output.textContent = "";
};

function capMap(map, max = 50) {
    while (map.size > max) map.delete(map.keys().next().value);
}

/** Sortie d'un processus : envoyée au terminal qui l'a lancé (mise de côté si son id n'est pas encore connu). */
function termData(data) {
    if (!data || data.id === undefined || data.id === null || !data.text) return;
    const term = termByProc.get(data.id);
    if (term) {
        termAppend(term, data.text);
        return;
    }
    earlyData.set(data.id, (earlyData.get(data.id) || "") + String(data.text));
    capMap(earlyData);
}

function termExit(data) {
    if (!data || data.id === undefined || data.id === null) return;
    const term = termByProc.get(data.id);
    if (!term) {
        exitedProcs.set(data.id, data);
        capMap(exitedProcs);
        return;
    }
    termByProc.delete(data.id);
    term.procId = null;
    const ok = !data.signal && Number(data.code) === 0;
    const how = data.signal ? `signal ${data.signal}` : `code ${data.code}`;
    termAppend(term, `\x1b[${ok ? "90" : "31"}m[processus terminé, ${how}]\x1b[0m\n`);
    renderTermList();
    updateKillButton();
}

async function runTerminalLine(line, term = activeTerm()) {
    const trimmed = String(line || "").trim();
    if (!trimmed) {
        termAppend(term, `\x1b[1;32m${termPrompt(term)}\x1b[0m\n`);
        return;
    }
    if (term.history[term.history.length - 1] !== trimmed) term.history.push(trimmed);
    if (term.history.length > 200) term.history.shift();
    term.historyIndex = term.history.length;
    if (/^(cls|clear|clear-host)$/i.test(trimmed)) {
        term.el.replaceChildren();
        return;
    }
    if (term.procId) {
        termAppend(term, "\x1b[33mUne commande est déjà en cours (Ctrl+C ou ■ pour l'arrêter, + pour ouvrir un autre terminal).\x1b[0m\n");
        return;
    }
    if (!ui.workspace) {
        termAppend(term, "\x1b[31mOuvrez d'abord un projet.\x1b[0m\n");
        return;
    }
    termAppend(term, `\x1b[1;32m${termPrompt(term)}\x1b[0m ${trimmed}\n`);

    const cd = /^(cd|chdir|set-location|sl)(?:\s+(.*))?$/i.exec(trimmed);
    if (cd && !/[;&|]/.test(trimmed)) {
        const target = String(cd[2] || "").trim().replace(/^["']|["']$/g, "") || ".";
        try {
            term.cwd = (await api.terminalCd(term.cwd, target)) || ".";
        } catch (err) {
            termAppend(term, `\x1b[31m${err.message}\x1b[0m\n`);
        }
        renderTermList();
        return;
    }

    term.procId = "pending";
    renderTermList();
    updateKillButton();
    try {
        const res = await api.runTerminal(trimmed, term.cwd);
        const id = res && typeof res === "object" ? res.id : res;
        if (!terms.includes(term)) {
            api.killTerminal(id).catch(() => {});
            return;
        }
        term.procId = id;
        termByProc.set(id, term);
        if (earlyData.has(id)) {
            const text = earlyData.get(id);
            earlyData.delete(id);
            termAppend(term, text);
        }
        if (exitedProcs.has(id)) {
            const data = exitedProcs.get(id);
            exitedProcs.delete(id);
            termExit(data);
            return;
        }
    } catch (err) {
        term.procId = null;
        termAppend(term, `\x1b[31mErreur : ${err.message}\x1b[0m\n`);
    }
    renderTermList();
    updateKillButton();
}

async function killTerm(term = activeTerm()) {
    const id = term.procId;
    if (!id || id === "pending") return;
    try {
        await api.killTerminal(id);
    } catch (err) {
        termAppend(term, `\x1b[31mArrêt impossible : ${err.message}\x1b[0m\n`);
    }
}

$("btn-kill-terminal").onclick = () => killTerm();
$("btn-new-terminal").onclick = () => createTerminal(true);
$("btn-close-terminal").onclick = () => {
    if (activeTermKey !== null) closeTerminal(activeTermKey);
};

termInput.addEventListener("keydown", (ev) => {
    const term = activeTerm();
    const key = String(ev.key || "").toLowerCase();
    if (ev.key === "Enter") {
        ev.preventDefault();
        const value = termInput.value;
        termInput.value = "";
        term.draft = "";
        runTerminalLine(value, term);
    } else if (ev.ctrlKey && !ev.shiftKey && key === "c" && termInput.selectionStart === termInput.selectionEnd) {
        ev.preventDefault();
        if (term.procId && term.procId !== "pending") {
            killTerm(term);
        } else {
            termAppend(term, `\x1b[1;32m${termPrompt(term)}\x1b[0m ${termInput.value}\x1b[90m^C\x1b[0m\n`);
            termInput.value = "";
            term.historyIndex = term.history.length;
        }
    } else if (ev.ctrlKey && !ev.shiftKey && key === "l") {
        ev.preventDefault();
        term.el.replaceChildren();
    } else if ((ev.key === "ArrowUp" || ev.key === "ArrowDown") && term.history.length) {
        ev.preventDefault();
        const delta = ev.key === "ArrowUp" ? -1 : 1;
        term.historyIndex = Math.max(0, Math.min(term.history.length, term.historyIndex + delta));
        termInput.value = term.history[term.historyIndex] ?? "";
    }
});

$("terminal").addEventListener("mouseup", (ev) => {
    // Clic dans la liste des onglets : selectTerminal gère déjà le focus.
    if (ev.target && ev.target.closest && ev.target.closest("#term-list")) return;
    const current = terms.find((t) => t.key === activeTermKey);
    if (current && current.xterm) {
        if (!current.xterm.hasSelection()) current.xterm.focus();
        return;
    }
    if (!String(window.getSelection())) termInput.focus();
});

