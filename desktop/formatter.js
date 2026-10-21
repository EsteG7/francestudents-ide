"use strict";
const prettier = require("prettier/standalone");
const plugins = ["babel","estree","typescript","postcss","html","markdown","yaml"].map(name => require(`prettier/plugins/${name}`));
const parsers = {js:"babel",jsx:"babel",mjs:"babel",cjs:"babel",ts:"typescript",tsx:"typescript",json:"json",jsonc:"json",css:"css",scss:"scss",less:"less",html:"html",htm:"html",vue:"vue",md:"markdown",markdown:"markdown",yaml:"yaml",yml:"yaml"};
async function formatDocument({file, text, tabSize = 4}) {
    if (typeof text !== "string" || text.length > 2000000) throw new Error("Le formatage est limité aux documents de 2 millions de caractères.");
    const extension = String(file || "").split(".").pop().toLowerCase();
    const parser = parsers[extension];
    if (!parser) throw new Error("Formatage disponible pour JS, TS, JSON, CSS, HTML, Vue, Markdown et YAML.");
    const result = await prettier.format(text, {parser, plugins, tabWidth:Math.max(2,Math.min(8,Number(tabSize)||4)),useTabs:false,endOfLine:"lf"});
    return {text:result, changed:result !== text};
}
module.exports = {formatDocument, parsers};
