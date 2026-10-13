/* ============================================================================
 * NISE project site — interactive pipeline overlay (no deps, no network).
 *
 * Hovering (desktop pointer), focusing (keyboard Tab), or tapping (touch) a
 * pipeline-component hotspot reveals a COMPACT rationale tooltip anchored to
 * that component's box. The camera-ready figure is untouched; the hotspots are
 * %-positioned <button>s that scale with the responsive image, and the tooltip
 * is positioned in pixels relative to the figure frame so it tracks the box.
 *
 * Interaction model
 *   - pointerenter / focus  -> show that component's tooltip (preview)
 *   - pointerleave / blur   -> revert to the locked component, else hide
 *   - click / tap           -> lock that component (tap again, or tap outside,
 *                              to unlock); a locked component persists after the
 *                              pointer leaves so touch users keep the text
 *   - Escape                -> clear the lock and hide the tooltip
 *   - keyboard focus is itself a "show", so Tab-through reads each rationale
 *
 * The tooltip auto-flips above/below the box to stay inside the figure, and
 * clamps horizontally to the figure's edges. When the GCVSS or GM3A hotspot is
 * active, the matching contribution card below is softly highlighted to link
 * figure <-> card.
 *
 * Respects prefers-reduced-motion (transitions are CSS-gated separately).
 * ========================================================================== */
(function () {
  'use strict';

  function init() {
    var root   = document.getElementById('nise-pipe');
    var spots  = document.getElementById('nise-pipe-spots');
    var tip    = document.getElementById('nise-pipe-tip');
    var nameEl = document.getElementById('nise-pipe-tip-name');
    var tagEl  = document.getElementById('nise-pipe-tip-tag');
    var textEl = document.getElementById('nise-pipe-tip-text');
    var arrow  = document.getElementById('nise-pipe-tip-arrow');
    if (!root || !spots || !tip || !nameEl || !tagEl || !textEl || !arrow) return;

    var buttons = Array.prototype.slice.call(
      spots.querySelectorAll('.nise-pipe__spot'));
    if (!buttons.length) return;

    // GCVSS / GM3A contribution cards, keyed by the spot's data-card value, so
    // an active hotspot can softly highlight its card below the figure.
    var cards = {
      gcvss: document.querySelector('.nise-card--gcvss'),
      gm3a:  document.querySelector('.nise-card--gm3a')
    };

    var locked = null;   // the click/tap-locked button, or null
    var shown  = null;   // the button whose tooltip is currently visible

    function clearActive() {
      buttons.forEach(function (b) { b.classList.remove('is-active'); });
    }
    function clearCards() {
      Object.keys(cards).forEach(function (k) {
        if (cards[k]) cards[k].classList.remove('is-linked');
      });
    }

    function hide() {
      shown = null;
      clearActive();
      clearCards();
      tip.hidden = true;
      tip.classList.remove('is-visible', 'is-below');
    }

    // Position the tooltip against the active button's box, flipping above/below
    // to stay within the figure frame and clamping horizontally to its edges.
    function place(btn) {
      // On phones CSS puts the explanation in normal flow below the diagram.
      if (window.matchMedia('(max-width: 680px)').matches) return;
      var frame = root.getBoundingClientRect();
      var box   = btn.getBoundingClientRect();

      // Box geometry relative to the (position:relative) figure frame.
      var boxLeft   = box.left - frame.left;
      var boxTop    = box.top  - frame.top;
      var boxW      = box.width;
      var boxH      = box.height;
      var boxCx     = boxLeft + boxW / 2;
      var frameW    = frame.width;

      var GAP = 10;   // space between box edge and tooltip
      var PAD = 8;    // min inset from the frame's left/right edges

      // Measure the tooltip after content is set (it is display:block but
      // visibility hidden until placed, so offsetWidth/Height are valid).
      var tipW = tip.offsetWidth;
      var tipH = tip.offsetHeight;

      // Vertical: prefer below the box; flip above if it would overflow the
      // frame bottom and there is more room above.
      var below = true;
      var spaceBelow = frame.height - (boxTop + boxH);
      var spaceAbove = boxTop;
      if (spaceBelow < tipH + GAP && spaceAbove > spaceBelow) below = false;

      var top;
      if (below) {
        top = boxTop + boxH + GAP;
        tip.classList.add('is-below');
      } else {
        top = boxTop - tipH - GAP;
        tip.classList.remove('is-below');
      }
      // Clamp vertically inside the frame as a safety net.
      if (top < PAD) top = PAD;
      if (top + tipH > frame.height - PAD) top = Math.max(PAD, frame.height - PAD - tipH);

      // Horizontal: center on the box, clamp to the frame edges.
      var left = boxCx - tipW / 2;
      if (left < PAD) left = PAD;
      if (left + tipW > frameW - PAD) left = Math.max(PAD, frameW - PAD - tipW);

      tip.style.left = left + 'px';
      tip.style.top  = top + 'px';

      // Arrow points at the box center, clamped to the tooltip's own width.
      var arrowX = boxCx - left;
      arrowX = Math.max(14, Math.min(tipW - 14, arrowX));
      arrow.style.left = arrowX + 'px';
    }

    function render(btn) {
      if (!btn) { hide(); return; }
      shown = btn;
      clearActive();
      btn.classList.add('is-active');

      // data-name / data-philosophy may carry HTML entities (e.g. &mdash;,
      // &rsquo;) authored in the markup; assigning via innerHTML preserves them.
      nameEl.innerHTML = btn.getAttribute('data-name') || '';
      var tag = btn.getAttribute('data-tag') || '';
      if (tag) {
        tagEl.hidden = false;
        tagEl.textContent = tag;
      } else {
        tagEl.hidden = true;
        tagEl.textContent = '';
      }
      textEl.innerHTML = btn.getAttribute('data-philosophy') || '';

      // Link the matching contribution card, if any.
      clearCards();
      var cardKey = btn.getAttribute('data-card');
      if (cardKey && cards[cardKey]) cards[cardKey].classList.add('is-linked');

      // Reveal, then measure + position. Unhide first so offsetWidth is valid;
      // .is-visible drives the opacity/transform transition once placed.
      tip.hidden = false;
      place(btn);
      // Force reflow before adding the visibility class so the transition runs.
      void tip.offsetWidth;
      tip.classList.add('is-visible');
    }

    // Show on preview (hover / focus) without changing the lock.
    function preview(btn) { render(btn); }
    // Revert to the locked component, else hide.
    function revert() { render(locked); }

    function toggleLock(btn) {
      if (locked === btn) { locked = null; render(null); }
      else { locked = btn; render(btn); }
    }

    buttons.forEach(function (btn) {
      // Desktop pointer hover (skip touch — handled by click/tap).
      btn.addEventListener('pointerenter', function (ev) {
        if (ev.pointerType === 'touch') return;
        preview(btn);
      });
      btn.addEventListener('pointerleave', function (ev) {
        if (ev.pointerType === 'touch') return;
        revert();
      });
      // Fallback for engines that fire mouse events without pointer events.
      btn.addEventListener('mouseenter', function () { preview(btn); });
      btn.addEventListener('mouseleave', function () { revert(); });

      // Keyboard focus reads the rationale; blur reverts to the lock/default.
      btn.addEventListener('focus', function () { preview(btn); });
      btn.addEventListener('blur', function () { revert(); });

      // Click / tap locks (and toggles) the component. preventDefault keeps a
      // tap from also firing a synthetic hover-then-leave that would clear it.
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        toggleLock(btn);
      });
    });

    // Tap / click outside any hotspot clears the lock (touch ergonomics).
    document.addEventListener('pointerdown', function (ev) {
      if (!ev.target.closest('.nise-pipe__spot') &&
          !ev.target.closest('.nise-pipe__tip')) {
        if (locked) { locked = null; render(null); }
      }
    });

    // Escape clears a lock when a hotspot has focus.
    spots.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && (locked || shown)) {
        locked = null;
        render(null);
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
      }
    });

    // Keep an open tooltip aligned to its box when the layout shifts (the image
    // is responsive, so the %-boxes move). Re-place the currently shown spot.
    function reposition() { if (shown) place(shown); }
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, { passive: true });

    hide();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
