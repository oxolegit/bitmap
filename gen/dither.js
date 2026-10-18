// Dithering: ink density (Float32Array, 0…1) → bits (Uint8Array, 1 = ink).

// ─── Ordered ────────────────────────────────────────────────────────────────────────
function bayerMatrix(n) {
    let m = [[0]];
    while (m.length < n) {
        const s = m.length, next = Array.from({ length: s * 2 }, () => new Array(s * 2));
        for (let y = 0; y < s; y++) {
            for (let x = 0; x < s; x++) {
                const v = 4 * m[y][x];
                next[y][x] = v;
                next[y][x + s] = v + 2;
                next[y + s][x] = v + 3;
                next[y + s][x + s] = v + 1;
            }
        }
        m = next;
    }
    const flat = new Float32Array(n * n), total = n * n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) flat[y * n + x] = (m[y][x] + 0.5) / total;
    return flat;
}

function ordered(ink, W, H, matrix, n) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
        const row = (y % n) * n;
        for (let x = 0; x < W; x++) out[y * W + x] = ink[y * W + x] > matrix[row + (x % n)] ? 1 : 0;
    }
    return out;
}

function ign(ink, W, H) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const v = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1);
            out[y * W + x] = ink[y * W + x] > v - Math.floor(v) ? 1 : 0;
        }
    }
    return out;
}

// Blue noise threshold map by void-and-cluster (Ulichney), computed once and cached.
let blueCache = null;
function blueNoise(S = 64) {
    if (blueCache) return blueCache;
    const N = S * S, sigma = 1.9;
    // Toroidal Gaussian kernel, indexed by offset.
    const kernel = new Float32Array(N);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const dx = Math.min(x, S - x), dy = Math.min(y, S - y);
            kernel[y * S + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        }
    }
    const energy = new Float32Array(N);
    const bits = new Uint8Array(N);
    const splat = (i, sign) => {
        const ix = i % S, iy = (i / S) | 0;
        for (let y = 0; y < S; y++) {
            const ky = ((y - iy + S) % S) * S, row = y * S;
            for (let x = 0; x < S; x++) energy[row + x] += sign * kernel[ky + ((x - ix + S) % S)];
        }
    };
    const extreme = (wantOnes, max) => {
        let best = -1, bv = max ? -Infinity : Infinity;
        for (let i = 0; i < N; i++) {
            if (bits[i] !== (wantOnes ? 1 : 0)) continue;
            if (max ? energy[i] > bv : energy[i] < bv) { bv = energy[i]; best = i; }
        }
        return best;
    };
    // Deterministic initial pattern (~10%), then relax: move tightest cluster into largest void.
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const ones = Math.round(N * 0.1);
    for (let k = 0; k < ones; k++) {
        let i;
        do { i = Math.floor(rnd() * N); } while (bits[i]);
        bits[i] = 1; splat(i, 1);
    }
    for (let guard = 0; guard < N; guard++) {
        const c = extreme(true, true);
        bits[c] = 0; splat(c, -1);
        const v = extreme(false, false);
        if (v === c) { bits[c] = 1; splat(c, 1); break; }
        bits[v] = 1; splat(v, 1);
    }
    const rank = new Float32Array(N);
    const proto = bits.slice(), protoEnergy = energy.slice();
    // Phase 1: remove clusters from the prototype, ranking downwards.
    let count = ones;
    while (count > 0) {
        const c = extreme(true, true);
        bits[c] = 0; splat(c, -1); count--;
        rank[c] = count;
    }
    // Phase 2/3: from the prototype, fill voids, ranking upwards.
    bits.set(proto); energy.set(protoEnergy); count = ones;
    while (count < N) {
        const v = extreme(false, false);
        bits[v] = 1; splat(v, 1);
        rank[v] = count++;
    }
    for (let i = 0; i < N; i++) rank[i] = (rank[i] + 0.5) / N;
    blueCache = { map: rank, size: S };
    return blueCache;
}

// ─── Error diffusion ────────────────────────────────────────────────────────────────
// [dx, dy, weight] with a common divisor; scanned serpentine to avoid diagonal worms.
const KERNELS = {
    floyd: { d: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
    atkinson: { d: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
    jjn: { d: 48, k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
    stucki: { d: 42, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
    sierra: { d: 4, k: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
};

function diffuse(ink, W, H, name) {
    const { d, k } = KERNELS[name];
    const g = Float32Array.from(ink);
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
        const ltr = (y & 1) === 0;
        for (let n = 0; n < W; n++) {
            const x = ltr ? n : W - 1 - n, i = y * W + x;
            const on = g[i] > 0.5 ? 1 : 0, err = g[i] - on;
            out[i] = on;
            if (err === 0) continue;
            for (const [dx, dy, w] of k) {
                const xx = x + (ltr ? dx : -dx), yy = y + dy;
                if (xx >= 0 && xx < W && yy < H) g[yy * W + xx] += (err * w) / d;
            }
        }
    }
    return out;
}

// ─── Halftone screens ───────────────────────────────────────────────────────────────
function halftone(ink, W, H, { cell = 6, angle = 0.26, shape = 'dots' } = {}) {
    const out = new Uint8Array(W * H);
    const c = Math.cos(angle), s = Math.sin(angle);
    const at = (x, y) => ink[Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))];
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const u = x * c + y * s, v = -x * s + y * c;
            if (shape === 'lines') {
                const f = v / cell - Math.floor(v / cell);
                out[y * W + x] = Math.abs(f - 0.5) * 2 < ink[y * W + x] ? 1 : 0;
                continue;
            }
            // Centre of this screen cell, back in grid space, sets the dot size.
            const cu = (Math.floor(u / cell) + 0.5) * cell, cv = (Math.floor(v / cell) + 0.5) * cell;
            const cx = cu * c - cv * s, cy = cu * s + cv * c;
            const r = Math.sqrt(at(cx, cy)) * cell * 0.62;
            out[y * W + x] = (u - cu) ** 2 + (v - cv) ** 2 < r * r ? 1 : 0;
        }
    }
    return out;
}

// ─── Registry ───────────────────────────────────────────────────────────────────────
const bayer = { 2: bayerMatrix(2), 4: bayerMatrix(4), 8: bayerMatrix(8) };

export const DITHERS = {
    atkinson: { label: 'Atkinson', run: (i, W, H) => diffuse(i, W, H, 'atkinson') },
    floyd: { label: 'Floyd–Steinberg', run: (i, W, H) => diffuse(i, W, H, 'floyd') },
    jjn: { label: 'Jarvis–Judice–Ninke', run: (i, W, H) => diffuse(i, W, H, 'jjn') },
    stucki: { label: 'Stucki', run: (i, W, H) => diffuse(i, W, H, 'stucki') },
    sierra: { label: 'Sierra Lite', run: (i, W, H) => diffuse(i, W, H, 'sierra') },
    bayer2: { label: 'Bayer 2×2', run: (i, W, H) => ordered(i, W, H, bayer[2], 2) },
    bayer4: { label: 'Bayer 4×4', run: (i, W, H) => ordered(i, W, H, bayer[4], 4) },
    bayer8: { label: 'Bayer 8×8', run: (i, W, H) => ordered(i, W, H, bayer[8], 8) },
    blue: { label: 'Blue noise', run: (i, W, H) => { const b = blueNoise(); return ordered(i, W, H, b.map, b.size); } },
    ign: { label: 'IGN', run: ign },
    dots: { label: 'Halftone', run: (i, W, H, o) => halftone(i, W, H, { ...o, shape: 'dots' }) },
    lines: { label: 'Line screen', run: (i, W, H, o) => halftone(i, W, H, { ...o, shape: 'lines' }) },
    threshold: { label: 'Threshold', run: (i, W, H) => { const o = new Uint8Array(W * H); for (let k = 0; k < o.length; k++) o[k] = i[k] > 0.5 ? 1 : 0; return o; } },
};

// Which dithers suit which kind of field, by weight.
export const DITHER_AFFINITY = {
    density: [['atkinson', 4], ['threshold', 2], ['floyd', 2], ['blue', 2], ['bayer4', 1], ['stucki', 1]],
    smooth: [['bayer8', 3], ['blue', 3], ['atkinson', 3], ['floyd', 2], ['dots', 2], ['lines', 2], ['ign', 1], ['bayer4', 2], ['jjn', 1]],
    line: [['atkinson', 3], ['threshold', 3], ['floyd', 2], ['bayer2', 1], ['blue', 1]],
    shape: [['bayer4', 2], ['blue', 2], ['atkinson', 2], ['dots', 2], ['threshold', 2], ['sierra', 1], ['lines', 1]],
};
