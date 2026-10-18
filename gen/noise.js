// Seeded 2D gradient noise, fractal sums and domain warping.

export function createNoise(rng) {
    const perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    // 8 gradient directions on the unit circle.
    const GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071];
    const GY = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

    // Perlin noise, roughly in [-1, 1].
    function noise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const X = xi & 255, Y = yi & 255;
        const g = (h, dx, dy) => GX[h & 7] * dx + GY[h & 7] * dy;
        const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
        const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
        const u = fade(xf), v = fade(yf);
        const x1 = g(aa, xf, yf) + u * (g(ba, xf - 1, yf) - g(aa, xf, yf));
        const x2 = g(ab, xf, yf - 1) + u * (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1));
        return (x1 + v * (x2 - x1)) * 1.42;
    }

    // Fractal Brownian motion, roughly in [-1, 1].
    function fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
        let sum = 0, amp = 0.5, freq = 1, norm = 0;
        for (let o = 0; o < octaves; o++) {
            sum += amp * noise(x * freq, y * freq);
            norm += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        return sum / norm;
    }

    // Ridged multifractal: sharp creases, in [0, 1].
    function ridged(x, y, octaves = 5) {
        let sum = 0, amp = 0.5, freq = 1, norm = 0;
        for (let o = 0; o < octaves; o++) {
            const n = 1 - Math.abs(noise(x * freq, y * freq));
            sum += amp * n * n;
            norm += amp;
            amp *= 0.5;
            freq *= 2.03;
        }
        return sum / norm;
    }

    // Two-level domain warp (Quilez): fbm(p + k·fbm(p + k·fbm(p))), in roughly [-1, 1].
    function warp(x, y, k = 4, octaves = 4) {
        const qx = fbm(x, y, octaves), qy = fbm(x + 5.2, y + 1.3, octaves);
        const rx = fbm(x + k * qx + 1.7, y + k * qy + 9.2, octaves);
        const ry = fbm(x + k * qx + 8.3, y + k * qy + 2.8, octaves);
        return fbm(x + k * rx, y + k * ry, octaves);
    }

    return { noise, fbm, ridged, warp };
}
