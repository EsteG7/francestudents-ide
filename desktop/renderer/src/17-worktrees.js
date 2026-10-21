/* ---------- Vue Worktrees : agents parallèles dans des worktrees Git ---------- */

ui.worktrees = { busy: false, agents: new Map(), cards: new Map() };

const WT_STATUS = { running: "en cours", done: "terminé", failed: "échec", stopped: "arrêté" };

function wtMessage(text, kind) {
    const box = $("wt-msg");
    if (!box) return;
    box.textContent = text || "";
    box.className = `git-action-msg${kind ? ` ${kind}` : ""}`;
}

function updateWorktreeBadge() {
    const badge = $("wt-count");
    if (!badge) return;
    let running = 0;
    for (const agent of ui.worktrees.agents.values()) if (agent.status === "running") running++;
    badge.textContent = running ? String(running) : "";
    badge.classList.toggle("hidden", !running);
}

function wtStatusText(agent) {
    if (!agent) return "Aucun agent lancé.";
    const label = WT_STATUS[agent.status] || agent.status;
    const ended = agent.status !== "running" && agent.exitCode !== null && agent.exitCode !== undefined;
    const mode = agent.readOnly ? "lecture seule" : agent.yes ? "écritures auto" : "sans écriture";
    return `Agent : ${label}${ended ? ` (code ${agent.exitCode})` : ""} · ${mode}`;
}

function wtAgentText(agent) {
    if (!agent) return "";
    const answer = String(agent.answer || "").trim();
    const text = answer || String(agent.log || "").trim();
    return text.length > 6000 ? `…${text.slice(-6000)}` : text;
}

function wtApplyCard(name) {
    const card = ui.worktrees.cards.get(name);
    if (!card) return;
    const agent = ui.worktrees.agents.get(name) || null;
    const running = Boolean(agent && agent.status === "running");
    card.status.textContent = wtStatusText(agent);
    card.status.className = `wt-status wt-${agent ? agent.status : "idle"}`;
    card.status.title = agent && agent.prompt ? `Demande : ${agent.prompt}` : "";
    card.output.textContent = wtAgentText(agent);
    card.output.classList.toggle("hidden", !card.output.textContent);
    card.start.disabled = running;
    card.stop.disabled = !running;
    card.remove.disabled = running;
}

/** Mise à jour envoyée par le processus principal (événement worktreeAgent). */
function wtUpdateAgent(agent) {
    if (!agent || !agent.name) return;
    const previous = ui.worktrees.agents.get(agent.name);
    ui.worktrees.agents.set(agent.name, agent);
    if (ui.worktrees.cards.has(agent.name)) wtApplyCard(agent.name);
    else if (ui.sideView === "worktrees") refreshWorktrees();
    if (previous && previous.status === "running" && agent.status !== "running") {
        const label = WT_STATUS[agent.status] || agent.status;
        wtMessage(`Agent ${agent.name} : ${label}. Ouvre « Diff » pour relire sa branche ${agent.branch}.`, agent.status === "done" ? "ok" : "error");
    }
    updateWorktreeBadge();
}

function wtButton(label, title, onClick, primary) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `git-btn${primary ? " git-btn-primary" : ""}`;
    button.textContent = label;
    button.title = title;
    button.onclick = onClick;
    return button;
}

function wtCheck(label, title, parent) {
    const wrap = document.createElement("label");
    wrap.className = "git-check";
    wrap.title = title;
    const box = document.createElement("input");
    box.type = "checkbox";
    wrap.append(box, ` ${label}`);
    parent.appendChild(wrap);
    return box;
}

function renderWorktrees(items) {
    const list = $("wt-list");
    const drafts = new Map();
    for (const [name, card] of ui.worktrees.cards) {
        drafts.set(name, { prompt: card.prompt.value, yes: card.yes.checked, plan: card.plan.checked });
    }
    list.innerHTML = "";
    ui.worktrees.cards.clear();
    if (!items.length) {
        gitMessage(list, "Aucun worktree. Crée-en un ci-dessus, puis donne une demande à son agent.");
        return;
    }
    for (const item of items) {
        const name = item.name;
        if (item.agent) ui.worktrees.agents.set(name, item.agent);

        const el = document.createElement("div");
        el.className = "wt-card";

        const head = document.createElement("div");
        head.className = "wt-head";
        const title = document.createElement("span");
        title.className = "wt-name";
        title.textContent = name;
        title.title = item.path;
        const branch = document.createElement("span");
        branch.className = "wt-branch";
        branch.textContent = item.branch || (item.detached ? "(détachée)" : "");
        head.append(title, branch);

        const status = document.createElement("div");
        const prompt = document.createElement("textarea");
        prompt.className = "git-input";
        prompt.rows = 2;
        prompt.placeholder = "Demande pour l'agent de ce worktree (Ctrl/Cmd+Entrée pour lancer)";
        prompt.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
                ev.preventDefault();
                wtStart(name);
            }
        });

        const options = document.createElement("div");
        options.className = "wt-options";
        const yes = wtCheck("écritures auto", "Autorise l'agent à écrire et à lancer des commandes sans confirmation (--yes). Sans cette option, il ne peut rien modifier.", options);
        const plan = wtCheck("lecture seule", "Mode plan : l'agent analyse sans rien modifier.", options);

        const output = document.createElement("pre");
        output.className = "wt-output hidden";
        const diff = document.createElement("div");
        diff.className = "wt-diff hidden";

        const card = { el, status, prompt, yes, plan, output, diff };
        card.start = wtButton("Lancer", "Lancer l'agent dans ce worktree", () => wtStart(name), true);
        card.stop = wtButton("Arrêter", "Arrêter l'agent en cours", () => wtStop(name));
        card.diffBtn = wtButton("Diff", "Afficher les modifications du worktree", () => wtToggleDiff(name));
        card.remove = wtButton("Supprimer", "Supprimer le worktree (la branche est conservée)", () => wtRemove(name));
        const actions = document.createElement("div");
        actions.className = "wt-actions";
        actions.append(card.start, card.stop, card.diffBtn, card.remove);

        const draft = drafts.get(name);
        if (draft) {
            prompt.value = draft.prompt;
            yes.checked = draft.yes;
            plan.checked = draft.plan;
        }

        el.append(head, status, prompt, options, actions, output, diff);
        list.appendChild(el);
        ui.worktrees.cards.set(name, card);
        wtApplyCard(name);
    }
}

async function refreshWorktrees() {
    if (ui.worktrees.busy) return;
    ui.worktrees.busy = true;
    try {
        const data = await api.worktreeList();
        $("wt-root").textContent = data.root ? `Dossier : ${data.root}` : "Ouvre un projet Git pour utiliser les worktrees.";
        for (const agent of data.agents || []) ui.worktrees.agents.set(agent.name, agent);
        renderWorktrees((data.worktrees || []).filter((w) => w.managed && w.name));
    } catch (error) {
        gitMessage($("wt-list"), `Worktrees indisponibles : ${gitErrorText(error)}`);
    } finally {
        ui.worktrees.busy = false;
        updateWorktreeBadge();
    }
}

async function wtCreate() {
    const nameInput = $("wt-name");
    const name = nameInput.value.trim();
    const base = $("wt-base").value.trim() || "HEAD";
    if (!name) {
        wtMessage("Donne un nom au worktree (lettres, chiffres, . _ -).", "error");
        nameInput.focus();
        return;
    }
    $("btn-wt-create").disabled = true;
    try {
        const made = await api.worktreeCreate(name, base);
        nameInput.value = "";
        wtMessage(`Worktree ${made.name} créé sur la branche ${made.branch} (depuis ${made.base}).`, "ok");
        await refreshWorktrees();
        const card = ui.worktrees.cards.get(made.name);
        if (card) card.prompt.focus();
    } catch (error) {
        wtMessage(gitErrorText(error), "error");
    } finally {
        $("btn-wt-create").disabled = false;
    }
}

async function wtStart(name) {
    const card = ui.worktrees.cards.get(name);
    if (!card) return;
    const prompt = card.prompt.value.trim();
    if (!prompt) {
        wtMessage("Écris d'abord une demande pour l'agent.", "error");
        card.prompt.focus();
        return;
    }
    try {
        const agent = await api.worktreeStart(name, prompt, { yes: card.yes.checked, readOnly: card.plan.checked });
        card.prompt.value = "";
        wtUpdateAgent(agent);
        wtMessage(`Agent lancé dans ${name} (branche ${agent.branch}).`, "ok");
    } catch (error) {
        wtMessage(gitErrorText(error), "error");
    }
}

async function wtStop(name) {
    try {
        wtUpdateAgent(await api.worktreeStop(name));
        wtMessage(`Agent ${name} arrêté.`, "ok");
    } catch (error) {
        wtMessage(gitErrorText(error), "error");
    }
}

async function wtToggleDiff(name) {
    const card = ui.worktrees.cards.get(name);
    if (!card) return;
    if (!card.diff.classList.contains("hidden")) {
        card.diff.classList.add("hidden");
        card.diff.innerHTML = "";
        return;
    }
    card.diff.classList.remove("hidden");
    card.diff.textContent = "Chargement du diff…";
    try {
        const changes = await api.worktreeChanges(name);
        card.diff.innerHTML = "";
        const status = String(changes.status || "").trim();
        const summary = document.createElement("pre");
        summary.className = "wt-output";
        summary.textContent = status || "Aucune modification non validée dans ce worktree.";
        card.diff.appendChild(summary);
        const lines = gitDiffLines(changes.diff);
        if (lines.length) {
            card.diff.appendChild(buildDiffCard({ path: `${name} (${changes.branch})`, lines, ...gitCountChanges(lines) }));
        }
    } catch (error) {
        card.diff.textContent = `Diff impossible : ${gitErrorText(error)}`;
    }
}

async function wtRemove(name) {
    if (!window.confirm(`Supprimer le worktree ${name} ?\nLa branche frst/${name} est conservée.`)) return;
    try {
        await api.worktreeRemove(name, false);
    } catch (error) {
        const reason = gitErrorText(error);
        if (!window.confirm(`Suppression refusée : ${reason}\n\nForcer la suppression ? Les modifications non validées du worktree seront perdues.`)) {
            wtMessage(reason, "error");
            return;
        }
        try {
            await api.worktreeRemove(name, true);
        } catch (forced) {
            wtMessage(gitErrorText(forced), "error");
            return;
        }
    }
    ui.worktrees.agents.delete(name);
    wtMessage(`Worktree ${name} supprimé (branche frst/${name} conservée).`, "ok");
    refreshWorktrees();
}

$("btn-wt-create").onclick = wtCreate;
$("btn-wt-refresh").onclick = refreshWorktrees;
$("wt-name").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
        ev.preventDefault();
        wtCreate();
    }
});

api.onEvent((channel, data) => {
    if (channel === "worktreeAgent") wtUpdateAgent(data);
});
