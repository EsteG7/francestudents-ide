"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const {spawn, execFile} = require("node:child_process");
const {promisify} = require("node:util");
const {resolveInWorkspace} = require("../src/tools/security");
const exec = promisify(execFile);
const quote = value => `'${String(value).replace(/'/g,"''")}'`;
function shellCommand(command) {
    const script=`$ErrorActionPreference='Stop'; try { ${command}; if($null -ne $LASTEXITCODE){exit $LASTEXITCODE} } catch { Write-Error $_ -ErrorAction Continue; exit 1 }`;
    return process.platform === "win32" ? {file:"powershell.exe", args:["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")]} : {file:"/bin/sh",args:["-c",command]};
}
function programCommand(file, args) {
    if (process.platform === "win32") return shellCommand(`& ${quote(file)} ${args.map(quote).join(" ")}; exit $LASTEXITCODE`);
    return {file,args};
}
async function readJson(workspace, rel) {
    const {target} = await resolveInWorkspace(workspace, rel);
    try { if ((await fs.stat(target)).size > 1000000) throw new Error(`${rel} est trop volumineux.`); return JSON.parse(await fs.readFile(target,"utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function discover(workspace) {
    if (!workspace) return {name:"Aucun projet",workspace:null, tasks:[], stack:[], docs:[], packageManager:null};
    const entries = await fs.readdir(workspace);
    const pkg = await readJson(workspace,"package.json");
    const manager = /^pnpm@/.test(pkg?.packageManager || "") || entries.includes("pnpm-lock.yaml") ? "pnpm" : /^yarn@/.test(pkg?.packageManager || "") || entries.includes("yarn.lock") ? "yarn" : /^bun@/.test(pkg?.packageManager || "") || entries.some(file => ["bun.lock","bun.lockb"].includes(file)) ? "bun" : "npm";
    const tasks = [];
    if (pkg?.scripts && typeof pkg.scripts === "object") for (const [name, script] of Object.entries(pkg.scripts).slice(0,200)) {
        if (typeof script !== "string") continue;
        tasks.push({id:`package:${name}`,name,description:script.slice(0,1000),source:"package.json",command:`${manager} run ${JSON.stringify(name)}`,program:manager + (process.platform === "win32" ? ".cmd" : ""),args:["run",name],kind:/test/.test(name)?"test":/build/.test(name)?"build":/lint|check|format/.test(name)?"quality":/dev|start|serve/.test(name)?"dev":"task"});
    }
    if (entries.includes("Cargo.toml")) for (const name of ["check","test","build"]) tasks.push({id:`cargo:${name}`,name:`cargo ${name}`,description:"Commande Rust détectée",source:"Cargo.toml",command:`cargo ${name}`,program:"cargo",args:[name],kind:name === "test"?"test":"build"});
    if (entries.includes("go.mod")) for (const name of ["test","build"]) tasks.push({id:`go:${name}`,name:`go ${name}`,description:"Tous les packages du module Go",source:"go.mod",command:`go ${name} ./...`,program:"go",args:[name,"./..."],kind:name});
    const custom = await readJson(workspace,".frst/ide-tasks.json");
    if (custom !== null && (!Array.isArray(custom.tasks) || custom.tasks.length > 100)) throw new Error(".frst/ide-tasks.json doit contenir une liste tasks (100 maximum).");
    for (const task of custom?.tasks || []) {
        if (!task || typeof task.id !== "string" || typeof task.name !== "string" || typeof task.command !== "string" || !task.command.trim() || task.command.length > 8000) continue;
        tasks.push({id:`custom:${task.id}`,name:task.name.slice(0,100),description:task.description || "Commande personnelle",source:".frst/ide-tasks.json",command:task.command,kind:"custom"});
    }
    const stack = [];
    const deps = {...pkg?.dependencies,...pkg?.devDependencies};
    for (const [key,label] of [["react","React"],["vue","Vue"],["next","Next.js"],["vite","Vite"],["typescript","TypeScript"],["electron","Electron"],["svelte","Svelte"],["astro","Astro"]]) if (deps[key]) stack.push(label);
    if (pkg) stack.unshift("Node.js");
    if (entries.includes("pyproject.toml") || entries.includes("requirements.txt")) stack.push("Python");
    if (entries.includes("Cargo.toml")) stack.push("Rust");
    if (entries.includes("go.mod")) stack.push("Go");
    const docs = entries.filter(file => /^(readme|contributing|changelog|agents)(\.|$)/i.test(file) && /\.(md|txt)$/i.test(file)).slice(0,12);
    return {name:String(pkg?.name || path.basename(workspace)),description:String(pkg?.description || ""),workspace,tasks,stack,docs,packageManager:pkg?manager:null};
}
function createProjectStudio({workspace = () => null, onEvent = () => {}} = {}) {
    const runs = new Map(); let nextId = 1; let mutation = Promise.resolve();
    const snapshot = job => ({id:job.id,taskId:job.taskId,name:job.name,command:job.command,workspace:job.workspace,server:job.server,status:job.status,startedAt:job.startedAt,endedAt:job.endedAt,exitCode:job.exitCode,output:job.output,truncated:job.truncated});
    const emit = job => onEvent(snapshot(job));
    async function start(id, hint = null) {
        const current = workspace();
        const task = hint ? { ...await require("./server-hints").validateServerHint(current, hint), id, name: "Serveur web local", server: hint } : (await discover(current)).tasks.find(task => task.id === id);
        if (!task) throw new Error("Tâche introuvable. Actualise le projet.");
        if ([...runs.values()].filter(job => job.status === "running").length >= 4) throw new Error("Quatre tâches tournent déjà. Arrête une tâche avant d’en lancer une autre.");
        if ([...runs.values()].some(job => job.workspace === current && job.taskId === id && job.status === "running")) throw new Error("Cette tâche tourne déjà.");
        while (runs.size >= 30) {
            const oldest = [...runs.values()].find(job => job.status !== "running");
            if (!oldest) break; runs.delete(oldest.id);
        }
        const command = task.program ? programCommand(task.program,task.args) : shellCommand(task.command);
        const child = spawn(command.file,command.args,{cwd:task.cwd || current,env:{...process.env,FORCE_COLOR:"0"},windowsHide:true,detached:process.platform !== "win32",stdio:["ignore","pipe","pipe"]});
        const job = {id:nextId++,taskId:id,name:task.name,command:task.command,workspace:current,child,status:"running",startedAt:Date.now(),endedAt:null,exitCode:null,output:"",truncated:false};
        runs.set(job.id,job);
        job.server = task.server || null;
        let outputTimer=null;
        const append = chunk => {
            job.output += String(chunk).replace(/\x1b\[[0-9;]*[A-Za-z]/g,"");
            if (job.output.length > 150000) {job.output = job.output.slice(-150000);job.truncated = true;}
            if(!outputTimer)outputTimer=setTimeout(()=>{outputTimer=null;emit(job);},50);
        };
        child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
        child.stdout.on("data",append); child.stderr.on("data",append);
        child.on("error",error => {append(error.message + "\n"); job.status="failed";job.endedAt=Date.now();emit(job);});
        child.on("close",code => {clearTimeout(outputTimer);if(job.status === "running")job.status=job.stopRequested?"stopped":code===0?"passed":"failed";job.exitCode=code;job.endedAt=Date.now();emit(job);});
        emit(job);return snapshot(job);
    }
    async function stop(id) {
        const job = runs.get(Number(id));
        if (!job || job.status !== "running") return false;
        if(job.stopPromise)return job.stopPromise;
        job.stopRequested=true;
        job.stopPromise=(async()=>{
            const closed=new Promise(resolve=>{if(job.child.exitCode!==null||job.child.signalCode!==null)resolve();else job.child.once("close",resolve);});
            if (process.platform === "win32") await new Promise((resolve,reject)=>execFile("taskkill",["/pid",String(job.child.pid),"/T","/F"],{windowsHide:true},error=>{if(error&&job.child.exitCode===null&&job.child.signalCode===null)reject(error);else resolve();}));
            else {try {process.kill(-job.child.pid,"SIGTERM");} catch {job.child.kill("SIGTERM");}}
            let timer;
            try{await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Le processus n’a pas confirmé son arrêt.")),5000);})]);}
            finally{clearTimeout(timer);}
            job.status="stopped";job.endedAt=Date.now();emit(job);return true;
        })();
        try{return await job.stopPromise;}
        catch(error){job.stopPromise=null;job.stopRequested=false;emit(job);throw error;}
    }
    async function addTask(payload,remove=false) {
        const current = workspace(); if(!current) throw new Error("Ouvre un dossier de projet.");
        const name=String(payload.name||"").trim(), command=String(payload.command||"").trim();
        if(!remove&&(!name || name.length>100 || !command || command.length>8000))throw new Error("Donne un nom (100 caractères maximum) et une commande (8 000 maximum).");
        const {target}=await resolveInWorkspace(current,".frst/ide-tasks.json");
        const config=await readJson(current,".frst/ide-tasks.json") || {tasks:[]};
        if(!Array.isArray(config.tasks)||(!remove&&config.tasks.length>=100))throw new Error("Liste de tâches invalide ou complète.");
        if(remove){const id=String(payload.id||"").replace(/^custom:/,"");if(!config.tasks.some(task=>task.id===id))throw new Error("Commande personnelle introuvable.");await fs.writeFile(target+".backup",JSON.stringify(config,null,2)+"\n");config.tasks=config.tasks.filter(task=>task.id!==id);}
        else config.tasks.push({id:require("node:crypto").randomUUID(),name,command});
        await fs.mkdir(path.dirname(target),{recursive:true});
        const temp=target+".tmp";
        await fs.writeFile(temp,JSON.stringify(config,null,2)+"\n"); await fs.rename(temp,target);
        return discover(current);
    }
    async function action(type,payload={}) {
        if(type === "overview")return {...await discover(workspace()),runs:[...runs.values()].filter(job=>job.workspace===workspace()).map(snapshot)};
        if(type === "runs")return [...runs.values()].filter(job=>job.workspace===workspace()).map(snapshot);
        if(type === "start")return start(payload.id);
        if(type === "serverStart") {
            const hint = require("./server-hints").parseServerHint(String(payload.text || ""));
            if (!hint) throw new Error("Commande ou adresse locale ambiguë : utilise les Exécutions du projet.");
            if(payload.workspace !== workspace()) throw new Error("Le projet ouvert a changé. Reviens au projet de cette réponse.");
            return start("server:" + hint.key, hint);
        }
        if(type === "stop")return stop(payload.id);
        if(type === "add"||type === "remove") {const op=mutation.then(()=>addTask(payload,type==="remove"));mutation=op.catch(()=>{});return op;}
        if(type === "clear") {for(const [id,job]of runs)if(job.status!=="running"&&job.workspace===workspace())runs.delete(id);return true;}
        throw new Error("Action de projet inconnue.");
    }
    return {action,get runningCount(){return [...runs.values()].filter(job=>job.status==="running").length;},stopAll(){return Promise.allSettled([...runs.keys()].map(stop));}};
}
let diagnosticsPromise = null; let diagnosticsAt = 0;
async function environmentDiagnostics() {
    if(diagnosticsPromise && Date.now()-diagnosticsAt<30000)return diagnosticsPromise;
    diagnosticsAt=Date.now();
    diagnosticsPromise=Promise.all([["Node.js","node",["--version"]],["npm",process.platform==="win32"?"npm.cmd":"npm",["--version"]],["Git","git",["--version"]]].map(async([name,file,args])=>{
        try {const cmd=programCommand(file,args);const result=await exec(cmd.file,cmd.args,{timeout:7000,windowsHide:true,maxBuffer:20000});return {name,available:true,version:result.stdout.trim().slice(0,160)};}
        catch{return {name,available:false,version:"Non trouvé dans le PATH"};}
    }));
    return diagnosticsPromise;
}
module.exports={createProjectStudio,discover,environmentDiagnostics,programCommand};
