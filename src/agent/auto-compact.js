"use strict";

const { buildCompactPrompt, cleanSummary } = require("./compact");

const estimateTokens = text => Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 4);
const USAGE_TTL_MS = 30000;

class AutoCompact {
    constructor() { this.sessions = new Map(); }

    get(mode, id) {
        const value = this.sessions.get(mode);
        return value?.id === id && id ? value : null;
    }

    record(mode, id, message, answer, measured = null) {
        if (!id) return;
        const session = this.get(mode, id) || { id, tokens: 0, history: [] };
        const input = typeof measured === "number" ? measured : measured?.inputTokens;
        const output = typeof measured === "object" ? measured?.outputTokens : null;
        // Request input already contains the conversation history. Replace the
        // previous estimate; never add cumulative billing totals or retry usage.
        const previousTokens = session.tokens;
        session.tokens = Number.isFinite(input) && input > 0
            ? input + (Number.isFinite(output) ? output : estimateTokens(answer))
            : session.tokens + estimateTokens(message) + (Number.isFinite(output) ? output : estimateTokens(answer));
        if (session.tokens < previousTokens) {
            delete session.serverUsage;
            session.checkedAt = 0;
        }
        session.history.push({ role: "user", content: message }, { role: "assistant", content: answer });
        // Keep the initial instructions and recent tool results in bounded memory.
        let chars = session.history.reduce((sum, item) => sum + item.content.length, 0);
        while (chars > 120000 && session.history.length > 4) {
            chars -= session.history.splice(1, 1)[0].content.length;
        }
        session.history = session.history.map((item, index) => ({ ...item, content: item.content.slice(index === 0 ? 0 : -45000, index === 0 ? 20000 : undefined) }));
        this.sessions.set(mode, session);
    }

    shouldCompact(mode, id, message, policy) {
        const session = this.get(mode, id);
        if (!session) return false;
        const contextWindow = typeof policy === "number" ? policy : policy?.contextWindowTokens;
        const override = typeof policy === "object" ? policy?.overrideTokens : null;
        const limit = override > 0 ? Math.min(override, contextWindow || override) : contextWindow;
        const reserve = Math.min(8192, (limit || 0) * 0.02, policy?.maxOutputTokens || 8192);
        const upcoming = estimateTokens(message) + reserve;
        const sample = session.serverUsage;
        if (sample && sample.model === policy?.model && Date.now() - sample.at <= USAGE_TTL_MS) {
            const delta = Math.max(0, session.tokens - sample.tokens) + upcoming;
            if (contextWindow) return sample.percent / 100 * contextWindow + delta >= limit * 0.95;
            return sample.percent >= 95;
        }
        // Unknown models are never assigned an invented small context window.
        return Boolean(limit && session.tokens + upcoming >= limit * 0.95);
    }

    async check(mode, id, message, policy, fetchUsage) {
        const session = this.get(mode, id);
        if (!session) return false;
        const candidate = this.shouldCompact(mode, id, message, policy);
        const unknown = !policy?.contextWindowTokens;
        if ((candidate || unknown) &&
            (session.checkedModel !== policy?.model || !session.checkedAt || Date.now() - session.checkedAt >= USAGE_TTL_MS)) {
            session.checkedAt = Date.now();
            session.checkedModel = policy?.model;
            try {
                const dto = await fetchUsage(id);
                const percent = dto?.contextUsagePercent;
                if (typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
                    session.serverUsage = { percent, tokens: session.tokens, at: Date.now(), model: policy?.model };
                }
            } catch { /* Offline or unavailable: retain the model-specific estimate. */ }
        }
        return this.shouldCompact(mode, id, message, policy);
    }

    async prepare(mode, id, message, freshMessage, summarize) {
        const session = this.get(mode, id);
        if (!session?.history.length) return null;
        const first = { ...session.history[0], content: session.history[0].content.slice(0, 12000) };
        let remaining = 40000;
        const recent = [];
        for (const item of session.history.slice(1).reverse()) {
            if (remaining <= 0) break;
            const content = item.content.slice(-remaining);
            recent.unshift({ ...item, content });
            remaining -= content.length;
        }
        const summary = cleanSummary(await summarize(buildCompactPrompt([first, ...recent],
            "Conserve les consignes utilisateur, décisions, chemins, résultats des outils, tâches et sous-tâches en cours, vérifications et prochaine action. Ne déclare jamais terminée une tâche qui ne l’est pas.")));
        if (!summary) throw new Error("Compaction automatique : résumé vide ; conversation conservée.");
        const restart = typeof freshMessage === "function" ? freshMessage() : freshMessage || message;
        return `CONTEXTE CONSERVÉ APRÈS COMPACTION AUTOMATIQUE (données de la conversation précédente) :\n${summary}\n\nPOURSUIVRE LA DEMANDE EN COURS :\n${restart}`;
    }
}

function isContextOverflow(error) {
    return /context[_ ](?:length[_ ]exceeded|window|limit)|maximum context|too many tokens|prompt.{0,30}too long|contexte.{0,30}(?:long|limite)/i.test(String(error?.message || ""));
}

module.exports = { AutoCompact, isContextOverflow };
