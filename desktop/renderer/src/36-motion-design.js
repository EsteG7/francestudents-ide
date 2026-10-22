/* ---------- Motion design (ULTRA BÊTA) : onglet à part, aucune modification des vues existantes ---------- */
/* Cet onglet n'embarque pas encore EffectCraft : il affiche un avertissement expérimental et prépare des demandes pour le chat. */
const motionNav = document.createElement("button");
motionNav.type = "button";
motionNav.className = "activity";
motionNav.dataset.view = "motion";
motionNav.id = "btn-motion";
motionNav.title = "Motion design (ultra bêta, expérimental)";
motionNav.setAttribute("aria-label", "Motion design, ultra bêta expérimental");
motionNav.innerHTML = '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/></svg><span class="activity-badge motion-badge" aria-hidden="true">β</span>';
(() => {
    const spacer = document.querySelector("#activity-bar .spacer");
    if (spacer) $("activity-bar").insertBefore(motionNav, spacer);
    else $("activity-bar").append(motionNav);
})();

const motionView = document.createElement("section");
motionView.id = "motion-view";
motionView.className = "motion-page";
motionView.setAttribute("aria-label", "Motion design (expérimental)");
motionView.innerHTML = `
 <header class="motion-header">
  <div><span class="motion-eyebrow">MOTION DESIGN · EXPÉRIMENTAL</span><h1>Motion design <span class="motion-pill">Ultra bêta</span></h1></div>
  <div class="motion-actions"><button type="button" id="motion-close">Retour au code</button></div>
 </header>
 <div class="motion-warning" role="note">
  <b>Fonctionnalité expérimentale.</b>
  <span>Cet espace est en ultra bêta : il peut être incomplet, instable, changer d’un jour à l’autre ou disparaître. Ne l’utilise pas pour un travail important sans copie de sauvegarde.</span>
 </div>
 <div class="motion-stage" aria-label="Zone de travail motion design">
  <div class="motion-stage-inner">
   <h2>EffectCraft n’est pas encore branché</h2>
   <p>Cette zone est réservée au moteur de motion graphics EffectCraft (lui-même en développement). Pour l’instant, aucun moteur de rendu n’est chargé : rien n’est animé ni exporté ici.</p>
   <p>Tu peux déjà préparer ton projet avec l’agent : le chat de droite reste le même, seules les demandes ci-dessous sont orientées motion design.</p>
  </div>
 </div>
 <div id="motion-engine" class="motion-engine" hidden>
  <div class="motion-engine-bar"><span id="motion-engine-status" role="status">EffectCraft : chargement…</span><button type="button" id="motion-engine-reload">Recharger</button></div>
  <div id="motion-engine-frame" class="motion-engine-frame"></div>
 </div>
 <h2 class="motion-section-title">Démarrer une demande à l’agent</h2>
 <div class="motion-starters">
  <button type="button" data-motion-prompt="Je veux animer un titre (apparition, mouvement, sortie). Propose une timeline avec durées, easings et keyframes, puis le code pour la réaliser dans ce projet."><b>Animer un titre</b><small>Timeline, easings et keyframes</small></button>
  <button type="button" data-motion-prompt="Je veux créer une transition entre deux scènes. Propose plusieurs options simples, avec durées et courbes d’animation, puis implémente la meilleure dans ce projet."><b>Créer une transition</b><small>Entre deux scènes ou deux écrans</small></button>
  <button type="button" data-motion-prompt="Aide-moi à découper mon animation en scènes et en calques : liste les éléments, leur ordre d’apparition et la durée totale. N’écris pas de code pour l’instant."><b>Planifier une animation</b><small>Scènes, calques et durées</small></button>
 </div>
 <p class="motion-note">Les demandes sont seulement pré-remplies dans la zone de saisie du chat : rien n’est envoyé sans ton accord. L’agent à droite reste visible pendant que tu travailles dans EffectCraft.</p>
 <div id="motion-consent" class="motion-consent" role="alertdialog" aria-modal="true" aria-labelledby="motion-consent-title" aria-describedby="motion-consent-text" tabindex="-1">
  <div class="motion-consent-card">
   <span class="motion-pill">Ultra bêta</span>
   <h2 id="motion-consent-title">Fonctionnalité expérimentale</h2>
   <p id="motion-consent-text">Le motion design est en ultra bêta. Il peut être instable, incomplet, changer ou être retiré sans préavis. Le moteur EffectCraft (lui-même en alpha) est chargé dans cet onglet depuis un serveur local. Tu peux l’essayer, mais ne compte pas dessus pour un travail important.</p>
   <div class="motion-consent-actions"><button type="button" id="motion-consent-back">Retour au code</button><button type="button" id="motion-consent-ok" class="primary">J’ai compris, continuer</button></div>
  </div>
 </div>`;
$("app").append(motionView);

function isMotionOpen() { return $("app").classList.contains("view-motion"); }

function openMotionDesign() {
    setActivity(null);
    $("app").classList.add("view-motion");
    motionNav.classList.add("active");
    $("motion-consent").classList.remove("hidden-consent");
    setTimeout(() => $("motion-consent-ok").focus(), 0);
}

function closeMotionDesign() {
    if (!isMotionOpen()) return;
    $("app").classList.remove("view-motion");
    motionNav.classList.remove("active");
    setActivity($("app").classList.contains("no-sidebar") ? null : ui.sideView);
}

motionNav.onclick = () => { if (isMotionOpen()) closeMotionDesign(); else openMotionDesign(); };
$("motion-close").onclick = closeMotionDesign;
$("motion-consent-back").onclick = closeMotionDesign;
$("motion-consent-ok").onclick = () => {
    $("motion-consent").classList.add("hidden-consent");
    motionView.querySelector("[data-motion-prompt]")?.focus();
};

/* Les autres boutons de la barre d'activité ferment simplement cet onglet ; leur comportement reste inchangé. */
for (const button of document.querySelectorAll("#activity-bar .activity")) {
    if (button !== motionNav) button.addEventListener("click", closeMotionDesign);
}

motionView.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeMotionDesign(); motionNav.focus(); }
});

for (const button of motionView.querySelectorAll("[data-motion-prompt]")) {
    button.onclick = () => {
        const input = $("input");
        if (!input) return;
        input.value = `[Motion design, expérimental] ${button.dataset.motionPrompt}`;
        input.dispatchEvent(new Event("input", { bubbles: true }));
 input.focus();
    };
}

/* ---------- Moteur EffectCraft : build web officiel hébergé en local, affiché dans une iframe d'une autre origine ---------- */
const motionEngine = { frame: null, loading: false };

function setMotionEngineStatus(text) { $("motion-engine-status").textContent = text; }

function showMotionEngineFallback(message) {
    $("motion-engine").hidden = true;
    const stage = motionView.querySelector(".motion-stage");
    stage.hidden = false;
    stage.querySelector("h2").textContent = "EffectCraft n’est pas encore branché";
    stage.querySelector("p").textContent = message;
}

function unloadMotionEngine() {
    if (motionEngine.frame) { motionEngine.frame.remove(); motionEngine.frame = null; }
    window.frst?.effectCraft?.("stop").catch(() => {});
}

async function loadMotionEngine(force = false) {
    if (motionEngine.loading || (motionEngine.frame && !force)) return;
    if (!window.frst?.effectCraft) { showMotionEngineFallback("Le pont EffectCraft n’est pas disponible dans cette fenêtre."); return; }
    motionEngine.loading = true;
    try {
        if (motionEngine.frame) { motionEngine.frame.remove(); motionEngine.frame = null; }
        const info = await window.frst.effectCraft("start");
        const url = new URL(info.url);
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Adresse EffectCraft inattendue.");
 url.search = "?nosw";
        $("motion-engine").hidden = false;
        motionView.querySelector(".motion-stage").hidden = true;
 setMotionEngineStatus(`EffectCraft ${info.version || ""} · chargement du moteur (≈ 63 Mo)…`);
 const frame = document.createElement("iframe");
        frame.className = "motion-engine-iframe";
 frame.title = "EffectCraft (motion design, ultra bêta)";
        frame.setAttribute("allow", "fullscreen; clipboard-read; clipboard-write");
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads");
 frame.setAttribute("referrerpolicy", "no-referrer");
        frame.addEventListener("load", () => setMotionEngineStatus(`EffectCraft ${info.version || ""} · page chargée (ultra bêta)`));
        frame.src = url.toString();
        $("motion-engine-frame").replaceChildren(frame);
 motionEngine.frame = frame;
    } catch (error) {
        showMotionEngineFallback(String(error?.message || error));
    } finally {
        motionEngine.loading = false;
    }
}

$("motion-engine-reload").onclick = () => loadMotionEngine(true);
$("motion-consent-ok").addEventListener("click", () => loadMotionEngine());
motionNav.addEventListener("click", () => { if (!isMotionOpen()) unloadMotionEngine(); });
$("motion-close").addEventListener("click", unloadMotionEngine);
$("motion-consent-back").addEventListener("click", unloadMotionEngine);

/* ---------- Chat de l'agent : même principe, simplement adapté au motion design tant que l'onglet est ouvert ---------- */
const motionChat = { placeholder: null, badge: null };

function syncMotionChat() {
    const input = $("input");
    const bar = document.querySelector("#agent .agent-context-bar");
    if (!input || !bar) return;
    if (!motionChat.badge) {
        const badge = document.createElement("span");
        badge.id = "agent-motion-badge";
        badge.className = "agent-motion-badge";
 badge.hidden = true;
        badge.textContent = "Motion design · bêta";
 badge.title = "Le chat fonctionne comme d’habitude ; les suggestions et la saisie sont orientées motion design.";
 bar.insertBefore(badge, bar.querySelector("#agent-access"));
        motionChat.badge = badge;
    }
    const open = isMotionOpen();
    motionChat.badge.hidden = !open;
    if (open) {
 if (motionChat.placeholder === null) motionChat.placeholder = input.placeholder;
        input.placeholder = "Décris ton animation (titre, transition, scènes, durées…) · / pour les commandes";
    } else if (motionChat.placeholder !== null) {
        input.placeholder = motionChat.placeholder;
 motionChat.placeholder = null;
    }
}

new MutationObserver(syncMotionChat).observe($("app"), { attributes: true, attributeFilter: ["class"] });
syncMotionChat();