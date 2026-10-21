"use strict";

/**
 * Skills : dossiers contenant un SKILL.md (frontmatter name / description),
 * au format des « Agent Skills ».
 *
 * Emplacements (le projet remplace l'utilisateur à nom égal) :
 *   - utilisateur : <dataDir>/skills/<nom>/SKILL.md  (ou FS_SKILLS_DIR)
 *   - projet      : <workspace>/.frst/skills/<nom>/SKILL.md
 *
 * Le catalogue (nom + description) est injecté dans le prompt de l'agent ;
 * l'outil use_skill renvoie les instructions complètes à la demande.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { CONFIG } = require("../config");

const SKILL_FILE = "SKILL.md";
const MAX_SKILL_CHARS = 60_000;
const MAX_SKILLS = 2000;
const MAX_EXTRA_FILES = 50;

function userSkillsDir() {
    return process.env.FS_SKILLS_DIR || path.join(CONFIG.dataDir, "skills");
}

function projectSkillsDir(workspace) {
    return workspace ? path.join(workspace, ".frst", "skills") : null;
}

function skillDirs(workspace) {
    const dirs = [{ dir: userSkillsDir(), scope: "utilisateur" }];
    const projectDir = projectSkillsDir(workspace);
    if (projectDir) dirs.push({ dir: projectDir, scope: "projet" });
    return dirs;
}

function unquote(value) {
    const v = value.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
    }
    return v;
}

/** Frontmatter YAML simple (clé: valeur, valeurs sur une ligne ou blocs | / >). */
function parseFrontmatter(text) {
    const source = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source);

    if (!match) return { meta: {}, body: source.trim() };

    const meta = {};
    const lines = match[1].split("\n");

    for (let i = 0; i < lines.length; i++) {
        const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
        if (!m) continue;

        const key = m[1].toLowerCase();
        let value = m[2];

        if (value === "|" || value === ">" || value === "") {
            const block = [];
            while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
                block.push(lines[++i].trim());
            }
            if (block.length || value) {
                value = block.join(value === "|" ? "\n" : " ");
            }
        }

        meta[key] = unquote(value);
    }

    return { meta, body: source.slice(match[0].length).trim() };
}

function isTrue(value) {
    return ["true", "yes", "1", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
}

async function readSkillDir(dir, folder, scope) {
    const file = path.join(dir, folder, SKILL_FILE);
    let text;

    try {
        text = await fs.readFile(file, "utf8");
    } catch {
        return null;
    }

    const { meta, body } = parseFrontmatter(text);
    const name = String(meta.name || folder).trim();

    return {
        name,
        description: String(meta.description || "").replace(/\s+/g, " ").trim()||
            (body.split("\n").find(line => line.trim()) || "").replace(/^#+\s*/, "").slice(0, 200),
        scope,
        dir: path.join(dir, folder),
        file,
        disabled: isTrue(meta.disabled),
        body
    };
}

/** Charge tous les skills disponibles (désactivés compris, marqués disabled). */
async function loadSkills(workspace) {
    const byName = new Map();

    for (const { dir, scope } of skillDirs(workspace)) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }

        const folders = entries
            .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
            .map(entry => entry.name)
            .sort();

        for (const folder of folders) {
            const skill = await readSkillDir(dir, folder, scope);
            if (skill) byName.set(normalizeName(skill.name), skill);
            if (byName.size >= MAX_SKILLS) break;
        }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Liste sans le contenu (pour /skills et l'interface). */
async function listSkills(workspace) {
    return (await loadSkills(workspace)).map(({ body, ...rest }) => rest);
}

/** Catalogue texte pour le prompt de l'agent ("" si aucun skill actif). */
function catalogText(skills) {
    return skills
        .filter(skill => !skill.disabled)
        .map(skill => `- "${skill.name}" (${skill.scope}) : ${skill.description.slice(0, 300) || "sans description"}`)
        .reduce((lines, line) => {
            if (lines.length + line.length < 24000) return lines + (lines ? "\n" : "") + line;
            return lines;
        }, "");
}

async function catalog(workspace) {
    return catalogText(await loadSkills(workspace));
}

async function listExtraFiles(dir) {
    const files = [];

    async function walk(current, depth) {
        if (depth > 2 || files.length >= MAX_EXTRA_FILES) return;
        let entries;
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (files.length >= MAX_EXTRA_FILES) return;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(full, depth + 1);
            } else if (!(depth === 0 && entry.name === SKILL_FILE)) {
                files.push(path.relative(dir, full).split(path.sep).join("/"));
            }
        }
    }

    await walk(dir, 0);
    return files.sort();
}

/** Contenu complet d'un skill, par nom (insensible à la casse). */
async function getSkill(name, workspace) {
    const skills = await loadSkills(workspace);
    const wanted = normalizeName(name);
    const skill = skills.find(s => normalizeName(s.name) === wanted) ||
        skills.find(s => normalizeName(path.basename(s.dir)) === wanted);

    if (!skill || skill.disabled) {
        const names = skills.filter(s => !s.disabled).map(s => s.name);
        throw new Error(
            `Skill inconnu ou désactivé : ${name}. Skills disponibles : ${names.length ? names.join(", ") : "aucun"}.`
        );
    }

    let body = skill.body;
    let truncated = false;
    if (body.length > MAX_SKILL_CHARS) {
        body = body.slice(0, MAX_SKILL_CHARS);
        truncated = true;
    }

    return {
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        dir: skill.dir,
        instructions: body,
        truncated,
        files: await listExtraFiles(skill.dir)
    };
}

/** Crée un squelette de skill utilisateur ou projet. */
async function createSkill(name, { workspace = null, scope = "utilisateur", description = "" } = {}) {
    const folder = String(name || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!folder) throw new Error("Nom de skill invalide (lettres, chiffres, - et _).");

    const base = scope === "projet" ? projectSkillsDir(workspace) : userSkillsDir();
    if (!base) throw new Error("Aucun projet sélectionné pour un skill de projet.");

    const dir = path.join(base, folder);
    const file = path.join(dir, SKILL_FILE);

    try {
        await fs.access(file);
        throw new Error(`Le skill existe déjà : ${file}`);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
        file,
        `---\nname: ${folder}\ndescription: ${description || "Décris quand utiliser ce skill."}\n---\n\n` +
        `# ${folder}\n\nInstructions détaillées à suivre quand ce skill est utilisé.\n`,
        "utf8"
    );

    return { name: folder, dir, file };
}

/**
 * Définit (ou ajoute) une clé du frontmatter en conservant le BOM et les fins de ligne.
 * Sans frontmatter, un bloc --- est ajouté en tête.
 */
function setFrontmatterValue(text, key, value) {
    const original = String(text || "");
    const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
    const source = original.slice(bom.length);
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const normalized = source.replace(/\r\n/g, "\n");
    const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
    const line = `${key}: ${value}`;
    let out;

    if (match) {
        const lines = match[1].split("\n");
        const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "i");
        const index = lines.findIndex(l => keyPattern.test(l));

        if (index >= 0) {
            // Retire aussi un éventuel bloc indenté (valeur | ou >) de l'ancienne valeur.
            let end = index + 1;
            while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
            lines.splice(index, end - index, line);
            // Une clé répétée ne doit pas réactiver un skill mis en quarantaine.
            for (let duplicate = lines.length - 1; duplicate > index; duplicate--) {
                if (!keyPattern.test(lines[duplicate])) continue;
                let blockEnd = duplicate + 1;
                while (blockEnd < lines.length && /^\s+\S/.test(lines[blockEnd])) blockEnd++;
                lines.splice(duplicate, blockEnd - duplicate);
            }
        } else {
            lines.push(line);
        }

        out = `---\n${lines.join("\n")}\n---\n${normalized.slice(match[0].length)}`;
    } else {
        out = `---\n${line}\n---\n\n${normalized}`;
    }

    return bom + (eol === "\r\n" ? out.replace(/\n/g, "\r\n") : out);
}

/** Active ou désactive un skill (clé disabled du frontmatter de son SKILL.md). */
async function setSkillDisabled(name, disabled, workspace) {
    const skills = await loadSkills(workspace);
    const wanted = normalizeName(name);
    const skill = skills.find(s => normalizeName(s.name) === wanted) ||
        skills.find(s => normalizeName(path.basename(s.dir)) === wanted);

    if (!skill) {
        const names = skills.map(s => s.name);
        throw new Error(
            `Skill inconnu : ${name}. Skills : ${names.length ? names.join(", ") : "aucun"}.`
        );
    }

    const wantDisabled = disabled === true;
    const changed = skill.disabled !== wantDisabled;

    if (changed) {
        const text = await fs.readFile(skill.file, "utf8");
        await fs.writeFile(skill.file, setFrontmatterValue(text, "disabled", wantDisabled ? "true" : "false"), "utf8");
    }

    return { name: skill.name, file: skill.file, scope: skill.scope, disabled: wantDisabled, changed };
}

module.exports = {
    SKILL_FILE,
    parseFrontmatter,
    setFrontmatterValue,
    userSkillsDir,
    projectSkillsDir,
    loadSkills,
    listSkills,
    catalog,
    catalogText,
    getSkill,
    createSkill,
    setSkillDisabled
};
