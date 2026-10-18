// Field primitives. Each one turns a seeded rng into parameters, then renders "ink density"
// (0 = paper, 1 = ink) on a W×H grid. Coordinates are normalised to the image height and
// centred: X ∈ [-A/2, A/2], Y ∈ [-1/2, 1/2], A = W/H. So a composition keeps its proportions
// when the format changes.
import { createNoise } from './noise.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const fract = (v) => v - Math.floor(v);

// Run f(X, Y, x, y, i) over every cell and store its result.
function sampleGrid(W, H, f) {
    const out = new Float32Array(W * H);
    const A = W / H;
    for (let y = 0; y < H; y++) {
        const Y = (y + 0.5) / H - 0.5;
        for (let x = 0; x < W; x++) {
            const X = (x + 0.5) / H - A / 2;
            out[y * W + x] = f(X, Y, x, y);
        }
    }
    return out;
}

// Bilinear upsampling of a small grid to W×H.
function upsample(src, sw, sh, W, H) {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        const fy = ((y + 0.5) / H) * sh - 0.5;
        const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy))), y1 = Math.min(sh - 1, y0 + 1), ty = clamp01(fy - y0);
        for (let x = 0; x < W; x++) {
            const fx = ((x + 0.5) / W) * sw - 0.5;
            const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx))), x1 = Math.min(sw - 1, x0 + 1), tx = clamp01(fx - x0);
            const a = src[y0 * sw + x0] + (src[y0 * sw + x1] - src[y0 * sw + x0]) * tx;
            const b = src[y1 * sw + x0] + (src[y1 * sw + x1] - src[y1 * sw + x0]) * tx;
            out[y * W + x] = a + (b - a) * ty;
        }
    }
    return out;
}

function normalise(arr) {
    let lo = Infinity, hi = -Infinity;
    for (const v of arr) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    const k = hi > lo ? 1 / (hi - lo) : 0;
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) * k;
    return arr;
}

// ─── Strange attractors ─────────────────────────────────────────────────────────────
const ATTRACTORS = {
    clifford: (a, b, c, d) => (x, y) => [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y)],
    dejong: (a, b, c, d) => (x, y) => [Math.sin(a * y) - Math.cos(b * x), Math.sin(c * x) - Math.cos(d * y)],
    svensson: (a, b, c, d) => (x, y) => [d * Math.sin(a * x) - Math.sin(b * y), c * Math.cos(a * x) + Math.cos(b * y)],
    bedhead: (a, b) => (x, y) => [Math.sin((x * y) / b) * y + Math.cos(a * x - y), x + Math.sin(y) / b],
};

function attractorParams(rng) {
    for (let attempt = 0; attempt < 80; attempt++) {
        const type = rng.weighted([['clifford', 3], ['dejong', 3], ['svensson', 2], ['bedhead', 1]]);
        const p = type === 'bedhead'
            ? [rng.range(-1, 1), rng.range(-1, 1)].map((v, i) => (i === 1 && Math.abs(v) < 0.2 ? 0.2 * Math.sign(v || 1) : v))
            : [0, 1, 2, 3].map(() => rng.range(-3, 3));
        const step = ATTRACTORS[type](...p);
        // Probe on a coarse grid: an interesting attractor spreads over a fair part of its box.
        // Warm up first: some maps wander chaotically for thousands of steps ("transient
        // chaos") and only then fall into a short cycle, which would render as a few dots.
        let x = 0.1, y = 0.1;
        const pts = [];
        let ok = true;
        for (let i = 0; i < 26000; i++) {
            [x, y] = step(x, y);
            if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e4) { ok = false; break; }
            if (i >= 20000) pts.push(x, y);
        }
        if (!ok) continue;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < pts.length; i += 2) {
            minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
            minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
        }
        if (maxX - minX < 0.2 || maxY - minY < 0.2) continue;
        const G = 48, hit = new Uint8Array(G * G);
        for (let i = 0; i < pts.length; i += 2) {
            const gx = Math.min(G - 1, Math.floor(((pts[i] - minX) / (maxX - minX)) * G));
            const gy = Math.min(G - 1, Math.floor(((pts[i + 1] - minY) / (maxY - minY)) * G));
            hit[gy * G + gx] = 1;
        }
        const coverage = hit.reduce((s, v) => s + v, 0) / (G * G);
        if (coverage < 0.14 || coverage > 0.62) continue;
        return { type, p, rotation: rng.pick([0, 0, Math.PI / 2, rng.range(0, TAU)]), fill: rng.range(0.72, 0.92), gamma: rng.range(0.32, 0.55) };
    }
    // A known-good fallback.
    return { type: 'clifford', p: [-1.4, 1.6, 1.0, 0.7], rotation: 0, fill: 0.85, gamma: 0.45 };
}

function renderAttractor(P, W, H, rng) {
    const step = ATTRACTORS[P.type](...P.p);
    const A = W / H;
    const cos = Math.cos(P.rotation), sin = Math.sin(P.rotation);
    // Start exactly where attractorParams probed: some maps have several basins, and another
    // start can fall into a fixed point instead of the attractor that passed the check.
    let x = 0.1, y = 0.1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 30000; i++) {
        [x, y] = step(x, y);
        const rx = x * cos - y * sin, ry = x * sin + y * cos;
        if (i > 200) {
            minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
            minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
        }
    }
    const bw = maxX - minX || 1, bh = maxY - minY || 1;
    const s = P.fill * Math.min(A / bw, 1 / bh);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const hist = new Float32Array(W * H);
    const iterations = Math.min(30e6, Math.max(4e5, W * H * 16));
    for (let i = 0; i < iterations; i++) {
        [x, y] = step(x, y);
        const rx = x * cos - y * sin, ry = x * sin + y * cos;
        const px = Math.floor(((rx - cx) * s + A / 2) * H);
        const py = Math.floor(((ry - cy) * s + 0.5) * H);
        if (px >= 0 && px < W && py >= 0 && py < H) hist[py * W + px]++;
    }
    let max = 0;
    for (const v of hist) if (v > max) max = v;
    const lm = Math.log(1 + max) || 1;
    for (let i = 0; i < hist.length; i++) hist[i] = Math.pow(Math.log(1 + hist[i]) / lm, P.gamma);
    return hist;
}

// ─── Reaction–diffusion (Gray–Scott) ────────────────────────────────────────────────
// Presets that reliably fill the frame within the step budget (measured on a 128–170 grid);
// `ring` marks those that also grow from a ring- or line-shaped seed.
const RD_PRESETS = [
    { id: 'coral', f: 0.0545, k: 0.062, ring: true },
    { id: 'maze', f: 0.029, k: 0.057, ring: true },
    { id: 'fingerprint', f: 0.042, k: 0.059, ring: true },
    { id: 'holes', f: 0.039, k: 0.058, ring: true },
    { id: 'labyrinth', f: 0.037, k: 0.06, ring: true },
    { id: 'chaos', f: 0.026, k: 0.051, ring: false },
    { id: 'worms', f: 0.078, k: 0.061, ring: false },
];

function rdParams(rng) {
    const preset = rng.pick(RD_PRESETS);
    return {
        preset,
        seeds: rng.int(30, 55),
        seedShape: preset.ring ? rng.weighted([['blobs', 4], ['ring', 1], ['line', 1]]) : 'blobs',
        steps: rng.int(2000, 2600),
        sharp: rng.range(0.25, 0.6),
    };
}

function renderReaction(P, W, H, rng) {
    // Simulated on a small toroidal grid, then interpolated: the pattern scale stays the
    // same at any output size, and the cost stays at well under a second.
    const A = W / H, G = 128;
    const gw = Math.round(A >= 1 ? G * Math.min(A, 2.4) : G), gh = Math.round(A >= 1 ? G : G / Math.max(A, 1 / 2.4));
    let u = new Float32Array(gw * gh).fill(1), v = new Float32Array(gw * gh);
    const put = (cx, cy, r) => {
        for (let y = cy - r; y <= cy + r; y++) {
            for (let x = cx - r; x <= cx + r; x++) {
                if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
                const i = ((y + gh) % gh) * gw + ((x + gw) % gw);
                v[i] = 1; u[i] = 0.5;
            }
        }
    };
    if (P.seedShape === 'ring') {
        const R = Math.min(gw, gh) * rng.range(0.18, 0.34);
        for (let i = 0; i < 160; i++) put(Math.round(gw / 2 + R * Math.cos((i / 160) * TAU)), Math.round(gh / 2 + R * Math.sin((i / 160) * TAU)), 3);
    } else if (P.seedShape === 'line') {
        for (let i = 0; i < gw; i += 2) put(i, Math.round(gh / 2 + Math.sin(i * 0.05) * gh * 0.18), 3);
    } else {
        for (let i = 0; i < P.seeds; i++) put(rng.int(0, gw - 1), rng.int(0, gh - 1), rng.int(3, 7));
    }
    const { f, k } = P.preset;
    let u2 = new Float32Array(gw * gh), v2 = new Float32Array(gw * gh);
    // Wrapped neighbour indices, precomputed so the inner loop has no modulo.
    const xm1 = new Int32Array(gw), xp1 = new Int32Array(gw);
    for (let x = 0; x < gw; x++) { xm1[x] = (x - 1 + gw) % gw; xp1[x] = (x + 1) % gw; }
    for (let s = 0; s < P.steps; s++) {
        for (let y = 0; y < gh; y++) {
            const ym = ((y - 1 + gh) % gh) * gw, y0 = y * gw, yp = ((y + 1) % gh) * gw;
            for (let x = 0; x < gw; x++) {
                const xm = xm1[x], xp = xp1[x], i = y0 + x;
                const lu = 0.2 * (u[y0 + xm] + u[y0 + xp] + u[ym + x] + u[yp + x]) + 0.05 * (u[ym + xm] + u[ym + xp] + u[yp + xm] + u[yp + xp]) - u[i];
                const lv = 0.2 * (v[y0 + xm] + v[y0 + xp] + v[ym + x] + v[yp + x]) + 0.05 * (v[ym + xm] + v[ym + xp] + v[yp + xm] + v[yp + xp]) - v[i];
                const uvv = u[i] * v[i] * v[i];
                u2[i] = u[i] + (lu - uvv + f * (1 - u[i]));
                v2[i] = v[i] + (0.5 * lv + uvv - (k + f) * v[i]);
            }
        }
        [u, u2] = [u2, u];
        [v, v2] = [v2, v];
    }
    const big = upsample(normalise(v), gw, gh, W, H);
    for (let i = 0; i < big.length; i++) big[i] = smooth(0.5 - P.sharp / 2, 0.5 + P.sharp / 2, big[i]);
    return big;
}

// ─── Warped noise: smoke, marble, topography, terraces ─────────────────────────────
function noiseParams(rng) {
    return {
        mode: rng.weighted([['smoke', 2], ['marble', 3], ['contours', 3], ['terrace', 2], ['ridged', 2]]),
        scale: rng.range(0.9, 2.6),
        warp: rng.range(1.5, 5),
        bands: rng.int(6, 22),
        width: rng.range(0.05, 0.16),
        angle: rng.range(0, TAU),
        ox: rng.range(-50, 50),
        oy: rng.range(-50, 50),
    };
}

function renderNoise(P, W, H, rng) {
    const N = createNoise(rng.fork('noise'));
    const cs = Math.cos(P.angle), sn = Math.sin(P.angle);
    return sampleGrid(W, H, (X, Y) => {
        const x = (X * cs - Y * sn) * P.scale + P.ox, y = (X * sn + Y * cs) * P.scale + P.oy;
        if (P.mode === 'ridged') return Math.pow(N.ridged(x * 1.4, y * 1.4), 1.6);
        const w = N.warp(x, y, P.warp, 4);
        switch (P.mode) {
            case 'smoke': return clamp01(0.5 + 1.3 * w);
            case 'marble': return 0.5 + 0.5 * Math.sin((x * 1.5 + w * P.warp) * Math.PI * 2);
            case 'contours': return Math.abs(fract((w + 1) * P.bands * 0.5) - 0.5) < P.width ? 0.95 : 0.04;
            default: return Math.floor(clamp01(0.5 + 1.2 * w) * 6) / 5; // terraces
        }
    });
}

// ─── Interference and moiré ─────────────────────────────────────────────────────────
function interferenceParams(rng, A) {
    const n = rng.int(2, 5);
    return {
        mode: rng.weighted([['waves', 3], ['moire', 3], ['grating', 2]]),
        sources: Array.from({ length: n }, () => [rng.range(-A * 0.7, A * 0.7), rng.range(-0.8, 0.8)]),
        k: rng.range(18, 64),
        angle: rng.range(0.03, 0.22),
        rot: rng.range(0, TAU),
    };
}

function renderInterference(P) {
    return (W, H) => sampleGrid(W, H, (X, Y) => {
        if (P.mode === 'grating') {
            const c1 = Math.cos(P.rot), s1 = Math.sin(P.rot), c2 = Math.cos(P.rot + P.angle), s2 = Math.sin(P.rot + P.angle);
            const a = Math.sin((X * c1 + Y * s1) * P.k * 2), b = Math.sin((X * c2 + Y * s2) * P.k * 2);
            return 0.5 + 0.5 * a * b;
        }
        if (P.mode === 'moire') {
            const [a, b] = P.sources;
            const r1 = Math.hypot(X - a[0], Y - a[1]), r2 = Math.hypot(X - b[0], Y - b[1]);
            return (Math.sin(r1 * P.k * 1.6) > 0) !== (Math.sin(r2 * P.k * 1.6) > 0) ? 0.88 : 0.06;
        }
        let s = 0;
        for (const [sx, sy] of P.sources) s += Math.sin(Math.hypot(X - sx, Y - sy) * P.k);
        return 0.5 + (0.5 * s) / P.sources.length;
    });
}

// ─── Flow lines ─────────────────────────────────────────────────────────────────────
function flowParams(rng) {
    return {
        scale: rng.range(0.8, 2.4),
        turns: rng.range(0.6, 2.2),
        length: rng.int(40, 220),
        density: rng.range(0.4, 1.4),
        gain: rng.range(0.6, 1.2),
        curl: rng.chance(0.4),
    };
}

function renderFlow(P, W, H, rng) {
    const N = createNoise(rng.fork('flow'));
    const r = rng.fork('particles');
    const A = W / H;
    const ink = new Float32Array(W * H);
    const count = Math.round(Math.min(160000, Math.max(1500, (W * H) / 60)) * P.density);
    const stepLen = 0.6 / H;
    for (let n = 0; n < count; n++) {
        let X = r.range(-A / 2, A / 2), Y = r.range(-0.5, 0.5);
        for (let s = 0; s < P.length; s++) {
            const px = Math.floor((X + A / 2) * H), py = Math.floor((Y + 0.5) * H);
            if (px < 0 || px >= W || py < 0 || py >= H) break;
            ink[py * W + px] += 1;
            let ang;
            if (P.curl) {
                const e = 0.002, f = (a, b) => N.fbm(a * P.scale, b * P.scale, 3);
                ang = Math.atan2(-(f(X + e, Y) - f(X - e, Y)), f(X, Y + e) - f(X, Y - e));
            } else {
                ang = N.fbm(X * P.scale, Y * P.scale, 3) * TAU * P.turns;
            }
            X += Math.cos(ang) * stepLen;
            Y += Math.sin(ang) * stepLen;
        }
    }
    let max = 0;
    for (const v of ink) if (v > max) max = v;
    const lm = Math.log(1 + max) || 1;
    for (let i = 0; i < ink.length; i++) ink[i] = clamp01((Math.log(1 + ink[i]) / lm) * 1.6 * P.gain);
    return ink;
}

// ─── Heat sources and isotherms ────────────────────────────────────────────────────
function heatParams(rng, A) {
    const n = rng.int(3, 9);
    return {
        mode: rng.weighted([['glow', 2], ['isotherms', 3], ['both', 3]]),
        sources: Array.from({ length: n }, () => [rng.range(-A * 0.45, A * 0.45), rng.range(-0.4, 0.4), rng.range(0.06, 0.28), rng.range(0.4, 1)]),
        bands: rng.int(5, 14),
    };
}

function renderHeat(P) {
    return (W, H) => sampleGrid(W, H, (X, Y) => {
        let s = 0;
        for (const [sx, sy, r, w] of P.sources) s += w * Math.exp(-((X - sx) ** 2 + (Y - sy) ** 2) / (r * r));
        s = Math.min(1, s);
        const iso = s > 0.04 && Math.abs(fract(s * P.bands) - 0.5) < 0.07 ? 1 : 0;
        if (P.mode === 'isotherms') return iso ? 0.95 : s * 0.12;
        if (P.mode === 'glow') return Math.pow(s, 1.3);
        return Math.max(iso * 0.95, Math.pow(s, 1.6) * 0.8);
    });
}

// ─── Ridge lines (Unknown Pleasures) ───────────────────────────────────────────────
function ridgesParams(rng) {
    return {
        lines: rng.int(22, 64),
        top: rng.range(-0.38, -0.15),
        amp: rng.range(0.12, 0.34),
        center: rng.range(-0.25, 0.25),
        width: rng.range(0.12, 0.35),
        freq: rng.range(5, 16),
        thick: rng.range(0.0025, 0.006),
        fill: rng.chance(0.35),
    };
}

function renderRidges(P, W, H, rng) {
    const N = createNoise(rng.fork('ridges'));
    const A = W / H, L = P.lines;
    const out = new Float32Array(W * H);
    const curves = new Float32Array(L);
    for (let x = 0; x < W; x++) {
        const X = (x + 0.5) / H - A / 2;
        const env = Math.exp(-(((X - P.center * A) / (P.width * A)) ** 2));
        for (let j = 0; j < L; j++) {
            const base = P.top + (0.48 - P.top) * (j / (L - 1));
            const n = 0.5 + 0.5 * N.fbm(X * P.freq, j * 0.37, 4);
            curves[j] = base - P.amp * env * Math.pow(n, 2) - 0.01 * N.noise(X * 3, j);
        }
        for (let y = 0; y < H; y++) {
            const Y = (y + 0.5) / H - 0.5;
            let v = 0;
            for (let j = L - 1; j >= 0; j--) {
                if (Y >= curves[j] - P.thick) {
                    const d = Y - curves[j];
                    v = d < P.thick ? 1 : P.fill ? 0.18 * (1 - j / L) : 0;
                    break;
                }
            }
            out[y * W + x] = v;
        }
    }
    return out;
}

// ─── Planet: lit sphere, banded or cratered, optional rings ────────────────────────
function planetParams(rng, A) {
    const giant = rng.chance(0.4);
    return {
        cx: giant ? rng.range(-A * 0.2, A * 0.2) : rng.range(-A * 0.18, A * 0.18),
        cy: giant ? rng.range(0.55, 0.95) : rng.range(-0.08, 0.08),
        r: giant ? rng.range(0.6, 1.1) : rng.range(0.22, 0.36),
        light: [rng.range(-1, 1), rng.range(-1, 0.2), rng.range(0.3, 1)],
        surface: rng.weighted([['bands', 3], ['craters', 2], ['smooth', 1]]),
        rings: !giant && rng.chance(0.5),
        tilt: rng.range(-0.5, 0.5),
        ringIn: rng.range(1.25, 1.5),
        ringOut: rng.range(1.7, 2.3),
        flat: rng.range(0.18, 0.35),
    };
}

function renderPlanet(P, W, H, rng) {
    const N = createNoise(rng.fork('planet'));
    const [lx0, ly0, lz0] = P.light, ll = Math.hypot(lx0, ly0, lz0);
    const lx = lx0 / ll, ly = ly0 / ll, lz = lz0 / ll;
    const ct = Math.cos(P.tilt), st = Math.sin(P.tilt);
    return sampleGrid(W, H, (X, Y) => {
        const dx = (X - P.cx) / P.r, dy = (Y - P.cy) / P.r;
        // Rings: an ellipse in the tilted frame; the front half covers the planet.
        let ring = 0;
        if (P.rings) {
            const rx = dx * ct + dy * st, ry = (-dx * st + dy * ct) / P.flat;
            const rr = Math.hypot(rx, ry);
            if (rr > P.ringIn && rr < P.ringOut) ring = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(rr * 40));
            if (ring && ry < 0 && dx * dx + dy * dy < 1) ring = 0; // behind the planet
        }
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) return ring;
        const nz = Math.sqrt(1 - d2);
        let light = Math.max(0, dx * lx + dy * ly + nz * lz);
        let tex = 1;
        if (P.surface === 'bands') tex = 0.75 + 0.25 * Math.sin(dy * 14 + N.fbm(dx * 2, dy * 6, 3) * 3);
        if (P.surface === 'craters') tex = 0.7 + 0.3 * smooth(-0.2, 0.4, N.ridged(dx * 3 + 10, dy * 3 + 10, 4));
        const v = 0.96 - 0.9 * light * tex;
        return ring && dy * ct - dx * st > 0 ? Math.max(ring, v) : v;
    });
}

// ─── Spiral galaxy / vortex ─────────────────────────────────────────────────────────
function spiralParams(rng, A) {
    return {
        arms: rng.int(2, 6),
        twist: rng.range(4, 12) * rng.sign(),
        tilt: rng.range(1, 1.9),
        cx: rng.range(-A * 0.12, A * 0.12),
        cy: rng.range(-0.06, 0.06),
        size: rng.range(1.2, 2.4),
        noise: rng.range(0.2, 1),
    };
}

function renderSpiral(P, W, H, rng) {
    const N = createNoise(rng.fork('spiral'));
    return sampleGrid(W, H, (X, Y) => {
        const dx = X - P.cx, dy = (Y - P.cy) * P.tilt, r = Math.hypot(dx, dy);
        const n = N.fbm(dx * 4, dy * 4, 3) * P.noise;
        const arms = 0.5 + 0.5 * Math.sin(P.arms * Math.atan2(dy, dx) + P.twist * Math.log(r + 0.04) + n * 2);
        return clamp01(arms * (0.2 + 0.8 * Math.exp(-r * P.size)) + 0.95 * Math.exp(-r * r * 70));
    });
}

// ─── Voronoi: cells, cracks, stones ────────────────────────────────────────────────
function voronoiParams(rng) {
    return {
        mode: rng.weighted([['cracks', 2], ['cells', 2], ['stones', 2]]),
        size: rng.range(0.05, 0.16),
        width: rng.range(0.006, 0.02),
        seed: rng.int(0, 1e6),
    };
}

function renderVoronoi(P, W, H) {
    const s = P.size;
    // Jittered grid: one point per cell, hashed so it is stable across sizes.
    const hash = (i, j, k) => {
        let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k + P.seed, 2246822519);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    return sampleGrid(W, H, (X, Y) => {
        const gx = Math.floor(X / s), gy = Math.floor(Y / s);
        let f1 = Infinity, f2 = Infinity, id = 0;
        for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
                const cx = (gx + i + hash(gx + i, gy + j, 1)) * s, cy = (gy + j + hash(gx + i, gy + j, 2)) * s;
                const d = Math.hypot(X - cx, Y - cy);
                if (d < f1) { f2 = f1; f1 = d; id = hash(gx + i, gy + j, 3); } else if (d < f2) f2 = d;
            }
        }
        if (P.mode === 'cracks') return f2 - f1 < P.width ? 0.95 : 0.05;
        if (P.mode === 'cells') return f2 - f1 < P.width * 0.6 ? 0.95 : 0.15 + 0.7 * id;
        return clamp01(f1 / (s * 0.75)) * 0.9;
    });
}

// ─── Superformula and roses: echoed outlines ───────────────────────────────────────
function shapeParams(rng) {
    return {
        m: rng.int(2, 12),
        n1: rng.range(0.2, 6),
        n2: rng.range(0.3, 8),
        n3: rng.range(0.3, 8),
        echoes: rng.int(6, 26),
        width: rng.range(0.08, 0.3),
        size: rng.range(0.28, 0.42),
        rot: rng.range(0, TAU),
        fillInside: rng.chance(0.4),
    };
}

function renderShape(P) {
    const sf = (t) => {
        const a = Math.abs(Math.cos((P.m * t) / 4)) ** P.n2, b = Math.abs(Math.sin((P.m * t) / 4)) ** P.n3;
        const r = (a + b) ** (-1 / P.n1);
        return Number.isFinite(r) ? r : 1;
    };
    // Normalise the outline so its largest radius fills `size`.
    let maxR = 0;
    for (let i = 0; i < 720; i++) maxR = Math.max(maxR, sf((i / 720) * TAU));
    return (W, H) => sampleGrid(W, H, (X, Y) => {
        const r = Math.hypot(X, Y), t = Math.atan2(Y, X) + P.rot;
        const R = (sf(t) / maxR) * P.size;
        const q = r / R;
        if (q > 1.6) return 0;
        const echo = Math.abs(fract(q * P.echoes) - 0.5) < P.width / 2 ? 0.95 : 0;
        if (q <= 1) return P.fillInside ? Math.max(echo, 0.25 + 0.5 * (1 - q)) : echo;
        return echo * smooth(1.6, 1, q);
    });
}

// ─── Registry ───────────────────────────────────────────────────────────────────────
// Weights favour the most striking primitives (attractors, flow lines).
// kind guides the dither choice: density (point clouds), smooth (gradients), line (thin
// strokes), shape (flat areas).
export const PRIMITIVES = {
    attractor: { kind: 'density', weight: 6, params: attractorParams, render: renderAttractor },
    reaction: { kind: 'shape', weight: 3, params: rdParams, render: renderReaction },
    noise: { kind: 'smooth', weight: 3, params: noiseParams, render: renderNoise },
    interference: { kind: 'smooth', weight: 3, params: interferenceParams, render: (P, W, H) => renderInterference(P)(W, H) },
    flow: { kind: 'density', weight: 5, params: flowParams, render: renderFlow },
    heat: { kind: 'smooth', weight: 2, params: heatParams, render: (P, W, H) => renderHeat(P)(W, H) },
    ridges: { kind: 'line', weight: 3, params: ridgesParams, render: renderRidges },
    planet: { kind: 'smooth', weight: 2, params: planetParams, render: renderPlanet },
    spiral: { kind: 'smooth', weight: 2, params: spiralParams, render: renderSpiral },
    voronoi: { kind: 'shape', weight: 2, params: voronoiParams, render: (P, W, H) => renderVoronoi(P, W, H) },
    shape: { kind: 'line', weight: 3, params: shapeParams, render: (P, W, H) => renderShape(P)(W, H) },
};

export { sampleGrid, upsample, normalise, smooth, clamp01 };
