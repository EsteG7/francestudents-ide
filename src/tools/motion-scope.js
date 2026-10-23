"use strict";
const MOTION_TOOLS=new Set(["effectcraft","view_image","use_skill","update_plan","web_search","web_search_result","web_fetch"]);
function assertToolScope(name){
    if(require("../state").state.motionDesign && !MOTION_TOOLS.has(name))throw new Error(`L’outil ${name} appartient à l’espace code et n’est pas disponible dans le chat Motion design. Utilise effectcraft pour examiner et modifier la composition ; le dossier de code est indépendant.`);
}
module.exports={MOTION_TOOLS,assertToolScope};
