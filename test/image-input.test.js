"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),sharp=require("sharp");
const {prepareImageInput,MAX_IMAGE_SIDE,MAX_IMAGE_BYTES}=require("../src/api/image-input");
test("agent view_image prepares its own full-page screenshot and returns a readability warning",async()=>{
    const fs=require("node:fs/promises"),path=require("node:path"),os=require("node:os");
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"frst-agent-large-image-")),{state}=require("../src/state"),previous=state.pendingImages;
    state.pendingImages=[];
    try{
        const original=await sharp({create:{width:1280,height:10993,channels:3,background:"#345678"}}).png().toBuffer();
        const file=path.join(dir,"agent-capture.png");await fs.writeFile(file,original);
        const result=await require("../src/tools/view-image").viewImage({path:"agent-capture.png"},{workspace:dir,confirm:async()=>true});
        assert.equal(result.vision_queued,true);assert.equal(result.resized,true);assert.equal(result.original_dimensions.height,10993);assert.equal(result.sent_dimensions.height,6000);assert.match(result.readability_warning,/illisibles/);
        const transmitted=Buffer.from(state.pendingImages[0].split(",")[1],"base64");assert.equal((await sharp(transmitted).metadata()).height,6000);assert.deepEqual(await fs.readFile(file),original);
    }finally{state.pendingImages=previous;await fs.rm(dir,{recursive:true,force:true});}
});
test("full-page captures from reported errors fit provider dimensions even below 5 MB",async()=>{
    for(const height of [10993,8672]){
        const original=await sharp({create:{width:1280,height,channels:3,background:"#26364a"}}).png().toBuffer();
        assert.ok(original.length<MAX_IMAGE_BYTES);
        const copy=Buffer.from(original);
        const result=await prepareImageInput("data:image/png;base64,"+original.toString("base64"));
        const metadata=await sharp(result.bytes).metadata();
        assert.equal(result.resized,true);assert.ok(metadata.width<=MAX_IMAGE_SIDE);assert.equal(metadata.height,MAX_IMAGE_SIDE);
        assert.ok(Math.abs(metadata.width/metadata.height-1280/height)<.001);
        assert.ok(result.bytes.length<=MAX_IMAGE_BYTES);assert.deepEqual(original,copy);
    }
});
test("landscape captures are bounded, small images stay unchanged and invalid images fail",async()=>{
    const wide=await sharp({create:{width:10993,height:1280,channels:3,background:"white"}}).png().toBuffer();
    assert.equal((await prepareImageInput("data:image/png;base64,"+wide.toString("base64"))).width,MAX_IMAGE_SIDE);
    const small=await sharp({create:{width:120,height:80,channels:3,background:"red"}}).png().toBuffer();
    const result=await prepareImageInput("data:image/png;base64,"+small.toString("base64"));
    assert.equal(result.resized,false);assert.deepEqual(result.bytes,small);
    await assert.rejects(prepareImageInput("data:image/png;base64,aGVsbG8="),/décoder/);
});
