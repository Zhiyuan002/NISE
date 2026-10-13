/* ============================================================================
 * NISE project site — hand-rolled, dependency-free, animated SVG charts.
 *
 * Renders two figures inline as SVG (no Chart.js / D3 / external anything; works
 * fully offline). Exposes window.NISECharts and AUTO-RENDERS on DOMContentLoaded
 * into:
 *     #nise-chart-cliff      — degradation mean±std line chart, two panels (RLBench | MetaWorld)
 *     #nise-chart-realrobot  — real-robot grouped bar chart, two task groups
 *
 * Aesthetic: "Calibrated" — instrument-grade editorial science. Mono numerals,
 * hairline rules, restrained terracotta SIGNAL accent for the NISE ("ours")
 * series. Signature motion = the cliff: baseline mean-trend lines descend
 * Clean->Saturated while the NISE line holds high, then the margin bracket draws
 * in last.
 *
 * Accessibility: each SVG is role="img" with an aria-label summarizing the
 * takeaway; every marker / bar is keyboard-focusable with an ARIA description and
 * a tooltip reachable by focus, hover, AND click. prefers-reduced-motion -> final
 * state renders immediately.
 *
 * Self-contained: data is embedded below (no fetch).
 * ========================================================================== */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------ data */

  // Cliff data — task-averaged success rate (%), mean ± STD across three
  // independent training runs. Matches camera-ready Table 2 (2026-10-13).
  // mean[] and std[] are indexed by dose
  // (Clean / Mild / Saturated). The chart draws each method's three (mean, std)
  // pairs as a BOX-LINE plot: a box spanning [mean - std, mean + std] with a
  // horizontal MEAN LINE across it, and the per-method MEAN trend LINE connecting
  // the boxes across doses. The box edges are mean ± 1 std — they are NOT
  // quartiles; the paper reports mean ± std (not a five-number summary), so this
  // is deliberately a mean±std box, not a Tukey boxplot.
  var CLIFF_DATA = {
    statOrder: 'task-averaged success (%), mean ± std across three training runs',
    doses: ['Clean', 'Mild', 'Saturated'],
    sensorBandDoses: ['Mild', 'Saturated'],
    sensorBandNote: 'Corruption presets bracket sensor statistics measured with RealSense D405 and Azure Kinect; saturated is the stress-test endpoint.',
    panels: [
      {
        key: 'rlbench',
        title: 'RLBench PerAct-18',
        yLabel: 'Success rate (%)',
        series: [
          { name: '3D Diffuser Actor', color: '#1F5F9C', mean: [64.8, 60.2, 47.8], std: [9.1, 9.7, 12.0] },
          { name: 'RVT-2', color: '#2F6B4F', mean: [65.2, 62.4, 48.5], std: [9.5, 9.4, 13.8] },
          { name: 'SAM2Act', color: '#6B4488', mean: [68.1, 63.7, 50.9], std: [9.8, 8.9, 11.9] },
          { name: 'NISE (ours)', color: '#C4622D', ours: true, mean: [89.0, 85.7, 84.1], std: [4.3, 4.5, 4.6] }
        ]
      },
      {
        key: 'metaworld',
        title: 'MetaWorld',
        yLabel: 'Success rate (%)',
        series: [
          { name: 'DP3', color: '#9F8DA8', mean: [68.3, 60.5, 36.8], std: [13.6, 14.2, 19.8] },
          { name: 'FlowPolicy', color: '#A48B50', mean: [69.6, 61.4, 37.2], std: [13.8, 13.9, 19.3] },
          { name: 'ManiFlow', color: '#6E8B8B', mean: [70.5, 62.8, 37.0], std: [15.7, 15.1, 18.5] },
          { name: 'NISE (ours)', color: '#C4622D', ours: true, mean: [79.0, 78.2, 77.4], std: [6.3, 8.6, 9.4] }
        ]
      }
    ]
  };

  var ROBOT_DATA = {
    n: 30,
    ciNote: 'Error bars: Wilson 95% confidence intervals; N = 30 trials per (task, method).',
    methods: [
      { name: 'DP3', color: '#9F8DA8' },
      { name: '3DDA', color: '#1F5F9C' },
      { name: 'RVT-2', color: '#2F6B4F' },
      { name: 'NISE (ours)', color: '#C4622D', ours: true }
    ],
    groups: [
      {
        group: 'Single-arm (UR5e)',
        tasks: [
          { task: 'Assemble the Gear', material: 'reflective / specular gear', vals: [{ k: 4, rate: 13.3, ci: [5.3, 29.7] }, { k: 7, rate: 23.3, ci: [11.8, 40.9] }, { k: 11, rate: 36.7, ci: [21.9, 54.5] }, { k: 25, rate: 83.3, ci: [66.4, 92.7] }] },
          { task: 'Remove the Petri Lid', material: 'transparent lid & rim', vals: [{ k: 6, rate: 20, ci: [9.5, 37.3] }, { k: 10, rate: 33.3, ci: [19.2, 51.2] }, { k: 5, rate: 16.7, ci: [7.3, 33.6] }, { k: 20, rate: 66.7, ci: [48.8, 80.8] }] },
          { task: 'Insert the Metal Pipe', material: 'reflective metal, tight insertion', vals: [{ k: 3, rate: 10, ci: [3.5, 25.6] }, { k: 8, rate: 26.7, ci: [14.2, 44.4] }, { k: 12, rate: 40, ci: [24.6, 57.7] }, { k: 22, rate: 73.3, ci: [55.6, 85.8] }] }
        ]
      },
      {
        group: 'Bimanual (UR3e)',
        tasks: [
          { task: 'Pour Test Tube into Mortar', material: 'transparent tube', vals: [{ k: 2, rate: 6.7, ci: [1.8, 21.3] }, { k: 6, rate: 20, ci: [9.5, 37.3] }, { k: 4, rate: 13.3, ci: [5.3, 29.7] }, { k: 13, rate: 43.3, ci: [27.4, 60.8] }] },
          { task: 'Vision-Sorted Gear Collection', material: 'reflective gears, visual partition', vals: [{ k: 4, rate: 13.3, ci: [5.3, 29.7] }, { k: 3, rate: 10, ci: [3.5, 25.6] }, { k: 7, rate: 23.3, ci: [11.8, 40.9] }, { k: 16, rate: 53.3, ci: [36.1, 69.8] }] }
        ]
      }
    ]
  };

  /* -------------------------------------------------------------- utilities */

  var REDUCED_MOTION = (function () {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  })();

  function el(tag, attrs, children) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined) continue;
        n.setAttribute(k, String(v));
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (children[i] != null) n.appendChild(children[i]);
      }
    }
    return n;
  }

  function svgText(x, y, str, cls, extra) {
    var a = { x: x, y: y, class: cls };
    if (extra) { for (var k in extra) a[k] = extra[k]; }
    var t = el('text', a);
    t.textContent = str;
    return t;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  /* -------------------------------------------------------- tooltip (single) */

  var Tooltip = (function () {
    var node = null;
    function ensure() {
      if (node) return node;
      node = document.createElement('div');
      node.className = 'nise-tooltip';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      document.body.appendChild(node);
      return node;
    }
    function show(html, clientX, clientY) {
      var n = ensure();
      n.innerHTML = html;
      n.classList.add('is-visible');
      position(clientX, clientY);
    }
    function position(clientX, clientY) {
      if (!node) return;
      var pad = 12;
      var rect = node.getBoundingClientRect();
      var w = rect.width || 180, h = rect.height || 80;
      var x = clientX + 14;
      var y = clientY + 14;
      var vw = window.innerWidth, vh = window.innerHeight;
      if (x + w + pad > vw) x = clientX - w - 14;
      if (x < pad) x = pad;
      if (y + h + pad > vh) y = clientY - h - 14;
      if (y < pad) y = pad;
      node.style.left = x + 'px';
      node.style.top = y + 'px';
    }
    function hide() {
      if (node) node.classList.remove('is-visible');
    }
    return { show: show, hide: hide, position: position };
  })();

  // For keyboard focus we anchor the tooltip to the focused element's box.
  function tooltipAtElement(target, html) {
    var r = target.getBoundingClientRect();
    Tooltip.show(html, r.left + r.width / 2, r.top);
  }

  /* ---------------------------------------------------------- replay button */

  function makeReplayButton(label, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nise-replay';
    btn.setAttribute('aria-label', label);
    var glyph = '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<path class="nise-replay__glyph" d="M13 8a5 5 0 1 1-1.46-3.54"/>' +
      '<path class="nise-replay__glyph" d="M12.5 2.2 V5 H9.7"/></svg>';
    btn.innerHTML = glyph + '<span>Replay</span>';
    btn.addEventListener('click', onClick);
    return btn;
  }

  /* --------------------------------------------------- intersection trigger */

  function onceInView(node, cb) {
    if (REDUCED_MOTION || typeof IntersectionObserver === 'undefined') {
      cb(false); // animate=false -> snap to final
      return;
    }
    var fired = false;
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting && !fired) {
          fired = true;
          io.disconnect();
          cb(true);
        }
      }
    }, { threshold: 0.28 });
    io.observe(node);
  }

  /* ============================================================ CHART 1: cliff
   * Two panels share one legend. Each method is one series across the three
   * doses (Clean/Mild/Saturated), drawn as a BOX-LINE plot: at every dose a BOX
   * spans [mean - 1 std, mean + 1 std] with a horizontal MEAN LINE across it at
   * y = mean, and the per-method MEAN trend LINE connects the boxes across the
   * three doses (box + line). Box edges are mean ± 1 std — NOT quartiles; the
   * paper reports mean ± std (Table 2), not a five-number summary, so this is a
   * mean±std box, not a Tukey boxplot. NISE (terracotta) reads as the "ours"
   * series and holds high+flat while the baselines descend: the cliff. The Mild
   * dose is shaded as the commercial-sensor range. Signature animation: trend
   * lines draw L->R, then boxes grow from their mean baseline (and mean lines
   * fade in), then the margin bracket draws in last at Saturated.
   * ====================================================================== */

  // FIGURE-WIDE box geometry (Variant A): one fixed box width + one fixed
  // inter-box pitch for the ENTIRE figure, so every box is identical regardless
  // of how many methods a panel has. The old code sized boxes per-panel as
  // slotUsable / nSer, which made the 3-method MetaWorld panel render fatter
  // boxes than the 4-method RLBench panel. Here BOX_W is constant; each dose
  // group's n boxes are laid out at a constant (BOX_W + INTER_BOX) pitch and the
  // whole group is CENTRED in its dose slot.
  var CLIFF_BOX_W = 16;     // fixed box width, all panels, all groups
  var CLIFF_INTER_BOX = 6;  // fixed gap between adjacent boxes in a group
  // Monotonic counter giving each rendered panel a unique gradient-id namespace
  // (Style 5 fills). Incremented per renderCliffPanel call so the responsive
  // re-render and the two sibling panels never share <linearGradient> ids.
  var CLIFF_GRAD_SEQ = 0;

  function renderCliffPanel(panel, opts) {
    // Geometry (SVG user units; scaled responsively via viewBox)
    var W = 460, H = 300;
    var M = { top: 16, right: 26, bottom: 38, left: 46 };
    var plotW = W - M.left - M.right;
    var plotH = H - M.top - M.bottom;
    var x0 = M.left, y0 = M.top;
    var baselineY = y0 + plotH; // y for value 0

    var doses = CLIFF_DATA.doses;
    var nDose = doses.length;
    var series = panel.series;
    var nSer = series.length;

    var yOf = function (v) { return y0 + plotH * (1 - v / 100); }; // value in [0,100]

    // Doses are evenly spaced along x with a half-slot inset on each edge so the
    // boxes never touch the panel borders.
    var slot = plotW / nDose;
    var doseCenterX = function (di) { return x0 + slot * (di + 0.5); };
    // Uniform box width for the whole figure. Each dose group's nSer boxes are
    // tiled at a constant pitch (BOX_W + INTER_BOX) and the group is centred in
    // its slot, so a 3-box group and a 4-box group use the SAME box width.
    var boxW = CLIFF_BOX_W;
    var boxPitch = CLIFF_BOX_W + CLIFF_INTER_BOX; // centre-to-centre spacing
    // x of box (dose di, series si): centre the nSer-wide group on the slot.
    var markerX = function (di, si) {
      var span = (nSer - 1) * boxPitch;            // centre-to-centre extent of the group
      var start = doseCenterX(di) - span / 2;
      return start + si * boxPitch;
    };

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': opts.ariaLabel
    });

    var defs = el('defs');
    svg.appendChild(defs);

    // ---- Style 5 "soft gradient box" fills ----
    // One vertical <linearGradient> per method colour: faint at the std edges
    // (top/bottom), denser toward the mean band (50%), so the box reads as a
    // soft fade that is strongest at the mean. NISE ("ours") uses a stronger
    // fade than baselines, so the terracotta series reads as the densest/solid
    // box. Gradients are namespaced per render (UID below) so the responsive
    // re-render — which rebuilds the SVG — never collides ids with a prior
    // build or with the sibling panel. Deduped by colour so both dose groups
    // (and the 3- and 4-method panels) reuse the same fills cleanly.
    var gradUID = 'cg' + (CLIFF_GRAD_SEQ++);
    var gradIdByColor = {};
    var gradByColor = function (color, ours) {
      if (gradIdByColor[color]) return gradIdByColor[color];
      var gid = gradUID + '_' + Object.keys(gradIdByColor).length;
      var edge = ours ? 0.10 : 0.03;   // opacity at the ±std edges
      var center = ours ? 0.40 : 0.13; // opacity at the mean band (denser)
      var lg = el('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' });
      lg.appendChild(el('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': edge }));
      lg.appendChild(el('stop', { offset: '50%', 'stop-color': color, 'stop-opacity': center }));
      lg.appendChild(el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': edge }));
      defs.appendChild(lg);
      gradIdByColor[color] = gid;
      return gid;
    };

    // ---- commercial-sensor band across the Mild..Saturated doses ----
    var bandDoses = CLIFF_DATA.sensorBandDoses ||
                    (CLIFF_DATA.sensorBandDose ? [CLIFF_DATA.sensorBandDose] : ['Mild']);
    var bandIdxs = bandDoses.map(function (d) { return doses.indexOf(d); })
                            .filter(function (i) { return i >= 0; });
    if (bandIdxs.length) {
      var bFrom = Math.min.apply(null, bandIdxs);
      var bTo = Math.max.apply(null, bandIdxs);
      var bandX = x0 + slot * bFrom;
      var bandW = slot * (bTo - bFrom + 1);
      svg.appendChild(el('rect', { x: bandX, y: y0, width: bandW, height: plotH, class: 'nc-band-rect' }));
      svg.appendChild(el('line', { x1: bandX, y1: y0, x2: bandX, y2: baselineY, class: 'nc-band-edge' }));
      svg.appendChild(el('line', { x1: bandX + bandW, y1: y0, x2: bandX + bandW, y2: baselineY, class: 'nc-band-edge' }));
      var bandLabel = svgText(bandX + bandW / 2, y0 + 9, 'COMMERCIAL SENSOR RANGE', 'nc-band-text', { 'text-anchor': 'middle' });
      svg.appendChild(bandLabel);
    }

    // ---- y grid + ticks (0..100) ----
    var ticks = [0, 20, 40, 60, 80, 100];
    var gridG = el('g');
    ticks.forEach(function (tv) {
      var yy = yOf(tv);
      gridG.appendChild(el('line', {
        x1: x0, y1: yy, x2: x0 + plotW, y2: yy,
        class: tv === 0 ? 'nc-grid-line nc-grid-line--zero' : 'nc-grid-line'
      }));
      gridG.appendChild(svgText(x0 - 6, yy + 3.2, String(tv), 'nc-tick-text', { 'text-anchor': 'end' }));
    });
    svg.appendChild(gridG);

    // y axis title (rotated)
    var yt = svgText(0, 0, panel.yLabel, 'nc-axis-title', {
      'text-anchor': 'middle',
      transform: 'translate(' + (x0 - 32) + ',' + (y0 + plotH / 2) + ') rotate(-90)'
    });
    svg.appendChild(yt);

    // x axis baseline
    svg.appendChild(el('line', { x1: x0, y1: baselineY, x2: x0 + plotW, y2: baselineY, class: 'nc-axis-line' }));

    // x tick labels (dose)
    doses.forEach(function (d, di) {
      svg.appendChild(svgText(doseCenterX(di), baselineY + 16, d, 'nc-tick-text--x', { 'text-anchor': 'middle' }));
    });

    // ---- trend lines (one per series across doses), drawn UNDER markers ----
    var trendG = el('g');
    var trendPaths = [];
    series.forEach(function (s, si) {
      var pts = s.mean.map(function (mv, di) { return [markerX(di, si), yOf(mv)]; });
      var d = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var path = el('path', {
        d: d,
        class: 'nc-trend' + (s.ours ? ' nc-trend--ours' : ''),
        stroke: s.color
      });
      trendG.appendChild(path);
      trendPaths.push({ path: path, series: s, pts: pts });
    });
    svg.appendChild(trendG);

    // ---- boxes ([mean - std, mean + std]) + mean lines (drawn over trend) ----
    // Each box is a filled rect (series colour, low alpha) with a hairline stroke
    // in the series colour, plus a horizontal MEAN LINE at y = mean. Together with
    // the trend line that connects the means this reads as a box-line plot. NISE
    // ("ours") is rendered more prominently (heavier fill + stroke + mean line).
    var marksG = el('g');
    var markAnim = [];   // {boxRect, meanLine, group, baselineMeanY} — boxes grow from mean, mean line fades
    var hitTargets = [];

    series.forEach(function (s, si) {
      s.mean.forEach(function (mv, di) {
        var sd = s.std[di];
        var cx = markerX(di, si);
        var yMean = yOf(mv);
        // ±1 std clamped to the [0,100] plotting range
        var hiV = Math.min(100, mv + sd);
        var loV = Math.max(0, mv - sd);
        var yHi = yOf(hiV), yLo = yOf(loV);   // yHi is the TOP edge (mean+std), yLo the bottom
        var boxTop = Math.min(yHi, yLo);
        var boxH = Math.max(1.2, Math.abs(yLo - yHi)); // guard against a degenerate zero-std box
        var boxLeft = cx - boxW / 2;
        var meanW = s.ours ? 4.2 : 3.0;       // mean-line stroke weight; ours heavier (Style 5)

        var g = el('g', { class: 'nc-box-group' + (s.ours ? ' nc-box-group--ours' : '') });

        // box body (Style 5 "soft gradient box"): [mean-std, mean+std], filled
        // with a method-keyed VERTICAL GRADIENT (denser toward the mean band,
        // fading at the std edges) + a hairline edge. NISE ("ours") uses a
        // stronger fade so terracotta reads densest. Square corners (rx 1.5).
        var boxRect = el('rect', {
          x: boxLeft, y: boxTop, width: boxW, height: boxH, rx: 1.5,
          class: 'nc-box' + (s.ours ? ' nc-box--ours' : ''),
          fill: 'url(#' + gradByColor(s.color, s.ours) + ')', stroke: s.color
        });
        g.appendChild(boxRect);

        // crisp solid mean line: horizontal, across the full box width, at
        // y = mean. butt cap so the mean reads as a sharp rule (Style 5).
        var meanLine = el('line', {
          x1: boxLeft, y1: yMean, x2: boxLeft + boxW, y2: yMean,
          class: 'nc-meanline' + (s.ours ? ' nc-meanline--ours' : ''),
          stroke: s.color, 'stroke-width': meanW
        });
        g.appendChild(meanLine);

        // The box edges show ±1 std. Current Table 2 provides no run extrema,
        // so the historical min-max whiskers are intentionally omitted.

        marksG.appendChild(g);

        // grow-from-mean baseline animation lives on the box rect; the mean line
        // fades in. transform-box=view-box so transform-origin is in SVG units.
        if (!REDUCED_MOTION) {
          boxRect.style.transformBox = 'view-box';
          boxRect.style.transformOrigin = cx.toFixed(1) + 'px ' + yMean.toFixed(1) + 'px';
          boxRect.style.transform = 'scaleY(0)';
          meanLine.style.opacity = '0';
        }
        markAnim.push({ boxRect: boxRect, meanLine: meanLine, group: g, dose: di, ser: si });

        // ---- interaction hit rect (covers the box extent + a small pad) ----
        var hitW = Math.max(boxW, 10) + 10;
        var hitX = cx - hitW / 2;
        var hitTop = boxTop - 4;
        var hitH = Math.max(14, boxH + 8);

        var tipHtml = cliffTooltipHTML(s, doses[di], mv, sd);
        var ariaDesc = s.name + ', ' + doses[di] + ' dose. Mean ' + fmtPctVal(mv) +
          ' plus or minus ' + fmtPctVal(sd) + ' standard deviation across three training runs. Box spans mean minus one std to mean plus one std.';

        var hit = el('rect', {
          x: hitX, y: hitTop, width: hitW, height: hitH,
          class: 'nc-hit',
          tabindex: '0',
          role: 'img',
          'aria-label': ariaDesc
        });
        var ring = el('rect', { x: hitX, y: hitTop, width: hitW, height: hitH, rx: 2, class: 'nc-focus-ring' });

        (function (hitEl, ringEl, html) {
          // hover (mouse) — tooltip tracks the cursor
          hitEl.addEventListener('mousemove', function (ev) { Tooltip.show(html, ev.clientX, ev.clientY); });
          hitEl.addEventListener('mouseenter', function (ev) { Tooltip.show(html, ev.clientX, ev.clientY); });
          hitEl.addEventListener('mouseleave', function () { Tooltip.hide(); });
          // keyboard focus — anchor tooltip to the marker, show focus ring
          hitEl.addEventListener('focus', function () { ringEl.style.opacity = '1'; tooltipAtElement(hitEl, html); });
          hitEl.addEventListener('blur', function () { ringEl.style.opacity = '0'; Tooltip.hide(); });
          // CLICK / tap — pin the exact value at the marker (touch-friendly; no
          // hover required). Re-anchors the tooltip to the marker each click.
          hitEl.addEventListener('click', function () { tooltipAtElement(hitEl, html); });
          // keyboard activation (Enter / Space) mirrors click
          hitEl.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
              ev.preventDefault();
              tooltipAtElement(hitEl, html);
            }
          });
        })(hit, ring, tipHtml);

        hitTargets.push({ hit: hit, ring: ring });
        marksG.appendChild(ring);
        marksG.appendChild(hit);
      });
    });
    svg.appendChild(marksG);

    // ---- margin bracket at Saturated dose: NISE mean vs best-baseline mean ----
    var satIdx = doses.length - 1;
    var oursSer = null, oursSi = -1;
    series.forEach(function (s, si) { if (s.ours) { oursSer = s; oursSi = si; } });
    // best baseline = highest mean at saturated dose (excluding ours)
    var bestBaseMean = -1, bestBaseSi = -1;
    series.forEach(function (s, si) {
      if (s.ours) return;
      var m = s.mean[satIdx];
      if (m > bestBaseMean) { bestBaseMean = m; bestBaseSi = si; }
    });
    var bracketG = el('g', { class: 'nc-bracket' });
    if (oursSer && bestBaseSi >= 0) {
      var oursMean = oursSer.mean[satIdx];
      var yOurs = yOf(oursMean);
      var yBase = yOf(bestBaseMean);
      // bracket sits just right of the saturated group
      var bxX = x0 + plotW - 4;
      var tick = 5;
      var d = 'M' + (bxX - tick) + ' ' + yBase.toFixed(1) +
        ' H' + bxX +
        ' V' + yOurs.toFixed(1) +
        ' H' + (bxX - tick);
      var bracketPath = el('path', { d: d, class: 'nc-bracket-line' });
      bracketG.appendChild(bracketPath);

      // Place the label between the SD boxes so it does not hide their bounds.
      var bestBaseUpper = Math.max.apply(null, series.filter(function (s) {
        return !s.ours;
      }).map(function (s) { return s.mean[satIdx] + s.std[satIdx]; }));
      var gapTop = yOf(oursMean - oursSer.std[satIdx]);
      var gapBottom = yOf(bestBaseUpper);
      var note = saturatedMarginNote(panel);
      var pillW = note.length * 5.6 + 12;
      var pillH = 15;
      var midY = gapBottom - gapTop >= pillH + 4
        ? (gapTop + gapBottom) / 2 : (yOurs + yBase) / 2;
      var pillX = bxX - tick - pillW - 4;
      var pill = el('rect', { x: pillX, y: midY - pillH / 2, width: pillW, height: pillH, rx: 7.5, class: 'nc-bracket-pill-bg' });
      var pillTxt = svgText(pillX + pillW / 2, midY + 3.4, note, 'nc-bracket-text', { 'text-anchor': 'middle' });
      bracketG.appendChild(pill);
      bracketG.appendChild(pillTxt);

      // store for animation
      bracketG.__path = bracketPath;
    }
    svg.appendChild(bracketG);

    return {
      svg: svg,
      animate: function (doAnimate) {
        runCliffAnimation(doAnimate, {
          markAnim: markAnim,
          trendPaths: trendPaths,
          bracketG: bracketG,
          nDose: nDose
        });
      }
    };
  }

  function runCliffAnimation(doAnimate, ctx) {
    var markAnim = ctx.markAnim;
    var trendPaths = ctx.trendPaths;
    var bracketG = ctx.bracketG;

    // Prepare trend dash for draw-on
    trendPaths.forEach(function (tp) {
      var len = 0;
      try { len = tp.path.getTotalLength(); } catch (e) { len = 300; }
      tp.len = len || 300;
    });

    if (!doAnimate || REDUCED_MOTION) {
      // snap to final — boxes at full height, mean lines visible
      markAnim.forEach(function (t) {
        t.boxRect.style.transform = 'none';
        t.meanLine.style.opacity = '1';
        if (t.caps) t.caps.forEach(function (c) { c.style.opacity = '1'; });
      });
      trendPaths.forEach(function (tp) {
        tp.path.style.strokeDasharray = (tp.series && tp.series.ours) ? 'none' : '5 4';
        tp.path.style.strokeDashoffset = '0';
      });
      if (bracketG) {
        bracketG.style.opacity = '1';
        if (bracketG.__path) {
          bracketG.__path.style.strokeDasharray = 'none';
          bracketG.__path.style.strokeDashoffset = '0';
        }
      }
      return;
    }

    // initial hidden states — lines drawn first, boxes collapsed to their mean
    trendPaths.forEach(function (tp) {
      tp.path.style.strokeDasharray = tp.len + ' ' + tp.len;
      tp.path.style.strokeDashoffset = String(tp.len);
    });
    markAnim.forEach(function (m) {
      m.boxRect.style.transform = 'scaleY(0)';
      m.meanLine.style.opacity = '0';
      if (m.caps) m.caps.forEach(function (c) { c.style.opacity = '0'; });
    });
    if (bracketG) {
      bracketG.style.opacity = '0';
      if (bracketG.__path) {
        var bl = 0;
        try { bl = bracketG.__path.getTotalLength(); } catch (e) { bl = 60; }
        bracketG.__path.__len = bl || 60;
        bracketG.__path.style.strokeDasharray = (bl || 60) + ' ' + (bl || 60);
        bracketG.__path.style.strokeDashoffset = String(bl || 60);
      }
    }

    var t0 = performance.now();
    var TREND_START = 0;       // trend lines draw first
    var TREND_DUR = 520;
    var MARK_START = 320;      // markers + error bars fade in after lines begin
    var MARK_DUR = 360;
    var MARK_STAGGER = 70;     // per method stagger
    var MARK_DOSE_STAGGER = 40;
    var BRACKET_START = 820;   // margin bracket draws in last
    var BRACKET_DUR = 320;
    var TOTAL = 1180;

    function frame(now) {
      var t = now - t0;

      // trend lines draw L->R
      trendPaths.forEach(function (tp) {
        var p = clamp01((t - TREND_START) / TREND_DUR);
        var e = easeOutCubic(p);
        tp.path.style.strokeDashoffset = String(tp.len * (1 - e));
      });

      // boxes grow from their mean baseline + mean lines fade in, staggered by
      // method then dose
      markAnim.forEach(function (mg) {
        var delay = MARK_START + mg.ser * MARK_STAGGER + mg.dose * MARK_DOSE_STAGGER;
        var p = clamp01((t - delay) / MARK_DUR);
        var e = easeOutCubic(p);
        mg.boxRect.style.transform = 'scaleY(' + e.toFixed(4) + ')';
        mg.meanLine.style.opacity = String(e);
        if (mg.caps) mg.caps.forEach(function (c) { c.style.opacity = String(e); });
      });

      // bracket draws + fades in last
      if (bracketG) {
        var bp = clamp01((t - BRACKET_START) / BRACKET_DUR);
        var be = easeOutCubic(bp);
        bracketG.style.opacity = String(be);
        if (bracketG.__path && bracketG.__path.__len) {
          bracketG.__path.style.strokeDashoffset = String(bracketG.__path.__len * (1 - be));
        }
      }

      if (t < TOTAL) {
        requestAnimationFrame(frame);
      } else {
        // settle final
        markAnim.forEach(function (mg) {
          mg.boxRect.style.transform = 'none';
          mg.meanLine.style.opacity = '1';
          if (mg.caps) mg.caps.forEach(function (c) { c.style.opacity = '1'; });
        });
        trendPaths.forEach(function (tp) {
          tp.path.style.strokeDashoffset = '0';
          tp.path.style.strokeDasharray = (tp.series && tp.series.ours) ? 'none' : '5 4';
        });
        if (bracketG) {
          bracketG.style.opacity = '1';
          if (bracketG.__path) bracketG.__path.style.strokeDashoffset = '0';
        }
      }
    }
    requestAnimationFrame(frame);
  }

  function cliffTooltipHTML(s, dose, mean, std) {
    // Reveals the EXACT value as "Method — Dose: mean ± std%"
    var valueLine = esc(s.name) + ' — ' + esc(dose) + ': ' + fmtPctVal(mean) + ' ± ' + fmtPctVal(std).replace('%', '') + '%';
    return '' +
      '<div class="nise-tooltip__title"><span class="sw" style="background:' + s.color + '"></span>' + esc(s.name) + '</div>' +
      '<div class="nise-tooltip__sub">' + esc(dose) + ' dose &middot; success rate</div>' +
      '<div class="nise-tooltip__rows">' +
      rowHi('mean', fmtPctVal(mean)) +
      row('std across 3 runs', fmtPctVal(std)) +
      '</div>' +
      '<div class="nise-tooltip__exact">' + valueLine + '</div>';
  }

  /* ====================================================== CHART 2: real-robot
   * Outer groups (Single-arm / Bimanual) with header pills; inside each, one
   * cluster per task; inside each task, 4 bars (DP3,3DDA,RVT-2,NISE) in fixed
   * colors. Each bar carries a Wilson 95% CI whisker and a "%"-value label.
   * Animation: bars grow up (staggered), CI whiskers fade in, value labels
   * count up from 0.
   * ====================================================================== */

  function renderRobotChart(opts) {
    opts = opts || {};
    var data = ROBOT_DATA;
    var methods = data.methods;
    var nMethod = methods.length;

    // Which groups to draw in THIS svg. The wide (desktop / tablet) layout
    // passes all groups; the narrow layout calls this once per group so each
    // gets a taller, less-crowded SVG (see renderRobot()).
    var groups = opts.groups || data.groups;
    var drawGroupBands = opts.drawGroupBands !== false; // suppress per-group band+divider when a single group fills the svg

    // flatten task list with group boundaries
    var flat = [];
    var groupSpans = [];
    groups.forEach(function (g) {
      var startIdx = flat.length;
      g.tasks.forEach(function (t) { flat.push({ group: g.group, task: t }); });
      groupSpans.push({ name: g.group, start: startIdx, end: flat.length });
    });
    var nTask = flat.length;

    // geometry (overridable so the narrow layout can use a taller/narrower box)
    var W = opts.W || 920, H = opts.H || 360;
    var M = opts.M || { top: 22, right: 14, bottom: 64, left: 44 };
    var plotW = W - M.left - M.right;
    var plotH = H - M.top - M.bottom;
    var x0 = M.left, y0 = M.top;
    var baselineY = y0 + plotH;

    var yOf = function (pctVal) { return y0 + plotH * (1 - pctVal / 100); }; // 0..100

    var GROUP_GAP = groups.length > 1 ? 26 : 0; // extra gap between outer groups (none when single group)
    var nGap = groups.length - 1;
    var taskW = (plotW - GROUP_GAP * nGap) / nTask;
    var taskPad = taskW * (opts.taskPadFrac || 0.16);
    var clusterW = taskW - taskPad * 2;
    var barGap = clusterW * 0.10 / (nMethod - 1);
    var barW = (clusterW - barGap * (nMethod - 1)) / nMethod;

    // cumulative x of a task index (accounting for group gaps)
    function taskLeft(ti) {
      var gapsBefore = 0;
      for (var gi = 0; gi < groupSpans.length; gi++) {
        if (ti >= groupSpans[gi].end) gapsBefore++;
      }
      return x0 + taskW * ti + GROUP_GAP * gapsBefore;
    }
    function taskCenter(ti) { return taskLeft(ti) + taskW / 2; }
    function barX(ti, mi) {
      return taskLeft(ti) + taskPad + mi * (barW + barGap);
    }

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': opts.ariaLabel
    });

    // y grid + ticks (0..100)
    var ticks = [0, 20, 40, 60, 80, 100];
    var gridG = el('g');
    ticks.forEach(function (tv) {
      var yy = yOf(tv);
      gridG.appendChild(el('line', {
        x1: x0, y1: yy, x2: x0 + plotW, y2: yy,
        class: tv === 0 ? 'nc-grid-line nc-grid-line--zero' : 'nc-grid-line'
      }));
      gridG.appendChild(svgText(x0 - 6, yy + 3.2, String(tv), 'nc-tick-text', { 'text-anchor': 'end' }));
    });
    svg.appendChild(gridG);

    // y axis title
    svg.appendChild(svgText(0, 0, 'Success rate (%)', 'nc-axis-title', {
      'text-anchor': 'middle',
      transform: 'translate(' + (x0 - 32) + ',' + (y0 + plotH / 2) + ') rotate(-90)'
    }));

    // x baseline
    svg.appendChild(el('line', { x1: x0, y1: baselineY, x2: x0 + plotW, y2: baselineY, class: 'nc-axis-line' }));

    // group dividers + band labels along the bottom (suppressed when a single
    // group already fills the svg — the group is named by the sub-head above it)
    if (drawGroupBands) {
      groupSpans.forEach(function (gs, gi) {
        var left = taskLeft(gs.start);
        var right = taskLeft(gs.end - 1) + taskW;
        // group label band under the task labels
        svg.appendChild(svgText((left + right) / 2, baselineY + 50, gs.name.toUpperCase(), 'nc-group-band-text', { 'text-anchor': 'middle' }));
        // small rule under the group's tasks
        svg.appendChild(el('line', { x1: left + 2, y1: baselineY + 40, x2: right - 2, y2: baselineY + 40, class: 'nc-group-divider' }));
      });
      // vertical dashed divider between the two outer groups
      if (groupSpans.length > 1) {
        var divX = (taskLeft(groupSpans[0].end - 1) + taskW + taskLeft(groupSpans[1].start)) / 2;
        svg.appendChild(el('line', { x1: divX, y1: y0 - 6, x2: divX, y2: baselineY + 30, class: 'nc-group-divider' }));
      }
    }

    var barAnim = [];     // {rect, x, finalY, finalH}
    var ciAnim = [];      // {node}
    var labelAnim = [];   // {textNode, finalRate, x, y}

    flat.forEach(function (entry, ti) {
      var task = entry.task;
      // task label (wrap to two lines if long)
      var labelLines = wrapLabel(task.task, 18);
      labelLines.forEach(function (ln, li) {
        svg.appendChild(svgText(taskCenter(ti), baselineY + 14 + li * 11, ln, 'nc-bar-task-label', { 'text-anchor': 'middle' }));
      });

      task.vals.forEach(function (v, mi) {
        var m = methods[mi];
        var bx = barX(ti, mi);
        var yTop = yOf(v.rate);
        var barH = Math.max(0.8, baselineY - yTop);

        var rect = el('rect', {
          x: bx, y: yTop, width: barW, height: barH, rx: 1.2,
          class: 'nc-bar' + (m.ours ? ' nc-bar--ours' : ''),
          fill: m.color,
          stroke: m.ours ? darken(m.color) : 'none',
          'stroke-width': m.ours ? 0.8 : 0
        });
        svg.appendChild(rect);

        // CI whisker
        var ciG = el('g', { class: 'nc-ci-group' });
        var yLo = yOf(v.ci[0]), yHi = yOf(v.ci[1]);
        var cxBar = bx + barW / 2;
        var ciCap = Math.min(barW * 0.6, 7);
        ciG.appendChild(el('line', { x1: cxBar, y1: yHi, x2: cxBar, y2: yLo, class: 'nc-bar-ci' }));
        ciG.appendChild(el('line', { x1: cxBar - ciCap / 2, y1: yHi, x2: cxBar + ciCap / 2, y2: yHi, class: 'nc-bar-ci-cap' }));
        ciG.appendChild(el('line', { x1: cxBar - ciCap / 2, y1: yLo, x2: cxBar + ciCap / 2, y2: yLo, class: 'nc-bar-ci-cap' }));
        svg.appendChild(ciG);

        // value label above the upper CI cap (or above bar if CI low)
        var labelY = Math.min(yTop, yHi) - 5;
        var valTxt = svgText(cxBar, labelY, fmtPctVal(v.rate), 'nc-bar-value' + (m.ours ? ' nc-bar-value--ours' : ''), { 'text-anchor': 'middle' });
        svg.appendChild(valTxt);

        // interaction
        var ariaDesc = m.name + ', ' + task.task + '. ' + v.k + ' of ' + data.n + ' successes, ' +
          fmtPctVal(v.rate) + '. Wilson 95% confidence interval ' + v.ci[0] + ' to ' + v.ci[1] + ' percent. Material: ' + task.material + '.';
        var hit = el('rect', {
          x: bx - 1, y: y0, width: barW + 2, height: plotH,
          class: 'nc-hit', tabindex: '0', role: 'img', 'aria-label': ariaDesc
        });
        var ring = el('rect', { x: bx - 1.5, y: yTop - 2, width: barW + 3, height: barH + 4, rx: 2, class: 'nc-focus-ring' });
        svg.appendChild(ring);
        svg.appendChild(hit);

        var html = robotTooltipHTML(m, task, v, data.n);
        (function (hitEl, ringEl, h) {
          hitEl.addEventListener('mousemove', function (ev) { Tooltip.show(h, ev.clientX, ev.clientY); });
          hitEl.addEventListener('mouseenter', function (ev) { Tooltip.show(h, ev.clientX, ev.clientY); });
          hitEl.addEventListener('mouseleave', function () { Tooltip.hide(); });
          hitEl.addEventListener('focus', function () { ringEl.style.opacity = '1'; tooltipAtElement(hitEl, h); });
          hitEl.addEventListener('blur', function () { ringEl.style.opacity = '0'; Tooltip.hide(); });
        })(hit, ring, html);

        // animation bookkeeping
        if (!REDUCED_MOTION) {
          rect.style.transformBox = 'view-box';
          rect.style.transformOrigin = '0px ' + baselineY + 'px';
          rect.style.transform = 'scaleY(0)';
          ciG.style.opacity = '0';
          valTxt.style.opacity = '0';
        }
        barAnim.push({ node: rect, ti: ti, mi: mi });
        ciAnim.push({ node: ciG, ti: ti, mi: mi });
        labelAnim.push({ node: valTxt, finalRate: v.rate, ti: ti, mi: mi });
      });
    });

    return {
      svg: svg,
      // expose the per-element anim bookkeeping so a stacked (multi-svg) layout
      // can drive all sub-charts from one combined call
      barAnim: barAnim, ciAnim: ciAnim, labelAnim: labelAnim,
      animate: function (doAnimate) {
        runRobotAnimation(doAnimate, { barAnim: barAnim, ciAnim: ciAnim, labelAnim: labelAnim });
      }
    };
  }

  function runRobotAnimation(doAnimate, ctx) {
    var barAnim = ctx.barAnim, ciAnim = ctx.ciAnim, labelAnim = ctx.labelAnim;

    if (!doAnimate || REDUCED_MOTION) {
      barAnim.forEach(function (b) { b.node.style.transform = 'none'; });
      ciAnim.forEach(function (c) { c.node.style.opacity = '1'; });
      labelAnim.forEach(function (l) { l.node.style.opacity = '1'; l.node.textContent = fmtPctVal(l.finalRate); });
      return;
    }

    var t0 = performance.now();
    var BAR_DUR = 540;
    var TASK_STAGGER = 60;
    var METHOD_STAGGER = 42;
    var CI_START = 360;
    var CI_DUR = 280;
    var TOTAL = 1200;

    function frame(now) {
      var t = now - t0;
      barAnim.forEach(function (b) {
        var delay = b.ti * TASK_STAGGER + b.mi * METHOD_STAGGER;
        var p = clamp01((t - delay) / BAR_DUR);
        var e = easeOutCubic(p);
        b.node.style.transform = 'scaleY(' + e.toFixed(4) + ')';
      });
      ciAnim.forEach(function (c) {
        var delay = c.ti * TASK_STAGGER + c.mi * METHOD_STAGGER + CI_START;
        var p = clamp01((t - delay) / CI_DUR);
        c.node.style.opacity = String(easeOutCubic(p));
      });
      labelAnim.forEach(function (l) {
        var delay = l.ti * TASK_STAGGER + l.mi * METHOD_STAGGER;
        var p = clamp01((t - delay) / BAR_DUR);
        var e = easeOutCubic(p);
        l.node.style.opacity = String(Math.min(1, e * 1.3));
        l.node.textContent = fmtPctVal(l.finalRate * e);
      });
      if (t < TOTAL) requestAnimationFrame(frame);
      else {
        barAnim.forEach(function (b) { b.node.style.transform = 'none'; });
        ciAnim.forEach(function (c) { c.node.style.opacity = '1'; });
        labelAnim.forEach(function (l) { l.node.style.opacity = '1'; l.node.textContent = fmtPctVal(l.finalRate); });
      }
    }
    requestAnimationFrame(frame);
  }

  function robotTooltipHTML(m, task, v, n) {
    return '' +
      '<div class="nise-tooltip__title"><span class="sw" style="background:' + m.color + '"></span>' + esc(m.name) + '</div>' +
      '<div class="nise-tooltip__sub">' + esc(task.task) + ' &middot; ' + esc(task.material) + '</div>' +
      '<div class="nise-tooltip__rows">' +
      row('successes', v.k + ' / ' + n) +
      rowHi('rate', fmtPctVal(v.rate)) +
      row('Wilson 95%', '[' + v.ci[0] + ', ' + v.ci[1] + ']') +
      '</div>';
  }

  /* --------------------------------------------------------- shared HTML/util */

  function row(k, v) { return '<span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span>'; }
  function rowHi(k, v) { return '<span class="k">' + esc(k) + '</span><span class="v v--hi">' + esc(v) + '</span>'; }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function pct(v01) { return Math.round(v01 * 100) + '%'; }       // 0..1 -> "57%"
  function fmtPctVal(v) { return v.toFixed(1) + '%'; }            // already-percent
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function darken(hex) {
    var c = hexToRgb(hex);
    if (!c) return hex;
    var f = 0.62;
    return rgbToHex(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f));
  }
  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (x) { var h = x.toString(16); return h.length === 1 ? '0' + h : h; }).join('');
  }
  function wrapLabel(str, maxChars) {
    var words = str.split(' ');
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (test.length > maxChars && cur) { lines.push(cur); cur = words[i]; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 2);
  }

  /* --------------------------------------------------- legend / header DOM */

  // hex -> rgba(...) with alpha, for the box-glyph legend swatches
  function hexToRgba(hex, a) {
    hex = String(hex).replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(hex, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function buildLegend(series, opts) {
    opts = opts || {};
    var ul = document.createElement('ul');
    ul.className = 'nise-legend';
    series.forEach(function (s) {
      var li = document.createElement('li');
      li.className = 'nise-legend__item' + (s.ours ? ' nise-legend__item--ours' : '');
      var sw = document.createElement('span');
      // Box-glyph swatches (cliff): mirror the chart's Style-5 box-line plot —
      // a VERTICAL gradient of the method colour (denser at the mean band, fading
      // at the +/-std edges) + a hairline coloured edge, so every legend chip reads
      // as a miniature of its box (NISE/"ours" densest). Opacities are lifted from
      // the chart's faint box values so the colour is legible at swatch size.
      // The robot chart passes no opts -> solid swatches (unchanged).
      if (opts.boxGlyph) {
        // fill EVERY method's chip like NISE (uniform dense gradient, per user) —
        // NISE still stands out via its terracotta colour + the --ours border wash.
        var edge = 0.55;
        var center = 1.0;
        sw.className = 'nise-legend__swatch nise-legend__swatch--box';
        sw.style.background = 'linear-gradient(180deg, ' + hexToRgba(s.color, edge) + ' 0%, '
          + hexToRgba(s.color, center) + ' 50%, ' + hexToRgba(s.color, edge) + ' 100%)';
        sw.style.borderColor = s.color;
      } else if (opts.hollowBaselines && !s.ours) {
        sw.className = 'nise-legend__swatch nise-legend__swatch--hollow';
        sw.style.background = 'transparent';
        sw.style.borderColor = s.color;
      } else {
        sw.className = 'nise-legend__swatch';
        sw.style.background = s.color;
      }
      var label = document.createElement('span');
      label.textContent = s.name;
      li.appendChild(sw);
      li.appendChild(label);
      ul.appendChild(li);
    });
    return ul;
  }

  function chartHead(numeral, titleHTML, note) {
    var head = document.createElement('div');
    head.className = 'nise-chart__head';
    var num = document.createElement('span');
    num.className = 'nise-chart__numeral';
    num.textContent = numeral;
    var title = document.createElement('h3');
    title.className = 'nise-chart__title';
    title.innerHTML = titleHTML;
    head.appendChild(num);
    head.appendChild(title);
    if (note) {
      var n = document.createElement('span');
      n.className = 'nise-chart__note';
      n.textContent = note;
      head.appendChild(n);
    }
    return head;
  }

  /* ----------------------------------------------------- top-level renderers */

  // Derive annotations from the same values used by the plotted means.
  function saturatedMarginNote(panel) {
    var dose = CLIFF_DATA.doses.length - 1;
    var ours = panel.series.filter(function (s) { return s.ours; })[0];
    var best = Math.max.apply(null, panel.series.filter(function (s) {
      return !s.ours;
    }).map(function (s) { return s.mean[dose]; }));
    return '+' + (ours.mean[dose] - best).toFixed(1) + ' pp at saturated';
  }

  function renderCliff(container) {
    clearNode(container);
    container.classList.add('nise-chart');

    // Unified legend across both panels (union, ours last)
    var legendSeries = unionSeries(CLIFF_DATA.panels);

    var head = chartHead(
      '01',
      'The depth-corruption <em>cliff</em>',
      'Task-averaged success; mean ± std across 3 training runs (Table 2). Boxes = mean ± 1 std.'
    );
    container.appendChild(head);
    container.appendChild(buildLegend(legendSeries, { boxGlyph: true }));

    var panelsWrap = document.createElement('div');
    panelsWrap.className = 'nise-panels';

    var panelObjs = [];
    CLIFF_DATA.panels.forEach(function (panel, pi) {
      var pdiv = document.createElement('div');
      pdiv.className = 'nise-panel';

      var cap = document.createElement('div');
      cap.className = 'nise-panel__caption';
      var pnum = document.createElement('span');
      pnum.className = 'nise-panel__num';
      pnum.textContent = (pi === 0 ? '01a' : '01b');
      var plabel = document.createElement('span');
      plabel.className = 'nise-panel__label';
      plabel.textContent = panel.title;
      cap.appendChild(pnum);
      cap.appendChild(plabel);
      pdiv.appendChild(cap);

      var aria = 'Mean success-rate panel, ' + panel.title + '. Each method is shown as a box-line plot across the Clean, Mild, and Saturated depth-corruption doses: a box spanning mean minus one standard deviation to mean plus one standard deviation at each dose, a mean line across each box, and a trend line connecting the means. ' +
        'Baseline 3D policies fall while NISE (ours) holds near the top; ' + saturatedMarginNote(panel) + ' versus the best baseline.';
      var po = renderCliffPanel(panel, { ariaLabel: aria });
      pdiv.appendChild(po.svg);
      panelsWrap.appendChild(pdiv);
      panelObjs.push(po);
    });
    container.appendChild(panelsWrap);

    // commercial-sensor footnote
    var foot = document.createElement('p');
    foot.className = 'nise-foot';
    foot.textContent = CLIFF_DATA.sensorBandNote;
    container.appendChild(foot);

    // replay affordance
    var replay = makeReplayButton('Replay the degradation-cliff animation', function () {
      panelObjs.forEach(function (po) { po.animate(true); });
    });
    container.appendChild(replay);

    // animate on scroll-in (once)
    onceInView(container, function (doAnimate) {
      panelObjs.forEach(function (po) { po.animate(doAnimate); });
    });

    return { type: 'cliff', container: container };
  }

  function renderRobot(container) {
    clearNode(container);
    container.classList.add('nise-chart');

    var head = chartHead(
      '02',
      'Real-robot success on <em>transparent &amp; reflective</em> tasks',
      'Bars = success rate; whiskers = Wilson 95% CI.'
    );
    container.appendChild(head);
    container.appendChild(buildLegend(ROBOT_DATA.methods));

    var aria = 'Grouped bar chart of real-robot success rate across five manipulation tasks involving transparent and reflective materials, ' +
      'split into single-arm UR5e and bimanual UR3e groups. For every task, NISE (ours) achieves the highest success rate, ' +
      'with Wilson 95% confidence intervals shown.';

    var robotObj; // exposes .animate(doAnimate)

    if (widthBucket() === 's') {
      // ---- Narrow layout: stack the two task groups as separate taller, less
      // crowded sub-SVGs (mirrors how the cliff chart stacks its panels). At
      // ~390px the wide 920x360 box renders only ~122px tall with ~3px labels;
      // here each group fills the column with far fewer bars per row, so per-bar
      // width and label type grow back to legibility. ----
      var stack = document.createElement('div');
      stack.className = 'nise-robot-stack';

      var subObjs = [];
      ROBOT_DATA.groups.forEach(function (g, gi) {
        var sub = document.createElement('div');
        sub.className = 'nise-robot-substack';

        // sub-head: mono numeral (02a / 02b) + group name — echoes the panel motif
        var sh = document.createElement('div');
        sh.className = 'nise-robot-subhead';
        var shNum = document.createElement('span');
        shNum.className = 'nise-robot-subhead__num';
        shNum.textContent = '02' + String.fromCharCode(97 + gi); // 02a, 02b
        var shLbl = document.createElement('span');
        shLbl.className = 'nise-robot-subhead__label';
        shLbl.textContent = g.group;
        sh.appendChild(shNum);
        sh.appendChild(shLbl);
        sub.appendChild(sh);

        var subAria = 'Bar chart of real-robot success rate for the ' + g.group +
          ' task group. For every task, NISE (ours) achieves the highest success rate, ' +
          'with Wilson 95% confidence intervals shown.';
        var so = renderRobotChart({
          ariaLabel: subAria,
          groups: [g],
          drawGroupBands: false,
          W: 340, H: 300,
          M: { top: 20, right: 14, bottom: 46, left: 40 },
          taskPadFrac: 0.12
        });
        sub.appendChild(so.svg);
        stack.appendChild(sub);
        subObjs.push(so);
      });
      container.appendChild(stack);

      // one combined animate over all sub-charts (single rAF clock, see runRobotAnimation)
      robotObj = {
        animate: function (doAnimate) {
          var barAnim = [], ciAnim = [], labelAnim = [];
          subObjs.forEach(function (so) {
            barAnim = barAnim.concat(so.barAnim);
            ciAnim = ciAnim.concat(so.ciAnim);
            labelAnim = labelAnim.concat(so.labelAnim);
          });
          runRobotAnimation(doAnimate, { barAnim: barAnim, ciAnim: ciAnim, labelAnim: labelAnim });
        }
      };
    } else {
      // ---- Wide layout (tablet / desktop): single SVG with the two groups
      // side-by-side, fronted by group-name pills. ----
      var hdr = document.createElement('div');
      hdr.className = 'nise-group-headers';
      hdr.style.gridTemplateColumns = ROBOT_DATA.groups.map(function (g) { return g.tasks.length + 'fr'; }).join(' ');
      ROBOT_DATA.groups.forEach(function (g) {
        var pill = document.createElement('span');
        pill.className = 'nise-group-pill';
        var dot = document.createElement('span');
        dot.className = 'nise-group-pill__dot';
        var lbl = document.createElement('span');
        lbl.textContent = g.group;
        pill.appendChild(dot);
        pill.appendChild(lbl);
        var cell = document.createElement('div');
        cell.appendChild(pill);
        hdr.appendChild(cell);
      });
      container.appendChild(hdr);

      var ro = renderRobotChart({ ariaLabel: aria });
      container.appendChild(ro.svg);
      robotObj = ro;
    }

    var foot = document.createElement('p');
    foot.className = 'nise-foot';
    foot.textContent = ROBOT_DATA.ciNote;
    container.appendChild(foot);

    var replay = makeReplayButton('Replay the real-robot bar animation', function () { robotObj.animate(true); });
    container.appendChild(replay);

    onceInView(container, function (doAnimate) { robotObj.animate(doAnimate); });

    return { type: 'robot', container: container };
  }

  function unionSeries(panels) {
    var seen = {}, out = [], ours = null;
    panels.forEach(function (p) {
      p.series.forEach(function (s) {
        if (s.ours) { ours = { name: 'NISE (ours)', color: s.color, ours: true }; return; }
        if (!seen[s.name]) { seen[s.name] = true; out.push({ name: s.name, color: s.color }); }
      });
    });
    if (ours) out.push(ours);
    return out;
  }

  /* ----------------------------------------------------------------- mount */

  var MOUNTS = [
    { id: 'nise-chart-cliff', fn: renderCliff },
    { id: 'nise-chart-realrobot', fn: renderRobot }
  ];

  function renderAll() {
    MOUNTS.forEach(function (m) {
      var node = document.getElementById(m.id);
      if (node) {
        try { m.fn(node); }
        catch (e) {
          if (window.console && console.error) console.error('[NISECharts] failed to render #' + m.id, e);
        }
      }
    });
  }

  // Responsive: charts use viewBox so they rescale for free; we re-render only
  // on a *width-bucket* change so label wrapping / panel stacking stays crisp.
  var _lastBucket = null;
  function widthBucket() {
    var w = window.innerWidth;
    return w < 760 ? 's' : (w < 1100 ? 'm' : 'l');
  }
  var _resizeTimer = null;
  function onResize() {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () {
      var b = widthBucket();
      if (b !== _lastBucket) {
        _lastBucket = b;
        // re-render snaps to final state (no re-trigger of intro animation
        // mid-scroll); the IntersectionObserver re-arms for the new nodes.
        MOUNTS.forEach(function (m) {
          var node = document.getElementById(m.id);
          if (node) { try { m.fn(node); } catch (e) {} }
        });
      }
    }, 180);
  }

  function init() {
    _lastBucket = widthBucket();
    renderAll();
    window.addEventListener('resize', onResize, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ------------------------------------------------------------- public API */
  window.NISECharts = {
    renderAll: renderAll,
    renderCliff: function (idOrNode) { return renderCliff(resolve(idOrNode, 'nise-chart-cliff')); },
    renderRobot: function (idOrNode) { return renderRobot(resolve(idOrNode, 'nise-chart-realrobot')); },
    data: { cliff: CLIFF_DATA, robot: ROBOT_DATA },
    version: '1.1.0'
  };
  function resolve(idOrNode, fallbackId) {
    if (idOrNode && idOrNode.nodeType === 1) return idOrNode;
    if (typeof idOrNode === 'string') return document.getElementById(idOrNode);
    return document.getElementById(fallbackId);
  }

})();
