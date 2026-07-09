# CaptionHUD

A standalone, reusable UI component that turns `{who, color, text}` caption
events into accessible, floating, fading, color-coded captions. Renders as a
bottom-anchored overlay (composited on top of video/canvas) or fullscreen (a
smart-glasses stand-in on a phone). Built for a captioning app for deaf and
hard-of-hearing users, so readability is the entire point.

Plain ES module, zero dependencies, no build step.

## Quick start

```bash
python3 -m http.server
```

Open `http://localhost:8000/demo.html`.

```js
import { CaptionHUD } from './caption-hud.js';

const hud = new CaptionHUD(document.getElementById('stage'), {
  mode: 'overlay',
  maxVisible: 3,
  fadeAfterMs: 8000,
  fontSizePx: 22,
  highContrast: true,
  reduceMotion: 'auto',
});

hud.push({ who: 'Speaker 1', color: '#38bdf8', text: 'Hello there' });
```

## API

### `new CaptionHUD(containerEl, options?)`

Renders into `containerEl`. Never touches `document.body` or global styles —
all CSS is scoped under a unique generated class prefix and injected as a
single `<style>` tag, so multiple instances can run on one page without
colliding.

| Option | Default | Description |
| --- | --- | --- |
| `mode` | `'overlay'` | `'overlay'` (bottom-anchored) or `'fullscreen'` |
| `maxVisible` | `3` | Captions shown before the oldest is removed |
| `fadeAfterMs` | `8000` | Caption starts fading after this many ms |
| `fontSizePx` | `22` | Base text size; fullscreen mode scales it 1.5x |
| `highContrast` | `true` | Solid backing plate + text shadow for readability over any content |
| `reduceMotion` | `'auto'` | `'auto'` follows `prefers-reduced-motion`; `true`/`false` forces it |

### `hud.push({ who, color, text })`

Appends a new caption. It slides/fades in (or appears instantly under
reduced motion). Older captions shift up and dim (opacity ~1.0 / 0.45 / 0.2);
once there are more than `maxVisible`, the oldest is removed.

### `hud.update(text)`

Replaces the text of the newest caption in place, without re-triggering its
entrance animation. Meant for streaming/partial ASR results — call `push`
once with the first partial, then `update` repeatedly as more text arrives.

### `hud.clear()`

Removes all currently visible captions.

### `hud.setMode(mode)`

Live-switches between `'overlay'` and `'fullscreen'`.

### `hud.destroy()`

Removes all DOM nodes and the injected `<style>` tag, restores any inline
positioning it applied to the container, and detaches all listeners/timers.
Leaves zero trace behind.

## Accessibility decisions

The caption region uses `role="log"` with `aria-live="polite"` so screen
readers announce new captions without interrupting what's currently being
read — captions are non-negotiable here because for a deaf/hard-of-hearing
user the caption *is* the audio, so losing an update to a missed
announcement, or having it barked over the previous one, isn't a cosmetic
bug, it's a dropped word of dialogue. Every caption gets a high-contrast
backing plate plus a heavy text shadow (`highContrast: true` by default) so
text stays legible over arbitrary, brightly moving video content instead of
depending on luck with whatever's playing underneath. `prefers-reduced-motion`
swaps the slide/fade transitions for instant appearance and stepped opacity,
because motion sickness or distraction from animated captions defeats the
purpose of captioning in the first place — the text needs to be readable,
not the transition.

## Demo

`demo.html` drives two independent `CaptionHUD` instances — one in overlay
mode over an animated canvas test pattern, one in fullscreen mode inside a
phone-shaped frame — from a single shared event stream.

```bash
python3 -m http.server
# open http://localhost:8000/demo.html
```

Controls:

- **Push random caption** — cycles through three fake speakers plus an amber
  "Multiple speakers" entry and a gray "Unknown speaker" entry.
- **Streaming demo** — pushes a caption, then calls `update()` word by word
  to simulate live ASR.
- **maxVisible** / **fontSizePx** sliders, and a **force reduced motion**
  checkbox — these rebuild both HUD instances with the new settings and
  replay the event log, since those are constructor-time options.

## Composes with

Consumes attribution-labeled ASR results (speaker-labeled transcript events);
pairs with **CaptionRelay** on the receiving device to get those events from
a laptop to a phone or tablet acting as the fullscreen display.
