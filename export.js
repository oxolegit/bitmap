// Export a bitmap (cells) at an exact pixel size, as PNG or SVG.

const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Cells as an ImageData-sized RGBA buffer, one pixel per cell.
export function cellsToImageData(bits, W, H, { ink, paper }) {
    const data = new ImageData(W, H);
    const px = new Uint32Array(data.data.buffer);
    const [ir, ig, ib] = hexToRgb(ink), [pr, pg, pb] = hexToRgb(paper);
    const on = (255 << 24) | (ib << 16) | (ig << 8) | ir;
    const off = (255 << 24) | (pb << 16) | (pg << 8) | pr;
    for (let i = 0; i < bits.length; i++) px[i] = bits[i] ? on : off;
    return data;
}

// PNG at exactly outW×outH: every cell becomes a crisp square of `cell` pixels.
export async function toPNG(bits, W, H, outW, outH, palette) {
    const small = new OffscreenCanvas(W, H);
    small.getContext('2d').putImageData(cellsToImageData(bits, W, H, palette), 0, 0);
    const big = new OffscreenCanvas(outW, outH);
    const ctx = big.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // Cells are square: scale by the cell size, so a partial last cell is simply cropped.
    const cell = Math.max(outW / W, outH / H);
    ctx.drawImage(small, 0, 0, W * cell, H * cell);
    return big.convertToBlob({ type: 'image/png' });
}

// Ink as rectangles: horizontal runs first, then runs stacked with the same span merge
// downwards. Far fewer elements than one rect per cell.
export function bitsToRects(bits, W, H) {
    const rects = [];
    const open = new Map(); // "x0,x1" → rect started on an earlier row
    for (let y = 0; y < H; y++) {
        const seen = new Set();
        for (let x = 0; x < W; ) {
            if (!bits[y * W + x]) { x++; continue; }
            let end = x;
            while (end < W && bits[y * W + end]) end++;
            const key = `${x},${end}`;
            const r = open.get(key);
            if (r && r.y + r.h === y) r.h++;
            else { const n = { x, y, w: end - x, h: 1 }; rects.push(n); open.set(key, n); }
            seen.add(key);
            x = end;
        }
        // A span missing on this row can't continue further down.
        for (const key of open.keys()) if (!seen.has(key)) open.delete(key);
    }
    return rects;
}

export function toSVG(bits, W, H, outW, outH, { ink, paper }) {
    const cell = Math.max(outW / W, outH / H);
    const vw = +(outW / cell).toFixed(4), vh = +(outH / cell).toFixed(4);
    const body = bitsToRects(bits, W, H).map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${vw} ${vh}" shape-rendering="crispEdges">` +
        `<rect width="${vw}" height="${vh}" fill="${paper}"/><g fill="${ink}">${body}</g></svg>`;
}

export function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
