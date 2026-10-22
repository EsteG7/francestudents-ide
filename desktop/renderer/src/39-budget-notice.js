/* ---------- Budget de chat épuisé : message lisible (HTTP 429) ---------- */

const BUDGET_TIME_ZONE = "Europe/Paris";

/** Détecte une erreur « Chat budget exhausted » et en extrait l'heure de reprise (UTC). */
function parseBudgetNotice(text) {
    const raw = String(text ?? "");
    if (!/budget\s+(?:de\s+chat\s+)?(?:exhausted|épuisé)/i.test(raw)) return null;
    const match = /Reset at\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z/i.exec(raw);
    const resetAt = match ? new Date(`${match[1]}Z`) : null;
    return { resetAt: resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt : null };
}

function budgetDayKey(date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: BUDGET_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function budgetRemainingLabel(ms) {
    const minutes = Math.ceil(ms / 60000);
    if (minutes <= 1) return "dans moins d'une minute";
    if (minutes < 60) return `dans ${minutes} min`;
    return `dans ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Textes affichés (heure de Paris). `now` est injectable pour les tests. */
function formatBudgetNotice(notice, now = new Date()) {
    const title = "Budget de chat épuisé";
    const at = notice && notice.resetAt;
    if (!at) {
        return { title, detail: "Le quota de conversation est atteint. Tu pourras reprendre dès qu'il sera renouvelé.", when: "", remaining: "" };
    }
    // Le renouvellement tombe à hh:59:59.999 : on affiche la minute pleine suivante.
    const shown = new Date(Math.ceil(at.getTime() / 60000) * 60000);
    const clock = new Intl.DateTimeFormat("fr-FR", { timeZone: BUDGET_TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(shown);
    const ms = at.getTime() - now.getTime();
    if (ms <= 0) {
        return { title, detail: "Le budget a dû être renouvelé : tu peux réessayer maintenant.", when: clock, remaining: "" };
    }
    const days = Math.round((Date.parse(`${budgetDayKey(shown)}T00:00:00Z`) - Date.parse(`${budgetDayKey(now)}T00:00:00Z`)) / 86400000);
    let day;
    if (days <= 0) day = "aujourd'hui";
    else if (days === 1) day = "demain";
    else day = `le ${new Intl.DateTimeFormat("fr-FR", { timeZone: BUDGET_TIME_ZONE, weekday: "long", day: "numeric", month: "long" }).format(shown)}`;
    return {
        title,
        detail: `Les échanges avec l'agent reprendront ${day} à ${clock} (heure de Paris).`,
        when: `${day} · ${clock}`,
        remaining: budgetRemainingLabel(ms)
    };
}

/** Carte intégrée au transcript, à la place du JSON brut. */
function renderBudgetEntry(notice, rawText) {
    const f = formatBudgetNotice(notice);
    const chips = [
        f.when ? `<span class="budget-chip"><b>Reprise</b> ${escapeHtml(f.when)}</span>` : "",
        f.remaining ? `<span class="budget-chip"><b>Dans</b> ${escapeHtml(f.remaining.replace(/^dans\s+/, ""))}</span>` : ""
    ].join("");
    const icon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    const el = addEntry("budget-notice",
        `<div class="budget-icon" aria-hidden="true">${icon}</div>` +
        `<div class="budget-body"><div class="budget-title">${escapeHtml(f.title)}</div>` +
        `<div class="budget-detail">${escapeHtml(f.detail)}</div>` +
        (chips ? `<div class="budget-chips">${chips}</div>` : "") +
        `<details class="budget-tech"><summary>Détails techniques</summary><pre>${escapeHtml(String(rawText ?? ""))}</pre></details></div>`);
    el.setAttribute("role", "status");
    return el;
}