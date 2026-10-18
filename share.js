// Shared between the page and the serverless functions: palettes, formats and the
// shareable URL format /s/<seed>?r=…&l=…&px=…&p=…
import { isSeed } from './gen/rng.js';
import { DITHERS } from './gen/dither.js';

export const PALETTES = {
    cv: { ink: '#3F3A39', paper: '#EDF2F4' },
    cvInverse: { ink: '#EDF2F4', paper: '#3F3A39' },
    graphite: { ink: '#1D1D1F', paper: '#F3F0E8' },
    blueprint: { ink: '#EAF0FF', paper: '#1F3C88' },
    sepia: { ink: '#5A3A26', paper: '#F2E6D0' },
    riso: { ink: '#E8432E', paper: '#F6F1E7' },
    moss: { ink: '#2E3A26', paper: '#DDE3C9' },
    night: { ink: '#A9B8FF', paper: '#0F1222' },
};

export const RATIOS = { '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '2:3': 2 / 3, '9:16': 9 / 16, '16:9': 16 / 9, '3:2': 3 / 2, '21:9': 21 / 9, a4: 1 / Math.SQRT2 };
export const SIZES = [1080, 2160, 3840, 7680];
export const MAX_SIDE = 8192, MIN_SIDE = 16;

export const DEFAULTS = {
    seed: '', ratio: '4:5', size: 2160, customW: 2000, customH: 2000, px: 3,
    palette: 'cv', ink: '#3F3A39', paper: '#EDF2F4', dither: 'auto', lang: 'ru',
};

export const clampSide = (v) => Math.max(MIN_SIDE, Math.min(MAX_SIDE, Math.round(+v || 0)));
const hex = (v) => (/^[0-9a-f]{6}$/i.test(v || '') ? '#' + v.toLowerCase() : null);

// Read settings from URLSearchParams (and a seed taken from the path), ignoring anything invalid.
export function parseShare(params, seedFromPath = null) {
    const s = {};
    const seed = seedFromPath || params.get('s');
    if (isSeed(seed)) s.seed = seed;
    const r = params.get('r');
    if (r in RATIOS || r === 'custom') s.ratio = r;
    if (SIZES.includes(+params.get('l'))) s.size = +params.get('l');
    if (params.get('w')) s.customW = clampSide(params.get('w'));
    if (params.get('h')) s.customH = clampSide(params.get('h'));
    const px = +params.get('px');
    if (px >= 1 && px <= 16) s.px = px;
    const p = params.get('p');
    if (p in PALETTES || p === 'custom') s.palette = p;
    if (hex(params.get('i'))) s.ink = hex(params.get('i'));
    if (hex(params.get('b'))) s.paper = hex(params.get('b'));
    if (params.get('d') in DITHERS) s.dither = params.get('d');
    if (params.get('lang') === 'en' || params.get('lang') === 'ru') s.lang = params.get('lang');
    return s;
}

// Settings → query string (without the seed, which lives in the path).
export function toQuery(state) {
    const q = new URLSearchParams();
    q.set('r', state.ratio);
    if (state.ratio === 'custom') { q.set('w', clampSide(state.customW)); q.set('h', clampSide(state.customH)); } else q.set('l', state.size);
    q.set('px', state.px);
    q.set('p', state.palette);
    if (state.palette === 'custom') { q.set('i', state.ink.slice(1)); q.set('b', state.paper.slice(1)); }
    if (state.dither && state.dither !== 'auto') q.set('d', state.dither);
    if (state.lang === 'en') q.set('lang', 'en');
    return q.toString();
}

export function aspectOf(state) {
    if (state.ratio === 'custom') return clampSide(state.customW) / clampSide(state.customH);
    return RATIOS[state.ratio] || RATIOS['4:5'];
}

export const paletteOf = (state) => (state.palette === 'custom' ? { ink: state.ink, paper: state.paper } : PALETTES[state.palette] || PALETTES.cv);
