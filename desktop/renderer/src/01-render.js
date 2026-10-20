/* ---------- Rendu du texte ---------- */

const TOOL_LABELS = {
    list_directory: "Lister", read_file: "Lire", search_files: "Chercher",
    create_directory: "Créer le dossier", write_file: "Écrire", edit_file: "Éditer",
    move_path: "Déplacer", copy_path: "Copier", delete_path: "Supprimer",
    remember: "Mémoriser", run_command: "Commande"
};

function toolLabel(name) {
    return TOOL_LABELS[name] || String(name ?? "");
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function inline(text) {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

function renderMarkdown(src) {
    const lines = String(src ?? "").split("\n");
    let html = "";
    let block = null;
    let list = null;
    const closeList = () => {
        if (list) {
            html += `</${list}>`;
            list = null;
        }
    };

    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) {
            if (block === null) {
                closeList();
                block = [];
            } else {
                html += `<pre><code>${escapeHtml(block.join("\n"))}</code></pre>`;
                block = null;
            }
            continue;
        }
        if (block !== null) {
            block.push(line);
            continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        if (heading) {
            closeList();
            html += `<h4>${inline(heading[2])}</h4>`;
        } else if (bullet || numbered) {
            const kind = bullet ? "ul" : "ol";
            if (list !== kind) {
                closeList();
                html += `<${kind}>`;
                list = kind;
            }
            html += `<li>${inline((bullet || numbered)[1])}</li>`;
        } else if (!line.trim()) {
            closeList();
            html += "<br>";
        } else {
            closeList();
            html += `<div>${inline(line)}</div>`;
        }
    }

    if (block !== null) html += `<pre><code>${escapeHtml(block.join("\n"))}</code></pre>`;
    closeList();
    return html;
}

function diffLine(line) {
    if (typeof line === "string") {
        const first = line[0];
        const cls = first === "+" ? "add" : first === "-" ? "del" : first === "@" ? "hunk" : "";
        return { text: line, cls };
    }
    const kind = String(line?.type ?? line?.kind ?? line?.op ?? "");
    const text = String(line?.text ?? line?.line ?? line?.value ?? "");
    const cls = /add|ins|\+/.test(kind) ? "add" : /del|rem|-/.test(kind) ? "del" : /hunk|sep|@/.test(kind) ? "hunk" : "";
    const sign = cls === "add" ? "+ " : cls === "del" ? "- " : "  ";
    return { text: cls === "hunk" ? text : sign + text, cls };
}

function buildDiffCard(entry) {
    const card = document.createElement("div");
    card.className = "diff-card";

    if (entry.path) {
        const head = document.createElement("div");
        head.className = "diff-head";
        head.appendChild(fileIcon(entry.path, "file"));
        const p = document.createElement("span");
        p.className = "diff-path";
        p.textContent = entry.path;
        p.title = `${entry.path} — cliquez pour ouvrir`;
        p.onclick = () => openFile(entry.path);
        head.appendChild(p);
        const stats = document.createElement("span");
        stats.className = "diff-stats";
        const add = document.createElement("b");
        add.className = "add";
        add.textContent = `+${entry.added ?? 0}`;
        const del = document.createElement("b");
        del.className = "del";
        del.textContent = `-${entry.removed ?? 0}`;
        stats.append(add, del);
        head.appendChild(stats);
        card.appendChild(head);
    } else {
        const summary = document.createElement("div");
        summary.className = "diff-summary";
        summary.textContent = `+${entry.added ?? 0} / -${entry.removed ?? 0}`;
        card.appendChild(summary);
    }

    const body = document.createElement("div");
    body.className = "diff";
    body.innerHTML = (entry.lines || [])
        .map((line) => {
            const d = diffLine(line);
            return `<div class="${d.cls}">${escapeHtml(d.text) || " "}</div>`;
        })
        .join("");
    card.appendChild(body);
    return card;
}

