/* Real local browser, presented as an editor tab. */
let localBrowserState=null,localBrowserActive=false,localBrowserBoundsFrame=0;
const localBrowserPanel=document.createElement("section");
localBrowserPanel.id="local-browser-panel";localBrowserPanel.className="local-browser-panel hidden";
localBrowserPanel.innerHTML=`<div class="local-browser-toolbar"><button id="local-browser-back" title="Page précédente" aria-label="Page précédente">←</button><button id="local-browser-forward" title="Page suivante" aria-label="Page suivante">→</button><button id="local-browser-reload" title="Actualiser" aria-label="Actualiser">↻</button><form id="local-browser-form"><input id="local-browser-address" aria-label="Adresse du navigateur local" placeholder="http://localhost:5173" spellcheck="false"><button type="submit">Ouvrir</button></form><button id="local-browser-external" title="Ouvrir dans le navigateur système" aria-label="Ouvrir dans le navigateur système">↗</button><button id="local-browser-devtools" title="Outils de développement" aria-label="Outils de développement">⋯</button></div><div id="local-browser-status" role="status"></div><div id="local-browser-host"><div id="local-browser-error" class="hidden"><h2>Le site n’est pas accessible</h2><p></p><button id="local-browser-retry">Réessayer</button></div></div>`;
$("editor-area").append(localBrowserPanel);
function syncLocalBrowserBounds(){
    cancelAnimationFrame(localBrowserBoundsFrame);
    localBrowserBoundsFrame=requestAnimationFrame(()=>{
        const host=$("local-browser-host"),rect=host.getBoundingClientRect();
        const modal=Boolean(document.querySelector("dialog[open]"))||["connection-guide","palette","context-menu","model-menu"].some(id=>{const el=$(id);return el&&!el.classList.contains("hidden")&&el.checkVisibility();});
        const visible=localBrowserActive&&!localBrowserPanel.classList.contains("hidden")&&host.checkVisibility()&&!modal&&!$("app").inert&&!document.querySelector('#startup-loading:not([hidden])');
        api.localBrowser("bounds",{x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible}).catch(()=>{});
    });
}
function renderLocalBrowserState(data){
    const changedUrl=localBrowserState?.url!==data.url;
    localBrowserState=data;
    if(changedUrl||document.activeElement!==$("local-browser-address"))$("local-browser-address").value=data.url;
    $("local-browser-back").disabled=!data.canGoBack;$("local-browser-forward").disabled=!data.canGoForward;
    $("local-browser-status").textContent=data.error?"Connexion impossible":data.loading?"Chargement du site…":"";
    $("local-browser-error").classList.toggle("hidden",!data.error);$("local-browser-error").querySelector("p").textContent=data.error||"";
    renderLocalBrowserTab();syncLocalBrowserBounds();
}
function renderLocalBrowserTab(){
    $("local-browser-tab")?.remove();if(!localBrowserState)return;
    const tab=document.createElement("div");tab.id="local-browser-tab";tab.className="tab"+(localBrowserActive?" active":"");tab.title=localBrowserState.url;tab.setAttribute("role","tab");tab.setAttribute("aria-selected",String(localBrowserActive));
    const title=document.createElement("span");title.textContent="◎ "+(localBrowserState.title||"Navigateur local");
    const close=document.createElement("button");close.className="close";close.textContent="×";close.title="Fermer le navigateur local";
    close.onclick=event=>{event.stopPropagation();closeLocalBrowser();};tab.onclick=showLocalBrowser;
    tab.append(title,close);$("tabs").append(tab);
    if(localBrowserActive)for(const fileTab of $("tabs").querySelectorAll(".tab:not(#local-browser-tab)"))fileTab.classList.remove("active");
}
function showLocalBrowser(){
    if(["project","settings","extensions"].includes(ui.sideView))showSideView("explorer");
    closeDocumentPreview();localBrowserActive=true;$("app").classList.add("local-browser-active");localBrowserPanel.classList.remove("hidden");api.localBrowser("show").catch(()=>{});renderLocalBrowserTab();syncLocalBrowserBounds();
}
function hideLocalBrowser(){localBrowserActive=false;$("app").classList.remove("local-browser-active");localBrowserPanel.classList.add("hidden");api.localBrowser("hide").catch(()=>{});renderLocalBrowserTab();}
function closeLocalBrowser(){hideLocalBrowser();localBrowserState=null;$("local-browser-tab")?.remove();api.localBrowser("close").catch(()=>{});renderTabs();}
async function openLocalBrowser(url){
    try{const checked=await api.localPreview("url",{url});showLocalBrowser();renderLocalBrowserState(await api.localBrowser("open",{url:checked.url}));}
    catch(error){studioFeedback(error.message);}
}
window.frstBrowserTab=renderLocalBrowserTab;window.frstBrowserHide=hideLocalBrowser;
$("local-browser-form").onsubmit=event=>{event.preventDefault();openLocalBrowser($("local-browser-address").value);};
for(const action of ["back","forward","reload","devtools"])$("local-browser-"+action).onclick=()=>api.localBrowser(action).catch(error=>studioFeedback(error.message));
$("local-browser-retry").onclick=()=>api.localBrowser("reload").catch(()=>{});
$("local-browser-external").onclick=()=>api.openExternal(localBrowserState?.url,true).catch(error=>studioFeedback(error.message));
api.onEvent((channel,data)=>{
    if(channel==="localBrowser"){
        if(data.command==="focus-address"){$("local-browser-address").focus();$("local-browser-address").select();return;}
        if(data.command==="close"){closeLocalBrowser();return;}
        if(localBrowserActive||localBrowserState)renderLocalBrowserState(data);
    }
    if(channel==="localBrowserOpen")openLocalBrowser(data.url);
});
new ResizeObserver(syncLocalBrowserBounds).observe($("editor-area"));
new MutationObserver(syncLocalBrowserBounds).observe($("app"),{attributes:true,attributeFilter:["class","inert"]});
new MutationObserver(syncLocalBrowserBounds).observe(document.body,{subtree:true,attributes:true,attributeFilter:["open"]});
for(const id of ["connection-guide","palette","context-menu","model-menu"]){const el=$(id);if(el)new MutationObserver(syncLocalBrowserBounds).observe(el,{attributes:true,attributeFilter:["class"]});}
window.addEventListener("resize",syncLocalBrowserBounds);
document.addEventListener("keydown",event=>{
    if(!localBrowserActive||!(event.ctrlKey||event.metaKey))return;
    if(event.key.toLowerCase()==="l"){event.preventDefault();event.stopImmediatePropagation();$("local-browser-address").focus();$("local-browser-address").select();}
    if(event.key.toLowerCase()==="w"){event.preventDefault();event.stopImmediatePropagation();closeLocalBrowser();}
},true);
document.addEventListener("click",event=>{
    const link=event.target.closest("a[href]");if(!link)return;
    try{const url=new URL(link.href);if(["http:","https:"].includes(url.protocol)&&["localhost","127.0.0.1"].includes(url.hostname)){event.preventDefault();event.stopImmediatePropagation();openLocalBrowser(url.href);}}catch{/* not a URL */}
},true);
