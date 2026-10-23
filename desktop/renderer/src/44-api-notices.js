/* API failures use readable cards; raw responses stay in collapsed details. */
function parseApiErrorNotice(raw){
    const text=String(raw || ""),match=/(?:HTTP|status(?:Code)?["']?\s*[:=])\s*["']?(\d{3})\b/i.exec(text);
    const status=match?Number(match[1]):null;
    if(!status && !/erreur (?:du flux|API)|\bAPI\b|fetch failed|failed to fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|timeout|timed out|Unsupported tool ignored by the backend|invalid[_ ]api[_ ]key|^\s*\{[\s\S]*"(?:error|message|errorCode)"\s*:/i.test(text))return null;
    let title="La requête n’a pas abouti",detail="Le service a renvoyé une erreur. Ton historique et les modifications déjà effectuées sont conservés.",kind="service";
    if(status===401 || /invalid[_ ]api[_ ]key/i.test(text)){title="Connexion à renouveler";detail="Ta session ou ta clé d’accès n’est plus acceptée. Vérifie la connexion dans les paramètres avant de réessayer.";kind="auth";}
    else if(status===403){title="Accès refusé";detail="Ton compte n’a pas accès à cette ressource ou à ce modèle. Vérifie les autorisations ou choisis un autre modèle.";kind="auth";}
    else if(status===429){title="Trop de requêtes à la fois";detail="Le service limite temporairement les demandes. Patiente avant de réessayer ; ce message ne signifie pas forcément que ton quota est épuisé.";kind="wait";}
    else if(status===413 || /image.{0,50}(?:dimension|too large)|file.{0,30}too large/i.test(text)){title="Pièce jointe trop volumineuse";detail="Le service refuse la taille du contenu envoyé. Réduis les pièces jointes ou utilise une capture plus ciblée.";kind="attachment";}
    else if(status===404){title="Ressource introuvable";detail="La conversation, le modèle ou la ressource demandée n’est plus disponible. Vérifie la ressource avant de réessayer.";}
    else if(status===408 || status===504 || /timeout|timed out|ETIMEDOUT/i.test(text)){title="Le service met trop de temps";detail="Le délai de réponse est dépassé. Vérifie la connexion puis réessaie quand le service répond à nouveau.";kind="wait";}
    else if(status>=500){title="Service momentanément indisponible";detail="Le serveur rencontre un problème. Ton travail local est conservé ; réessaie dans quelques instants.";}
    else if(/fetch failed|failed to fetch|network|ECONN|ENOTFOUND/i.test(text)){title="Connexion au service interrompue";detail="Impossible de joindre le service. Vérifie ta connexion Internet, puis réessaie.";kind="network";}
    else if(status===400 || status===422){title="Demande refusée par le service";detail="Le service n’accepte pas le contenu ou les options de cette demande. Vérifie le modèle et les pièces jointes.";}
    return {title,detail,kind,status};
}
function apiNoticeIcon(kind){
    if(kind==="trash")return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>';
    if(kind==="spark")return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></svg>';
    if(kind==="chat")return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg>';
    if(kind==="tools")return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/></svg>';
    const paths={auth:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',wait:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',network:'<path d="m3 3 18 18M2 8a17 17 0 0 1 4-2m4-1a17 17 0 0 1 12 3M5 12a12 12 0 0 1 5-2m4 0a12 12 0 0 1 5 2M8 16a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>',attachment:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m4 16 5-5 4 4 3-3 4 4"/>',service:'<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6h1m-1 11h1m7-2v3m0 2h.01"/>'};
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || paths.service}</svg>`;
}
function renderApiErrorEntry(info,raw){
    const entry=addEntry("api-error-notice","");entry.setAttribute("role","status");
    const icon=centerNode("span","api-notice-icon");icon.innerHTML=apiNoticeIcon(info.kind);
    const body=centerNode("div","api-notice-body");body.append(centerNode("strong","",info.title),centerNode("p","",info.detail));
    const actions=centerNode("div","api-notice-actions");
    const settings=centerNode("button","",info.kind==="auth"?"Vérifier ma connexion":"Voir l’usage");settings.type="button";
    settings.onclick=()=>{if(info.kind==="auth")showSideView("settings");else setAgentTab("usage");};actions.append(settings);body.append(actions);
    const details=centerNode("details","api-notice-tech");details.append(centerNode("summary","",info.status?`Détails techniques · HTTP ${info.status}`:"Détails techniques"),centerNode("pre","",String(raw || "")));body.append(details);entry.append(icon,body);scrollDown();return entry;
}

const quotaRecoveryState=new WeakMap();
const quotaCheckedDeadlines=new Set();
function quotaCountdown(resetAt,now=Date.now()){
    const end=new Date(resetAt).getTime();
    if(!resetAt || !Number.isFinite(end))return "Heure de réinitialisation non communiquée";
    const minutes=Math.max(0,Math.ceil((end-now)/60000));
    if(!minutes)return "Échéance atteinte · vérification du quota nécessaire";
    return `Réinitialisation dans ${Math.floor(minutes/60)} h ${String(minutes%60).padStart(2,"0")} min`;
}
function mountQuotaRecovery(parent,resetAt){
    const box=centerNode("div","quota-recovery");
    const timer=centerNode("strong","quota-countdown");
    const note=centerNode("p","quota-recovery-note","Le quota est revérifié toutes les 15 minutes. Si le staff t’a accordé un reset, vérifie-le ici.");
    const button=centerNode("button","quota-reset-check","J’ai reçu un reset");button.type="button";
    const feedback=centerNode("p","quota-reset-feedback");feedback.setAttribute("role","status");
    const originalBudget=parent.closest(".budget-notice");
    quotaRecoveryState.set(box,{resetAt,checkedAt:ui.quotaUpdatedAt || null,budgetTitle:originalBudget?.querySelector(".budget-title")?.textContent,budgetDetail:originalBudget?.querySelector(".budget-detail")?.textContent});
    button.onclick=async()=>{
        if(ui.quotaLoading){feedback.textContent="Vérification du quota déjà en cours…";return;}
        button.disabled=true;button.textContent="Vérification…";
        await refreshQuota();
        const recovered=ui.quota?.percent!=null && Number(ui.quota.percent)<100;
        const target=box.isConnected?feedback:document.querySelector("#usage-dashboard .quota-reset-feedback");
        if(target)target.textContent=ui.quotaError?"Vérification indisponible. Réessaie dans quelques instants.":recovered?"Quota disponible. Tu peux envoyer une nouvelle demande.":"Le reset n’est pas encore confirmé par l’API.";
        button.disabled=false;button.textContent="J’ai reçu un reset";
    };
    box.append(timer,note,button,feedback);parent.append(box);updateQuotaRecoveryBox(box);if(box.closest("#transcript"))scrollDown();return box;
}
function updateQuotaRecoveryBox(box){
    const state=quotaRecoveryState.get(box);if(!state)return;
    const resetAt=ui.quota?.resetAt || state.resetAt;
    const checked=ui.quotaUpdatedAt && ui.quotaUpdatedAt!==state.checkedAt;
    if(checked){state.checkedAt=ui.quotaUpdatedAt;state.available=ui.quota?.percent!=null && Number(ui.quota.percent)<100 && !ui.quotaError;}
    if(ui.quotaError || !ui.status.booted)state.available=false;
    box.querySelector(".quota-countdown").textContent=state.available?"Quota disponible · tu peux reprendre":quotaCountdown(resetAt);
    box.classList.toggle("quota-recovered",!!state.available);
    const budget=box.closest(".budget-notice");
    if(budget){budget.querySelector(".budget-title").textContent=state.available?"Quota de chat disponible":state.budgetTitle;budget.querySelector(".budget-detail").textContent=state.available?"Le renouvellement est confirmé par l’API. Tu peux envoyer une nouvelle demande.":state.budgetDetail;if(state.available)budget.querySelector(".budget-chips")?.remove();}
    const end=new Date(resetAt).getTime();
    if(!state.available && resetAt && Number.isFinite(end) && end<=Date.now() && !quotaCheckedDeadlines.has(end) && ui.status.booted && !ui.quotaLoading){
        quotaCheckedDeadlines.add(end);if(quotaCheckedDeadlines.size>50)quotaCheckedDeadlines.delete(quotaCheckedDeadlines.values().next().value);void refreshQuota();
    }
}
function updateQuotaRecoveryCards(){for(const box of document.querySelectorAll(".quota-recovery"))updateQuotaRecoveryBox(box);}
setInterval(updateQuotaRecoveryCards,30000);
