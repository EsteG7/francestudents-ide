"use strict";
const fs=require("node:fs"),path=require("node:path");
const {CONFIG}=require("../config");
const file=()=>path.join(CONFIG.dataDir,"observed-context-limits.json");
let limits;
function load(){if(!limits){try{limits=JSON.parse(fs.readFileSync(file(),"utf8"));if(!limits || typeof limits!=="object" || Array.isArray(limits))limits={};}catch{limits={};}}return limits;}
const key=model=>JSON.stringify([CONFIG.apiUrl,String(model)]);
function extractLimit(error){
    const match=/(?:maximum|max)\s+(?:context\s+)?(?:token|tokens)\s+limit\s*(?:of|is|:|=)?\s*([\d,_ ]+)/i.exec(String(error?.message || error || ""));
    const value=match?Number(match[1].replace(/[, _]/g,"")):NaN;
    return Number.isSafeInteger(value) && value>=1024 && value<=100000000?value:null;
}
function observedLimit(model){const value=load()[key(model)];return Number.isSafeInteger(value) && value>=1024?value:null;}
function rememberLimit(model,error){
    const value=extractLimit(error);if(!value)return null;
    load()[key(model)]=value;
    try{fs.mkdirSync(path.dirname(file()),{recursive:true});const temp=file()+".tmp";fs.writeFileSync(temp,JSON.stringify(limits),{mode:0o600});fs.renameSync(temp,file());}catch{/* Memory still keeps the actual server limit for this session. */}
    return value;
}
function applyLimit(model,policy){const observed=observedLimit(model);return observed?{...policy,contextWindowTokens:Math.min(policy.contextWindowTokens || observed,observed),source:"observed-service-limit"}:policy;}
module.exports={extractLimit,rememberLimit,observedLimit,applyLimit};
