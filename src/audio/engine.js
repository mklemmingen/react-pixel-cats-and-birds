/*
 * Shared Web Audio plumbing for the meow and chirp synths.
 *
 * One AudioContext per page, created lazily on the first sound (browsers only allow audio
 * after a user gesture). Every voice goes through a master chain:
 *   voices -> low cut 70 Hz -> glue compressor -> brick-wall limiter -> master volume
 * so overlapping clicks never clip.
 *
 * All synth functions also accept `{context, destination}` so they can render into an
 * OfflineAudioContext (tests, exporting WAVs).
 */

let shared = null;
let volume = 0.8;
let muted = false;

function buildMaster(ctx) {
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.value = 70;
    lowCut.Q.value = 0.7;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 3;
    glue.attack.value = 0.005;
    glue.release.value = 0.15;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;

    const gain = ctx.createGain();
    gain.gain.value = muted ? 0 : volume;

    lowCut.connect(glue).connect(limiter).connect(gain).connect(ctx.destination);
    return {input: lowCut, gain};
}

/** Lazily create the page-wide context. Returns null where Web Audio is unavailable (SSR). */
export function getAudio() {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!shared) {
        const ctx = new Ctx({latencyHint: 'interactive'});
        shared = {ctx, ...buildMaster(ctx), voices: 0};
    }
    if (shared.ctx.state === 'suspended') shared.ctx.resume().catch(() => {});
    return shared;
}

/** 0..1 master volume for all synthesised sounds */
export function setVolume(value) {
    volume = Math.max(0, Math.min(1, value));
    if (shared) shared.gain.gain.setTargetAtTime(muted ? 0 : volume, shared.ctx.currentTime, 0.02);
}

export function setMuted(value) {
    muted = !!value;
    setVolume(volume);
}

export const MAX_VOICES = 6;

/**
 * Resolve where a voice should play. Returns null when audio is unavailable or the polyphony
 * limit is reached (extra clicks are dropped instead of piling up).
 */
export function resolveTarget(options = {}) {
    if (options.context) {
        return {ctx: options.context, out: options.destination || options.context.destination, shared: null};
    }
    const audio = getAudio();
    if (!audio || audio.voices >= MAX_VOICES) return null;
    return {ctx: audio.ctx, out: audio.input, shared: audio};
}

/** Register a voice for polyphony accounting; call the returned fn when it has ended. */
export function claimVoice(target) {
    if (!target.shared) return () => {};
    target.shared.voices++;
    let released = false;
    return () => {
        if (!released) {
            released = true;
            target.shared.voices--;
        }
    };
}

/* ---------- small DSP helpers ---------- */

const noiseCache = new WeakMap();

/** 2 s of white noise per context, shared by all voices (played from random offsets). */
export function noiseBuffer(ctx) {
    let buf = noiseCache.get(ctx);
    if (!buf) {
        const len = Math.floor(ctx.sampleRate * 2);
        buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        let seed = 0x9e3779b9;
        for (let i = 0; i < len; i++) {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            d[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
        }
        noiseCache.set(ctx, buf);
    }
    return buf;
}

const waveCache = new WeakMap();

/** PeriodicWave from harmonic amplitudes, cached per context + key */
export function cachedWave(ctx, key, amps) {
    let map = waveCache.get(ctx);
    if (!map) {
        map = new Map();
        waveCache.set(ctx, map);
    }
    let wave = map.get(key);
    if (!wave) {
        const n = amps.length + 1;
        const real = new Float32Array(n);
        const imag = new Float32Array(n);
        for (let k = 1; k < n; k++) imag[k] = amps[k - 1];
        wave = ctx.createPeriodicWave(real, imag);
        map.set(key, wave);
    }
    return wave;
}

const shaperCache = new WeakMap();

/** gentle tanh saturation curve (adds warmth, tames peaks) */
export function softClipCurve(ctx, drive = 1.6) {
    let map = shaperCache.get(ctx);
    if (!map) {
        map = new Map();
        shaperCache.set(ctx, map);
    }
    const key = Math.round(drive * 100);
    let curve = map.get(key);
    if (!curve) {
        const n = 2048;
        curve = new Float32Array(n);
        const norm = Math.tanh(drive);
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1;
            curve[i] = Math.tanh(x * drive) / norm;
        }
        map.set(key, curve);
    }
    return curve;
}

export function biquad(ctx, type, frequency, Q = 0.7, gain = 0) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    f.gain.value = gain;
    return f;
}

/** sample a function on [0,1] into a Float32Array for setValueCurveAtTime */
export function curve(points, fn) {
    const out = new Float32Array(points);
    for (let i = 0; i < points; i++) out[i] = fn(i / (points - 1));
    return out;
}

/** smooth random walk in [-1, 1] (for jitter / shimmer), deterministic given rng */
export function smoothNoise(points, rng, smoothing = 0.85) {
    const out = new Float32Array(points);
    let v = 0;
    for (let i = 0; i < points; i++) {
        v = v * smoothing + (rng() * 2 - 1) * (1 - smoothing);
        out[i] = v;
    }
    let max = 1e-9;
    for (const x of out) max = Math.max(max, Math.abs(x));
    for (let i = 0; i < points; i++) out[i] /= max;
    return out;
}

/** piecewise-linear through [[t, v], ...] with t in [0,1], smoothed with cosine easing */
export function shape(pointsTV) {
    return (t) => {
        if (t <= pointsTV[0][0]) return pointsTV[0][1];
        for (let i = 1; i < pointsTV.length; i++) {
            const [t1, v1] = pointsTV[i];
            const [t0, v0] = pointsTV[i - 1];
            if (t <= t1) {
                const u = (t - t0) / Math.max(1e-9, t1 - t0);
                const e = (1 - Math.cos(Math.PI * u)) / 2;
                return v0 + (v1 - v0) * e;
            }
        }
        return pointsTV[pointsTV.length - 1][1];
    };
}

export const rand = (rng, a, b) => a + rng() * (b - a);
