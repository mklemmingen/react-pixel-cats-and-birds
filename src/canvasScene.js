/*
 * Framework-free canvas scene runner used by <Cats> and <Birds>.
 *
 *  - backing store in CSS pixels (pixel art is upscaled with `image-rendering: pixelated`,
 *    a devicePixelRatio store would only cost 4x memory)
 *  - backing store released (0x0) and loop stopped while the canvas is off-screen
 *  - ResizeObserver keeps the world in sync with layout, IntersectionObserver pauses
 *  - frame rate capped, dt clamped so a background tab doesn't teleport sprites
 *  - prefers-reduced-motion: draws still frames only
 *  - clicks that miss every sprite are forwarded to another pixel scene stacked underneath
 */

export const SCENE_ATTR = 'data-pixel-scene';

const imageCache = new Map();

/** shared image loader: {img, ready}. Failed images stay not-ready and are simply skipped. */
export function loadImage(url) {
    let entry = imageCache.get(url);
    if (!entry) {
        const img = new Image();
        entry = {img, ready: false, failed: false};
        img.decoding = 'async';
        img.onload = () => {
            entry.ready = true;
        };
        img.onerror = () => {
            entry.failed = true;
        };
        img.src = url;
        imageCache.set(url, entry);
    }
    return entry;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   spawn(world): void, step(dt): void, draw(ctx): void, resize(width, height): void,
 *   hit(x, y): any, onHit(entity): void, interactive: boolean, maxFps: number,
 * }} scene
 * @returns {() => void} dispose
 */
export function runScene(canvas, scene) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    canvas.setAttribute(SCENE_ATTR, '');

    const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const frameMs = 1000 / (scene.maxFps || 30);
    let spawned = false;
    let width = 0;
    let height = 0;
    let visible = false;
    let rafId = 0;
    let timerId = 0;
    let last = 0;
    let disposed = false;

    const applySize = () => {
        const w = visible ? Math.round(canvas.clientWidth) : 0;
        const h = visible ? Math.round(canvas.clientHeight) : 0;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        ctx.imageSmoothingEnabled = false; // reset by every size change
        if (!w || !h) return;
        if (!spawned) {
            width = w;
            height = h;
            scene.spawn(w, h);
            spawned = true;
        } else if (w !== width || h !== height) {
            width = w;
            height = h;
            scene.resize(w, h);
        }
    };

    const draw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        scene.draw(ctx);
    };

    const frame = (now) => {
        rafId = 0;
        if (!visible || !spawned || disposed) return;
        if (last && now - last < frameMs - 1) {
            rafId = requestAnimationFrame(frame);
            return;
        }
        const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        scene.step(dt);
        draw();
        rafId = requestAnimationFrame(frame);
    };

    const start = () => {
        if (!visible || !spawned || disposed) return;
        if (reducedMotion) {
            // still picture; redraw a few times while sprite sheets finish loading
            clearTimeout(timerId);
            let n = 0;
            const still = () => {
                timerId = 0;
                if (!visible || disposed) return;
                draw();
                if (++n < 12) timerId = setTimeout(still, 250);
            };
            still();
            return;
        }
        if (rafId) return;
        last = 0;
        rafId = requestAnimationFrame(frame);
    };

    const stop = () => {
        if (rafId) cancelAnimationFrame(rafId);
        if (timerId) clearTimeout(timerId);
        rafId = 0;
        timerId = 0;
    };

    const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        applySize();
        if (visible) start();
        else stop();
    }, {rootMargin: '200px'});
    io.observe(canvas);

    const ro = new ResizeObserver(() => {
        applySize();
        start();
    });
    ro.observe(canvas);

    // --- interaction ---
    const local = (e) => {
        const r = canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    };

    // Find another pixel scene under the pointer. Every scene already visited by this event
    // is made click-through while probing, so forwarding can never bounce back up.
    const sceneBelow = (e) => {
        const visited = [...(e.pixelSceneVisited || []), canvas];
        const prev = visited.map(el => el.style.pointerEvents);
        visited.forEach(el => {
            el.style.pointerEvents = 'none';
        });
        const el = document.elementFromPoint?.(e.clientX, e.clientY);
        visited.forEach((v, i) => {
            v.style.pointerEvents = prev[i];
        });
        return el && el.hasAttribute?.(SCENE_ATTR) && !visited.includes(el) ? {el, visited} : null;
    };

    const forward = (type, e) => {
        const below = sceneBelow(e);
        if (!below) return null;
        const ev = new MouseEvent(type, e);
        ev.pixelSceneVisited = below.visited;
        below.el.dispatchEvent(ev);
        return below.el;
    };

    const onMove = (e) => {
        let cursor = '';
        if (spawned && scene.hit(...local(e))) cursor = 'pointer';
        else {
            const below = forward('mousemove', e);
            if (below) cursor = below.style.cursor;
        }
        if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    };

    const onClick = (e) => {
        const entity = spawned ? scene.hit(...local(e)) : null;
        if (entity) {
            scene.onHit(entity);
            if (reducedMotion) draw();
            return;
        }
        forward('click', e);
    };

    if (scene.interactive) {
        canvas.style.pointerEvents = 'auto';
        canvas.addEventListener('mousemove', onMove, {passive: true});
        canvas.addEventListener('click', onClick);
    } else {
        canvas.style.pointerEvents = 'none';
    }

    return () => {
        disposed = true;
        stop();
        io.disconnect();
        ro.disconnect();
        canvas.removeEventListener('mousemove', onMove);
        canvas.removeEventListener('click', onClick);
        canvas.removeAttribute(SCENE_ATTR);
        canvas.width = 0;
        canvas.height = 0;
    };
}
