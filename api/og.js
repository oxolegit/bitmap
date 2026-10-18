// GET /api/og?s=<seed>&r=…&p=…  →  1200×630 PNG preview of that very image, for link
// previews in messengers. Same generator as the page, so the preview matches the link.
import { makeRecipe, renderBits } from '../gen/recipe.js';
import { DEFAULTS, parseShare, aspectOf, paletteOf } from '../share.js';
import { encodePNG } from './_png.js';
import { TEXT } from './_text.js';

const W = 1200, H = 630, PAD = 56, CELL = 3;

const rgbOf = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const masks = Object.fromEntries(Object.entries(TEXT).map(([id, t]) => [id, { ...t, alpha: Buffer.from(t.data, 'base64') }]));

export function renderPreview(state) {
    const { ink, paper } = paletteOf(state);
    const I = rgbOf(ink), P = rgbOf(paper);
    const rgb = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) rgb.set(P, i * 3);

    // The image on the right, full height, in its own proportions (wide formats are capped).
    const boxW = Math.round(Math.min(H * aspectOf(state), 720));
    const cw = Math.round(boxW / CELL), ch = Math.round(H / CELL);
    const recipe = makeRecipe(state.seed, cw / ch, { dither: state.dither === 'auto' ? undefined : state.dither });
    const bits = renderBits(recipe, cw, ch);
    const x0 = W - boxW;
    for (let y = 0; y < H; y++) {
        const cy = Math.min(ch - 1, Math.floor(y / CELL));
        for (let x = 0; x < boxW; x++) {
            if (bits[cy * cw + Math.min(cw - 1, Math.floor(x / CELL))]) rgb.set(I, (y * W + x0 + x) * 3);
        }
    }

    // Captions from pre-rasterised Geist masks, in ink colour over paper.
    const draw = (m, left, top) => {
        for (let y = 0; y < m.h; y++) {
            for (let x = 0; x < m.w; x++) {
                const a = m.alpha[y * m.w + x] / 255;
                if (!a) continue;
                const o = ((top + y) * W + left + x) * 3;
                for (let c = 0; c < 3; c++) rgb[o + c] = Math.round(P[c] * (1 - a) + I[c] * a);
            }
        }
    };
    const en = state.lang === 'en';
    draw(masks.title, PAD - 4, PAD - 22);
    draw(en ? masks.roleEn : masks.role, PAD, PAD + 104);
    draw(en ? masks.roleEn2 : masks.role2, PAD, PAD + 138);
    draw(masks.domain, PAD, H - PAD - 24);
    return encodePNG(rgb, W, H);
}

export default function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const state = { ...DEFAULTS, ...parseShare(url.searchParams) };
    if (!state.seed) {
        res.statusCode = 400;
        res.end('missing seed');
        return;
    }
    const png = renderPreview(state);
    res.setHeader('Content-Type', 'image/png');
    // Deterministic for its parameters: cache at the edge for good.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.end(png);
}
