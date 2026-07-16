/**
 * CaptionHUD — accessible, floating, fading, color-coded caption renderer.
 *
 * Renders `{who, color, text}` caption events into a caller-provided
 * container, either as a bottom-anchored overlay (for compositing on top of
 * video/canvas) or as a fullscreen stand-in for smart-glasses captions on a
 * phone. Zero dependencies, no build step, single ES module.
 */

/**
 * @typedef {Object} CaptionEvent
 * @property {string} who - Speaker label, e.g. "Speaker 1" or "Multiple speakers".
 * @property {string} color - CSS color for the speaker label, e.g. "#38bdf8".
 * @property {string} text - Caption text content.
 */

/**
 * @typedef {Object} CaptionHUDOptions
 * @property {'overlay'|'fullscreen'} [mode='overlay'] - 'overlay' anchors captions to the
 *   bottom of the container (for compositing over video/canvas); 'fullscreen' fills the
 *   container and scales type up, as a smart-glasses stand-in.
 * @property {number} [maxVisible=3] - Number of captions shown before the oldest is removed.
 * @property {number} [fadeAfterMs=8000] - Milliseconds a caption stays fully opaque before
 *   it begins fading out and is eventually removed.
 * @property {number} [fontSizePx=22] - Base caption text size in px (overlay mode). Fullscreen
 *   mode scales this up 1.5x. Text never renders smaller than this value.
 * @property {boolean} [highContrast=true] - Draws a solid backing plate plus text shadow
 *   behind every caption so it stays readable over any video content.
 * @property {'auto'|boolean} [reduceMotion='auto'] - 'auto' respects the OS-level
 *   `prefers-reduced-motion` setting; `true`/`false` force it on/off.
 */

let instanceCounter = 0;

const FADE_DURATION_MS = 1200;
const REMOVE_DURATION_MS = 260;
const ENTER_DURATION_MS = 320;
const STACK_OPACITIES = [1, 0.45, 0.2];
const MIN_STACK_OPACITY = 0.08;

export class CaptionHUD {
  /**
   * @param {HTMLElement} containerEl - Element to render into. CaptionHUD only ever touches
   *   this element and its own descendants/injected `<style>` tag — never `document.body` or
   *   global styles.
   * @param {CaptionHUDOptions} [options]
   */
  constructor(containerEl, options = {}) {
    if (!(containerEl instanceof HTMLElement)) {
      throw new TypeError('CaptionHUD requires a containerEl HTMLElement');
    }

    this._container = containerEl;
    this._prefix = `chud-${instanceCounter++}`;
    this._destroyed = false;
    this._nextId = 1;

    this._opts = {
      mode: options.mode === 'fullscreen' ? 'fullscreen' : 'overlay',
      maxVisible: Math.max(1, options.maxVisible ?? 3),
      fadeAfterMs: options.fadeAfterMs ?? 8000,
      fontSizePx: options.fontSizePx ?? 22,
      highContrast: options.highContrast ?? true,
      reduceMotion: options.reduceMotion ?? 'auto',
    };

    /**
     * @type {Array<{
     *   id: number, who: string, color: string, text: string,
     *   el: HTMLElement|null, textEl: HTMLElement|null,
     *   fadeTimer: number|null, removeTimer: number|null
     * }>}
     */
    this._captions = [];

    this._mq = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    this._onMqChange = () => this._applyMotionClass();
    if (this._mq && this._opts.reduceMotion === 'auto') {
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMqChange);
      else if (this._mq.addListener) this._mq.addListener(this._onMqChange);
    }

    this._injectStyles();
    this._setContainerPositioning();
    this._buildDom();
    this._applyMotionClass();
    this._applyContrastClass();
    this._applyModeClass();
  }

  /**
   * Append a new caption. Older captions shift up and dim; once more than
   * `maxVisible` are present the oldest is removed.
   * @param {CaptionEvent} event
   * @returns {void}
   */
  push(event) {
    this._assertNotDestroyed();
    const who = event && event.who != null ? String(event.who) : '';
    const color = (event && event.color) || '#9ca3af';
    const text = event && event.text != null ? String(event.text) : '';

    const caption = {
      id: this._nextId++,
      who,
      color,
      text,
      el: null,
      textEl: null,
      fadeTimer: null,
      removeTimer: null,
    };

    this._captions.push(caption);
    this._createCaptionElement(caption);
    this._scheduleFade(caption);

    while (this._captions.length > this._opts.maxVisible) {
      this._removeCaption(this._captions[0], { animate: !this._reduceMotionActive() });
    }

    this._updateStackOpacities();
  }

  /**
   * Replace the text of the newest caption in place (for streaming/partial ASR
   * results). Does not re-trigger the entrance animation and resets that
   * caption's fade timer.
   * @param {string} text
   * @returns {void}
   */
  update(text) {
    this._assertNotDestroyed();
    const newest = this._captions[this._captions.length - 1];
    if (!newest) return;
    newest.text = text != null ? String(text) : '';
    if (newest.textEl) newest.textEl.textContent = newest.text;
    this._scheduleFade(newest);
  }

  /**
   * Remove all captions immediately.
   * @returns {void}
   */
  clear() {
    this._assertNotDestroyed();
    for (const caption of this._captions.slice()) {
      this._clearCaptionTimers(caption);
      if (caption.el && caption.el.parentNode) caption.el.parentNode.removeChild(caption.el);
    }
    this._captions = [];
  }

  /**
   * Live-switch between 'overlay' and 'fullscreen' rendering.
   * @param {'overlay'|'fullscreen'} mode
   * @returns {void}
   */
  setMode(mode) {
    this._assertNotDestroyed();
    if (mode !== 'overlay' && mode !== 'fullscreen') {
      throw new TypeError(`CaptionHUD.setMode: invalid mode "${mode}"`);
    }
    if (mode === this._opts.mode) return;
    this._opts.mode = mode;
    this._applyModeClass();
  }

  /**
   * Change the base caption text size at runtime (e.g. a user-facing
   * "text size" control). Fullscreen mode keeps its 1.5x scaling.
   * @param {number} px
   * @returns {void}
   */
  setFontSize(px) {
    this._assertNotDestroyed();
    if (!Number.isFinite(px) || px <= 0) {
      throw new TypeError(`CaptionHUD.setFontSize: invalid size "${px}"`);
    }
    this._opts.fontSizePx = px;
    this._applyModeClass();
  }

  /**
   * Toggle the solid backing plate / text shadow at runtime.
   * @param {boolean} enabled
   * @returns {void}
   */
  setHighContrast(enabled) {
    this._assertNotDestroyed();
    this._opts.highContrast = !!enabled;
    this._applyContrastClass();
  }

  /**
   * Remove all DOM nodes and injected styles created by this instance, restore
   * any container styling it changed, and detach all listeners/timers.
   * @returns {void}
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    for (const caption of this._captions) this._clearCaptionTimers(caption);
    this._captions = [];

    if (this._mq) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMqChange);
      else if (this._mq.removeListener) this._mq.removeListener(this._onMqChange);
    }

    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._root = null;

    if (this._styleEl && this._styleEl.parentNode) this._styleEl.parentNode.removeChild(this._styleEl);
    this._styleEl = null;

    if (this._containerPositionChanged) {
      this._container.style.position = this._prevContainerPosition;
    }
  }

  // -- internals --------------------------------------------------------

  _assertNotDestroyed() {
    if (this._destroyed) throw new Error('CaptionHUD: cannot call methods after destroy()');
  }

  _reduceMotionActive() {
    if (this._opts.reduceMotion === true) return true;
    if (this._opts.reduceMotion === false) return false;
    return !!(this._mq && this._mq.matches);
  }

  _setContainerPositioning() {
    const computed = window.getComputedStyle(this._container).position;
    this._prevContainerPosition = this._container.style.position;
    this._containerPositionChanged = false;
    if (computed === 'static') {
      this._container.style.position = 'relative';
      this._containerPositionChanged = true;
    }
  }

  _buildDom() {
    const p = this._prefix;
    const root = document.createElement('div');
    root.className = `${p}-root`;
    root.setAttribute('role', 'log');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-atomic', 'false');
    root.setAttribute('aria-relevant', 'additions text');
    this._container.appendChild(root);
    this._root = root;
  }

  _applyModeClass() {
    const p = this._prefix;
    this._root.classList.toggle(`${p}-mode-fullscreen`, this._opts.mode === 'fullscreen');
    this._root.classList.toggle(`${p}-mode-overlay`, this._opts.mode === 'overlay');
    const scale = this._opts.mode === 'fullscreen' ? 1.5 : 1;
    this._root.style.setProperty('--chud-font-size', `${this._opts.fontSizePx * scale}px`);
  }

  _applyMotionClass() {
    const p = this._prefix;
    this._root.classList.toggle(`${p}-reduced`, this._reduceMotionActive());
  }

  _applyContrastClass() {
    const p = this._prefix;
    this._root.classList.toggle(`${p}-high-contrast`, !!this._opts.highContrast);
  }

  _createCaptionElement(caption) {
    const p = this._prefix;
    const el = document.createElement('div');
    el.className = `${p}-item`;
    el.dataset.id = String(caption.id);

    const speakerEl = document.createElement('span');
    speakerEl.className = `${p}-speaker`;
    speakerEl.style.color = caption.color;
    speakerEl.textContent = caption.who;

    const textEl = document.createElement('div');
    textEl.className = `${p}-text`;
    textEl.textContent = caption.text;

    el.appendChild(speakerEl);
    el.appendChild(textEl);

    caption.el = el;
    caption.textEl = textEl;

    const reduced = this._reduceMotionActive();
    if (!reduced) el.classList.add(`${p}-enter`);
    this._root.appendChild(el);

    if (!reduced) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.remove(`${p}-enter`));
      });
    }
  }

  _updateStackOpacities() {
    const count = this._captions.length;
    for (let i = 0; i < count; i++) {
      const fromNewest = count - 1 - i;
      const opacity = STACK_OPACITIES[fromNewest] ?? MIN_STACK_OPACITY;
      const caption = this._captions[i];
      if (caption.el && !caption.el.classList.contains(`${this._prefix}-fading`)) {
        caption.el.style.opacity = String(opacity);
      }
    }
  }

  _scheduleFade(caption) {
    this._clearCaptionTimers(caption);
    if (caption.el) {
      caption.el.classList.remove(`${this._prefix}-fading`);
      caption.el.style.opacity = '';
    }
    this._updateStackOpacities();
    caption.fadeTimer = window.setTimeout(() => this._startFade(caption), this._opts.fadeAfterMs);
  }

  _startFade(caption) {
    caption.fadeTimer = null;
    if (this._reduceMotionActive()) {
      this._removeCaption(caption, { animate: false });
      return;
    }
    const p = this._prefix;
    if (caption.el) {
      caption.el.classList.add(`${p}-fading`);
      caption.el.style.opacity = '0';
    }
    caption.removeTimer = window.setTimeout(() => this._removeCaption(caption, { animate: false }), FADE_DURATION_MS);
  }

  _removeCaption(caption, { animate }) {
    const index = this._captions.indexOf(caption);
    if (index === -1) return;
    this._clearCaptionTimers(caption);
    this._captions.splice(index, 1);

    const el = caption.el;
    if (!el) return;

    if (animate) {
      const p = this._prefix;
      el.classList.add(`${p}-removing`);
      el.style.opacity = '0';
      window.setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, REMOVE_DURATION_MS);
    } else if (el.parentNode) {
      el.parentNode.removeChild(el);
    }

    this._updateStackOpacities();
  }

  _clearCaptionTimers(caption) {
    if (caption.fadeTimer != null) {
      window.clearTimeout(caption.fadeTimer);
      caption.fadeTimer = null;
    }
    if (caption.removeTimer != null) {
      window.clearTimeout(caption.removeTimer);
      caption.removeTimer = null;
    }
  }

  _injectStyles() {
    const p = this._prefix;
    const style = document.createElement('style');
    style.setAttribute('data-caption-hud', p);
    style.textContent = `
.${p}-root {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  top: auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
  gap: 0.5em;
  padding: 1em;
  box-sizing: border-box;
  pointer-events: none;
  overflow: hidden;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --chud-font-size: ${this._opts.fontSizePx}px;
  z-index: 2147483000;
}
.${p}-root.${p}-mode-fullscreen {
  top: 0;
  align-items: center;
}
.${p}-item {
  max-width: min(92%, 900px);
  box-sizing: border-box;
  border-radius: 0.5em;
  padding: 0.45em 0.75em;
  background: rgba(0, 0, 0, 0.35);
  opacity: 1;
  transform: translateY(0);
  transition: opacity ${ENTER_DURATION_MS}ms ease, transform ${ENTER_DURATION_MS}ms ease;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.${p}-root.${p}-mode-fullscreen .${p}-item {
  text-align: center;
}
.${p}-root.${p}-high-contrast .${p}-item {
  background: rgba(0, 0, 0, 0.78);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
.${p}-item.${p}-enter {
  opacity: 0;
  transform: translateY(0.8em);
}
.${p}-item.${p}-fading {
  transition: opacity ${FADE_DURATION_MS}ms ease, transform ${FADE_DURATION_MS}ms ease;
}
.${p}-item.${p}-removing {
  transition: opacity ${REMOVE_DURATION_MS}ms ease;
}
.${p}-speaker {
  display: block;
  font-variant: small-caps;
  letter-spacing: 0.06em;
  font-weight: 700;
  font-size: calc(var(--chud-font-size) * 0.55);
  line-height: 1.2;
  margin-bottom: 0.15em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 6px rgba(0, 0, 0, 0.6);
}
.${p}-text {
  display: block;
  font-size: var(--chud-font-size);
  line-height: 1.3;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.95), 0 0 8px rgba(0, 0, 0, 0.7);
}
.${p}-root.${p}-reduced .${p}-item,
.${p}-root.${p}-reduced .${p}-item.${p}-enter,
.${p}-root.${p}-reduced .${p}-item.${p}-fading,
.${p}-root.${p}-reduced .${p}-item.${p}-removing {
  transition: none !important;
  transform: none !important;
}
`;
    document.head.appendChild(style);
    this._styleEl = style;
  }
}

export default CaptionHUD;
