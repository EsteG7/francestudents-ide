/* ---------- Motion design : moteur natif (partie pure, sans DOM, testée hors navigateur) ---------- */
/* Le studio (38-motion-studio.js) s’appuie sur ces fonctions ; l’export HTML les embarque telles quelles. */
const MG_PROPS = [
    { key: 'x', label: 'X', step: 1 },
    { key: 'y', label: 'Y', step: 1 },
    { key: 'scale', label: 'Échelle', step: 0.05 },
    { key: 'rotation', label: 'Rotation (°)', step: 1 },
    { key: 'opacity', label: 'Opacité', step: 0.05 }
];
const MG_EASES = [
    { id: 'linear', label: 'Linéaire' },
    { id: 'in', label: 'Accélération' },
    { id: 'out', label: 'Décélération' },
    { id: 'inout', label: 'Accélération + décélération' },
    { id: 'back', label: 'Dépassement' },
    { id: 'bounce', label: 'Rebond' },
    { id: 'elastic', label: 'Élastique' }
];
const MG_PRESETS = [
    { id: 'fade', label: 'Fondu' },
    { id: 'slide', label: 'Glisser' },
    { id: 'pop', label: 'Pop' },
    { id: 'bounce', label: 'Rebond' },
    { id: 'out', label: 'Sortie' }
];
let mgLayerCounter = 0;

function mgNum(value, fallback, min, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function mgColor(value, fallback) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function mgRound(value) { return Math.round(value * 1000) / 1000; }

function mgEase(name, p) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    switch (name) {
        case 'in': return p * p * p;
        case 'out': return 1 - Math.pow(1 - p, 3);
 case 'inout': return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        case 'back': { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); }
 case 'bounce': {
     const n = 7.5625; const d = 2.75;
     if (p < 1 / d) return n * p * p;
     if (p < 2 / d) { const q = p - 1.5 / d; return n * q * q + 0.75; }
     if (p < 2.5 / d) { const q = p - 2.25 / d; return n * q * q + 0.9375; }
     const q = p - 2.625 / d;
     return n * q * q + 0.984375;
 }
        case 'elastic': return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
 default: return p;
    }
}

function mgValue(layer, prop, t) {
    const frames = layer.keys && layer.keys[prop];
    if (!frames || !frames.length) return layer[prop];
    if (t <= frames[0].t) return frames[0].v;
    const last = frames[frames.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 0; i < frames.length - 1; i++) {
 const a = frames[i];
        const b = frames[i + 1];
 if (t >= a.t && t <= b.t) {
     const span = b.t - a.t;
     const p = span > 0 ? (t - a.t) / span : 1;
     return a.v + (b.v - a.v) * mgEase(a.ease || 'linear', p);
        }
    }
    return last.v;
}

function mgFont(layer) {
    return (layer.bold ? '700 ' : '') + layer.fontSize + 'px system-ui, sans-serif';
}

function mgIsVisible(layer, project, t) {
    if (layer.hidden) return false;
    const end = layer.end > 0 ? layer.end : project.duration;
    return t >= layer.start && t <= end;
}

function mgDrawFrame(ctx, project, t) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, project.width, project.height);
    for (const layer of project.layers) {
        if (!mgIsVisible(layer, project, t)) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, mgValue(layer, 'opacity', t)));
        ctx.translate(mgValue(layer, 'x', t), mgValue(layer, 'y', t));
        ctx.rotate(mgValue(layer, 'rotation', t) * Math.PI / 180);
        const s = mgValue(layer, 'scale', t);
        ctx.scale(s, s);
 ctx.fillStyle = layer.fill;
        if (layer.type === 'text') {
     ctx.font = mgFont(layer);
            ctx.textAlign = 'center';
     ctx.textBaseline = 'middle';
     ctx.fillText(layer.text, 0, 0);
        } else if (layer.type === 'ellipse') {
     ctx.beginPath();
     ctx.ellipse(0, 0, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
     ctx.fill();
 } else {
     ctx.fillRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
 }
        ctx.restore();
    }
    ctx.restore();
}

function mgMakeLayer(type, project) {
    mgLayerCounter += 1;
    const base = {
        id: 'l' + Date.now().toString(36) + mgLayerCounter,
        type,
        name: 'Calque',
 x: project.width / 2,
        y: project.height / 2,
 scale: 1,
        rotation: 0,
 opacity: 1,
 start: 0,
        end: 0,
 fill: '#ffffff',
        hidden: false,
        keys: {}
    };
    if (type === 'text') return Object.assign(base, { name: 'Texte', text: 'Mon titre', fontSize: 96, bold: true });
    if (type === 'ellipse') return Object.assign(base, { name: 'Ellipse', w: 320, h: 320, fill: '#4f8cff' });
    return Object.assign(base, { type: 'rect', name: 'Rectangle', w: 480, h: 240, fill: '#ff6b6b' });
}

function mgNormalizeProject(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const project = {
 version: 1,
 name: String(src.name === undefined ? 'Animation' : src.name).slice(0, 80) || 'Animation',
        width: Math.round(mgNum(src.width, 1280, 64, 3840)),
        height: Math.round(mgNum(src.height, 720, 64, 3840)),
        fps: Math.round(mgNum(src.fps, 30, 1, 60)),
        duration: mgNum(src.duration, 5, 0.5, 120),
        background: mgColor(src.background, '#101418'),
        layers: []
    };
    const seen = new Set();
    for (const item of Array.isArray(src.layers) ? src.layers.slice(0, 200) : []) {
        if (!item || typeof item !== 'object') continue;
 const type = ['text', 'rect', 'ellipse'].includes(item.type) ? item.type : 'rect';
        const layer = mgMakeLayer(type, project);
        const id = String(item.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
        if (id && !seen.has(id)) layer.id = id;
        seen.add(layer.id);
        layer.name = String(item.name === undefined ? layer.name : item.name).slice(0, 80) || layer.name;
 layer.hidden = item.hidden === true;
        layer.fill = mgColor(item.fill, layer.fill);
        layer.x = mgNum(item.x, layer.x, -100000, 100000);
 layer.y = mgNum(item.y, layer.y, -100000, 100000);
        layer.scale = mgNum(item.scale, 1, 0, 1000);
        layer.rotation = mgNum(item.rotation, 0, -36000, 36000);
        layer.opacity = mgNum(item.opacity, 1, 0, 1);
        layer.start = mgNum(item.start, 0, 0, project.duration);
 layer.end = mgNum(item.end, 0, 0, project.duration);
        if (type === 'text') {
     layer.text = String(item.text === undefined ? layer.text : item.text).slice(0, 500);
     layer.fontSize = mgNum(item.fontSize, 96, 8, 600);
     layer.bold = item.bold !== false;
        } else {
     layer.w = mgNum(item.w, layer.w, 1, 8000);
     layer.h = mgNum(item.h, layer.h, 1, 8000);
        }
        for (const prop of MG_PROPS) {
     const list = item.keys && Array.isArray(item.keys[prop.key]) ? item.keys[prop.key].slice(0, 200) : [];
     const frames = list
         .filter((k) => k && typeof k === 'object')
  .map((k) => ({
      t: mgRound(mgNum(k.t, 0, 0, project.duration)),
      v: mgRound(mgNum(k.v, layer[prop.key], -100000, 100000)),
      ease: MG_EASES.some((e) => e.id === k.ease) ? k.ease : 'linear'
  }))
  .sort((a, b) => a.t - b.t);
            if (frames.length) layer.keys[prop.key] = frames;
        }
        project.layers.push(layer);
    }
    return project;
}

function mgPresetKeys(layer, id, project) {
    const s = layer.start;
    const e = layer.end > 0 ? layer.end : project.duration;
    switch (id) {
        case 'fade': return { opacity: [{ t: s, v: 0, ease: 'out' }, { t: s + 0.8, v: 1, ease: 'linear' }] };
        case 'slide': return {
     x: [{ t: s, v: layer.x - 320, ease: 'out' }, { t: s + 0.9, v: layer.x, ease: 'linear' }],
     opacity: [{ t: s, v: 0, ease: 'out' }, { t: s + 0.6, v: 1, ease: 'linear' }]
        };
        case 'pop': return { scale: [{ t: s, v: 0, ease: 'back' }, { t: s + 0.7, v: 1, ease: 'linear' }] };
 case 'bounce': return { y: [{ t: s, v: layer.y - 360, ease: 'bounce' }, { t: s + 1.1, v: layer.y, ease: 'linear' }] };
        case 'out': return { opacity: [{ t: Math.max(s, e - 0.7), v: 1, ease: 'in' }, { t: e, v: 0, ease: 'linear' }] };
        default: return {};
    }
}

function mgApplyPreset(layer, id, project) {
    const keys = mgPresetKeys(layer, id, project);
    for (const key of Object.keys(keys)) {
        const existing = layer.keys[key];
 if (id === 'out' && existing && existing.length) {
     const from = keys[key][0].t;
     layer.keys[key] = existing.filter((k) => k.t < from).concat(keys[key]);
        } else {
            layer.keys[key] = keys[key].map((k) => Object.assign({}, k));
 }
    }
}

function mgStarterProject() {
    const project = mgNormalizeProject({ name: 'Ma première animation' });
    const bar = mgMakeLayer('rect', project);
    Object.assign(bar, { name: 'Barre', w: 520, h: 8, y: project.height / 2 + 60, fill: '#4f8cff', start: 0.8 });
    const title = mgMakeLayer('text', project);
    Object.assign(title, { name: 'Titre', text: 'Motion design', y: project.height / 2 - 30, start: 0.2 });
    const dot = mgMakeLayer('ellipse', project);
    Object.assign(dot, { name: 'Pastille', w: 90, h: 90, x: project.width - 160, y: 140, fill: '#ffc457', start: 0.4 });
    mgApplyPreset(bar, 'fade', project);
    mgApplyPreset(title, 'slide', project);
    mgApplyPreset(title, 'out', project);
    mgApplyPreset(dot, 'bounce', project);
    project.layers.push(bar, title, dot);
    return project;
}

/* Page HTML autonome (un seul fichier) qui rejoue l’animation en boucle, sans aucune dépendance. */
function mgBuildHtml(project) {
    const data = JSON.stringify(project).replace(/</g, '\\u003c');
    const lib = [mgEase, mgValue, mgFont, mgIsVisible, mgDrawFrame].map((fn) => fn.toString()).join('\n');
    const title = String(project.name).replace(/[<>&]/g, '');
    const player = `const canvas=document.getElementById('c');canvas.width=project.width;canvas.height=project.height;const ctx=canvas.getContext('2d');const begin=performance.now();function frame(now){mgDrawFrame(ctx,project,((now-begin)/1000)%project.duration);requestAnimationFrame(frame);}requestAnimationFrame(frame);`;
    return [
 '<!doctype html>',
 `<html lang='fr'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>${title}</title>`,
 '<style>html,body{margin:0;height:100%;background:#000;display:flex;align-items:center;justify-content:center}canvas{max-width:100vw;max-height:100vh}</style></head>',
        `<body><canvas id='c'></canvas>`,
        '<script>',
        `const project = ${data};`,
        lib,
        player,
 '</' + 'script></body></html>',
 ''
    ].join('\n');
}