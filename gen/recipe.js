// A recipe is everything an image needs, derived deterministically from its seed:
// primitives and their parameters, how they combine, symmetry, composition, tone and dither.
import { createRng } from './rng.js';
import { PRIMITIVES, clamp01, smooth } from './fields.js';
import { DITHERS, DITHER_AFFINITY } from './dither.js';

// Primitives that already sit on an empty background read best full-frame.
const SELF_COMPOSED = new Set(['attractor', 'planet', 'shape', 'spiral']);

export function makeRecipe(seed, aspect, overrides = {}) {
    const rng = createRng(seed);
    const A = aspect;
    const pick = (exclude) => rng.weighted(Object.entries(PRIMITIVES).filter(([id]) => id !== exclude).map(([id, p]) => [id, p.weight]));

    const primary = pick();
    const layers = [{ id: primary, params: PRIMITIVES[primary].params(rng.fork(`p:${primary}`), A) }];

    // A second layer, combined with the first.
    let op = null;
    // Two layers are rarer: one strong primitive usually reads better than a blend.
    if (rng.chance(0.2) && primary !== 'reaction') {
        const second = pick(primary);
        if (second !== 'reaction') {
            layers.push({ id: second, params: PRIMITIVES[second].params(rng.fork(`s:${second}`), A) });
            op = rng.weighted([['multiply', 3], ['mask', 3], ['difference', 2], ['screen', 2], ['max', 1]]);
        }
    }

    const symmetry = primary !== 'ridges' && rng.chance(0.22)
        ? rng.weighted([['mirror', 3], ['quad', 2], ['kaleido', 3]])
        : null;
    const folds = rng.int(3, 8);

    const composition = SELF_COMPOSED.has(primary)
        ? rng.weighted([['full', 5], ['focus', 1]])
        : rng.weighted([['full', 4], ['horizon', 3], ['focus', 1], ['golden', 1]]);

    const kind = PRIMITIVES[primary].kind;
    const tone = {
        gamma: rng.range(0.75, 1.35),
        contrast: rng.range(0.95, 1.45),
        invert: rng.chance(kind === 'density' ? 0.18 : 0.22),
        posterize: kind === 'smooth' && rng.chance(0.15) ? rng.int(3, 5) : 0,
        // Smooth fields often read best as isolines, like a topographic map.
        contours: kind === 'smooth' && rng.chance(0.5) ? { bands: rng.int(10, 34), width: rng.range(0.08, 0.2), shade: rng.range(0, 0.35) } : null,
    };

    const dither = overrides.dither && DITHERS[overrides.dither] ? overrides.dither : rng.weighted(DITHER_AFFINITY[kind]);
    const screen = { cell: rng.int(4, 9), angle: rng.pick([0.26, 0.785, 0.0, 1.31, rng.range(0, Math.PI)]) };

    return {
        seed: String(seed),
        aspect: A,
        layers,
        op,
        symmetry,
        folds,
        composition,
        golden: rng.sign(),
        edge: { a: rng.range(0, 10), b: rng.range(0, 10), base: rng.range(-0.12, 0.08) },
        tone,
        dither,
        screen,
    };
}

// Short description for the metadata line; labels are looked up by the UI.
export function describe(recipe) {
    const [a, b] = recipe.layers;
    const variant = (l) => l.params.type || l.params.mode || l.params.preset?.id || l.params.surface || null;
    return {
        primary: a.id,
        variant: variant(a),
        secondary: b ? b.id : null,
        op: recipe.op,
        symmetry: recipe.symmetry,
        folds: recipe.folds,
        dither: recipe.dither,
    };
}

function combine(a, b, op) {
    for (let i = 0; i < a.length; i++) {
        const x = a[i], y = b[i];
        switch (op) {
            case 'multiply': a[i] = x * (0.35 + 0.65 * y) * 1.25; break;
            case 'mask': a[i] = y > 0.45 ? x : x * 0.12; break;
            case 'difference': a[i] = Math.abs(x - y); break;
            case 'screen': a[i] = 1 - (1 - x) * (1 - y); break;
            default: a[i] = Math.max(x, y);
        }
    }
    return a;
}

// Symmetry by remapping each cell to its source cell.
function symmetrise(src, W, H, mode, folds) {
    const out = new Float32Array(W * H);
    const cx = (W - 1) / 2, cy = (H - 1) / 2, wedge = Math.PI / folds;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let sx = x, sy = y;
            if (mode === 'mirror') sx = x > cx ? W - 1 - x : x;
            else if (mode === 'quad') { sx = x > cx ? W - 1 - x : x; sy = y > cy ? H - 1 - y : y; }
            else {
                const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
                let t = Math.atan2(dy, dx);
                t = ((t % (2 * wedge)) + 2 * wedge) % (2 * wedge);
                if (t > wedge) t = 2 * wedge - t;
                sx = Math.round(cx + r * Math.cos(t - Math.PI / 2));
                sy = Math.round(cy + r * Math.sin(t - Math.PI / 2));
                if (sx < 0 || sx >= W || sy < 0 || sy >= H) { out[y * W + x] = 0; continue; }
            }
            out[y * W + x] = src[sy * W + sx];
        }
    }
    return out;
}

// Composition: where the image lives in the frame. 1 = full ink allowed, 0 = paper.
function compositionMask(recipe, W, H) {
    const { composition: c, aspect: A } = recipe;
    if (c === 'full') return null;
    const m = new Float32Array(W * H);
    const gx = c === 'golden' ? recipe.golden * A * (0.5 - 0.382) : 0;
    for (let y = 0; y < H; y++) {
        const Y = (y + 0.5) / H - 0.5;
        for (let x = 0; x < W; x++) {
            const X = (x + 0.5) / H - A / 2, u = (x + 0.5) / W;
            let v;
            if (c === 'horizon') {
                const e = recipe.edge;
                const edge = e.base + 0.08 * Math.sin(u * 5.1 + e.a) + 0.05 * Math.sin(u * 11.7 + e.b) + 0.025 * Math.sin(u * 23.3 + e.a * 2);
                v = smooth(0, 0.5, Y - edge);
            } else {
                // Wide and soft, so the image fades out rather than sitting in an oval.
                const rx = c === 'golden' ? A * 0.5 : A * 0.62, ry = 0.62;
                const r = Math.hypot((X - gx) / rx, Y / ry);
                v = smooth(0, 0.85, 1.15 - r);
            }
            m[y * W + x] = v;
        }
    }
    return m;
}

function applyTone(ink, tone, mask) {
    const { gamma, contrast, invert, posterize, contours } = tone;
    for (let i = 0; i < ink.length; i++) {
        let v = clamp01(ink[i]);
        if (invert) v = 1 - v;
        v = clamp01((Math.pow(v, gamma) - 0.5) * contrast + 0.5);
        if (posterize) v = Math.round(v * (posterize - 1)) / (posterize - 1);
        if (contours) {
            const f = v * contours.bands, d = Math.abs(f - Math.floor(f) - 0.5);
            v = d < contours.width ? 0.95 : v * contours.shade;
        }
        ink[i] = mask ? v * mask[i] : v;
    }
    return ink;
}

// Field only (before dithering): used by the quality check and the renderer.
export function renderField(recipe, W, H) {
    const rng = createRng(recipe.seed);
    const [a, b] = recipe.layers;
    let ink = PRIMITIVES[a.id].render(a.params, W, H, rng.fork(`r:${a.id}`));
    if (b) ink = combine(ink, PRIMITIVES[b.id].render(b.params, W, H, rng.fork(`r2:${b.id}`)), recipe.op);
    if (recipe.symmetry) ink = symmetrise(ink, W, H, recipe.symmetry, recipe.folds);
    return applyTone(ink, recipe.tone, compositionMask(recipe, W, H));
}

export function renderBits(recipe, W, H) {
    const ink = renderField(recipe, W, H);
    return DITHERS[recipe.dither].run(ink, W, H, recipe.screen);
}
