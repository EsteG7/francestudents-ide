/* A beginner workspace inside EffectCraft, with the full editor one click away. */
motionEngine.advanced=readStudioStorage("frst.motion.advanced",false)===true;
motionEngine.changingInterface=false;
const motionModes=centerNode("div","motion-mode-switch");motionModes.setAttribute("role","group");motionModes.setAttribute("aria-label","Niveau de l’interface EffectCraft");
motionModes.innerHTML='<button type="button" id="motion-simple" aria-pressed="true">Simple</button><button type="button" id="motion-advanced" aria-pressed="false">Avancé</button>';
document.querySelector(".motion-header").insertBefore(motionModes,document.querySelector(".motion-actions"));
const tutorialButton=centerNode("button","","Tutos");tutorialButton.type="button";tutorialButton.id="motion-tutorial-open";tutorialButton.title="Apprendre les bases du motion design";
document.querySelector(".motion-actions").prepend(tutorialButton);
const intro=centerNode("ol","motion-intro-steps");
for(const text of ["Décris ton idée dans le chat.","Regarde l’agent créer ton animation.","Teste la lecture, puis enregistre ton projet."])intro.append(centerNode("li","",text));
document.querySelector(".motion-consent-actions").before(intro);
async function applyMotionInterface(advanced,initial=false){
    if(motionEngine.changingInterface)return false;
    if(!initial && ui.status.busy){studioFeedback("Attends la fin de l’action de l’agent avant de changer l’interface.");return false;}
    motionEngine.changingInterface=true;$("motion-simple").disabled=true;$("motion-advanced").disabled=true;
    try{
        await api.effectCraftControl({method:"ui.set",params:{workspace:advanced?"Default":"FranceStudent",menuBar:advanced,viewer:{zoom:null},timeline:{graphEditor:false,showModes:advanced}}});
        for(const column of ["label","num","comment","switches","modes","parent","in","out","duration","stretch"]){
            await api.effectCraftControl({method:"engine.execute",params:{command:"timeline.column",params:{column,visible:advanced}}});
        }
        motionEngine.advanced=advanced;writeStudioStorage("frst.motion.advanced",advanced);
        $("motion-simple").setAttribute("aria-pressed",String(!advanced));$("motion-advanced").setAttribute("aria-pressed",String(advanced));
        motionView.dataset.interface=advanced?"advanced":"simple";
        return true;
    }catch(error){if(initial)throw error;studioFeedback(error.message);return false;}
    finally{motionEngine.changingInterface=false;$("motion-simple").disabled=false;$("motion-advanced").disabled=false;}
}
$("motion-simple").onclick=()=>applyMotionInterface(false);$("motion-advanced").onclick=()=>applyMotionInterface(true);
const motionTutorials=[
    {title:"Ton premier titre",steps:["Choisis le texte à afficher et son ambiance.","Décris-le à l’agent : il crée la composition et l’animation.","Appuie sur Lecture pour voir le résultat."],prompt:"Crée dans EffectCraft un titre « Mon premier projet » qui apparaît en douceur sur un fond sombre. Utilise une composition de 5 secondes au format 16:9. Réalise les modifications et vérifie le rendu."},
    {title:"Donner du mouvement",steps:["Sélectionne un texte ou une forme dans l’animation.","Décris le mouvement simplement : apparaître, glisser, tourner…", "L’agent règle les points de passage de l’animation (keyframes). Tu peux ensuite demander un mouvement plus lent ou plus rapide."],prompt:"Anime l’élément sélectionné dans EffectCraft : fais-le apparaître progressivement puis glisser légèrement vers la droite. Inspecte d’abord la sélection et vérifie le résultat."},
    {title:"Enregistrer et exporter",steps:["Enregistrer conserve ton projet modifiable dans le stockage local d’EffectCraft.","Exporter produit un fichier à partager. Demande à l’agent de vérifier les formats disponibles avant le rendu.","Garde aussi une copie du projet .ecproj et de tes médias avec les fonctions de fichier du mode Avancé."],prompt:"Inspecte mon animation EffectCraft. Vérifie les formats d’export réellement disponibles, prépare un export adapté et explique où retrouver le résultat. Ne déclare pas un export terminé tant qu’il n’a pas réussi."}
];
const motionTutorialPanel=centerNode("section","motion-tutorial hidden");motionTutorialPanel.id="motion-tutorial";motionTutorialPanel.setAttribute("aria-label","Petits tutoriels motion design");motionView.append(motionTutorialPanel);
let motionTutorialIndex=0;
function showMotionTutorial(index=motionTutorialIndex){
    motionTutorialIndex=Math.max(0,Math.min(motionTutorials.length-1,index));
    const tutorial=motionTutorials[motionTutorialIndex];motionTutorialPanel.replaceChildren();
    const header=centerNode("div","motion-tutorial-head");header.append(centerNode("span","",`LES BASES · ${motionTutorialIndex+1}/${motionTutorials.length}`));
    const close=centerNode("button","","Fermer");close.type="button";close.onclick=()=>{motionTutorialPanel.classList.add("hidden");tutorialButton.focus();};header.append(close);motionTutorialPanel.append(header,centerNode("h2","",tutorial.title));
    const list=centerNode("ol");for(const step of tutorial.steps)list.append(centerNode("li","",step));motionTutorialPanel.append(list);
    const actions=centerNode("div","motion-tutorial-actions");
    const prepare=centerNode("button","primary","Préparer la demande");prepare.type="button";prepare.onclick=()=>{
        input.value=input.value.trim()?`${input.value}\n\n${tutorial.prompt}`:tutorial.prompt;
        input.dispatchEvent(new Event("input",{bubbles:true}));autosizeInput();saveStudioDraft();
        motionTutorialPanel.classList.add("hidden");input.focus();studioFeedback("La demande est préparée. Tu peux la modifier puis cliquer sur Envoyer.");
    };
    const next=centerNode("button","",motionTutorialIndex===motionTutorials.length-1?"Revoir le début":"Suivant");next.type="button";next.onclick=()=>showMotionTutorial((motionTutorialIndex+1)%motionTutorials.length);
    actions.append(prepare,next);motionTutorialPanel.append(actions,centerNode("p","motion-tutorial-note","Les tutos sont gratuits à consulter. Une demande envoyée à l’agent utilise ton quota habituel."));
    motionTutorialPanel.classList.remove("hidden");close.focus();
}
tutorialButton.onclick=()=>showMotionTutorial();
motionView.addEventListener("keydown",event=>{if(event.key==="Escape" && !motionTutorialPanel.classList.contains("hidden")){event.preventDefault();event.stopPropagation();motionTutorialPanel.classList.add("hidden");tutorialButton.focus();}});
