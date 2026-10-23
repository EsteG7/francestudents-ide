"use strict";
/* global __dirname, process, window, document, console, openFile, renderEntry */
// Isolated documentation session: illustrative chat and quota, real UI and EffectCraft.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {_electron}=require("playwright-core");
async function main(){
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"frst-readme-")),project=path.join(dir,"aurora-demo"),images=path.join(root,"docs/images");
    fs.mkdirSync(project);fs.mkdirSync(images,{recursive:true});
    fs.writeFileSync(path.join(project,"index.html"),`<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aurora — Studio créatif</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="navigation">
    <a class="logo" href="#">aurora<span>®</span></a>
    <nav aria-label="Navigation principale">
      <a href="#projets">Nos projets</a>
      <a href="mailto:bonjour@example.com">Parlons de votre idée ↗</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <p class="eyebrow">DES IDÉES AUX PREMIÈRES IMPRESSIONS</p>
      <h1>Créons quelque chose<br>de remarquable.</h1>
      <p>Identité, expériences web et images en mouvement.</p>
      <a class="button" href="#projets">Découvrir nos projets ↗</a>
    </section>
    <section id="projets" aria-label="Nos projets récents">
      <article class="project-card">Une nouvelle perspective.</article>
    </section>
  </main>
</body>
</html>
`);
    fs.writeFileSync(path.join(project,"style.css"),`:root { color-scheme: dark; --accent: #a6efcb; }
body { margin: 0; background: #11151a; color: #f1f5f9; font: 18px system-ui; }
.navigation { display: flex; justify-content: space-between; padding: 32px 6vw; }
.logo { font-weight: 800; font-size: 28px; }
a { color: inherit; text-decoration: none; }
nav { display: flex; gap: 32px; }
.hero { padding: 100px 6vw; }
.eyebrow { color: var(--accent); letter-spacing: .15em; font-size: 12px; }
h1 { font-size: clamp(48px, 7vw, 100px); line-height: 1.05; }
.button { display: inline-block; margin-top: 24px; border-bottom: 1px solid var(--accent); }
`);
    fs.writeFileSync(path.join(project,"README.md"),"# Aurora\n\nProjet de démonstration de FranceStudent IDE.\n");
    const harness=path.join(dir,"launch.cjs");
    fs.writeFileSync(harness,`require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root,"src/api/agents"))}).listAgents=async()=>({agents:[{id:-1002,name:'GPT 6 Luna'}],source:'local'});require(${JSON.stringify(path.join(root,"src/api/account"))}).fetchUserUsage=async()=>({chatBudget:{usedPercent:18},rateLimits:[]});Object.assign(require(${JSON.stringify(path.join(root,"src/api/api"))}).usage,{requests:8,inputTokens:12400,outputTokens:3200,cachedTokens:4000,reported:1});require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir,FS_SKILLS_DIR:path.join(dir,"skills"),FS_MCP_CONFIG:path.join(dir,"mcp.json")};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:require("electron"),args:[harness,"--user-data-dir="+path.join(dir,"electron")],cwd:root,env});
    try{
        const page=await app.firstWindow();
        await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,1000));
        await page.locator("#startup-loading").waitFor({state:"hidden"});
        if(await page.locator("#guide-close").isVisible())await page.locator("#guide-close").click();
        if(await page.locator("#release-highlights[open]").isVisible())await page.locator("#release-highlights").getByRole("button",{name:"C’est parti !",exact:true}).click();
        await page.evaluate(p=>window.frst.openProject(p),project);
        await page.evaluate(()=>openFile("index.html"));
        await page.locator(".cm-editor").waitFor();
        const chat=async(user,answer)=>page.evaluate(({user,answer})=>{document.querySelector("#transcript").replaceChildren();renderEntry({type:"user",text:user});renderEntry({type:"assistant",text:answer});},{user,answer});
        const shot=async name=>{await page.mouse.move(5,5);await page.waitForTimeout(600);await page.screenshot({path:path.join(images,name),animations:"disabled"});};
        await chat("Crée une page d’accueil pour Aurora, un studio créatif. Je veux une interface sobre et accessible.","La structure est prête : une navigation claire, un titre affirmé et un lien vers les projets.\n\nLes styles sont regroupés dans `style.css`. La page s’adapte aux petits écrans et la navigation possède ses repères d’accessibilité.\n\nTu peux maintenant personnaliser les textes et les couleurs.");
        await shot("mode-code.png");
        await page.locator("#st-usage").click();await page.locator("#usage-dashboard").waitFor();await shot("suivi-usage.png");
        await page.locator('[data-agent-tab="conversation"]').click();
        await page.locator("#btn-motion").click();await page.locator("#motion-consent-ok").click();
        await page.waitForFunction(()=>/prêt/i.test(document.querySelector("#motion-engine-status").textContent),null,{timeout:60000});
        const execute=async(command,params)=>page.evaluate(({command,params})=>window.frst.effectCraftControl({method:"engine.execute",params:{command,params}}),{command,params});
        await execute("comp.new",{});
        await execute("layer.newText",{text:"AURORA",name:"Titre principal",position:[960,440],size:190,fill:"#a6efcb"});
        await execute("layer.newText",{text:"Les idées prennent vie.",name:"Signature",position:[960,640],size:64,fill:"#e2e8f0"});
        await execute("layer.newText",{text:"STUDIO CRÉATIF  /  2026",name:"Repère",position:[960,260],size:30,fill:"#94a3b8"});
        await chat("Prépare un titre pour Aurora avec une signature et une palette vert menthe.","La composition est prête dans EffectCraft :\n\n- Un titre AURORA au centre.\n- Une signature sur une ligne séparée.\n- Trois calques de texte faciles à modifier.\n\nTu peux ajuster le résultat dans l’éditeur ou me demander la prochaine étape de l’animation.");
        await execute("edit.deselectAll",{});
        await page.locator("#motion-local-save").click();await page.waitForTimeout(2400);await shot("mode-motion.png");
        await page.locator("#motion-skills").click();await page.locator("#motion-marketplace").waitFor();await shot("skills-motion.png");
        console.log("Documentation screenshots saved in docs/images (isolated demo data).");
    }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
