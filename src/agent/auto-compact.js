"use strict";

const { buildCompactPrompt, cleanSummary } = require("./compact");

const estimateTokens = text => Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 4);
const USAGE_TTL_MS = 30000;

class AutoCompact {
    constructor() { this.sessions = new Map(); }

    get(mode, id) {
        return id ? this.sessions.get(JSON.stringify([mode,id])) || null : null;
    }

    store(mode,session){
        this.sessions.set(JSON.stringify([mode,session.id]),session);
        while(this.sessions.size>20)this.sessions.delete(this.sessions.keys().next().value);
    }

    restore(mode,id,history=[],force=false){
        if(!id || this.get(mode,id))return;
        const items=history.filter(item=>["user","assistant"].includes(item.role) && typeof item.content==="string");
        if(!items.length && !force)return;
        const session={id,tokens:0,history:[],restored:true,turns:0};
        // A resumed server conversation may be much longer than local history.
        this.store(mode,session);
        for(let i=0;i<items.length;i+=2)this.record(mode,id,items[i].content,items[i+1]?.content || "");
        if(!session.history.length)session.history.push({role:"user",content:"Conversation rouverte : poursuivre la demande utilisateur en conservant les décisions existantes."});
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
        session.turns=(session.turns || 0)+1;
        // Keep the initial instructions and recent tool results in bounded memory.
        let chars = session.history.reduce((sum, item) => sum + item.content.length, 0);
        while (chars > 120000 && session.history.length > 4) {
            chars -= session.history.splice(1, 1)[0].content.length;
        }
        session.history = session.history.map((item, index) => ({ ...item, content: index===0 && item.content.length>20000 ? item.content.slice(0,10000)+"\n[…]\n"+item.content.slice(-10000) : item.content.slice(-45000) }));
        this.store(mode,session);
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
        if ((candidate || unknown || session.restored || session.turns>=4) &&
            (session.checkedModel !== policy?.model || !session.checkedAt || session.tokens-(session.checkedTokens || 0)>=8192 || Date.now() - session.checkedAt >= USAGE_TTL_MS)) {
            session.checkedAt = Date.now();
            session.checkedTokens = session.tokens;
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
        const first = { ...session.history[0] };
        let remaining = 40000;
        const recent = [];
        for (const item of session.history.slice(1).reverse()) {
            if (remaining <= 0) break;
            const content = item.content.slice(-remaining);
            recent.unshift({ ...item, content });
            remaining -= content.length;
        }
        let summary;
        try{summary=cleanSummary(await summarize(buildCompactPrompt([first, ...recent],
            "Conserve les consignes utilisateur, décisions, chemins, résultats des outils, tâches et sous-tâches en cours, vérifications, descriptions visuelles initiales et prochaine action. Ne déclare jamais terminée une tâche qui ne l’est pas.")),12000);}
        catch(error){if(error.cancelled)throw error;summary="Résumé automatique indisponible. Extraits conservés sans les déclarer complets :\n"+first.content.slice(0,3000)+"\n"+first.content.slice(-4000)+"\n"+recent.map(item=>`${item.role}: ${item.content}`).join("\n").slice(-12000);}
        if (!summary) throw new Error("Compaction automatique : résumé vide ; conversation conservée.");
        const restart = typeof freshMessage === "function" ? freshMessage() : freshMessage || message;
        return `CONTEXTE CONSERVÉ APRÈS COMPACTION AUTOMATIQUE (données de la conversation précédente) :\n${summary}\n\nPOURSUIVRE LA DEMANDE EN COURS :\n${restart}`;
    }
}

function isContextOverflow(error) {
    return /\bmaximum[\s_-]+tokens?[\s_-]+limit\b|context[_ ](?:length[_ ]exceeded|window|limit)|maximum context|too many tokens|(?:prompt|input|conversation).{0,40}(?:too long|token.{0,20}limit)|exceed.{0,40}(?:context|token.{0,15}limit)|contexte.{0,30}(?:long|limite)/i.test(String(error?.message ?? error ?? ""));
}

module.exports = { AutoCompact, isContextOverflow };
