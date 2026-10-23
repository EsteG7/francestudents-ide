"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const code=fs.readFileSync(path.join(__dirname,"../desktop/renderer/src/44-api-notices.js"),"utf8");
const {parseApiErrorNotice,quotaCountdown}=new Function("setInterval",code+"\nreturn {parseApiErrorNotice,quotaCountdown};")(()=>{});
test("API failures use understandable categories including unknown server errors",()=>{
    for(const [raw,kind] of [["HTTP 401: expired","auth"],["HTTP 403: forbidden","auth"],["HTTP 429: slow down","wait"],["HTTP 413: too large","attachment"],["HTTP 504: timeout","wait"],["HTTP 502: bad gateway","service"],["fetch failed: ECONNRESET","network"],['Erreur du flux : {"message":"unknown provider failure"}',"service"]])assert.equal(parseApiErrorNotice(raw).kind,kind,raw);
    assert.equal(parseApiErrorNotice('API error: {"status":422}').status,422);
    assert.equal(parseApiErrorNotice("Le fichier local est introuvable"),null);
});
test("quota countdown follows hours and minutes, unknown dates and expiry",()=>{
    const now=Date.parse("2026-10-23T10:00:00Z");
    assert.equal(quotaCountdown("2026-10-23T12:15:00Z",now),"Réinitialisation dans 2 h 15 min");
    assert.equal(quotaCountdown("2026-10-23T10:01:00Z",now),"Réinitialisation dans 0 h 01 min");
    assert.match(quotaCountdown("2026-10-23T09:00:00Z",now),/Échéance atteinte/);
    assert.match(quotaCountdown(null,now),/non communiquée/);
    assert.match(quotaCountdown("invalid",now),/non communiquée/);
});
