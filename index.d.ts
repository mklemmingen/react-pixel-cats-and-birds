import type {CSSProperties, ReactElement} from 'react';

/** Colour variant ids of the bundled cat sprite sheets, e.g. 'orange-0', 'calico-0'. */
export type CatColor = string;

/** Bird species ids of the bundled sprite sheets. */
export type BirdSpecies =
    | 'blueJay' | 'cardinal' | 'cedarWaxwing' | 'chickadee' | 'crow' | 'houseFinch'
    | 'hummingbird' | 'magpie' | 'redRobin' | 'stellersJay' | 'whiteDove' | 'woodThrush';

export interface CatsProps {
    /** Number of cats. Default 10. */
    count?: number;
    /** Colour ids to choose from (see CAT_COLORS). Default: all 50. */
    colors?: CatColor[];
    /** Custom sprite sheet URLs with the same 768x512 layout. Overrides `colors`. */
    sheets?: string[];
    /** Max. number of different sheets loaded (memory). Default 8. */
    variety?: number;
    /** Pixel scale; 32px tiles x 3 = 96px cats. Default 3. */
    scale?: number;
    /** Keep cats in the outer quarters, away from a centred text column. Default false. */
    avoidCenter?: boolean;
    /** Click sound: 'synth' (default), false for silence, or your own handler. */
    sound?: boolean | 'synth' | ((cat: unknown) => void);
    /** Clicking startles cats. When false the canvas ignores the pointer. Default true. */
    interactive?: boolean;
    /** Frame-rate cap. Default 30. */
    maxFps?: number;
    className?: string;
    /** Merged over the default style: absolute, inset 0, 100% x 100%, pixelated. */
    style?: CSSProperties;
}

export interface BirdsProps {
    /** Number of birds. Default 20. */
    count?: number;
    /** Species to choose from. Default: all 12. */
    species?: BirdSpecies[];
    /** Pixel scale; 16px tiles x 2 = 32px birds. Default 2. */
    scale?: number;
    /** Click sound: 'synth' (species-specific call, default), false, or your own handler. */
    sound?: boolean | 'synth' | ((bird: unknown) => void);
    interactive?: boolean;
    maxFps?: number;
    className?: string;
    style?: CSSProperties;
}

/** Wandering pixel-art cats on a canvas that fills its positioned parent. */
export function Cats(props: CatsProps): ReactElement;

/** Pixel-art garden birds on a canvas that fills its positioned parent. */
export function Birds(props: BirdsProps): ReactElement;

export interface MeowSettings {
    /** 0-100 */
    nasal: number;
    /** 0-100 */
    bright: number;
    /** percent, 100 = ~480 Hz start */
    pitch: number;
    /** centiseconds */
    length: number;
    /** 0-100 */
    whine: number;
}

export type MeowPreset = 'meow' | 'kittenMew' | 'whinyMeow' | 'shortMew';

export interface RenderOptions {
    /** Render into this context instead of the shared one (e.g. OfflineAudioContext). */
    context?: BaseAudioContext;
    destination?: AudioNode;
    /** Start time in context seconds. */
    when?: number;
    /** Random source (for reproducible sounds). */
    rng?: () => number;
    /** Linear gain multiplier. */
    gain?: number;
}

export interface PlayResult {
    start: number;
    duration: number;
}

/** Play a synthesised meow. Returns null when audio is unavailable or too many sounds are playing. */
export function playMeow(settings?: MeowPreset | MeowSettings, options?: RenderOptions): PlayResult | null;
export const MEOW_PRESETS: Record<MeowPreset, MeowSettings>;
export function meowContours(settings: MeowSettings, rng?: () => number): {
    dur: number; base: number; top: number; pitch: Float32Array; env: Float32Array;
    formants: Float32Array[]; antiResonance: Float32Array;
};

/** Play a synthesised bird call for the given species (random when omitted). */
export function playChirp(species?: BirdSpecies, options?: RenderOptions): (PlayResult & {syllables: number}) | null;
export const CHIRP_SPECIES: BirdSpecies[];
export const BIRD_CALLS: Record<BirdSpecies, (rng: () => number) => object[]>;

/** Master volume 0..1 for all synthesised sounds. */
export function setVolume(value: number): void;
export function setMuted(muted: boolean): void;

export const CAT_SHEETS: Record<CatColor, string>;
export const BIRD_SHEETS: Record<BirdSpecies, string>;
export const CAT_COLORS: CatColor[];
export const BIRD_SPECIES: BirdSpecies[];
