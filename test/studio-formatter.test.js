"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {formatDocument}=require("../desktop/formatter");
test("Prettier : JS, JSON, CSS, Markdown et YAML sans chargement de plugins du projet",async()=>{for(const [file,text,pattern]of[["a.js","const x={a:1}",/const x =/],["a.json",'{"a":1}',/"a": 1/],["a.css","body{color:red}",/color: red/],["a.md","#  Title",/# Title/],["a.yml","a:   1",/a: 1/]]){const result=await formatDocument({file,text,tabSize:2});assert.match(result.text,pattern);assert.equal(result.changed,true);}});
test("formatage : syntaxe invalide, type inconnu et taille refusés",async()=>{await assert.rejects(formatDocument({file:"a.js",text:"const = ;"}));await assert.rejects(formatDocument({file:"a.py",text:"x=1"}),/disponible/);await assert.rejects(formatDocument({file:"a.js",text:"a".repeat(2000001)}),/limité/);});
