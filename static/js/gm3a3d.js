/* ============================================================================
 * NISE supplementary site — GM3A procedure explainer (animated, conceptual).
 *
 * An ANIMATED conceptual walk-through of the GM3A mechanism (paper §4.3) over the
 * REAL grasp cloud (11,925 captured points). Five looping steps, faithful to the
 * published equation  α_{k} = exp(−σ²·ω²/2)  (reliable coordinate → α≈1 → ordinary
 * 3D-RoPE; uncertain → keep the feature, attenuate brittle high-frequency phase):
 *
 *   1. EXACT POINTS (vanilla 3D-RoPE)  — every coordinate treated as exact (crisp,
 *      uniform-bright points). This is the "vanilla 3D-RoPE" end of the morph.
 *   2. UNCERTAINTY BLOOMS (sensor prior) — each token grows a Gaussian "body" sized
 *      by the REAL range law σ_z(z) (the teaser's "space body"). Grounded substrate.
 *   3. PER-TOKEN ADAPTATION (ILLUSTRATIVE) — the bodies adapt per token: larger on the
 *      transparent target + boundaries, smaller on reliable opaque surfaces. This is the
 *      GM3A idea (designed-to-learn reliability beyond range); the residual is a CONCEPT,
 *      labeled "illustrative" — NOT a measured per-point field.
 *   4. DAMPENING → TRUST — high-frequency rotary phase is attenuated where uncertainty
 *      is large; bodies collapse back to crisp points coloured by α (bright = trusted,
 *      dark = attenuated). Uncertain geometry is SOFTENED, not reconstructed. This is the
 *      "GM3A" end of the morph.
 *   5. RESULT — corrupted geometry steers the action less; trustworthy structure leads.
 *
 * Honesty split (see static/cloud/build_gm3a_cloud.py): the sensor prior (steps 2 & the
 * α_prior path) is REAL — the published equation on real geometry; the per-token material/
 * boundary adaptation (step 3 + the residual in αFull) is an ILLUSTRATIVE concept of what
 * GM3A is designed to learn, kept modest (per-token α std ~0.05). Nothing is presented as
 * measured per-scene evidence.
 *
 * Dependency-free at the page level, ZERO network at runtime. three.js (core + addons) is
 * the SAME vendored bundle the GCVSS block uses (static/vendor/three/three.bundle.js ->
 * window.__NISE_THREE__); cloud data is base64-embedded in static/cloud/gm3a_cloud.data.js
 * -> window.__NISE_GM3A_CLOUD__ (positions, alpha [prior], alphaFull, sigmaPrior, sigmaBoost,
 * lut/plasmaLUT [turbo], rgb). Both must load BEFORE this file.
 *
 * CLASSIC <script> (NOT a module): a bare file:// origin CORS-blocks ES-module scripts in
 * Chromium; a classic script + base64-inlined data have no such restriction, so the scene
 * works whether served over http OR opened directly from disk.
 *
 * Graceful fallback: no WebGL OR prefers-reduced-motion -> the static poster (the dampening
 * field, step 4) stays up, fully keyboard-reachable, no canvas; controls disabled. Lazy-inits
 * on scroll into view; disposes GL offscreen and rebuilds on return. One namespaced global
 * hook (window.NiseGm3a3D); three.js lives under window.__NISE_THREE__.
 * ========================================================================== */
(function () {
  'use strict';

  var REDUCED = false;
  try {
    REDUCED = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { REDUCED = false; }

  /* ------------------------------------------------------------- helpers */
  function webglOK() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl') ||
               c.getContext('experimental-webgl');
      if (!gl) return false;
      var lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (lose && lose.loseContext) { try { lose.loseContext(); } catch (e) {} }
      return true;
    } catch (e) { return false; }
  }

  /* base64 (a packed little-endian Float32 buffer) -> Float32Array */
  function b64ToF32(b64) {
    var bin = atob(b64);
    var n = bin.length;
    var bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }

  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* turbo(α) -> [r,g,b] from the inlined LUT (256*3 floats) */
  function lutRGB(lut, a, out) {
    var li = a <= 0 ? 0 : (a >= 1 ? 255 : (a * 255) | 0);
    var k = li * 3;
    out[0] = lut[k]; out[1] = lut[k + 1]; out[2] = lut[k + 2];
    return out;
  }

  /* ----------------------------------------------------------- procedure */
  /* Each step is a target STATE the scene tweens toward:
       bloomPrior : how much of the REAL σ_z body to show   [0..1]
       bloomBoost : how much of the ILLUSTRATIVE residual body to add [0..1]
       colorMode  : 'bright' (uniform trusted) | 'prior' (turbo α_prior) | 'full' (turbo αFull)
       halo       : soft additive glow strength             [0..1]
       focusBoost : how strongly to spotlight the illustrative regions [0..1]  */
  var STEPS = [
    { id: 0, key: 'exact',  bloomPrior: 0.0, bloomBoost: 0.0, colorMode: 'bright', halo: 0.0, focusBoost: 0.0,
      cn: 'Step 01 of 05', ct: 'Exact points — vanilla 3D attention treats every coordinate as exact.', illus: false },
    { id: 1, key: 'bloom',  bloomPrior: 1.0, bloomBoost: 0.0, colorMode: 'bright', halo: 0.85, focusBoost: 0.0,
      cn: 'Step 02 of 05', ct: 'Position uncertainty blooms — each token grows a Gaussian body sized by the real sensor range law.', illus: false },
    { id: 2, key: 'adapt',  bloomPrior: 1.0, bloomBoost: 1.0, colorMode: 'adapt', halo: 0.92, focusBoost: 1.0,
      cn: 'Step 03 of 05', ct: 'Per-token adaptation — GM3A is designed to learn reliability on rays, boundaries, and transparent or reflective materials.', illus: true },
    { id: 3, key: 'damp',   bloomPrior: 0.18, bloomBoost: 0.10, colorMode: 'full', halo: 0.18, focusBoost: 0.35,
      cn: 'Step 04 of 05', ct: 'Dampening — uncertain geometry is softened, reliable geometry stays sharp; colour shows α (bright = trusted, dark = attenuated).', illus: false },
    { id: 4, key: 'result', bloomPrior: 0.10, bloomBoost: 0.05, colorMode: 'full', halo: 0.10, focusBoost: 0.0,
      cn: 'Step 05 of 05', ct: 'Result — corrupted geometry steers the action less; the policy leans on trustworthy structure.', illus: false }
  ];
  var STEP_HOLD = [1700, 2100, 2400, 2400, 2200];   // ms each step holds before advancing
  var STEP_TWEEN = 900;                              // ms to morph between step states

  /* Default home camera, captured in the Open3D GUI (website/_build/gm3a_view_capture.py):
     dir = unit target->camera, up = world camera up, distR = distance / cloud radius
     (FOV-corrected from Open3D's 60 deg to this scene's 42 deg). */
  var HOME_DIR = [-0.49915, 0.21598, -0.83917];
  var HOME_UP = [-0.07556, -0.9756, -0.20615];
  var HOME_DISTR = 2.3416;

  /* round soft point sprite via a ShaderMaterial; gl_PointSize from per-vertex σ. */
  function makeMaterial(THREE) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uSizePx:    { value: 2.6 },     // base device-independent point size (px @ unit dist)
        uBloomK:    { value: 26.0 },    // px gain per unit normalized σ (the "space body" radius)
        uBloomP:    { value: 0.0 },     // [0..1] how much prior σ to bloom
        uBloomB:    { value: 0.0 },     // [0..1] how much illustrative residual σ to bloom
        uHalo:      { value: 0.0 },     // [0..1] soft glow strength
        uFocus:     { value: 0.0 },     // [0..1] spotlight illustrative regions
        uOpacity:   { value: 1.0 },     // global opacity (lowered for the Sensor-RGB overlay)
        uPixelR:    { value: 1.0 }      // devicePixelRatio (keeps point size crisp)
      },
      vertexShader: [
        'attribute float aSigma;',     // REAL prior σ_z, normalized [0,1]
        'attribute float aBoost;',     // ILLUSTRATIVE residual σ, normalized [0,1]
        'attribute vec3  aColor;',     // animated per-vertex colour (target buffer)
        'uniform float uSizePx; uniform float uBloomK; uniform float uBloomP;',
        'uniform float uBloomB; uniform float uHalo; uniform float uFocus; uniform float uPixelR;',
        'varying vec3 vColor; varying float vSoft;',
        'void main() {',
        '  vColor = aColor;',
        '  float bloom = uBloomP * aSigma + uBloomB * aBoost;',  // normalized body radius
        '  float focus = 1.0 + uFocus * 1.6 * aBoost;',          // spotlight illustrative pts
        '  vSoft = clamp(uHalo * (0.35 + 1.4 * bloom), 0.0, 1.0);',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  float sz = (uSizePx + uBloomK * bloom * focus) * uPixelR;',
        '  gl_PointSize = sz * (1.0 / -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'precision mediump float;',
        'uniform float uOpacity; varying vec3 vColor; varying float vSoft;',
        'void main() {',
        '  vec2 d = gl_PointCoord - vec2(0.5);',
        '  float r = length(d) * 2.0;',           // 0 center -> 1 edge
        '  if (r > 1.0) discard;',
        // crisp core + soft halo: a tight disc, fading into a gaussian-ish skirt
        '  float core = smoothstep(1.0, 0.55, r);',
        '  float halo = exp(-2.3 * r * r) * vSoft;',
        '  float a = max(core, halo) * uOpacity;',
        '  if (a <= 0.01) discard;',
        '  gl_FragColor = vec4(vColor, a);',
        '}'
      ].join('\n')
    });
  }

  /* ======================================================================= */
  function Gm3aViewer(root) {
    this.root = root;
    this.THREE = null;
    this.data = null;       // {count, positions, sigma, boost, alpha, alphaFull, rgb(opt), lut, center, radius}
    this.built = false;
    this.loading = false;
    this.disposed = false;
    this._raf = null;
    this._needsRender = true;

    // procedure state
    this.step = 0;
    this.playing = true;
    this.showRgb = false;
    this._rgbPoints = null; this._rgbGeo = null; this._rgbMat = null; this._rgbGroup = null;
    this._camTween = null;     // camera target/distance reframe tween (RGB compare)
    this._stepStart = 0;       // ms timestamp the current step began holding
    this._tween = null;        // {fromState, toState, start, dur}
    this._cur = this._snapState(STEPS[0]);   // live interpolated state
    this._colorTgt = null;     // current colour-target name driving aColor

    this.srEl = root.querySelector('.gm3a-sr');
    this.capN = root.querySelector('#gm3a-step-n');     // visible caption: number/label
    this.capT = root.querySelector('#gm3a-step-txt');   // visible caption: sentence
  }

  Gm3aViewer.prototype._snapState = function (s) {
    return { bloomPrior: s.bloomPrior, bloomBoost: s.bloomBoost, halo: s.halo, focusBoost: s.focusBoost };
  };

  Gm3aViewer.prototype.ensureThree = function () {
    if (this.THREE) return Promise.resolve(this.THREE);
    var NS = (typeof window !== 'undefined') ? window.__NISE_THREE__ : null;
    if (!NS || !NS.WebGLRenderer || !NS.OrbitControls || !NS.ShaderMaterial) {
      return Promise.reject(new Error('three.bundle.js not loaded (window.__NISE_THREE__ missing)'));
    }
    this.THREE = { core: NS, OrbitControls: NS.OrbitControls };
    return Promise.resolve(this.THREE);
  };

  /* Decode the inlined cloud once; cache positions + σ + colour targets. */
  Gm3aViewer.prototype.ensureData = function (T) {
    if (this.data) return Promise.resolve(this.data);
    var D = (typeof window !== 'undefined') ? window.__NISE_GM3A_CLOUD__ : null;
    if (!D || !D.positions || !D.alpha || !(D.plasmaLUT || D.lut)) {
      return Promise.reject(new Error('window.__NISE_GM3A_CLOUD__ missing or incomplete'));
    }
    var positions = b64ToF32(D.positions);
    var n = D.count || (positions.length / 3);
    var lut = b64ToF32(D.plasmaLUT || D.lut);
    var alpha = b64ToF32(D.alpha);                                   // REAL prior
    var alphaFull = D.alphaFull ? b64ToF32(D.alphaFull) : alpha;     // prior + illustrative residual
    var sigma = D.sigmaPrior ? b64ToF32(D.sigmaPrior) : new Float32Array(n);
    var boost = D.sigmaBoost ? b64ToF32(D.sigmaBoost) : new Float32Array(n);
    var rgb = null; if (D.rgb) { try { rgb = b64ToF32(D.rgb); } catch (e) { rgb = null; } }

    // precompute the three colour targets (N*3):
    //   bright : a single neutral light colour — points read as crisp EXACT geometry
    //            (steps 1–3 treat coordinates as exact; the dampening colormap is held
    //            back until step 4 so its reveal lands). NOT turbo(1) — turbo's high end
    //            is dark red, which would pre-empt the α ramp.
    //   prior  : turbo(α_prior)  — the REAL sensor-prior dampening field
    //   full   : turbo(αFull)    — prior + ILLUSTRATIVE residual (the GM3A concept)
    var bright = new Float32Array(n * 3);
    var cAdapt = new Float32Array(n * 3);
    var cPrior = new Float32Array(n * 3);
    var cFull = new Float32Array(n * 3);
    var BR = [0.86, 0.90, 0.96];                    // cool neutral white (exact-geometry look)
    var OR = [0.77, 0.38, 0.18];                    // NISE accent — spotlights the illustrative regions
    var tmp = [0, 0, 0];
    for (var i = 0; i < n; i++) {
      var j = i * 3;
      bright[j] = BR[0]; bright[j + 1] = BR[1]; bright[j + 2] = BR[2];
      // adapt: white base, tinted toward the NISE accent where the illustrative
      // residual is large (transparent target + boundaries) — a "GM3A is learning
      // reliability here" spotlight (clearly the illustrative step).
      var w = clamp01(boost[i] * 1.15);
      cAdapt[j]     = lerp(BR[0], OR[0], w);
      cAdapt[j + 1] = lerp(BR[1], OR[1], w);
      cAdapt[j + 2] = lerp(BR[2], OR[2], w);
      lutRGB(lut, alpha[i], tmp);     cPrior[j] = tmp[0]; cPrior[j + 1] = tmp[1]; cPrior[j + 2] = tmp[2];
      lutRGB(lut, alphaFull[i], tmp); cFull[j] = tmp[0]; cFull[j + 1] = tmp[1]; cFull[j + 2] = tmp[2];
    }

    var core = T.core;
    var box = new core.Box3();
    var v = new core.Vector3();
    for (var p = 0; p < n; p++) {
      v.set(positions[3 * p], positions[3 * p + 1], positions[3 * p + 2]);
      box.expandByPoint(v);
    }
    var center = new core.Vector3(); box.getCenter(center);
    var sphere = new core.Sphere(); box.getBoundingSphere(sphere);

    this.data = {
      count: n, positions: positions, sigma: sigma, boost: boost,
      colors: { bright: bright, adapt: cAdapt, prior: cPrior, full: cFull, rgb: rgb },
      center: center, radius: sphere.radius
    };
    return Promise.resolve(this.data);
  };

  Gm3aViewer.prototype.build = function () {
    var self = this;
    if (this.built || this.loading || this.disposed) return;
    this.loading = true;
    this.ensureThree()
      .then(function (T) { return self.ensureData(T).then(function () { return T; }); })
      .then(function (T) {
        if (self.disposed) { self.loading = false; return; }
        self._construct(T);
        self.loading = false;
      })
      .catch(function (err) {
        self.loading = false;
        if (window.console && console.warn) console.warn('[gm3a3d] init failed; keeping poster.', err);
      });
  };

  Gm3aViewer.prototype._construct = function (T) {
    var core = T.core;
    var root = this.root;
    var D = this.data;

    var renderer = new core.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    var pr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(pr);
    var w = root.clientWidth || 640, h = root.clientHeight || 400;
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    root.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    var scene = new core.Scene();
    var camera = new core.PerspectiveCamera(42, w / h, 0.01, 100);

    var controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.minDistance = D.radius * 0.5;
    controls.maxDistance = D.radius * 5.0;

    var geo = new core.BufferGeometry();
    geo.setAttribute('position', new core.BufferAttribute(D.positions, 3));
    geo.setAttribute('aSigma', new core.BufferAttribute(D.sigma, 1));
    geo.setAttribute('aBoost', new core.BufferAttribute(D.boost, 1));
    // animated colour attribute — starts at the current step's target (bright @ step 0)
    var startName = this._colorTargetForStep(this.step);
    var startBuf = D.colors[startName] || D.colors.bright;
    var colArr = new Float32Array(startBuf);
    geo.setAttribute('aColor', new core.BufferAttribute(colArr, 3));
    this._colorAttr = geo.getAttribute('aColor');
    this._colorTgt = startName;

    var material = makeMaterial(core);
    material.uniforms.uPixelR.value = pr;
    this._material = material;

    var points = new core.Points(geo, material);
    var group = new core.Group();
    group.add(points);
    group.position.set(-D.center.x, -D.center.y, -D.center.z);
    scene.add(group);

    // SECOND cloud: a crisp, real-sensor-RGB copy of the SAME geometry placed to the
    // LEFT, toggled on/off by the Sensor-RGB control. It shares this scene + camera, so
    // one orbit drags BOTH. The animated dampening cloud above is never recoloured/moved.
    this._sep = D.radius * 1.4;             // gap between the two cloud centres — close, no overlap
                                            // (cloud X half-extent ~0.52r, so centres need >1.03r)
    this._homeDist = D.radius * HOME_DISTR; // camera distance framing the single cloud (captured)
    // the side-by-side distance is computed aspect-aware in _frameForRgb (kept big + close)
    if (D.colors.rgb) {
      var rgeo = new core.BufferGeometry();
      rgeo.setAttribute('position', new core.BufferAttribute(D.positions, 3));
      rgeo.setAttribute('aSigma', new core.BufferAttribute(new Float32Array(D.count), 1)); // 0 -> crisp
      rgeo.setAttribute('aBoost', new core.BufferAttribute(new Float32Array(D.count), 1)); // 0 -> no bloom
      rgeo.setAttribute('aColor', new core.BufferAttribute(new Float32Array(D.colors.rgb), 3));
      var rmat = makeMaterial(core);        // bloom/halo/focus default 0, opacity 1 -> crisp RGB points
      rmat.uniforms.uPixelR.value = pr;
      var rpoints = new core.Points(rgeo, rmat);
      rpoints.visible = this.showRgb;
      var rgroup = new core.Group();
      rgroup.position.set(-D.center.x - this._sep, -D.center.y, -D.center.z);
      rgroup.add(rpoints);
      scene.add(rgroup);
      this._rgbPoints = rpoints; this._rgbGeo = rgeo; this._rgbMat = rmat; this._rgbGroup = rgroup;
    }

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.group = group;
    this._geo = geo;

    this._applyHome();
    controls.saveState();
    var self = this;
    controls.addEventListener('change', function () { self._needsRender = true; });

    this.built = true;
    this.disposed = false;
    root.classList.add('is-live');

    // begin the procedure
    this._cur = this._snapState(STEPS[this.step]);
    this._applyUniforms(this._cur);
    this._tween = null;
    this._stepStart = now();
    this._caption(this.step);
    this._reflectStepUI();

    this._needsRender = true;
    this._loop();
    this._onResize = function () { self._resize(); };
    window.addEventListener('resize', this._onResize);
  };

  Gm3aViewer.prototype._applyHome = function () {
    var core = this.THREE.core;
    var r = this.data.radius;
    var dir = new core.Vector3(HOME_DIR[0], HOME_DIR[1], HOME_DIR[2]).normalize();
    this.camera.position.copy(dir).multiplyScalar(r * HOME_DISTR);
    this.camera.up.set(HOME_UP[0], HOME_UP[1], HOME_UP[2]);
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this._needsRender = true;
  };

  Gm3aViewer.prototype.reset = function () {
    if (!this.built || !this.controls) return;
    var controls = this.controls;
    var damp = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.reset();
    controls.enableDamping = damp;
    this.camera.up.set(HOME_UP[0], HOME_UP[1], HOME_UP[2]);
    this._damp = false;
    this._frameForRgb(this.showRgb, false);   // keep both clouds framed if RGB compare is on
    this._needsRender = true;
  };

  /* which colour target a given step uses */
  Gm3aViewer.prototype._colorTargetForStep = function (i) {
    var m = STEPS[i] ? STEPS[i].colorMode : 'bright';
    if (m === 'full') return 'full';
    if (m === 'prior') return 'prior';
    if (m === 'adapt') return 'adapt';
    return 'bright';
  };

  Gm3aViewer.prototype._applyUniforms = function (st) {
    if (!this._material) return;
    var u = this._material.uniforms;
    u.uBloomP.value = st.bloomPrior;
    u.uBloomB.value = st.bloomBoost;
    u.uHalo.value = st.halo;
    u.uFocus.value = st.focusBoost;
  };

  /* snap (or morph) the per-vertex colour buffer to a named target */
  Gm3aViewer.prototype._setColorTarget = function (name, animate) {
    if (!this.built || !this._colorAttr) return;
    var tgt = this.data.colors[name] || this.data.colors.bright;
    this._colorTgt = name;
    if (!animate) {
      this._colorAttr.array.set(tgt);
      this._colorAttr.needsUpdate = true;
      this._colorMorph = null;
      this._needsRender = true;
      return;
    }
    this._colorMorph = { from: new Float32Array(this._colorAttr.array), to: tgt, start: now(), dur: STEP_TWEEN };
    this._needsRender = true;
  };

  /* ---- procedure driving --------------------------------------------- */
  Gm3aViewer.prototype.goToStep = function (i, animate) {
    i = ((i % STEPS.length) + STEPS.length) % STEPS.length;
    this.step = i;
    var to = this._snapState(STEPS[i]);
    if (animate && this.built) {
      this._tween = { from: Object.assign({}, this._cur), to: to, start: now(), dur: STEP_TWEEN };
    } else {
      this._cur = to;
      this._applyUniforms(this._cur);
    }
    this._setColorTarget(this._colorTargetForStep(i), !!animate);
    this._stepStart = now();
    this._caption(i);
    this._reflectStepUI();
    this._needsRender = true;
  };

  Gm3aViewer.prototype.nextStep = function () { this.goToStep(this.step + 1, true); };
  Gm3aViewer.prototype.prevStep = function () { this.goToStep(this.step - 1, true); };

  Gm3aViewer.prototype.setPlaying = function (on) {
    this.playing = !!on;
    if (this.playing) { this._stepStart = now(); this._needsRender = true; this._kick(); }
    this._reflectPlayUI();
  };

  Gm3aViewer.prototype.replay = function () {
    this.setRgb(false, false);     // hide the RGB compare cloud + reframe to the single cloud
    this.goToStep(0, false);
    this.setPlaying(true);
  };

  /* Sensor-RGB compare: show/hide a SECOND, crisp real-colour copy of the cloud placed
     to the LEFT. The animated dampening cloud is never recoloured or moved — both share
     one orbit, and the camera reframes to fit one cloud (off) or both side by side (on).
     The procedure keeps playing; this toggle is independent of the steps. */
  Gm3aViewer.prototype.setRgb = function (on, animate) {
    on = !!on;
    if (on && !this._rgbPoints) return;     // no RGB data baked in
    this.showRgb = on;
    if (this._rgbPoints) this._rgbPoints.visible = on;
    this.root.classList.toggle('is-rgb-on', on);
    this._frameForRgb(on, animate !== false);
    if (this.srEl) this.srEl.textContent = on
      ? 'Sensor RGB compare: a second copy of the cloud in real captured colour is shown on the left, beside the dampening cloud.'
      : '';
    this._reflectRgbUI();
    this._needsRender = true;
  };

  /* Reframe the orbit to fit the single dampening cloud (off) or both clouds side by
     side (on), preserving the user's current orbit angle. Animated unless animate=false. */
  Gm3aViewer.prototype._frameForRgb = function (on, animate) {
    if (!this.built || !this.controls || !this.camera) return;
    var core = this.THREE.core;
    var toTarget = new core.Vector3(on ? -this._sep * 0.5 : 0, 0, 0);
    var toDist;
    if (on) {
      // Fit BOTH clouds while keeping them close + large: take the larger of the
      // vertical fit (single-cloud height) and the horizontal fit (pair width),
      // aspect-aware so narrow viewports zoom out enough and wide ones stay tight.
      var r = this.data.radius;
      var vhalf = Math.tan((this.camera.fov * Math.PI / 180) / 2);
      var aspect = this.camera.aspect || 1.5;
      var dV = (r * 0.9) / vhalf;                                // cloud half-height
      var dH = (this._sep * 0.5 + r * 0.62) / (vhalf * aspect);  // pair half-width
      toDist = Math.max(dV, dH) * 1.06;
    } else {
      toDist = this._homeDist;
    }
    var dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.15, -0.42, -1.0);
    dir.normalize();
    if (!animate) {
      this.controls.target.copy(toTarget);
      this.camera.position.copy(toTarget).add(dir.multiplyScalar(toDist));
      this.controls.update();
      this._camTween = null;
      this._needsRender = true;
      return;
    }
    this._camTween = {
      fromTarget: this.controls.target.clone(), toTarget: toTarget,
      fromDist: this.camera.position.distanceTo(this.controls.target), toDist: toDist,
      dir: dir, start: now(), dur: 620
    };
    this._needsRender = true;
  };

  /* legacy shim: the old binary mode toggle maps to the procedure's ends.
     'vanilla' -> step 1 (exact); 'gm3a' -> step 4 (dampening). Pauses autoplay. */
  Gm3aViewer.prototype.setMode = function (mode, animate) {
    this.setPlaying(false);
    if (this.showRgb) this.setRgb(false, false);
    this.goToStep(mode === 'vanilla' ? 0 : 3, !!animate);
  };
  Gm3aViewer.prototype.getMode = function () { return this.step >= 3 ? 'gm3a' : 'vanilla'; };

  /* write the visible caption + the SR live-region from a step (or override).
       _caption(stepIndex)  -> uses STEPS[stepIndex].{cn,ct,illus}
       _caption({n,t,sr,illus}) -> explicit (e.g. the Sensor-RGB view) */
  Gm3aViewer.prototype._caption = function (arg) {
    var n, t, illus, sr;
    if (typeof arg === 'number') {
      var s = STEPS[arg] || STEPS[0];
      n = s.cn; t = s.ct; illus = s.illus;
      sr = 'Step ' + (s.id + 1) + ' of ' + STEPS.length + ' — ' + s.ct;
    } else {
      n = arg.n; t = arg.t; illus = !!arg.illus; sr = arg.sr || (n + ' — ' + t);
    }
    if (this.srEl) this.srEl.textContent = sr;
    if (this.capN) this.capN.textContent = n;
    if (this.capT) {
      this.capT.textContent = t;
      // append a small "illustrative" marker for the concept step
      var old = this.capT.parentNode && this.capT.parentNode.querySelector('.gm3a-caption__illus');
      if (old) old.parentNode.removeChild(old);
      if (illus && this.capT.parentNode) {
        var mk = document.createElement('span');
        mk.className = 'gm3a-caption__illus';
        mk.textContent = 'illustrative';
        this.capT.parentNode.appendChild(mk);
      }
    }
  };

  Gm3aViewer.prototype._resize = function () {
    if (!this.built || !this.renderer) return;
    var w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    var pr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(pr);
    if (this._material) this._material.uniforms.uPixelR.value = pr;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._needsRender = true;
  };

  /* wake the loop (it is mostly on-demand; autoplay needs continuous ticks) */
  Gm3aViewer.prototype._kick = function () { this._needsRender = true; };

  Gm3aViewer.prototype._loop = function () {
    var self = this;
    function frame() {
      if (self.disposed || !self.built) return;
      self._raf = requestAnimationFrame(frame);
      var t = now();

      // colour morph
      if (self._colorMorph) {
        var cu = clamp01((t - self._colorMorph.start) / self._colorMorph.dur);
        var ce = easeInOut(cu);
        var a = self._colorAttr.array, from = self._colorMorph.from, to = self._colorMorph.to;
        for (var i = 0; i < a.length; i++) a[i] = from[i] + (to[i] - from[i]) * ce;
        self._colorAttr.needsUpdate = true;
        self._needsRender = true;
        if (cu >= 1) self._colorMorph = null;
      }

      // state tween (bloom / halo / focus)
      if (self._tween) {
        var tu = clamp01((t - self._tween.start) / self._tween.dur);
        var te = easeInOut(tu);
        var f = self._tween.from, g = self._tween.to;
        self._cur = {
          bloomPrior: lerp(f.bloomPrior, g.bloomPrior, te),
          bloomBoost: lerp(f.bloomBoost, g.bloomBoost, te),
          halo: lerp(f.halo, g.halo, te),
          focusBoost: lerp(f.focusBoost, g.focusBoost, te)
        };
        self._applyUniforms(self._cur);
        self._needsRender = true;
        if (tu >= 1) self._tween = null;
      }

      // camera reframe tween (single <-> side-by-side when RGB compare toggles)
      if (self._camTween) {
        var pu = clamp01((t - self._camTween.start) / self._camTween.dur);
        var pe = easeInOut(pu);
        var cw = self._camTween;
        var tgt = cw.fromTarget.clone().lerp(cw.toTarget, pe);
        var cd = lerp(cw.fromDist, cw.toDist, pe);
        self.controls.target.copy(tgt);
        self.camera.position.copy(tgt).add(cw.dir.clone().multiplyScalar(cd));
        self.controls.update();
        self._needsRender = true;
        if (pu >= 1) self._camTween = null;
      }

      // autoplay advance (only when settled on a step, not mid-tween)
      if (self.playing && !self._tween && !self._colorMorph) {
        var hold = STEP_HOLD[self.step] || 2000;
        if (t - self._stepStart >= hold) { self.goToStep(self.step + 1, true); }
        self._needsRender = true;   // keep ticking so the hold timer fires
      }

      var damping = self.controls && self.controls.enableDamping;
      if (self._needsRender || self._damp) {
        var moving = self.controls ? self.controls.update() : false;
        self._damp = !!(damping && moving);
        self.renderer.render(self.scene, self.camera);
        // keep painting while autoplay timers run or anything is animating
        self._needsRender = !!self.playing || !!self._tween || !!self._colorMorph || !!self._camTween || self._damp;
      }
    }
    this._raf = requestAnimationFrame(frame);
  };

  Gm3aViewer.prototype.dispose = function () {
    if (!this.built) return;
    this.disposed = true;
    this.built = false;
    this._tween = null; this._colorMorph = null;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._onResize) { window.removeEventListener('resize', this._onResize); this._onResize = null; }
    try { if (this.controls) this.controls.dispose(); } catch (e) {}
    try { if (this._geo) this._geo.dispose(); } catch (e) {}
    try { if (this._material) this._material.dispose(); } catch (e) {}
    try { if (this._rgbGeo) this._rgbGeo.dispose(); } catch (e) {}
    try { if (this._rgbMat) this._rgbMat.dispose(); } catch (e) {}
    try {
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer.forceContextLoss && this.renderer.forceContextLoss();
        if (this.renderer.domElement && this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
      }
    } catch (e) {}
    this.renderer = null; this.scene = null; this.camera = null;
    this.controls = null; this.group = null; this._geo = null;
    this._material = null; this._colorAttr = null;
    this._rgbPoints = null; this._rgbGeo = null; this._rgbMat = null; this._rgbGroup = null;
    this._camTween = null;
    this.root.classList.remove('is-live');
    this.disposed = false;     // allow a later rebuild
  };

  Gm3aViewer.prototype.observe = function () {
    var self = this;
    if (typeof IntersectionObserver === 'undefined') { this.build(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) self.build();
        else if (self.built) self.dispose();
      });
    }, { root: null, rootMargin: '300px 0px 300px 0px', threshold: 0.01 });
    io.observe(this.root);
  };

  /* ---- UI reflection -------------------------------------------------- */
  Gm3aViewer.prototype._reflectStepUI = function () {
    var steps = this._stepEls || [];
    for (var i = 0; i < steps.length; i++) {
      var on = (+steps[i].getAttribute('data-step') === this.step);
      steps[i].classList.toggle('is-active', on);
      steps[i].setAttribute('aria-current', on ? 'step' : 'false');
    }
  };
  Gm3aViewer.prototype._reflectPlayUI = function () {
    var b = this._playBtn; if (!b) return;
    b.setAttribute('aria-pressed', this.playing ? 'true' : 'false');
    var lbl = b.querySelector('.gm3a-btn__lbl'); if (lbl) lbl.textContent = this.playing ? 'Pause' : 'Play';
    var ico = b.querySelector('.gm3a-btn__ico'); if (ico) ico.innerHTML = this.playing ? '&#9208;' : '&#9654;';
  };
  Gm3aViewer.prototype._reflectRgbUI = function () {
    var b = this._rgbBtn; if (!b) return;
    b.setAttribute('aria-pressed', this.showRgb ? 'true' : 'false');
    var lbl = b.querySelector('.gm3a-btn__lbl'); if (lbl) lbl.textContent = this.showRgb ? 'Hide sensor RGB' : 'Sensor RGB';
  };

  Gm3aViewer.prototype.wireControls = function (opts) {
    var self = this;
    opts = opts || {};
    this._playBtn = opts.play || null;
    this._rgbBtn = opts.rgb || null;
    var resetBtn = opts.reset || null;
    var replayBtn = opts.replay || null;
    var modeBtn = opts.mode || null;     // legacy compatibility button
    this._stepEls = opts.steps ? Array.prototype.slice.call(opts.steps) : [];

    if (this._playBtn) {
      this._playBtn.addEventListener('click', function () { self.setPlaying(!self.playing); });
      this._reflectPlayUI();
    }
    if (replayBtn) replayBtn.addEventListener('click', function () { self.replay(); });
    if (resetBtn) resetBtn.addEventListener('click', function () { self.reset(); });
    if (this._rgbBtn) {
      this._rgbBtn.addEventListener('click', function () { self.setRgb(!self.showRgb, true); });
      this._reflectRgbUI();
    }
    if (modeBtn) {
      // legacy: toggles between the two ends (exact <-> dampening)
      modeBtn.addEventListener('click', function () {
        self.setMode(self.getMode() === 'gm3a' ? 'vanilla' : 'gm3a', true);
      });
    }
    this._stepEls.forEach(function (el) {
      el.addEventListener('click', function () {
        self.setPlaying(false);
        self.goToStep(+el.getAttribute('data-step'), true);
      });
      // keyboard activation for the role=button pills
      el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { el.click(); ev.preventDefault(); }
      });
    });

    // keyboard on the stage: P play/pause, R reset, C sensor-RGB, arrows step, N/B next/prev
    this.root.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'p' || k === 'P') { self.setPlaying(!self.playing); ev.preventDefault(); }
      else if (k === 'r' || k === 'R') { self.reset(); ev.preventDefault(); }
      else if (k === 'c' || k === 'C') { if (self._rgbBtn) self._rgbBtn.click(); else self.setRgb(!self.showRgb, true); ev.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'n' || k === 'N') { self.setPlaying(false); self.nextStep(); ev.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'b' || k === 'B') { self.setPlaying(false); self.prevStep(); ev.preventDefault(); }
    });
    this.root.addEventListener('pointerdown', function () { self.root.classList.add('is-grabbing'); });
    window.addEventListener('pointerup', function () { self.root.classList.remove('is-grabbing'); });
  };

  /* ================================= INIT ================================ */
  function init() {
    var root = document.getElementById('gm3a-cloud');
    if (!root || root.getAttribute('data-gm3a-ready') === '1') return;
    root.setAttribute('data-gm3a-ready', '1');
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');

    var playBtn = document.getElementById('gm3a-cloud-play');
    var replayBtn = document.getElementById('gm3a-cloud-replay');
    var resetBtn = document.getElementById('gm3a-cloud-reset');
    var rgbBtn = document.getElementById('gm3a-cloud-rgb');
    var modeBtn = document.getElementById('gm3a-cloud-mode');   // legacy (may be absent)
    var blockEl = root.closest ? root.closest('.gm3a-block') : null;
    var stepEls = (blockEl || document).querySelectorAll('.gm3a-step');

    var allCtl = [playBtn, replayBtn, resetBtn, rgbBtn, modeBtn];

    // GRACEFUL FALLBACK: no WebGL or reduced-motion -> keep the static poster (step 4).
    if (REDUCED || !webglOK()) {
      root.classList.add('is-static-fallback');
      allCtl.forEach(function (b) {
        if (!b) return;
        b.setAttribute('disabled', '');
        b.setAttribute('aria-disabled', 'true');
        b.setAttribute('title', REDUCED
          ? 'Disabled: reduced-motion is on (showing a static view of the dampening field)'
          : 'Disabled: 3D viewer unavailable (showing a static view of the dampening field)');
      });
      // mark step 4 as the one the static poster depicts
      Array.prototype.forEach.call(stepEls, function (el) {
        el.classList.toggle('is-active', +el.getAttribute('data-step') === 3);
      });
      return;
    }

    try {
      var viewer = new Gm3aViewer(root);
      viewer.wireControls({ play: playBtn, replay: replayBtn, reset: resetBtn, rgb: rgbBtn, mode: modeBtn, steps: stepEls });
      viewer.observe();
      try { window.__niseGm3aCloud = viewer; } catch (e) {}   // test hook (parity with GCVSS)
    } catch (e) {
      if (window.console && console.warn) console.warn('[gm3a3d] setup failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  try { window.NiseGm3a3D = window.NiseGm3a3D || { rescan: init }; } catch (e) {}
})();
