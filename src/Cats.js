'use client';

/*
 * <Cats /> - wandering pixel-art cats on a canvas.
 * Cat art: "Cats || Pixel Asset Pack" by Pop Shop Packs (https://pop-shop-packs.itch.io/),
 * used with permission. See CREDITS.md.
 */

import {createElement, useEffect, useRef} from 'react';
import {CAT_SHEETS} from './sprites.js';
import {loadImage, runScene} from './canvasScene.js';
import {CAT_TILE, catAt, createCat, resizeWorld, sourceRect, startle, stepCat} from './core/catSim.js';
import {playMeow} from './audio/meow.js';

const BASE_STYLE = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    imageRendering: 'pixelated',
};

function shuffled(list, rng) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Wandering pixel-art cats. Place inside a positioned container (it fills it).
 * See index.d.ts for the full prop documentation.
 */
export function Cats({
    count = 10,
    colors,
    sheets,
    variety = 8,
    scale = 3,
    avoidCenter = false,
    sound = 'synth',
    interactive = true,
    maxFps = 30,
    className,
    style,
}) {
    const ref = useRef(null);
    const soundRef = useRef(sound);
    soundRef.current = sound;
    const sheetKey = (sheets || colors || []).join('|');

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return undefined;
        const rng = Math.random;
        const urls = sheets?.length
            ? sheets
            : (colors?.length ? colors : Object.keys(CAT_SHEETS)).map(c => CAT_SHEETS[c]).filter(Boolean);
        const palette = shuffled(urls, rng).slice(0, Math.max(1, variety));
        const size = CAT_TILE * scale;
        const world = {width: 0, height: 0, size, avoidCenter};
        let cats = [];

        return runScene(canvas, {
            interactive,
            maxFps,
            spawn(w, h) {
                world.width = w;
                world.height = h;
                cats = Array.from({length: count}, () =>
                    createCat(world, loadImage(palette[Math.floor(rng() * palette.length)]), rng));
            },
            resize(w, h) {
                resizeWorld(cats, world, w, h);
            },
            step(dt) {
                for (const cat of cats) stepCat(cat, dt, world, rng);
            },
            draw(ctx) {
                cats.sort((a, b) => a.y - b.y); // back-to-front
                for (const cat of cats) {
                    if (!cat.sheet.ready) continue;
                    const r = sourceRect(cat);
                    ctx.drawImage(cat.sheet.img, r.sx, r.sy, r.sw, r.sh,
                        Math.round(cat.x), Math.round(cat.y), size, size);
                }
            },
            hit(x, y) {
                return catAt(cats, x, y, size);
            },
            onHit(cat) {
                const s = soundRef.current;
                if (typeof s === 'function') s(cat);
                else if (s) playMeow();
                startle(cat, world, rng);
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count, sheetKey, variety, scale, avoidCenter, interactive, maxFps]);

    return createElement('canvas', {
        ref,
        width: 0,
        height: 0,
        className,
        style: style ? {...BASE_STYLE, ...style} : BASE_STYLE,
        'aria-hidden': true,
    });
}
