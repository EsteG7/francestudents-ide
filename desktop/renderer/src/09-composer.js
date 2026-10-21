/* ---------- Saisie de l'agent ---------- */

/* ---------- Pièces jointes (fichiers / images) ---------- */

const MAX_ATTACHMENTS = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
let pendingAttachments = [];

/* Extensions binaires connues -> type MIME (utilisé si le navigateur n'en fournit pas). */
const BINARY_TYPES = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    dot: "application/msword",
    dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
    rtf: "application/rtf",
    epub: "application/epub+zip",
    pages: "application/vnd.apple.pages",
    numbers: "application/vnd.apple.numbers",
    key: "application/vnd.apple.keynote",
    zip: "application/zip",
    gz: "application/gzip",
    tgz: "application/gzip",
    tar: "application/x-tar",
    "7z": "application/x-7z-compressed",
    rar: "application/vnd.rar",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    mov: "video/quicktime",
    heic: "image/heic",
    psd: "image/vnd.adobe.photoshop"
};

function fileExtension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    return match ? match[1].toLowerCase() : "";
}

/** true pour les PDF, documents Office, archives, médias… (à ne pas lire comme du texte). */
function isBinaryFile(file, name) {
    if (Object.prototype.hasOwnProperty.call(BINARY_TYPES, fileExtension(name))) return true;
    const type = String(file.type || "").toLowerCase();
    if (!type || type.startsWith("text/")) return false;
    if (/(json|xml|javascript|ecmascript|x-sh|x-python|yaml|toml|sql|csv)/.test(type)) return false;
    return /^(application|audio|video|font|image)\//.test(type);
}

/** Fichier quelconque -> pièce jointe { kind: "file" } en data URL base64 avec un type MIME. */
async function prepareFile(file, name) {
    if (file.size > MAX_FILE_BYTES) {
        throw new Error(`fichier trop lourd (${formatBytes(file.size)}, max ${formatBytes(MAX_FILE_BYTES)})`);
    }
    const mime = file.type || BINARY_TYPES[fileExtension(name)] || "application/octet-stream";
    const raw = await readAsDataUrl(file);
    const base64 = raw.slice(raw.indexOf(",") + 1);
    return { name, kind: "file", size: file.size, mime, data: `data:${mime};base64,${base64}` };
}

/** Icône de puce selon le type de fichier. */
function attachmentIcon(item) {
    const ext = fileExtension(item.name);
    if (ext === "pdf") return "📕";
    if (["doc", "docx", "dot", "dotx", "odt", "rtf", "pages"].includes(ext)) return "📘";
    if (["xls", "xlsx", "xlsm", "ods", "csv", "numbers"].includes(ext)) return "📗";
    if (["ppt", "pptx", "odp", "key"].includes(ext)) return "📙";
    if (["zip", "gz", "tgz", "tar", "7z", "rar"].includes(ext)) return "🗜️";
    if (/^audio\//.test(item.mime || "")) return "🎵";
    if (/^video\//.test(item.mime || "")) return "🎬";
    return item.kind === "file" ? "📎" : "📄";
}

function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error("Lecture impossible."));
        reader.readAsDataURL(file);
    });
}

function renderAttachments() {
    const box = $("attachments");
    box.replaceChildren();
    box.classList.toggle("hidden", pendingAttachments.length === 0);
    pendingAttachments.forEach((item, index) => {
        const chip = document.createElement("span");
        chip.className = "attachment-chip";
        const kindLabel = item.kind === "image" ? "image" : item.kind === "file" ? (item.mime || "fichier") : "texte";
        chip.title = item.size != null ? `${item.name} (${kindLabel}, ${formatBytes(item.size)})` : item.name;
        if (item.kind === "image") {
            const img = document.createElement("img");
            img.src = item.data;
            img.alt = "";
            chip.appendChild(img);
        } else {
            const icon = document.createElement("span");
            icon.className = "attachment-icon";
            icon.textContent = attachmentIcon(item);
            chip.appendChild(icon);
        }
        const label = document.createElement("span");
        label.className = "attachment-name";
        label.textContent = item.name;
        chip.appendChild(label);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "attachment-remove";
        remove.textContent = "×";
        remove.title = "Retirer";
        remove.onclick = () => {
            pendingAttachments.splice(index, 1);
            renderAttachments();
        };
        chip.appendChild(remove);
        box.appendChild(chip);
    });
}

/* Formats envoyés tels quels ; les autres (bmp, svg, tiff…) sont convertis via un canvas. */
const DIRECT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_SIDE = 2048;

function formatBytes(n) {
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
    return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * Image -> data URL prête à l'envoi. Les images trop lourdes, trop grandes ou dans un
 * format peu pris en charge sont décodées, redimensionnées (2048 px max) puis
 * réencodées (PNG si possible, sinon JPEG) au lieu d'être refusées.
 */
async function prepareImage(file) {
    const direct = DIRECT_IMAGE_TYPES.has(file.type);
    if (direct && file.size <= MAX_IMAGE_BYTES) return readAsDataUrl(file);

    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`format d'image illisible (${file.type || "inconnu"}) : utiliser PNG, JPEG, WebP ou GIF`);
    }
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    const draw = (background) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    };
    try {
        if (file.type !== "image/jpeg") {
            draw(null);
            const png = canvas.toDataURL("image/png");
            if (png.length * 0.75 <= MAX_IMAGE_BYTES) return png;
        }
        draw("#ffffff"); // JPEG sans transparence : fond blanc plutôt que noir
        for (const quality of [0.88, 0.75, 0.6]) {
            const jpeg = canvas.toDataURL("image/jpeg", quality);
            if (jpeg.length * 0.75 <= MAX_IMAGE_BYTES) return jpeg;
        }
    } finally {
        if (bitmap.close) bitmap.close();
    }
    throw new Error(`image trop lourde même après compression (max ${formatBytes(MAX_IMAGE_BYTES)})`);
}

async function addAttachments(fileList) {
    for (const file of Array.from(fileList || [])) {
        if (pendingAttachments.length >= MAX_ATTACHMENTS) {
            renderEntry({ type: "error", text: `Maximum ${MAX_ATTACHMENTS} pièces jointes par message.` });
            break;
        }
        const name = file.name || (file.type.startsWith("image/") ? "image-collée.png" : "fichier");
        // Même fichier ajouté deux fois (double glisser-déposer, re-sélection) : ignoré.
        if (pendingAttachments.some((a) => a.name === name && a.size === file.size)) continue;
        try {
            if (file.size === 0) throw new Error("fichier vide");
            if (file.type.startsWith("image/")) {
                try {
                    pendingAttachments.push({ name, kind: "image", size: file.size, data: await prepareImage(file) });
                    continue;
                } catch (err) {
                    // Image non décodable (HEIC, PSD…) : envoyée telle quelle comme fichier.
                    if (file.size > MAX_FILE_BYTES) throw err;
                }
                pendingAttachments.push(await prepareFile(file, name));
                continue;
            }
            if (!isBinaryFile(file, name) && file.size <= MAX_TEXT_BYTES) {
                const data = await file.text();
                if (!data.includes("\u0000")) {
                    pendingAttachments.push({ name, kind: "text", size: file.size, data });
                    continue;
                }
            }
            // PDF, Office, archives, autres binaires : envoyés tels quels (Files v2).
            pendingAttachments.push(await prepareFile(file, name));
        } catch (err) {
            renderEntry({ type: "error", text: `${name} : ${err.message || err}` });
        }
    }
    renderAttachments();
}

async function send(text) {
    const value = text ?? input.value;
    const withFiles = text === undefined && pendingAttachments.length > 0;
    if (!value.trim() && !withFiles) return;
    if (!ui.status.booted && !value.trim().startsWith("/")) { openConnectionGuide(1); return; }
    const attachments = withFiles ? pendingAttachments : [];
    if (text === undefined) {
        if (value.trim()) {
            ui.history.push(value);
            ui.historyIndex = ui.history.length;
        }
        input.value = "";
        saveStudioDraft();
        if (withFiles) {
            pendingAttachments = [];
            renderAttachments();
        }
    }
    hideSlash();
    try {
        if (inlineEditingId) {
            await api.taskQueue("edit", { id: inlineEditingId, prompt: value });
            inlineEditingId = null;
            studioFeedback("Prompt en attente mis à jour.");
            return;
        }
        const result = await api.submit(value, attachments);
        if (result?.error) throw new Error(result.error);
        if (result?.queued) studioFeedback("Prompt ajouté à la suite.");
    } catch (err) {
        if (text === undefined && !input.value) {
            input.value = value;
            if (withFiles) { pendingAttachments = attachments; renderAttachments(); }
            saveStudioDraft(); autosizeInput();
        }
        renderEntry({ type: "error", text: err.message });
    }
}

function slashMatches() {
    const value = input.value;
    if (!value.startsWith("/") || /\s/.test(value)) return [];
    return SLASH_COMMANDS.filter(([cmd]) => cmd.startsWith(value.toLowerCase()));
}

function hideSlash() {
    $("slash-menu").classList.add("hidden");
    ui.slashIndex = 0;
}

function updateSlash() {
    const matches = slashMatches();
    const menu = $("slash-menu");
    if (!matches.length) {
        hideSlash();
        return;
    }
    ui.slashIndex = Math.min(ui.slashIndex, matches.length - 1);
    menu.innerHTML = "";
    matches.forEach(([cmd, desc], i) => {
        const el = document.createElement("div");
        el.textContent = `${cmd}  —  ${desc}`;
        if (i === ui.slashIndex) el.className = "active";
        el.onmousedown = (ev) => {
            ev.preventDefault();
            ui.slashIndex = i;
            pickSlash();
        };
        menu.appendChild(el);
    });
    menu.classList.remove("hidden");
}

function moveSlash(delta) {
    const count = slashMatches().length;
    if (!count) return;
    ui.slashIndex = (ui.slashIndex + delta + count) % count;
    updateSlash();
}

function pickSlash() {
    const match = slashMatches()[ui.slashIndex];
    if (match) input.value = `${match[0]} `;
    hideSlash();
    input.focus();
}

input.addEventListener("input", updateSlash);

input.addEventListener("keydown", (ev) => {
    const menuOpen = !$("slash-menu").classList.contains("hidden");

    if (menuOpen && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
        ev.preventDefault();
        moveSlash(ev.key === "ArrowDown" ? 1 : -1);
        return;
    }
    if (menuOpen && (ev.key === "Tab" || (ev.key === "Enter" && !ev.shiftKey))) {
        const match = slashMatches()[ui.slashIndex];
        if (ev.key === "Tab" || (match && match[0] !== input.value.trim())) {
            ev.preventDefault();
            pickSlash();
            return;
        }
    }
    if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        send();
        return;
    }
    if (ev.key === "Escape") {
        ev.preventDefault();
        if (inlineEditingId) { inlineEditingId = null; input.value = ""; saveStudioDraft(); studioFeedback("Modification annulée."); return; }
        if (menuOpen) hideSlash();
        else if (ui.status.busy) api.interrupt().catch(() => {});
        else input.value = "";
        return;
    }
    if ((ev.key === "ArrowUp" || ev.key === "ArrowDown") && !input.value.includes("\n") && ui.history.length) {
        ev.preventDefault();
        const delta = ev.key === "ArrowUp" ? -1 : 1;
        ui.historyIndex = Math.max(0, Math.min(ui.history.length, ui.historyIndex + delta));
        input.value = ui.history[ui.historyIndex] ?? "";
    }
});

$("composer").addEventListener("submit", (ev) => {
    ev.preventDefault();
    send();
});

$("btn-attach").onclick = () => $("attach-input").click();
$("attach-input").addEventListener("change", async (ev) => {
    await addAttachments(ev.target.files);
    ev.target.value = "";
    input.focus();
});
input.addEventListener("paste", (ev) => {
    const files = Array.from(ev.clipboardData?.files || []);
    if (!files.length) return;
    ev.preventDefault();
    addAttachments(files);
});
$("composer").addEventListener("dragover", (ev) => {
    if (!ev.dataTransfer || !Array.from(ev.dataTransfer.types || []).includes("Files")) return;
    ev.preventDefault();
    $("composer").classList.add("drag-over");
});
$("composer").addEventListener("dragleave", (ev) => {
    // Ignorer les passages d'un enfant à l'autre du composer (sinon la surbrillance clignote).
    if (ev.relatedTarget && $("composer").contains(ev.relatedTarget)) return;
    $("composer").classList.remove("drag-over");
});
$("composer").addEventListener("drop", (ev) => {
    $("composer").classList.remove("drag-over");
    const files = ev.dataTransfer?.files;
    if (!files || !files.length) return;
    ev.preventDefault();
    addAttachments(files);
});

/* ---------- Contexte choisi par l'utilisateur : @fichier épinglé ---------- */

const AT_MAX_RESULTS = 12;
const MAX_PINNED = 20;
let atFilesCache = null;
let atFilesAt = 0;
let atFilesWorkspace = null;
let atIndex = 0;
let atItems = [];
let atSeq = 0;
if (!ui.pinnedFiles) ui.pinnedFiles = [];

function atMenuEl() {
    let menu = $("at-menu");
    if (!menu) {
        menu = document.createElement("div");
        menu.id = "at-menu";
        menu.className = "at-menu hidden";
        menu.setAttribute("role", "listbox");
        const slash = $("slash-menu");
        slash.parentNode.insertBefore(menu, slash.nextSibling);
    }
    return menu;
}

/** Jeton « @requête » juste avant le curseur, ou null. */
function atToken() {
    const caret = input.selectionStart ?? input.value.length;
    const m = /(^|\s)@([^\s@]*)$/.exec(input.value.slice(0, caret));
    return m ? { query: m[2], start: caret - m[2].length - 1, end: caret } : null;
}

async function atFiles() {
    const ws = ui.workspace || null;
    if (ws !== atFilesWorkspace) {
        // Autre projet : les fichiers épinglés de l'ancien n'ont plus de sens.
        atFilesWorkspace = ws;
        atFilesCache = null;
        if (ui.pinnedFiles.length) {
            ui.pinnedFiles = [];
            renderPinned();
            lastEditorContext = null;
            syncEditorContext();
        }
    }
    if (!ws) return [];
    if (!atFilesCache || Date.now() - atFilesAt > 30000) {
        try {
            const res = await api.listAllFiles();
            atFilesCache = Array.isArray(res) ? res : [];
        } catch {
            atFilesCache = [];
        }
        atFilesAt = Date.now();
    }
    return atFilesCache;
}

function atScore(path, q) {
    if (!q) return 3;
    const p = path.toLowerCase();
    const name = p.split("/").pop();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (p.includes(q)) return 2;
    let i = 0;
    for (const c of p) if (c === q[i]) i++;
    return i === q.length ? 4 : -1;
}

function hideAt() {
    const menu = $("at-menu");
    if (menu) menu.classList.add("hidden");
    atItems = [];
    atIndex = 0;
}

function renderAtMenu() {
    const menu = atMenuEl();
    menu.innerHTML = "";
    if (!atItems.length) {
        const empty = document.createElement("div");
        empty.className = "at-empty";
        empty.textContent = ui.workspace ? "Aucun fichier ne correspond." : "Aucun projet ouvert.";
        menu.appendChild(empty);
    }
    atItems.forEach((path, i) => {
        const el = document.createElement("div");
        el.className = i === atIndex ? "at-item active" : "at-item";
        el.setAttribute("role", "option");
        if (ui.pinnedFiles.includes(path)) el.classList.add("pinned");
        const name = document.createElement("span");
        name.className = "at-name";
        name.textContent = path.split("/").pop();
        const dir = document.createElement("span");
        dir.className = "at-dir";
        dir.textContent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        el.append(name, dir);
        el.onmousedown = (ev) => {
            ev.preventDefault();
            atIndex = i;
            pickAt();
        };
        menu.appendChild(el);
    });
    menu.classList.remove("hidden");
    const active = menu.querySelector(".at-item.active");
    if (active) active.scrollIntoView({ block: "nearest" });
}

async function updateAt() {
    const tok = atToken();
    if (!tok) {
        hideAt();
        return;
    }
    hideSlash();
    const seq = ++atSeq;
    const files = await atFiles();
    if (seq !== atSeq || !atToken()) return;
    const q = tok.query.toLowerCase();
    atItems = files
        .map((path) => ({ path, score: atScore(path, q) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => a.score - b.score || a.path.length - b.path.length)
        .slice(0, AT_MAX_RESULTS)
        .map((x) => x.path);
    atIndex = Math.min(atIndex, Math.max(0, atItems.length - 1));
    renderAtMenu();
}

function pickAt() {
    const path = atItems[atIndex];
    const tok = atToken();
    if (path && tok) {
        // Le jeton @… est retiré du message : le fichier passe en contexte épinglé.
        input.value = input.value.slice(0, tok.start) + input.value.slice(tok.end);
        input.setSelectionRange(tok.start, tok.start);
        pinFile(path);
    }
    hideAt();
    input.focus();
}

function pinFile(path) {
    if (ui.pinnedFiles.includes(path)) return;
    if (ui.pinnedFiles.length >= MAX_PINNED) {
        renderEntry({ type: "error", text: `Maximum ${MAX_PINNED} fichiers épinglés.` });
        return;
    }
    ui.pinnedFiles.push(path);
    renderPinned();
    lastEditorContext = null;
    syncEditorContext();
}

function unpinFile(path) {
    ui.pinnedFiles = ui.pinnedFiles.filter((p) => p !== path);
    renderPinned();
    lastEditorContext = null;
    syncEditorContext();
}

function renderPinned() {
    let box = $("pinned-files");
    if (!box) {
        box = document.createElement("div");
        box.id = "pinned-files";
        box.className = "pinned-files";
        const attachments = $("attachments");
        attachments.parentNode.insertBefore(box, attachments);
    }
    box.replaceChildren();
    box.classList.toggle("hidden", ui.pinnedFiles.length === 0);
    for (const path of ui.pinnedFiles) {
        const chip = document.createElement("span");
        chip.className = "attachment-chip pinned-chip";
        chip.title = `${path}\n(épinglé dans le contexte de l'agent)`;
        const icon = document.createElement("span");
        icon.className = "attachment-icon";
        icon.textContent = "@";
        const label = document.createElement("span");
        label.className = "attachment-name";
        label.textContent = path.split("/").pop();
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "attachment-remove";
        remove.textContent = "×";
        remove.title = "Retirer du contexte";
        remove.onclick = () => unpinFile(path);
        chip.append(icon, label, remove);
        box.appendChild(chip);
    }
}

input.addEventListener("input", updateAt);
input.addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement !== input) hideAt();
}, 150));

// Phase de capture : passe avant le gestionnaire du menu « / » et de l'envoi.
input.addEventListener("keydown", (ev) => {
    const menu = $("at-menu");
    if (!menu || menu.classList.contains("hidden")) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (!atItems.length) return;
        atIndex = (atIndex + (ev.key === "ArrowDown" ? 1 : -1) + atItems.length) % atItems.length;
        renderAtMenu();
    } else if (ev.key === "Tab" || (ev.key === "Enter" && !ev.shiftKey)) {
        if (!atItems.length) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        pickAt();
    } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        hideAt();
    }
}, true);

