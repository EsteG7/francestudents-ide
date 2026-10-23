/* ---------- Quota du compte et compteurs de cette session ---------- */
function usagePercent(value) {
    return value != null && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
}
function usageTone(value) { return value >= 90 ? "critical" : value >= 75 ? "warning" : "normal"; }
function usageDate(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Non communiquée";
}
function usageNumber(value) { return Math.max(0, Number(value) || 0).toLocaleString("fr-FR"); }
function usageProgress(value, label, className = "usage-progress") {
    const bounded = Math.min(100, value ?? 0);
    return `<span class="${className} ${usageTone(value)}${value == null ? " unknown" : ""}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" ${value == null ? 'aria-valuetext="Indisponible"' : `aria-valuenow="${bounded}"`} style="--usage:${bounded}%"><span></span></span>`;
}
function renderUsageMeter() {
    const el = $("st-usage"), quota = ui.quota, percent = usagePercent(quota?.percent);
    const label = percent == null ? "Usage" : `${quota.uncertain ? "≈ " : ""}${percent} %`;
    el.classList.remove("warn", "crit");
    el.innerHTML = usageProgress(percent, "Quota de chat utilisé", "usage-mini-meter") + `<span class="usage-meter-label">${label}</span>`;
    el.title = percent == null ? "Voir la consommation et les compteurs de session" : `${quota.uncertain ? "Environ " : ""}${percent} % du quota de chat utilisé · Cliquer pour les détails`;
    el.setAttribute("aria-label", el.title);
}

function renderUsageDashboard() {
    if ($("agent").dataset.tab !== "usage") return;
    const box = $("usage-dashboard"), quota = ui.quota, usage = ui.status.usage || {};
    const signature = JSON.stringify([quota, usage, ui.quotaLoading, ui.quotaError, ui.quotaUpdatedAt, ui.status.booted, ui.status.ecoMode]);
    if (box.usageSignature === signature) return;
    box.usageSignature = signature;
    const percent = usagePercent(quota?.percent), reported = Number(usage.reported) > 0;
    const total = reported ? Number(usage.inputTokens || 0) + Number(usage.outputTokens || 0) : null;
    const estimate = Math.round(Number(usage.chars || 0) / 3.5);
    const metric = (name, value, detail) => `<div class="usage-metric"><span>${name}</span><strong>${value}</strong><small>${detail}</small></div>`;
    $("usage-refresh").disabled = Boolean(ui.quotaLoading) || !ui.status.booted;
    box.innerHTML = `<div class="usage-quota-card ${usageTone(percent)}">
        <div class="usage-quota-top"><span>Quota de chat</span><span class="usage-badge">${ui.quotaLoading ? "Actualisation…" : quota?.uncertain ? "Estimation serveur" : percent == null ? "Indisponible" : "Compte FranceStudent"}</span></div>
        <div class="usage-quota-main"><div class="usage-ring${percent == null ? " unknown" : ""}" style="--usage:${Math.min(100, percent ?? 0)}%" role="img" aria-label="${percent == null ? "Quota inconnu" : percent + " % utilisés"}"><strong>${percent == null ? "—" : (quota?.uncertain ? "≈ " : "") + percent + "<small>%</small>"}</strong></div><div><b>${percent == null ? "Quota indisponible" : usageNumber(Math.max(0, 100 - percent)) + " % disponibles"}</b><p>${percent == null ? "Les compteurs de session restent accessibles." : "de votre budget de chat"}</p>${quota?.powerUp ? '<span class="usage-badge">Power-up actif</span>' : ""}</div></div>
        <div class="usage-reset"><span>Réinitialisation</span><b>${escapeHtml(usageDate(quota?.resetAt))}</b></div></div>
        ${ui.quotaError ? `<p class="usage-notice" role="status">${escapeHtml(ui.quotaError)}</p>` : !ui.status.booted ? '<p class="usage-notice">Connecte-toi pour consulter le quota du compte.</p>' : ""}
        <div class="usage-section-title"><h3>Cette session</h3><span>${ui.status.ecoMode ? "Mode Éco activé" : "Depuis l’ouverture"}</span></div>
        <div class="usage-metrics">${metric("Requêtes IA", usageNumber(usage.requests), "Relances comprises")}${metric(reported ? "Tokens comptabilisés" : "Tokens estimés", reported ? usageNumber(total) : estimate ? "≈ " + usageNumber(estimate) : "—", reported ? "Données reçues du service" : "Estimation du texte envoyé")}${metric("Entrée", reported ? usageNumber(usage.inputTokens) : "—", "Tokens envoyés au modèle")}${metric("Sortie", reported ? usageNumber(usage.outputTokens) : "—", "Tokens générés")}</div>
        ${reported ? `<p class="usage-cache">${usageNumber(usage.cachedTokens)} tokens en cache, déjà inclus dans l’entrée. Les compteurs couvrent les réponses qui transmettent un relevé.</p>` : '<p class="usage-cache">Sans relevé de tokens du service, l’estimation ne couvre pas les images, les réponses ni tout l’historique serveur.</p>'}
        <p class="usage-updated">${ui.quotaUpdatedAt ? "Quota actualisé le " + escapeHtml(usageDate(ui.quotaUpdatedAt)) : "Le quota ne peut pas être déduit du nombre de tokens de cette session."}</p>`;
    if(percent>=100)mountQuotaRecovery(box,quota?.resetAt);
}
$("usage-refresh").onclick = () => refreshQuota();
