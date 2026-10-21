"use strict";

const path = require("node:path");
const fs = require("node:fs");

// Full access executes the original script in a real shell, without parsing
// or reconstructing its quotes, variables, pipelines or redirections.
function shellSegment(command) {
    if (typeof command !== "string" || !command.trim()) throw new Error("Commande vide.");
    if (command.includes("\0") || command.length > 128000) throw new Error("Commande invalide ou trop longue.");
    if (process.platform === "win32") {
        const file = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        const script = "$ErrorActionPreference = 'Stop'\n" +
            "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n" +
            "$OutputEncoding = [Console]::OutputEncoding\n$global:LASTEXITCODE = 0\ntry {\n" +
            command + "\nexit $LASTEXITCODE\n} catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }";
        return { file, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], display: command, op: null };
    }
    return { file: process.env.SHELL || "/bin/bash", args: ["-c", command], display: command, op: null };
}

function shellCwd(requested, workspace) {
    const cwd = path.resolve(workspace, typeof requested === "string" && requested.trim() ? requested : ".");
    if (!fs.statSync(cwd).isDirectory()) throw new Error(`Pas un dossier : ${cwd}`);
    return cwd;
}

module.exports = { shellSegment, shellCwd };
