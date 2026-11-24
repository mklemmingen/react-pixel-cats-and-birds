'use client';

/*
 * <Birds /> - pixel-art garden birds that fly, land, peck and rest.
 * Bird art: "Garden Birds || Pixel Asset Pack" by Pop Shop Packs (https://pop-shop-packs.itch.io/),
 * used with permission. See CREDITS.md.
 */

import {createElement, useEffect, useRef} from 'react';
import {BIRD_SHEETS} from './sprites.js';
import {loadImage, runScene} from './canvasScene.js';
import {BIRD_TILE, birdAt, birdSourceRect, createBird, resizeBirdWorld, scare, stepBird} from './core/birdSim.js';
import {playChirp} from './audio/chirp.js';

const BASE_STYLE = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    imageRendering: 'pixelated',
};

/**
 * Pixel-art birds. Place inside a positioned container (it fills it).
 * See index.d.ts for the full prop documentation.
 */
export function Birds({
    count = 20,
    species,
    scale = 2,
    sound = 'synth',
    interactive = true,
    maxFps = 30,
    className,
    style,
}) {
    const ref = useRef(null);
    const soundRef = useRef(sound);
    soundRef.current = sound;
    const speciesKey = (species || []).join('|');

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return undefined;
        const rng = Math.random;
        const ids = (species?.length ? species : Object.keys(BIRD_SHEETS)).filter(id => BIRD_SHEETS[id]);
        const size = BIRD_TILE * scale;
        const world = {width: 0, height: 0, size};
        let birds = [];

        return runScene(canvas, {
            interactive,
            maxFps,
            spawn(w, h) {
                world.width = w;
                world.height = h;
                birds = Array.from({length: count}, () => {
                    const id = ids[Math.floor(rng() * ids.length)];
                    return createBird(world, loadImage(BIRD_SHEETS[id]), id, rng);
                });
            },
            resize(w, h) {
                resizeBirdWorld(birds, world, w, h);
            },
            step(dt) {
                for (const bird of birds) stepBird(bird, dt, world, rng);
            },
            draw(ctx) {
                for (const bird of birds) {
                    if (!bird.sheet.ready) continue;
                    const r = birdSourceRect(bird);
                    const x = Math.round(bird.x);
                    const y = Math.round(bird.y);
                    if (bird.mirrored) {
                        ctx.save();
                        ctx.translate(x + size, y);
                        ctx.scale(-1, 1);
                        ctx.drawImage(bird.sheet.img, r.sx, r.sy, r.sw, r.sh, 0, 0, size, size);
                        ctx.restore();
                    } else {
                        ctx.drawImage(bird.sheet.img, r.sx, r.sy, r.sw, r.sh, x, y, size, size);
                    }
                }
            },
            hit(x, y) {
                return birdAt(birds, x, y, size);
            },
            onHit(bird) {
                if (!scare(bird)) return;
                const s = soundRef.current;
                if (typeof s === 'function') s(bird);
                else if (s) playChirp(bird.species);
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count, speciesKey, scale, interactive, maxFps]);

    return createElement('canvas', {
        ref,
        width: 0,
        height: 0,
        className,
        style: style ? {...BASE_STYLE, ...style} : BASE_STYLE,
        'aria-hidden': true,
    });
}
