"use strict";

const releasesUrl="https://api.github.com/repos/extraopaa/francestudents-ide/releases?per_page=100";
function parseVersion(value){
    const match=/^v?(\d+)\.(\d+)\.(\d+)(?:-mac\.(\d+))?$/.exec(String(value));
    return match?match.slice(1).map((part,index)=>part===undefined&&index===3?Infinity:Number(part)):null;
}
function compare(a,b){for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]>b[i]?1:-1;}return 0;}
async function checkMacRelease(version,arch=process.arch,fetchImpl=fetch){
    const current=parseVersion(version);
    if(!current||!["arm64","x64"].includes(arch))throw new Error("Version ou architecture Mac non prise en charge.");
    const response=await fetchImpl(releasesUrl,{headers:{Accept:"application/vnd.github+json"},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error("Source de mises à jour indisponible.");
    const releases=await response.json();
    if(!Array.isArray(releases))throw new Error("Réponse de mise à jour invalide.");
    const candidates=[];
    for(const release of releases){
        const parsed=parseVersion(release.tag_name);
        if(release.draft||!parsed||(release.prerelease&&parsed[3]===Infinity)||compare(parsed,current)<=0)continue;
        const next=String(release.tag_name).replace(/^v/,"");
        const name=`FranceStudentIDE-${next}-mac-${arch}.dmg`;
        const asset=release.assets?.find(item=>item.name===name&&item.state==="uploaded");
        const expected=`https://github.com/extraopaa/francestudents-ide/releases/download/${release.tag_name}/${name}`;
        if(asset?.browser_download_url!==expected)continue;
        candidates.push({parsed,version:next,url:expected});
    }
    candidates.sort((a,b)=>compare(b.parsed,a.parsed));
    const next=candidates[0];
    return {status:next?"available":"current",availableVersion:next?.version||null,downloadUrl:next?.url||null,canInstall:false,manualPlatform:"darwin",message:next?`La version ${next.version} est disponible pour Mac ${arch==="arm64"?"Apple Silicon":"Intel"}. Télécharge l’installateur, puis installe-le manuellement.`:"Aucune version Mac compatible plus récente disponible."};
}
module.exports={checkMacRelease};
