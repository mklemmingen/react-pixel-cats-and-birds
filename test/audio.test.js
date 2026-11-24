/*
 * Renders every meow preset and every bird call offline (node-web-audio-api, a real Web Audio
 * implementation) and checks the result like a mix engineer would: no clipping, no clicks,
 * correct length, plausible pitch, brightness responding to its control, species in the right
 * frequency range.
 */
import {describe, expect, it} from 'vitest';
import {OfflineAudioContext} from 'node-web-audio-api';
import {MEOW_PRESETS, meowContours, playMeow} from '../src/audio/meow.js';
import {BIRD_CALLS, CHIRP_SPECIES, playChirp} from '../src/audio/chirp.js';
import {activeRange, centroid, dominant, loudestCenter, peak, pitchAt, rms, seeded, spectrum} from './helpers.js';

const SR = 44100;

async function render(fn, seconds) {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
    const info = fn(ctx);
    const buffer = await ctx.startRendering();
    return {data: buffer.getChannelData(0), info};
}

const renderMeow = (settings, seed = 1) =>
    render(ctx => playMeow(settings, {context: ctx, rng: seeded(seed), when: 0}), 2);

const renderChirp = (species, seed = 1) =>
    render(ctx => playChirp(species, {context: ctx, rng: seeded(seed), when: 0}), 6);

describe('meow synth', () => {
    for (const [name, preset] of Object.entries(MEOW_PRESETS)) {
        describe(name, () => {
            it('renders a clean, unclipped sound of the right length', async () => {
                for (const seed of [1, 2, 3]) {
                    const {data, info} = await renderMeow(preset, seed);
                    for (const v of data) expect(Number.isFinite(v)).toBe(true);
                    const p = peak(data);
                    expect(p).toBeGreaterThan(0.05); // audible
                    expect(p).toBeLessThan(0.98); // headroom, never clips
                    const [first, last] = activeRange(data, 2e-3);
                    const audible = (last - first) / SR;
                    expect(audible).toBeGreaterThan(info.duration * 0.75);
                    expect(audible).toBeLessThan(info.duration * 1.1 + 0.03);
                    expect(info.duration).toBeGreaterThan(preset.length / 100 * 0.9);
                    expect(info.duration).toBeLessThan(preset.length / 100 * 1.1);
                }
            });

            it('starts and ends without clicks', async () => {
                const {data, info} = await renderMeow(preset);
                const start = Math.floor(info.start * SR);
                const end = Math.floor((info.start + info.duration) * SR);
                const body = rms(data, start, end);
                expect(rms(data, start, start + 64)).toBeLessThan(body * 0.25); // soft onset
                expect(rms(data, end - 64, end + 64)).toBeLessThan(body * 0.25); // soft release
                // clicks are steps at the edges; the body legitimately has sharp glottal pulses
                const edge = Math.floor(0.005 * SR);
                let edgeJump = 0;
                for (const [a, b] of [[start, start + edge], [end - edge, end + edge]]) {
                    for (let i = Math.max(1, a); i < Math.min(data.length, b); i++) {
                        edgeJump = Math.max(edgeJump, Math.abs(data[i] - data[i - 1]));
                    }
                }
                expect(edgeJump).toBeLessThan(0.05);
            });

            it('has the planned pitch contour: rises to a peak, then falls', async () => {
                const {data, info} = await renderMeow(preset, 4);
                const c = meowContours(preset, seeded(4)); // same rng sequence -> same contour
                const at = frac => Math.floor((info.start + info.duration * frac) * SR);
                const fmax = Math.min(1600, c.top * 1.3);
                const early = pitchAt(data, SR, at(0.12), 200, fmax);
                const mid = pitchAt(data, SR, at(0.45), 200, fmax);
                const late = pitchAt(data, SR, at(0.85), 200, fmax);
                expect(mid.clarity).toBeGreaterThan(0.5); // clearly voiced
                expect(mid.freq).toBeGreaterThan(early.freq);
                expect(mid.freq).toBeGreaterThan(late.freq);
                expect(mid.freq).toBeGreaterThan(c.base * 1.05);
                expect(mid.freq).toBeLessThan(c.top * 1.15);
            });
        });
    }

    it('brightness raises the spectral centroid', async () => {
        const dull = await renderMeow({...MEOW_PRESETS.meow, bright: 10});
        const bright = await renderMeow({...MEOW_PRESETS.meow, bright: 95});
        const cd = centroid(spectrum(dull.data, SR, loudestCenter(dull.data)));
        const cb = centroid(spectrum(bright.data, SR, loudestCenter(bright.data)));
        expect(cb).toBeGreaterThan(cd * 1.15);
    });

    it('nasality adds energy around the nasal twang (2.9 kHz) relative to 1.2 kHz', async () => {
        const band = (s, f) => {
            const k = Math.round(f / s.binHz);
            let sum = 0;
            for (let i = k - 3; i <= k + 3; i++) sum += s.mags[i];
            return sum;
        };
        const ratio = async (nasal) => {
            const {data} = await renderMeow({...MEOW_PRESETS.meow, nasal});
            const s = spectrum(data, SR, loudestCenter(data));
            return band(s, 2900) / band(s, 1200);
        };
        expect(await ratio(95)).toBeGreaterThan(await ratio(5));
    });

    it('kitten mew is higher than the whiny meow', async () => {
        const k = await renderMeow('kittenMew', 7);
        const w = await renderMeow('whinyMeow', 7);
        const fk = pitchAt(k.data, SR, Math.floor((k.info.start + k.info.duration * 0.4) * SR), 200, 1600);
        const fw = pitchAt(w.data, SR, Math.floor((w.info.start + w.info.duration * 0.4) * SR), 200, 1600);
        expect(fk.freq).toBeGreaterThan(fw.freq);
    });

    it('rejects unknown presets', () => {
        const ctx = new OfflineAudioContext(1, SR, SR);
        expect(() => playMeow('purr', {context: ctx})).toThrow(/Unknown meow preset/);
    });
});

/** expected dominant frequency band per species (Hz) */
const RANGES = {
    blueJay: [1500, 6000],
    cardinal: [1800, 5000],
    cedarWaxwing: [6000, 9500],
    chickadee: [3000, 8000],
    crow: [350, 3500],
    houseFinch: [2000, 7000],
    hummingbird: [4500, 8000],
    magpie: [1000, 5000],
    redRobin: [1800, 5000],
    stellersJay: [800, 4000],
    whiteDove: [350, 1200],
    woodThrush: [1500, 6000],
};

describe('bird call synth', () => {
    it('has a frequency range for every species', () => {
        expect(Object.keys(RANGES).sort()).toEqual([...CHIRP_SPECIES].sort());
    });

    for (const species of Object.keys(BIRD_CALLS)) {
        it(`${species}: clean, unclipped, in the species' frequency range`, async () => {
            for (const seed of [1, 2]) {
                const {data, info} = await renderChirp(species, seed);
                for (const v of data) expect(Number.isFinite(v)).toBe(true);
                const p = peak(data);
                expect(p).toBeGreaterThan(0.03);
                expect(p).toBeLessThan(0.98);
                expect(info.duration).toBeGreaterThan(0.1);
                expect(info.duration).toBeLessThan(4);
                const [, last] = activeRange(data, 2e-3);
                expect(last / SR).toBeLessThan(info.start + info.duration + 0.1); // nothing rings on
                const f = dominant(spectrum(data, SR, loudestCenter(data, 1024), 1024), 200);
                const [lo, hi] = RANGES[species];
                expect(f, `${species} dominant ${Math.round(f)} Hz`).toBeGreaterThan(lo);
                expect(f, `${species} dominant ${Math.round(f)} Hz`).toBeLessThan(hi);
            }
        });
    }

    it('varies between plays (no two calls identical)', async () => {
        const a = await renderChirp('houseFinch', 1);
        const b = await renderChirp('houseFinch', 2);
        expect(a.info.duration).not.toBeCloseTo(b.info.duration, 3);
    });

    it('rejects unknown species', () => {
        const ctx = new OfflineAudioContext(1, SR, SR);
        expect(() => playChirp('parrot', {context: ctx})).toThrow(/Unknown bird species/);
    });
});
