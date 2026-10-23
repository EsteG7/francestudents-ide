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
        const result = await api.bootstrap();
        if (result.origin) connectionOrigin = result.origin;
        if (!result.ok) {
            openConnectionGuide(1);
            if (!result.needsLogin) guideError(result.reason);
        }
    } catch (err) {
        openConnectionGuide(1);
        guideError(err);
    }
    refreshQuota();
    setInterval(refreshQuota, 15 * 60 * 1000);
})();
