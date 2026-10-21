/* ---------- Transcript ---------- */

function scrollDown() {
    transcript.scrollTop = transcript.scrollHeight;
}

const QUIET_TOOLS = new Set(["read_file", "search_files", "list_directory"]);
let toolGroup = null;

function toolRowHtml(e) {
    return `<span class="tdot"></span><span class="name">${escapeHtml(toolLabel(e.name))}</span><span class="arg" title="${escapeHtml(e.arg || "")}">${escapeHtml(e.arg || "")}</span>`;
}

function plural(n, word) {
    return `${n} ${word}${n > 1 ? "s" : ""}`;
}

/** Lectures, recherches et listes successives : une seule ligne repliable. */
function addQuietTool(e) {
    if (!toolGroup) {
        const el = addEntry("tool-group", "<details><summary></summary><div class=\"tool-group-body\"></div></details>");
        toolGroup = { el, summary: el.querySelector("summary"), body: el.querySelector(".tool-group-body"), reads: 0, searches: 0, lists: 0, awaitingResult: false };
    }
    const g = toolGroup;
    if (e.name === "read_file") g.reads++;
    else if (e.name === "search_files") g.searches++;
    else g.lists++;
    const parts = [];
    if (g.reads) parts.push(plural(g.reads, "lecture"));
    if (g.searches) parts.push(plural(g.searches, "recherche"));
    if (g.lists) parts.push(`${plural(g.lists, "dossier")} listé${g.lists > 1 ? "s" : ""}`);
    g.summary.textContent = parts.join(" · ");
    const row = document.createElement("div");
    row.className = "entry tool";
    row.innerHTML = toolRowHtml(e);
    g.body.appendChild(row);
    g.awaitingResult = true;
    scrollDown();
    return row;
}

function addEntry(cls, html) {
    toolGroup = null;
    const div = document.createElement("div");
    div.className = `entry ${cls}`;
    div.innerHTML = html;
    transcript.appendChild(div);
    scrollDown();
    return div;
}

function appendOutput(text) {
    output.textContent += `${text}\n`;
    if (output.textContent.length > 200000) output.textContent = output.textContent.slice(-150000);
    output.scrollTop = output.scrollHeight;
}

function renderEntry(e) {
    recordStudioEntry(e);
    switch (e.type) {
        case "welcome":
            return null;
        case "user":
            $("agent-starter").classList.add("hidden");
            return addEntry("user", `<div class="message-content">${escapeHtml(e.text)}</div>`);
        case "assistant": {
            $("agent-starter").classList.add("hidden");
            const message = addEntry("assistant", `<div class="message-content">${renderMarkdown(e.text)}</div>`);
            const actions = document.createElement("div");
            actions.className = "message-actions";
            const copy = document.createElement("button");
            copy.type = "button"; copy.textContent = "Copier";
            copy.onclick = () => api.copyText(e.text).then(() => { copy.textContent = "Copié ✓"; }).catch(error => studioFeedback(error.message));
            actions.appendChild(copy); message.appendChild(actions);
            return message;
        }
        case "reason": {
            const el = addEntry("reason collapsed", `<span class="reason-mark">✻</span><span class="reason-text">${inline(e.text)}</span>`);
            el.title = "Cliquer pour déplier ou replier la réflexion";
            el.onclick = () => {
                if (!String(window.getSelection())) el.classList.toggle("collapsed");
            };
            return el;
        }
        case "info":
        case "warn":
        case "error":
            return addEntry(e.type, escapeHtml(e.text));
        case "print":
            return addEntry("print", `<pre>${escapeHtml((e.lines || []).join("\n"))}</pre>`);
        case "plan":
            return addEntry("plan", `<b>Plan</b><ol>${(e.items || []).map((i) => `<li>${inline(i)}</li>`).join("")}</ol>`);
        case "tool":
            if (e.name === "run_command") appendOutput(`$ ${e.arg}`);
            if (QUIET_TOOLS.has(e.name)) return addQuietTool(e);
            return addEntry("tool", toolRowHtml(e));
        case "result": {
            if (toolGroup && toolGroup.awaitingResult) {
                const row = document.createElement("div");
                row.className = `entry result ${e.tone || ""}`;
                row.textContent = `└ ${e.text}`;
                toolGroup.body.appendChild(row);
                toolGroup.awaitingResult = false;
                if (e.tone === "error" || e.tone === "err") toolGroup.el.classList.add("has-error");
                scrollDown();
                return row;
            }
            return addEntry(`result ${e.tone || ""}`, `└ ${escapeHtml(e.text)}`);
        }
        case "diff": {
            const el = addEntry("diff-entry", "");
            el.appendChild(buildDiffCard(e));
            if (e.path) recordChange(e.path, e.added, e.removed);
            return el;
        }
        default:
            return addEntry("info", escapeHtml(JSON.stringify(e)));
    }
}

function liveStart() {
    ui.liveText = "";
    ui.live = addEntry("assistant", "");
}

function liveAppend(text) {
    if (!ui.live) liveStart();
    ui.liveText += text;
    ui.live.innerHTML = renderMarkdown(ui.liveText);
    scrollDown();
}

function liveEnd() {
    ui.live = null;
    ui.liveText = "";
}

function setSpinner(data) {
    if (data.stop) {
        if (ui.spinnerId === data.id) {
            $("spinner").classList.add("hidden");
            ui.spinnerId = null;
            ui.spinnerStart = 0;
            if (ui.spinnerTimer) clearInterval(ui.spinnerTimer);
            ui.spinnerTimer = null;
        }
        return;
    }
    if (ui.spinnerId !== data.id || !ui.spinnerStart) ui.spinnerStart = Date.now();
    ui.spinnerId = data.id;
    ui.spinnerLabel = data.label || "";
    const paint = () => {
        const secs = Math.floor((Date.now() - ui.spinnerStart) / 1000);
        const elapsed = secs >= 60 ? `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, "0")} s` : `${secs} s`;
        $("spinner-label").textContent = ui.spinnerLabel ? `${ui.spinnerLabel} · ${elapsed}` : elapsed;
    };
    paint();
    if (!ui.spinnerTimer) ui.spinnerTimer = setInterval(() => { if (ui.spinnerId) paint(); }, 1000);
    $("spinner").classList.remove("hidden");
}

