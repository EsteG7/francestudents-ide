"use strict";

// Portable builds may check public releases, but never install themselves.
async function checkPortableRelease(version, fetchImpl = fetch) {
    const response = await fetchImpl("https://api.github.com/repos/extraopaa/francestudents-ide/releases/latest", {
        headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error("Source de mises à jour indisponible.");
    const release = await response.json();
    const parse = value => /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
    const next = parse(release.tag_name), current = parse(version);
    if (!next || !current || release.draft || release.prerelease) throw new Error("Version publiée invalide.");
    let newer = false;
    for (let i = 1; i <= 3; i++) {
        if (Number(next[i]) !== Number(current[i])) { newer = Number(next[i]) > Number(current[i]); break; }
    }
    return {
        status: newer ? "available" : "current", availableVersion: newer ? next.slice(1).join(".") : null,
        message: newer ? `La version ${next.slice(1).join(".")} est disponible. Version portable : télécharge l’installateur depuis les releases GitHub pour la mettre à jour.` : "Aucune mise à jour plus récente disponible."
    };
}

module.exports = { checkPortableRelease };
