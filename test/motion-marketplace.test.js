"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {extractBundle,catalog}=require("../desktop/motion-marketplace");
test("curated community downloads reject unknown entries and modified archives",()=>{
    assert.throws(()=>extractBundle(Buffer.from("unexpected archive"),"remotion-render"),/empreinte/);
    assert.throws(()=>extractBundle(Buffer.from("unexpected archive"),"unlisted"),/inconnu/);
    assert.ok(catalog.every(item=>item.githubUrl.includes("/tree/6c67adcd9cdbe6eb84d76342da89b225f9161cb2/")));
});
