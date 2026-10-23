"use strict";

async function svgInput(bytes) {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    const source = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) return { source, note: "Source SVG conservée ; rendu désactivé pour les déclarations externes.", images: [] };
    const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    if (document.documentElement?.localName !== "svg") throw new Error("Document SVG invalide.");
    let changed = false;
    for (const element of Array.from(document.getElementsByTagName("*"))) {
        if (["script", "foreignObject"].includes(element.localName) ||
            (element.localName === "style" && /url\s*\(|@import|\\/i.test(element.textContent))) {
            element.parentNode?.removeChild(element); changed = true; continue;
        }
        for (const attribute of Array.from(element.attributes || [])) {
            const name = attribute.localName.toLowerCase();
            if (name.startsWith("on") || name === "base" ||
                (["href", "src"].includes(name) && !/^(?:#|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(attribute.value)) ||
                /url\s*\(|@import|\\/i.test(attribute.value)) {
                element.removeAttributeNode(attribute); changed = true;
            }
        }
    }
    const png = await require("sharp")(Buffer.from(new XMLSerializer().serializeToString(document)), { limitInputPixels: 100000000 }).png().toBuffer();
    return { source, images: [`data:image/png;base64,${png.toString("base64")}`],
        note: changed ? "Rendu SVG sans scripts ni ressources externes ; la source originale complète est fournie." : "Source SVG complète et rendu PNG." };
}

module.exports = { svgInput };
