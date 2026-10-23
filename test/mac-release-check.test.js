"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {checkMacRelease}=require("../desktop/mac-release-check");
const {createUpdateController}=require("../desktop/updates");
function release(version,arch="arm64",extra={}){
    const tag=`v${version}`,name=`FranceStudentIDE-${version}-mac-${arch}.dmg`;
    return {tag_name:tag,prerelease:version.includes("-"),assets:[{name,state:"uploaded",browser_download_url:`https://github.com/extraopaa/francestudents-ide/releases/download/${tag}/${name}`}],...extra};
}
test("Mac selects the newest compatible installer, including numeric beta ordering",async()=>{
    const data=[release("1.3.3-mac.2"),release("1.3.3-mac.10"),release("9.0.0","x64"),release("1.3.3-mac.20","arm64",{draft:true})];
    const fetchImpl=async()=>Response.json(data);
    const result=await checkMacRelease("1.3.3-mac.1","arm64",fetchImpl);
    assert.equal(result.availableVersion,"1.3.3-mac.10");assert.match(result.downloadUrl,/mac-arm64\.dmg$/);assert.equal(result.canInstall,false);
    assert.equal((await checkMacRelease("1.3.3-mac.1","x64",fetchImpl)).availableVersion,"9.0.0");
    assert.equal((await checkMacRelease("9.0.0","x64",fetchImpl)).status,"current");
});
test("Mac rejects foreign downloads and missing assets and never downgrades stable builds",async()=>{
    const foreign=release("2.0.0");foreign.assets[0].browser_download_url="https://example.com/malicious.dmg";
    const data=[foreign,release("1.3.3-mac.99"),release("3.0.0","arm64",{assets:[]})];
    assert.equal((await checkMacRelease("1.3.3","arm64",async()=>Response.json(data))).status,"current");
    await assert.rejects(checkMacRelease("1.0.0","ia32"),/architecture/);
    await assert.rejects(checkMacRelease("1.0.0","arm64",async()=>new Response("offline",{status:503})),/indisponible/);
    await assert.rejects(checkMacRelease("1.0.0","arm64",async()=>Response.json({})),/invalide/);
});
test("Mac download opens only a checked installer and never invokes automatic installation",async()=>{
    const opened=[];
    const controller=createUpdateController({version:"1.3.3-mac.1",manualPlatform:"darwin",checkRelease:()=>checkMacRelease("1.3.3-mac.1","arm64",async()=>Response.json([release("1.3.3-mac.2")])),openDownload:url=>opened.push(url)});
    await controller.action("download",{downloadUrl:"https://example.com"});assert.deepEqual(opened,[]);
    await controller.action("check");await controller.action("download",{downloadUrl:"https://example.com"});
    assert.equal(opened.length,1);assert.match(opened[0],/github\.com\/extraopaa\/francestudents-ide\/releases\/download\/v1\.3\.3-mac\.2\//);
    assert.equal((await controller.action("install")).canInstall,false);
    assert.equal((await controller.action("status")).manualPlatform,"darwin");
});
