"use strict";
const path=require("node:path");
function motionWorkspace(){return path.join(require("./config").CONFIG.dataDir,"motion-workspace");}
function toolWorkspace(){const {state}=require("./state");return state.motionDesign?motionWorkspace():state.workspace;}
module.exports={motionWorkspace,toolWorkspace};
