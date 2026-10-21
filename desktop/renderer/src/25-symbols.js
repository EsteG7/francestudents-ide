/* Navigation dans le document : symboles LSP et titres Markdown. */
let studioSymbolItems=[];
let studioSymbolPath=null;
let studioSymbolSequence=0;
document.body.insertAdjacentHTML("beforeend",`<dialog id="studio-symbol-dialog" class="center-dialog" aria-labelledby="studio-symbol-title"><div class="center-dialog-head"><h2 id="studio-symbol-title">Naviguer dans le document</h2><button type="button" id="studio-symbol-close">Fermer</button></div><p id="studio-symbol-file" class="studio-muted"></p><input type="search" id="studio-symbol-search" class="studio-symbol-search" placeholder="Rechercher un symbole ou un titre…" aria-label="Filtrer les symboles"><p id="studio-symbol-status" class="studio-muted" role="status"></p><div id="studio-symbol-list" class="studio-symbol-list"></div></dialog>`);
editorToolbar.append(studioAction("Symboles","FileCode",openStudioSymbols));
function renderStudioSymbols() {
    const query=$("studio-symbol-search").value.toLocaleLowerCase("fr").trim();
    const items=studioSymbolItems.filter(item=>`${item.name} ${item.kind}`.toLocaleLowerCase("fr").includes(query));
    const list=$("studio-symbol-list");list.replaceChildren();
    for(const item of items) {
        const button=centerButton("",async()=>{$("studio-symbol-dialog").close();if(currentTab()?.path!==studioSymbolPath)await openFile(studioSymbolPath);goToLine(item.line+1);});
        button.className="studio-symbol-item";button.style.paddingLeft=`${12+Math.min(6,item.depth)*12}px`;
        const text=centerNode("span","");text.append(centerNode("b","",item.name),centerNode("small","",item.kind+(item.detail?` · ${item.detail}`:"")));
        button.append(text,centerNode("span","studio-muted",`L${item.line+1}`));list.append(button);
    }
    if(!items.length)list.append(centerNode("p","studio-muted","Aucun symbole ne correspond."));
}
async function openStudioSymbols() {
    const tab=currentTab();if(!tab){lspStatus("Ouvre un document pour afficher ses symboles.");return;}
    const sequence=++studioSymbolSequence;studioSymbolPath=tab.path;studioSymbolItems=[];
    $("studio-symbol-search").value="";$("studio-symbol-file").textContent=tab.path;$("studio-symbol-status").textContent="Lecture de la structure du document…";$("studio-symbol-list").replaceChildren();
    $("studio-symbol-dialog").showModal();$("studio-symbol-search").focus();
    try {
        let items=[];
        if(/\.(md|markdown)$/i.test(tab.path))tab.content.split("\n").forEach((line,index)=>{const match=/^(#{1,6})\s+(.+)/.exec(line);if(match)items.push({name:match[2],line:index,depth:match[1].length-1,kind:"titre",detail:""});});
        else if(lspEnabledFor(tab.path))items=await api.documentSymbols(tab.path,tab.content);
        else {$("studio-symbol-status").textContent="La navigation structurée est disponible pour JS, TS et Markdown.";return;}
        if(sequence!==studioSymbolSequence||!$("studio-symbol-dialog").open)return;
        studioSymbolItems=items.slice(0,800);$("studio-symbol-status").textContent=`${studioSymbolItems.length} symbole(s) repéré(s).`;renderStudioSymbols();
    }catch(error){if(sequence===studioSymbolSequence)$("studio-symbol-status").textContent=`Symboles indisponibles : ${error.message}`;}
}
$("studio-symbol-search").oninput=renderStudioSymbols;
$("studio-symbol-search").onkeydown=event=>{if(event.key==="ArrowDown"){event.preventDefault();$("studio-symbol-list").querySelector("button")?.focus();}if(event.key==="Enter"){$("studio-symbol-list").querySelector("button")?.click();}};
$("studio-symbol-list").onkeydown=event=>{if(!["ArrowDown","ArrowUp"].includes(event.key))return;const buttons=[...$("studio-symbol-list").querySelectorAll("button")];const index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();buttons[(index+(event.key==="ArrowDown"?1:buttons.length-1))%buttons.length]?.focus();};
$("studio-symbol-close").onclick=()=>$("studio-symbol-dialog").close();
$("studio-symbol-dialog").addEventListener("close",()=>{studioSymbolSequence++;});
window.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==="o"&&!document.querySelector("dialog[open]")){event.preventDefault();event.stopImmediatePropagation();openStudioSymbols();}},true);
