/* ============================================================================
 * NISE supplementary site — Simulation-results HERO: the corrupted RLBench
 * point cloud a 3D policy actually consumes.
 *
 * A three.js orbit viewer of ONE real RLBench PerAct-18 frame (stack_cups,
 * `front` workspace camera), back-projected to a WORLD-frame point cloud from
 * the frame's own depth + intrinsics + extrinsics. The asset carries TWO clouds:
 *   - corrupted : depth after the project's SATURATED noise model (§3) — what
 *                 the policy sees. Fewer points (drop-outs = holes) + floaters.
 *   - clean     : the same frame's reference geometry (the toggle's "compare").
 * Points are coloured by their BAKED sensor RGB (the cloud is the real scene).
 * The CORRUPTED cloud is the default + the protagonist; a labelled toggle wipes
 * to the CLEAN reference so the holes/floaters read as a difference.
 *
 * Vendored, dependency-free at the page level, ZERO network at runtime: three.js
 * (core + OrbitControls) is the SAME vendored bundle the GCVSS/GM3A blocks use
 * (static/vendor/three/three.bundle.js -> window.__NISE_THREE__). The cloud is
 * base64-embedded in static/cloud/rlbench_sim_cloud.data.js ->
 * window.__NISE_RLBENCH_SIM_CLOUD__ (positions + colors per cloud); both must
 * load BEFORE this file.
 *
 * CLASSIC <script> (NOT a module). Deliberate, like gcvss3d.js: a bare file://
 * open gives the page the opaque 'null' origin, which Chromium CORS-blocks ES
 * module scripts from; a classic script + base64-inlined data have no such
 * restriction, so the orbit works whether served over http OR opened from disk.
 * No globals beyond one namespaced hook; three.js lives under window.__NISE_THREE__.
 *
 * Lifecycle (mirrors the GCVSS cloud panel):
 *   - LAZY init on IntersectionObserver; GL is DISPOSED when scrolled far
 *     offscreen and rebuilt on return (parsed buffers are cached, no re-decode)
 *   - on-demand render loop (idle viewer ~0 GPU); devicePixelRatio capped
 *   - orbit (drag) + zoom (wheel / pinch); pan disabled (subject stays centred)
 *   - a slow auto-orbit so the 3D reads even paused-on-a-frame; grabbing hands
 *     orbit to the user
 *   - GRACEFUL FALLBACK: no WebGL OR prefers-reduced-motion -> the static poster
 *     stays up, fully keyboard-reachable, no canvas, no animation; the toggle
 *     stays inert (the poster depicts the corrupted cloud).
 * ========================================================================== */
(function () {
  'use strict';

  /* Resolve asset URLs ABSOLUTE against THIS script's own location (read at
     parse time from document.currentScript, as in gcvss3d.js). Location-
     independent: works whether index.html is at the site root or a test harness
     lives in a subdirectory. */
  var SELF_URL =
    (document.currentScript && document.currentScript.src) || document.baseURI;
  function asURL(rel) {
    try { return new URL(rel, SELF_URL).href; } catch (e) { return rel; }
  }

  var REDUCED = false;
  try {
    REDUCED = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { REDUCED = false; }

  /* the two clouds the asset carries; corrupted is the default protagonist. */
  var CLOUDS = {
    corrupted: { id: 'corrupted', label: 'Corrupted', verdict: 'what the policy sees', cls: 'is-corrupted' },
    clean:     { id: 'clean',     label: 'Clean reference', verdict: 'reference geometry', cls: 'is-clean' }
  };
  var DEFAULT_CLOUD = 'corrupted';

  /* poster (fallback + pre-live frame) — relative to THIS script. */
  var POSTER = '../cloud/rlbench_sim_cloud_poster.png';

  /* --------------------------------------------------------- small helpers */
  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
  function ease(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* base64 (a packed little-endian Float32 buffer) -> Float32Array (cf. gm3a3d.js) */
  function b64ToF32(b64) {
    var bin = atob(b64);
    var n = bin.length;
    var bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }

  /* Feature-detect a usable WebGL context without leaking it (cf. gcvss3d.js). */
  function webglOK() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') ||
               c.getContext('webgl') ||
               c.getContext('experimental-webgl');
      if (!gl) return false;
      var lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (lose && lose.loseContext) { try { lose.loseContext(); } catch (e) {} }
      return true;
    } catch (e) { return false; }
  }

  /* ======================================================================= */
  /* ============================ CLOUD ORBIT ============================== */
  /* ======================================================================= */
  function SimCloudViewer(root) {
    this.root = root;
    this.poster = root.querySelector('.simres-cloud__poster');
    this.cloudId = DEFAULT_CLOUD;     // 'corrupted' (default) | 'clean'
    this.THREE = null;
    this.built = false;
    this.loading = false;
    this.disposed = false;
    this._raf = null;
    this._needsRender = true;         // on-demand rendering
    this._geoms = null;               // { corrupted:{geo,box}, clean:{...}, center, radius }
    this._pointObjs = {};             // id -> THREE.Points
    this._pointMats = {};             // id -> PointsMaterial
    this._meta = null;                // asset metadata (benchmark / noiseLevel / counts)
    // auto-orbit state
    this._orbit = { userOrbiting: false, paused: false, start: 0 };
    this._chip = null;                // { txt, verdict } DOM refs (optional)
  }

  /* Resolve the vendored three.js from the classic-script global the bundle
     publishes. No import(), no network; rejects clearly if the bundle failed to
     load (the caller turns that into the static-poster fallback). */
  SimCloudViewer.prototype.ensureThree = function () {
    if (this.THREE) return Promise.resolve(this.THREE);
    var NS = (typeof window !== 'undefined') ? window.__NISE_THREE__ : null;
    if (!NS || !NS.WebGLRenderer || !NS.OrbitControls) {
      return Promise.reject(new Error(
        'three.bundle.js not loaded (window.__NISE_THREE__ missing or incomplete)'));
    }
    this.THREE = { core: NS, OrbitControls: NS.OrbitControls };
    return Promise.resolve(this.THREE);
  };

  /* Decode BOTH clouds from the inlined global ONCE; build a BufferGeometry per
     cloud with baked-RGB vertex colours; compute a SHARED center + radius (from
     the corrupted cloud, the default subject) so the camera framing is stable
     across the toggle. Cached on the viewer (survives dispose/rebuild). */
  SimCloudViewer.prototype.ensureGeoms = function (T) {
    if (this._geoms) return Promise.resolve(this._geoms);
    var D = (typeof window !== 'undefined') ? window.__NISE_RLBENCH_SIM_CLOUD__ : null;
    if (!D || !D.corrupted || !D.corrupted.positions) {
      return Promise.reject(new Error('window.__NISE_RLBENCH_SIM_CLOUD__ missing or incomplete'));
    }
    var core = T.core;
    var self = this;

    function buildOne(block) {
      if (!block || !block.positions) return null;
      var pos = b64ToF32(block.positions);
      var geo = new core.BufferGeometry();
      geo.setAttribute('position', new core.BufferAttribute(pos, 3));
      if (block.colors) {
        var col = b64ToF32(block.colors);
        geo.setAttribute('color', new core.BufferAttribute(col, 3));
      }
      geo.computeBoundingBox();
      return { geo: geo, box: geo.boundingBox, count: block.count || (pos.length / 3) };
    }

    var corrupted = buildOne(D.corrupted);
    var clean = buildOne(D.clean);

    // frame on the CORRUPTED cloud (the default subject) so the holes/floaters
    // sit inside the view; the clean cloud shares the same frame for a clean wipe.
    var box = corrupted.box.clone();
    var center = new core.Vector3(); box.getCenter(center);
    var sphere = new core.Sphere(); box.getBoundingSphere(sphere);

    this._geoms = {
      corrupted: corrupted, clean: clean,
      center: center, radius: sphere.radius
    };
    this._meta = {
      benchmark: D.benchmark || 'RLBench PerAct-18',
      noiseLevel: D.noiseLevel || 'saturated',
      camera: D.camera || 'front',
      counts: { corrupted: corrupted ? corrupted.count : 0, clean: clean ? clean.count : 0 }
    };
    return Promise.resolve(this._geoms);
  };

  /* Build the live three.js scene (renderer + camera + controls + both clouds,
     only the active one visible). */
  SimCloudViewer.prototype.build = function () {
    var self = this;
    if (this.built || this.loading || this.disposed) return;
    this.loading = true;
    this.ensureThree()
      .then(function (T) { return self.ensureGeoms(T).then(function (g) { return { T: T, g: g }; }); })
      .then(function (r) {
        if (self.disposed) { self.loading = false; return; }
        self._construct(r.T, r.g);
        self.loading = false;
      })
      .catch(function (err) {
        // any failure (bundle, decode, GL) -> keep the poster up
        self.loading = false;
        if (window.console && console.warn) {
          console.warn('[simresults3d] cloud init failed; keeping poster.', err);
        }
      });
  };

  SimCloudViewer.prototype._construct = function (T, geoms) {
    var core = T.core;
    var root = this.root;
    var self = this;

    var renderer = new core.WebGLRenderer({
      antialias: true, alpha: true, powerPreference: 'low-power'
    });
    var pr = Math.min(window.devicePixelRatio || 1, 1.75);   // cap DPR for perf
    renderer.setPixelRatio(pr);
    var w = root.clientWidth || 640;
    var h = root.clientHeight || 400;
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);    // transparent -> CSS dark stage shows
    root.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    var scene = new core.Scene();
    var camera = new core.PerspectiveCamera(42, w / h, 0.01, 100);

    var controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;            // keep the subject centred
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.minDistance = geoms.radius * 0.5;
    controls.maxDistance = geoms.radius * 4.5;

    // both clouds as separate Points objects (so the toggle just flips visibility);
    // recentered on the corrupted-cloud centroid so orbit pivots about the subject.
    var group = new core.Group();
    Object.keys(CLOUDS).forEach(function (id) {
      var entry = geoms[id];
      if (!entry) return;
      var hasColor = !!entry.geo.getAttribute('color');
      var mat = new core.PointsMaterial({
        size: 0.0055,
        sizeAttenuation: true,
        vertexColors: hasColor,
        color: hasColor ? 0xffffff : 0xb9c2cc,
        transparent: true,
        opacity: 0.97
      });
      var pts = new core.Points(entry.geo, mat);
      pts.userData.id = id;
      pts.visible = (id === self.cloudId);
      group.add(pts);
      self._pointObjs[id] = pts;
      self._pointMats[id] = mat;
    });
    group.position.set(-geoms.center.x, -geoms.center.y, -geoms.center.z);
    scene.add(group);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.group = group;

    // initial framing: a 3/4 elevated view matching the static poster, saved as
    // the controls' reset state (so reset() also flushes any damping momentum).
    this._home = this._homeView();
    this._applyHome();
    controls.saveState();
    controls.addEventListener('change', function () { self._needsRender = true; });

    this.built = true;
    this.disposed = false;
    root.classList.add('is-live');

    this._reflectCloud(this.cloudId);

    this._needsRender = true;
    this._loop();

    this._onResize = function () { self._resize(); };
    window.addEventListener('resize', this._onResize);

    // begin the gentle auto-orbit (reduced-motion never reaches here)
    this._orbit.start = now();
    this._orbit.paused = false;
  };

  /* 'home' camera position from the cloud radius (data-space). Direction chosen
     to match the static poster's 3/4 elevated angle; +Z is the world up axis
     (RLBench world frame, table at z~0.75, floaters rise in +z). */
  SimCloudViewer.prototype._homeView = function () {
    var r = this._geoms.radius;
    var dir = new this.THREE.core.Vector3(0.46, -0.78, 0.46).normalize();
    var dist = r * 2.35;
    return { dir: dir, dist: dist };
  };
  SimCloudViewer.prototype._applyHome = function () {
    var h = this._home;
    this.camera.position.copy(h.dir).multiplyScalar(h.dist);
    this.camera.up.set(0, 0, 1);           // world frame: +Z up
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this._needsRender = true;
  };

  SimCloudViewer.prototype.reset = function () {
    if (!this.built || !this.controls) return;
    var controls = this.controls;
    var damp = controls.enableDamping;
    // flush leftover rotate/pan momentum (update() ADDS it before zeroing),
    // then reset() restores the saved home pose cleanly.
    controls.enableDamping = false;
    controls.update();
    controls.reset();
    controls.enableDamping = damp;
    this.camera.up.set(0, 0, 1);
    this._damp = false;
    // re-hand control to the auto-orbit
    this._orbit.userOrbiting = false;
    this._orbit.start = now();
    this._needsRender = true;
  };

  SimCloudViewer.prototype._resize = function () {
    if (!this.built || !this.renderer) return;
    var w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._needsRender = true;
  };

  /* On-demand render loop: paints only while damping settles, a change is
     pending, or the auto-orbit is running. Idle viewer costs ~0 GPU. */
  SimCloudViewer.prototype._loop = function () {
    var self = this;
    function frame() {
      if (self.disposed || !self.built) return;
      self._raf = requestAnimationFrame(frame);

      // gentle auto-orbit (unless the user grabbed, or reduced-motion/paused)
      if (!REDUCED && !self._orbit.userOrbiting && !self._orbit.paused && self._home) {
        var t = (now() - self._orbit.start) / 1000;
        var ang = t * 0.12;                     // slow sweep, rad/s
        var r = self._home.dist;
        var base = self._home.dir;
        var c = Math.cos(ang), s = Math.sin(ang);
        var x = base.x * c - base.y * s;
        var y = base.x * s + base.y * c;
        self.camera.position.set(x * r, y * r, base.z * r);
        self.camera.up.set(0, 0, 1);
        self.controls.target.set(0, 0, 0);
        self.camera.lookAt(0, 0, 0);
        self._needsRender = true;
      }

      var damping = self.controls && self.controls.enableDamping;
      if (self._needsRender || self._damp) {
        var stillMoving = self.controls ? self.controls.update() : false;
        self._damp = !!(damping && stillMoving);
        self.renderer.render(self.scene, self.camera);
        // keep painting while auto-orbit runs or damping settles
        self._needsRender = (!REDUCED && !self._orbit.userOrbiting && !self._orbit.paused) || self._damp;
      }
    }
    this._raf = requestAnimationFrame(frame);
  };

  /* ------------------------------------------------------- CLOUD SWITCHING */
  /* Flip which cloud is visible (corrupted <-> clean). Instant — both Points
     objects already live; we toggle visibility + update the chip/legend/toggle. */
  SimCloudViewer.prototype.setCloud = function (cloudId) {
    if (!CLOUDS[cloudId]) return;
    this.cloudId = cloudId;
    if (this.built) {
      var self = this;
      Object.keys(this._pointObjs).forEach(function (id) {
        if (self._pointObjs[id]) self._pointObjs[id].visible = (id === cloudId);
      });
      this._needsRender = true;
    }
    this._reflectCloud(cloudId);
  };
  SimCloudViewer.prototype.toggleCloud = function () {
    this.setCloud(this.cloudId === 'corrupted' ? 'clean' : 'corrupted');
  };

  /* update the toggle button + chip + the root data-attr to name the current
     cloud. All no-op if the markup isn't present (graceful). */
  SimCloudViewer.prototype._reflectCloud = function (cloudId) {
    var c = CLOUDS[cloudId] || CLOUDS[DEFAULT_CLOUD];
    try { this.root.setAttribute('data-cloud', c.id); } catch (e) {}
    var btn = this._toggleBtn;
    if (btn) {
      var other = (c.id === 'corrupted') ? CLOUDS.clean : CLOUDS.corrupted;
      var lbl = btn.querySelector('.simres-btn__lbl');
      if (lbl) lbl.textContent = other.label;
      btn.setAttribute('aria-pressed', c.id === 'clean' ? 'true' : 'false');
      btn.setAttribute('aria-label',
        'Showing the ' + c.label + ' cloud. Activate to show the ' + other.label + ' cloud.');
    }
    var chip = this._chip;
    if (chip) {
      if (chip.txt) chip.txt.textContent = c.label;
      if (chip.verdict) {
        chip.verdict.textContent = c.verdict;
        chip.verdict.className = 'simres-verdict simres-verdict--' + c.id;
      }
      // chip colour reflects state (corrupted = accent, clean = neutral)
      var dot = chip.dot;
      if (dot) dot.className = 'simres-chip__dot simres-chip__dot--' + c.id;
    }
    if (this._srEl) {
      var counts = this._meta ? this._meta.counts : null;
      var n = counts ? counts[c.id] : null;
      this._srEl.textContent = c.label + ' point cloud shown' +
        (n ? (' — ' + n.toLocaleString() + ' points') : '') + '.';
    }
  };

  /* Tear down the live GL rig (keep cached parsed geometries + DOM controls). */
  SimCloudViewer.prototype._teardownGL = function () {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    try { if (this.controls) this.controls.dispose(); } catch (e) {}
    var self = this;
    Object.keys(this._pointMats).forEach(function (id) {
      try { self._pointMats[id].dispose(); } catch (e) {}
    });
    // NOTE: do NOT dispose the cached geometries here — they survive a rebuild.
    try {
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer.forceContextLoss && this.renderer.forceContextLoss();
        if (this.renderer.domElement && this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
      }
    } catch (e) {}
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.group = null;
    this._pointObjs = {};
    this._pointMats = {};
    this.built = false;
    this.root.classList.remove('is-live');
  };

  /* Fully release GL resources (called when scrolled far offscreen). Cached
     parsed geometries are NOT discarded — only the live GPU scene — so a rebuild
     is instant and never re-decodes the base64. */
  SimCloudViewer.prototype.dispose = function () {
    if (!this.built) return;
    this.disposed = true;
    if (this._onResize) { window.removeEventListener('resize', this._onResize); this._onResize = null; }
    this._teardownGL();
    this.disposed = false;   // allow a later rebuild
  };

  /* Lifecycle: lazy build on enter, dispose when far offscreen. */
  SimCloudViewer.prototype.observe = function () {
    var self = this;
    if (typeof IntersectionObserver === 'undefined') {
      this.build();
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) self.build();
        else if (self.built) self.dispose();
      });
    }, { root: null, rootMargin: '300px 0px 300px 0px', threshold: 0.01 });
    io.observe(this.root);
  };

  /* wire the cloud toggle + reset + chip. All live regardless of build state. */
  SimCloudViewer.prototype.wireControls = function (refs) {
    var self = this;
    refs = refs || {};
    this._toggleBtn = refs.toggleBtn || null;
    this._resetBtn = refs.resetBtn || null;
    this._chip = refs.chip || null;
    this._srEl = refs.srEl || null;

    if (this._toggleBtn) {
      this._toggleBtn.addEventListener('click', function () { self.toggleCloud(); });
    }
    if (this._resetBtn) {
      this._resetBtn.addEventListener('click', function () { self.reset(); });
    }
    this._reflectCloud(this.cloudId);

    // Keyboard on the stage: 'r' reset orbit, 'c'/space toggles cloud.
    this.root.addEventListener('keydown', function (ev) {
      if (ev.key === 'r' || ev.key === 'R') { self.reset(); ev.preventDefault(); }
      else if (ev.key === 'c' || ev.key === 'C' || ev.key === ' ') {
        self.toggleCloud(); ev.preventDefault();
      }
    });
    // grab cursor + hand orbit to the user (pause auto-orbit)
    this.root.addEventListener('pointerdown', function () {
      self.root.classList.add('is-grabbing');
      self._orbit.userOrbiting = true;
    });
    window.addEventListener('pointerup', function () {
      self.root.classList.remove('is-grabbing');
    });
  };

  /* ======================================================================= */
  /* ================================= INIT ================================ */
  /* ======================================================================= */
  function init() {
    var root = document.getElementById('simres-cloud');
    if (!root || root.getAttribute('data-simres-ready') === '1') return;
    root.setAttribute('data-simres-ready', '1');

    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');

    // control refs (all optional; the JS no-ops on any that are absent)
    var toggleBtn = document.getElementById('simres-cloud-toggle');
    var resetBtn  = document.getElementById('simres-cloud-reset');
    var chipTxt   = document.getElementById('simres-chip-txt');
    var chipDot   = root.querySelector('.simres-chip__dot');
    var verdict   = document.getElementById('simres-verdict');
    var srEl      = root.querySelector('.simres-sr');
    var chip = { txt: chipTxt, dot: chipDot, verdict: verdict };

    // GRACEFUL FALLBACK: no WebGL OR reduced-motion -> keep the static poster
    // (the corrupted cloud). The toggle is inert in fallback (there is no live
    // cloud to flip); disable it so it doesn't promise interactivity it can't give.
    if (REDUCED || !webglOK()) {
      root.classList.add('is-static-fallback');
      root.setAttribute('data-cloud', DEFAULT_CLOUD);
      [toggleBtn, resetBtn].forEach(function (b) {
        if (!b) return;
        b.setAttribute('disabled', '');
        b.setAttribute('aria-disabled', 'true');
        b.setAttribute('title', REDUCED
          ? 'Disabled: reduced-motion is on (showing a static view of the corrupted cloud)'
          : 'Disabled: 3D viewer unavailable (showing a static view of the corrupted cloud)');
      });
      return;
    }

    try {
      var viewer = new SimCloudViewer(root);
      viewer.wireControls({ toggleBtn: toggleBtn, resetBtn: resetBtn, chip: chip, srEl: srEl });
      viewer.observe();
      // tiny namespaced handle for the verify harness / screenshots
      try { window.__niseSimCloud = viewer; } catch (e) {}
    } catch (e) {
      if (window.console && console.warn) console.warn('[simresults3d] setup failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Tiny namespaced re-scan hook (no other globals).
  try { window.NiseSimResults3D = window.NiseSimResults3D || { rescan: init }; } catch (e) {}
})();
