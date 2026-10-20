/* ---------- Démarrage ---------- */

(async () => {
    try {
        applyStatus(await api.status());
    } catch {
        // statut indisponible au démarrage
    }
    renderTree();
    input.focus();
    try {
        await api.bootstrap();
    } catch (err) {
        renderEntry({ type: "error", text: err.message });
    }
    refreshQuota();
    setInterval(refreshQuota, 120000);
})();
