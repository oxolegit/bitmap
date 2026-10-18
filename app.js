// UI: settings, rendering through the worker, history, shareable URL state and export.
import { newSeed, isSeed } from './gen/rng.js';
import { DITHERS } from './gen/dither.js';
import { cellsToImageData, toPNG, toSVG, download } from './export.js';
import { STRINGS, detectLang, applyStrings, describeLine } from './i18n.js';
import { PALETTES, RATIOS, DEFAULTS, clampSide, parseShare, toQuery, paletteOf } from './share.js';

const MAX_CELLS = 4_000_000, HISTORY = 12;

const $ = (id) => document.getElementById(id);
const els = {
    ratios: $('ratios'), sizes: $('sizes'), sizeField: $('sizeField'), customSize: $('customSize'), customW: $('customW'), customH: $('customH'),
    px: $('px'), pxOut: $('pxOut'), pxNote: $('pxNote'), palettes: $('palettes'), customColors: $('customColors'), inkColor: $('inkColor'), paperColor: $('paperColor'),
    dither: $('dither'), seed: $('seed'), copyLink: $('copyLink'), frame: $('frame'), view: $('view'), busy: $('busy'), meta: $('meta'),
    generate: $('generate'), png: $('png'), svg: $('svg'), history: $('history'),
};

const state = { ...DEFAULTS, lang: detectLang() };
let current = null;      // { seed, bits, W, H, info, outW, outH }
const trail = [];        // { seed, thumb }: recent images
let historyIndex = -1;

// ─── Sizes ──────────────────────────────────────────────────────────────────────────
function outputSize() {
    if (state.ratio === 'custom') return [clampSide(state.customW), clampSide(state.customH)];
    const r = RATIOS[state.ratio] || 1;
    return r >= 1 ? [state.size, Math.round(state.size / r)] : [Math.round(state.size * r), state.size];
}

// Cells to render: the pixel size is raised if the grid would exceed the cell budget.
function grid() {
    const [outW, outH] = outputSize();
    const px = Math.max(state.px, Math.ceil(Math.sqrt((outW * outH) / MAX_CELLS)));
    return { outW, outH, px, W: Math.ceil(outW / px), H: Math.ceil(outH / px) };
}

const palette = () => paletteOf(state);

// ─── URL state ──────────────────────────────────────────────────────────────────────
// Each image has its own address, /s/<seed>?…, which the server previews as that image.
function writeState() {
    if (!state.seed) return;
    history.replaceState(null, '', `/s/${state.seed}?${toQuery(state)}`);
}

// From the path and query; links made before /s/ existed kept everything in the hash.
function readState() {
    const fromPath = location.pathname.match(/^\/s\/([^/?#]+)/)?.[1] || null;
    const legacy = location.hash.length > 1 ? new URLSearchParams(location.hash.slice(1)) : null;
    Object.assign(state, parseShare(legacy || new URLSearchParams(location.search), fromPath && isSeed(fromPath) ? fromPath : null));
}

// ─── Rendering ──────────────────────────────────────────────────────────────────────
let worker = null, busy = false, jobId = 0;

function startWorker() {
    worker = new Worker('/render.worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
        if (data.id !== jobId) return;
        if (!data.ok) { setBusy(false); els.meta.textContent = STRINGS[state.lang].error; return; }
        const g = grid();
        current = { seed: data.seed, bits: data.bits, W: data.W, H: data.H, info: data.info, outW: g.outW, outH: g.outH };
        setBusy(false);
        state.seed = data.seed;
        els.seed.value = data.seed;
        draw();
        remember();
        writeState();
    };
}

function setBusy(on) {
    busy = on;
    els.frame.classList.toggle('loading', on);
    els.busy.hidden = !on;
    els.png.disabled = els.svg.disabled = on || !current;
}

// fresh: a brand-new image (the worker may skip dull seeds); otherwise re-render this seed.
function render(fresh = false) {
    if (busy) { worker.terminate(); startWorker(); }
    const g = grid();
    els.pxNote.hidden = g.px === state.px;
    els.pxNote.textContent = STRINGS[state.lang].cellsNote.replace('{px}', `${g.px} px`);
    jobId++;
    setBusy(true);
    worker.postMessage({ id: jobId, seed: state.seed, W: g.W, H: g.H, dither: state.dither === 'auto' ? undefined : state.dither, fresh });
}

function generate() {
    state.seed = newSeed();
    render(true);
}

function draw() {
    if (!current) return;
    const { bits, W, H } = current;
    const c = els.view;
    c.width = W;
    c.height = H;
    c.getContext('2d').putImageData(cellsToImageData(bits, W, H, palette()), 0, 0);
    fit();
    updateMeta();
}

// Fit the canvas into the stage width and the viewport height left below the header;
// whole-number scaling when enlarging keeps cells crisp. The frame hugs the canvas, so the
// caption sits right under the image.
function fit() {
    if (!current) return;
    const { W, H } = current;
    const bw = els.frame.parentElement.clientWidth;
    // Room under the frame for the caption, buttons and history strip.
    const below = innerWidth > 800 ? 170 : 120;
    const top = els.frame.getBoundingClientRect().top + scrollY;
    const bh = Math.max(260, innerHeight - top - below);
    let s = Math.min(bw / W, bh / H);
    // Whole device pixels per cell once cells are big enough for unevenness to show.
    if (s * devicePixelRatio >= 2) s = Math.floor(s * devicePixelRatio) / devicePixelRatio;
    els.view.style.width = `${W * s}px`;
    els.view.style.height = `${H * s}px`;
    els.view.style.imageRendering = s * devicePixelRatio >= 1 ? 'pixelated' : 'auto';
}

function updateMeta() {
    if (!current) return;
    const t = STRINGS[state.lang];
    const line = describeLine(current.info, state.lang);
    const dither = state.dither === 'auto' ? DITHERS[current.info.dither].label : DITHERS[state.dither].label;
    els.meta.textContent = `${line} · ${dither} · ${current.outW}×${current.outH} · ${current.seed}`;
    els.view.setAttribute('aria-label', `${t.image}: ${line}`);
}

// ─── History ────────────────────────────────────────────────────────────────────────
function remember() {
    const at = trail.findIndex((h) => h.seed === current.seed);
    if (at !== -1) { historyIndex = at; renderHistory(); return; }
    const thumb = document.createElement('canvas');
    const h = 48, w = Math.max(8, Math.round((current.W / current.H) * h));
    thumb.width = w; thumb.height = h;
    const ctx = thumb.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(els.view, 0, 0, w, h);
    trail.unshift({ seed: current.seed, thumb });
    trail.length = Math.min(trail.length, HISTORY);
    historyIndex = 0;
    renderHistory();
}

function renderHistory() {
    els.history.replaceChildren(...trail.map((h, i) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.title = h.seed;
        b.setAttribute('aria-label', h.seed);
        if (i === historyIndex) b.setAttribute('aria-current', 'true');
        b.append(h.thumb);
        b.addEventListener('click', () => goHistory(i));
        li.append(b);
        return li;
    }));
}

function goHistory(i) {
    if (i < 0 || i >= trail.length) return;
    historyIndex = i;
    state.seed = trail[i].seed;
    render(false);
}

// ─── Controls ───────────────────────────────────────────────────────────────────────
function press(container, attr, value) {
    container.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value))));
}

function syncControls() {
    press(els.ratios, 'ratio', state.ratio);
    press(els.sizes, 'size', state.size);
    const custom = state.ratio === 'custom';
    els.customSize.hidden = !custom;
    els.sizeField.hidden = custom;
    els.customW.value = clampSide(state.customW);
    els.customH.value = clampSide(state.customH);
    els.px.value = state.px;
    els.pxOut.textContent = `${state.px} px`;
    els.palettes.querySelectorAll('[role="radio"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.palette === state.palette)));
    els.customColors.hidden = state.palette !== 'custom';
    els.inkColor.value = state.ink;
    els.paperColor.value = state.paper;
    els.dither.value = state.dither;
    els.seed.value = state.seed;
}

function buildPalettes() {
    const items = [...Object.entries(PALETTES), ['custom', { ink: state.ink, paper: state.paper }]];
    els.palettes.replaceChildren(...items.map(([id, p]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch' + (id === 'custom' ? ' custom' : '');
        b.setAttribute('role', 'radio');
        b.dataset.palette = id;
        b.dataset.paletteLabel = id;
        b.style.setProperty('--ink', p.ink);
        b.style.setProperty('--paper', p.paper);
        b.addEventListener('click', () => {
            state.palette = id;
            syncControls();
            draw();
            writeState();
        });
        return b;
    }));
}

function buildDithers() {
    const t = STRINGS[state.lang];
    const opts = [['auto', t.auto], ...Object.entries(DITHERS).map(([id, d]) => [id, d.label])];
    els.dither.replaceChildren(...opts.map(([v, label]) => Object.assign(document.createElement('option'), { value: v, textContent: label })));
    els.dither.value = state.dither;
}

function setLang(lang) {
    state.lang = lang;
    document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    applyStrings(lang);
    buildDithers();
    updateMeta();
    writeState();
}

els.ratios.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ratio]');
    if (!b || b.dataset.ratio === state.ratio) return;
    state.ratio = b.dataset.ratio;
    syncControls();
    render(false);
});

els.sizes.addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b || +b.dataset.size === state.size) return;
    state.size = +b.dataset.size;
    syncControls();
    render(false);
});

for (const input of [els.customW, els.customH]) {
    input.addEventListener('change', () => {
        state.customW = clampSide(els.customW.value);
        state.customH = clampSide(els.customH.value);
        syncControls();
        render(false);
    });
}

els.px.addEventListener('input', () => { els.pxOut.textContent = `${els.px.value} px`; });
els.px.addEventListener('change', () => {
    state.px = +els.px.value;
    render(false);
});

for (const [input, key] of [[els.inkColor, 'ink'], [els.paperColor, 'paper']]) {
    input.addEventListener('input', () => {
        state[key] = input.value;
        els.palettes.querySelector('[data-palette="custom"]').style.setProperty(`--${key}`, input.value);
        draw();
    });
    input.addEventListener('change', writeState);
}

els.dither.addEventListener('change', () => {
    state.dither = els.dither.value;
    render(false);
});

els.seed.addEventListener('change', () => {
    const v = els.seed.value.trim();
    if (!isSeed(v)) { els.seed.value = state.seed; return; }
    if (v === state.seed) return;
    state.seed = v;
    render(false);
});

els.copyLink.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(location.href);
        els.copyLink.textContent = STRINGS[state.lang].copied;
        setTimeout(() => { els.copyLink.textContent = STRINGS[state.lang].copyLink; }, 1500);
    } catch {}
});

els.generate.addEventListener('click', generate);

async function exportAs(kind) {
    if (!current || busy) return;
    const { bits, W, H, outW, outH, seed } = current;
    const name = `bitmap-${seed}-${outW}x${outH}.${kind}`;
    if (kind === 'png') download(await toPNG(bits, W, H, outW, outH, palette()), name);
    else download(new Blob([toSVG(bits, W, H, outW, outH, palette())], { type: 'image/svg+xml' }), name);
}
els.png.addEventListener('click', () => exportAs('png'));
els.svg.addEventListener('click', () => exportAs('svg'));

document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); generate(); }
    else if (e.key === 'ArrowLeft') goHistory(historyIndex + 1);
    else if (e.key === 'ArrowRight') goHistory(historyIndex - 1);
    else if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') exportAs('png');
    else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') exportAs('svg');
});

window.addEventListener('resize', fit);

// A shared link opened in a tab that is already on the site only changes the hash. The app's
// own updates use replaceState, which does not fire hashchange, so this is always external.
window.addEventListener('hashchange', () => {
    readState();
    syncControls();
    render(false);
});

// ─── Start ──────────────────────────────────────────────────────────────────────────
readState();
buildPalettes();
setLang(state.lang);
syncControls();
startWorker();
if (state.seed) render(false);
else generate();
