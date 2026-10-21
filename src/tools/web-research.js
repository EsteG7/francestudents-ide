"use strict";
const {EventEmitter}=require("node:events");
function createResearchManager({search=(args,deps)=>require("./web-search").webSearch(args,deps)}={}) {
    const jobs=new Map(),events=new EventEmitter();let nextId=1;
    const snapshot=job=>({id:job.id,query:job.query,status:job.status,startedAt:job.startedAt,endedAt:job.endedAt,result:job.result,error:job.error});
    const publish=job=>events.emit("change",snapshot(job));
    function start(args){
        if([...jobs.values()].filter(job=>job.status==="running").length>=4)throw new Error("Quatre recherches sont déjà en cours.");
        while(jobs.size>=30){const first=[...jobs.values()].find(job=>job.status!=="running");if(!first)break;jobs.delete(first.id);}
        const job={id:`research-${nextId++}`,query:args.query,status:"running",startedAt:Date.now(),endedAt:null,result:null,error:null,controller:new AbortController()};jobs.set(job.id,job);publish(job);
        Promise.resolve().then(()=>search({...args,background:false},{signal:job.controller.signal})).then(result=>{if(job.status!=="running")return;job.result=result;job.status=result.denied?"denied":"done";},error=>{if(job.status!=="running")return;job.status="failed";job.error=error.message;}).finally(()=>{job.endedAt=Date.now();publish(job);});
        return {job_id:job.id,query:job.query,status:"running",changed:false,message:"Recherche démarrée en arrière-plan. Continue une autre étape puis lis le résultat avec web_search_result."};
    }
    function get(id){const job=jobs.get(String(id));if(!job)throw new Error("Recherche introuvable.");return {...snapshot(job),...(job.result||{}),job_id:job.id,changed:false,message:job.status==="running"?"Recherche en cours : continue une autre étape avant de relire.":job.error||job.result?.message||"Recherche arrêtée."};}
    function cancel(id){const job=jobs.get(String(id));if(job?.status==="running"){job.status="stopped";job.endedAt=Date.now();job.controller.abort();publish(job);}return job?snapshot(job):null;}
    return {start,get,cancel,list:()=>[...jobs.values()].map(snapshot),subscribe:listener=>{events.on("change",listener);return()=>events.off("change",listener);},stopAll(){for(const id of jobs.keys())cancel(id);}};
}
const manager=createResearchManager();
module.exports={manager,createResearchManager,name:"web_search_result",run:args=>manager.get(args.id),check(args){require("./core/args").requireString(args.id,"id");},describe:args=>args.id};
