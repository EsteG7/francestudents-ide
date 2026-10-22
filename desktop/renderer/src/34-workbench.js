/* Organize settings without moving the controls or losing search results. */
const settingsNavigation = centerNode("nav", "settings-navigation");
settingsNavigation.setAttribute("aria-label", "Catégories des paramètres");
let settingsCategory = "all";
const settingsGroups = [
    ["all", "Tout"], ["general", "Général"], ["agent", "IA et contexte"],
    ["access", "Autorisations"], ["advanced", "Connexions et outils"]
];
const settingsGroupByTitle = {
    "settings-model-title": "general", "studio-editor-settings-title": "general",
    "settings-context-title": "agent", "settings-web-title": "agent",
    "settings-access-title": "access", "settings-tools-title": "advanced",
    "settings-marketplace-title": "advanced", "settings-help-title": "general"
};
captureSettings.dataset.settingsGroup = "access";
updateSettings.dataset.settingsGroup = "general";
function filterSettingsCards() {
    const normalize = value => value.toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const query = normalize($("settings-search").value).trim();
    let visible = 0;
    for (const card of $("settings-view").querySelectorAll(".settings-card")) {
        const group = card.dataset.settingsGroup || settingsGroupByTitle[card.getAttribute("aria-labelledby")] || "general";
        const matches = query ? normalize(card.textContent).includes(query) : settingsCategory === "all" || settingsCategory === group;
        card.classList.toggle("hidden", !matches);
        if (matches) visible++;
    }
    for (const button of settingsNavigation.children) {
        button.setAttribute("aria-pressed", String(!query && button.dataset.category === settingsCategory));
        button.disabled = !!query;
        button.title = query ? "Efface la recherche pour filtrer par catégorie" : "";
    }
    $("settings-search-empty").classList.toggle("hidden", visible > 0);
}
for (const [id, label] of settingsGroups) {
    const button = centerNode("button", "", label);
    button.type = "button"; button.dataset.category = id;
    button.onclick = () => { settingsCategory = id; filterSettingsCards(); };
    settingsNavigation.append(button);
}
$("settings-search").closest(".settings-search-wrap").after(settingsNavigation);
$("settings-search").oninput = filterSettingsCards;
filterSettingsCards();
// Expose icon-only navigation names to keyboard and assistive technology.
for (const button of document.querySelectorAll("#activity-bar button, .agent-actions button, .sidebar-actions button")) {
    if (!button.hasAttribute("aria-label") && button.title) button.setAttribute("aria-label", button.title);
}
