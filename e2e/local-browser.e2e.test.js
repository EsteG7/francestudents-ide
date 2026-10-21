"use strict";
/* global openFile */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),http=require("node:http"),crypto=require("node:crypto");
const {_electron}=require("playwright-core");

test("local browser renders frame-blocked apps with storage, fetch, websockets and navigation",{timeout:90000},async()=>{
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"frst-browser-"));
    const project=path.join(dir,"project");fs.mkdirSync(project);fs.writeFileSync(path.join(project,"app.js"),"const answer = 42;\n");
    const sockets=new Set();
    const server=http.createServer((req,res)=>{
        if(req.url==="/api"){res.setHeader("Content-Type","application/json");res.end('{"ok":true}');return;}
        res.setHeader("X-Frame-Options","DENY");res.setHeader("Content-Security-Policy","frame-ancestors 'none'");
        res.end(`<html><head><title>${req.url==="/two"?"Second page":"Local preview"}</title></head><body style="background:#182534;color:white;font:24px Arial;padding:40px"><h1>Local browser works</h1><a href="/two">Second page</a><script>localStorage.setItem('demo','saved');document.body.dataset.storage=localStorage.getItem('demo');fetch('/api').then(r=>r.json()).then(d=>document.body.dataset.api=String(d.ok));new WebSocket('ws://'+location.host).onmessage=e=>document.body.dataset.socket=e.data;document.body.dataset.bridge=typeof window.frst;document.body.dataset.node=typeof require;</script></body></html>`);
    });
    server.on("upgrade",(req,socket)=>{const accept=crypto.createHash("sha1").update(req.headers["sec-websocket-key"]+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+accept+"\r\n\r\n");socket.write(Buffer.from([0x81,9,...Buffer.from("HMR_READY")]));socket.on("error",()=>{});});
    server.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const url=`http://127.0.0.1:${server.address().port}/`;
    const harness=path.join(dir,"launch.cjs");
    fs.writeFileSync(harness,`require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root,"src/api/agents"))}).listAgents=async()=>({agents:[{id:-1002,name:'Test model'}],source:'local'});require(${JSON.stringify(path.join(root,"src/api/api"))}).requestModel=async()=>"Test summary";require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:require("electron"),args:[harness,"--user-data-dir="+path.join(dir,"electron")],env,cwd:root});
    try{
        const page=await app.firstWindow();const errors=[];page.on("pageerror",e=>errors.push(e.message));
        await page.locator("#startup-loading").waitFor({state:"hidden"});
        await page.evaluate(project=>window.frst.openProject(project),project);
        await page.evaluate(url=>{const a=document.createElement('a');a.id='test-local-link';a.href=url;a.textContent=url;document.getElementById('transcript').append(a);},url);
        await page.locator("#test-local-link").click();
        await page.waitForFunction(()=>document.getElementById("local-browser-status").textContent==="");
        const readNative=()=>app.evaluate(async({webContents},url)=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()===url);if(!wc)return null;return wc.executeJavaScript('({...document.body.dataset})');},url);
        let data;for(let i=0;i<40;i++){data=await readNative();if(data?.socket==="HMR_READY"&&data?.api==="true")break;await new Promise(resolve=>setTimeout(resolve,100));}
        assert.equal(data.storage,"saved");assert.equal(data.api,"true");assert.equal(data.socket,"HMR_READY");assert.equal(data.bridge,"undefined");assert.equal(data.node,"undefined");
        const views=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.map(view=>({visible:view.getVisible(),bounds:view.getBounds()})));
        assert.equal(views.length,1);assert.equal(views[0].visible,true);assert.ok(views[0].bounds.width>300);assert.ok(views[0].bounds.height>200);
        await page.evaluate(()=>openFile("app.js"));
        assert.equal(await page.locator("#local-browser-panel").isVisible(),false);
        await page.locator("#local-browser-tab").click();
        await page.locator("#local-browser-panel").waitFor({state:"visible"});
        const capture=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toDataURL());
        fs.writeFileSync(path.join(root,"release/local-browser-preview.png"),Buffer.from(capture.split(",")[1],"base64"));
        await page.locator("#local-browser-address").fill(url+"two");await page.locator("#local-browser-form").press("Enter");
        await page.waitForFunction(()=>document.getElementById("local-browser-tab").textContent.includes("Second page"));
        await page.locator("#local-browser-back").click();
        await page.waitForFunction(url=>document.getElementById("local-browser-address").value===url,url);
        await assert.rejects(page.evaluate(()=>window.frst.localBrowser("open",{url:"file:///C:/Windows/win.ini"})),/locale/);
        await page.evaluate(()=>window.frst.localBrowser("open",{url:"http://127.0.0.1:1/"}));
        await page.locator("#local-browser-error").waitFor({state:"visible"});
        await page.evaluate(()=>window.frst.localBrowser("hide"));
        await page.locator("#local-browser-tab .close").click();
        assert.equal(await page.locator("#local-browser-tab").count(),0);
        assert.deepEqual(errors,[]);
    }finally{await app.close();for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
