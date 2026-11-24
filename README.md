# react-pixel-cats-and-birds

Animated pixel-art **cats and birds for React**: background sprites that wander, sit, lie down and
react to clicks with **synthesised meows and bird calls**. No audio files, zero dependencies.

```bash
npm i react-pixel-cats-and-birds
```

```jsx
import {Cats, Birds} from 'react-pixel-cats-and-birds';

export default function Hero() {
  return (
    <section style={{position: 'relative', minHeight: 600}}>
      <Cats count={10} />
      <Birds count={16} />
      <h1 style={{position: 'relative'}}>Hello</h1>
    </section>
  );
}
```

Both components render a `<canvas>` that fills the nearest positioned parent. Put your content after
them (or give it `position: relative` / a `z-index`) so it sits on top.

## Credits

**Pixel art by [Pop Shop Packs](https://pop-shop-packs.itch.io/)**, used with permission:
[Cats || Pixel Asset Pack](https://pop-shop-packs.itch.io/cats-pixel-asset-pack) (50 colours) and
[Garden Birds || Pixel Asset Pack](https://pop-shop-packs.itch.io/garden-birds-pixel-character-asset-pack)
(12 species). The sprites are not MIT-licensed; see [CREDITS.md](CREDITS.md) for the artist's terms.
If you like them, the packs are pay-what-you-want.

## What it does

- **Cats**: walk and run to random spots, then sit, look around or lie down. Idle poses play in,
  hold still, and play back out before the cat moves on. Clicking a cat meows and it bolts
  (a resting cat gets up first).
- **Birds**: fly, land, peck and rest, then take off again. Clicking a bird flinches it and plays
  that species' call (crow caw, chickadee "chick-a-dee", cardinal "cheer", dove coo, ...).
- **Sounds**: synthesised with the Web Audio API (source-filter meow model, per-species bird
  calls), mastered through a compressor and limiter so overlapping clicks never clip.
- **Light**: off-screen canvases are paused and their memory released; only the sprite sheets in
  use are loaded (8 cat colours by default, ~20 KB each); 30 fps cap; respects
  `prefers-reduced-motion`; cleans up on unmount; works with React StrictMode.

## Next.js (App Router)

The components are client components (`'use client'` is built in), so you can use them directly in
a server component page or layout:

```jsx
// app/page.jsx
import {Cats} from 'react-pixel-cats-and-birds';

export default function Page() {
  return (
    <main style={{position: 'relative', minHeight: '100vh'}}>
      <Cats count={12} avoidCenter />
      <article style={{position: 'relative', maxWidth: 640, margin: '0 auto'}}>...</article>
    </main>
  );
}
```

Sprites are referenced with `new URL('./x.png', import.meta.url)`, which Next.js (webpack and
Turbopack), Vite, Parcel and webpack 5 bundle automatically.

## Props

### `<Cats>`

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `count` | number | `10` | number of cats |
| `colors` | string[] | all 50 | colour ids from `CAT_COLORS`, e.g. `['orange-0', 'calico-0']` |
| `sheets` | string[] | | your own sheet URLs (same 768x512 layout); overrides `colors` |
| `variety` | number | `8` | max. different sheets loaded |
| `scale` | number | `3` | 32px tiles x scale |
| `avoidCenter` | boolean | `false` | keep cats in the outer quarters |
| `sound` | `'synth'` \| `false` \| `(cat) => void` | `'synth'` | click sound |
| `interactive` | boolean | `true` | `false` makes the canvas click-through |
| `maxFps` | number | `30` | frame-rate cap |
| `className`, `style` | | | merged over the default full-size style |

### `<Birds>`

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `count` | number | `20` | number of birds |
| `species` | string[] | all 12 | `blueJay`, `cardinal`, `cedarWaxwing`, `chickadee`, `crow`, `houseFinch`, `hummingbird`, `magpie`, `redRobin`, `stellersJay`, `whiteDove`, `woodThrush` |
| `scale` | number | `2` | 16px tiles x scale |
| `sound`, `interactive`, `maxFps`, `className`, `style` | | | as for `<Cats>` |

Stack `<Cats>` and `<Birds>` freely: a click that misses every bird is passed on to the cats below.

## Sounds without the components

```js
import {playMeow, playChirp, setVolume, MEOW_PRESETS} from 'react-pixel-cats-and-birds';

playMeow();                // random preset
playMeow('kittenMew');     // 'meow' | 'kittenMew' | 'whinyMeow' | 'shortMew'
playMeow({nasal: 80, bright: 70, pitch: 110, length: 60, whine: 40});
playChirp('chickadee');    // any species id, or omit for a random one
setVolume(0.5);
```

Call them from a user gesture (click, key press) the first time: browsers block audio until then.
Both accept `{context, destination}` to render into an `OfflineAudioContext`, e.g. to export WAVs.

## Development

```bash
npm test             # 140 unit tests: sprite sheets, cat/bird behaviour, audio analysis, components
npm run playground   # visual checks at http://localhost:5178/playground/
```

## Licence

Code: MIT. Sprites: Pop Shop Packs, used with permission, not MIT. See [LICENSE](LICENSE) and
[CREDITS.md](CREDITS.md).
