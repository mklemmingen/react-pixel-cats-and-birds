/*
 * Bird simulation: pure logic, no DOM. Rendering lives in ../Birds.js.
 *
 * Sprite sheets ("Garden Birds || Pixel Asset Pack" by Pop Shop Packs) are 64x64:
 * 4 rows x 4 columns of 16px tiles, birds face west (left).
 *   row 0: flying (4 frames)
 *   row 1: standing, wings up, hit (col 3)
 *   row 2: hopping / pecking (4 frames)
 *   row 3: resting (4 frames)
 */

export const BIRD_TILE = 16;
export const BIRD_SHEET_SIZE = 64;

/** fps for the sprite cycle; speed in sprite-sizes per second */
export const BIRD_ANIMS = {
    flying: {row: 0, cols: [0, 1, 2, 3], fps: 10, speed: 70 / 32},
    pecking: {row: 2, cols: [0, 1, 2, 3], fps: 4, speed: 0},
    resting: {row: 3, cols: [0, 1, 2, 3], fps: 3, speed: 0},
    hit: {row: 1, cols: [3], fps: 1, speed: 0},
};

export function randomPoint(world, rng = Math.random) {
    return [
        rng() * Math.max(0, world.width - world.size),
        rng() * Math.max(0, world.height - world.size),
    ];
}

export function setBirdState(bird, state, timer = 0) {
    bird.state = state;
    bird.animTime = 0;
    bird.timer = timer;
}

export function takeOff(bird, world, rng = Math.random, speedFactor = 1) {
    [bird.tx, bird.ty] = randomPoint(world, rng);
    bird.speedFactor = speedFactor;
    setBirdState(bird, 'flying');
}

export function land(bird, rng = Math.random) {
    setBirdState(bird, rng() < 0.5 ? 'pecking' : 'resting', 3000 + rng() * 6000);
}

export function createBird(world, sheet, species, rng = Math.random) {
    const [x, y] = randomPoint(world, rng);
    const bird = {sheet, species, x, y, tx: x, ty: y, mirrored: rng() < 0.5, speedFactor: 1};
    if (rng() < 0.6) land(bird, rng);
    else takeOff(bird, world, rng);
    bird.animTime = rng() * 4;
    return bird;
}

export function currentBirdTile(bird) {
    const anim = BIRD_ANIMS[bird.state];
    const col = anim.cols[Math.floor(bird.animTime * anim.fps) % anim.cols.length];
    return [anim.row, col];
}

export function birdSourceRect(bird) {
    const [row, col] = currentBirdTile(bird);
    return {sx: col * BIRD_TILE, sy: row * BIRD_TILE, sw: BIRD_TILE, sh: BIRD_TILE};
}

export function stepBird(bird, dt, world, rng = Math.random) {
    bird.animTime += dt;
    const anim = BIRD_ANIMS[bird.state];
    if (anim.speed === 0) {
        bird.timer -= dt * 1000;
        if (bird.timer <= 0) {
            if (bird.state === 'hit') takeOff(bird, world, rng, 2.5);
            else if (rng() < 0.25) {
                setBirdState(bird, bird.state === 'pecking' ? 'resting' : 'pecking', 2000 + rng() * 4000);
            } else takeOff(bird, world, rng);
        }
        return;
    }
    const dx = bird.tx - bird.x;
    const dy = bird.ty - bird.y;
    const dist = Math.hypot(dx, dy);
    const move = anim.speed * world.size * bird.speedFactor * dt;
    if (Math.abs(dx) > 1) bird.mirrored = dx > 0; // sheet faces west; mirror to face east
    if (dist <= move) {
        bird.x = bird.tx;
        bird.y = bird.ty;
        land(bird, rng);
    } else {
        bird.x += (dx / dist) * move;
        bird.y += (dy / dist) * move;
    }
}

/** click reaction: short "hit" flinch, then the bird bolts at 2.5x speed */
export function scare(bird) {
    if (bird.state === 'hit') return false;
    setBirdState(bird, 'hit', 250);
    return true;
}

export function resizeBirdWorld(birds, world, newWidth, newHeight) {
    const sx = world.width ? newWidth / world.width : 1;
    const sy = world.height ? newHeight / world.height : 1;
    world.width = newWidth;
    world.height = newHeight;
    const maxX = Math.max(0, newWidth - world.size);
    const maxY = Math.max(0, newHeight - world.size);
    for (const b of birds) {
        b.x = Math.min(b.x * sx, maxX);
        b.y = Math.min(b.y * sy, maxY);
        b.tx = Math.min(b.tx * sx, maxX);
        b.ty = Math.min(b.ty * sy, maxY);
    }
}

export function birdAt(birds, px, py, size) {
    for (let i = birds.length - 1; i >= 0; i--) {
        const b = birds[i];
        if (b.sheet?.ready !== false && px >= b.x && px < b.x + size && py >= b.y && py < b.y + size) return b;
    }
    return null;
}
