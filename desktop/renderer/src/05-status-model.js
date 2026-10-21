/* ---------- Barre d'état ---------- */

function applyStatus(s) {
    if (!s || typeof s !== "object") return;
    const wasBusy = Boolean(ui.status.busy);
    ui.status = s;
    const busy = Boolean(s.busy);
    $("settings-logout").disabled = !s.booted || busy;
    $("settings-account-status").textContent = !s.booted ? "Non connecté." : busy ? "Connecté · arrête la tâche avant de te déconnecter." : "Connecté à FranceStudent.";
    updateStudioStatus(s);

    $("statusbar").classList.toggle("busy", busy);
    $("btn-stop").classList.toggle("hidden", !busy);
    $("btn-send").disabled = false;
    $("btn-send").textContent = busy ? "Ajouter" : "Envoyer";
    $("btn-send").title = busy ? "Ajouter ce prompt à la file (Entrée)" : "Envoyer (Entrée)";
    input.placeholder = busy ? "Ajouter une demande à la suite…" : "Demande à l’agent… (/ pour les commandes)";
    document.querySelector(".composer-hint").textContent = busy ? "Entrée : ajouter à la suite" : "Entrée : envoyer · Maj+Entrée : ligne";
    $("mode-select").disabled = busy;
    renderInlinePending(queueSnapshot);
    $("st-busy").textContent = busy ? "⟳ en cours" : "";
    $("st-jobs").textContent = s.jobs ? `jobs : ${s.jobs}` : "";
    $("st-auto").textContent = s.fullAccess ? "Full accès" : s.autoApprove ? "auto-approbation" : "";
    $("st-mode").textContent = s.mode ? `mode : ${s.mode}` : "";
    $("st-model").textContent = s.model || "";
    $("model-label").textContent = s.model || "modèle";
    if (s.modelId != null) ui.currentModelId = s.modelId;
    const u = s.usage;
    let tokensText = "";
    if (u && u.reported > 0) {
        tokensText = ` · ${formatTokens(u.inputTokens || 0)} ↑ ${formatTokens(u.outputTokens || 0)} ↓ tokens`;
    } else if (u && u.chars > 0) {
        tokensText = ` · ~${formatTokens(Math.round(u.chars / 3.5))} tokens`;
    }
    ui.sessionRequests = u && u.requests ? `${u.requests} requête(s)${tokensText}` : "";
    if (busy) {
        $("btn-resume").classList.add("hidden");
    } else if (wasBusy && ui.interrupted) {
        $("btn-resume").classList.remove("hidden");
        ui.interrupted = false;
    }
    renderQuota();
    if (s.mode) $("mode-select").value = s.mode;

    if ((s.workspace || null) !== ui.workspace) {
        ui.workspace = s.workspace || null;
        onWorkspaceChanged();
        refreshTaskQueue();
    } else if (wasBusy && !busy) {
        scheduleRefresh();
    }

    if (wasBusy && !busy) refreshQuota();
}

/* ---------- Quota du compte FranceStudent ---------- */

function renderQuota() {
    const el = $("st-usage");
    const quota = ui.quota;

    if (!quota || quota.percent == null) {
        el.textContent = ui.sessionRequests || "";
        el.title = "";
        el.classList.remove("warn", "crit");
        return;
    }

    const session = ui.sessionRequests ? ` · ${ui.sessionRequests}` : "";
    const approx = quota.uncertain ? "~" : "";
    el.textContent = `quota chat ${approx}${quota.percent} %${session}`;
    el.classList.toggle("warn", quota.percent >= 75 && quota.percent < 90);
    el.classList.toggle("crit", quota.percent >= 90);

    const fmtReset = (iso) => (iso ? ` — réinit. ${new Date(iso).toLocaleString()}` : "");
    const lines = [`Quota général de chat : ${approx}${quota.percent} %${fmtReset(quota.resetAt)}`];
    if (quota.uncertain) lines.push("(décompte approximatif côté serveur)");
    const isImage = (l) => /image/i.test(`${l.type || ""} ${l.bucket || ""}`);
    for (const limit of quota.limits || []) {
        const name = [limit.type, limit.bucket].filter(Boolean).join("/") || "limite";
        const total = limit.limit ? `${limit.used}/${limit.limit}` : `${limit.used}`;
        const prefix = isImage(limit) ? "Images" : "Limite";
        lines.push(`${prefix} ${name} : ${Math.round(limit.usedPercent)} % (${total})${fmtReset(limit.resetAt)}`);
    }
    if (quota.powerUp) lines.push("Power-up de quota actif");
    lines.push("Cliquer pour le détail (/usage)");
    el.title = lines.join("\n");
}

async function refreshQuota() {
    if (!ui.status.booted) { ui.quota = null; renderQuota(); return; }
    try {
        const quota = await api.usage();
        ui.quota = ui.status.booted ? quota : null;
    } catch {
        ui.quota = null;
    }
    renderQuota();
}

/* ---------- Choix du modèle (/model) ---------- */

function hideModelMenu() {
    modelMenuEl.classList.add("hidden");
    modelMenuEl.innerHTML = "";
}

function positionModelMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(300, rect.width);
    modelMenuEl.style.minWidth = `${width}px`;
    modelMenuEl.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    modelMenuEl.style.top = `${rect.bottom + 6}px`;
    const menuRect = modelMenuEl.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
        modelMenuEl.style.top = `${Math.max(8, rect.top - menuRect.height - 6)}px`;
    }
}

/** Fournisseur d'un modèle d'après provider / nom / modèle : "claude", "gpt", "gemini" ou null. */
function modelVendor(agent) {
    const text = [agent && agent.provider, agent && agent.name, agent && agent.model]
        .filter(Boolean).join(" ").toLowerCase();
    if (/claude|anthropic/.test(text)) return "claude";
    if (/gemini|google/.test(text)) return "gemini";
    if (/\bgpt|openai|\bo[134]\b/.test(text)) return "gpt";
    return null;
}

function modelLogo(agent, className = "model-logo") {
    const vendor = modelVendor(agent);
    if (!vendor) return null;
    const img = document.createElement("img");
    img.className = className;
    img.src = `assets/models/${vendor}.svg`;
    img.alt = vendor;
    return img;
}

function renderModelMenu(data) {
    const agents = (data && data.agents) || [];
    modelMenuEl.innerHTML = "";

    const head = document.createElement("div");
    head.className = "model-menu-head";
    head.textContent = data && data.source === "api" ? "Modèles FranceStudent" : "Modèles (liste locale)";
    modelMenuEl.appendChild(head);

    if (!agents.length) {
        const empty = document.createElement("div");
        empty.className = "model-empty";
        empty.textContent = "Aucun modèle disponible.";
        modelMenuEl.appendChild(empty);
        return;
    }

    for (const agent of agents) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "model-item" + (agent.id === ui.currentModelId ? " active" : "");

        const logo = modelLogo(agent);
        if (logo) row.appendChild(logo);

        const main = document.createElement("span");
        main.className = "model-item-main";
        const name = document.createElement("span");
        name.className = "model-item-name";
        name.textContent = agent.name;
        main.appendChild(name);
        const details = [agent.provider, agent.model].filter(Boolean).join(" · ");
        const sub = document.createElement("span");
        sub.className = "model-item-sub";
        sub.textContent = details || (agent.id === ui.currentModelId ? "modèle actuel" : "");
        main.appendChild(sub);
        row.appendChild(main);

        if (agent.isDefault) {
            const badge = document.createElement("span");
            badge.className = "model-badge";
            badge.textContent = "défaut";
            row.appendChild(badge);
        }
        const check = document.createElement("span");
        check.className = "model-check";
        check.textContent = agent.id === ui.currentModelId ? "✓" : "";
        row.appendChild(check);

        row.onclick = () => selectModel(agent.id);
        modelMenuEl.appendChild(row);
    }

    if (data && data.error) {
        const err = document.createElement("div");
        err.className = "model-error";
        err.textContent = `API indisponible : ${data.error}`;
        modelMenuEl.appendChild(err);
    }
}

async function openModelMenu() {
    const anchor = $("btn-model");
    modelMenuEl.classList.remove("hidden");
    modelMenuEl.dataset.kind = "model";
    if (ui.models) renderModelMenu(ui.models);
    else modelMenuEl.innerHTML = '<div class="model-empty">Chargement des modèles…</div>';
    positionModelMenu(anchor);
    const stillModel = () => !modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "model";
    try {
        const data = await api.models();
        ui.models = data;
        if (data && data.current != null) ui.currentModelId = data.current;
        if (stillModel()) {
            renderModelMenu(data);
            positionModelMenu(anchor);
        }
    } catch (err) {
        if (stillModel()) {
            modelMenuEl.innerHTML = `<div class="model-error">${escapeHtml(err.message)}</div>`;
        }
    }
}

function toggleModelMenu() {
    if (!modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "model") hideModelMenu();
    else openModelMenu();
}

async function selectModel(id) {
    hideModelMenu();
    if (id === ui.currentModelId) return;
    try {
        const res = await api.setModel(id);
        ui.currentModelId = res.id;
        $("model-label").textContent = res.name;
        $("st-model").textContent = res.name;
        if (ui.models) renderModelMenu(ui.models);
    } catch (err) {
        renderEntry({ type: "error", text: err.message });
    }
}

/* ---------- Historique des conversations (/history, reprise par /chat-id) ---------- */

function historyCurrentWorkspace() {
    return ui.workspace || (ui.status && ui.status.workspace) || null;
}

function historyMatches(item) {
    if (ui.historyOnlyProject && (item.workspace || null) !== historyCurrentWorkspace()) return false;
    const query = String(ui.historyQuery || "").trim().toLowerCase();
    if (!query) return true;
    return [item.title, item.model, item.mode, item.workspace, item.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
}

function renderHistoryMenu(items) {
    ui.historyItems = Array.isArray(items) ? items : [];
    modelMenuEl.innerHTML = "";
    modelMenuEl.dataset.kind = "history";
    const head = document.createElement("div");
    head.className = "model-menu-head";
    head.textContent = "Conversations récentes";
    modelMenuEl.appendChild(head);

    const tools = document.createElement("div");
    tools.className = "history-tools";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "history-search";
    search.placeholder = "Rechercher (titre, modèle, dossier)…";
    search.value = ui.historyQuery || "";
    search.oninput = () => {
        ui.historyQuery = search.value;
        renderHistoryList();
    };
    search.onkeydown = (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        e.preventDefault();
        if (search.value) {
            // Premier Escape : vide la recherche ; second Escape : ferme le menu.
            search.value = "";
            ui.historyQuery = "";
            renderHistoryList();
        } else {
            hideModelMenu();
        }
    };
    search.onclick = (e) => e.stopPropagation();

    const label = document.createElement("label");
    label.className = "history-filter";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.disabled = !historyCurrentWorkspace();
    check.checked = !check.disabled && !!ui.historyOnlyProject;
    check.onchange = () => {
        ui.historyOnlyProject = check.checked;
        renderHistoryList();
    };
    label.title = check.disabled ? "Aucun projet ouvert." : historyCurrentWorkspace();
    label.onclick = (e) => e.stopPropagation();
    label.append(check, document.createTextNode(" Ce projet"));

    tools.append(search, label);
    modelMenuEl.appendChild(tools);

    const list = document.createElement("div");
    list.className = "history-list";
    modelMenuEl.appendChild(list);
    renderHistoryList();
    setTimeout(() => {
        if (search.isConnected) search.focus();
    }, 0);
}

function renderHistoryList() {
    const list = modelMenuEl.querySelector(".history-list");
    if (!list) return;
    list.innerHTML = "";
    const all = ui.historyItems || [];
    const shown = all.filter(historyMatches);
    if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "model-empty";
        empty.textContent = all.length ? "Aucune conversation ne correspond." : "Aucune conversation enregistrée.";
        list.appendChild(empty);
        return;
    }
    for (const item of shown) list.appendChild(renderHistoryRow(item));
}

function renderHistoryRow(item) {
    const row = document.createElement("div");
    row.className = "model-item history-item";
    row.title = [item.title, item.workspace, item.id].filter(Boolean).join("\n");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-open";
    const main = document.createElement("span");
    main.className = "model-item-main";
    const name = document.createElement("span");
    name.className = "model-item-name";
    name.textContent = `${item.number}. ${item.title}`;
    main.appendChild(name);
    const sub = document.createElement("span");
    sub.className = "model-item-sub";
    const when = item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "";
    sub.textContent = [when, item.mode, item.model, `${item.messages} message(s)`].filter(Boolean).join(" · ");
    main.appendChild(sub);
    open.appendChild(main);
    open.onclick = () => {
        hideModelMenu();
        if (ui.status && ui.status.busy) {
            renderEntry({ type: "error", text: "Une demande est en cours : attends sa fin avant de changer de conversation." });
            return;
        }
        send(`/chat-id ${item.id}`);
    };

    const actions = document.createElement("span");
    actions.className = "history-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "history-action";
    renameBtn.textContent = "✎";
    renameBtn.title = "Renommer";
    renameBtn.setAttribute("aria-label", "Renommer la conversation");
    renameBtn.onclick = (e) => {
        e.stopPropagation();
        startHistoryRename(row, item);
    };

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "history-action";
    removeBtn.textContent = "✕";
    removeBtn.title = "Supprimer de l'historique";
    removeBtn.setAttribute("aria-label", "Supprimer la conversation de l'historique");
    removeBtn.onclick = async (e) => {
        e.stopPropagation();
        if (removeBtn.dataset.confirm !== "1") {
            // Deux clics pour supprimer : évite les suppressions accidentelles.
            removeBtn.dataset.confirm = "1";
            removeBtn.textContent = "Supprimer ?";
            removeBtn.classList.add("danger");
            setTimeout(() => {
                if (removeBtn.isConnected && removeBtn.dataset.confirm === "1") {
                    removeBtn.dataset.confirm = "";
                    removeBtn.textContent = "✕";
                    removeBtn.classList.remove("danger");
                }
            }, 3000);
            return;
        }
        removeBtn.disabled = true;
        try {
            await api.conversationsRemove(item.id);
            ui.historyItems = (ui.historyItems || []).filter((x) => x.id !== item.id);
            ui.historyItems.forEach((x, i) => {
                x.number = i + 1; // même numérotation que /history
            });
            renderHistoryList();
        } catch (err) {
            removeBtn.disabled = false;
            renderEntry({ type: "error", text: err.message });
        }
    };

    actions.append(renameBtn, removeBtn);
    row.append(open, actions);
    return row;
}

function startHistoryRename(row, item) {
    const open = row.querySelector(".history-open");
    const actions = row.querySelector(".history-actions");
    if (!open || row.querySelector(".history-rename")) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "history-rename";
    input.value = item.title;
    input.maxLength = 200;
    open.style.display = "none";
    if (actions) actions.style.display = "none";
    row.insertBefore(input, open);
    input.focus();
    input.select();

    let done = false;
    const finish = async (save) => {
        if (done) return;
        done = true;
        const value = input.value.trim();
        if (save && value && value !== item.title) {
            try {
                const res = await api.conversationsRename(item.id, value);
                item.title = res.title;
            } catch (err) {
                renderEntry({ type: "error", text: err.message });
            }
        }
        renderHistoryList();
    };
    input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
        }
    };
    input.onclick = (e) => e.stopPropagation();
    input.onblur = () => finish(true);
}

async function openHistoryMenu() {
    const anchor = $("btn-history");
    modelMenuEl.classList.remove("hidden");
    modelMenuEl.dataset.kind = "history";
    modelMenuEl.innerHTML = '<div class="model-empty">Chargement de l\'historique…</div>';
    positionModelMenu(anchor);
    try {
        const items = await api.conversationsRecent(30);
        if (!modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "history") {
            renderHistoryMenu(items);
            positionModelMenu(anchor);
        }
    } catch (err) {
        if (!modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "history") {
            modelMenuEl.innerHTML = `<div class="model-error">${escapeHtml(err.message)}</div>`;
        }
    }
}

function toggleHistoryMenu() {
    if (!modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "history") hideModelMenu();
    else openHistoryMenu();
}

