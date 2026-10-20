"use strict";

const { CONFIG } = require("../config");
const { state } = require("../state");
const { ui } = require("../ui-bridge");
const { auth, getAccessToken } = require("./auth");
const { extractPdfText, isPdf } = require("./pdf-text");

const fmt = n => Number(n).toLocaleString("fr-FR");
const MAX_REQUEST_FAILURES = 2;

// Volume réellement envoyé (chaque tentative HTTP compte, relances comprises).
const usage = { requests: 0, chars: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, reported: 0 };

/** Ajoute à `usage` les tokens réels si l'événement SSE en fournit (format Responses ou Chat Completions). */
function recordTokens(raw) {
    if (!raw || typeof raw !== "object") return;
    const input = Number(raw.input_tokens ?? raw.prompt_tokens);
    const output = Number(raw.output_tokens ?? raw.completion_tokens);
    if (!Number.isFinite(input) && !Number.isFinite(output)) return;
    const cached = Number(
        raw.input_tokens_details?.cached_tokens ??
        raw.prompt_tokens_details?.cached_tokens ??
        raw.cached_tokens
    );
    usage.inputTokens += Number.isFinite(input) ? input : 0;
    usage.outputTokens += Number.isFinite(output) ? output : 0;
    usage.cachedTokens += Number.isFinite(cached) ? cached : 0;
    usage.reported++;
}

async function apiHeaders() {
    const token = await getAccessToken();

    return {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": CONFIG.userAgent,
        "francestudent-client-platform": CONFIG.clientPlatform,
        "francestudent-client-version": CONFIG.clientVersion,
        "francestudent-device-id": auth.deviceId,
        Origin: CONFIG.origin,
        Referer: `${CONFIG.origin}/`
    };
}

/** POST /chats/{chatId}/stream/cancel : arrête la génération côté serveur (idempotent). */
async function cancelStream(chatId) {
    if (!chatId) return false;
    try {
        const response = await fetch(`${CONFIG.apiUrl}/chats/${encodeURIComponent(chatId)}/stream/cancel`, {
            method: "POST",
            headers: { ...(await apiHeaders()), Accept: "application/json" },
            signal: AbortSignal.timeout(10_000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * options.fresh   : true = nouvelle conversation à chaque appel.
 * options.onDelta : callback appelé à chaque morceau de texte.
 * options.freshMessage : message complet (ou fonction qui le construit), envoyé
 *                 à la place de `message` si une nouvelle conversation agent
 *                 est ouverte après un 409 (la nouvelle n'a pas d'historique).
 *
 * Relances (au maximum MAX_REQUEST_FAILURES) : erreurs réseau et 5xx sans
 * délai ; 401 après renouvellement du token ; 408, 409 et 429 après une
 * attente croissante. Les autres 4xx ne sont pas relancés.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /files/upload (Files v1) : envoie une image (data URL base64) et renvoie son uuid. */
async function uploadImage(dataUrl, index) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(String(dataUrl));
    if (!match) throw new Error("Image jointe invalide (data URL base64 attendue).");
    const type = match[1].toLowerCase();
    const ext = (type.split("/")[1] || "png").replace(/[^a-z0-9]/g, "") || "png";
    const bytes = Buffer.from(match[2], "base64");
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), `image-${index + 1}.${ext}`);

    // Content-Type retiré : fetch ajoute lui-même multipart/form-data avec la boundary.
    const headers = await apiHeaders();
    delete headers["Content-Type"];
    headers.Accept = "application/json";

    const response = await fetch(`${CONFIG.apiUrl}/files/upload`, {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(60_000)
    });
    const text = await response.text();
    if (!response.ok) {
        const error = new Error(`Envoi de l'image impossible : HTTP ${response.status}: ${text.slice(0, 500)}`);
        error.status = response.status;
        throw error;
    }
    let data = null;
    try { data = JSON.parse(text); } catch { /* réponse non JSON */ }
    const id = data?.uuid ?? data?.id;
    if (!id) throw new Error("Réponse de /files/upload sans uuid.");
    return String(id);
}

/**
 * Le champ `images` de /chats/stream attend des UUID Files v1, pas des data URL.
 * Envoie les images en attente et remplace state.pendingImages par leurs UUID
 * (une seule fois : les relances réutilisent les UUID).
 */
async function resolvePendingImages() {
    const list = Array.isArray(state.pendingImages) ? state.pendingImages : [];
    if (!list.length) return;
    const ids = [];
    for (let i = 0; i < list.length; i++) {
        const item = String(list[i]);
        ids.push(UUID_RE.test(item) ? item : await uploadImage(item, i));
    }
    state.pendingImages = ids;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * POST /filesv2 (Files v2) : envoie un fichier de n'importe quel type (PDF, Word,
 * Excel, PowerPoint, archive…) fourni en data URL base64 et renvoie son ID.
 */
async function uploadFile(file) {
    const name = String(file?.name || "fichier").replace(/[\r\n"\\/]/g, "_").slice(0, 200) || "fichier";
    const match = /^data:([^;,]*)(?:;[^,]*)?;base64,([\s\S]*)$/i.exec(String(file?.dataUrl ?? ""));
    if (!match) throw new Error(`Fichier joint invalide (${name}) : data URL base64 attendue.`);
    const type = (match[1] || "application/octet-stream").toLowerCase();
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > MAX_FILE_BYTES) {
        throw new Error(`Fichier joint trop lourd (${name} : ${fmt(bytes.length)} octets, max ${fmt(MAX_FILE_BYTES)}).`);
    }
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);

    // Content-Type retiré : fetch ajoute lui-même multipart/form-data avec la boundary.
    const headers = await apiHeaders();
    delete headers["Content-Type"];
    headers.Accept = "application/json";

    const response = await fetch(`${CONFIG.apiUrl}/filesv2`, {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(120_000)
    });
    const text = await response.text();
    if (!response.ok) {
        const toggle = /unleash toggle\. Expected one of: ([\w.,\s-]+)/i.exec(text)?.[1]?.trim();
        const error = response.status === 403 && toggle
            ? new Error(
                `Envoi du fichier ${name} impossible : l'envoi de fichiers (Files v2) n'est pas activé pour ce compte ` +
                `(fonctionnalité serveur « ${toggle} » manquante). Contactez le support FranceStudent pour l'activer, ` +
                `ou collez le texte du document dans le message. (HTTP 403)`
            )
            : new Error(`Envoi du fichier ${name} impossible : HTTP ${response.status}: ${text.slice(0, 500)}`);
        error.status = response.status;
        if (toggle) error.featureToggle = toggle;
        throw error;
    }
    let data = null;
    try { data = JSON.parse(text); } catch { /* réponse non JSON */ }
    const id = data?.id ?? data?.file_id ?? data?.uuid;
    if (!id) throw new Error("Réponse de /filesv2 sans id.");
    return String(id);
}

/**
 * Le champ `files` de /chats/stream attend des ID Files v2. Envoie les fichiers
 * en attente ({ name, dataUrl }) et remplace state.pendingFiles par leurs ID
 * (une seule fois : les relances réutilisent les ID).
 */
async function resolvePendingFiles() {
    const list = Array.isArray(state.pendingFiles) ? state.pendingFiles : [];
    if (!list.length) return "";
    const ids = [];
    const blocks = [];
    for (const item of list) {
        if (typeof item === "string") { ids.push(item); continue; }
        try {
            ids.push(await uploadFile(item));
        } catch (error) {
            // Fichier refusé par le serveur (ex. Files v2 non activé : HTTP 403) :
            // pour un PDF, le texte est extrait localement et ajouté au message.
            const block = pdfTextFallback(item, error);
            if (!block) throw error;
            blocks.push(block);
        }
    }
    state.pendingFiles = ids;
    return blocks.join("\n\n");
}

/**
 * Secours quand /filesv2 refuse un fichier : si c'est un PDF, extrait son texte
 * localement et renvoie un bloc « Fichier joint » à ajouter au message.
 * Renvoie null si ce n'est pas un PDF (l'erreur d'origine est alors conservée).
 */
function pdfTextFallback(item, uploadError) {
    const name = String(item?.name || "document.pdf").replace(/[\r\n]/g, " ").slice(0, 200);
    const match = /^data:([^;,]*)(?:;[^,]*)?;base64,([\s\S]*)$/i.exec(String(item?.dataUrl ?? ""));
    if (!match) return null;
    const bytes = Buffer.from(match[2], "base64");
    if (!isPdf(bytes)) return null;
    let result;
    try {
        result = extractPdfText(bytes);
    } catch (readError) {
        const error = new Error(
            `${uploadError.message}\nLecture locale du PDF ${name} impossible : ${readError.message}. ` +
            "Copiez le texte du document dans le message."
        );
        error.status = uploadError.status;
        throw error;
    }
    const status = uploadError.status ? ` (HTTP ${uploadError.status})` : "";
    ui.warn(
        `${name} : envoi du fichier refusé par le serveur${status}. ` +
        `Texte extrait localement${result.pages ? ` (${result.pages} page(s))` : ""} et ajouté au message.`
    );
    return `--- Fichier joint : ${name} (texte extrait du PDF) ---\n${result.text}\n--- Fin de ${name} ---`;
}

const FILE_TEXT_HEADER = "\n\nCONTENU DES FICHIERS JOINTS (texte extrait localement) :\n";

/** Ajoute au message le texte extrait des fichiers, tronqué pour respecter maxMessageChars. */
function appendFileText(message, fileText) {
    if (!fileText) return message;
    const marker = "\n[… tronqué : limite de taille du message]";
    const room = CONFIG.maxMessageChars - message.length - FILE_TEXT_HEADER.length - marker.length;
    if (room < 1000) {
        throw new Error("Message trop long pour y ajouter le texte du PDF joint : raccourcissez le message.");
    }
    const text = fileText.length > room ? `${fileText.slice(0, room)}${marker}` : fileText;
    return `${message}${FILE_TEXT_HEADER}${text}`;
}

async function requestModel(message, options = {}) {
    if (!options.fresh) {
        await resolvePendingImages();
        message = appendFileText(message, await resolvePendingFiles());
    }

    if (message.length > CONFIG.maxMessageChars) {
        throw new Error(
            `Message trop long : ${fmt(message.length)} caractères ` +
            `(limite ${fmt(CONFIG.maxMessageChars)}).`
        );
    }

    // Politique de relance :
    // - erreurs réseau ou de flux (sans statut) et 5xx : relance immédiate ;
    // - 401 : jeton renouvelé puis relance ;
    // - 408, 409, 429 : relance après un délai croissant (le flux précédent
    //   peut encore être actif côté serveur) ;
    // - autres 4xx : erreur définitive, pas de relance.
    const retryableClientStatuses = new Set([401, 408, 409, 429]);
    const waitDelaysMs = [3000, 8000, 15000];
    let failures = 0;
    let switched = false;

    while (true) {
        try {
            const answer = await requestModelOnce(message, options);
            // Images et fichiers joints : envoyés une seule fois (première réponse réussie).
            if (!options.fresh) {
                state.pendingImages = [];
                state.pendingFiles = [];
            }
            return answer;
        } catch (error) {
            // Annulation volontaire (Ctrl+C) : jamais de relance.
            if (error.cancelled) throw error;

            const status = error.status;
            const isClientError = status >= 400 && status < 500;

            if (isClientError && !retryableClientStatuses.has(status)) {
                throw error;
            }
            // Budget de chat épuisé : inutile de relancer avant la réinitialisation.
            if (status === 429 && /budget exhausted/i.test(String(error.message))) {
                const reset = /Reset at (\S+?Z)/.exec(String(error.message))?.[1];
                const when = reset ? new Date(reset) : null;
                const label = when && !Number.isNaN(when.getTime())
                    ? ` jusqu'au ${when.toLocaleString("fr-FR")}`
                    : "";
                error.message = `Budget de chat épuisé${label}. ${error.message}`;
                throw error;
            }
            if (status === 409 && options.conversationMode === "agent" && !switched) {
                switched = true;
                state.chatIds.agent = null;
                state.chatId = null;
                if (options.freshMessage) {
                    message = typeof options.freshMessage === "function"
                        ? options.freshMessage()
                        : options.freshMessage;
                }
                ui.warn("Un flux est encore actif sur la conversation agent : nouvelle conversation.");
                continue;
            }
            if (failures >= MAX_REQUEST_FAILURES) throw error;

            failures++;
            ui.debug(
                `Requête échouée (${failures}/${MAX_REQUEST_FAILURES})` +
                    `${status ? ` [HTTP ${status}]` : ""} : ${error.message}`,
            );

            if (status === 401) {
                await getAccessToken(true);
            } else if (status === 408 || status === 409 || status === 429) {
                const delay =
                    waitDelaysMs[Math.min(failures, waitDelaysMs.length) - 1];
                ui.debug(`Attente de ${delay / 1000} s avant le nouvel essai`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }

            ui.debug("Nouvel essai de la requête");
        }
    }
}

async function requestModelOnce(message, options) {
    usage.requests++;
    usage.chars += message.length;
    ui.debug(`Requête : ${fmt(message.length)} caractères (~${fmt(Math.round(message.length / 3.5))} tokens)`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    let idle;
    const armIdle = ms => { clearTimeout(idle); idle = setTimeout(() => controller.abort(), ms); };
    armIdle(CONFIG.firstByteTimeoutMs);

    // Ctrl+C : coupe le flux local et demande l'arrêt de la génération côté serveur.
    let streamChatId = options.fresh ? null : state.chatIds[options.conversationMode === "agent" ? "agent" : "chat"];
    let cancelled = false;
    const registerInterrupt = options.onInterrupt ??
        (process.stdin.isTTY || process.env.FS_FORCE_INTERRUPT === "1" ? handler => ui.onInterrupt(handler) : null);
    const offInterrupt = registerInterrupt ? registerInterrupt(() => {
        if (cancelled) return;
        cancelled = true;
        controller.abort();
        if (streamChatId) {
            ui.warn("Ctrl+C : arrêt de la génération en cours.");
            cancelStream(streamChatId).then(ok => {
                if (!ok) ui.debug(`Annulation du flux ${streamChatId} non confirmée par l'API.`);
            });
        }
    }) : null;

    let reader;

    try {
        const conversationMode = options.conversationMode === "agent" ? "agent" : "chat";
        const response = await fetch(`${CONFIG.apiUrl}/chats/stream`, {
            method: "POST",
            headers: await apiHeaders(),
            body: JSON.stringify({
                agentId: state.model,
                chatId: options.fresh ? null : state.chatIds[conversationMode],
                enableCanvas: false,
                enableWebSearch: options.fresh ? false : state.webSearch,
                images: !options.fresh && Array.isArray(state.pendingImages) ? state.pendingImages : [],
                files: !options.fresh && Array.isArray(state.pendingFiles) ? state.pendingFiles : [],
                initialContent: message,
                isIncognito: state.incognito,
                isPrivate: state.private,
                ...(state.frProject?.id && !options.fresh && !state.chatIds[conversationMode]
                    ? { projectId: state.frProject.id }
                    : {})
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const text = await response.text();
            const error = new Error(`HTTP ${response.status}: ${text.slice(0, 1200)}`);

            error.status = response.status;
            throw error;
        }

        if (!response.body) {
            throw new Error("L'API n'a pas fourni de flux SSE.");
        }

        reader = response.body.getReader();

        const decoder = new TextDecoder();

        let buffer = "";
        let eventName = "";
        let eventData = [];
        let output = "";
        let completed = false;
        let streamError = null;

        function appendText(text) {
            if (typeof text !== "string" || !text) return;
            output += text;
            options.onDelta?.(text);
        }

        function dispatchEvent() {
            const name = eventName;
            const payload = eventData.join("\n");

            eventName = "";
            eventData = [];

            if (!payload) return;

            if (payload === "[DONE]") {
                completed = true;
                return;
            }

            let data;

            try {
                data = JSON.parse(payload);
            } catch {
                throw new Error(`Événement SSE JSON invalide : ${name || "message"}`);
            }

            if (data.chat_id) streamChatId = data.chat_id;

            if (data.chat_id && !options.fresh) {
                state.chatIds[conversationMode] = data.chat_id;
                state.chatId = data.chat_id;
            }

            if (name === "response.completed" || name === "completed") {
                recordTokens(data.response?.usage ?? data.usage ?? data.message?.usage);
            }

            switch (name) {
                case "response.output_text.delta":
                    appendText(data.delta);
                    break;

                case "response.output_text.done":
                    if (!output) appendText(data.text);
                    break;

                case "response.failed":
                case "error":
                    streamError = data;
                    completed = true;
                    break;

                case "response.completed":
                    if (data.response?.error) {
                        streamError = data.response.error;
                        completed = true;
                    }
                    break;

                case "completed":
                    if (!output && typeof data.message?.content === "string") {
                        appendText(data.message.content);
                    }
                    completed = true;
                    break;

                default:
                    break;
            }
        }

        function parseLine(line) {
            if (line === "") {
                dispatchEvent();
                return;
            }

            if (line.startsWith(":")) return;

            const colon = line.indexOf(":");
            const field = colon === -1 ? line : line.slice(0, colon);
            let value = colon === -1 ? "" : line.slice(colon + 1);

            if (value.startsWith(" ")) value = value.slice(1);

            if (field === "event") eventName = value;
            else if (field === "data") eventData.push(value);
        }

        function consumeLines(final = false) {
            while (!completed) {
                const index = buffer.search(/[\r\n]/);

                if (index === -1) break;

                const newline = buffer[index];

                // "\r" en fin de buffer : peut-être un "\r\n" coupé en deux.
                if (newline === "\r" && index === buffer.length - 1 && !final) break;

                const separatorLength =
                    newline === "\r" && buffer[index + 1] === "\n" ? 2 : 1;

                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + separatorLength);

                parseLine(line);
            }
        }

        while (!completed) {
            const { done, value } = await reader.read();
            armIdle(CONFIG.idleTimeoutMs);

            if (done) {
                buffer += decoder.decode();
                consumeLines(true);

                if (!completed && buffer) {
                    parseLine(buffer);
                    buffer = "";
                }

                if (!completed) dispatchEvent();

                break;
            }

            buffer += decoder.decode(value, { stream: true });
            consumeLines();
        }

        if (streamError) {
            throw new Error(`Erreur du flux : ${JSON.stringify(streamError)}`);
        }

        if (!output.trim()) {
            throw new Error(
                completed ? "Réponse vide du modèle." : "Flux interrompu sans réponse."
            );
        }

        // Rattache explicitement la conversation au projet FranceStudent sélectionné
        // (le champ projectId de POST /chats/stream ne suffit pas côté site).
        if (!options.fresh && state.frProject?.id && state.chatIds[conversationMode]) {
            await require("./fr-projects").ensureAttached(state.chatIds[conversationMode]);
        }

        return output;
    } catch (error) {
        if (cancelled) {
            const interrupted = new Error("Génération annulée (Ctrl+C).");
            interrupted.cancelled = true;
            throw interrupted;
        }
        throw error;
    } finally {
        offInterrupt?.();
        clearTimeout(timeout);
        clearTimeout(idle);

        if (reader) {
            await reader.cancel().catch(() => {});
            try { reader.releaseLock(); } catch { /* déjà libéré */ }
        }
    }
}

module.exports = { requestModel, cancelStream, MAX_REQUEST_FAILURES, usage, uploadFile, resolvePendingFiles, MAX_FILE_BYTES };
