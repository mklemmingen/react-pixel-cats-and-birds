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

const INTERACTIVE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'details',
    'video', 'audio', 'iframe', 'object', 'embed',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="tab"]', '[role="menuitem"]',
    '[contenteditable]:not([contenteditable="false"])', '[onclick]',
].join(',');
const MEDIA = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'PICTURE', 'IFRAME', 'OBJECT', 'EMBED']);

function alpha(color) {
    if (!color || color === 'transparent') return 0;
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const a = parts[3];
    return a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
}

function paints(style) {
    return alpha(style.backgroundColor) > 0.05 || (style.backgroundImage && style.backgroundImage !== 'none');
}

/** true when nothing between `target` and the element that contains `canvas` hides it */
export function isSeeThrough(target, canvas) {
    if (!(target instanceof Element)) return false;
    if (target.closest(INTERACTIVE)) return false;
    for (let el = target; el && !el.contains(canvas); el = el.parentElement) {
        if (MEDIA.has(el.tagName.toUpperCase())) return false;
        const style = getComputedStyle(el);
        if (paints(style)) return false;
        // cards often paint their background with a pseudo-element
        for (const pseudo of ['::before', '::after']) {
            const ps = getComputedStyle(el, pseudo);
            if (ps.content && ps.content !== 'none' && ps.content !== 'normal' && paints(ps)) return false;
        }
    }
    return true;
}

// pointer cursor on <html> while hovering a sprite through content; one scene owns it at a time
let cursorOwner = null;

function setRootCursor(owner, on) {
    const root = document.documentElement;
    if (on) {
        if (cursorOwner !== owner) {
            cursorOwner = owner;
            root.style.cursor = 'pointer';
        }
    } else if (cursorOwner === owner) {
        cursorOwner = null;
        root.style.cursor = '';
    }
}

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

    // Content often sits on top of the canvas (a hero wrapper, a full-width section). A click
    // that lands on such content still reaches a sprite underneath when everything between the
    // click target and the canvas is see-through (no background, not a link/button/field/media).
    const inRect = (e) => {
        const r = canvas.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    };
    const throughContent = (e) => {
        if (!visible || !spawned || disposed) return null;
        const target = e.target;
        if (!target || target === canvas || target.hasAttribute?.(SCENE_ATTR)) return null;
        if (!inRect(e)) return null;
        const entity = scene.hit(...local(e)); // cheap test first
        if (!entity || !isSeeThrough(target, canvas)) return null;
        return entity;
    };

    const onDocMove = (e) => {
        setRootCursor(canvas, !!throughContent(e));
    };

    const onDocClick = (e) => {
        if (e.pixelSceneHandled || e.defaultPrevented || e.button !== 0) return;
        if (window.getSelection?.()?.toString()) return; // user was selecting text
        const entity = throughContent(e);
        if (!entity) return;
        e.pixelSceneHandled = true; // one sprite per click when scenes overlap
        scene.onHit(entity);
        if (reducedMotion) draw();
    };

    if (scene.interactive) {
        canvas.style.pointerEvents = 'auto';
        canvas.addEventListener('mousemove', onMove, {passive: true});
        canvas.addEventListener('click', onClick);
        document.addEventListener('mousemove', onDocMove, {passive: true});
        document.addEventListener('click', onDocClick);
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
        document.removeEventListener('mousemove', onDocMove);
        document.removeEventListener('click', onDocClick);
        setRootCursor(canvas, false);
        canvas.removeAttribute(SCENE_ATTR);
        canvas.width = 0;
        canvas.height = 0;
    };
}
