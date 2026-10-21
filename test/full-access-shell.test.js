"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { shellSegment, shellCwd } = require("../src/tools/command/shell");
const { runProcess } = require("../src/tools/command/runner");
const windows = process.platform === "win32";
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "frst-shell-"));
test.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
const run = command => runProcess({ ...shellSegment(command), cwd, timeoutMs: 10000 });

test("shell natif : variables, multilignes, pipeline et fichier avec espaces", async () => {
    const command = windows
        ? '$text = "bonjour été"\n$text | Set-Content -Encoding UTF8 "avec espaces.txt"\nGet-Content -Encoding UTF8 "avec espaces.txt"'
        : 'text="bonjour été"\nprintf "%s" "$text" > "avec espaces.txt"\ncat "avec espaces.txt"';
    const result = await run(command);
    assert.equal(result.exit_code, 0);
    assert.match(result.output, /bonjour été/);
    assert.match(fs.readFileSync(path.join(cwd, "avec espaces.txt"), "utf8"), /bonjour été/);
});
test("shell natif : erreurs et code de sortie explicite", async () => {
    assert.equal((await run("exit 7")).exit_code, 7);
    assert.notEqual((await run(windows ? 'Get-Item "absent-unique-123"' : "cat absent-unique-123")).exit_code, 0);
    const command = windows ? '& node -e "process.exit(3)"' : "node -e 'process.exit(3)'";
    assert.equal((await run(command)).exit_code, 3);
});
test("shell natif : cwd absolu hors projet et validation", () => {
    assert.equal(shellCwd(cwd, path.dirname(cwd)), cwd);
    assert.throws(() => shellSegment("echo\0oops"));
    assert.throws(() => shellSegment(" "));
});
test("shell natif : timeout", async () => {
    const result = await runProcess({ ...shellSegment(windows ? "Start-Sleep -Seconds 30" : "sleep 30"), cwd, timeoutMs: 1000 });
    assert.equal(result.timed_out, true);
});
