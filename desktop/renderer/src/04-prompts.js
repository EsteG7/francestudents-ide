/* ---------- Confirmations et questions ---------- */

function showPrompt() {
    const zone = $("prompt-zone");
    const p = ui.prompts[0];
    zone.innerHTML = "";

    if (!p) {
        zone.classList.add("hidden");
        input.focus();
        return;
    }

    zone.classList.remove("hidden");
    const question = document.createElement("div");
    question.className = "question";
    question.textContent = p.question;
    zone.appendChild(question);

    const buttons = document.createElement("div");
    buttons.className = "buttons";
    const answer = (value) => api.resolvePrompt(p.id, value).catch((err) => renderEntry({ type: "error", text: err.message }));
    const addButton = (label, onClick, primary = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (primary) b.className = "primary";
        b.onclick = onClick;
        buttons.appendChild(b);
        return b;
    };

    if (p.kind === "confirm") {
        const yes = addButton("Oui", () => answer("o"), true);
        addButton("Non", () => answer("n"));
        if (!p.force) addButton("Tout autoriser (session)", () => answer("t"));
        if (!p.force) addButton("Toujours autoriser", () => answer("tt"));
        zone.appendChild(buttons);
        setTimeout(() => yes.focus(), 0);
        scrollDown();
        return;
    }

    if (p.kind === "command" && p.prefix) {
        const prefix = document.createElement("div");
        prefix.className = "question";
        prefix.textContent = `Préfixe : ${p.prefix}`;
        zone.appendChild(prefix);
    }

    const field = document.createElement("input");
    field.type = p.kind === "secret" ? "password" : "text";
    field.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            answer(field.value);
        }
    });
    zone.appendChild(field);

    addButton("Valider", () => answer(field.value), true);
    if (p.kind === "command") {
        addButton("Oui (o)", () => answer("o"));
        addButton("Non (n)", () => answer("n"));
    }
    zone.appendChild(buttons);
    setTimeout(() => field.focus(), 0);
}

