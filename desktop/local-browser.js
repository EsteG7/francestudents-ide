"use strict";
const {localPreviewUrl}=require("./preview-server");

function createLocalBrowser({getWindow,onState=()=>{}}) {
    let view=null,shown=false;
    let state={url:"",title:"Navigateur local",loading:false,error:"",canGoBack:false,canGoForward:false};
    const publish=patch=>{
        state={...state,...patch};
        if(view&&!view.webContents.isDestroyed()){
            state.canGoBack=view.webContents.navigationHistory.canGoBack();
            state.canGoForward=view.webContents.navigationHistory.canGoForward();
        }
        onState({...state});return {...state};
    };
    function ensure(){
        if(view&&!view.webContents.isDestroyed())return view;
        const {WebContentsView,session}=require("electron");
        const isolated=session.fromPartition("frst-local-browser");
        isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
        isolated.setPermissionCheckHandler(()=>false);
        if(!isolated.frstDownloadGuard){isolated.on("will-download",(_event,item)=>item.cancel());isolated.frstDownloadGuard=true;}
        view=new WebContentsView({webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
        const wc=view.webContents;
        wc.on("did-start-loading",()=>publish({loading:true,error:""}));
        wc.on("did-stop-loading",()=>publish({loading:false}));
        wc.on("page-title-updated",(_event,title)=>publish({title}));
        wc.on("did-navigate",(_event,url)=>publish({url}));
        wc.on("did-navigate-in-page",(_event,url,isMainFrame)=>{if(isMainFrame)publish({url});});
        const guard=(event,url)=>{try{localPreviewUrl(url);}catch{event.preventDefault();publish({loading:false,error:"Cette navigation quitte le serveur local. Utilise Ouvrir dans le navigateur pour visiter un autre site."});}};
        wc.on("will-navigate",guard);wc.on("will-redirect",guard);
        wc.setWindowOpenHandler(({url})=>{try{localPreviewUrl(url);navigate(url);}catch{/* external popups stay blocked */}return {action:"deny"};});
        wc.on("did-fail-load",(_event,code,_description,_url,isMainFrame)=>{
            if(!isMainFrame||code===-3)return;
            view?.setVisible(false);
            publish({loading:false,error:"Le serveur local ne répond pas. Lance le serveur de développement, vérifie le port puis clique sur Réessayer."});
        });
        wc.on("render-process-gone",()=>{view?.setVisible(false);publish({loading:false,error:"La page s’est arrêtée. Clique sur Réessayer."});});
        getWindow().contentView.addChildView(view);view.setVisible(false);return view;
    }
    function navigate(url){
        url=localPreviewUrl(url);
        const current=ensure();shown=true;publish({url,title:"Navigateur local",loading:true,error:""});
        current.webContents.loadURL(url).catch(()=>{});
        return {...state};
    }
    function bounds(rect={}){
        if(!view||view.webContents.isDestroyed())return;
        const win=getWindow();if(!win)return;
        const size=win.getContentBounds();
        const x=Math.max(0,Math.min(size.width,Math.round(Number(rect.x)||0))),y=Math.max(0,Math.min(size.height,Math.round(Number(rect.y)||0)));
        const width=Math.max(0,Math.min(size.width-x,Math.round(Number(rect.width)||0))),height=Math.max(0,Math.min(size.height-y,Math.round(Number(rect.height)||0)));
        view.setBounds({x,y,width,height});view.setVisible(shown&&rect.visible===true&&width>0&&height>0&&!state.error);
    }
    function destroy(){if(view){const current=view;view=null;try{getWindow()?.contentView.removeChildView(current);}catch{/* window may be closed */}if(!current.webContents.isDestroyed())current.webContents.close();}shown=false;}
    function action(type,payload={}){
        if(type==="open")return navigate(payload.url);
        if(type==="bounds"){bounds(payload);return;}
        if(type==="hide"){shown=false;view?.setVisible(false);return;}
        if(type==="show"){shown=true;return publish({});}
        if(type==="close"){destroy();return;}
        if(type==="status")return {...state};
        if(!view||view.webContents.isDestroyed())return {...state};
        if(type==="reload")return navigate(state.url);
        if(type==="back"&&view.webContents.navigationHistory.canGoBack())view.webContents.navigationHistory.goBack();
        else if(type==="forward"&&view.webContents.navigationHistory.canGoForward())view.webContents.navigationHistory.goForward();
        else if(type==="devtools")view.webContents.openDevTools({mode:"detach"});
        return {...state};
    }
    return {action,destroy};
}
module.exports={createLocalBrowser};
