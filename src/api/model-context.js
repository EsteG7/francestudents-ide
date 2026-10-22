"use strict";

// Provider documentation checked 2026-10-22. Service metadata takes precedence.
const OPENAI = "https://developers.openai.com/api/docs/models/";
const CLAUDE = "https://platform.claude.com/docs/en/build-with-claude/context-windows";
const GOOGLE = "https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview";
const SPECS = {};
for (const model of ["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"]) {
    SPECS[model] = { contextWindowTokens: 1050000, maxOutputTokens: 128000, source: OPENAI + model };
}
for (const model of ["claude-sonnet-5", "claude-opus-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]) {
    SPECS[model] = { contextWindowTokens: 1000000, maxOutputTokens: 128000, source: CLAUDE };
}
SPECS["claude-haiku-4-5"] = { contextWindowTokens: 200000, maxOutputTokens: 64000, source: "https://platform.claude.com/docs/en/models/haiku-4-5/overview" };
SPECS["gemini-3.1-pro-preview"] = { contextWindowTokens: 1048576, maxOutputTokens: 65536, source: GOOGLE };
SPECS["gemini-3.8-flash"] = { contextWindowTokens: 1048576, maxOutputTokens: 65536, source: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash" };

// Explicit service aliases, not guesses based on provider or model family.
const ALIASES = { "gemini-pro-agent": "gemini-3.1-pro-preview", "gemini-3.8-flash-tiered": "gemini-3.8-flash" };
const OBSERVED_IDS = {
    51: "claude-haiku-4-5", 63: "claude-sonnet-5", 102: "claude-opus-5",
    66: "gpt-5.6-terra", 65: "gpt-5.6-luna", 64: "gpt-5.6-sol",
    "-1001": "gpt-6-sol", "-1002": "gpt-6-luna", "-1003": "gpt-6.1-sol",
    "-2001": "claude-opus-5-5", "-2002": "claude-haiku-5-5", "-2003": "claude-sonnet-5-5", "-2004": "claude-fable-5-1",
    "-3001": "gemini-pro-agent", "-3002": "gemini-3.8-flash-tiered"
};
function tokenLimit(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isSafeInteger(number) && number >= 1024 && number <= 100000000) return number;
    }
    return null;
}
function modelContext(agent) {
    const model = String(agent?.model || agent?.name || "").toLowerCase().trim().replace(/\s+/g, "-");
    const canonical = ALIASES[model] || model;
    const spec = SPECS[canonical];
    const contextWindowTokens = tokenLimit(agent?.contextWindowTokens, agent?.contextWindow, agent?.context_window, agent?.context_window_tokens,
        agent?.contextLength, agent?.context_length, agent?.maxContextTokens, agent?.inputTokenLimit, agent?.maxInputTokens, agent?.max_input_tokens);
    return {
        model: canonical,
        contextWindowTokens: contextWindowTokens ?? spec?.contextWindowTokens ?? null,
        maxOutputTokens: tokenLimit(agent?.maxOutputTokens, agent?.max_output_tokens, agent?.maxCompletionTokens, agent?.outputTokenLimit) ?? spec?.maxOutputTokens ?? null,
        source: contextWindowTokens ? "service" : spec?.source ?? "unknown"
    };
}
module.exports = { modelContext, OBSERVED_IDS };
