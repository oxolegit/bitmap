// Generator checks without a browser: determinism, variety, quality gate, export geometry.
// Run with: node tests/run.js
import { makeRecipe, renderBits, describe } from '../gen/recipe.js';
import { measure, isGood } from '../gen/quality.js';
import { deriveSeed } from '../gen/rng.js';
import { bitsToRects } from '../export.js';

let failed = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failed++;
};

const hash = (bits) => {
    let h = 2166136261;
    for (const b of bits) h = Math.imul(h ^ b, 16777619);
    return h >>> 0;
};

// Same seed and size → identical bits; different seeds → different bits.
{
    const W = 120, H = 150;
    const a = hash(renderBits(makeRecipe('fixed-seed', W / H), W, H));
    const b = hash(renderBits(makeRecipe('fixed-seed', W / H), W, H));
    const c = hash(renderBits(makeRecipe('other-seed', W / H), W, H));
    check('determinism: same seed gives the same image', a === b);
    check('different seeds give different images', a !== c);
}

// Fallback seeds are stable and distinct.
check('deriveSeed is deterministic', deriveSeed('abc', 3) === deriveSeed('abc', 3));
check('deriveSeed varies with n', deriveSeed('abc', 1) !== deriveSeed('abc', 2));

// Variety and quality over many seeds (small grid, fast).
{
    const N = 120, W = 72, H = 90;
    const primaries = new Set(), dithers = new Set();
    let good = 0;
    for (let i = 0; i < N; i++) {
        const r = makeRecipe('t' + i, W / H);
        const d = describe(r);
        primaries.add(d.primary);
        dithers.add(d.dither);
        if (d.primary === 'reaction' || isGood(measure(renderBits(r, W, H), W, H))) good++;
    }
    check('all primitive families appear', primaries.size >= 10, `${primaries.size} families`);
    check('many dither algorithms appear', dithers.size >= 9, `${dithers.size} dithers`);
    check('most seeds pass the quality gate', good / N >= 0.6, `${Math.round((100 * good) / N)}% pass`);
}

// SVG rectangles cover exactly the ink cells.
{
    const W = 40, H = 30;
    const bits = renderBits(makeRecipe('svg-check', W / H), W, H);
    const cover = new Uint8Array(W * H);
    for (const r of bitsToRects(bits, W, H)) {
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cover[y * W + x]++;
    }
    let same = true;
    for (let i = 0; i < bits.length; i++) if (cover[i] !== bits[i]) same = false;
    check('SVG rectangles match the bitmap cell for cell', same);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
