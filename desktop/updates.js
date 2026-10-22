"use strict";
const {EventEmitter}=require("node:events");
function createUpdateController({updater,enabled=false,version="",getPreference=()=>true,savePreference=()=>{},onChange=()=>{},checkRelease=null}={}) {
    const state={version,status:enabled?"idle":"unavailable",availableVersion:null,progress:0,automatic:getPreference(),message:enabled?"Les mises à jour sont distribuées via les versions GitHub publiées.":"Les mises à jour automatiques seront disponibles dans la version Windows installée. Le mode développement et la version portable restent manuels."};
    const publish=patch=>{Object.assign(state,patch);onChange({...state});};
    state.canInstall=enabled;
    if(checkRelease){state.status="idle";state.message="Vérification des versions publiées disponible. Les mises à jour de la version portable restent manuelles.";}
    let checking=null,downloading=null;
    if(enabled&&updater){
        updater.autoDownload=state.automatic;updater.autoInstallOnAppQuit=state.automatic;
        updater.on("checking-for-update",()=>publish({status:"checking",message:"Recherche d’une nouvelle version…"}));
        updater.on("update-available",info=>publish({status:"available",availableVersion:info.version,message:`La version ${info.version} est disponible.`}));
        updater.on("update-not-available",()=>publish({status:"current",message:"Cette application est à jour par rapport à la version publiée."}));
        updater.on("download-progress",info=>publish({status:"downloading",progress:Math.max(0,Math.min(100,info.percent||0)),message:"Téléchargement de la mise à jour en arrière-plan…"}));
        updater.on("update-downloaded",info=>publish({status:"downloaded",availableVersion:info.version,progress:100,message:state.automatic?"Mise à jour prête. Elle sera installée à la fermeture de l’application.":"Mise à jour prête. Enregistre ton travail puis redémarre pour l’installer."}));
        updater.on("error",()=>publish({status:"error",message:"La source de mises à jour est indisponible ou aucune version compatible n’est publiée. Tu peux réessayer plus tard."}));
    }
    async function action(type,payload={}) {
        if(type==="status")return {...state};
        if(type==="automatic"){state.automatic=payload.enabled===true;savePreference(state.automatic);if(updater){updater.autoDownload=state.automatic;updater.autoInstallOnAppQuit=state.automatic;}publish({automatic:state.automatic});return {...state};}
        if((!enabled||!updater)&&type==="check"&&checkRelease){
            if(!checking){publish({status:"checking",message:"Recherche de mises à jour…"});checking=Promise.resolve().then(()=>checkRelease(version)).then(publish).catch(()=>publish({status:"error",message:"Vérification impossible. Tu peux continuer et réessayer plus tard."})).finally(()=>{checking=null;});}
            await checking;return {...state};
        }
        if(!enabled||!updater)return {...state};
        if(type==="check"){
            if(["downloading","downloaded"].includes(state.status))return {...state};
            if(!checking)checking=Promise.resolve().then(()=>{if(payload.startup)updater.autoDownload=false;return updater.checkForUpdates();}).catch(()=>publish({status:"error",message:"Impossible de vérifier la version publiée. Vérifie la connexion ou réessaie plus tard."})).finally(()=>{updater.autoDownload=state.automatic;checking=null;});
            await checking;
        }else if(type==="download"){
            if(downloading||state.status==="downloading"||state.status==="downloaded")return {...state};
            if(state.status!=="available")throw new Error("Aucune mise à jour disponible à télécharger.");
            publish({status:"downloading",progress:0,message:"Téléchargement de la mise à jour…"});
            downloading=Promise.resolve().then(()=>updater.downloadUpdate()).catch(()=>publish({status:"error",message:"Le téléchargement a échoué. Réessaie ou continue sans mettre à jour."})).finally(()=>{downloading=null;});
            await downloading;
        }else if(type==="install"){
            if(state.status!=="downloaded")throw new Error("Télécharge d’abord la mise à jour.");
            updater.quitAndInstall(false,true);
        }else throw new Error("Action de mise à jour inconnue.");
        return {...state};
    }
    return {action,events:updater instanceof EventEmitter?updater:null};
}
module.exports={createUpdateController};
