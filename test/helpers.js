import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';

/** deterministic PRNG (mulberry32) so simulations and synths are reproducible */
export function seeded(seed = 1) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function readPng(url) {
    return PNG.sync.read(readFileSync(fileURLToPath(url)));
}

/** alpha values of a tile, row-major */
export function tileAlpha(png, sx, sy, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            out[y * w + x] = png.data[((sy + y) * png.width + (sx + x)) * 4 + 3];
        }
    }
    return out;
}

export const opaqueCount = (alpha) => alpha.reduce((n, a) => n + (a > 0 ? 1 : 0), 0);

/** fraction of pixels where tile A equals the horizontal mirror of tile B (alpha mask) */
export function mirrorSimilarity(a, b, w, h) {
    let same = 0;
    let total = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const pa = a[y * w + x] > 0;
            const pb = b[y * w + (w - 1 - x)] > 0;
            if (pa || pb) {
                total++;
                if (pa === pb) same++;
            }
        }
    }
    return total ? same / total : 1;
}

/** horizontal centre of mass of the opaque pixels in the top half (where the head is) */
export function headBias(alpha, w, h) {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < h / 2; y++) {
        for (let x = 0; x < w; x++) {
            if (alpha[y * w + x] > 0) {
                sum += x;
                n++;
            }
        }
    }
    return n ? sum / n - (w - 1) / 2 : 0;
}

/* ---------- audio analysis ---------- */

export function peak(data) {
    let p = 0;
    for (const v of data) p = Math.max(p, Math.abs(v));
    return p;
}

export function rms(data, from = 0, to = data.length) {
    let s = 0;
    for (let i = from; i < to; i++) s += data[i] * data[i];
    return Math.sqrt(s / Math.max(1, to - from));
}

/** first and last sample index above a threshold */
export function activeRange(data, threshold = 1e-3) {
    let first = -1;
    let last = -1;
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > threshold) {
            if (first < 0) first = i;
            last = i;
        }
    }
    return [first, last];
}

/** fundamental frequency by normalised autocorrelation in [fmin, fmax] */
export function pitchAt(data, sampleRate, center, fmin = 250, fmax = 1600, win = 2048) {
    const start = Math.max(0, Math.floor(center - win / 2));
    const seg = data.subarray(start, start + win);
    const minLag = Math.floor(sampleRate / fmax);
    const maxLag = Math.floor(sampleRate / fmin);
    const rs = [];
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let c = 0;
        let e1 = 0;
        let e2 = 0;
        for (let i = 0; i + lag < seg.length; i++) {
            c += seg[i] * seg[i + lag];
            e1 += seg[i] * seg[i];
            e2 += seg[i + lag] * seg[i + lag];
        }
        const r = c / Math.sqrt(e1 * e2 + 1e-12);
        rs.push(r);
        best = Math.max(best, r);
    }
    // multiples of the period correlate almost as well; take the shortest lag that is a local
    // peak within 90% of the best (avoids octave-down errors)
    for (let i = 1; i < rs.length - 1; i++) {
        if (rs[i] >= best * 0.9 && rs[i] >= rs[i - 1] && rs[i] >= rs[i + 1]) {
            return {freq: sampleRate / (minLag + i), clarity: rs[i]};
        }
    }
    return {freq: 0, clarity: 0};
}

/** magnitude spectrum (naive DFT on a Hann window, n must be modest) */
export function spectrum(data, sampleRate, center, n = 2048) {
    const start = Math.max(0, Math.floor(center - n / 2));
    const bins = n / 2;
    const mags = new Float64Array(bins);
    const seg = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
        seg[i] = (data[start + i] || 0) * w;
    }
    for (let k = 0; k < bins; k++) {
        let re = 0;
        let im = 0;
        const step = (2 * Math.PI * k) / n;
        for (let i = 0; i < n; i++) {
            re += seg[i] * Math.cos(step * i);
            im -= seg[i] * Math.sin(step * i);
        }
        mags[k] = Math.hypot(re, im);
    }
    return {mags, binHz: sampleRate / n};
}

export function centroid({mags, binHz}) {
    let num = 0;
    let den = 0;
    for (let k = 1; k < mags.length; k++) {
        num += k * binHz * mags[k];
        den += mags[k];
    }
    return den ? num / den : 0;
}

export function dominant({mags, binHz}, minHz = 100) {
    let best = 0;
    let bestK = 0;
    for (let k = Math.ceil(minHz / binHz); k < mags.length; k++) {
        if (mags[k] > best) {
            best = mags[k];
            bestK = k;
        }
    }
    return bestK * binHz;
}

/** loudest window centre (for analysing the body of a call) */
export function loudestCenter(data, win = 2048) {
    let best = 0;
    let at = win / 2;
    for (let i = 0; i + win < data.length; i += win / 4) {
        const r = rms(data, i, i + win);
        if (r > best) {
            best = r;
            at = i + win / 2;
        }
    }
    return at;
}
