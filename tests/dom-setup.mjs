// Installs a jsdom window/document as the global DOM environment.
// caption-hud.js is plain browser code (document.createElement,
// window.matchMedia, window.getComputedStyle, requestAnimationFrame) with
// no test hooks of its own, so this is the one dev-only dependency in the
// whole repo -- purely for testing; the shipped component still has zero
// runtime dependencies.
import { JSDOM } from 'jsdom';

export function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);

  // jsdom doesn't implement matchMedia; stub a controllable fake so
  // reduceMotion: 'auto' tests can flip `matches` directly.
  window.matchMedia = (query) => ({
    media: query,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });

  return dom;
}

export function freshContainer() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
