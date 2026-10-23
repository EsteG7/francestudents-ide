/* macOS is experimental; show this notice on every launch, never on Windows. */
if(api.platform==="darwin"){
    const macBetaNotice=document.createElement("dialog");
    macBetaNotice.id="mac-beta-notice";
    macBetaNotice.className="fs-dialog";
    document.body.append(macBetaNotice);
    studioSurfaceHeader(macBetaNotice,{title:"Bienvenue sur Mac",subtitle:"Cette version de FranceStudent IDE est en bêta.",badge:"BÊTA"});
    const body=centerNode("div","fs-dialog-section");
    body.append(centerNode("p","","Certaines fonctionnalités peuvent encore présenter des bugs sur macOS. Pense à enregistrer régulièrement ton travail et à nous signaler les problèmes rencontrés."));
    const footer=centerNode("div","release-notes-footer"),done=centerNode("button","primary","Continuer");
    done.type="button";done.onclick=()=>macBetaNotice.close();
    footer.append(done);macBetaNotice.append(body,footer);
    macBetaNotice.showModal();done.focus();
}
