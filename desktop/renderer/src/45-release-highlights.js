/* One welcome card after each installed update; no network request is needed. */
let releaseHighlightsData=null,releaseHighlightsShown=false;
const releaseDialog=document.createElement("dialog");releaseDialog.id="release-highlights";releaseDialog.className="release-highlights";releaseDialog.setAttribute("aria-labelledby","release-highlights-title");document.body.append(releaseDialog);
function openReleaseHighlights(data){
    if(releaseDialog.open)return;
    releaseHighlightsShown=true;releaseDialog.replaceChildren();
    const top=centerNode("div","release-notes-top");top.append(centerNode("span","release-notes-badge",`NOUVEAUTÉS · ${data.version}`));
    const close=centerNode("button","release-notes-close","×");close.type="button";close.setAttribute("aria-label","Fermer les nouveautés");close.onclick=()=>releaseDialog.close();top.append(close);
    const heading=centerNode("h2","",data.headline);heading.id="release-highlights-title";
    releaseDialog.append(top,centerNode("p","release-notes-brand","FranceStudent IDE"),heading,centerNode("p","release-notes-intro","Voici ce qui change dans cette version. Ton travail reste à sa place."));
    const list=centerNode("div","release-notes-list");
    for(const item of data.items){const row=centerNode("div","release-notes-item"),icon=centerNode("span","release-notes-icon");icon.innerHTML=apiNoticeIcon(item.icon==="clock"?"wait":item.icon);const body=centerNode("div");body.append(centerNode("strong","",item.title),centerNode("p","",item.text));row.append(icon,body);list.append(row);}
    const footer=centerNode("div","release-notes-footer"),more=centerNode("button","","Notes complètes");more.type="button";more.onclick=()=>api.openExternal(data.url).catch(error=>studioFeedback(error.message));
    const done=centerNode("button","primary","C’est parti !");done.type="button";done.onclick=()=>releaseDialog.close();footer.append(more,done);releaseDialog.append(list,footer);
    releaseDialog.showModal();done.focus();
}
releaseDialog.addEventListener("close",()=>{if(releaseHighlightsData)api.releaseHighlights("seen",releaseHighlightsData.version).catch(error=>studioFeedback(error.message));});
function maybeShowReleaseHighlights(){
    if(!releaseHighlightsData?.shouldShow || releaseHighlightsShown || !$("startup-loading").hidden || !$("connection-guide").classList.contains("hidden") || document.querySelector("dialog[open]"))return;
    openReleaseHighlights(releaseHighlightsData);
}
new MutationObserver(maybeShowReleaseHighlights).observe($("startup-loading"),{attributes:true,attributeFilter:["hidden"]});
new MutationObserver(maybeShowReleaseHighlights).observe($("connection-guide"),{attributes:true,attributeFilter:["class"]});
api.releaseHighlights().then(data=>{releaseHighlightsData=data;maybeShowReleaseHighlights();}).catch(()=>{});
const releaseNotesButton=centerNode("button","","Nouveautés de cette version");releaseNotesButton.type="button";releaseNotesButton.id="release-highlights-open";releaseNotesButton.onclick=async()=>{try{releaseHighlightsData=await api.releaseHighlights();openReleaseHighlights(releaseHighlightsData);}catch(error){studioFeedback(error.message);}};
document.querySelector("#studio-update-check").parentElement.append(releaseNotesButton);
