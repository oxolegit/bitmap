// GET /s/<seed>?…  (rewritten to /api/share?seed=<seed>&…)
// The generator page itself, with title, description and Open Graph tags describing this
// particular image, so a shared link previews as the picture it opens.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRecipe, describe } from '../gen/recipe.js';
import { DEFAULTS, parseShare, toQuery, aspectOf } from '../share.js';
import { describeLine } from '../i18n.js';

const SITE = 'https://bitmap.mslv.space';
let template = null;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function sharePage(params) {
    template ??= readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const state = { ...DEFAULTS, ...parseShare(params, params.get('seed')) };
    if (!state.seed) return template;

    const query = toQuery(state);
    const url = `${SITE}/s/${state.seed}?${query}`;
    const image = `${SITE}/api/og?s=${state.seed}&${query}`;
    const line = describeLine(describe(makeRecipe(state.seed, aspectOf(state))), state.lang);
    const title = `${line} — bitmap`;
    const description = state.lang === 'en'
        ? `A two-colour bitmap image, seed ${state.seed}. Open it to export PNG or SVG, or generate your own.`
        : `Двухцветное bitmap-изображение, seed ${state.seed}. Откройте, чтобы скачать PNG или SVG или сгенерировать своё.`;

    const set = (html, re, value) => html.replace(re, (m, a, b) => `${a}${esc(value)}${b}`);
    let html = template;
    html = html.replace(/<html lang="[^"]*"/, `<html lang="${state.lang}"`);
    html = set(html, /(<title>)[^<]*(<\/title>)/, title);
    html = set(html, /(<meta name="description" content=")[^"]*(")/, description);
    html = set(html, /(<link rel="canonical" href=")[^"]*(")/, url);
    html = set(html, /(<meta property="og:url" content=")[^"]*(")/, url);
    html = set(html, /(<meta property="og:title" content=")[^"]*(")/, title);
    html = set(html, /(<meta property="og:description" content=")[^"]*(")/, description);
    html = set(html, /(<meta property="og:image" content=")[^"]*(")/, image);
    return html;
}

export default function handler(req, res) {
    const html = sharePage(new URL(req.url, 'http://localhost').searchParams);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400');
    res.end(html);
}
