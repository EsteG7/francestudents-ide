/* ---------- Reprise d’une conversation Codex · Bêta ---------- */
const conversationImportButton = document.createElement("button");
conversationImportButton.type = "button";
conversationImportButton.id = "conversation-import";
conversationImportButton.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v12l4-4h5M17 3v10m-4-4 4 4 4-4M13 18h8"/></svg><span>Importer Codex</span><span class="composer-beta">Bêta</span>';
conversationImportButton.setAttribute("aria-label", "Importer une conversation Codex, bêta");
conversationImportButton.title = "Continuer une conversation Codex avec une IA FranceStudent";
$("composer-options").appendChild(conversationImportButton);

const conversationImportDialog = document.createElement("dialog");
conversationImportDialog.id = "conversation-import-dialog";
conversationImportDialog.className = "conversation-import-dialog";
conversationImportDialog.setAttribute("aria-labelledby", "conversation-import-title");
conversationImportDialog.innerHTML = `<h2 id="conversation-import-title">Continuer une conversation Codex <small>Bêta</small></h2>
<p>Ouvre le même projet dans FranceStudent, importe le contexte de ta conversation puis choisis l’IA avec laquelle continuer. Aucun fichier du projet n’est importé ou modifié.</p>
<p id="conversation-import-project" class="settings-help"></p><button type="button" id="conversation-import-open-project">Ouvrir le dossier du projet</button>
<label>Lien de partage Codex<input id="conversation-import-url" type="url" placeholder="https://chatgpt.com/s/cx_…" autocomplete="off"></label>
<p class="settings-help">Un lien privé peut être inaccessible. Tu peux aussi utiliser /export dans Codex, sélectionner un export Markdown, JSON ou JSONL, ou coller le texte.</p>
<div class="studio-actions"><button type="button" id="conversation-import-file">Choisir un export…</button><span id="conversation-import-source" class="settings-help"></span></div>
<label>Ou coller la conversation / l’export<textarea id="conversation-import-text" rows="5" placeholder="Colle ici le texte ou le JSON de la conversation…"></textarea></label>
<div class="studio-actions"><button type="button" id="conversation-import-preview">Analyser la conversation</button></div>
<p id="conversation-import-status" role="status"></p><ul id="conversation-import-warnings" class="settings-help"></ul>
<details id="conversation-import-result" class="hidden"><summary>Aperçu du début et de la fin de la conversation</summary><pre id="conversation-import-excerpt"></pre></details>
<div class="conversation-import-choices"><label>IA pour continuer<select id="conversation-import-model"></select></label><label>Mode<select id="conversation-import-mode"><option value="agent">Agent sur le projet ouvert</option><option value="chat">Discussion</option></select></label></div>
<p class="settings-help">Préparer la reprise crée une nouvelle conversation et joint le contexte au brouillon. Tu peux modifier ta demande avant de l’envoyer. Les images et pièces jointes d’origine ne sont pas transférées automatiquement.</p>
<div class="studio-actions"><button type="button" id="conversation-import-close">Annuler</button><button type="button" id="conversation-import-apply" class="primary" disabled>Préparer la reprise</button></div>`;
document.body.appendChild(conversationImportDialog);
let conversationImportPreview = null;
let conversationImportSequence = 0;
let conversationImportWorking = false;

function conversationImportControls(working) {
    conversationImportWorking = working;
    for (const id of ["url", "text", "file", "preview", "model", "mode", "open-project"]) $("conversation-import-" + id).disabled = working;
    $("conversation-import-apply").disabled = working || !conversationImportPreview || !$("conversation-import-model").value;
}
function invalidateConversationImport() {
    conversationImportPreview = null;
    $("conversation-import-result").classList.add("hidden");
    $("conversation-import-warnings").replaceChildren();
    $("conversation-import-status").textContent = "";
    conversationImportControls(false);
}
function renderConversationImportPreview(result) {
    conversationImportPreview = result;
    $("conversation-import-source").textContent = result.source;
    $("conversation-import-status").textContent = `${result.messageCount} message(s) · ${result.chars.toLocaleString("fr-FR")} caractères. Vérifie l’aperçu avant de préparer la reprise.`;
    const warnings = $("conversation-import-warnings"); warnings.replaceChildren();
    for (const warning of result.warnings) { const item = document.createElement("li"); item.textContent = warning; warnings.appendChild(item); }
    $("conversation-import-excerpt").textContent = result.excerpt.map(message => `${message.role === "user" ? "Vous" : message.role === "assistant" ? "Codex" : "Contexte"}\n${message.text}`).join("\n\n──────────\n\n");
    $("conversation-import-result").classList.remove("hidden");
    $("conversation-import-result").open = true;
}
async function analyzeConversationImport(action, payload) {
    if (conversationImportWorking) return;
    const sequence = ++conversationImportSequence;
    invalidateConversationImport(); conversationImportControls(true);
    $("conversation-import-status").textContent = "Lecture de la conversation…";
    try {
        const result = await api.importConversation(action, payload);
        if (sequence !== conversationImportSequence) return;
        if (result.canceled) { $("conversation-import-status").textContent = "Sélection annulée."; return; }
        if (action === "file") { $("conversation-import-url").value = ""; $("conversation-import-text").value = ""; }
        renderConversationImportPreview(result);
    } catch (error) {
        if (sequence === conversationImportSequence) $("conversation-import-status").textContent = error.message;
    } finally { if (sequence === conversationImportSequence) conversationImportControls(false); }
}

conversationImportButton.onclick = async () => {
    if (ui.status.busy) { studioFeedback("Attends la fin de la tâche avant d’importer une conversation."); return; }
    $("conversation-import-project").textContent = `Projet ouvert : ${ui.workspace || "aucun — ouvre le dossier correspondant pour poursuivre le code"}`;
    $("conversation-import-mode").value = ui.status.mode === "chat" ? "chat" : "agent";
    conversationImportDialog.showModal();
    const sequence = ++conversationImportSequence;
    conversationImportControls(true);
    try {
        const data = await api.models();
        if (sequence !== conversationImportSequence) return;
        const select = $("conversation-import-model"); select.replaceChildren();
        for (const model of data.agents || []) { const option = document.createElement("option"); option.value = model.id; option.textContent = model.name; select.appendChild(option); }
        select.value = String(ui.currentModelId ?? data.current);
        if (!select.value && select.options.length) select.selectedIndex = 0;
    } catch (error) { $("conversation-import-status").textContent = error.message; }
    finally { if (sequence === conversationImportSequence) conversationImportControls(false); }
};
$("conversation-import-url").addEventListener("input", invalidateConversationImport);
$("conversation-import-text").addEventListener("input", invalidateConversationImport);
$("conversation-import-file").onclick = () => analyzeConversationImport("file");
$("conversation-import-preview").onclick = () => {
    const url = $("conversation-import-url").value.trim(), content = $("conversation-import-text").value.trim();
    if (!url && !content) { $("conversation-import-status").textContent = "Colle un lien ou une conversation, ou choisis un export."; return; }
    analyzeConversationImport("preview", url ? { url } : { content });
};
$("conversation-import-open-project").onclick = async () => {
    try { const workspace = await api.openProject(); if (workspace) $("conversation-import-project").textContent = `Projet ouvert : ${workspace}`; }
    catch (error) { $("conversation-import-status").textContent = error.message; }
};
$("conversation-import-close").onclick = () => conversationImportDialog.close();
conversationImportDialog.addEventListener("close", () => { conversationImportSequence++; conversationImportControls(false); });
$("conversation-import-apply").onclick = async () => {
    if (!conversationImportPreview || conversationImportWorking) return;
    conversationImportControls(true);
    try {
        const result = await api.importConversation("apply", { token: conversationImportPreview.token,
            modelId: Number($("conversation-import-model").value), mode: $("conversation-import-mode").value });
        pendingAttachments.push(result.attachment);
        input.value = input.value.trim() ? input.value + "\n\n" + result.prompt : result.prompt;
        renderAttachments(); saveStudioDraft(); autosizeInput(); setAgentTab("conversation");
        conversationImportPreview = null;
        conversationImportDialog.close();
        input.focus();
        studioFeedback("Conversation Codex importée. Modifie ta demande si nécessaire, puis clique sur Envoyer pour continuer.");
    } catch (error) { $("conversation-import-status").textContent = error.message; }
    finally { conversationImportControls(false); }
};
