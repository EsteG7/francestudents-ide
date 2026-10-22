"use strict";

async function mediaInput(bytes) {
    const media = await require("mediainfo.js").mediaInfoFactory({ format: "object" });
    try {
        const result = await media.analyzeData(() => bytes.length, (size, offset) => bytes.subarray(offset, offset + size));
        if (!result.media?.track?.length) throw new Error("Aucune piste multimédia reconnue.");
        return {
            images: [], partial: true,
            text: "Analyse multimédia partielle : métadonnées, pistes, codecs, dimensions, durée et informations sur les pistes de sous-titres. " +
                "Le son n’est pas transcrit et les images de la vidéo ne sont pas décodées : ne prétends pas avoir entendu ou visionné le contenu.\n" + JSON.stringify(result.media, null, 2)
        };
    } finally { media.close(); }
}

module.exports = { mediaInput };
