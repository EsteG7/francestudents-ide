"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const skills = require("../src/skills");
const { validateToolCall } = require("../src/tools/registry");

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "fs-skills-"));
}

function writeSkill(base, folder, text) {
    fs.mkdirSync(path.join(base, folder), { recursive: true });
    fs.writeFileSync(path.join(base, folder, "SKILL.md"), text);
}

test("parseFrontmatter : valeurs simples, guillemets, blocs et CRLF", () => {
    const { meta, body } = skills.parseFrontmatter(
        "---\r\nname: \"revue\"\r\ndescription: >\r\n  Relit le code\r\n  avant commit\r\ndisabled: no\r\n---\r\n# Titre\r\nCorps"
    );
    assert.equal(meta.name, "revue");
    assert.equal(meta.description, "Relit le code avant commit");
    assert.equal(meta.disabled, "no");
    assert.equal(body, "# Titre\nCorps");

    const none = skills.parseFrontmatter("# Juste du texte");
    assert.deepEqual(none.meta, {});
    assert.equal(none.body, "# Juste du texte");
});

test("skills : création, liste, catalogue, chargement, priorité projet, désactivation", async () => {
    const userDir = tmpDir();
    const workspace = tmpDir();
    const previous = process.env.FS_SKILLS_DIR;
    process.env.FS_SKILLS_DIR = userDir;

    try {
        const created = await skills.createSkill("Mon Skill!", { description: "Quand tester" });
        assert.equal(created.name, "mon-skill");
        assert.ok(fs.existsSync(created.file));
        await assert.rejects(skills.createSkill("mon-skill"), /existe déjà/);
        await assert.rejects(skills.createSkill("x", { scope: "projet" }), /Aucun projet/);

        writeSkill(userDir, "commun", "---\nname: commun\ndescription: version utilisateur\n---\nUtilisateur");
        writeSkill(userDir, "eteint", "---\nname: eteint\ndescription: off\ndisabled: true\n---\nRien");
        writeSkill(userDir, "sans-meta", "# Résumé auto\nTexte");
        fs.writeFileSync(path.join(userDir, "commun", "script.sh"), "echo");

        const projectBase = skills.projectSkillsDir(workspace);
        writeSkill(projectBase, "commun", "---\nname: commun\ndescription: version projet\n---\nProjet");

        const list = await skills.listSkills(workspace);
        assert.deepEqual(list.map(s => s.name), ["commun", "eteint", "mon-skill", "sans-meta"]);
        assert.equal(list.find(s => s.name === "commun").scope, "projet");
        assert.equal(list.find(s => s.name === "sans-meta").description, "Résumé auto");
        assert.ok(list.every(s => s.body === undefined));

        const catalog = await skills.catalog(workspace);
        assert.match(catalog, /"commun" \(projet\) : version projet/);
        assert.match(catalog, /"mon-skill" \(utilisateur\) : Quand tester/);
        assert.doesNotMatch(catalog, /eteint/);

        const skill = await skills.getSkill("COMMUN", workspace);
        assert.equal(skill.instructions, "Projet");
        assert.deepEqual(skill.files, []);

        const user = await skills.getSkill("commun", null);
        assert.equal(user.instructions, "Utilisateur");
        assert.deepEqual(user.files, ["script.sh"]);

        await assert.rejects(skills.getSkill("eteint", workspace), /inconnu ou désactivé/);
        await assert.rejects(skills.getSkill("absent", workspace), /Skills disponibles : commun/);
    } finally {
        if (previous === undefined) delete process.env.FS_SKILLS_DIR;
        else process.env.FS_SKILLS_DIR = previous;
        fs.rmSync(userDir, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test("setFrontmatterValue : remplace, ajoute, conserve BOM/CRLF, crée le frontmatter", () => {
    assert.equal(
        skills.setFrontmatterValue("---\nname: a\ndisabled: false\n---\nCorps", "disabled", "true"),
        "---\nname: a\ndisabled: true\n---\nCorps"
    );
    assert.equal(
        skills.setFrontmatterValue("---\nname: a\n---\nCorps", "disabled", "true"),
        "---\nname: a\ndisabled: true\n---\nCorps"
    );
    assert.equal(
        skills.setFrontmatterValue("\uFEFF---\r\nname: a\r\ndescription: >\r\n  x\r\n---\r\nCorps\r\n", "description", "y"),
        "\uFEFF---\r\nname: a\r\ndescription: y\r\n---\r\nCorps\r\n"
    );
    assert.equal(
        skills.setFrontmatterValue("# Titre\nTexte", "disabled", "true"),
        "---\ndisabled: true\n---\n\n# Titre\nTexte"
    );
});

test("setSkillDisabled : désactive, réactive, conserve CRLF, sans frontmatter", async () => {
    const userDir = tmpDir();
    const previous = process.env.FS_SKILLS_DIR;
    process.env.FS_SKILLS_DIR = userDir;

    try {
        writeSkill(userDir, "revue", "---\r\nname: revue\r\ndescription: Relit\r\n---\r\nCorps\r\n");
        writeSkill(userDir, "brut", "# Brut\nTexte");

        const off = await skills.setSkillDisabled("REVUE", true, null);
        assert.equal(off.name, "revue");
        assert.equal(off.disabled, true);
        assert.equal(off.changed, true);
        const text = fs.readFileSync(off.file, "utf8");
        assert.equal(text, "---\r\nname: revue\r\ndescription: Relit\r\ndisabled: true\r\n---\r\nCorps\r\n");
        assert.doesNotMatch(await skills.catalog(null), /revue/);
        await assert.rejects(skills.getSkill("revue", null), /inconnu ou désactivé/);

        const again = await skills.setSkillDisabled("revue", true, null);
        assert.equal(again.changed, false);

        const on = await skills.setSkillDisabled("revue", false, null);
        assert.equal(on.changed, true);
        assert.equal(on.disabled, false);
        assert.match(await skills.catalog(null), /"revue" \(utilisateur\) : Relit/);
        assert.match(fs.readFileSync(on.file, "utf8"), /\r\ndisabled: false\r\n/);

        const brut = await skills.setSkillDisabled("brut", true, null);
        assert.equal(brut.changed, true);
        assert.equal(fs.readFileSync(brut.file, "utf8"), "---\ndisabled: true\n---\n\n# Brut\nTexte");
        assert.ok((await skills.listSkills(null)).find(s => s.name === "brut").disabled);

        await assert.rejects(skills.setSkillDisabled("absent", true, null), /Skill inconnu : absent/);
    } finally {
        if (previous === undefined) delete process.env.FS_SKILLS_DIR;
        else process.env.FS_SKILLS_DIR = previous;
        fs.rmSync(userDir, { recursive: true, force: true });
    }
});

test("validateToolCall : use_skill", () => {
    validateToolCall({ name: "use_skill", args: { name: "revue" } });
    assert.throws(() => validateToolCall({ name: "use_skill", args: {} }));
});
