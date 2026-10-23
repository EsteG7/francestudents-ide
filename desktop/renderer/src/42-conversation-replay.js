/* Visible history is independent of the model's compacted context. */
let replayGeneration=0;
api.onEvent((channel,data)=>{
    if(channel==="clear"){replayGeneration++;ui.replayingConversation=false;return;}
    if(channel!=="conversationReplay")return;
    const generation=++replayGeneration,entries=data.entries || [];let cursor=0;
    ui.replayingConversation=true;
    function draw(){
        if(generation!==replayGeneration)return;
        const end=Math.min(cursor+50,entries.length);
        while(cursor<end)renderEntry({...entries[cursor++],replayed:true});
        studioFeedback(`Historique : ${cursor}/${entries.length} éléments chargés.`);
        if(cursor<entries.length)requestAnimationFrame(draw);
        else{ui.replayingConversation=false;scrollDown();}
    }
    draw();
});
