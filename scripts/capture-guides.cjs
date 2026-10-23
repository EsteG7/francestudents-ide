"use strict";
/* global __dirname, process, console, window, document, openConnectionGuide, closeConnectionGuide, openFile, renderEntry, DataTransfer, File */
// User guides use an isolated demo account; no credentials or paid API calls.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{execFileSync}=require("node:child_process"),{_electron}=require("playwright-core");
async function main(){
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(process.env.PUBLIC||os.tmpdir(),"frst-guides-")),project=path.join(dir,"aurora-demo"),images=path.join(root,"docs/images");fs.mkdirSync(project);
    fs.writeFileSync(path.join(project,"index.html"),'<!doctype html>\n<html lang="fr">\n  <head><meta charset="UTF-8"><title>Aurora</title></head>\n  <body><h1>Les idées prennent vie.</h1></body>\n</html>\n');
    fs.writeFileSync(path.join(project,"package.json"),JSON.stringify({name:"aurora-demo",scripts:{dev:"node serve.js",test:"node --test"}},null,2));
    fs.writeFileSync(path.join(project,"README.md"),"# Aurora\n\nProjet de démonstration des guides FranceStudent IDE.\n");
    execFileSync("git",["init","-b","main",project],{windowsHide:true});execFileSync("git",["remote","add","origin","https://github.com/example/aurora-demo.git"],{cwd:project,windowsHide:true});
    execFileSync("git",["-c","user.name=Demo","-c","user.email=demo@example.invalid","commit","--allow-empty","-m","Projet de demonstration"],{cwd:project,windowsHide:true});
    const harness=path.join(dir,"launch.cjs");
    fs.writeFileSync(harness,`globalThis.docsConnected=false;require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>globalThis.docsConnected?{ok:true}:{ok:false,needsLogin:true};require(${JSON.stringify(path.join(root,"src/api/agents"))}).listAgents=async()=>({agents:[{id:-1002,name:'GPT 6 Luna'}],source:'local'});require(${JSON.stringify(path.join(root,"src/api/api"))}).requestModel=async()=>"Projet de démonstration Aurora.";require(${JSON.stringify(path.join(root,"src/api/account"))}).fetchUserUsage=async()=>({chatBudget:{usedPercent:18},rateLimits:[]});require(${JSON.stringify(path.join(root,"src/github"))}).saveAuth({token:'DEMO_NOT_A_REAL_TOKEN',login:'compte-demo'});globalThis.fetch=async(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Documentation: writes disabled');if(url.endsWith('/user'))return Response.json({login:'compte-demo'});if(url.endsWith('/repos/example/aurora-demo'))return Response.json({full_name:'example/aurora-demo',permissions:{push:true}});if(url.includes('/releases?'))return Response.json([{id:1,name:'Première version Aurora',tag_name:'v0.1.0',draft:true,body:'Brouillon de démonstration : relire les notes avant publication.',html_url:'https://github.com/example/aurora-demo',assets:[]}]);return Response.json([]);};require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir,FS_SKILLS_DIR:path.join(dir,"skills"),FS_MCP_CONFIG:path.join(dir,"mcp.json")};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:require("electron"),args:[harness,"--user-data-dir="+path.join(dir,"electron")],env,cwd:root});
    try{
        const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,1000));
        await page.locator("#startup-loading").waitFor({state:"hidden"});
        const shot=async(name,selector)=>{await page.mouse.move(5,5);await page.waitForTimeout(500);await (selector?page.locator(selector):page).screenshot({path:path.join(images,name),animations:"disabled"});};
        await page.locator("#connection-guide:not(.hidden)").waitFor();await shot("connexion-compte.png","#connection-guide .connection-guide");
        await app.evaluate(()=>{globalThis.docsConnected=true;});await page.evaluate(()=>window.frst.bootstrap());
        await page.evaluate(p=>window.frst.openProject(p),project);
        await page.evaluate(()=>openConnectionGuide(2));await shot("connexion-projet.png","#connection-guide .connection-guide");
        await page.evaluate(()=>openConnectionGuide(3));await shot("connexion-premiere-demande.png","#connection-guide .connection-guide");
        await page.evaluate(()=>{closeConnectionGuide();document.querySelector("#transcript").replaceChildren();renderEntry({type:"user",text:"Aide-moi à organiser le projet Aurora."});renderEntry({type:"assistant",text:"Tu peux retrouver les commandes, les documents et les outils locaux dans le cockpit. Les réglages permettent de choisir les autorisations de l’agent."});});
        await page.evaluate(()=>openFile("index.html"));
        await page.locator("#eco-mode-toggle").click();await shot("mode-eco.png","#eco-mode-dialog");await page.locator("#eco-mode-cancel").click();
        await page.locator("#conversation-import").click();await page.locator("#conversation-import-text").fill("## User\nPrépare une page pour Aurora, mon studio créatif.\n## Assistant\nLa page doit présenter le studio, ses projets et un contact. La navigation reste à compléter.");await page.locator("#conversation-import-preview").click();await page.locator("#conversation-import-apply:enabled").waitFor();await shot("import-codex.png","#conversation-import-dialog");await page.keyboard.press("Escape");
        await page.locator('[data-view="settings"]').click();await page.locator('[data-category="access"]').click();await shot("parametres-autorisations.png");
        await page.locator('[data-view="project"]').click();await page.locator("#studio-project-name").waitFor();await shot("cockpit-projet.png");
        await page.evaluate(()=>document.querySelector("#gh-connector-open").click());await page.waitForFunction(()=>document.querySelector("#github-connector-list").textContent.includes("Première version Aurora"));await shot("connecteur-github.png","#github-connector-dialog");await page.locator("#github-connector-close").click();
        await page.evaluate(()=>openFile("index.html"));await page.evaluate(()=>{document.querySelector("#transcript").replaceChildren();renderEntry({type:"user",text:"Comment revoir le site Aurora en local ?"});renderEntry({type:"assistant",text:"Pour revoir le site, lance `node serve.js` dans `aurora-demo`, puis ouvre http://127.0.0.1:8091/."});});await page.locator(".message-server-controls").waitFor();await shot("serveur-local.png","#agent");
        await page.evaluate(()=>{document.querySelector("#transcript").replaceChildren();renderEntry({type:"user",text:"Comment joindre mon brief et mon logo ?"});renderEntry({type:"assistant",text:"Dépose tes fichiers dans le chat ou utilise le trombone. Vérifie les pièces jointes sous la saisie, précise ce que tu veux examiner, puis envoie ton message quand tu es prêt."});});
        await page.locator("#input").fill("Compare le brief et les couleurs du logo. Ne modifie pas les fichiers.");
        const transfer=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(["Palette : menthe, ardoise. Site accessible, navigation simple."],"brief-aurora.txt",{type:"text/plain"}));data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#11151a"/><text x="35" y="105" font-size="48" fill="#a6efcb">AURORA</text></svg>'],"logo-aurora.svg",{type:"image/svg+xml"}));return data;});
        await page.dispatchEvent("#input","drop",{dataTransfer:transfer});await page.locator(".attachment-chip").first().waitFor();await shot("pieces-jointes.png","#agent");
        console.log("Guide screenshots captured with isolated demo data.");
    }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

