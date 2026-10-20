"use strict";

const { CONFIG } = require("../config");
const { auth, getAccessToken } = require("./auth");

const fmt = n => Number(n || 0).toLocaleString("fr-FR");
const pct = n => `${(Math.round(Number(n || 0) * 10) / 10).toLocaleString("fr-FR")} %`;
const when = iso => (iso ? String(iso).slice(0, 16).replace("T", " ") : "?");

/** GET JSON authentifié sur l'API (un seul nouvel essai après renouvellement du token sur 401). */
async function getJson(path, retried = false) {
    const token = await getAccessToken(retried);
    const response = await fetch(`${CONFIG.apiUrl}${path}`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": CONFIG.userAgent,
            "francestudent-client-platform": CONFIG.clientPlatform,
            "francestudent-client-version": CONFIG.clientVersion,
            "francestudent-device-id": auth.deviceId,
            Origin: CONFIG.origin,
            Referer: `${CONFIG.origin}/`
        },
        signal: AbortSignal.timeout(15_000)
    });

    if (response.status === 401 && !retried) return getJson(path, true);
    if (!response.ok) {
        const error = new Error(`HTTP ${response.status} sur ${path}`);
        error.status = response.status;
        throw error;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

/** GET /chats/{chatId}/usage -> ChatUsageDto { tokenUsage, contextUsagePercent }. */
const fetchChatUsage = chatId => getJson(`/chats/${encodeURIComponent(chatId)}/usage`);

/** GET /user/usage -> UserUsageDto { rateLimits[], rateLimitPowerUpActive, chatBudget }. */
const fetchUserUsage = () => getJson("/user/usage");

/** Volume de la session locale (compteurs de api.usage). */
function describeSession(usage) {
    if (!usage || !usage.requests) return ["Session : aucune requête envoyée."];
    const tokens = usage.reported > 0
        ? `${fmt(usage.inputTokens)} tokens en entrée` +
          `${usage.cachedTokens > 0 ? ` dont ${fmt(usage.cachedTokens)} en cache` : ""}` +
          `, ${fmt(usage.outputTokens)} en sortie` +
          `${usage.reported < usage.requests ? ` (usage fourni pour ${usage.reported}/${usage.requests} réponse(s))` : ""}`
        : `≈ ${fmt(Math.round(usage.chars / 3.5))} tokens (estimation)`;
    return [`Session : ${usage.requests} requête(s), ${fmt(usage.chars)} caractères envoyés, ${tokens}`];
}

/** ChatUsageDto -> lignes lisibles. */
function describeChatUsage(label, dto) {
    if (!dto) return [`${label} : usage indisponible.`];
    const t = dto.tokenUsage || {};
    return [
        `${label} : ${fmt(t.totalTokenCount)} tokens au total ` +
            `(prompt ${fmt(t.promptTokenCount)}, réponse ${fmt(t.candidatesTokenCount)}, ` +
            `raisonnement ${fmt(t.reasoningTokenCount)}) ; contexte utilisé ${pct(dto.contextUsagePercent)}`
    ];
}

/** UserUsageDto -> lignes lisibles (limites par type et bucket). */
function describeUserUsage(dto) {
    if (!dto) return ["Compte : usage indisponible."];
    const lines = [];
    for (const rl of dto.rateLimits || []) {
        lines.push(
            `Limite ${rl.type ?? "?"}/${rl.bucket ?? "?"} : ${fmt(rl.used)}/${fmt(rl.limit)} ` +
                `(${pct(rl.usedPercent)} utilisés, ${fmt(rl.remaining)} restants), remise à zéro ${when(rl.resetAt)}`
        );
    }
    const budget = dto.chatBudget;
    if (budget && budget.usedPercent != null) {
        lines.unshift(
            `Quota général de chat : ${budget.accountingUncertain ? "≈ " : ""}${pct(budget.usedPercent)} utilisés ` +
                `(${pct(budget.remainingPercent)} restants), remise à zéro ${when(budget.resetAt)}`
        );
    }
    if (!lines.length) lines.push("Compte : aucune limite renvoyée.");
    if (dto.rateLimitPowerUpActive) lines.push("Power-up actif (limites doublées).");
    return lines;
}

/** Limite propre aux images (génération ou envoi), à ne jamais afficher comme quota principal. */
const isImageLimit = l => /image/i.test(`${l.type || ""} ${l.bucket || ""}`);

/** Limite la plus consommée d'une liste (null si vide). */
const mostUsed = list => list.reduce((acc, l) => (!acc || l.usedPercent > acc.usedPercent ? l : acc), null);

/**
 * UserUsageDto -> quota principal à afficher dans la barre d'état du desktop.
 * Priorité : chatBudget (budget général de chat), puis limite de type chat,
 * puis la limite la plus consommée hors images. Les limites image restent dans `limits`.
 */
function summarizeUserQuota(dto) {
    const limits = (Array.isArray(dto && dto.rateLimits) ? dto.rateLimits : []).map(rl => ({
        type: rl.type || null,
        bucket: rl.bucket || null,
        used: Number(rl.used) || 0,
        limit: Number(rl.limit) || 0,
        usedPercent: Number(rl.usedPercent) || 0,
        remaining: Number(rl.remaining) || 0,
        resetAt: rl.resetAt || null
    }));

    let main = null;
    const budget = dto && dto.chatBudget;
    if (budget && budget.usedPercent != null && Number.isFinite(Number(budget.usedPercent))) {
        main = {
            source: "chatBudget",
            bucket: "chat",
            usedPercent: Number(budget.usedPercent),
            resetAt: budget.resetAt || null,
            uncertain: Boolean(budget.accountingUncertain)
        };
    } else {
        const general = limits.filter(l => !isImageLimit(l));
        const pick = mostUsed(general.filter(l => /chat/i.test(`${l.type || ""} ${l.bucket || ""}`))) || mostUsed(general);
        if (pick) {
            main = { source: "rateLimit", bucket: pick.bucket || pick.type || "chat", usedPercent: pick.usedPercent, resetAt: pick.resetAt, uncertain: false };
        }
    }

    return {
        percent: main ? Math.round(main.usedPercent) : null,
        bucket: main ? main.bucket : null,
        source: main ? main.source : null,
        resetAt: main ? main.resetAt : null,
        uncertain: main ? main.uncertain : false,
        powerUp: Boolean(dto && dto.rateLimitPowerUpActive),
        limits
    };
}

module.exports = { getJson, fetchChatUsage, fetchUserUsage, describeSession, describeChatUsage, describeUserUsage, summarizeUserQuota, isImageLimit };
