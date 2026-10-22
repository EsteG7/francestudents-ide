'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'desktop', 'renderer', 'src', '39-budget-notice.js');

function load(stubs = {}) {
    const code = fs.readFileSync(file, 'utf8');
    const factory = new Function('addEntry', 'escapeHtml', code + '\nreturn { parseBudgetNotice, formatBudgetNotice, renderBudgetEntry };');
    return factory(stubs.addEntry || (() => ({ setAttribute() {} })), stubs.escapeHtml || ((s) => String(s)));
}

const RAW = 'Budget de chat épuisé jusqu\'au 23/10/2026 04:59:59. HTTP 429: {"timestamp":"2026-10-22T15:57:01","status":429,"error":"Too Many Requests","message":"Chat budget exhausted. Reset at 2026-10-23T02:59:59.999413228Z.","errorCode":"REQUEST_FAILED","path":"/chats/stream"}';
const NOW = new Date('2026-10-22T13:57:01Z');

test('parseBudgetNotice : reconnaît le 429 brut et extrait la reprise en UTC', () => {
    const { parseBudgetNotice } = load();
    const notice = parseBudgetNotice(RAW);
    assert.ok(notice);
    assert.equal(notice.resetAt.toISOString(), '2026-10-23T02:59:59.000Z');
    assert.ok(parseBudgetNotice('Chat budget exhausted. Reset at 2026-10-13T02:59:59.999087269Z.'));
});

test('parseBudgetNotice : ignore les autres erreurs et tolère l\'absence de date', () => {
    const { parseBudgetNotice } = load();
    assert.equal(parseBudgetNotice('HTTP 500 : erreur interne'), null);
    assert.equal(parseBudgetNotice(undefined), null);
    assert.deepEqual(parseBudgetNotice('Chat budget exhausted.'), { resetAt: null });
});

test('formatBudgetNotice : « demain à 05:00 » (heure de Paris) sans JSON brut', () => {
    const { parseBudgetNotice, formatBudgetNotice } = load();
    const f = formatBudgetNotice(parseBudgetNotice(RAW), NOW);
    assert.equal(f.title, 'Budget de chat épuisé');
    assert.match(f.detail, /demain à 05:00 \(heure de Paris\)/);
    assert.equal(f.when, 'demain · 05:00');
    assert.equal(f.remaining, 'dans 13 h 03');
    assert.ok(!/429|REQUEST_FAILED|timestamp/.test(JSON.stringify(f)));
});

test('formatBudgetNotice : aujourd\'hui, plus tard, passé et sans date', () => {
    const { formatBudgetNotice } = load();
    const at = (iso) => ({ resetAt: new Date(iso) });
    assert.match(formatBudgetNotice(at('2026-10-22T18:59:59.999Z'), NOW).detail, /aujourd'hui à 21:00/);
    // Passage à l'heure d'hiver le 25/10/2026 à Paris : 10:59:59Z = 11:59:59 (UTC+1), affiché 12:00.
    assert.match(formatBudgetNotice(at('2026-10-25T10:59:59Z'), NOW).detail, /le dimanche 25 octobre à 12:00/);
    assert.equal(formatBudgetNotice(at('2026-10-22T13:57:30Z'), NOW).remaining, 'dans moins d\'une minute');
    assert.equal(formatBudgetNotice(at('2026-10-22T14:30:00Z'), NOW).remaining, 'dans 33 min');
    assert.match(formatBudgetNotice(at('2026-10-22T10:00:00Z'), NOW).detail, /tu peux réessayer/);
    assert.match(formatBudgetNotice({ resetAt: null }, NOW).detail, /quota de conversation/);
});

test('renderBudgetEntry : carte échappée avec détails techniques repliés', () => {
    let seen = null;
    const roles = {};
    const { parseBudgetNotice, renderBudgetEntry } = load({
        addEntry: (cls, html) => { seen = { cls, html }; return { setAttribute: (k, v) => { roles[k] = v; } }; },
        escapeHtml: (s) => String(s).replace(/</g, '&lt;')
    });
    renderBudgetEntry(parseBudgetNotice(RAW), RAW + '<b>');
    assert.equal(seen.cls, 'budget-notice');
    assert.match(seen.html, /budget-title/);
    assert.match(seen.html, /<details class="budget-tech">/);
    assert.ok(seen.html.includes('&lt;b>'));
    assert.equal(roles.role, 'status');
});