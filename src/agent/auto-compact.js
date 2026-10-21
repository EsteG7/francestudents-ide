"use strict";

const { buildCompactPrompt, cleanSummary } = require("./compact");

// The service does not advertise model windows. Use a conservative configurable
// budget, and also recover from explicit context overflow responses.
class AutoCompact {
    constructor() { this.sessions = new Map(); }

    get(mode, id) {
        const value = this.sessions.get(mode);
        return value?.id === id && id ? value : null;
    }

    record(mode, id, message, answer, inputTokens = 0) {
        if (!id) return;
        const session = this.get(mode, id) || { id, tokens: 0, history: [] };
        session.tokens = Math.max(session.tokens + Math.ceil(message.length / 3), inputTokens) + Math.ceil(answer.length / 3);
        session.history.push({ role: "user", content: message }, { role: "assistant", content: answer });
        // Keep the initial instructions and recent tool results in bounded memory.
        let chars = session.history.reduce((sum, item) => sum + item.content.length, 0);
        while (chars > 120000 && session.history.length > 4) {
            chars -= session.history.splice(1, 1)[0].content.length;
        }
        session.history = session.history.map((item, index) => ({ ...item, content: item.content.slice(index === 0 ? 0 : -45000, index === 0 ? 20000 : undefined) }));
        this.sessions.set(mode, session);
    }

    shouldCompact(mode, id, message, limit) {
        const session = this.get(mode, id);
        return Boolean(session && session.tokens + Math.ceil(message.length / 3) >= limit * 0.8);
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
