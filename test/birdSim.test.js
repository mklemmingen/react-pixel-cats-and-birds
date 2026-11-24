import {describe, expect, it} from 'vitest';
import {
    BIRD_ANIMS, birdAt, birdSourceRect, createBird, land, resizeBirdWorld, scare, setBirdState, stepBird, takeOff,
} from '../src/core/birdSim.js';
import {seeded} from './helpers.js';

const world = () => ({width: 1000, height: 700, size: 32});
const sheet = {ready: true};
const tick = 1 / 30;

describe('bird life cycle', () => {
    it('flies to its target, lands, idles, and takes off again (never stuck sitting)', () => {
        const w = world();
        const rng = seeded(1);
        const bird = createBird(w, sheet, 'crow', rng);
        takeOff(bird, w, rng);
        const seen = new Set();
        let flights = 0;
        let prev = bird.state;
        for (let i = 0; i < 30 * 120; i++) {
            stepBird(bird, tick, w, rng);
            seen.add(bird.state);
            if (prev !== 'flying' && bird.state === 'flying') flights++;
            prev = bird.state;
        }
        expect(seen.has('flying')).toBe(true);
        expect(seen.has('pecking') || seen.has('resting')).toBe(true);
        expect(flights).toBeGreaterThanOrEqual(3);
    });

    it('faces the way it flies (sheet faces west, mirrored when heading east)', () => {
        const w = world();
        const rng = seeded(2);
        const bird = createBird(w, sheet, 'cardinal', rng);
        setBirdState(bird, 'flying');
        bird.speedFactor = 1;
        Object.assign(bird, {x: 100, y: 100, tx: 600, ty: 120});
        stepBird(bird, tick, w, rng);
        expect(bird.mirrored).toBe(true);
        Object.assign(bird, {tx: 0});
        stepBird(bird, tick, w, rng);
        expect(bird.mirrored).toBe(false);
    });

    it('a scared bird flinches briefly, then bolts at 2.5x speed', () => {
        const w = world();
        const rng = seeded(3);
        const bird = createBird(w, sheet, 'magpie', rng);
        land(bird, rng);
        expect(scare(bird)).toBe(true);
        expect(bird.state).toBe('hit');
        expect(scare(bird)).toBe(false); // no double trigger
        for (let i = 0; i < 9; i++) stepBird(bird, tick, w, rng);
        expect(bird.state).toBe('flying');
        expect(bird.speedFactor).toBe(2.5);
    });

    it('every state maps to a tile inside the 64x64 sheet', () => {
        const w = world();
        const rng = seeded(4);
        const bird = createBird(w, sheet, 'crow', rng);
        for (const state of Object.keys(BIRD_ANIMS)) {
            setBirdState(bird, state, 1000);
            for (let i = 0; i < 40; i++) {
                bird.animTime = i * 0.05;
                const r = birdSourceRect(bird);
                expect(r.sx + r.sw).toBeLessThanOrEqual(64);
                expect(r.sy + r.sh).toBeLessThanOrEqual(64);
            }
        }
    });

    it('birds stay inside the area for a simulated hour', () => {
        const w = world();
        const rng = seeded(5);
        const birds = Array.from({length: 40}, () => createBird(w, sheet, 'chickadee', rng));
        for (let i = 0; i < 30 * 3600; i++) {
            for (const b of birds) stepBird(b, tick, w, rng);
            if (i % 900 === 0) {
                for (const b of birds) {
                    expect(b.x).toBeGreaterThanOrEqual(0);
                    expect(b.y).toBeGreaterThanOrEqual(0);
                    expect(b.x).toBeLessThanOrEqual(w.width - w.size);
                    expect(b.y).toBeLessThanOrEqual(w.height - w.size);
                }
            }
        }
    });

    it('resize rescales and clamps', () => {
        const w = world();
        const rng = seeded(6);
        const birds = Array.from({length: 10}, () => createBird(w, sheet, 'crow', rng));
        resizeBirdWorld(birds, w, 200, 100);
        for (const b of birds) {
            expect(b.x).toBeLessThanOrEqual(200 - 32);
            expect(b.ty).toBeLessThanOrEqual(100 - 32);
        }
    });

    it('hit testing picks the top-most loaded bird', () => {
        const a = {x: 0, y: 0, sheet: {ready: true}};
        const b = {x: 5, y: 5, sheet: {ready: true}};
        expect(birdAt([a, b], 10, 10, 32)).toBe(b);
        expect(birdAt([a, b], 100, 100, 32)).toBe(null);
    });
});
