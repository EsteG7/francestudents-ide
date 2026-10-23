function parseContextLimitNotice(text){
    const value=String(text || "");
    if(!/maximum.{0,20}(?:context|token)|context[_ ]length[_ ]exceeded|conversation.{0,50}token.{0,20}limit/i.test(value))return null;
    const match=/(?:maximum|max)\s+(?:context\s+)?tokens?\s+limit\s*(?:of|is|:|=)?\s*([\d,_ ]+)/i.exec(value);
    const limit=match?Number(match[1].replace(/[, _]/g,"")):null;
    return {limit:Number.isFinite(limit)?limit:null};
}
function renderContextLimitEntry(info,raw){
    const entry=addEntry("error context-limit-notice","");
    const icon=centerNode("span","api-notice-icon");icon.innerHTML=apiNoticeIcon("attachment");entry.append(icon);
    entry.append(centerNode("strong","","Limite de contexte atteinte"),centerNode("p","",info.limit?`Le serveur limite cette conversation à ${info.limit.toLocaleString("fr-FR")} tokens.`:"La conversation dépasse la capacité acceptée par le serveur."),centerNode("p","","La reprise automatique n’a pas abouti. L’historique reste conservé ; tu peux réessayer après une compaction ou préciser la partie du travail à reprendre."));
    const details=centerNode("details");details.append(centerNode("summary","","Détail technique"),centerNode("pre","",raw));entry.append(details);return entry;
}
