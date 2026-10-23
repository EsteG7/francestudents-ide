"use strict";
// Maintain this short summary with each release. Unknown versions get a safe fallback.
const releases={
    "1.3.3-mac.2":{headline:"Les nouvelles versions Mac, plus faciles a trouver.",items:[
        {icon:"clock",title:"Verification automatique",text:"L’IDE recherche les nouvelles versions Mac au demarrage et toutes les quatre heures."},
        {icon:"tools",title:"Le bon installateur",text:"Un bouton ouvre le telechargement Intel ou Apple Silicon. L’installation reste manuelle."}
    ]},
    "1.3.3-mac.1":{headline:"FranceStudent IDE arrive sur Mac en beta.",items:[
        {icon:"spark",title:"Intel et Apple Silicon",text:"Une application adaptee a chaque architecture Mac."},
        {icon:"tools",title:"EffectCraft et terminal integres",text:"Le studio motion design et le terminal sont verifies dans les applications empaquetees."},
        {icon:"chat",title:"Une premiere beta",text:"Enregistre regulierement ton travail et signale les problemes rencontres."}
    ]},
    "1.3.3":{headline:"Un IDE plus clair, du chat au studio.",items:[
        {icon:"spark",title:"FranceStudent IDE",text:"Un nouveau nom et une interface plus soignée, avec un studio EffectCraft réorganisé."},
        {icon:"chat",title:"Tes conversations, mieux rangées",text:"Des cartes lisibles, des titres proposés par l’IA et un chat vide quand tu démarres une nouvelle conversation."},
        {icon:"clock",title:"Le quota, sans surprise",text:"Erreurs expliquées, compte à rebours de réinitialisation et vérification d’un reset accordé par le staff."},
        {icon:"tools",title:"Des skills plus simples à gérer",text:"Installer ou désinstaller depuis la même carte, avec un bouton rouge pour la suppression."}
    ]}
};
function createReleaseHighlights({version,enabled=true,load,save}){
    return {
        get(){const content=releases[version] || {headline:"Ton IDE continue de s’améliorer.",items:[{icon:"spark",title:"Améliorations et correctifs",text:"Consulte les notes complètes de cette version pour découvrir tous les changements."}]};return {version,...content,shouldShow:enabled && load().releaseHighlightsSeen!==version,url:`https://github.com/extraopaa/francestudents-ide/releases/tag/v${encodeURIComponent(version)}`};},
        seen(value){if(value!==version)throw new Error("Version de notes invalide.");save({releaseHighlightsSeen:version});return true;}
    };
}
module.exports={createReleaseHighlights};
