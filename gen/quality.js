// Rejects dull results before anyone sees them: nearly empty or nearly solid frames,
// structureless noise, or flat fields without composition.

export function measure(bits, W, H) {
    let ink = 0, edges = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x, v = bits[i];
            ink += v;
            if (x + 1 < W && bits[i + 1] !== v) edges++;
            if (y + 1 < H && bits[i + W] !== v) edges++;
        }
    }
    // Large-scale structure: how much the ink share varies between blocks of the frame.
    const B = 6, sums = new Float32Array(B * B), counts = new Float32Array(B * B);
    for (let y = 0; y < H; y++) {
        const by = Math.min(B - 1, Math.floor((y / H) * B));
        for (let x = 0; x < W; x++) {
            const k = by * B + Math.min(B - 1, Math.floor((x / W) * B));
            sums[k] += bits[y * W + x];
            counts[k]++;
        }
    }
    let mean = 0;
    const shares = Array.from(sums, (s, k) => s / (counts[k] || 1));
    for (const s of shares) mean += s / shares.length;
    let variance = 0;
    for (const s of shares) variance += (s - mean) ** 2 / shares.length;
    return { ink: ink / (W * H), edges: edges / (2 * W * H), structure: Math.sqrt(variance) };
}

export function isGood({ ink, edges, structure }) {
    // Light-on-dark images are as valid as dark-on-light: judge the scarcer of the two.
    if (Math.min(ink, 1 - ink) < 0.07) return false;
    // Flat blobs only. Thin line art has few edges but strong large-scale structure, so the
    // bar is lower when the frame clearly has a shape.
    if (edges < (structure > 0.15 ? 0.012 : 0.025)) return false;
    if (edges > 0.46 && structure < 0.08) return false; // uniform static
    if (structure < 0.035) return false;         // nothing happens across the frame
    return true;
}
