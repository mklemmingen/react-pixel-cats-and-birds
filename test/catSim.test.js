import {describe, expect, it} from 'vitest';
import {
    bandForVector, catAt, createCat, currentTile, DIRECTIONS, IDLES, LIE_DOWN, LOOK_AROUND, MOVES, resizeWorld,
    setIdle, setMoving, SIT_DOWN, sourceRect, SPRITE_FPS, startle, stepCat,
} from '../src/core/catSim.js';
import {seeded} from './helpers.js';

const world = () => ({width: 1200, height: 800, size: 96, avoidCenter: false});
const sheet = {ready: true};
const tick = 1 / 30;

/** record the distinct tiles a cat shows while idle */
function idleTrace(idleIndex, holdMs = 1000) {
    const w = world();
    const rng = seeded(3);
    const cat = createCat(w, sheet, rng);
    setIdle(cat, rng);
    cat.idle = IDLES[idleIndex].tiles;
    cat.timer = holdMs;
    const trace = [];
    let prev = '';
    for (let i = 0; i < 2000 && cat.state === 'idle'; i++) {
        const key = `${cat.phase}:${currentTile(cat).join('.')}`;
        if (key !== prev) trace.push(key);
        prev = key;
        stepCat(cat, tick, w, rng);
    }
    return {trace, cat};
}

describe('direction mapping', () => {
    it.each([
        [1, 0, 'E'], [1, 1, 'SE'], [0, 1, 'S'], [-1, 1, 'SW'],
        [-1, 0, 'W'], [-1, -1, 'NW'], [0, -1, 'N'], [1, -1, 'NE'],
    ])('moving (%i, %i) faces %s', (dx, dy, dir) => {
        expect(DIRECTIONS[bandForVector(dx, dy)]).toBe(dir);
    });

    it('a walking cat faces the way it moves', () => {
        const w = world();
        const rng = seeded(9);
        const cat = createCat(w, sheet, rng);
        setMoving(cat, w, 'walking', rng);
        cat.x = 100;
        cat.y = 100;
        cat.tx = 600;
        cat.ty = 100;
        stepCat(cat, tick, w, rng);
        expect(DIRECTIONS[cat.band]).toBe('E');
        expect(sourceRect(cat).sy).toBe(6 * 64 + MOVES.walking.row * 32);
    });
});

describe('idle poses play in, freeze, then play out', () => {
    it.each([
        ['sit', 0, SIT_DOWN],
        ['look around', 1, [...SIT_DOWN, ...LOOK_AROUND]],
        ['lie down', 2, [...SIT_DOWN, ...LIE_DOWN]],
    ])('%s: every frame once forward, hold on the last, every frame once backward', (_, index, tiles) => {
        const {trace, cat} = idleTrace(index);
        const names = tiles.map(t => t.join('.'));
        const expected = [
            ...names.map(n => `enter:${n}`),
            `hold:${names[names.length - 1]}`,
            ...[...names].reverse().map(n => `exit:${n}`),
        ];
        expect(trace).toEqual(expected);
        expect(['walking', 'running']).toContain(cat.state);
    });

    it('never loops an idle animation (no frame repeats within enter or exit)', () => {
        for (let i = 0; i < IDLES.length; i++) {
            const {trace} = idleTrace(i, 3000);
            const enter = trace.filter(t => t.startsWith('enter'));
            const exit = trace.filter(t => t.startsWith('exit'));
            expect(new Set(enter).size).toBe(enter.length);
            expect(new Set(exit).size).toBe(exit.length);
        }
    });

    it('holds the frozen pose for the whole wait', () => {
        const w = world();
        const rng = seeded(5);
        const cat = createCat(w, sheet, rng);
        setIdle(cat, rng, 'hold');
        cat.timer = 2000;
        const frozen = currentTile(cat).join('.');
        for (let t = 0; t < 1.9; t += tick) {
            stepCat(cat, tick, w, rng);
            expect(currentTile(cat).join('.')).toBe(frozen);
        }
    });
});

describe('startle (click)', () => {
    it('a lying cat gets up from its current pose at double speed, then runs', () => {
        const w = world();
        const rng = seeded(11);
        const cat = createCat(w, sheet, rng);
        setIdle(cat, rng, 'hold');
        cat.idle = IDLES[2].tiles;
        cat.timer = 99999;
        startle(cat, w, rng);
        expect(cat.phase).toBe('exit');
        expect(currentTile(cat)).toEqual(cat.idle[cat.idle.length - 1]); // starts from where it was
        let elapsed = 0;
        while (cat.state === 'idle') {
            stepCat(cat, tick, w, rng);
            elapsed += tick;
        }
        expect(cat.state).toBe('running');
        // 14 frames at 8 fps take 1.75 s normally; startled takes about half
        expect(elapsed).toBeLessThan((cat.idle?.length ?? 14) / SPRITE_FPS * 0.6 + 0.1);
    });

    it('a cat mid sit-down reverses from the frame it is on (no jump)', () => {
        const w = world();
        const rng = seeded(12);
        const cat = createCat(w, sheet, rng);
        setIdle(cat, rng, 'enter');
        cat.idle = IDLES[0].tiles;
        cat.animTime = 3 / SPRITE_FPS + 0.01; // showing frame 3
        const before = currentTile(cat);
        startle(cat, w, rng);
        expect(currentTile(cat)).toEqual(before);
    });

    it('a walking cat bolts', () => {
        const w = world();
        const rng = seeded(13);
        const cat = createCat(w, sheet, rng);
        setMoving(cat, w, 'walking', rng);
        startle(cat, w, rng);
        expect(cat.state).toBe('running');
    });
});

describe('movement and bounds', () => {
    it('cats stay inside the area for a simulated hour', () => {
        const w = world();
        const rng = seeded(21);
        const cats = Array.from({length: 20}, () => createCat(w, sheet, rng));
        for (let i = 0; i < 30 * 60 * 60; i += 1) {
            for (const c of cats) stepCat(c, tick, w, rng);
            if (i % 600 === 0) {
                for (const c of cats) {
                    expect(c.x).toBeGreaterThanOrEqual(0);
                    expect(c.y).toBeGreaterThanOrEqual(0);
                    expect(c.x).toBeLessThanOrEqual(w.width - w.size);
                    expect(c.y).toBeLessThanOrEqual(w.height - w.size);
                    expect(Number.isFinite(c.x + c.y)).toBe(true);
                }
            }
        }
    });

    it('avoidCenter keeps cats in the outer quarters', () => {
        const w = {...world(), avoidCenter: true};
        const rng = seeded(22);
        for (let i = 0; i < 500; i++) {
            const c = createCat(w, sheet, rng);
            const mid = c.x + w.size / 2;
            expect(mid < w.width * 0.25 || mid > w.width * 0.75).toBe(true);
        }
    });

    it('a walking cat reaches its target and settles into an idle pose', () => {
        const w = world();
        const rng = seeded(23);
        const cat = createCat(w, sheet, rng);
        setMoving(cat, w, 'walking', rng);
        let steps = 0;
        while (cat.state !== 'idle' && steps < 30 * 120) {
            stepCat(cat, tick, w, rng);
            steps++;
        }
        expect(cat.state).toBe('idle');
        expect(cat.phase).toBe('enter');
    });

    it('resize rescales and clamps positions', () => {
        const w = world();
        const rng = seeded(24);
        const cats = Array.from({length: 10}, () => createCat(w, sheet, rng));
        resizeWorld(cats, w, 400, 300);
        for (const c of cats) {
            expect(c.x).toBeLessThanOrEqual(400 - 96);
            expect(c.y).toBeLessThanOrEqual(300 - 96);
            expect(c.tx).toBeLessThanOrEqual(400 - 96);
        }
    });

    it('works in an area smaller than one cat', () => {
        const w = {width: 50, height: 40, size: 96, avoidCenter: true};
        const rng = seeded(25);
        const c = createCat(w, sheet, rng);
        for (let i = 0; i < 1000; i++) stepCat(c, tick, w, rng);
        expect(c.x).toBe(0);
        expect(c.y).toBe(0);
    });
});

describe('hit testing', () => {
    it('returns the top-most (front) cat and ignores cats whose sheet is not loaded', () => {
        const a = {x: 0, y: 0, sheet: {ready: true}};
        const b = {x: 10, y: 10, sheet: {ready: true}};
        const hidden = {x: 0, y: 0, sheet: {ready: false}};
        expect(catAt([a, b], 20, 20, 96)).toBe(b);
        expect(catAt([a, hidden], 5, 5, 96)).toBe(a);
        expect(catAt([a], 200, 200, 96)).toBe(null);
    });
});
