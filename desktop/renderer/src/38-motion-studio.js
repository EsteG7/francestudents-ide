/* EffectCraft owns the editor. Reuse the agent UI with independent conversations. */
const motionChats = new Map();
let motionChatMode = "code", motionChatSwitch = false;
let motionChatWorkspace=ui.workspace;
const codeStarter = {title:$("agent-starter").querySelector("h2").textContent,description:$("agent-starter").querySelector("p").textContent,buttons:[...document.querySelectorAll("[data-starter]")].map(button=>({prompt:button.dataset.starter,title:button.querySelector("b").textContent,detail:button.querySelector("small").textContent}))};
function renderMotionStarter(){
    const motion=motionChatMode==="motion",starter=$("agent-starter");
    starter.querySelector("h2").textContent=motion?"Créons ton animation":codeStarter.title;
    starter.querySelector("p").textContent=motion?"Décris ton idée. L’agent agit directement dans EffectCraft.":codeStarter.description;
    const choices=motion?[
        {title:"Créer une animation",detail:"Composition, textes et mouvements",prompt:"Crée une animation de titre dans EffectCraft. Inspecte le projet, découvre les commandes nécessaires et réalise la composition avec des keyframes."},
        {title:"Améliorer la composition",detail:"Rythme, lisibilité et effets",prompt:"Inspecte la composition active dans EffectCraft, analyse son rythme et sa lisibilité, puis améliore-la avec les outils du moteur."},
        {title:"Préparer un export",detail:"Format, durée et rendu",prompt:"Inspecte la composition active et les formats d’export disponibles dans EffectCraft. Prépare un export adapté et vérifie le résultat sans annoncer de réussite avant sa fin."}
    ]:codeStarter.buttons;
    [...document.querySelectorAll("[data-starter]")].forEach((button,index)=>{const item=choices[index];if(!item)return;button.dataset.starter=item.prompt;button.querySelector("b").textContent=item.title;button.querySelector("small").textContent=item.detail;});
}
api.onEvent((channel,status)=>{
    if(channel==="signedOut" || channel==="status" && motionChatWorkspace!==(status.workspace || null)){
        if(channel==="status")motionChatWorkspace=status.workspace || null;
        motionChats.clear();motionChatMode="code";
        $("app").classList.remove("view-motion");motionNav.classList.remove("active");
        input.value=readStudioStorage(studioDraftKey(motionChatWorkspace,"code"),"");
        renderMotionStarter();syncMotionChat();
    }
});
async function selectMotionChat(mode) {
    if(motionChatSwitch) return false;
    if(mode===motionChatMode)return true;
    motionChatSwitch=true;
    try {
        await api.motionConversation(mode);
        const nodes=document.createDocumentFragment(), scroll=transcript.scrollTop;
        while(transcript.firstChild)nodes.append(transcript.firstChild);
        motionChats.set(motionChatMode,{nodes,draft:input.value,attachments:pendingAttachments,toolGroup,scroll,entries:studioEntries.slice(),history:ui.history,historyIndex:ui.historyIndex});
        const next=motionChats.get(mode);
        transcript.replaceChildren(next?.nodes || document.createDocumentFragment());
        input.value=next?.draft ?? readStudioStorage(studioDraftKey(studioWorkspace,mode),"");pendingAttachments=next?.attachments || [];toolGroup=next?.toolGroup || null;
        transcript.scrollTop=next?.scroll || 0;
        studioEntries.splice(0,studioEntries.length,...(next?.entries || []));ui.history=next?.history || [];ui.historyIndex=next?.historyIndex || 0;
        motionChatMode=mode;renderAttachments();autosizeInput();saveStudioDraft();
        document.querySelector(".agent-title > span").textContent=mode==="motion"?"Motion design":"Agent";
        $("agent-starter").classList.toggle("hidden",!!transcript.children.length);
        renderMotionStarter();
        return true;
    } catch(error){studioFeedback(error.message);return false;}
    finally {motionChatSwitch=false;}
}
