/* ============================================================================
 * NISE supplementary site — §3 depth-corruption block behaviours.
 * Vendored, dependency-free, no network. Offline-safe (cf. nise.js / slider.js /
 * pipeline.js). Reads its configuration from the DOM and from two embedded
 * <script type="application/json"> blocks (parsed locally — NEVER fetch(), which
 * Chromium CORS-blocks from a bare file:// 'null' origin, exactly as the GCVSS
 * cloud block notes). Writes no globals beyond one namespaced rescan hook.
 *
 * THREE coordinated widgets, each self-contained and individually optional (a
 * missing block is skipped, never throws):
 *
 *   A. ATLAS  (#noise-atlas)  the three failure modes on a real raw-depth frame.
 *      The existing .nise-chip[data-mode] chips + the legend rail rows are ONE
 *      linked highlight group: hover / focus / tap any control glows the matching
 *      overlay layer on the depth frame. Tap toggles a sticky lock (tap again or
 *      tap elsewhere / Escape to clear); hover/focus is transient over a lock.
 *
 *   B. DEMO   (#noise-severity, #noise-family)  the corruption pipeline on sim
 *      depth. A severity range input cross-fades clean..saturated; a per-family
 *      build-up steps +holes -> +edge -> +wrong. Both read pre-baked frames and
 *      their valid%/RMSE readout from the embedded sim-frames JSON.
 *
 * GRACEFUL DEGRADATION: with no JS the atlas shows the colorized depth frame
 * (overlays are opacity:0, the base is visible), the severity stage shows its
 * first frame (is-shown set in markup), and the chips are inert but legible.
 * prefers-reduced-motion disables the cross-fades (the swap is instant).
 * ========================================================================== */
(function () {
  'use strict';

  /* ----------------------------------------------------------- small utils */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  function readJSON(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent || el.innerText || 'null'); }
    catch (e) { return null; }
  }

  /* ======================================================== A. CORRUPTION ATLAS
   * Links the .nise-chip[data-mode] chips + the .noise-legend-item rows to the
   * overlay layers inside #noise-atlas. One shared "active mode" drives:
   *   - the overlay .is-on on .noise-atlas__overlay[data-mode]
   *   - the .is-active state on every control for that mode (chips + legend)
   *   - an aria-live announcement of the mode's plain-language note.
   */
  function initAtlas() {
    var atlas = document.getElementById('noise-atlas');
    if (!atlas) return;

    var overlays = $all('.noise-atlas__overlay', atlas);
    // controls = chips (may live outside the atlas, up in the chip row) + legend
    var chips = $all('.nise-chip[data-mode]');
    var legend = $all('.noise-legend-item[data-mode]', atlas);
    var controls = chips.concat(legend);
    if (!overlays.length || !controls.length) return;

    var srEl = $('.noise-sr', atlas);
    var notes = readJSON('noise-atlas-notes') || {};

    // Progressive enhancement: upgrade the static chips to real, keyboard-
    // operable controls now that JS is present (without JS they stay legible,
    // inert list items). The legend rows are already <button>s.
    chips.forEach(function (chip) {
      chip.classList.add('is-interactive');
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.setAttribute('aria-pressed', 'false');
      var m = chip.getAttribute('data-mode');
      if (m && notes[m]) {
        chip.setAttribute('aria-label',
          'Highlight ' + notes[m].name + ' on the real depth frame');
      }
    });

    var locked = null;   // sticky mode set by tap/click
    var hovered = null;  // transient mode from hover/focus

    function overlayFor(mode) {
      for (var i = 0; i < overlays.length; i++) {
        if (overlays[i].getAttribute('data-mode') === mode) return overlays[i];
      }
      return null;
    }

    function render() {
      var active = hovered || locked;   // hover/focus wins over a lock, transiently
      overlays.forEach(function (o) {
        o.classList.toggle('is-on', o.getAttribute('data-mode') === active);
      });
      controls.forEach(function (c) {
        var on = c.getAttribute('data-mode') === active;
        c.classList.toggle('is-active', on);
        if (c.hasAttribute('aria-pressed')) {
          c.setAttribute('aria-pressed', c.getAttribute('data-mode') === locked ? 'true' : 'false');
        }
      });
      if (active) atlas.classList.add('is-touched');
      if (srEl) {
        srEl.textContent = active && notes[active]
          ? (notes[active].name + ': ' + notes[active].note)
          : '';
      }
    }

    controls.forEach(function (c) {
      var mode = c.getAttribute('data-mode');

      c.addEventListener('mouseenter', function () { hovered = mode; render(); });
      c.addEventListener('mouseleave', function () {
        if (hovered === mode) hovered = null;
        render();
      });
      // keyboard focus mirrors hover (transient highlight while tabbing through)
      c.addEventListener('focus', function () { hovered = mode; render(); });
      c.addEventListener('blur', function () {
        if (hovered === mode) hovered = null;
        render();
      });
      // click / tap toggles a sticky lock for that mode
      c.addEventListener('click', function (ev) {
        ev.preventDefault();
        locked = (locked === mode) ? null : mode;
        hovered = locked ? null : hovered;
        render();
      });
      // Space / Enter on a focused control toggles the lock (button semantics)
      c.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault();
          locked = (locked === mode) ? null : mode;
          render();
        } else if (ev.key === 'Escape') {
          locked = null; hovered = null; render();
        }
      });
    });

    // Tapping the depth frame itself clears a lock (intuitive "tap away").
    var frame = $('.noise-atlas__frame', atlas);
    if (frame) {
      frame.addEventListener('click', function () {
        if (locked) { locked = null; hovered = null; render(); }
      });
    }

    render();
  }

  /* =========================================================== B. SEVERITY DEMO
   * Cross-fades a stack of pre-baked frames. ONE generic engine drives both the
   * severity slider (#noise-severity, a range input over the severity frames)
   * and the per-family build-up (#noise-family, a row of step pills). Each stage
   * holds N <img class="noise-demo__img" data-i="k"> layers; we toggle .is-shown
   * on exactly one and update the readout from the embedded JSON.
   */
  function frameLabel(meta) {
    // meta: {label, valid, rmse_mm}; build a compact mono readout string.
    if (!meta) return '';
    var pct = (typeof meta.valid === 'number')
      ? Math.round(meta.valid * 100) + '% valid' : '';
    var rmse = (typeof meta.rmse_mm === 'number' && meta.rmse_mm > 0)
      ? ' · ' + meta.rmse_mm.toFixed(0) + ' mm err' : '';
    return pct + rmse;
  }

  function initStage(stageId, frames) {
    // stageId -> the .noise-demo__stage; frames -> ordered metadata array.
    var stage = document.getElementById(stageId);
    if (!stage) return null;
    var imgs = $all('.noise-demo__img', stage);
    var readout = $('.noise-demo__readout', stage);
    if (!imgs.length) return null;

    function show(i) {
      i = clamp(i | 0, 0, imgs.length - 1);
      imgs.forEach(function (im, k) { im.classList.toggle('is-shown', k === i); });
      if (readout && frames && frames[i]) {
        var m = frames[i];
        readout.innerHTML = '<b>' + (m.label || '') + '</b>'
          + (frameLabel(m) ? ' &nbsp;' + frameLabel(m) : '');
      }
      return i;
    }
    return { stage: stage, imgs: imgs, show: show, count: imgs.length };
  }

  function initSeverity(simMeta) {
    var ctl = initStage('noise-severity', simMeta ? simMeta.severity : null);
    if (!ctl) return;
    var range = $('#noise-severity-range');
    var ticks = $all('#noise-severity-ticks li');
    var srEl = $('.noise-sr', ctl.stage.closest('.noise-demo__panel') || document);

    function setIdx(i, announce) {
      i = ctl.show(i);
      if (range) range.value = String(i);
      ticks.forEach(function (t, k) { t.classList.toggle('is-active', k === i); });
      if (announce && srEl && simMeta && simMeta.severity[i]) {
        var m = simMeta.severity[i];
        srEl.textContent = 'Severity ' + (m.label || '') + ', '
          + frameLabel(m).replace('·', 'and');
      }
    }

    if (range) {
      range.setAttribute('min', '0');
      range.setAttribute('max', String(ctl.count - 1));
      range.setAttribute('step', '1');
      range.addEventListener('input', function () { setIdx(parseInt(range.value, 10) || 0, true); });
    }
    ticks.forEach(function (t, k) {
      t.addEventListener('click', function () { setIdx(k, true); });
    });

    // start at clean (index 0)
    setIdx(0, false);
  }

  function initFamily(simMeta) {
    var ctl = initStage('noise-family', simMeta ? simMeta.family : null);
    if (!ctl) return;
    var steps = $all('#noise-family-steps .noise-step');
    var srEl = $('.noise-sr', ctl.stage.closest('.noise-demo__panel') || document);
    if (!steps.length) return;

    function setStep(i, announce) {
      i = ctl.show(i);
      steps.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
      if (announce && srEl && simMeta && simMeta.family[i]) {
        var m = simMeta.family[i];
        srEl.textContent = m.label + ', ' + frameLabel(m).replace('·', 'and');
      }
    }

    steps.forEach(function (s, k) {
      s.addEventListener('click', function () { setStep(k, true); });
      s.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault(); setStep(k, true);
        } else if (ev.key === 'ArrowRight') {
          ev.preventDefault(); setStep(k + 1, true);
          if (steps[clamp(k + 1, 0, steps.length - 1)]) steps[clamp(k + 1, 0, steps.length - 1)].focus();
        } else if (ev.key === 'ArrowLeft') {
          ev.preventDefault(); setStep(k - 1, true);
          if (steps[clamp(k - 1, 0, steps.length - 1)]) steps[clamp(k - 1, 0, steps.length - 1)].focus();
        }
      });
    });

    // start at the +holes step (index 0) per user preference; the steps let the
    // reader build up +edge bleed -> +wrong surfaces.
    setStep(0, false);
  }

  /* ============================================================ bootstrap */
  function init() {
    initAtlas();
    var simMeta = readJSON('noise-sim-frames');
    initSeverity(simMeta);
    initFamily(simMeta);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  try { window.NiseNoise = window.NiseNoise || { rescan: init }; } catch (e) {}
})();
