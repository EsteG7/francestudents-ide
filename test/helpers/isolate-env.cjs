"use strict";
/* global process */
// Every test process gets its own settings/history. Never read the user's access
// mode or overwrite their real data when running the normal unit-test command.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"frst-unit-process-"));
process.env.FS_DATA_DIR=directory;
process.env.FS_STATE_DIR=directory;
process.on("exit",()=>{
    const resolved=path.resolve(directory),root=path.resolve(os.tmpdir());
    if(path.dirname(resolved)===root && path.basename(resolved).startsWith("frst-unit-process-")){
        try{fs.rmSync(resolved,{recursive:true,force:true});}catch{/* Windows can retain a child-process file handle briefly. */}
    }
});
