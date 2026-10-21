/* ---------- Préférences de l’éditeur, aperçu isolé et comparaison ---------- */
let studioEditorPreferences={fontSize:13,tabSize:4,wordWrap:false,autoSave:false,formatOnSave:false,reducedMotion:false,theme:"original"};
let studioAutoSaveTimer=null;
let studioFormatting=false;
let studioPreviewVisible=false;
let studioPreviewMode="document";
let studioPreviewUrl="";
let studioPreviewSequence=0;
let studioPreviewTimer=null;
let studioMergeView=null;
const editorToolbar=centerNode("div","studio-editor-toolbar");editorToolbar.id="studio-editor-toolbar";
editorToolbar.append(studioAction("Projet","LayoutDashboard",()=>showSideView("project")),studioAction("Formater","FileCode",()=>formatEditorDocument()),studioAction("Comparer","GitCompare",()=>openStudioCompare()),studioAction("Aperçu","Eye",()=>openDocumentPreview()),studioAction("Marquer la ligne","BookOpen",toggleStudioBookmark));
$("center").insertBefore(editorToolbar,$("breadcrumbs"));
$("editor-area").insertAdjacentHTML("beforeend",`<section id="studio-preview" class="studio-preview hidden" aria-label="Aperçu du document"><div class="studio-preview-header"><b id="studio-preview-title">Aperçu</b><div><button type="button" id="studio-preview-refresh" aria-label="Actualiser l’aperçu">↻</button><button type="button" id="studio-preview-expand" aria-label="Agrandir ou réduire l’aperçu">⛶</button><button type="button" id="studio-preview-close" aria-label="Fermer l’aperçu">×</button></div></div><div class="studio-preview-address"><input id="studio-preview-url" type="url" aria-label="Adresse du serveur local" placeholder="http://localhost:5173"><button type="button" id="studio-preview-go">Ouvrir</button></div><p id="studio-preview-message" class="studio-muted" role="status"></p><article id="studio-markdown-preview" class="studio-markdown"></article><iframe id="studio-web-preview" title="Aperçu local isolé" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" class="hidden"></iframe></section>`);
document.body.insertAdjacentHTML("beforeend",`<dialog id="studio-compare-dialog" class="studio-compare-dialog" aria-labelledby="studio-compare-title"><div class="center-dialog-head"><div><h2 id="studio-compare-title">Comparer le document</h2><p id="studio-compare-file" class="studio-muted"></p></div><div class="studio-actions"><select id="studio-compare-base" aria-label="Version de référence"><option value="saved">Version enregistrée</option><option value="git">Dernier commit Git (HEAD)</option></select><button type="button" id="studio-compare-close">Fermer</button></div></div><div class="studio-compare-labels"><span>Version de référence</span><span>Document actuel · lecture seule</span></div><div id="studio-merge-host"></div></dialog>`);
const editorSettings=document.createElement("section");editorSettings.className="settings-card";
editorSettings.setAttribute("aria-labelledby","studio-editor-settings-title");
editorSettings.innerHTML=`<h3 id="studio-editor-settings-title">Éditeur et apparence</h3><p class="settings-help">Ces réglages sont appliqués immédiatement après enregistrement, sans redémarrage.</p><div class="settings-number-grid"><label>Taille du texte<input type="number" id="studio-font-size" min="10" max="24" value="13" required></label><label>Indentation<select id="studio-tab-size"><option value="2">2 espaces</option><option value="4" selected>4 espaces</option><option value="8">8 espaces</option></select></label></div><label class="center-code-label">Thème<select id="studio-theme"><option value="original">Sombre original</option><option value="midnight">Minuit</option></select></label><label class="setting-toggle"><span><b>Retour à la ligne visuel</b><small>Affiche les longues lignes sans défilement horizontal.</small></span><input type="checkbox" role="switch" id="studio-word-wrap"></label><label class="setting-toggle"><span><b>Enregistrement automatique</b><small>Enregistre le fichier actif deux secondes après la dernière modification.</small></span><input type="checkbox" role="switch" id="studio-auto-save"></label><label class="setting-toggle"><span><b>Formater à l’enregistrement</b><small>Prettier pour JS, TS, JSON, CSS, HTML, Vue, Markdown et YAML. Une erreur de syntaxe n’empêche pas de sauvegarder le texte.</small></span><input type="checkbox" role="switch" id="studio-format-save"></label><label class="setting-toggle"><span><b>Réduire les animations</b><small>Limite les transitions et mouvements dans l’interface.</small></span><input type="checkbox" role="switch" id="studio-reduced-motion"></label><button type="button" id="studio-editor-settings-save" class="primary">Enregistrer l’éditeur et l’apparence</button><p id="studio-editor-settings-message" class="settings-help" role="status"></p>`;
$("settings-view").insertBefore(editorSettings,$("settings-message"));
function applyStudioEditorPreferences(value) {
    studioEditorPreferences={...studioEditorPreferences,...value};
    code.configure(studioEditorPreferences);
    document.documentElement.dataset.studioTheme=studioEditorPreferences.theme;
    document.documentElement.classList.toggle("studio-reduced-motion",studioEditorPreferences.reducedMotion);
    $("studio-font-size").value=studioEditorPreferences.fontSize;
    $("studio-tab-size").value=String(studioEditorPreferences.tabSize);
    $("studio-theme").value=studioEditorPreferences.theme;
    for(const [id,key]of[["studio-word-wrap","wordWrap"],["studio-auto-save","autoSave"],["studio-format-save","formatOnSave"],["studio-reduced-motion","reducedMotion"]])$(id).checked=studioEditorPreferences[key];
}
api.editorPreferences().then(applyStudioEditorPreferences).catch(()=>{});
$("studio-editor-settings-save").onclick=async()=>{
    if(!$("studio-font-size").reportValidity())return;
    const value={fontSize:Number($("studio-font-size").value),tabSize:Number($("studio-tab-size").value),theme:$("studio-theme").value,wordWrap:$("studio-word-wrap").checked,autoSave:$("studio-auto-save").checked,formatOnSave:$("studio-format-save").checked,reducedMotion:$("studio-reduced-motion").checked};
    try{applyStudioEditorPreferences(await api.editorPreferences("save",value));$("studio-editor-settings-message").textContent="Éditeur et apparence enregistrés.";}
    catch(error){$("studio-editor-settings-message").textContent=error.message;}
};
async function formatEditorDocument() {
    const tab=currentTab();if(!tab||tab.kind==="asset"||studioFormatting)return false;
    const before=code.value;studioFormatting=true;
    try {
        const result=await api.formatDocument({file:tab.path,text:before,tabSize:studioEditorPreferences.tabSize});
        if(currentTab()!==tab||code.value!==before){lspStatus("Formatage annulé : le document a changé pendant la requête.");return false;}
        if(!result.changed){lspStatus("Document déjà formaté.");return true;}
        const selected=code.selectionStart;
        code.view.dispatch({changes:{from:0,to:code.view.state.doc.length,insert:result.text},selection:{anchor:Math.min(selected,result.text.length)},userEvent:"input.format"});
        lspSyncTabFromEditor(tab);renderTabs();lspScheduleSync();lspStatus("Document formaté avec Prettier · Ctrl+Z pour annuler.");return true;
    }catch(error){lspStatus(`Formatage : ${error.message}`);return false;}
    finally{studioFormatting=false;}
}
async function saveAllStudioFiles() {
    let count=0;
    for(const tab of ui.tabs.filter(tab=>tab.dirty&&tab.kind!=="asset")) {
        const snapshot=tab.content;
        try{await api.writeFile(tab.path,tab.eol==="\r\n"?snapshot.replace(/\n/g,"\r\n"):snapshot,{encoding:tab.encoding||"utf8",bom:tab.bom===true});tab.saved=snapshot;tab.dirty=tab.content!==snapshot;count++;}
        catch(error){lspStatus(`Enregistrement de ${tab.path} : ${error.message}`);}
    }
    renderTabs();scheduleGitRefresh();lspStatus(`${count} fichier(s) enregistré(s).`);
}
function closeDocumentPreview() {
    studioPreviewVisible=false;studioPreviewSequence++;
    $("studio-preview").classList.add("hidden");$("editor-area").classList.remove("studio-preview-open","studio-preview-wide");
    $("studio-web-preview").removeAttribute("src");
    api.localPreview("stop").catch(()=>{});
}
async function openDocumentPreview() {
    studioPreviewMode="document";
    studioPreviewVisible=true;$("studio-preview").classList.remove("hidden");$("editor-area").classList.add("studio-preview-open");
    await updateDocumentPreview();
}
async function updateDocumentPreview() {
    if(!studioPreviewVisible||studioPreviewMode!=="document")return;
    const sequence=++studioPreviewSequence;
    const tab=currentTab();
    $("studio-preview-message").textContent="";
    $("studio-preview-title").textContent=tab?.path.split("/").pop()||"Aperçu local";
    $("studio-markdown-preview").classList.add("hidden");$("studio-web-preview").classList.add("hidden");
    if(!tab){$("studio-preview-message").textContent="Ouvre un fichier Markdown ou HTML. Pour une application web, saisis l’adresse du serveur local ci-dessus.";return;}
    if(/\.(md|markdown)$/i.test(tab.path)) {
        $("studio-web-preview").removeAttribute("src");
        $("studio-markdown-preview").innerHTML=window.StudioVendor.markdown(tab.content);
        $("studio-markdown-preview").classList.remove("hidden");return;
    }
    if(/\.html?$/i.test(tab.path)) {
        if(tab.dirty){$("studio-preview-message").textContent="Enregistre le fichier HTML pour actualiser l’aperçu. Les chemins relatifs sont servis depuis ton projet.";return;}
        try{const result=await api.localPreview("start",{file:tab.path});if(sequence!==studioPreviewSequence)return;studioPreviewUrl=result.url;$("studio-preview-url").value=result.url;$("studio-web-preview").src=result.url;$("studio-web-preview").classList.remove("hidden");}
        catch(error){if(sequence===studioPreviewSequence)$("studio-preview-message").textContent=error.message;}
        return;
    }
    $("studio-preview-message").textContent="L’aperçu documentaire prend en charge Markdown et HTML. Pour Vite, React ou un autre serveur, lance le script de développement et saisis son adresse locale.";
}
$("studio-preview-close").onclick=closeDocumentPreview;
$("studio-preview-expand").onclick=()=>$("editor-area").classList.toggle("studio-preview-wide");
$("studio-preview-refresh").onclick=()=>{if(studioPreviewMode==="document")updateDocumentPreview();else if(studioPreviewUrl)$("studio-web-preview").src=studioPreviewUrl;};
$("studio-preview-go").onclick=()=>openLocalBrowser($("studio-preview-url").value);
$("studio-preview-url").onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();$("studio-preview-go").click();}};
$("studio-markdown-preview").onclick=async event=>{
    const link=event.target.closest("a");if(!link)return;event.preventDefault();
    const href=link.getAttribute("href")||"";
    if(/^https?:\/\//i.test(href)){await api.openExternal(href);return;}
    if(href.startsWith("#")){const heading=[...$("studio-markdown-preview").querySelectorAll("h1,h2,h3,h4")].find(node=>node.textContent.toLowerCase().replace(/\s+/g,"-")===href.slice(1));heading?.scrollIntoView({block:"nearest"});return;}
    const tab=currentTab();if(!tab)return;
    const segments=tab.path.split("/");segments.pop();
    for(const part of href.split("#")[0].split("/")){if(part==="..")segments.pop();else if(part&&part!==".")segments.push(part);}
    if(segments.length)await openFile(segments.join("/"));
};
async function openStudioCompare() {
    if(!currentTab())return;
    if(currentTab().kind==="asset"){lspStatus("La comparaison est disponible pour les documents texte.");return;}
    $("studio-compare-dialog").showModal();await renderStudioCompare();
}
async function renderStudioCompare() {
    const tab=currentTab();if(!tab)return;
    const before=$("studio-compare-base").value==="git"?String(await api.gitShowHead(tab.path)):tab.saved;
    if(studioMergeView)studioMergeView.destroy();$("studio-merge-host").replaceChildren();
    $("studio-compare-file").textContent=tab.path;
    const CM=window.CM;
    const extensions=[CM.basicSetup,CM.EditorView.editable.of(false),CM.EditorState.readOnly.of(true),CM.oneDark,CM.languageFor(extKind(tab.path))];
    studioMergeView=new CM.MergeView({a:{doc:before,extensions},b:{doc:tab.content,extensions},parent:$("studio-merge-host"),highlightChanges:true,gutter:true,collapseUnchanged:{margin:4,minSize:12}});
}
$("studio-compare-base").onchange=()=>renderStudioCompare().catch(error=>lspStatus(error.message));
$("studio-compare-close").onclick=()=>$("studio-compare-dialog").close();
$("studio-compare-dialog").addEventListener("close",()=>{studioMergeView?.destroy();studioMergeView=null;});
function studioWorkspaceChanged() {
    closeDocumentPreview();studioRuns=[];studioSelectedRun=null;
    if(ui.sideView==="project")refreshProjectStudio();
}
code.addEventListener("input",()=>{
    if(studioPreviewVisible&&studioPreviewMode==="document"){clearTimeout(studioPreviewTimer);studioPreviewTimer=setTimeout(updateDocumentPreview,220);}
    clearTimeout(studioAutoSaveTimer);
    if(studioEditorPreferences.autoSave){const tab=currentTab();studioAutoSaveTimer=setTimeout(()=>{if(tab&&currentTab()===tab&&tab.dirty)saveCurrent();},2000);}
});
window.addEventListener("keydown",event=>{
    if(document.querySelector("dialog[open]")||(!event.ctrlKey&&!event.metaKey))return;
    const key=event.key.toLowerCase();let action=null;
    if(event.shiftKey&&key==="d")action=()=>showSideView("project");
    else if(event.shiftKey&&key==="s")action=saveAllStudioFiles;
    else if(event.shiftKey&&key==="v")action=()=>studioPreviewVisible?closeDocumentPreview():openDocumentPreview();
    else if(key==="f2")action=toggleStudioBookmark;
    if(action){event.preventDefault();event.stopImmediatePropagation();Promise.resolve(action()).catch(error=>lspStatus(error.message));}
},true);
const welcomeCockpit=studioQuick("Cockpit du projet","Commandes, qualité, documentation et outils locaux","LayoutDashboard",()=>showSideView("project"));
$("editor-welcome").querySelector(".welcome-grid")?.prepend(welcomeCockpit);
