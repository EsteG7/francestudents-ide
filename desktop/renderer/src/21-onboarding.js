/* Connexion explicite et guide accessible, sans identifiants dans le chat. */
let guideStep = 1;
let guideBusy = false;
let guideReturnFocus = null;
let connectionOrigin = "https://ia.francestudent.org";

function openConnectionGuide(step) {
    guideReturnFocus = document.activeElement;
    $("connection-guide").classList.remove("hidden");
    setGuideStep(step || (ui.status.booted ? (ui.workspace ? 3 : 2) : 1));
    setTimeout(() => {
        const first = $("connection-guide").querySelector('input:not(:disabled), button:not(:disabled)');
        if (guideStep === 1 && !ui.status.booted) $("guide-email").focus();
        else if (first) first.focus();
    }, 0);
}
function closeConnectionGuide() {
    if (guideBusy) return;
    $("guide-password").value = "";
    $("connection-guide").classList.add("hidden");
    if (guideReturnFocus?.isConnected) guideReturnFocus.focus();
    else input.focus();
}
function setGuideStep(step) {
    guideStep = [1, 2, 3].includes(step) ? step : 1;
    for (const page of document.querySelectorAll("[data-guide-page]")) page.classList.toggle("hidden", Number(page.dataset.guidePage) !== guideStep);
    for (const marker of document.querySelectorAll("[data-guide-step]")) {
        marker.classList.toggle("current", Number(marker.dataset.guideStep) === guideStep);
        if (Number(marker.dataset.guideStep) === guideStep) marker.setAttribute("aria-current", "step");
        else marker.removeAttribute("aria-current");
    }
    $("guide-title").textContent = ["", "Bienvenue. On commence ?", "Ouvre le bon dossier", "Ta première demande"][guideStep];
    $("guide-description").textContent = ["", "Connecte-toi avec les mêmes identifiants que sur le site FranceStudent.", "Pas besoin de configuration technique : choisis simplement le dossier de ton projet.", "L’agent comprend tes demandes en français. Tu peux préciser ou corriger ce que tu veux au fil du travail."][guideStep];
    $("guide-login-form").classList.toggle("hidden", Boolean(ui.status.booted));
    $("guide-already-connected").classList.toggle("hidden", !ui.status.booted);
    $("guide-project-name").textContent = ui.workspace ? `Dossier choisi : ${ui.workspace.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}` : "Tu pourras aussi ouvrir un dossier plus tard avec le bouton Ouvrir un dossier.";
    $("guide-project-next").disabled = !ui.workspace;
    $("guide-message").textContent = "";
    $("guide-message").classList.remove("is-error");
}
function guideError(error) {
    const message = String(error?.message || error || "Connexion impossible.");
    const special = /captcha|double authentification|two.factor|cloudflare/i.test(message);
    $("guide-message").textContent = special
        ? "Ton compte demande une vérification supplémentaire que cette connexion ne prend pas encore en charge. Ouvre le site FranceStudent pour vérifier ton accès."
        : /password|mot de passe|identifiant|invalid|incorrect|401|403/i.test(message)
            ? "Connexion refusée. Vérifie l’adresse e-mail et le mot de passe de ton compte FranceStudent."
            : "La connexion n’a pas abouti. Vérifie tes identifiants et ta connexion Internet, puis réessaie.";
    $("guide-message").classList.add("is-error");
}

$("guide-login-form").onsubmit = async event => {
    event.preventDefault();
    if (guideBusy || !$("guide-login-form").reportValidity()) return;
    guideBusy = true;
    $("guide-message").textContent = "Connexion à FranceStudent…";
    $("guide-message").classList.remove("is-error");
    $("guide-login-submit").textContent = "Connexion…";
    $("guide-login-form").setAttribute("aria-busy", "true");
    for (const control of $("connection-guide").querySelectorAll("input, button")) control.disabled = true;
    try {
        const result = await api.loginAccount({ email: $("guide-email").value.trim(), password: $("guide-password").value });
        if (!result?.ok) throw new Error(result?.reason || "Connexion impossible.");
        applyStatus(await api.status());
        setGuideStep(2);
    } catch (error) { guideError(error); }
    finally {
        $("guide-password").value = "";
        guideBusy = false;
        for (const control of $("connection-guide").querySelectorAll("input, button")) control.disabled = false;
        $("guide-project-next").disabled = !ui.workspace;
        $("guide-login-submit").textContent = "Se connecter";
        $("guide-login-form").removeAttribute("aria-busy");
    }
};
$("guide-close").onclick = closeConnectionGuide;
$("guide-finish").onclick = closeConnectionGuide;
$("settings-guide").onclick = () => openConnectionGuide();
$("settings-logout").onclick = async () => {
    $("settings-logout").disabled = true;
    $("settings-message").textContent = "Déconnexion…";
    try { await api.logoutAccount(); }
    catch (error) {
        $("settings-message").textContent = `Déconnexion non terminée : ${error.message}`;
        applyStatus(await api.status());
    }
};
api.onEvent(async channel => {
    if (channel !== "signedOut") return;
    applyStatus(await api.status());
    ui.quota = null;
    renderQuota();
    $("guide-email").value = "";
    $("guide-password").value = "";
    $("guide-password").type = "password";
    $("guide-show-password").textContent = "Afficher";
    $("guide-show-password").setAttribute("aria-pressed", "false");
    $("guide-show-password").setAttribute("aria-label", "Afficher le mot de passe");
    showSideView("explorer");
    openConnectionGuide(1);
    $("guide-message").textContent = "Tu es déconnecté de cet ordinateur. Tu peux te reconnecter ou utiliser un autre compte.";
});
$("btn-help").onclick = () => openConnectionGuide();
$("btn-help").title = "Connexion et guide de démarrage";
$("guide-to-project").onclick = () => setGuideStep(2);
$("guide-show-password").onclick = () => {
    const reveal = $("guide-password").type === "password";
    $("guide-password").type = reveal ? "text" : "password";
    $("guide-show-password").textContent = reveal ? "Masquer" : "Afficher";
    $("guide-show-password").setAttribute("aria-pressed", String(reveal));
    $("guide-show-password").setAttribute("aria-label", reveal ? "Masquer le mot de passe" : "Afficher le mot de passe");
};
$("guide-open-site").onclick = () => api.openExternal(connectionOrigin).catch(guideError);
$("guide-open-account").onclick = () => api.openExternal(connectionOrigin).catch(guideError);
$("guide-pick-project").onclick = async () => {
    try { await api.openProject(); applyStatus(await api.status()); setGuideStep(2); }
    catch (error) { $("guide-message").textContent = error.message; }
};
$("guide-skip-project").onclick = () => setGuideStep(3);
$("guide-project-next").onclick = () => setGuideStep(3);
$("guide-first-prompt").onclick = () => {
    closeConnectionGuide();
    setAgentTab("conversation");
    input.value = ui.workspace ? "Explore ce projet et explique-moi comment le lancer et le vérifier." : "Explique-moi comment tu peux m’aider et comment démarrer mon premier projet.";
    saveStudioDraft(); autosizeInput(); input.focus();
};
$("connection-guide").addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeConnectionGuide(); return; }
    if (event.key !== "Tab") return;
    const controls = [...$("connection-guide").querySelectorAll("button:not(:disabled), input:not(:disabled), summary")].filter(element => element.offsetParent !== null);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
