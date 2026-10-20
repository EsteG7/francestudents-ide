/* ---------- Vue Git : état du dépôt, diff inline et journal ---------- */

ui.git = { open: null, timer: null, busy: false };

function gitCode(file) {
    const code = `${file.index || " "}${file.worktree || " "}`.trim();
    return code || "M";
}

function gitDiffLines(result) {
    const text = typeof result === "string" ? result : String(result?.diff ?? result?.text ?? "");
    return text
        .split(/\r?\n/)
        .filter((line) => line && !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename from|rename to)/.test(line));
}

function gitCountChanges(lines) {
    let added = 0;
    let removed = 0;
    for (const line of lines) {
        if (line[0] === "+") added++;
        else if (line[0] === "-") removed++;
    }
    return { added, removed };
}

function updateGitBadge(count) {
    const badge = $("git-count");
    if (!badge) return;
    badge.textContent = count ? String(count) : "";
    badge.classList.toggle("hidden", !count);
}

function gitMessage(container, text) {
    container.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "ext-empty";
    empty.textContent = text;
    container.appendChild(empty);
}

async function toggleGitDiff(file, row) {
    const next = row.nextElementSibling;
    if (next && next.classList.contains("git-diff")) {
        next.remove();
        ui.git.open = null;
        return;
    }
    document.querySelectorAll("#git-files .git-diff").forEach((el) => el.remove());
    ui.git.open = file.path;
    const holder = document.createElement("div");
    holder.className = "git-diff";
    holder.textContent = "Chargement du diff…";
    row.after(holder);
    try {
        let lines;
        if (file.worktree === "?") {
            // Fichier non suivi : tout son contenu est un ajout.
            const content = await api.readFile(file.path);
            const text = typeof content === "string" ? content : String(content?.content ?? "");
            lines = text.split(/\r?\n/).map((l) => `+${l}`);
        } else {
            lines = gitDiffLines(await api.gitDiff(file.path, Boolean(file.staged)));
        }
        holder.innerHTML = "";
        if (!lines.length) {
            holder.textContent = "Aucune différence textuelle (fichier binaire ou changement de mode).";
            return;
        }
        holder.appendChild(buildDiffCard({ path: file.path, lines, ...gitCountChanges(lines) }));
    } catch (error) {
        holder.textContent = `Diff impossible : ${error.message}`;
    }
}

function renderGitFiles(files) {
    const list = $("git-files");
    list.innerHTML = "";
    if (!files.length) {
        gitMessage(list, "Aucune modification : l'arbre de travail est propre.");
        return;
    }
    for (const file of files) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "git-row";
        row.title = `${file.path}${file.from ? ` (depuis ${file.from})` : ""} — ${file.label || ""}\nClic : diff · Double-clic : ouvrir`;
        row.appendChild(fileIcon(file.path, "file"));
        const p = document.createElement("span");
        p.className = "git-path";
        p.textContent = file.path;
        row.appendChild(p);
        const c = document.createElement("span");
        c.className = "git-code";
        c.textContent = gitCode(file) + (file.staged ? " ·indexé" : "");
        row.appendChild(c);
        row.onclick = () => toggleGitDiff(file, row);
        row.ondblclick = () => { if (file.worktree !== "D" && file.index !== "D") openFile(file.path); };
        list.appendChild(row);
        if (ui.git.open === file.path) toggleGitDiff(file, row);
    }
}

function renderGitLog(commits) {
    const list = $("git-log");
    list.innerHTML = "";
    if (!commits.length) {
        gitMessage(list, "Aucun commit pour l'instant.");
        return;
    }
    for (const commit of commits) {
        const row = document.createElement("div");
        row.className = "git-commit";
        row.title = `${commit.hash}\n${commit.author} — ${commit.date}`;
        const h = document.createElement("span");
        h.className = "git-hash";
        h.textContent = commit.short;
        row.appendChild(h);
        const s = document.createElement("span");
        s.textContent = ` ${commit.subject}`;
        row.appendChild(s);
        list.appendChild(row);
    }
}

async function refreshGit() {
    if (ui.git.busy) return;
    ui.git.busy = true;
    const branch = $("git-branch");
    try {
        const st = await api.gitStatus();
        if (!st || !st.repo) {
            branch.textContent = "Pas de dépôt Git dans ce dossier.";
            gitMessage($("git-files"), "Initialisez un dépôt avec « git init » dans le terminal.");
            $("git-log").innerHTML = "";
            updateGitBadge(0);
            return;
        }
        const sync = [st.ahead ? `↑${st.ahead}` : "", st.behind ? `↓${st.behind}` : ""].filter(Boolean).join(" ");
        branch.textContent = `Branche ${st.branch || "(détachée)"}${sync ? ` · ${sync}` : ""} · ${st.files.length} fichier(s) modifié(s)`;
        updateGitBadge(st.files.length);
        renderGitFiles(st.files);
        renderGitLog(await api.gitLog(20));
    } catch (error) {
        branch.textContent = `Git : ${gitErrorText(error)}`;
    } finally {
        ui.git.busy = false;
        refreshGitHub();
    }
}

/** Message d'erreur IPC sans le préfixe ajouté par Electron. */
function gitErrorText(error) {
    return String((error && error.message) || error || "").replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}

function gitActionMessage(text, kind) {
    const box = $("git-action-msg");
    box.textContent = text || "";
    box.className = `git-action-msg${kind ? ` ${kind}` : ""}`;
}

/** État du compte GitHub et du remote origin (seule la version masquée du token arrive ici). */
async function refreshGitHub() {
    if (!api.githubStatus) return;
    const account = $("gh-account");
    try {
        const st = await api.githubStatus();
        if (st.connected) {
            account.textContent = `Connecté : ${st.login || "?"}${st.name ? ` (${st.name})` : ""} · token ${st.masked || ""}${st.source ? ` (${st.source})` : ""}`;
        } else if (st.error) {
            account.textContent = `Token refusé ou réseau indisponible : ${st.error}`;
        } else {
            account.textContent = "Non connecté à GitHub.";
        }
        $("gh-login-row").classList.toggle("hidden", Boolean(st.connected));
        $("gh-logout-row").classList.toggle("hidden", !(st.connected || st.masked));
        $("gh-remote").textContent = st.remote ? `Remote origin : ${st.remote}` : "Aucun remote « origin ».";
    } catch (error) {
        account.textContent = `GitHub : ${gitErrorText(error)}`;
    }
}

/** Lance une action Git/GitHub : boutons désactivés pendant l'action, message, puis actualisation. */
async function runGitAction(label, fn) {
    if (ui.git.action) return;
    ui.git.action = true;
    const buttons = Array.from(document.querySelectorAll("#git-view button"));
    buttons.forEach((b) => { b.disabled = true; });
    gitActionMessage(`${label}…`, "");
    try {
        const text = await fn();
        gitActionMessage(text || `${label} : terminé.`, "ok");
    } catch (error) {
        gitActionMessage(`${label} : ${gitErrorText(error)}`, "error");
    } finally {
        buttons.forEach((b) => { b.disabled = false; });
        ui.git.action = false;
        refreshGit();
    }
}

function gitCommitNow() {
    const input = $("git-commit-msg");
    const message = input.value.trim();
    if (!message) {
        gitActionMessage("Écrivez un message de commit.", "error");
        input.focus();
        return;
    }
    runGitAction("Commit", async () => {
        const r = await api.gitCommit(message);
        input.value = "";
        return `Commit créé (${r.files} fichier(s)).`;
    });
}

/** Rafraîchissement différé (écritures de l'agent, sauvegardes). */
function scheduleGitRefresh() {
    clearTimeout(ui.git.timer);
    ui.git.timer = setTimeout(() => {
        if (ui.workspace) refreshGit();
    }, 400);
}

$("btn-git-refresh").onclick = () => refreshGit();
$("btn-git-commit").onclick = () => gitCommitNow();
$("git-commit-msg").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        gitCommitNow();
    }
});
$("btn-git-push").onclick = () => runGitAction("Push", async () => {
    const r = await api.githubPush();
    return `Push terminé : ${r.branch} → ${r.remote}.`;
});
$("btn-git-pull").onclick = () => runGitAction("Pull", async () => {
    const r = await api.githubPull();
    return `Pull terminé (${r.remote}/${r.branch})${r.output ? ` : ${r.output.split("\n").pop()}` : "."}`;
});
$("btn-git-fetch").onclick = () => runGitAction("Fetch", async () => {
    const r = await api.githubFetch();
    return `Fetch terminé (${r.remote}).`;
});
$("btn-gh-login").onclick = () => {
    const input = $("gh-token");
    const token = input.value.trim();
    if (!token) {
        gitActionMessage("Collez un token GitHub.", "error");
        input.focus();
        return;
    }
    runGitAction("Connexion GitHub", async () => {
        try {
            const u = await api.githubLoginToken(token);
            return `Connecté en tant que ${u.login || "?"}.`;
        } finally {
            input.value = "";
        }
    });
};
$("gh-token").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("btn-gh-login").click();
});
$("btn-gh-logout").onclick = () => runGitAction("Déconnexion GitHub", async () => {
    await api.githubLogout();
    return "Token GitHub supprimé de cet ordinateur.";
});
$("btn-gh-remote").onclick = () => {
    const input = $("gh-remote-input");
    const spec = input.value.trim();
    if (!spec) {
        gitActionMessage("Indiquez owner/repo ou une URL GitHub.", "error");
        input.focus();
        return;
    }
    runGitAction("Remote", async () => {
        const r = await api.githubSetRemote(spec);
        input.value = "";
        return `Remote ${r.remote} ${r.updated ? "mis à jour" : "ajouté"} : ${r.url}`;
    });
};
$("btn-gh-create").onclick = () => {
    const input = $("gh-repo-name");
    const name = input.value.trim();
    if (!name) {
        gitActionMessage("Indiquez le nom du dépôt à créer.", "error");
        input.focus();
        return;
    }
    const isPublic = $("gh-repo-public").checked;
    runGitAction("Création du dépôt", async () => {
        const repo = await api.githubCreateRepo(name, isPublic);
        input.value = "";
        let extra = "";
        const st = await api.githubStatus().catch(() => null);
        if (st && !st.remote && ui.workspace) {
            await api.githubSetRemote(repo.full_name);
            extra = " Remote origin défini.";
        }
        return `Dépôt ${repo.private ? "privé" : "public"} créé : ${repo.html_url}.${extra}`;
    });
};
