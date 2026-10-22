/* ---------- Serveurs locaux proposés dans les réponses ---------- */
async function attachServerControls(message, text) {
    if (message.dataset.serverChecked || !/https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(text || "")) return;
    message.dataset.serverChecked = "1";
    const workspace = ui.workspace || ui.status.workspace || null;
    try {
        const hint = await api.serverHint(text);
        if (!hint || !message.isConnected) return;
        const card = document.createElement("section");
        card.className = "message-server-controls";
        card.dataset.serverKey = hint.key;
        card.serverWorkspace = workspace;
        const title = document.createElement("b"); title.textContent = "Serveur web local";
        const command = document.createElement("code"); command.textContent = `${hint.command} · dossier : ${hint.cwd}`;
        const address = document.createElement("span"); address.textContent = hint.url;
        const status = document.createElement("p"); status.className = "message-server-status"; status.setAttribute("role", "status");
        status.textContent = "Lance cette commande dans le projet ouvert avec Démarrer.";
        const actions = document.createElement("div"); actions.className = "studio-actions";
        const start = document.createElement("button"); start.type = "button"; start.textContent = "Démarrer";
        const stop = document.createElement("button"); stop.type = "button"; stop.textContent = "Arrêter"; stop.disabled = true;
        const open = document.createElement("button"); open.type = "button"; open.textContent = "Ouvrir le site";
        const details = document.createElement("details"), summary = document.createElement("summary"), output = document.createElement("pre");
        summary.textContent = "Sortie du serveur"; details.append(summary, output); details.hidden = true;
        card.updateServerRun = run => {
            card.serverRun = run;
            const running = run.status === "running";
            start.disabled = running; stop.disabled = !running;
            status.textContent = running ? "Processus en cours. Ouvre le site quand le serveur est prêt." : run.status === "stopped" ? "Serveur arrêté." : `Processus terminé${run.exitCode != null ? ` (code ${run.exitCode})` : ""}. Consulte la sortie si le site est inaccessible.`;
            output.textContent = String(run.output || "").slice(-8000); details.hidden = !output.textContent;
            if (run.status === "failed") details.open = true;
        };
        start.onclick = async () => {
            start.disabled = true; status.textContent = "Démarrage…";
            try { card.updateServerRun(await api.projectStudio("serverStart", { text, workspace })); }
            catch (error) { status.textContent = error.message; start.disabled = false; }
        };
        stop.onclick = async () => {
            stop.disabled = true;
            try { await api.projectStudio("stop", { id: card.serverRun.id }); }
            catch (error) { status.textContent = error.message; stop.disabled = false; }
        };
        open.onclick = () => openLocalBrowser(hint.url);
        actions.append(start, stop, open); card.append(title, command, address, status, actions, details); message.appendChild(card);
        const runs = await api.projectStudio("runs");
        const run = [...runs].reverse().find(item => item.server?.key === hint.key && item.workspace === workspace);
        if (run && card.isConnected) card.updateServerRun(run);
    } catch { /* Ordinary messages remain readable when task controls are unavailable. */ }
}

api.onEvent((channel, run) => {
    if (channel !== "projectTask" || !run.server) return;
    for (const card of document.querySelectorAll(".message-server-controls")) {
        if (card.dataset.serverKey === run.server.key && card.serverWorkspace === run.workspace) card.updateServerRun(run);
    }
});
