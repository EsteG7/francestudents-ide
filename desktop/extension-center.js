"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const skills = require("../src/skills");
const settings = require("../src/settings");
const { library } = require("../src/skills/library");
const mcp = require("../src/mcp/manager");

const keyOf = skill => `${skill.scope}:${path.basename(skill.dir)}`;
const safeName = value => {
    const name = String(value || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw new Error("Nom invalide : 1 à 80 lettres, chiffres, tirets ou underscores.");
    return name;
};
function validateContent(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 90000) throw new Error("Le SKILL.md doit contenir entre 1 et 90 000 caractères.");
    return value;
}
async function atomicWrite(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(tmp, text, { mode: 0o600 }); await fs.rename(tmp, file); }
    finally { await fs.unlink(tmp).catch(() => {}); }
}
function createExtensionCenter({ workspace = () => null, busy = () => false } = {}) {
    let pending = Promise.resolve();
    const motionWorkspace=()=>require("../src/motion-workspace").motionWorkspace();
    const workspaceFor=skill=>skill.scope==="motion"?motionWorkspace():workspace();
    async function installedSkills(){
        const code=await skills.listSkills(workspace());
        const motion=(await skills.listSkills(motionWorkspace())).filter(skill=>skill.scope==="projet").map(skill=>({...skill,scope:"motion"}));
        return [...code,...motion];
    }
    function mutate(fn) {
        const operation = pending.then(() => {
            if (busy()) throw new Error("Attends la fin de la tâche avant de modifier les extensions.");
            return fn();
        });
        pending = operation.catch(() => {});
        return operation;
    }
    async function resolveSkill(key) {
        const skill = (await installedSkills()).find(s => keyOf(s) === key);
        if (!skill) throw new Error("Skill introuvable. Actualise la liste.");
        const actual = await fs.realpath(skill.file);
        const rel = path.relative(await fs.realpath(skill.dir), actual);
        if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Le fichier du skill sort de son dossier.");
        return skill;
    }
    async function list() {
        const saved = settings.load();
        return {
            skills: (await installedSkills()).map(s => ({ ...s, key: keyOf(s), favorite: (saved.skillFavorites || []).includes(keyOf(s)) })),
            library, motionCommunity:require("./motion-marketplace").catalog, profiles: saved.skillProfiles || {}, workspace: workspace(),
            userDir: skills.userSkillsDir(), projectDir: skills.projectSkillsDir(workspace())
        };
    }
    async function install({ name, content, scope, files = [] }) {
        const folder = safeName(name).toLowerCase();
        validateContent(content);
        if(scope==="projet" && skills.parseFrontmatter(content).meta.application==="effectcraft")scope="motion";
        if(!Array.isArray(files) || files.length>200)throw new Error("Trop de ressources dans le skill.");
        let bytes=0;const names=new Set(["skill.md"]);
        for(const file of files){
            if(typeof file.path!=="string" || file.path.includes("\\") || file.path.split("/").some(part=>!part || part==="." || part===".." || /[:\x00-\x1f]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || path.isAbsolute(file.path) || !Buffer.isBuffer(file.data))throw new Error("Ressource de skill invalide.");
            const key=file.path.toLowerCase();if(names.has(key))throw new Error("Ressource de skill en double.");names.add(key);
            bytes+=file.data.length;if(bytes>4000000)throw new Error("Ressources du skill trop volumineuses.");
        }
        const base = scope === "motion" ? skills.projectSkillsDir(motionWorkspace()) : scope === "projet" ? skills.projectSkillsDir(workspace()) : skills.userSkillsDir();
        if (!base) throw new Error("Ouvre un projet pour y installer un skill.");
        // mkdir non récursif sur le dossier cible empêche d’écraser un skill existant.
        await fs.mkdir(base, { recursive: true });
        const dir = path.join(base, folder);
        const relativeDir=path.relative(path.resolve(base),path.resolve(dir));
        if(!relativeDir || relativeDir.startsWith("..") || path.isAbsolute(relativeDir))throw new Error("Dossier de skill hors de la destination.");
        await fs.mkdir(dir);
        try {
            await fs.writeFile(path.join(dir, "SKILL.md"), content, { flag: "wx" });
            for(const file of files){const target=path.resolve(dir,file.path);const rel=path.relative(dir,target);if(!rel || rel.startsWith("..") || path.isAbsolute(rel))throw new Error("Ressource hors du dossier du skill.");await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.data,{flag:"wx"});}
        }
        catch (error) { await fs.rm(dir,{recursive:true,force:true}).catch(() => {}); throw error; }
        return list();
    }
    async function action(type, payload = {}) {
        if (type === "list") return list();
        if (type === "read") {
            const skill = await resolveSkill(payload.key);
            return { ...skill, content: await fs.readFile(skill.file, "utf8") };
        }
        return mutate(async () => {
            if (type === "install") {
                const entry = library.find(item => item.id === payload.id);
                if (!entry) throw new Error("Skill absent de la bibliothèque.");
                return install({ name: entry.id, content: entry.content, scope: payload.scope });
            }
            if (type === "import") return install(payload);
            if (type === "profile-save") {
                const name = String(payload.name || "").trim();
                if (!name || name.length > 50) throw new Error("Donne un nom de profil de 1 à 50 caractères.");
                const profiles = settings.load().skillProfiles || {};
                if (["__proto__", "constructor", "prototype"].includes(name)) throw new Error("Nom réservé.");
                settings.save({ skillProfiles: { ...profiles, [name]: (await installedSkills()).filter(s => !s.disabled).map(keyOf) } });
            } else if (type === "profile-apply" || type === "profile-delete") {
                const profiles = settings.load().skillProfiles || {};
                if (!Object.hasOwn(profiles, payload.name)) throw new Error("Profil introuvable.");
                if (type === "profile-delete") { delete profiles[payload.name]; settings.save({ skillProfiles: profiles }); }
                else {
                    for (const skill of await installedSkills()) {
                        const enabled = profiles[payload.name].includes(keyOf(skill));
                        if (skill.disabled === enabled) await skills.setSkillDisabled(skill.name, !enabled, workspaceFor(skill));
                    }
                }
            } else {
                const skill = await resolveSkill(payload.key);
                if (type === "toggle") await skills.setSkillDisabled(skill.name, payload.disabled === true, workspaceFor(skill));
                else if (type === "save") await atomicWrite(skill.file, validateContent(payload.content));
                else if (type === "remove") {
                    const trash = path.join(path.dirname(skill.dir), ".trash");
                    await fs.mkdir(trash, { recursive: true });
                    await fs.rename(skill.dir, path.join(trash, `${path.basename(skill.dir)}-${randomUUID()}`));
                } else if (type === "favorite") {
                    const favorites = new Set(settings.load().skillFavorites || []);
                    if (favorites.has(payload.key)) favorites.delete(payload.key); else favorites.add(payload.key);
                    settings.save({ skillFavorites: [...favorites] });
                } else throw new Error("Action de skill inconnue.");
            }
            return list();
        });
    }
    async function mcpAction(type, payload = {}) {
        return mutate(async () => {
            const file = mcp.defaultConfigFile();
            let raw;
            try { raw = await fs.readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
            const data = raw ? JSON.parse(raw.replace(/^\uFEFF/, "")) : { mcpServers: {} };
            mcp.parseConfig(data);
            const name = String(payload.name || "");
            if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) throw new Error("Nom de serveur invalide.");
            if (type === "add") {
                if (Object.hasOwn(data.mcpServers, name)) throw new Error("Ce serveur existe déjà.");
                data.mcpServers[name] = { command: payload.command, args: payload.args || [], env: payload.env || {}, ...(payload.cwd ? { cwd: payload.cwd } : {}) };
            } else {
                if (!Object.hasOwn(data.mcpServers, name)) throw new Error("Serveur introuvable.");
                if (type === "remove") delete data.mcpServers[name];
                else if (type === "toggle") data.mcpServers[name].disabled = payload.disabled === true;
                else throw new Error("Action MCP inconnue.");
            }
            mcp.parseConfig(data);
            if (raw) await atomicWrite(`${file}.backup`, raw);
            await atomicWrite(file, JSON.stringify(data, null, 2) + "\n");
            mcp.manager.stopAll();
            return { saved: true };
        });
    }
    return { action, mcpAction };
}
module.exports = { createExtensionCenter, validateContent, safeName };
