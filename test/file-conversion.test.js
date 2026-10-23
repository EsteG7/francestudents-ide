"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { convertAttachment } = require("../src/api/file-conversion");
const file = (name, bytes, type = "application/octet-stream") => ({ name, dataUrl: `data:${type};base64,${Buffer.from(bytes).toString("base64")}` });

test("PDF pages preserve order and visible content as PNGs", async () => {
    const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 5 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 6 0 R >> endobj
5 0 obj << /Length 25 >> stream
1 0 0 rg 0 0 10 10 re f
endstream
endobj
6 0 obj << /Length 25 >> stream
0 0 1 rg 0 0 10 10 re f
endstream
endobj
trailer << /Root 1 0 R >>
%%EOF`;
    const result = await convertAttachment(file("scan.pdf", pdf));
    assert.equal(result.images.length, 2);
    const pixels = [];
    for (const image of result.images) {
        const { data } = await sharp(Buffer.from(image.split(",")[1], "base64")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        pixels.push([...data.subarray(0, 3)]);
    }
    assert.deepEqual(pixels, [[255, 0, 0], [0, 0, 255]]);
});

test("text is transmitted intact and unreadable files get an honest partial report", async () => {
    const text = "Prénom;Note\nLéa;18";
    assert.match((await convertAttachment(file("notes.csv", text))).text, /Léa;18/);
    assert.equal((await convertAttachment(file("archive.zip", "PK1234"))).partial, true);
    assert.equal((await convertAttachment(file("fake.pdf", "not a PDF"))).partial, true);
});

test("TIFF is converted to PNG locally", async () => {
    const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).tiff().toBuffer();
    const result = await convertAttachment(file("image.tiff", tiff));
    assert.equal(result.images.length, 1);
    assert.match(result.images[0], /^data:image\/png;base64,/);
});

test("partial page upload is reused on next attempt", async () => {
    const { state } = require("../src/state");
    const { auth } = require("../src/api/auth");
    const { resolvePendingFiles } = require("../src/api/api");
    const fetch = global.fetch;
    const images = state.pendingImages, files = state.pendingFiles;
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300000;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
    const data = `data:image/png;base64,${png.toString("base64")}`;
    state.pendingImages = [];
    state.pendingFiles = [{ converted: { images: [data, data], text: "two pages" } }];
    let count = 0;
    global.fetch = async () => {
        count++;
        if (count === 2) return new Response("failure", { status: 500 });
        return Response.json({ uuid: count === 1 ? "11111111-2222-3333-4444-555555555555" : "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    };
    try {
        await assert.rejects(resolvePendingFiles(), /500/);
        assert.equal(await resolvePendingFiles(), "two pages");
        assert.equal(count, 3);
        assert.equal(state.pendingImages.length, 2);
    } finally {
        global.fetch = fetch;
        state.pendingImages = images;
        state.pendingFiles = files;
    }
});

// Minimal DOCX fixture containing one paragraph.
test("DOCX text is extracted locally", async () => {
    const bytes = Buffer.from("UEsDBAoAAAAIAMhGVl3GEnoHrAAAAPEAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbF2Puw7CMAxFf6XKihoXBgaUlIEdGPgBK3HbiOahJBT4exKQOjBax/dcWxxfdm4Wisl4J9mWd+zYi9s7UGoKcUmyKedwAEhqIouJ+0CukMFHi7mMcYSA6o4jwa7r9qC8y+Rym6uD9eJS5NFoaq4Y8xktSQZPHzVorx62bPJiY83pF6vNkmEIs1GYy02wOP3X2fphMIrWfLWF6BWlZNxoZ74Si8Ztqh56Ad+n+g9QSwMECgAAAAAAyEZWXQAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACADIRlZdWmNhIncAAACiAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1sRc7BDsIwCAbgV1n2ALJ48NDUHnyT2tZtZkBDu1Tf3rFl8fIRfkLANhM5rJiodh9cqJh276daswEoYUroy4Vzom32YkFft1ZGaCwxC4dUykwjLnAdhhugn6l3tpknx6/WrIhS3YPpzat05zkLmqqym3ePTfh/5X5QSwECFAAKAAAACADIRlZdxhJ6B6wAAADxAAAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAAoAAAAAAMhGVl0AAAAAAAAAAAAAAAAFAAAAAAAAAAAAEAAAAN0AAAB3b3JkL1BLAQIUAAoAAAAIAMhGVl1aY2EidwAAAKIAAAARAAAAAAAAAAAAAAAAAAABAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALMAAACmAQAAAAA=", "base64");
    const result = await convertAttachment(file("cours.docx", bytes));
    assert.match(result.text, /Bonjour document/);
    assert.deepEqual(result.images, []);
});
