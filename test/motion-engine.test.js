'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'desktop', 'renderer', 'src');
const names = ['MG_PROPS', 'MG_EASES', 'MG_PRESETS', 'mgEase', 'mgValue', 'mgIsVisible', 'mgDrawFrame', 'mgMakeLayer', 'mgNormalizeProject', 'mgApplyPreset', 'mgPresetKeys', 'mgStarterProject', 'mgBuildHtml'];

function loadEngine() {
    const code = fs.readFileSync(path.join(src, '37-motion-engine.js'), 'utf8');
    return new Function(code + '\nreturn { ' + names.join(', ') + ' };')();
}

const E = loadEngine();

test('mgEase : bornes 0 et 1pour tous les easings', () => {
    for (const ease of E.MG_EASES) {
        assert.equal(E.mgEase(ease.id, 0), 0, ease.id);
        assert.equal(E.mgEase(ease.id, 1), 1, ease.id);
        assert.equal(E.mgEase(ease.id, -3), 0, ease.id);
        assert.equal(E.mgEase(ease.id, 7), 1, ease.id);
        const mid = E.mgEase(ease.id, 0.5);
        assert.ok(Number.isFinite(mid), ease.id);
    }
    assert.equal(E.mgEase('linear', 0.25), 0.25);
    assert.ok(E.mgEase('in', 0.5) < 0.5);
    assert.ok(E.mgEase('out', 0.5) > 0.5);
});

test('mgValue : interpolation, bornes avant/après et absence de keyframes', () => {
    const layer = { x: 5, keys: { x: [{ t: 0, v: 0, ease: 'linear' }, { t: 2, v: 100, ease: 'linear' }] } };
    assert.equal(E.mgValue(layer, 'x', 1), 50);
    assert.equal(E.mgValue(layer, 'x', -1), 0);
    assert.equal(E.mgValue(layer, 'x', 9), 100);
    assert.equal(E.mgValue(layer, 'y', 1), undefined);
    assert.equal(E.mgValue({ y: 12, keys: {} }, 'y', 1), 12);
    const three = { keys: { x: [{ t: 0, v: 0 }, { t: 1, v: 10 }, { t: 2, v: 0 }] } };
    assert.equal(E.mgValue(three, 'x', 1), 10);
    assert.equal(E.mgValue(three, 'x', 1.5), 5);
});
function recorder() {
    const calls = [];
    const ctx = new Proxy({}, {
        get: (target, key) => (...args) => { calls.push(String(key)); return args; },
        set: () => true
    });
    return { ctx, calls };
}

test('mgNormalizeProject : entrées invalides et valeurs hors limites', () => {
    for (const raw of [null, undefined, 'x', 42, [], { layers: 'abc' }, { width: 'NaN', height: -5, duration: 1e9, layers: [null, 3, 'a'] }]) {
        const p = E.mgNormalizeProject(raw);
        assert.ok(Array.isArray(p.layers));
        for (const k of ['width', 'height', 'duration']) assert.ok(Number.isFinite(p[k]) && p[k] > 0, k);
    }
    const p = E.mgNormalizeProject({ name: 'Test', layers: [{ type: 'text', text: 'Hello', keys: { x: [{ t: 'abc', v: 'zz' }, { t: 1, v: 5, ease: 'inconnu' }, null] } }] });
    assert.equal(p.layers.length, 1);
    const frames = p.layers[0].keys.x;
    assert.ok(frames.length >= 1);
    for (const k of frames) {
        assert.ok(Number.isFinite(k.t) && Number.isFinite(k.v));
        assert.ok(E.MG_EASES.some((e) => e.id === k.ease));
    }
});

test('presets : chaque preset ajoute des keyframes triées', () => {
    const project = E.mgNormalizeProject({ name: 'P' });
    for (const preset of E.MG_PRESETS) {
        const layer = E.mgMakeLayer('rect', project);
        E.mgApplyPreset(layer, preset.id, project);
        const keys = Object.keys(layer.keys);
        assert.ok(keys.length >= 1, preset.id);
        for (const key of keys) {
            const list = layer.keys[key];
            assert.ok(list.length >= 1, preset.id);
            for (let i = 1; i < list.length; i++) assert.ok(list[i].t >= list[i - 1].t, preset.id);
        }
    }
});

test('mgStarterProject + mgDrawFrame : dessine sans erreur et équilibre save/restore', () => {
    const project = E.mgStarterProject();
    assert.equal(project.layers.length, 3);
    for (const t of [0, 0.5, 1.5, project.duration]) {
        const { ctx, calls } = recorder();
        E.mgDrawFrame(ctx, project, t);
        assert.ok(calls.includes('fillRect'));
        const saves = calls.filter((c) => c === 'save').length;
        const restores = calls.filter((c) => c === 'restore').length;
        assert.equal(saves, restores);
    }
    const { ctx, calls } = recorder();
    E.mgDrawFrame(ctx, project, 2);
    assert.ok(calls.includes('fillText'));
    assert.ok(calls.includes('ellipse'));
});

test('mgBuildHtml : page autonome, sans fermeture de script injectée', () => {
    const project = E.mgNormalizeProject({ name: 'Piege <b>' });
    const layer = E.mgMakeLayer('text', project);
    layer.text = 'x </script><script>alert(1)</script>';
    project.layers.push(layer);
    const html = E.mgBuildHtml(project);
    assert.ok(html.includes('<canvas'));
    assert.ok(html.includes('mgDrawFrame'));
    assert.equal(html.split('</script>').length - 1, 1);
    assert.ok(!html.includes('<script>alert'));
});

test('le studio natif est branché dans les sources du renderer', () => {
    const modules = fs.readdirSync(src).filter((n) => /^\d{2}-[\w-]+[.]js$/.test(n)).sort();
    const i36 = modules.indexOf('36-motion-design.js');
    const i37 = modules.indexOf('37-motion-engine.js');
    const i38 = modules.indexOf('38-motion-studio.js');
    const iBoot = modules.indexOf('99-boot.js');
    assert.ok(i36 >= 0 && i36 < i37 && i37 < i38 && i38 < iBoot);
    const studio = fs.readFileSync(path.join(src, '38-motion-studio.js'), 'utf8');
    assert.ok(studio.includes('mg-studio'));
    assert.ok(studio.includes('mg-export-webm'));
    const css = fs.readFileSync(path.join(src, '..', 'motion.css'), 'utf8');
    assert.ok(css.includes('.mg-playhead'));
    assert.ok(css.includes('#app.view-motion #motion-view'));
});