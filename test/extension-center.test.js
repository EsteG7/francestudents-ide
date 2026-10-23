"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
let dir, project, center, skills, settings;
test.before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-center-"));
    process.env.FS_DATA_DIR = dir;
    process.env.FS_MCP_CONFIG = path.join(dir, "mcp.json");
    project = path.join(dir, "project"); await fs.mkdir(project);
    skills = require("../src/skills"); settings = require("../src/settings");
    center = require("../desktop/extension-center").createExtensionCenter({workspace:() => project});
});
test.after(async () => { await fs.rm(dir, {recursive:true, force:true}); });
test("bibliothèque : installation projet, refus d’écrasement, désactivation appliquée à l’agent", async () => {
    let data = await center.action("install", {id:"web-quality", scope:"projet"});
    assert.equal(data.library.length, 22);
    assert.ok(data.skills.some(s => s.key === "projet:web-quality"));
    await assert.rejects(center.action("install", {id:"web-quality", scope:"projet"}), /EEXIST/);
    await center.action("toggle", {key:"projet:web-quality", disabled:true});
    await assert.rejects(skills.getSkill("web-quality", project), /désactivé/);
    await center.action("toggle", {key:"projet:web-quality", disabled:false});
    assert.match((await skills.getSkill("web-quality", project)).instructions, /clavier/);
});
test("profils et favoris persistants, édition, retrait récupérable", async () => {
    await center.action("install", {id:"debug-method", scope:"utilisateur"});
    await center.action("favorite", {key:"utilisateur:debug-method"});
    assert.ok(settings.load().skillFavorites.includes("utilisateur:debug-method"));
    await center.action("profile-save", {name:"Web et debug"});
    await center.action("toggle", {key:"utilisateur:debug-method", disabled:true});
    await center.action("profile-apply", {name:"Web et debug"});
    assert.equal((await skills.getSkill("debug-method", project)).name, "debug-method");
    await center.action("save", {key:"utilisateur:debug-method", content:"---\nname: debug-method\ndescription: QA\n---\n\nInstructions QA"});
    assert.match((await skills.getSkill("debug-method", project)).instructions, /Instructions QA/);
    await center.action("remove", {key:"utilisateur:debug-method"});
    assert.equal((await center.action("list")).skills.some(s => s.name === "debug-method"), false);
    assert.equal((await fs.readdir(path.join(skills.userSkillsDir(), ".trash"))).length, 1);
    await center.action("profile-delete", {name:"Web et debug"});
    assert.deepEqual(settings.load().skillProfiles, {});
});
test("imports bornés, chemins refusés et aucune modification pendant une tâche", async () => {
    await assert.rejects(center.action("import", {name:"../outside", content:"QA"}), /Nom invalide/);
    await assert.rejects(center.action("import", {name:"oversized", content:"x".repeat(90001)}), /90 000/);
    await assert.rejects(center.action("read", {key:"../../outside"}), /introuvable/);
    const busy = require("../desktop/extension-center").createExtensionCenter({busy:() => true});
    await assert.rejects(busy.action("install", {id:"web-quality"}), /fin de la tâche/);
});

test("motion collection installs native skills and keeps code and EffectCraft catalogs separate",async()=>{
    const data=await center.action("install",{id:"motion-titles",scope:"projet"});
    assert.equal(data.library.filter(item=>item.application==="effectcraft").length,8);
    assert.equal(data.motionCommunity.length,5);
    const motion=require("../src/motion-workspace").motionWorkspace();
    assert.match(await skills.catalog(motion,"effectcraft"),/motion-titles/);
    assert.doesNotMatch(await skills.catalog(project,"effectcraft"),/motion-titles/);
    assert.doesNotMatch(await skills.catalog(project,"code"),/motion-titles/);
    const loaded=await skills.getSkill("motion-titles",motion);assert.match(loaded.instructions,/command.describe/);assert.equal(loaded.application,"effectcraft");
    assert.ok(data.skills.some(skill=>skill.key==="motion:motion-titles"));
    const state=require("../src/state").state;const previous={workspace:state.workspace,motionDesign:state.motionDesign};
    try{state.workspace=project;state.motionDesign=false;await assert.rejects(require("../src/skills/tool").run({name:"motion-titles"}),/inconnu|autre espace/);}
    finally{Object.assign(state,previous);}
});

test("community resources are copied with the skill and unsafe paths are rejected before writing",async()=>{
    const payload={name:"motion-resources",scope:"projet",content:"---\nname: motion-resources\ndisabled: true\napplication: code\n---\n\nSee rules/timing.md",files:[{path:"rules/timing.md",data:Buffer.from("Timing guidance")} ]};
    await center.action("import",payload);
    assert.equal(await fs.readFile(path.join(project,".frst/skills/motion-resources/rules/timing.md"),"utf8"),"Timing guidance");
    assert.doesNotMatch(await skills.catalog(project,"effectcraft"),/motion-resources/);
    for(const file of ["../outside.md","/outside.md","rules/../../outside.md","C:/outside.md","rules\\outside.md","SKILL.md","rules/CON.txt"]){await assert.rejects(center.action("import",{...payload,name:"unsafe-resource",files:[{path:file,data:Buffer.from("bad")}]}),/Ressource/);}
    await assert.rejects(fs.access(path.join(project,".frst/skills/unsafe-resource")));
});
test("MCP : validation, activation, suppression, sauvegarde sans perdre les autres propriétés", async () => {
    const file = process.env.FS_MCP_CONFIG;
    await fs.writeFile(file, JSON.stringify({note:"à conserver", mcpServers:{}}));
    await center.mcpAction("add", {name:"qa", command:"node", args:["server.js"], env:{QA:"test"}});
    let data = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(data.note, "à conserver");
    assert.equal(data.mcpServers.qa.disabled, undefined);
    const before = await fs.readFile(file, "utf8");
    await assert.rejects(center.mcpAction("add", {name:"bad", command:"node", args:"not-an-array"}), /liste/);
    assert.equal(await fs.readFile(file, "utf8"), before);
    await center.mcpAction("toggle", {name:"qa", disabled:true});
    data = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(data.mcpServers.qa.disabled, true);
    assert.equal(await fs.readFile(`${file}.backup`, "utf8"), before);
    await center.mcpAction("remove", {name:"qa"});
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).mcpServers, {});
    await assert.rejects(center.mcpAction("add", {name:"__proto__", command:"node"}), /invalide/);
});
test("préférences : validation atomique et budgets appliqués au moteur", () => {
    const preferences = require("../desktop/preferences");
    const saved = preferences.save({...preferences.defaults, contextMaxFiles:3000, defaultModel:-1003});
    assert.equal(saved.defaultModel, -1003);
    assert.equal(require("../src/config").CONFIG.contextMaxFiles, 3000);
    assert.throws(() => preferences.save({...saved, contextMaxFiles:500000}), /entre/);
    assert.equal(preferences.get().contextMaxFiles, 3000);
    const modelOnly = preferences.save({defaultModel:-1004});
    assert.equal(modelOnly.defaultModel,-1004);
    assert.equal(modelOnly.contextMaxFiles,3000);
    preferences.save({contextMaxFiles:2000});
    assert.equal(preferences.get().defaultModel,-1004);
    assert.equal(JSON.parse(require("node:fs").readFileSync(settings.file(),"utf8")).defaultModel,-1004);
});
