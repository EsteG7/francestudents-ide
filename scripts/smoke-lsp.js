"use strict";

/* Test de fumée : démarre le vrai typescript-language-server (avec node) via createLspClient
   sur un fichier temporaire, puis vérifie la complétion, le survol et les diagnostics. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { createLspClient, applyTextEdits } = require("../desktop/lsp");

const entry = path.join(__dirname, "..", "node_modules", "typescript-language-server", "lib", "cli.mjs");

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`délai dépassé : ${label}`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-lsp-"));
  const rel = "demo.ts";
  const text = "const greeting = \"salut\";\ngreeting.\nconst n: number = \"x\";\n";
  fs.writeFileSync(path.join(dir, rel), text);

  let resolveDiags;
  const gotDiags = new Promise((resolve) => { resolveDiags = resolve; });
  const client = createLspClient({
    workspace: dir,
    timeoutMs: 20000,
    spawn: (root) => childProcess.spawn(process.execPath, [entry, "--stdio"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] }),
    onDiagnostics: (...args) => {
      const list = args.find(Array.isArray) || (args[0] && args[0].diagnostics) || [];
      if (list.length) resolveDiags(list);
    }
  });

  let failed = false;
  try {
    await withTimeout(Promise.resolve(client.sync(rel, text)), 30000, "sync");

    const completion = await withTimeout(client.completion(rel, text, 1, 9), 30000, "completion");
    const items = Array.isArray(completion) ? completion : (completion && completion.items) || [];
    const hasUpper = items.some((i) => i.label === "toUpperCase");
    console.log(`[complétion] ${items.length} éléments, toUpperCase présent : ${hasUpper}`);
    if (!hasUpper) failed = true;

    const hover = await withTimeout(client.hover(rel, text, 0, 8), 30000, "hover");
    const hoverStr = typeof hover === "string" ? hover : String((hover && (hover.text || hover.contents)) || "");
    console.log(`[survol] ${JSON.stringify(hoverStr.slice(0, 120))}`);
    if (!hoverStr.includes("greeting")) failed = true;

    const diags = await withTimeout(gotDiags, 30000, "diagnostics");
    console.log(`[diagnostics] ${diags.length} : ${diags.map((d) => `${d.severity} ${d.from && d.from.line}:${d.from && d.from.character} ${d.message}`).join(" | ")}`);

    const defs = await withTimeout(client.definition(rel, text, 1, 2), 30000, "definition");
    console.log(`[définition] ${JSON.stringify(defs)}`);
    if (!defs.some((d) => d.rel === rel && d.line === 0 && d.character === 6)) failed = true;

    const refs = await withTimeout(client.references(rel, text, 0, 8), 30000, "references");
    console.log(`[références] ${refs.length}`);
    if (refs.length < 2) failed = true;

    const renamed = await withTimeout(client.rename(rel, text, 0, 8, "salutation"), 30000, "rename");
    const file = renamed.files.find((f) => f.rel === rel);
    const after = file ? applyTextEdits(text, file.edits) : "";
    console.log(`[renommage] ${JSON.stringify(after)}`);
    if (!after.startsWith("const salutation = ") || !after.includes("\nsalutation.")) failed = true;

    const sigRel = "sig.ts";
    const sigText = "function f(a: number, b: string) {}\nf(1, \n";
    fs.writeFileSync(path.join(dir, sigRel), sigText);
    const sig = await withTimeout(client.signatureHelp(sigRel, sigText, 1, 5), 30000, "signatureHelp");
    console.log(`[signature] ${sig ? `${sig.label} (paramètre ${sig.activeParameter})` : "aucune"}`);
    if (!sig || sig.activeParameter !== 1) failed = true;

    const fmtRel = "fmt.ts";
    const fmtText = "const  x={a:1}\n";
    fs.writeFileSync(path.join(dir, fmtRel), fmtText);
    const formatted = await withTimeout(client.format(fmtRel, fmtText, 4), 30000, "format");
    console.log(`[formatage] ${JSON.stringify(formatted && formatted.text)}`);
    if (!formatted || !formatted.changed || formatted.text === fmtText) failed = true;

    const actions = await withTimeout(client.codeActions(rel, text, 2, 6, 2, 7), 30000, "codeActions");
    console.log(`[actions de code] ${actions.length} : ${actions.map((a) => a.title).join(" | ")}`);
  } catch (err) {
    failed = true;
    console.error(`[échec] ${err && err.message ? err.message : err}`);
  } finally {
    try {
      await withTimeout(Promise.resolve(client.stop()), 10000, "stop");
    } catch (err) {
      console.error(`[arrêt] ${err.message}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? "ÉCHEC" : "OK");
  process.exit(failed ? 1 : 0);
}

main();
