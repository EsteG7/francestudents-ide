"use strict";
/* Build the actual EffectCraft UI with our reproducible source patch, not CSS over its canvas. */
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const ROOT=path.resolve(__dirname,".."),SOURCE=path.join(ROOT,"release","effectcraft-source"),TARGET=path.join(ROOT,"release","effectcraft-target"),VENDOR=path.join(ROOT,"desktop","vendor-effectcraft"),PATCH=path.join(ROOT,"patches","effectcraft-francestudent.patch");
const COMMIT="9581b53c3f8945683252af0eb5fac79e0e43aed4",VERSION="0.16.0-francestudent.1";
const hash=data=>crypto.createHash("sha256").update(data).digest("hex");
function run(command,args,options={}){
    const result=spawnSync(command,args,{cwd:SOURCE,windowsHide:true,stdio:"inherit",...options});
    if(result.error)throw result.error;
    if(result.status!==0)throw new Error(`${command} a échoué (code ${result.status}).`);
    return result.stdout?.toString().trim();
}
function checkedChild(target,parent){
    const relative=path.relative(parent,path.resolve(target));
    if(!relative || relative.startsWith("..") || path.isAbsolute(relative))throw new Error(`Chemin de build refusé : ${target}`);
}
function main(args=process.argv.slice(2)){
    const patchHash=hash(fs.readFileSync(PATCH));
    const wasm=path.join(VENDOR,"web","effectcraft_web_bg.wasm");
    try{
        const installed=JSON.parse(fs.readFileSync(path.join(VENDOR,"VERSION.json"),"utf8"));
        if(!args.includes("--force") && installed.version===VERSION && installed.patchSha256===patchHash && installed.wasmSha256===hash(fs.readFileSync(wasm))){console.log(`EffectCraft ${VERSION} déjà compilé et vérifié.`);return;}
    }catch(error){if(args.includes("--check"))throw new Error("Le build EffectCraft FranceStudent est absent ou incomplet.",{cause:error});}
    if(args.includes("--check"))throw new Error("EffectCraft doit être reconstruit avec npm run vendor:effectcraft.");
    checkedChild(SOURCE,ROOT);checkedChild(TARGET,ROOT);checkedChild(VENDOR,ROOT);
    if(!fs.existsSync(path.join(SOURCE,".git"))){fs.mkdirSync(path.dirname(SOURCE),{recursive:true});run("git",["clone","--depth","1","--branch","v0.16.0","https://github.com/storytold/effectcraft.git",SOURCE],{cwd:ROOT});}
    if(run("git",["rev-parse","HEAD"],{stdio:"pipe"})!==COMMIT)throw new Error("La révision source d’EffectCraft ne correspond pas au commit épinglé.");
    const reversed=spawnSync("git",["apply","--reverse","--check",PATCH],{cwd:SOURCE,windowsHide:true,stdio:"pipe"});
    if(reversed.status!==0){run("git",["apply","--check",PATCH]);run("git",["apply",PATCH]);}
    const actualPatch=run("git",["diff","--binary"],{stdio:"pipe"}).replace(/\r\n/g,"\n");
    if(actualPatch.trim()!==fs.readFileSync(PATCH,"utf8").replace(/\r\n/g,"\n").trim())throw new Error("Des changements locaux non prévus existent dans les sources EffectCraft. Ils ont été conservés ; vérifie-les avant de compiler.");
    if(!args.includes("--install-only")){
        const cargoBin=path.join(os.homedir(),".cargo","bin"),cargo=path.join(cargoBin,process.platform==="win32"?"cargo.exe":"cargo");
        const env={...process.env,PATH:cargoBin+path.delimiter+process.env.PATH,CARGO_TARGET_DIR:TARGET};
        run(fs.existsSync(cargo)?cargo:"cargo",["xtask","web"],{env});
    }
    const dist=path.join(TARGET,"web","dist"),staging=path.join(VENDOR,"web-custom.tmp"),web=path.join(VENDOR,"web");
    if(!fs.existsSync(path.join(dist,"effectcraft_web_bg.wasm")) || !fs.existsSync(path.join(dist,"index.html")))throw new Error("Build web EffectCraft incomplet.");
    for(const target of [staging,web])checkedChild(target,VENDOR);
    fs.mkdirSync(VENDOR,{recursive:true});fs.rmSync(staging,{recursive:true,force:true});fs.cpSync(dist,staging,{recursive:true});
    for(const file of ["LICENSE-MIT","LICENSE-APACHE"])fs.copyFileSync(path.join(SOURCE,file),path.join(staging,file));
    fs.writeFileSync(path.join(staging,"FRANCESTUDENT-BUILD.txt"),`EffectCraft ${VERSION}\nUpstream: ${COMMIT}\nPatch SHA-256: ${patchHash}\nModified interface for FranceStudent IDE. Original EffectCraft authors retain their credits.\n`);
    fs.rmSync(web,{recursive:true,force:true});fs.renameSync(staging,web);
    fs.writeFileSync(path.join(VENDOR,"VERSION.json"),JSON.stringify({version:VERSION,upstreamVersion:"0.16.0",sourceCommit:COMMIT,patchSha256:patchHash,wasmSha256:hash(fs.readFileSync(wasm)),source:"https://github.com/storytold/effectcraft",license:"MIT OR Apache-2.0"},null,2));
    console.log(`EffectCraft ${VERSION} installé : interface interne reconstruite.`);
}
module.exports={main,COMMIT,VERSION,checkedChild};
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
