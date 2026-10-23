"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {state}=require("../src/state");
const {buildAgentPrompt,buildFollowUpPrompt}=require("../src/agent/prompt");
test("motion prompts keep the animation role in full and follow-up requests",()=>{
    const previous={motionDesign:state.motionDesign,fullAccess:state.fullAccess};
    try{
        state.motionDesign=true;state.fullAccess=true;
        const prompt=buildAgentPrompt({workspace:"/animation",env:{},task:"Anime mon titre",history:[],memorySummary:"",projectContext:"",observations:[],turn:1,maxTurns:10});
        assert.match(prompt,/assistant motion design de FranceStudent/);
        assert.match(prompt,/cinq secondes/);
        assert.match(prompt,/EXEMPLE — Pour commencer, inspecte le projet/);
        assert.doesNotMatch(prompt,/TÂCHE DÉTECTÉE/);
        assert.doesNotMatch(prompt,/Windows PowerShell 5.1/);
        const follow=buildFollowUpPrompt({lastObservation:null,turn:2,maxTurns:10});
        assert.match(follow,/AGENT MOTION DESIGN/);
        assert.match(follow,/command.describe/);
    }finally{Object.assign(state,previous);}
});
