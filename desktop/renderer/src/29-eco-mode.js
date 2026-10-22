/* ---------- Mode Éco ---------- */
const ecoModeButton = document.createElement("button");
ecoModeButton.id = "eco-mode-toggle";
ecoModeButton.type = "button";
ecoModeButton.textContent = "Mode Éco";
ecoModeButton.setAttribute("aria-pressed", "false");
$("conversation-import").after(ecoModeButton);

const ecoModeDialog = document.createElement("dialog");
ecoModeDialog.id = "eco-mode-dialog";
ecoModeDialog.className = "history-delete-dialog";
ecoModeDialog.setAttribute("aria-labelledby", "eco-mode-title");
ecoModeDialog.innerHTML = `<h2 id="eco-mode-title">Activer le mode Éco ?</h2>
<p>Ce mode vise à réduire la consommation de quota, avec des capacités limitées :</p>
<ul><li>Agent limité à 4 tours par demande : les tâches longues peuvent rester incomplètes.</li>
<li>Contexte projet ajouté automatiquement limité à 20 000 caractères. L’IA peut manquer certains éléments et doit lire les fichiers nécessaires.</li>
<li>Pas de sous-agents ni de nouvelle tentative automatique en cas de réponse d’outil invalide.</li>
<li>Recherche web intégrée désactivée et réponses demandées plus concises.</li></ul>
<p>Le modèle sélectionné reste le même. Ce mode ne garantit pas un quota fixe : l’historique existant, les fichiers, leurs pages et les relances réseau peuvent toujours coûter cher. Aucune pièce jointe n’est supprimée.</p>
<p>Le choix est mémorisé pour les prochaines demandes. Tu peux le désactiver à tout moment hors exécution.</p>
<p id="eco-mode-error" role="status"></p>
<div class="studio-actions"><button type="button" id="eco-mode-cancel">Annuler</button><button type="button" id="eco-mode-enable">Activer avec ces limites</button></div>`;
document.body.appendChild(ecoModeDialog);
async function setEcoModeEnabled(enabled) {
    ecoModeButton.disabled = true;
    try { await api.setEcoMode(enabled); applyStatus(await api.status()); }
    finally { ecoModeButton.disabled = Boolean(ui.status.busy); }
}
ecoModeButton.onclick = async () => {
    if (ui.status.busy) return;
    if (ui.status.ecoMode) {
        try { await setEcoModeEnabled(false); }
        catch (error) { studioFeedback(error.message); }
        return;
    }
    $("eco-mode-error").textContent = "";
    ecoModeDialog.showModal();
    $("eco-mode-cancel").focus();
};
$("eco-mode-cancel").onclick = () => ecoModeDialog.close();
$("eco-mode-enable").onclick = async () => {
    $("eco-mode-enable").disabled = true;
    try { await setEcoModeEnabled(true); ecoModeDialog.close(); }
    catch (error) { $("eco-mode-error").textContent = error.message; }
    finally { $("eco-mode-enable").disabled = false; }
};
