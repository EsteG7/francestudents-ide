"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createReleaseHighlights}=require("../desktop/release-highlights");
test("release notes appear once per version, preserve settings and have a fallback for future updates",()=>{
    let saved={existing:"keep"};
    const make=(version,enabled=true)=>createReleaseHighlights({version,enabled,load:()=>saved,save:value=>Object.assign(saved,value)});
    const current=make("1.3.3");assert.equal(current.get().shouldShow,true);assert.equal(current.get().items.length,4);
    assert.throws(()=>current.seen("9.0.0"),/invalide/);assert.equal(current.get().shouldShow,true);
    current.seen("1.3.3");assert.equal(make("1.3.3").get().shouldShow,false);assert.equal(saved.existing,"keep");
    assert.equal(make("1.3.4").get().shouldShow,true);assert.equal(make("1.3.4").get().items.length,1);
    assert.equal(make("1.3.4",false).get().shouldShow,false);
});
