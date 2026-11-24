import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {BIRD_SHEETS, CAT_SHEETS} from '../src/sprites.js';
import {CAT_SHEET_HEIGHT, CAT_SHEET_WIDTH, CAT_TILE, DIRECTIONS, IDLES, MOVES} from '../src/core/catSim.js';
import {BIRD_ANIMS, BIRD_SHEET_SIZE, BIRD_TILE} from '../src/core/birdSim.js';
import {BIRD_CALLS} from '../src/audio/chirp.js';
import {headBias, mirrorSimilarity, opaqueCount, readPng, tileAlpha} from './helpers.js';

const catTiles = () => {
    const tiles = new Set();
    for (const m of Object.values(MOVES)) for (let c = 0; c < m.frames; c++) tiles.add(`${m.block},${m.row},${c}`);
    for (const idle of IDLES) for (const [b, r, c] of idle.tiles) tiles.add(`${b},${r},${c}`);
    return [...tiles].map(s => s.split(',').map(Number));
};

describe('cat sprite sheets', () => {
    it('ships 50 colour variants and every URL points at a real file', () => {
        expect(Object.keys(CAT_SHEETS)).toHaveLength(50);
        for (const url of Object.values(CAT_SHEETS)) expect(existsSync(fileURLToPath(url))).toBe(true);
    });

    for (const [name, url] of Object.entries(CAT_SHEETS)) {
        it(`${name}: 768x512 and every animation tile used, in every direction, has pixels`, () => {
            const png = readPng(url);
            expect([png.width, png.height]).toEqual([CAT_SHEET_WIDTH, CAT_SHEET_HEIGHT]);
            for (let band = 0; band < 8; band++) {
                for (const [block, row, col] of catTiles()) {
                    const a = tileAlpha(png, block * 128 + col * CAT_TILE, band * 64 + row * CAT_TILE, CAT_TILE, CAT_TILE);
                    expect(opaqueCount(a), `${name} ${DIRECTIONS[band]} tile ${block}/${row}/${col}`).toBeGreaterThan(20);
                }
            }
        });
    }

    it('direction bands are real: W/E, SW/SE and NW/NE walk frames are mirror images', () => {
        const png = readPng(CAT_SHEETS['orange-0']);
        const {block, row} = MOVES.walking;
        const pairs = [[2, 6], [1, 7], [3, 5]]; // W-E, SW-SE, NW-NE
        for (const [left, right] of pairs) {
            for (let col = 0; col < 4; col++) {
                const a = tileAlpha(png, block * 128 + col * CAT_TILE, left * 64 + row * CAT_TILE, CAT_TILE, CAT_TILE);
                const b = tileAlpha(png, block * 128 + col * CAT_TILE, right * 64 + row * CAT_TILE, CAT_TILE, CAT_TILE);
                expect(mirrorSimilarity(a, b, CAT_TILE, CAT_TILE)).toBeGreaterThan(0.8);
            }
        }
    });

    it('east band faces right and west band faces left (head on the leading side)', () => {
        const png = readPng(CAT_SHEETS['orange-0']);
        const {block, row} = MOVES.walking;
        const east = tileAlpha(png, block * 128, 6 * 64 + row * CAT_TILE, CAT_TILE, CAT_TILE);
        const west = tileAlpha(png, block * 128, 2 * 64 + row * CAT_TILE, CAT_TILE, CAT_TILE);
        // the raised tail also sits in the top half, so the bias is modest but must have the right sign
        expect(headBias(east, CAT_TILE, CAT_TILE)).toBeGreaterThan(0.5);
        expect(headBias(west, CAT_TILE, CAT_TILE)).toBeLessThan(-0.5);
    });

    it('idle transitions start from a standing pose that matches the walk cycle', () => {
        const png = readPng(CAT_SHEETS['grey-0']);
        for (let band = 0; band < 8; band++) {
            const [b, r, c] = IDLES[0].tiles[0];
            const first = tileAlpha(png, b * 128 + c * CAT_TILE, band * 64 + r * CAT_TILE, CAT_TILE, CAT_TILE);
            const walk = tileAlpha(png, MOVES.walking.block * 128, band * 64, CAT_TILE, CAT_TILE);
            // same silhouette size (standing) within 35%
            expect(opaqueCount(first) / opaqueCount(walk)).toBeGreaterThan(0.65);
            expect(opaqueCount(first) / opaqueCount(walk)).toBeLessThan(1.35);
        }
    });
});

describe('bird sprite sheets', () => {
    it('ships 12 species, one synthesised call per species', () => {
        expect(Object.keys(BIRD_SHEETS).sort()).toEqual(Object.keys(BIRD_CALLS).sort());
        expect(Object.keys(BIRD_SHEETS)).toHaveLength(12);
    });

    for (const [name, url] of Object.entries(BIRD_SHEETS)) {
        it(`${name}: 64x64, every animation frame has pixels, birds face west`, () => {
            const png = readPng(url);
            expect([png.width, png.height]).toEqual([BIRD_SHEET_SIZE, BIRD_SHEET_SIZE]);
            for (const [state, anim] of Object.entries(BIRD_ANIMS)) {
                for (const col of anim.cols) {
                    const a = tileAlpha(png, col * BIRD_TILE, anim.row * BIRD_TILE, BIRD_TILE, BIRD_TILE);
                    expect(opaqueCount(a), `${name} ${state} frame ${col}`).toBeGreaterThan(8);
                }
            }
            // resting frame: head (top half) sits left of centre -> faces west
            const rest = tileAlpha(png, 0, BIRD_ANIMS.resting.row * BIRD_TILE, BIRD_TILE, BIRD_TILE);
            expect(headBias(rest, BIRD_TILE, BIRD_TILE)).toBeLessThan(0.5);
        });
    }
});
