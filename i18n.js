// Interface strings, Russian and English. Elements carry data-i18n="key" for their text and
// data-i18n-attr="attr:key;attr:key" for attributes.

export const STRINGS = {
    ru: {
        title: 'bitmap — генератор двухцветных изображений',
        description: 'Генератор уникальных двухцветных bitmap-изображений: странные аттракторы, реакция-диффузия, линии течений, муар. Любой формат, экспорт в PNG и SVG.',
        tagline: 'Генератор двухцветных изображений',
        format: 'Формат',
        custom: 'Свой',
        size: 'Размер',
        sizeHint: 'по длинной стороне',
        width: 'Ширина',
        height: 'Высота',
        pixel: 'Пиксель',
        palette: 'Палитра',
        ink: 'Чернила',
        paper: 'Бумага',
        dither: 'Дизеринг',
        auto: 'Авто',
        seed: 'Seed',
        copyLink: 'Ссылка',
        copied: 'Скопировано',
        generate: 'Сгенерировать',
        rendering: 'Рендер…',
        history: 'История',
        language: 'Язык',
        settings: 'Настройки',
        image: 'Сгенерированное изображение',
        cellsNote: 'Пиксель увеличен до {px}, чтобы уложиться в лимит',
        shortcuts: 'Пробел — новая картинка · ← → — история · P — PNG · S — SVG',
        license: 'Лицензия MIT with Attribution',
        error: 'Не получилось отрисовать. Попробуйте ещё раз.',
        palettes: { cv: 'Резюме', cvInverse: 'Резюме, инверсия', graphite: 'Графит', blueprint: 'Синька', sepia: 'Сепия', riso: 'Ризограф', moss: 'Мох', night: 'Ночь', custom: 'Свои цвета' },
        primitives: {
            attractor: 'Аттрактор', reaction: 'Реакция-диффузия', noise: 'Шум', interference: 'Интерференция',
            flow: 'Линии течений', heat: 'Тепловое поле', ridges: 'Хребты', planet: 'Планета', spiral: 'Спираль',
            voronoi: 'Вороной', shape: 'Суперформула',
        },
        variants: {
            clifford: 'Клиффорда', dejong: 'Де Йонга', svensson: 'Свенссона', bedhead: 'Bedhead',
            coral: 'коралл', maze: 'лабиринт', fingerprint: 'отпечаток', holes: 'поры', labyrinth: 'ходы', chaos: 'хаос', worms: 'черви',
            smoke: 'дым', marble: 'мрамор', contours: 'изолинии', terrace: 'террасы', ridged: 'гребни',
            waves: 'волны', moire: 'муар', grating: 'решётки',
            glow: 'свечение', isotherms: 'изотермы', both: 'изотермы',
            bands: 'полосы', craters: 'кратеры', smooth: 'гладкая',
            cracks: 'трещины', cells: 'ячейки', stones: 'камни',
        },
        ops: { multiply: 'умножение', mask: 'маска', difference: 'разность', screen: 'осветление', max: 'максимум' },
        symmetry: { mirror: 'зеркало', quad: 'четыре стороны', kaleido: 'калейдоскоп ×{n}' },
    },
    en: {
        title: 'bitmap — two-colour image generator',
        description: 'A generator of unique two-colour bitmap images: strange attractors, reaction–diffusion, flow lines, moiré. Any format, PNG and SVG export.',
        tagline: 'Two-colour image generator',
        format: 'Format',
        custom: 'Custom',
        size: 'Size',
        sizeHint: 'long side',
        width: 'Width',
        height: 'Height',
        pixel: 'Pixel',
        palette: 'Palette',
        ink: 'Ink',
        paper: 'Paper',
        dither: 'Dither',
        auto: 'Auto',
        seed: 'Seed',
        copyLink: 'Link',
        copied: 'Copied',
        generate: 'Generate',
        rendering: 'Rendering…',
        history: 'History',
        language: 'Language',
        settings: 'Settings',
        image: 'Generated image',
        cellsNote: 'Pixel raised to {px} to stay within the limit',
        shortcuts: 'Space — new image · ← → — history · P — PNG · S — SVG',
        license: 'MIT with Attribution licence',
        error: 'Rendering failed. Please try again.',
        palettes: { cv: 'Résumé', cvInverse: 'Résumé, inverted', graphite: 'Graphite', blueprint: 'Blueprint', sepia: 'Sepia', riso: 'Risograph', moss: 'Moss', night: 'Night', custom: 'Custom colours' },
        primitives: {
            attractor: 'Attractor', reaction: 'Reaction–diffusion', noise: 'Noise', interference: 'Interference',
            flow: 'Flow lines', heat: 'Heat field', ridges: 'Ridges', planet: 'Planet', spiral: 'Spiral',
            voronoi: 'Voronoi', shape: 'Superformula',
        },
        variants: {
            clifford: 'Clifford', dejong: 'de Jong', svensson: 'Svensson', bedhead: 'Bedhead',
            coral: 'coral', maze: 'maze', fingerprint: 'fingerprint', holes: 'pores', labyrinth: 'tunnels', chaos: 'chaos', worms: 'worms',
            smoke: 'smoke', marble: 'marble', contours: 'contours', terrace: 'terraces', ridged: 'ridged',
            waves: 'waves', moire: 'moiré', grating: 'gratings',
            glow: 'glow', isotherms: 'isotherms', both: 'isotherms',
            bands: 'bands', craters: 'craters', smooth: 'smooth',
            cracks: 'cracks', cells: 'cells', stones: 'stones',
        },
        ops: { multiply: 'multiply', mask: 'mask', difference: 'difference', screen: 'screen', max: 'max' },
        symmetry: { mirror: 'mirror', quad: 'four-way', kaleido: 'kaleidoscope ×{n}' },
    },
};

export function detectLang() {
    try {
        const saved = localStorage.getItem('bitmap:lang');
        if (saved === 'ru' || saved === 'en') return saved;
    } catch {}
    return (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function applyStrings(lang, root = document) {
    const t = STRINGS[lang];
    document.documentElement.lang = lang;
    document.title = t.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const v = t[el.dataset.i18n];
        if (typeof v === 'string') el.textContent = v;
    });
    root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
        for (const pair of el.dataset.i18nAttr.split(';')) {
            const [attr, key] = pair.split(':');
            if (t[key]) el.setAttribute(attr, t[key]);
        }
    });
    root.querySelectorAll('[data-palette-label]').forEach((el) => {
        const v = t.palettes[el.dataset.paletteLabel];
        if (v) el.setAttribute('aria-label', v), el.setAttribute('title', v);
    });
    try { localStorage.setItem('bitmap:lang', lang); } catch {}
}

// "Attractor Clifford × flow lines (mask) · kaleidoscope ×6"
export function describeLine(info, lang) {
    const t = STRINGS[lang];
    let s = t.primitives[info.primary] || info.primary;
    if (info.variant && t.variants[info.variant]) s += ' ' + t.variants[info.variant];
    if (info.secondary) s += ` × ${(t.primitives[info.secondary] || info.secondary).toLowerCase()} (${t.ops[info.op] || info.op})`;
    if (info.symmetry) s += ' · ' + t.symmetry[info.symmetry].replace('{n}', info.folds);
    return s;
}
