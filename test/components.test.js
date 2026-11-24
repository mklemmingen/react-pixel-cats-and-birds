// @vitest-environment jsdom
/*
 * Mounts <Cats> and <Birds> in jsdom with a recording 2D context and controllable observers,
 * then checks start-up, drawing, pausing, clicks, stacking and clean unmount.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {Birds, Cats} from '../src/index.js';
import {SCENE_ATTR} from '../src/canvasScene.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let observers;
let rafQueue;
let now;
let draws;
let root;
let host;

function fakeContext(canvas) {
    return {
        canvas,
        imageSmoothingEnabled: true,
        clearRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        drawImage: vi.fn((...args) => draws.push({canvas, args})),
    };
}

beforeEach(() => {
    observers = {io: [], ro: []};
    rafQueue = new Map();
    now = 0;
    draws = [];
    let rafId = 0;

    globalThis.IntersectionObserver = class {
        constructor(cb) {
            this.cb = cb;
            this.disconnected = false;
            observers.io.push(this);
        }
        observe(el) {
            this.el = el;
        }
        disconnect() {
            this.disconnected = true;
        }
    };
    globalThis.ResizeObserver = class {
        constructor(cb) {
            this.cb = cb;
            this.disconnected = false;
            observers.ro.push(this);
        }
        observe(el) {
            this.el = el;
        }
        disconnect() {
            this.disconnected = true;
        }
    };
    globalThis.requestAnimationFrame = (cb) => {
        rafQueue.set(++rafId, cb);
        return rafId;
    };
    globalThis.cancelAnimationFrame = (id) => rafQueue.delete(id);
    // images "load" instantly
    globalThis.Image = class {
        set src(v) {
            this._src = v;
            queueMicrotask(() => this.onload?.());
        }
        get src() {
            return this._src;
        }
    };
    HTMLCanvasElement.prototype.getContext = function () {
        this.__ctx ||= fakeContext(this);
        return this.__ctx;
    };
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {configurable: true, get: () => 1000});
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {configurable: true, get: () => 600});
    HTMLCanvasElement.prototype.getBoundingClientRect = () => ({left: 0, top: 0, width: 1000, height: 600});
    window.matchMedia = () => ({matches: false});
    document.elementFromPoint = () => null; // jsdom has no layout

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

const frames = async (n, ms = 34) => {
    await Promise.resolve(); // image onload microtasks
    for (let i = 0; i < n; i++) {
        now += ms;
        const cbs = [...rafQueue.values()];
        rafQueue.clear();
        act(() => cbs.forEach(cb => cb(now)));
    }
};

const becomeVisible = (visible = true) => act(() => {
    for (const io of observers.io) io.cb([{isIntersecting: visible}]);
});

describe('<Cats>', () => {
    it('does nothing until visible, then sizes the canvas and draws every cat', async () => {
        act(() => root.render(createElement(Cats, {count: 7})));
        const canvas = host.querySelector('canvas');
        expect(canvas.width).toBe(0);
        expect(rafQueue.size).toBe(0);

        becomeVisible();
        expect([canvas.width, canvas.height]).toEqual([1000, 600]);
        await frames(3);
        const last = draws.slice(-7);
        expect(last).toHaveLength(7);
        for (const {args} of last) {
            const [, sx, sy, sw, sh, dx, dy, dw, dh] = args;
            expect(sx + sw).toBeLessThanOrEqual(768);
            expect(sy + sh).toBeLessThanOrEqual(512);
            expect([dw, dh]).toEqual([96, 96]);
            expect(dx).toBeGreaterThanOrEqual(0);
            expect(dy).toBeGreaterThanOrEqual(0);
        }
        expect(canvas.getAttribute('aria-hidden')).toBe('true');
        expect(canvas.hasAttribute(SCENE_ATTR)).toBe(true);
    });

    it('pauses and frees the backing store when scrolled out of view', async () => {
        act(() => root.render(createElement(Cats, {count: 3})));
        const canvas = host.querySelector('canvas');
        becomeVisible();
        await frames(2);
        becomeVisible(false);
        expect([canvas.width, canvas.height]).toEqual([0, 0]);
        expect(rafQueue.size).toBe(0);
        const before = draws.length;
        await frames(5);
        expect(draws.length).toBe(before);
        becomeVisible();
        await frames(2);
        expect(draws.length).toBeGreaterThan(before);
    });

    it('clicking a cat calls the sound handler with that cat and makes it react', async () => {
        const sound = vi.fn();
        act(() => root.render(createElement(Cats, {count: 1, sound})));
        const canvas = host.querySelector('canvas');
        becomeVisible();
        await frames(2);
        const [, , , , , dx, dy] = draws[draws.length - 1].args;
        act(() => canvas.dispatchEvent(new MouseEvent('click', {clientX: dx + 48, clientY: dy + 48, bubbles: true})));
        expect(sound).toHaveBeenCalledTimes(1);
        const cat = sound.mock.calls[0][0];
        expect(cat.state === 'running' || (cat.state === 'idle' && cat.phase === 'exit')).toBe(true);
        // a miss does nothing
        act(() => canvas.dispatchEvent(new MouseEvent('click', {clientX: dx + 500, clientY: dy + 500})));
        expect(sound).toHaveBeenCalledTimes(1);
    });

    it('hovering a cat shows a pointer cursor', async () => {
        act(() => root.render(createElement(Cats, {count: 1, sound: false})));
        const canvas = host.querySelector('canvas');
        becomeVisible();
        await frames(2);
        const [, , , , , dx, dy] = draws[draws.length - 1].args;
        act(() => canvas.dispatchEvent(new MouseEvent('mousemove', {clientX: dx + 40, clientY: dy + 40})));
        expect(canvas.style.cursor).toBe('pointer');
    });

    it('interactive={false} lets clicks through', () => {
        act(() => root.render(createElement(Cats, {interactive: false})));
        becomeVisible();
        expect(host.querySelector('canvas').style.pointerEvents).toBe('none');
    });

    it('unmount stops the loop, disconnects observers and releases the canvas', async () => {
        act(() => root.render(createElement(Cats, {count: 4})));
        const canvas = host.querySelector('canvas');
        becomeVisible();
        await frames(2);
        act(() => root.render(createElement('div')));
        expect(rafQueue.size).toBe(0);
        expect(observers.io.every(o => o.disconnected)).toBe(true);
        expect(observers.ro.every(o => o.disconnected)).toBe(true);
        expect([canvas.width, canvas.height]).toEqual([0, 0]);
    });

    it('survives React StrictMode double mount with a single animation loop', async () => {
        const {StrictMode} = await import('react');
        act(() => root.render(createElement(StrictMode, null, createElement(Cats, {count: 2}))));
        becomeVisible();
        await frames(1);
        expect(rafQueue.size).toBe(1);
    });

    it('reduced motion draws still frames without an animation loop', async () => {
        window.matchMedia = () => ({matches: true});
        act(() => root.render(createElement(Cats, {count: 3})));
        becomeVisible();
        await new Promise(r => setTimeout(r, 300)); // still frames redraw every 250 ms while loading
        expect(rafQueue.size).toBe(0);
        expect(draws.length).toBeGreaterThanOrEqual(3);
    });

    it('only loads `variety` different sheets', async () => {
        act(() => root.render(createElement(Cats, {count: 30, variety: 3})));
        becomeVisible();
        await frames(2);
        const sheets = new Set(draws.map(d => d.args[0]._src));
        expect(sheets.size).toBeLessThanOrEqual(3);
    });
});

describe('<Birds>', () => {
    it('draws birds at 2x scale, mirrored ones via a flipped transform', async () => {
        act(() => root.render(createElement(Birds, {count: 12})));
        becomeVisible();
        await frames(3);
        const last = draws.slice(-12);
        expect(last).toHaveLength(12);
        for (const {args} of last) {
            const [, sx, sy, sw, sh, , , dw, dh] = args;
            expect(sx + sw).toBeLessThanOrEqual(64);
            expect(sy + sh).toBeLessThanOrEqual(64);
            expect([dw, dh]).toEqual([32, 32]);
        }
    });

    it('respects the species filter', async () => {
        act(() => root.render(createElement(Birds, {count: 10, species: ['crow']})));
        becomeVisible();
        await frames(2);
        for (const d of draws) expect(d.args[0]._src).toMatch(/crow\.png$/);
    });
});

describe('stacked scenes', () => {
    it('a click that misses the birds reaches a cat underneath', async () => {
        const meow = vi.fn();
        const chirp = vi.fn();
        act(() => root.render(createElement('div', null,
            createElement(Cats, {count: 1, sound: meow}),
            createElement(Birds, {count: 1, sound: chirp}),
        )));
        const [catCanvas, birdCanvas] = host.querySelectorAll('canvas');
        becomeVisible();
        await frames(2);
        const catDraw = [...draws].reverse().find(d => d.canvas === catCanvas);
        const [, , , , , dx, dy] = catDraw.args;
        const x = dx + 48;
        const y = dy + 48;
        // jsdom has no layout: emulate the stack (birds on top, cats below)
        document.elementFromPoint = () => {
            if (birdCanvas.style.pointerEvents !== 'none') return birdCanvas;
            if (catCanvas.style.pointerEvents !== 'none') return catCanvas;
            return document.body;
        };
        const bird = [...draws].reverse().find(d => d.canvas === birdCanvas).args;
        const birdHit = x >= bird[5] && x < bird[5] + 32 && y >= bird[6] && y < bird[6] + 32;
        act(() => birdCanvas.dispatchEvent(new MouseEvent('click', {clientX: x, clientY: y})));
        if (birdHit) expect(chirp).toHaveBeenCalled();
        else {
            expect(chirp).not.toHaveBeenCalled();
            expect(meow).toHaveBeenCalledTimes(1);
        }
        expect(birdCanvas.style.pointerEvents).toBe('auto'); // restored after probing
    });
});
