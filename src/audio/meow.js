/*
 * Synthesised cat meows (source-filter model, Web Audio API, no audio files).
 *
 *   glottal source   band-limited pulse with adjustable spectral tilt, smooth pitch contour
 *                    (scoop -> rise -> hold -> fall), delayed vibrato, jitter and shimmer
 *   aspiration       band-passed breath noise that follows the voice, stronger at on/offset
 *   vocal tract      four moving formants for the "m-i-a-ow" vowel glide
 *   nasal tract      nasal murmur (pole ~280 Hz), moving anti-resonance (zero ~1-1.35 kHz)
 *                    and a nasal "twang" peak ~2.9 kHz
 *   lips             low-pass that opens for the "m" and closes at the end
 *   output           soft saturation, de-clicked envelope, shared limiter (engine.js)
 *
 * Presets were tuned by ear; parameters use the same scales as the tuner:
 *   nasal, bright, whine: 0-100   pitch: % (100 = ~480 Hz start)   length: centiseconds
 */

import {
    biquad, cachedWave, claimVoice, curve, noiseBuffer, rand, resolveTarget, shape, smoothNoise, softClipCurve,
} from './engine.js';

export const MEOW_PRESETS = {
    meow: {nasal: 70, bright: 70, pitch: 100, length: 75, whine: 40},
    kittenMew: {nasal: 60, bright: 80, pitch: 160, length: 40, whine: 30},
    whinyMeow: {nasal: 90, bright: 75, pitch: 115, length: 120, whine: 90},
    shortMew: {nasal: 75, bright: 65, pitch: 105, length: 32, whine: 10},
};

const PRESET_NAMES = Object.keys(MEOW_PRESETS);
const CURVE_POINTS = 96;
const HARMONICS = 40;

/** glottal pulse spectrum: 1/k^tilt roll-off with a soft open-quotient ripple */
function glottalWave(ctx, bright) {
    const tilt = Math.round((1.55 - 0.75 * bright) * 20) / 20; // quantised -> few cached waves
    const amps = [];
    for (let k = 1; k <= HARMONICS; k++) {
        const ripple = 0.75 + 0.25 * Math.abs(Math.cos(k * Math.PI * 0.62));
        amps.push(ripple / Math.pow(k, tilt));
    }
    return cachedWave(ctx, `glottal:${tilt}`, amps);
}

/**
 * Describe a meow without playing it: pitch/formant/envelope curves for given settings.
 * Exposed for tests and visualisation.
 */
export function meowContours(settings, rng = Math.random) {
    const P = settings;
    const dur = (P.length / 100) * rand(rng, 0.94, 1.06);
    const p = (P.pitch / 100) * rand(rng, 0.96, 1.04);
    const wh = P.whine / 100;
    const base = 480 * p;
    const top = base * (1.55 + 0.5 * wh);
    const peakAt = 0.3 + 0.15 * wh;
    const holdTo = Math.min(0.85, 0.38 + 0.2 * wh);

    const jitter = smoothNoise(CURVE_POINTS, rng, 0.8);
    const pitchShape = shape([
        [0, base * 0.9], [0.06, base], [peakAt, top], [holdTo, top * 0.98], [1, base * 0.79],
    ]);
    const pitch = curve(CURVE_POINTS, t => pitchShape(t) * (1 + 0.008 * jitter[Math.round(t * (CURVE_POINTS - 1))]));

    const shimmer = smoothNoise(CURVE_POINTS, rng, 0.7);
    const attack = Math.min(0.06, dur * 0.12) / dur;
    const env = curve(CURVE_POINTS, (t) => {
        let a;
        if (t < attack) a = (1 - Math.cos(Math.PI * t / attack)) / 2;
        else if (t < 0.62) a = 1;
        else a = Math.pow((1 - t) / 0.38, 1.6);
        return Math.max(0, a * (1 + 0.05 * shimmer[Math.round(t * (CURVE_POINTS - 1))]));
    });
    env[0] = 0;
    env[CURVE_POINTS - 1] = 0;

    const formants = [
        shape([[0, 600], [0.35, 1250], [1, 750]]),
        shape([[0, 1800], [0.3, 2400], [1, 1200]]),
        shape([[0, 3300], [0.4, 3700], [1, 3000]]),
    ].map(f => curve(CURVE_POINTS, f));
    const antiResonance = curve(CURVE_POINTS, shape([[0, 1000], [0.5, 1350], [1, 1100]]));

    return {dur, base, top, pitch, env, formants, antiResonance};
}

/**
 * Play one meow.
 * @param {object|string} [settings] preset name or {nasal, bright, pitch, length, whine};
 *   omitted -> random preset
 * @param {{context?: BaseAudioContext, destination?: AudioNode, when?: number, rng?: () => number,
 *   gain?: number}} [options] render into another (e.g. Offline) context
 * @returns {{start: number, duration: number} | null} null if audio is unavailable or busy
 */
export function playMeow(settings, options = {}) {
    const target = resolveTarget(options);
    if (!target) return null;
    const rng = options.rng || Math.random;
    const P = typeof settings === 'string'
        ? MEOW_PRESETS[settings]
        : settings || MEOW_PRESETS[PRESET_NAMES[Math.floor(rng() * PRESET_NAMES.length)]];
    if (!P) throw new Error(`Unknown meow preset: ${settings}`);

    const {ctx, out} = target;
    const t = Math.max(options.when ?? 0, ctx.currentTime + 0.01);
    const nas = P.nasal / 100;
    const br = P.bright / 100;
    const wh = P.whine / 100;
    const c = meowContours(P, rng);
    const dur = c.dur;
    const end = t + dur;

    // --- glottal source ---
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(glottalWave(ctx, br));
    osc.frequency.setValueCurveAtTime(c.pitch, t, dur);

    const vib = ctx.createOscillator();
    vib.frequency.value = rand(rng, 5, 7.5);
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.linearRampToValueAtTime(c.base * (0.012 + 0.03 * wh), t + dur * 0.55);
    vib.connect(vibDepth).connect(osc.frequency);

    const voice = ctx.createGain();
    voice.gain.value = 0.55;
    osc.connect(voice);

    // --- aspiration (breath) ---
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuffer(ctx);
    const breathBand = biquad(ctx, 'bandpass', 3800, 0.9);
    const breathGain = ctx.createGain();
    const breathAmt = 0.05 + 0.07 * br;
    breathGain.gain.setValueCurveAtTime(
        curve(32, x => breathAmt * (0.6 + 0.8 * Math.exp(-x * 12) + 0.6 * Math.max(0, x - 0.7) / 0.3)),
        t, dur,
    );
    breath.connect(breathBand).connect(breathGain);

    const src = ctx.createGain();
    voice.connect(src);
    breathGain.connect(src);

    // --- vocal tract: cascaded formant peaks ---
    const lowCut = biquad(ctx, 'highpass', 200, 0.7);
    const F1 = biquad(ctx, 'peaking', 900, 2.4, 11);
    const F2 = biquad(ctx, 'peaking', 2000, 3.2, 9);
    const F3 = biquad(ctx, 'peaking', 3600, 4.5, 6 + 6 * br);
    const F4 = biquad(ctx, 'peaking', 4700, 5, 3 + 4 * br);
    F1.frequency.setValueCurveAtTime(c.formants[0], t, dur);
    F2.frequency.setValueCurveAtTime(c.formants[1], t, dur);
    F3.frequency.setValueCurveAtTime(c.formants[2], t, dur);

    // --- nasal tract ---
    const murmur = biquad(ctx, 'peaking', 280, 2.5, 4 + 10 * nas);
    const twang = biquad(ctx, 'peaking', 2900, 5, 4 + 12 * nas);
    const shelf = biquad(ctx, 'highshelf', 3000, 0.7, -6 + 18 * br);
    const zero = biquad(ctx, 'notch', 1150, 3 + 5 * nas);
    zero.frequency.setValueCurveAtTime(c.antiResonance, t, dur);
    const zeroMix = ctx.createGain();
    zeroMix.gain.value = nas;
    const dryMix = ctx.createGain();
    dryMix.gain.value = 1 - nas;
    const tract = ctx.createGain();

    src.connect(lowCut).connect(F1).connect(F2).connect(F3).connect(F4)
        .connect(murmur).connect(twang).connect(shelf);
    shelf.connect(zero).connect(zeroMix).connect(tract);
    shelf.connect(dryMix).connect(tract);

    // --- lips: open for the "m", close at the end ---
    const lips = biquad(ctx, 'lowpass', 500, 0.6);
    lips.frequency.setValueCurveAtTime(curve(48, shape([
        [0, 450], [Math.min(0.25, (0.08 + 0.04 * nas) / dur), 11000], [0.78, 11000], [1, 2200],
    ])), t, dur);

    // --- saturation + envelope ---
    const drive = ctx.createGain();
    drive.gain.value = 0.55;
    const sat = ctx.createWaveShaper();
    sat.curve = softClipCurve(ctx, 1.8);
    sat.oversample = '2x';
    const env = ctx.createGain();
    env.gain.value = 0;
    env.gain.setValueCurveAtTime(c.env, t, dur);
    const level = ctx.createGain();
    level.gain.value = (options.gain ?? 1) * 0.42;

    tract.connect(lips).connect(drive).connect(sat).connect(env).connect(level).connect(out);

    const release = claimVoice(target);
    osc.start(t);
    vib.start(t);
    breath.start(t, rng() * Math.max(0, breath.buffer.duration - dur - 0.05));
    osc.stop(end + 0.02);
    vib.stop(end + 0.02);
    breath.stop(end + 0.02);
    osc.onended = () => {
        release();
        level.disconnect(); // frees the voice graph
    };
    return {start: t, duration: dur};
}
