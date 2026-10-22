/* ---------- Motion design : studio natif (canvas, calques, keyframes, timeline, sauvegarde, export) ---------- */
/* Dépend de 36-motion-design.js (onglet) et de 37-motion-engine.js (moteur pur). Aucune dépendance externe. */
const mgs = { project: null, selected: null, t: 0, playing: false, since: 0, undo: [], lastMut: { tag: '', at: 0 }, dirty: false, file: '', busy: false, drag: null, scrub: false };
const MG_DIR = 'motion';
const MG_EXT = '.motion.json';
const MG_FIELDS = [
    { k: 'name', label: 'Nom', type: 'text' },
    { k: 'width', label: 'Largeur (px)', type: 'number', min: 64, max: 3840, step: 10 },
    { k: 'height', label: 'Hauteur (px)', type: 'number', min: 64, max: 3840, step: 10 },
    { k: 'fps', label: 'Images / s', type: 'number', min: 1, max: 60, step: 1 },
    { k: 'duration', label: 'Durée (s)', type: 'number', min: 0.5, max: 120, step: 0.5 },
    { k: 'background', label: 'Fond', type: 'color' }
];

const mgStudio = document.createElement('section');
mgStudio.id = 'mg-studio';
mgStudio.className = 'mg-studio';
mgStudio.setAttribute('aria-label', 'Studio motion design');
mgStudio.innerHTML = `
 <div class='mg-bar'>
  <button type='button' id='mg-new'>Nouveau</button>
  <button type='button' id='mg-example'>Exemple</button>
  <select id='mg-open' aria-label='Ouvrir un projet enregistré'><option value=''>Ouvrir un projet…</option></select>
  <button type='button' id='mg-save' class='primary'>Enregistrer</button>
  <button type='button' id='mg-undo'>Annuler</button>
  <span class='mg-grow'></span>
  <button type='button' id='mg-export-html'>Exporter HTML</button>
  <button type='button' id='mg-export-webm'>Exporter WebM</button>
  <button type='button' id='mg-effectcraft' title='Charge le moteur EffectCraft externe (≈ 63 Mo, expérimental)'>EffectCraft…</button>
 </div>
 <div class='mg-meta'><span id='mg-file' class='mg-file'></span><span id='mg-status' class='mg-status' role='status'></span></div>
 <div class='mg-main'>
  <div class='mg-preview'>
   <div class='mg-canvas-wrap'><canvas id='mg-canvas' width='1280' height='720' aria-label='Aperçu de l’animation (glisse un calque pour le déplacer)'></canvas></div>
   <div class='mg-transport'>
    <button type='button' id='mg-play'>Lecture</button>
    <button type='button' id='mg-stop'>Début</button>
    <input id='mg-time' type='range' min='0' max='1000' value='0' aria-label='Position dans l’animation'>
    <span id='mg-clock' class='mg-clock'>0.00 / 5.00 s</span>
    <label class='mg-loop'><input type='checkbox' id='mg-loop' checked> Boucle</label>
   </div>
  </div>
  <aside class='mg-side'>
   <div class='mg-block'><h3>Projet</h3><div id='mg-project' class='mg-grid'></div></div>
   <div class='mg-block'>
    <h3>Calques</h3>
    <div class='mg-add'>
     <button type='button' data-mg-add='text'>+ Texte</button><button type='button' data-mg-add='rect'>+ Rectangle</button><button type='button' data-mg-add='ellipse'>+ Ellipse</button>
    </div>
    <ul id='mg-layers' class='mg-layers'></ul>
    <div class='mg-add'>
     <button type='button' id='mg-front' title='Mettre devant'>▲</button><button type='button' id='mg-back' title='Mettre derrière'>▼</button><button type='button' id='mg-dup'>Dupliquer</button><button type='button' id='mg-del'>Supprimer</button>
    </div>
   </div>
   <div class='mg-block' id='mg-props'></div>
  </aside>
 </div>
 <div id='mg-timeline' class='mg-tl' aria-label='Timeline : clique ou glisse pour te déplacer dans le temps'></div>`;
motionView.insertBefore(mgStudio, motionView.querySelector('.motion-stage'));
motionView.querySelector('.motion-stage').hidden = true;

function mgEl(tag, attrs, text) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === false || v === null || v === undefined) continue;
        el.setAttribute(k, v === true ? '' : String(v));
    }
    if (text !== undefined) el.textContent = text;
    return el;
}

function mgStatus(message, isError) {
    const el = $('mg-status');
    el.textContent = message;
    el.classList.toggle('error', !!isError);
}

function mgSlug(name) {
    return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'animation';
}

function mgSelectedLayer() { return mgs.project.layers.find((l) => l.id === mgs.selected) || null; }
function mgKeyAt(layer, key, t) { return (layer.keys[key] || []).find((k) => Math.abs(k.t - t) < 0.02) || null; }
function mgKeyBefore(layer, key, t) { return (layer.keys[key] || []).filter((k) => k.t <= t + 0.02).pop() || null; }

function mgUpdateFile() {
    $('mg-file').textContent = (mgs.file || 'Projet non enregistré') + (mgs.dirty ? ' · modifications non enregistrées' : '');
}

function mgMutate(tag, fn) {
    const now = Date.now();
    if (tag !== mgs.lastMut.tag || now - mgs.lastMut.at > 800) {
        mgs.undo.push(JSON.stringify(mgs.project));
        if (mgs.undo.length > 60) mgs.undo.shift();
    }
    mgs.lastMut = { tag, at: now };
    fn();
    mgs.dirty = true;
    mgUpdateFile();
}
function mgSetProp(layer, key, value) {
    const range = key === 'opacity' ? [0, 1] : key === 'scale' ? [0, 1000] : [-100000, 100000];
    const v = mgRound(mgNum(value, mgValue(layer, key, mgs.t), range[0], range[1]));
    const frames = layer.keys[key];
    if (frames && frames.length) {
        const hit = mgKeyAt(layer, key, mgs.t);
        if (hit) hit.v = v;
        else {
            const prev = mgKeyBefore(layer, key, mgs.t);
            frames.push({ t: mgRound(mgs.t), v, ease: prev ? prev.ease : 'out' });
            frames.sort((a, b) => a.t - b.t);
        }
    } else layer[key] = v;
}

function mgBounds(ctx, layer) {
    if (layer.type === 'text') {
        ctx.save();
        ctx.font = mgFont(layer);
        const w = ctx.measureText(layer.text).width;
        ctx.restore();
        return { w: Math.max(8, w), h: layer.fontSize * 1.2 };
    }
    return { w: layer.w, h: layer.h };
}

function mgDraw() {
    const canvas = $('mg-canvas');
    const project = mgs.project;
    if (canvas.width !== project.width) canvas.width = project.width;
    if (canvas.height !== project.height) canvas.height = project.height;
    const ctx = canvas.getContext('2d');
    mgDrawFrame(ctx, project, mgs.t);
    if (mgs.playing || mgs.busy) return;
    const layer = mgSelectedLayer();
    if (!layer || !mgIsVisible(layer, project, mgs.t)) return;
    const b = mgBounds(ctx, layer);
    const s = Math.max(0.05, mgValue(layer, 'scale', mgs.t));
    ctx.save();
    ctx.translate(mgValue(layer, 'x', mgs.t), mgValue(layer, 'y', mgs.t));
    ctx.rotate(mgValue(layer, 'rotation', mgs.t) * Math.PI / 180);
    ctx.scale(s, s);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 3 / s;
    ctx.setLineDash([10 / s, 6 / s]);
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();
}

function mgHit(px, py) {
    const ctx = $('mg-canvas').getContext('2d');
    const layers = mgs.project.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        if (!mgIsVisible(l, mgs.project, mgs.t)) continue;
        const s = mgValue(l, 'scale', mgs.t);
        if (s <= 0) continue;
        const a = -mgValue(l, 'rotation', mgs.t) * Math.PI / 180;
        const dx = px - mgValue(l, 'x', mgs.t);
        const dy = py - mgValue(l, 'y', mgs.t);
        const rx = (dx * Math.cos(a) - dy * Math.sin(a)) / s;
        const ry = (dx * Math.sin(a) + dy * Math.cos(a)) / s;
        const b = mgBounds(ctx, l);
        if (Math.abs(rx) <= b.w / 2 && Math.abs(ry) <= b.h / 2) return l;
    }
    return null;
}

function mgSeek(t) {
    const d = mgs.project.duration;
    mgs.t = Math.max(0, Math.min(d, Number.isFinite(t) ? t : 0));
    mgDraw();
    $('mg-time').value = String(Math.round(mgs.t / d * 1000));
    $('mg-clock').textContent = `${mgs.t.toFixed(2)} / ${d.toFixed(2)} s`;
    mgUpdatePlayhead();
    mgRefreshValues();
}

function mgUpdatePlayhead() {
    const ph = $('mg-playhead');
    if (ph) ph.style.left = `calc(130px + (100% - 130px) * ${mgs.t / mgs.project.duration})`;
}

function mgPlay() {
    if (mgs.playing || mgs.busy) return;
    if (mgs.t >= mgs.project.duration - 0.01) mgs.t = 0;
    mgs.playing = true;
    mgs.since = performance.now();
    $('mg-play').textContent = 'Pause';
    requestAnimationFrame(mgTick);
}

function mgPause() {
    if (!mgs.playing) return;
    mgs.playing = false;
    $('mg-play').textContent = 'Lecture';
    mgSeek(mgs.t);
}

function mgTick(now) {
    if (!mgs.playing) return;
    if (!isMotionOpen()) { mgPause(); return; }
    const d = mgs.project.duration;
    let t = mgs.t + (now - mgs.since) / 1000;
    mgs.since = now;
    if (t >= d) {
        if ($('mg-loop').checked) t %= d;
        else { mgs.t = d; mgPause(); return; }
    }
    mgSeek(t);
    requestAnimationFrame(mgTick);
}
function mgRenderLayers() {
    const ul = $('mg-layers');
    ul.replaceChildren();
    const list = mgs.project.layers.slice().reverse();
    if (!list.length) ul.append(mgEl('li', { class: 'mg-empty' }, 'Aucun calque : ajoute un texte ou une forme.'));
    for (const layer of list) {
        const li = mgEl('li', { class: 'mg-layer' + (layer.id === mgs.selected ? ' active' : '') });
        const eye = mgEl('button', { type: 'button', title: layer.hidden ? 'Afficher le calque' : 'Masquer le calque', 'aria-label': (layer.hidden ? 'Afficher ' : 'Masquer ') + layer.name, 'aria-pressed': String(!layer.hidden) }, layer.hidden ? '○' : '●');
        eye.onclick = () => { mgMutate('hide:' + layer.id, () => { layer.hidden = !layer.hidden; }); mgRenderLayers(); mgDraw(); };
        const icon = layer.type === 'text' ? 'T' : layer.type === 'ellipse' ? '◯' : '▭';
        const name = mgEl('button', { type: 'button', class: 'mg-layer-name' }, `${icon}  ${layer.name}`);
        name.onclick = () => mgSelect(layer.id);
        li.append(eye, name);
        ul.append(li);
    }
}

function mgField(parent, label, input) {
    const wrap = mgEl('label', { class: 'mg-field' });
    wrap.append(mgEl('span', {}, label), input);
    parent.append(wrap);
    return input;
}

function mgAfterEdit(layersChanged) {
    mgDraw();
    mgRenderTimeline();
    if (layersChanged) mgRenderLayers();
}

function mgRenderProps() {
    const box = $('mg-props');
    box.replaceChildren();
    const layer = mgSelectedLayer();
    if (!layer) {
        box.append(mgEl('p', { class: 'mg-empty' }, 'Sélectionne un calque (liste, aperçu ou timeline) pour modifier ses propriétés et ses keyframes.'));
        return;
    }
    box.append(mgEl('h3', {}, 'Propriétés'));
    const grid = mgEl('div', { class: 'mg-grid' });
    box.append(grid);
    const text = (key, label, max) => {
        const input = mgField(grid, label, mgEl('input', { type: 'text', maxlength: max }));
        input.value = layer[key];
        input.addEventListener('input', () => { mgMutate('f:' + layer.id + key, () => { layer[key] = input.value.slice(0, max) || (key === 'name' ? layer.name : ''); }); mgAfterEdit(key === 'name'); });
    };
    const number = (key, label, min, max, step) => {
        const input = mgField(grid, label, mgEl('input', { type: 'number', min, max, step }));
        input.value = String(layer[key]);
        input.addEventListener('input', () => { if (input.value === '') return; mgMutate('f:' + layer.id + key, () => { layer[key] = mgNum(input.value, layer[key], min, max); }); mgAfterEdit(false); });
    };
    text('name', 'Nom', 80);
    if (layer.type === 'text') {
        text('text', 'Texte', 500);
        number('fontSize', 'Taille', 8, 600, 2);
        const bold = mgField(grid, 'Gras', mgEl('input', { type: 'checkbox' }));
        bold.checked = layer.bold;
        bold.addEventListener('change', () => { mgMutate('f:' + layer.id + 'bold', () => { layer.bold = bold.checked; }); mgAfterEdit(false); });
    } else {
        number('w', 'Largeur', 1, 8000, 10);
        number('h', 'Hauteur', 1, 8000, 10);
    }
    const fill = mgField(grid, 'Couleur', mgEl('input', { type: 'color' }));
    fill.value = layer.fill;
    fill.addEventListener('input', () => { mgMutate('f:' + layer.id + 'fill', () => { layer.fill = mgColor(fill.value, layer.fill); }); mgAfterEdit(false); });
    number('start', 'Apparition (s)', 0, mgs.project.duration, 0.1);
    number('end', 'Fin (s, 0 = durée)', 0, mgs.project.duration, 0.1);

    box.append(mgEl('h4', {}, 'Animation à l’instant affiché'));
    box.append(mgEl('p', { class: 'mg-hint' }, 'Place le curseur, change une valeur puis pose un keyframe avec ◆. Une propriété déjà animée crée un keyframe à chaque modification.'));
    for (const prop of MG_PROPS) {
        const row = mgEl('div', { class: 'mg-prop' });
        row.append(mgEl('span', { class: 'mg-prop-label' }, prop.label));
        const input = mgEl('input', { type: 'number', step: prop.step, 'data-mg-prop': prop.key, 'aria-label': prop.label });
        input.addEventListener('input', () => {
            if (input.value === '') return;
            mgMutate('p:' + layer.id + prop.key, () => mgSetProp(layer, prop.key, input.value));
            mgAfterEdit(false);
            mgRefreshValues();
        });
        const diamond = mgEl('button', { type: 'button', class: 'mg-diamond', 'data-mg-key': prop.key, title: 'Poser ou retirer un keyframe à cet instant', 'aria-label': 'Keyframe ' + prop.label }, '◆');
        diamond.onclick = () => {
            mgMutate('k:' + layer.id + prop.key, () => {
                const hit = mgKeyAt(layer, prop.key, mgs.t);
                const frames = layer.keys[prop.key] || [];
                if (hit) {
                    frames.splice(frames.indexOf(hit), 1);
                    if (frames.length) layer.keys[prop.key] = frames;
                    else { delete layer.keys[prop.key]; layer[prop.key] = hit.v; }
                } else {
                    const value = mgValue(layer, prop.key, mgs.t);
                    const prev = mgKeyBefore(layer, prop.key, mgs.t);
                    frames.push({ t: mgRound(mgs.t), v: mgRound(value), ease: prev ? prev.ease : 'out' });
                    frames.sort((a, b) => a.t - b.t);
                    layer.keys[prop.key] = frames;
                }
            });
            mgAfterEdit(false);
            mgRefreshValues();
        };
        const ease = mgEl('select', { 'data-mg-ease': prop.key, title: 'Courbe jusqu’au keyframe suivant', 'aria-label': 'Courbe ' + prop.label });
        for (const e of MG_EASES) ease.append(mgEl('option', { value: e.id }, e.label));
        ease.addEventListener('change', () => {
            const k = mgKeyAt(layer, prop.key, mgs.t) || mgKeyBefore(layer, prop.key, mgs.t);
            if (!k) return;
            mgMutate('e:' + layer.id + prop.key, () => { k.ease = ease.value; });
            mgSeek(mgs.t);
        });
        const clear = mgEl('button', { type: 'button', title: 'Supprimer toute l’animation de cette propriété', 'aria-label': 'Effacer l’animation ' + prop.label }, '∅');
        clear.onclick = () => {
            if (!(layer.keys[prop.key] || []).length) return;
            mgMutate('c:' + layer.id + prop.key, () => { layer[prop.key] = mgValue(layer, prop.key, mgs.t); delete layer.keys[prop.key]; });
            mgAfterEdit(false);
            mgRefreshValues();
        };
        row.append(input, diamond, ease, clear);
        box.append(row);
    }

    box.append(mgEl('h4', {}, 'Animations prêtes à l’emploi'));
    const presets = mgEl('div', { class: 'mg-add' });
    for (const preset of MG_PRESETS) {
        const button = mgEl('button', { type: 'button' }, preset.label);
        button.onclick = () => {
            mgMutate('preset', () => mgApplyPreset(layer, preset.id, mgs.project));
            mgRenderTimeline();
            mgSeek(preset.id === 'out' ? Math.max(0, (layer.end > 0 ? layer.end : mgs.project.duration) - 0.35) : layer.start + 0.5);
        };
        presets.append(button);
    }
    box.append(presets);
    mgRefreshValues();
}

function mgRefreshValues() {
    const layer = mgSelectedLayer();
    if (!layer) return;
    for (const input of mgStudio.querySelectorAll('[data-mg-prop]')) {
        if (document.activeElement === input) continue;
        input.value = String(mgRound(mgValue(layer, input.dataset.mgProp, mgs.t)));
    }
    for (const button of mgStudio.querySelectorAll('[data-mg-key]')) {
        const on = !!mgKeyAt(layer, button.dataset.mgKey, mgs.t);
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', String(on));
    }
    for (const select of mgStudio.querySelectorAll('[data-mg-ease]')) {
        const key = select.dataset.mgEase;
        const k = mgKeyAt(layer, key, mgs.t) || mgKeyBefore(layer, key, mgs.t);
        select.disabled = !k;
        select.value = k ? k.ease : 'linear';
    }
}

function mgTimeFromX(clientX) {
    const track = mgStudio.querySelector('.mg-ruler .mg-track');
    if (!track) return mgs.t;
    const rect = track.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(1, ratio)) * mgs.project.duration;
}

function mgRenderTimeline() {
    const box = $('mg-timeline');
    box.replaceChildren();
    const d = mgs.project.duration;
    const ruler = mgEl('div', { class: 'mg-row mg-ruler' });
    ruler.append(mgEl('span', { class: 'mg-row-label' }, 'Temps'));
    const rulerTrack = mgEl('div', { class: 'mg-track' });
    const step = d <= 6 ? 1 : d <= 30 ? 5 : 10;
    for (let s = 0; s <= d + 0.001; s += step) {
        const tick = mgEl('span', { class: 'mg-tick' }, s + ' s');
        tick.style.left = (s / d * 100) + '%';
        rulerTrack.append(tick);
    }
    ruler.append(rulerTrack);
    box.append(ruler);
    for (const layer of mgs.project.layers.slice().reverse()) {
        const row = mgEl('div', { class: 'mg-row' + (layer.id === mgs.selected ? ' active' : '') });
        const label = mgEl('button', { type: 'button', class: 'mg-row-label' }, layer.name);
        label.onclick = () => mgSelect(layer.id);
        row.append(label);
        const track = mgEl('div', { class: 'mg-track' });
        const end = layer.end > 0 ? layer.end : d;
        const span = mgEl('span', { class: 'mg-span' });
        span.style.left = (layer.start / d * 100) + '%';
        span.style.width = (Math.max(0, end - layer.start) / d * 100) + '%';
        track.append(span);
        for (const key of Object.keys(layer.keys)) {
            for (const k of layer.keys[key]) {
                const btn = mgEl('button', { type: 'button', class: 'mg-key', title: `${key} · ${k.t.toFixed(2)} s`, 'aria-label': `Keyframe ${key} à ${k.t.toFixed(2)} s`, 'data-key': key, 'data-layer': layer.id, 'data-t': k.t });
                btn.style.left = (k.t / d * 100) + '%';
                btn.onclick = () => { mgSelect(layer.id); mgPause(); mgSeek(k.t); };
                track.append(btn);
            }
        }
        row.append(track);
        box.append(row);
    }
    box.append(mgEl('div', { id: 'mg-playhead', class: 'mg-playhead' }));
    mgUpdatePlayhead();
}

function mgClampDuration() {
    const d = mgs.project.duration;
    for (const l of mgs.project.layers) {
        l.start = Math.min(l.start, d);
        if (l.end > d) l.end = d;
        for (const key of Object.keys(l.keys)) for (const k of l.keys[key]) k.t = Math.min(k.t, d);
    }
    mgs.t = Math.min(mgs.t, d);
}

function mgRenderProject() {
    const box = $('mg-project');
    box.replaceChildren();
    for (const f of MG_FIELDS) {
        const attrs = { type: f.type };
        if (f.type === 'number') Object.assign(attrs, { min: f.min, max: f.max, step: f.step });
        if (f.type === 'text') attrs.maxlength = 80;
        const input = mgField(box, f.label, mgEl('input', attrs));
        input.value = String(mgs.project[f.k]);
        input.addEventListener(f.type === 'number' ? 'change' : 'input', () => {
            if (input.value === '') return;
            mgMutate('proj:' + f.k, () => {
                const p = mgs.project;
                if (f.type === 'number') p[f.k] = mgNum(input.value, p[f.k], f.min, f.max);
                else if (f.type === 'color') p[f.k] = mgColor(input.value, p[f.k]);
                else p[f.k] = input.value.slice(0, 80) || p[f.k];
                if (f.k === 'duration') mgClampDuration();
            });
            if (f.type === 'number') input.value = String(mgs.project[f.k]);
            if (f.k === 'duration') { mgRenderTimeline(); mgRenderProps(); mgSeek(mgs.t); }
            else mgDraw();
        });
    }
}

function mgSelect(id) {
    mgs.selected = id;
    mgRenderLayers();
    mgRenderProps();
    mgRenderTimeline();
    mgDraw();
}

function mgRebuild() {
    const layers = mgs.project.layers;
    if (!mgSelectedLayer()) mgs.selected = layers.length ? layers[layers.length - 1].id : null;
    mgRenderProject();
    mgRenderLayers();
    mgRenderProps();
    mgRenderTimeline();
    mgSeek(Math.min(mgs.t, mgs.project.duration));
    mgUpdateFile();
}

function mgConfirmDiscard() {
    return !mgs.dirty || window.confirm('Des modifications ne sont pas enregistrées. Les abandonner ?');
}

function mgLoadProject(project, file) {
    mgPause();
    mgs.project = project;
    mgs.file = file || '';
    mgs.undo = [];
    mgs.lastMut = { tag: '', at: 0 };
    mgs.dirty = false;
    mgs.t = 0;
    mgs.selected = project.layers.length ? project.layers[project.layers.length - 1].id : null;
    mgRebuild();
}

function mgUndo() {
    const snap = mgs.undo.pop();
    if (!snap) { mgStatus('Rien à annuler.'); return; }
    try { mgs.project = mgNormalizeProject(JSON.parse(snap)); }
    catch (error) { mgStatus('Annulation impossible.', true); return; }
    mgs.lastMut = { tag: '', at: 0 };
    mgs.dirty = true;
    mgRebuild();
    mgStatus('Modification annulée.');
}

function mgErrorText(error) { return error && error.message ? error.message : String(error); }

async function mgEnsureDir() {
    try { await window.frst.listDir(MG_DIR); }
    catch (error) { await window.frst.createEntry(MG_DIR, 'directory'); }
}

async function mgRefreshList() {
    const select = $('mg-open');
    let entries;
    try { entries = await window.frst.listDir(MG_DIR); } catch (error) { entries = []; }
    const names = entries.filter((e) => e.type !== 'directory' && e.name.endsWith(MG_EXT)).map((e) => e.name).sort();
    select.replaceChildren(mgEl('option', { value: '' }, names.length ? 'Ouvrir un projet…' : 'Aucun projet enregistré'));
    for (const n of names) select.append(mgEl('option', { value: n }, n.slice(0, -MG_EXT.length)));
}

async function mgSave() {
    if (mgs.busy) return;
    const project = mgs.project;
    const rel = `${MG_DIR}/${mgSlug(project.name)}${MG_EXT}`;
    try {
        await mgEnsureDir();
        if (rel !== mgs.file) {
            let exists = false;
            try { exists = (await window.frst.listDir(MG_DIR)).some((e) => e.name === rel.split('/').pop()); } catch (error) { exists = false; }
            if (exists && !window.confirm(`Le fichier ${rel} existe déjà. Le remplacer ?`)) return;
        }
        await window.frst.writeFile(rel, JSON.stringify(project, null, 2) + '\n');
        mgs.file = rel;
        mgs.dirty = false;
        mgUpdateFile();
        mgStatus(`Enregistré dans ${rel}.`);
        await mgRefreshList();
    } catch (error) {
        mgStatus('Enregistrement impossible : ' + mgErrorText(error) + ' (ouvre d’abord un dossier de projet).', true);
    }
}

async function mgOpen(name) {
    const select = $('mg-open');
    if (!name || !mgConfirmDiscard()) { select.value = ''; return; }
    try {
        const res = await window.frst.readFile(`${MG_DIR}/${name}`);
        mgLoadProject(mgNormalizeProject(JSON.parse(res.content)), `${MG_DIR}/${name}`);
        mgStatus(`Projet ${name} ouvert.`);
    } catch (error) {
        mgStatus('Ouverture impossible : ' + mgErrorText(error), true);
    }
    select.value = '';
}

async function mgExportHtml() {
    const project = mgs.project;
    const rel = `${MG_DIR}/${mgSlug(project.name)}.html`;
    try {
        await mgEnsureDir();
        await window.frst.writeFile(rel, mgBuildHtml(project));
        mgStatus(`Export HTML écrit dans ${rel} (fichier autonome, à ouvrir dans un navigateur).`);
        await mgRefreshList();
    } catch (error) {
        mgStatus('Export HTML impossible : ' + mgErrorText(error) + ' (ouvre d’abord un dossier de projet).', true);
    }
}

function mgSetBusy(busy) {
    mgs.busy = busy;
    for (const id of ['mg-new', 'mg-example', 'mg-open', 'mg-save', 'mg-undo', 'mg-export-html', 'mg-export-webm', 'mg-play', 'mg-stop', 'mg-time', 'mg-effectcraft']) {
        const el = $(id);
        if (el) el.disabled = busy;
    }
}

function mgDownload(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function mgExportWebm() {
    if (mgs.busy) return;
    const canvas = $('mg-canvas');
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
        mgStatus('Export WebM indisponible dans ce navigateur : utilise l’export HTML.', true);
        return;
    }
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
        mgStatus('Aucun codec WebM disponible : utilise l’export HTML.', true);
        return;
    }
    mgPause();
    const project = mgs.project;
    const d = project.duration;
    const resume = mgs.t;
    let stream = null;
    mgSetBusy(true);
    try {
        mgs.t = 0;
        mgDraw();
        stream = canvas.captureStream(project.fps);
        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const stopped = new Promise((resolve, reject) => {
            recorder.onstop = resolve;
            recorder.onerror = (e) => reject((e && e.error) || new Error('Erreur MediaRecorder'));
        });
        recorder.start(250);
        const t0 = performance.now();
        await new Promise((resolve) => {
            const step = (now) => {
                const t = Math.min(d, (now - t0) / 1000);
                mgs.t = t;
                mgDraw();
                $('mg-clock').textContent = `${t.toFixed(2)} / ${d.toFixed(2)} s`;
                mgStatus(`Enregistrement WebM… ${Math.round(t / d * 100)} %`);
                if (t >= d) resolve();
                else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        recorder.stop();
        await stopped;
        if (!chunks.length) throw new Error('aucune image enregistrée');
        const blob = new Blob(chunks, { type: 'video/webm' });
        const name = `${mgSlug(project.name)}.webm`;
        mgDownload(name, blob);
        mgStatus(`Vidéo ${name} générée (${(blob.size / 1048576).toFixed(1)} Mo) : vérifie le dossier de téléchargements.`);
    } catch (error) {
        mgStatus('Export WebM impossible : ' + mgErrorText(error), true);
    } finally {
        if (stream) for (const track of stream.getTracks()) track.stop();
        mgSetBusy(false);
        mgSeek(resume);
    }
}

/* ---------- Édition des calques et branchements ---------- */
function mgAddLayer(type) {
    if (mgs.busy) return;
    mgMutate('add', () => {
        const layer = mgMakeLayer(type, mgs.project);
        if (!mgs.project.layers.includes(layer)) mgs.project.layers.push(layer);
        mgs.selected = layer.id;
    });
    mgRenderLayers();
    mgRenderProps();
    mgRenderTimeline();
    mgDraw();
}

function mgMoveLayer(delta) {
    const layers = mgs.project.layers;
    const i = layers.findIndex((l) => l.id === mgs.selected);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= layers.length) return;
    mgMutate('move', () => { [layers[i], layers[j]] = [layers[j], layers[i]]; });
    mgRenderLayers();
    mgRenderTimeline();
    mgDraw();
}

function mgDuplicateLayer() {
    const layer = mgSelectedLayer();
    if (!layer || mgs.busy) return;
    mgMutate('dup', () => {
 const layers = mgs.project.layers;
        const tmp = mgMakeLayer('rect', mgs.project);
 const at = layers.indexOf(tmp);
 if (at >= 0) layers.splice(at, 1);
        const copy = JSON.parse(JSON.stringify(layer));
        copy.id = tmp.id;
        copy.name = (layer.name + ' copie').slice(0, 80);
        copy.x = mgRound(copy.x + 40);
        copy.y = mgRound(copy.y + 40);
 for (const key of ['x', 'y']) for (const k of (copy.keys[key] || [])) k.v = mgRound(k.v + 40);
 layers.push(copy);
 mgs.selected = copy.id;
    });
    mgRenderLayers();
    mgRenderProps();
    mgRenderTimeline();
    mgDraw();
}

function mgDeleteLayer() {
    const layer = mgSelectedLayer();
    if (!layer || mgs.busy) return;
    mgMutate('del', () => {
        const layers = mgs.project.layers;
 layers.splice(layers.indexOf(layer), 1);
 mgs.selected = layers.length ? layers[layers.length - 1].id : null;
    });
    mgRenderLayers();
    mgRenderProps();
    mgRenderTimeline();
    mgDraw();
}

function mgCanvasPoint(e) {
    const canvas = $('mg-canvas');
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * canvas.width / (rect.width || 1), y: (e.clientY - rect.top) * canvas.height / (rect.height || 1) };
}

const mgCanvas = $('mg-canvas');
mgCanvas.addEventListener('pointerdown', (e) => {
    if (mgs.busy || e.button > 0) return;
    mgPause();
    const p = mgCanvasPoint(e);
    const hit = mgHit(p.x, p.y);
    if (!hit) { mgs.drag = null; return; }
    if (hit.id !== mgs.selected) mgSelect(hit.id);
    mgs.drag = { id: hit.id, px: p.x, py: p.y, x0: mgValue(hit, 'x', mgs.t), y0: mgValue(hit, 'y', mgs.t) };
    mgCanvas.setPointerCapture(e.pointerId);
});
mgCanvas.addEventListener('pointermove', (e) => {
    const drag = mgs.drag;
    if (!drag || mgs.busy) return;
    const layer = mgs.project.layers.find((l) => l.id === drag.id);
    if (!layer) return;
    const p = mgCanvasPoint(e);
    mgMutate('drag:' + drag.id, () => {
 mgSetProp(layer, 'x', drag.x0 + p.x - drag.px);
        mgSetProp(layer, 'y', drag.y0 + p.y - drag.py);
    });
    mgDraw();
    mgRefreshValues();
});
const mgEndDrag = () => {
    if (!mgs.drag) return;
    mgs.drag = null;
    mgRenderTimeline();
};
mgCanvas.addEventListener('pointerup', mgEndDrag);
mgCanvas.addEventListener('pointercancel', mgEndDrag);

const mgTimelineBox = $('mg-timeline');
mgTimelineBox.addEventListener('pointerdown', (e) => {
    if (mgs.busy || !e.target.closest('.mg-ruler')) return;
    mgs.scrub = true;
    mgPause();
    mgSeek(mgTimeFromX(e.clientX));
    mgTimelineBox.setPointerCapture(e.pointerId);
});
mgTimelineBox.addEventListener('pointermove', (e) => { if (mgs.scrub) mgSeek(mgTimeFromX(e.clientX)); });
const mgEndScrub = () => { mgs.scrub = false; };
mgTimelineBox.addEventListener('pointerup', mgEndScrub);
mgTimelineBox.addEventListener('pointercancel', mgEndScrub);

$('mg-play').addEventListener('click', () => { if (mgs.playing) mgPause(); else mgPlay(); });
$('mg-stop').addEventListener('click', () => { mgPause(); mgSeek(0); });
$('mg-time').addEventListener('input', (e) => { mgPause(); mgSeek(Number(e.target.value) / 1000 * mgs.project.duration); });
$('mg-undo').addEventListener('click', mgUndo);
$('mg-save').addEventListener('click', mgSave);
$('mg-export-html').addEventListener('click', mgExportHtml);
$('mg-export-webm').addEventListener('click', mgExportWebm);
$('mg-open').addEventListener('change', (e) => mgOpen(e.target.value));
$('mg-new').addEventListener('click', () => {
    if (!mgConfirmDiscard()) return;
    mgLoadProject(mgNormalizeProject({ name: 'Nouvelle animation' }), '');
    mgStatus('Nouveau projet vide : ajoute un texte ou une forme.');
});
$('mg-example').addEventListener('click', () => {
    if (!mgConfirmDiscard()) return;
    mgLoadProject(mgStarterProject(), '');
    mgStatus('Exemple chargé : appuie sur Lecture.');
});
for (const button of mgStudio.querySelectorAll('[data-mg-add]')) button.addEventListener('click', () => mgAddLayer(button.dataset.mgAdd));
$('mg-front').addEventListener('click', () => mgMoveLayer(1));
$('mg-back').addEventListener('click', () => mgMoveLayer(-1));
$('mg-dup').addEventListener('click', mgDuplicateLayer);
$('mg-del').addEventListener('click', mgDeleteLayer);
mgStudio.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && String(e.key).toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        mgUndo();
    }
});
$('mg-effectcraft').addEventListener('click', () => {
    mgPause();
    const stage = motionView.querySelector('.motion-stage');
    stage.hidden = false;
    stage.scrollIntoView({ block: 'start' });
    loadMotionEngine(true);
});
motionNav.addEventListener('click', () => { if (isMotionOpen()) mgRefreshList(); });

mgs.project = mgStarterProject();
{
    const first = mgs.project.layers[1] || mgs.project.layers[0];
    mgs.selected = first ? first.id : null;
}
mgRebuild();
mgStatus('Prêt : glisse un calque dans l’aperçu, pose des keyframes avec ◆, puis enregistre ou exporte.');
