/*
 * Synthesised bird calls, one per species in the Garden Birds sprite pack.
 *
 * Every call is a sequence of syllables. A syllable is a short note with:
 *   f      frequency contour in Hz (smoothly interpolated points)
 *   d      duration (s), gap: silence after it (s)
 *   tone   'pure' (sine + a little 2nd harmonic, songbirds) or 'harsh' (buzzy source through
 *          beak/throat resonances: crows, jays, magpies)
 *   h2,h3  harmonic levels for pure tones
 *   noise  0..1 breathy/rasp component
 *   trill  {rate Hz, depth Hz} fast frequency modulation
 *   buzz   {rate Hz, depth 0..1} fast amplitude modulation
 *   amp    relative level
 * Each play randomises pitch (±6%), tempo (±10%) and repetition counts.
 */

import {biquad, cachedWave, claimVoice, curve, noiseBuffer, rand, resolveTarget} from './engine.js';

const rep = (n, syl, gap) => Array.from({length: n}, () => ({...syl, gap}));
const between = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

/** species id (matches BIRD_SHEETS) -> (rng) => syllables */
export const BIRD_CALLS = {
    blueJay: rng => rep(between(rng, 2, 3),
        {f: [2900, 3100, 2300], d: 0.26, tone: 'harsh', noise: 0.45, amp: 0.9, formants: [2400, 3400, 5200]}, 0.11),

    cardinal: rng => [
        ...rep(between(rng, 3, 5), {f: [4300, 3400, 2100], d: 0.17, h2: 0.12, amp: 1}, 0.05),
        ...(rng() < 0.6 ? rep(between(rng, 3, 6), {f: [2300, 3600], d: 0.07, h2: 0.1, amp: 0.8}, 0.04) : []),
    ],

    cedarWaxwing: rng => rep(between(rng, 1, 3),
        {f: [7600, 7800, 7300], d: rand(rng, 0.45, 0.7), trill: {rate: 46, depth: 320}, amp: 0.45, h2: 0.05}, 0.18),

    chickadee: rng => [
        {f: [6800, 5600, 4200], d: 0.055, h2: 0.25, amp: 0.9, gap: 0.03},
        {f: [5200, 4600], d: 0.045, h2: 0.2, amp: 0.75, gap: 0.04},
        ...rep(between(rng, 2, 5),
            {f: [3900, 3750], d: 0.19, h2: 0.3, h3: 0.1, buzz: {rate: 140, depth: 0.55}, noise: 0.12, amp: 0.85}, 0.05),
    ],

    crow: rng => rep(between(rng, 2, 4),
        {f: [470, 600, 430], d: 0.3, tone: 'harsh', noise: 0.6, amp: 1, formants: [1100, 1650, 2600]},
        rand(rng, 0.18, 0.3)),

    houseFinch: rng => {
        const n = between(rng, 8, 12);
        const notes = [];
        for (let i = 0; i < n; i++) {
            const a = rand(rng, 2600, 5200);
            const b = a * rand(rng, 0.7, 1.35);
            notes.push({f: [a, (a + b) / 2 * rand(rng, 0.95, 1.1), b], d: rand(rng, 0.05, 0.1), h2: 0.15, amp: rand(rng, 0.6, 1), gap: rand(rng, 0.015, 0.05)});
        }
        notes.push({f: [4200, 2600], d: 0.2, h2: 0.2, buzz: {rate: 90, depth: 0.5}, amp: 0.8, gap: 0});
        return notes;
    },

    hummingbird: rng => rep(between(rng, 5, 9),
        {f: [6400, 5200], d: 0.025, h2: 0.1, amp: 0.55}, rand(rng, 0.04, 0.07)),

    magpie: rng => rep(between(rng, 6, 9),
        {f: [1900, 1600], d: 0.07, tone: 'harsh', noise: 0.75, amp: 0.85, formants: [1600, 2800, 4200]}, 0.045),

    redRobin: rng => {
        const phrases = between(rng, 2, 4);
        const notes = [];
        for (let p = 0; p < phrases; p++) {
            const lo = rand(rng, 2000, 2400);
            const hi = lo * rand(rng, 1.25, 1.5);
            notes.push({f: [lo, hi, lo * 1.1], d: rand(rng, 0.14, 0.2), h2: 0.2, amp: 1, gap: 0.05});
            notes.push({f: [hi * 0.95, lo], d: rand(rng, 0.12, 0.17), h2: 0.2, amp: 0.85, gap: rand(rng, 0.2, 0.35)});
        }
        return notes;
    },

    stellersJay: rng => rep(between(rng, 3, 5),
        {f: [1450, 1500, 1100], d: 0.18, tone: 'harsh', noise: 0.45, amp: 0.9, formants: [1300, 2300, 3600]}, 0.13),

    whiteDove: () => [
        {f: [430, 500, 470], d: 0.34, h2: 0.45, h3: 0.15, noise: 0.06, amp: 0.8, gap: 0.08, soft: true},
        {f: [480, 540, 500, 450], d: 0.62, h2: 0.45, h3: 0.15, noise: 0.06, amp: 1, gap: 0.12, soft: true},
        {f: [460, 430, 400], d: 0.45, h2: 0.4, h3: 0.12, noise: 0.06, amp: 0.75, gap: 0, soft: true},
    ],

    woodThrush: rng => [
        {f: [1800, 1850], d: 0.11, h2: 0.15, amp: 0.7, gap: 0.03, chorus: 1.5},
        {f: [2450, 2500], d: 0.12, h2: 0.15, amp: 0.85, gap: 0.03, chorus: 1.5},
        {f: [3250, 3150], d: 0.13, h2: 0.15, amp: 0.9, gap: 0.03, chorus: 1.5},
        {f: [4300, 4200], d: rand(rng, 0.3, 0.45), trill: {rate: 34, depth: 380}, h2: 0.1, amp: 0.7, gap: 0, chorus: 1.33},
    ],
};

export const CHIRP_SPECIES = Object.keys(BIRD_CALLS);

function interp(points) {
    return (t) => {
        const x = t * (points.length - 1);
        const i = Math.min(points.length - 2, Math.floor(x));
        const u = x - i;
        const e = (1 - Math.cos(Math.PI * u)) / 2;
        return points[i] + (points[i + 1] - points[i]) * e;
    };
}

function pureWave(ctx, h2 = 0.15, h3 = 0) {
    const a = Math.round(h2 * 20) / 20;
    const b = Math.round(h3 * 20) / 20;
    return cachedWave(ctx, `bird:${a}:${b}`, [1, a, b]);
}

function harshWave(ctx) {
    const amps = [];
    for (let k = 1; k <= 30; k++) amps.push((k % 2 ? 1 : 0.7) / Math.pow(k, 0.9));
    return cachedWave(ctx, 'bird:harsh', amps);
}

/** schedule one syllable; returns nodes to start/stop */
function syllable(ctx, out, s, t, pitchScale, rng) {
    const d = s.d;
    const sources = [];
    const env = ctx.createGain();
    env.gain.value = 0;
    const attack = s.soft ? 0.35 : 0.12;
    env.gain.setValueCurveAtTime(curve(48, (x) => {
        if (x < attack) return (1 - Math.cos(Math.PI * x / attack)) / 2;
        return Math.pow(Math.cos((Math.PI / 2) * (x - attack) / (1 - attack)), s.soft ? 1.2 : 1.8);
    }), t, d);

    const level = ctx.createGain();
    level.gain.value = (s.amp ?? 1) * 0.5;

    const freq = curve(48, interp(s.f.map(f => f * pitchScale)));
    const voices = s.chorus ? [1, s.chorus] : [1];
    voices.forEach((ratio, vi) => {
        const osc = ctx.createOscillator();
        if (s.tone === 'harsh') osc.setPeriodicWave(harshWave(ctx));
        else osc.setPeriodicWave(pureWave(ctx, s.h2, s.h3));
        osc.frequency.setValueCurveAtTime(ratio === 1 ? freq : freq.map(f => f * ratio), t, d);
        if (s.trill) {
            const lfo = ctx.createOscillator();
            lfo.frequency.value = s.trill.rate * rand(rng, 0.92, 1.08);
            const depth = ctx.createGain();
            depth.gain.value = s.trill.depth * pitchScale * ratio;
            lfo.connect(depth).connect(osc.frequency);
            sources.push(lfo);
        }
        const g = ctx.createGain();
        g.gain.value = vi === 0 ? 1 : 0.22; // the thrush's second voice is quieter
        osc.connect(g).connect(env);
        sources.push(osc);
    });

    if (s.noise) {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx);
        const band = biquad(ctx, 'bandpass', (s.f[0] * pitchScale) * (s.tone === 'harsh' ? 1.6 : 1), s.tone === 'harsh' ? 1.2 : 3);
        const ng = ctx.createGain();
        ng.gain.value = s.noise * (s.tone === 'harsh' ? 1.4 : 0.5);
        n.connect(band).connect(ng).connect(env);
        n.offset = rng() * 1.5;
        sources.push(n);
    }

    let tail = env;
    if (s.buzz) {
        const am = ctx.createGain();
        am.gain.value = 1 - s.buzz.depth;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = s.buzz.rate;
        const depth = ctx.createGain();
        depth.gain.value = s.buzz.depth;
        lfo.connect(depth).connect(am.gain);
        tail.connect(am);
        tail = am;
        sources.push(lfo);
    }

    if (s.tone === 'harsh') {
        // beak/throat resonances in parallel, summed
        const sum = ctx.createGain();
        (s.formants || [1200, 2400, 3600]).forEach((f, i) => {
            const bp = biquad(ctx, 'bandpass', f * pitchScale, 3 + i);
            const g = ctx.createGain();
            g.gain.value = [1.6, 1.1, 0.7][i];
            tail.connect(bp).connect(g).connect(sum);
        });
        tail = sum;
    } else if (s.soft) {
        const lp = biquad(ctx, 'lowpass', 1800, 0.7);
        tail.connect(lp);
        tail = lp;
    }

    tail.connect(level).connect(out);
    for (const src of sources) {
        if (src.buffer) src.start(t, src.offset || 0);
        else src.start(t);
        src.stop(t + d + 0.02);
    }
    return {sources, level};
}

/**
 * Play one call.
 * @param {string} [species] id from CHIRP_SPECIES (same ids as BIRD_SHEETS); omitted -> random
 * @param {{context?: BaseAudioContext, destination?: AudioNode, when?: number,
 *   rng?: () => number, gain?: number}} [options]
 * @returns {{start: number, duration: number, syllables: number} | null}
 */
export function playChirp(species, options = {}) {
    const target = resolveTarget(options);
    if (!target) return null;
    const rng = options.rng || Math.random;
    const id = species || CHIRP_SPECIES[Math.floor(rng() * CHIRP_SPECIES.length)];
    const make = BIRD_CALLS[id];
    if (!make) throw new Error(`Unknown bird species: ${species}`);

    const {ctx} = target;
    const bus = ctx.createGain();
    bus.gain.value = options.gain ?? 1;
    bus.connect(target.out);

    const pitchScale = rand(rng, 0.94, 1.06);
    const tempo = rand(rng, 0.9, 1.1);
    const sylls = make(rng);
    const start = Math.max(options.when ?? 0, ctx.currentTime + 0.01);
    let t = start;
    let last = null;
    for (const s of sylls) {
        const scaled = {...s, d: s.d * tempo};
        const nodes = syllable(ctx, bus, scaled, t, pitchScale, rng);
        last = nodes.sources[0];
        t += scaled.d + (s.gap ?? 0) * tempo;
    }
    const release = claimVoice(target);
    if (last) {
        last.onended = () => {
            release();
            bus.disconnect();
        };
    } else release();
    return {start, duration: t - start, syllables: sylls.length};
}
