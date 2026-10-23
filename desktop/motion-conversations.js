"use strict";
function createMotionConversations(state) {
    const saved=new Map();let workspace=state.workspace,mode="code";
    const keys=["chatId","chatIds","conversationSettings","history","agentPlan","model","mode"];
    return {
        reset(){saved.clear();workspace=state.workspace;mode="code";state.motionDesign=false;},
        select(next,busy) {
            if(!["code","motion"].includes(next))throw new Error("Espace de conversation inconnu.");
            if(busy && next!==mode)throw new Error("Attends la fin de la tâche ou utilise Stop avant de changer de chat.");
            if(workspace!==state.workspace){saved.clear();workspace=state.workspace;mode="code";state.motionDesign=false;}
            if(next===mode)return {mode};
            saved.set(mode,Object.fromEntries(keys.map(key=>[key,state[key]])));
            const snapshot=saved.get(next)||{chatId:null,chatIds:{chat:null,agent:null},conversationSettings:{chat:null,agent:null},history:[],agentPlan:[],model:state.model,mode:next==="motion"?"agent":state.mode};
            Object.assign(state,snapshot,{motionDesign:next==="motion"});mode=next;
            return {mode};
        }
    };
}
module.exports={createMotionConversations};
