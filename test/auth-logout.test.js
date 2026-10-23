"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

test("déconnexion : efface aussi un renouvellement en vol et bloque le token d’environnement après redémarrage", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-logout-"));
    process.env.FS_DATA_DIR = dir;
    process.env.FS_SESSION_TOKEN = "ENV_TOKEN_MUST_NOT_RETURN";
    const modulePath = require.resolve("../src/api/auth");
    const auth = require(modulePath);
    await auth.loadSession();
    auth.auth.jar.set(auth.SESSION_COOKIE, "OLD_SESSION");
    let finish;
    auth.auth.pending = new Promise(resolve => { finish = () => {
        auth.auth.accessToken = "LATE_TOKEN";
        auth.auth.jar.set(auth.SESSION_COOKIE, "LATE_SESSION");
        resolve();
    }; });
    const logout = auth.logout();
    finish();
    await logout;
    assert.equal(auth.auth.accessToken, "");
    assert.equal(auth.auth.expiresAt, 0);
    assert.deepEqual([...auth.auth.jar.keys()], ["francestudent-device-id"]);
    const saved = JSON.parse(await fs.readFile(path.join(dir, "session.json"), "utf8"));
    assert.equal(saved.signedOut, true);
    assert.doesNotMatch(JSON.stringify(saved), /OLD_SESSION|LATE_SESSION|LATE_TOKEN/);
    delete require.cache[modulePath];
    const restarted = require(modulePath);
    await restarted.loadSession();
    await assert.rejects(restarted.getAccessToken(true), error => error.needsLogin === true);
    assert.equal(restarted.auth.jar.has(restarted.SESSION_COOKIE), false);
    await fs.rm(dir, { recursive: true, force: true });
});
