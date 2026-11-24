/*
 * Cat simulation: pure logic, no DOM. Rendering lives in ../Cats.js.
 *
 * Sprite sheets ("Cats || Pixel Asset Pack" by Pop Shop Packs) are 768x512 with 32x32 tiles:
 *   - 8 bands of 64px (2 tile rows), one per facing, top to bottom: S, SW, W, NW, N, NE, E, SE
 *   - 6 blocks of 128px (4 tile columns), each block holds two animations (top / bottom row)
 */

export const CAT_TILE = 32;
export const CAT_SHEET_WIDTH = 768;
export const CAT_SHEET_HEIGHT = 512;
export const SPRITE_FPS = 8;

export const DIRECTIONS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

// screen-space octant (0 = east, clockwise because y points down) -> sheet band
export const OCTANT_TO_BAND = [6, 7, 0, 1, 2, 3, 4, 5];

/** looping movement cycles; speed in sprite-tiles per second (scaled by cat size) */
export const MOVES = {
    walking: {block: 4, row: 0, frames: 4, speed: 28 / 96},
    running: {block: 5, row: 0, frames: 4, speed: 80 / 96},
};

const seq = (block, row, cols) => cols.map(col => [block, row, col]);
export const SIT_DOWN = [...seq(0, 0, [0, 1, 2, 3]), ...seq(0, 1, [0, 1])];
export const LOOK_AROUND = [...seq(1, 0, [0, 1, 2, 3]), ...seq(1, 1, [0])];
export const LIE_DOWN = [...seq(2, 0, [0, 1, 2, 3]), ...seq(2, 1, [0, 1, 2, 3])];

/**
 * Idle poses are transitions, not loops: play forward on entry, freeze on the last tile
 * for the wait, then play backwards to stand up again before walking off.
 */
export const IDLES = [
    {name: 'sit', tiles: SIT_DOWN, weight: 2},
    {name: 'look', tiles: [...SIT_DOWN, ...LOOK_AROUND], weight: 1},
    {name: 'lie', tiles: [...SIT_DOWN, ...LIE_DOWN], weight: 2},
];

const IDLE_WEIGHT = IDLES.reduce((s, i) => s + i.weight, 0);

export function pickIdle(rng = Math.random) {
    let r = rng() * IDLE_WEIGHT;
    for (const idle of IDLES) {
        r -= idle.weight;
        if (r < 0) return idle;
    }
    return IDLES[0];
}

export function bandForVector(dx, dy) {
    const octant = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    return OCTANT_TO_BAND[octant];
}

/**
 * Where cats may stand. `avoidCenter` keeps them to the outer quarters so they don't sit
 * under a centred text column.
 */
export function randomPoint(world, rng = Math.random) {
    const {width, height, size, avoidCenter} = world;
    const maxX = Math.max(0, width - size);
    const maxY = Math.max(0, height - size);
    let x;
    if (avoidCenter) {
        const quarter = Math.max(0, width * 0.25 - size);
        x = rng() < 0.5 ? rng() * quarter : maxX - rng() * quarter;
    } else {
        x = rng() * maxX;
    }
    return [Math.max(0, Math.min(x, maxX)), rng() * maxY];
}

export function setIdle(cat, rng = Math.random, phase = 'enter') {
    const idle = pickIdle(rng);
    cat.state = 'idle';
    cat.idle = idle.tiles;
    cat.idleName = idle.name;
    cat.phase = phase;
    cat.animTime = 0;
    cat.timer = 2500 + rng() * 5000;
}

export function setMoving(cat, world, state, rng = Math.random) {
    cat.state = state;
    cat.phase = null;
    cat.animTime = 0;
    [cat.tx, cat.ty] = randomPoint(world, rng);
}

export function createCat(world, sheet, rng = Math.random) {
    const [x, y] = randomPoint(world, rng);
    const cat = {
        sheet, x, y, tx: x, ty: y,
        band: Math.floor(rng() * 8),
        state: 'walking', idle: null, idleName: null, phase: null,
        animTime: rng(), timer: 0, startled: false,
    };
    // half the cats begin already settled so the page doesn't open with all of them sitting down
    if (rng() < 0.5) setIdle(cat, rng, 'hold');
    else setMoving(cat, world, 'walking', rng);
    return cat;
}

/** [block, row, column] of the tile to draw now */
export function currentTile(cat) {
    const n = Math.floor(cat.animTime * SPRITE_FPS);
    if (cat.state !== 'idle') {
        const move = MOVES[cat.state];
        return [move.block, move.row, n % move.frames];
    }
    const tiles = cat.idle;
    const last = tiles.length - 1;
    if (cat.phase === 'enter') return tiles[Math.min(n, last)];
    if (cat.phase === 'exit') return tiles[Math.max(last - n, 0)];
    return tiles[last];
}

/** source rectangle in the sprite sheet for the current frame */
export function sourceRect(cat) {
    const [block, row, col] = currentTile(cat);
    return {
        sx: block * 128 + col * CAT_TILE,
        sy: cat.band * 64 + row * CAT_TILE,
        sw: CAT_TILE,
        sh: CAT_TILE,
    };
}

export function stepCat(cat, dt, world, rng = Math.random) {
    cat.animTime += cat.startled ? dt * 2 : dt;
    if (cat.state === 'idle') {
        const played = Math.floor(cat.animTime * SPRITE_FPS);
        if (cat.phase === 'enter' && played >= cat.idle.length) {
            cat.phase = 'hold';
            cat.animTime = 0;
        } else if (cat.phase === 'hold') {
            cat.timer -= dt * 1000;
            if (cat.timer <= 0) {
                cat.phase = 'exit';
                cat.animTime = 0;
            }
        } else if (cat.phase === 'exit' && played >= cat.idle.length) {
            setMoving(cat, world, cat.startled || rng() < 0.3 ? 'running' : 'walking', rng);
            cat.startled = false;
        }
        return;
    }
    const dx = cat.tx - cat.x;
    const dy = cat.ty - cat.y;
    const dist = Math.hypot(dx, dy);
    const step = MOVES[cat.state].speed * world.size * dt;
    if (dist <= step) {
        cat.x = cat.tx;
        cat.y = cat.ty;
        setIdle(cat, rng);
        return;
    }
    cat.band = bandForVector(dx, dy);
    cat.x += (dx / dist) * step;
    cat.y += (dy / dist) * step;
}

/** Click reaction: moving cats bolt; idle cats get up (from their current pose, 2x speed) then run. */
export function startle(cat, world, rng = Math.random) {
    if (cat.state !== 'idle') {
        setMoving(cat, world, 'running', rng);
        return;
    }
    if (cat.startled && cat.phase === 'exit') return;
    const last = cat.idle.length - 1;
    const n = Math.floor(cat.animTime * SPRITE_FPS);
    let shown;
    if (cat.phase === 'enter') shown = Math.min(n, last);
    else if (cat.phase === 'hold') shown = last;
    else shown = Math.max(last - n, 0);
    cat.phase = 'exit';
    cat.animTime = (last - shown) / SPRITE_FPS;
    cat.startled = true;
}

/** rescale positions after the area changed size */
export function resizeWorld(cats, world, newWidth, newHeight) {
    const sx = world.width ? newWidth / world.width : 1;
    const sy = world.height ? newHeight / world.height : 1;
    world.width = newWidth;
    world.height = newHeight;
    const maxX = Math.max(0, newWidth - world.size);
    const maxY = Math.max(0, newHeight - world.size);
    for (const c of cats) {
        c.x = Math.min(c.x * sx, maxX);
        c.y = Math.min(c.y * sy, maxY);
        c.tx = Math.min(c.tx * sx, maxX);
        c.ty = Math.min(c.ty * sy, maxY);
    }
}

export function catAt(cats, px, py, size) {
    for (let i = cats.length - 1; i >= 0; i--) {
        const c = cats[i];
        if (c.sheet?.ready !== false && px >= c.x && px < c.x + size && py >= c.y && py < c.y + size) return c;
    }
    return null;
}
