// Rendering off the main thread: seed → recipe → field → dither → bits.
import { makeRecipe, renderBits, describe } from './gen/recipe.js';
import { measure, isGood } from './gen/quality.js';
import { deriveSeed } from './gen/rng.js';

// Primitives whose cost does not shrink with the preview size; they rarely disappoint, so
// they skip the quality check instead of paying for it twice.
const SKIP_CHECK = new Set(['reaction']);
const MAX_ATTEMPTS = 12;

function probeSize(W, H) {
    const k = 120 / Math.max(W, H);
    return [Math.max(24, Math.round(W * k)), Math.max(24, Math.round(H * k))];
}

// For a brand-new image: walk from the given seed to the first one that passes the check.
function pickSeed(seed, W, H, dither) {
    const [pw, ph] = probeSize(W, H);
    for (let n = 0; n < MAX_ATTEMPTS; n++) {
        const s = n === 0 ? seed : deriveSeed(seed, n);
        const recipe = makeRecipe(s, W / H, { dither });
        if (SKIP_CHECK.has(recipe.layers[0].id)) return s;
        if (isGood(measure(renderBits(recipe, pw, ph), pw, ph))) return s;
    }
    return seed;
}

self.onmessage = ({ data }) => {
    const { id, seed, W, H, dither, fresh } = data;
    const t0 = performance.now();
    try {
        const finalSeed = fresh ? pickSeed(seed, W, H, dither) : seed;
        const recipe = makeRecipe(finalSeed, W / H, { dither });
        const bits = renderBits(recipe, W, H);
        self.postMessage(
            { id, ok: true, seed: finalSeed, W, H, bits, info: describe(recipe), ms: Math.round(performance.now() - t0) },
            [bits.buffer],
        );
    } catch (error) {
        self.postMessage({ id, ok: false, error: String(error && error.message || error) });
    }
};
