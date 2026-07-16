// Run with: node --test (requires `npm install` for the jsdom devDependency)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshContainer, sleep } from './dom-setup.mjs';

installDom();
const { CaptionHUD } = await import('../caption-hud.js');

function itemEls(hud) {
  return Array.from(hud._root.querySelectorAll(`.${hud._prefix}-item`));
}

function speakerText(el) {
  return el.querySelector('[class$="-speaker"]').textContent;
}

function captionText(el) {
  return el.querySelector('[class$="-text"]').textContent;
}

// --- construction ---

test('constructor throws on a non-HTMLElement container', () => {
  assert.throws(() => new CaptionHUD({}), TypeError);
  assert.throws(() => new CaptionHUD(null), TypeError);
});

test('constructor builds an accessible log region inside the container', () => {
  const container = freshContainer();
  const hud = new CaptionHUD(container);
  assert.equal(hud._root.getAttribute('role'), 'log');
  assert.equal(hud._root.getAttribute('aria-live'), 'polite');
  assert.equal(hud._root.parentNode, container);
  hud.destroy();
});

// --- push() ---

test('push() renders the speaker and text', () => {
  const hud = new CaptionHUD(freshContainer(), { reduceMotion: true });
  hud.push({ who: 'Speaker 1', color: '#38bdf8', text: 'hello there' });

  const [el] = itemEls(hud);
  assert.equal(speakerText(el), 'Speaker 1');
  assert.equal(captionText(el), 'hello there');
  hud.destroy();
});

test('push() coerces missing/non-string fields instead of throwing', () => {
  const hud = new CaptionHUD(freshContainer(), { reduceMotion: true });
  assert.doesNotThrow(() => hud.push({}));
  const [el] = itemEls(hud);
  assert.equal(speakerText(el), '');
  assert.equal(captionText(el), '');
  hud.destroy();
});

test('push() beyond maxVisible evicts the oldest caption', () => {
  const hud = new CaptionHUD(freshContainer(), { maxVisible: 2, reduceMotion: true });
  hud.push({ who: 'A', text: 'first' });
  hud.push({ who: 'B', text: 'second' });
  hud.push({ who: 'C', text: 'third' });

  const texts = itemEls(hud).map(captionText);
  assert.equal(texts.length, 2);
  assert.deepEqual(texts, ['second', 'third']);
  hud.destroy();
});

test('maxVisible is floored at 1 even if a smaller/zero value is passed', () => {
  const hud = new CaptionHUD(freshContainer(), { maxVisible: 0, reduceMotion: true });
  hud.push({ who: 'A', text: 'first' });
  hud.push({ who: 'B', text: 'second' });
  assert.equal(itemEls(hud).length, 1);
  hud.destroy();
});

// --- update() ---

test('update() replaces the newest caption\'s text without adding a new item', () => {
  const hud = new CaptionHUD(freshContainer(), { reduceMotion: true });
  hud.push({ who: 'A', text: 'partial' });
  hud.update('partial transcript grows');

  const els = itemEls(hud);
  assert.equal(els.length, 1);
  assert.equal(captionText(els[0]), 'partial transcript grows');
  hud.destroy();
});

test('update() with no captions yet is a no-op, not a throw', () => {
  const hud = new CaptionHUD(freshContainer(), { reduceMotion: true });
  assert.doesNotThrow(() => hud.update('nothing to update'));
  assert.equal(itemEls(hud).length, 0);
  hud.destroy();
});

// --- clear() ---

test('clear() removes every caption', () => {
  const hud = new CaptionHUD(freshContainer(), { reduceMotion: true });
  hud.push({ who: 'A', text: '1' });
  hud.push({ who: 'B', text: '2' });
  hud.clear();
  assert.equal(itemEls(hud).length, 0);
  hud.destroy();
});

// --- setMode() ---

test('setMode() toggles the mode class and scales the font size', () => {
  const hud = new CaptionHUD(freshContainer(), { fontSizePx: 20 });
  assert.equal(hud._root.style.getPropertyValue('--chud-font-size'), '20px');

  hud.setMode('fullscreen');
  assert.equal(hud._root.classList.contains(`${hud._prefix}-mode-fullscreen`), true);
  assert.equal(hud._root.style.getPropertyValue('--chud-font-size'), '30px'); // 1.5x

  hud.setMode('overlay');
  assert.equal(hud._root.classList.contains(`${hud._prefix}-mode-overlay`), true);
  assert.equal(hud._root.style.getPropertyValue('--chud-font-size'), '20px');
  hud.destroy();
});

test('setMode() rejects an invalid mode', () => {
  const hud = new CaptionHUD(freshContainer());
  assert.throws(() => hud.setMode('sideways'), TypeError);
  hud.destroy();
});

// --- runtime setters ---

test('setFontSize() updates the CSS variable, keeping the fullscreen 1.5x scale', () => {
  const hud = new CaptionHUD(freshContainer(), { fontSizePx: 20 });
  hud.setFontSize(30);
  assert.equal(hud._root.style.getPropertyValue('--chud-font-size'), '30px');

  hud.setMode('fullscreen');
  assert.equal(hud._root.style.getPropertyValue('--chud-font-size'), '45px'); // 1.5x
  hud.destroy();
});

test('setFontSize() rejects non-positive or non-finite sizes', () => {
  const hud = new CaptionHUD(freshContainer());
  assert.throws(() => hud.setFontSize(0), TypeError);
  assert.throws(() => hud.setFontSize(-5), TypeError);
  assert.throws(() => hud.setFontSize(NaN), TypeError);
  assert.throws(() => hud.setFontSize('22'), TypeError);
  hud.destroy();
});

test('setHighContrast() toggles the high-contrast class', () => {
  const hud = new CaptionHUD(freshContainer(), { highContrast: false });
  const cls = `${hud._prefix}-high-contrast`;
  assert.equal(hud._root.classList.contains(cls), false);
  hud.setHighContrast(true);
  assert.equal(hud._root.classList.contains(cls), true);
  hud.setHighContrast(false);
  assert.equal(hud._root.classList.contains(cls), false);
  hud.destroy();
});

// --- eviction animation ---

test('an evicted caption uses the quick -removing transition, not the slow -fading one', () => {
  const hud = new CaptionHUD(freshContainer(), { maxVisible: 1, reduceMotion: false });
  hud.push({ who: 'A', text: 'first' });
  hud.push({ who: 'B', text: 'second' });

  // The evicted element is still in the DOM mid-animation but no longer tracked.
  const evicted = itemEls(hud).find((el) => captionText(el) === 'first');
  assert.ok(evicted, 'evicted element should still be animating out');
  assert.equal(evicted.classList.contains(`${hud._prefix}-removing`), true);
  assert.equal(evicted.classList.contains(`${hud._prefix}-fading`), false);
  hud.destroy();
});

// --- destroy() ---

test('destroy() removes the root and injected style tag, and is idempotent', () => {
  const container = freshContainer();
  const hud = new CaptionHUD(container);
  const styleEl = hud._styleEl;

  hud.destroy();
  assert.equal(container.contains(hud._root), false);
  assert.equal(document.head.contains(styleEl), false);
  assert.doesNotThrow(() => hud.destroy()); // second call is a no-op
});

test('methods throw after destroy()', () => {
  const hud = new CaptionHUD(freshContainer());
  hud.destroy();
  assert.throws(() => hud.push({ who: 'A', text: 'x' }), /destroy/);
  assert.throws(() => hud.clear(), /destroy/);
});

test('destroy() restores the container\'s original position style', () => {
  const container = freshContainer();
  // jsdom's getComputedStyle only reflects explicitly-set values (it
  // doesn't compute CSS initial values like a real browser), so the
  // 'static' the constructor checks for has to be set explicitly here.
  container.style.position = 'static';
  const hud = new CaptionHUD(container);
  assert.equal(container.style.position, 'relative'); // overwritten because computed was 'static'
  hud.destroy();
  assert.equal(container.style.position, 'static'); // restored to what it was before
});

test("destroy() leaves an already-positioned container's style untouched", () => {
  const container = freshContainer();
  container.style.position = 'absolute';
  const hud = new CaptionHUD(container);
  assert.equal(container.style.position, 'absolute'); // constructor must not override a non-static position
  hud.destroy();
  assert.equal(container.style.position, 'absolute');
});

// --- stacking opacity ---

test('stack opacities follow newest-to-oldest: 1, 0.45, 0.2, then the floor', () => {
  const hud = new CaptionHUD(freshContainer(), { maxVisible: 5, reduceMotion: true });
  for (const text of ['a', 'b', 'c', 'd', 'e']) hud.push({ who: 'X', text });

  const opacities = itemEls(hud).map((el) => el.style.opacity);
  // oldest -> newest in DOM order (push order): a,b,c,d,e
  assert.deepEqual(opacities, ['0.08', '0.08', '0.2', '0.45', '1']);
  hud.destroy();
});

// --- reduced motion ---

test('reduceMotion: true skips the entrance animation class', () => {
  const hud = new CaptionHUD(freshContainer(), { reduceMotion: true });
  hud.push({ who: 'A', text: 'x' });
  const [el] = itemEls(hud);
  assert.equal(el.classList.contains(`${hud._prefix}-enter`), false);
  assert.equal(hud._root.classList.contains(`${hud._prefix}-reduced`), true);
  hud.destroy();
});

test('reduceMotion: false applies the entrance animation class, removed on the next frame', async () => {
  const hud = new CaptionHUD(freshContainer(), { reduceMotion: false });
  hud.push({ who: 'A', text: 'x' });
  const [el] = itemEls(hud);
  assert.equal(el.classList.contains(`${hud._prefix}-enter`), true);

  await sleep(50); // two requestAnimationFrame ticks
  assert.equal(el.classList.contains(`${hud._prefix}-enter`), false);
  hud.destroy();
});

// --- fade -> remove lifecycle ---

test('a caption fades and is removed after fadeAfterMs under reduced motion (no extra animation delay)', async () => {
  const hud = new CaptionHUD(freshContainer(), { fadeAfterMs: 15, reduceMotion: true });
  hud.push({ who: 'A', text: 'will fade' });
  assert.equal(itemEls(hud).length, 1);

  await sleep(60);

  assert.equal(itemEls(hud).length, 0, 'reduced motion should remove immediately after fadeAfterMs, no FADE_DURATION_MS wait');
  hud.destroy();
});

test('a caption fades and is removed after fadeAfterMs + the fade/remove animation delay', async () => {
  const hud = new CaptionHUD(freshContainer(), { fadeAfterMs: 15 });
  hud.push({ who: 'A', text: 'will fade' });

  await sleep(15 + 20); // just past fadeAfterMs
  const [el] = itemEls(hud);
  assert.equal(el.classList.contains(`${hud._prefix}-fading`), true, 'should be mid-fade');
  assert.equal(el.style.opacity, '0');

  await sleep(1200 + 260 + 100); // FADE_DURATION_MS + REMOVE_DURATION_MS, with slack
  assert.equal(itemEls(hud).length, 0);
  hud.destroy();
});

// --- matchMedia auto mode ---

test('reduceMotion: "auto" follows window.matchMedia', () => {
  const container = freshContainer();
  const realMatchMedia = window.matchMedia;
  window.matchMedia = () => ({
    matches: true,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  try {
    const hud = new CaptionHUD(container, { reduceMotion: 'auto' });
    assert.equal(hud._reduceMotionActive(), true);
    hud.push({ who: 'A', text: 'x' });
    assert.equal(itemEls(hud)[0].classList.contains(`${hud._prefix}-enter`), false);
    hud.destroy();
  } finally {
    window.matchMedia = realMatchMedia;
  }
});
