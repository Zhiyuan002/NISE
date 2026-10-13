/* ============================================================================
 * NISE supplementary site — GCVSS interactive 3D block.
 * Vendored, dependency-free at the page level, ZERO network at runtime: three.js
 * (core + PLYLoader + OrbitControls) is vendored under static/vendor/three/ and
 * loaded as ONE classic <script> (three.bundle.js) that publishes the global
 * window.__NISE_THREE__. Nothing is fetched from a CDN. (cf. slider.js /
 * pipeline.js conventions.)
 *
 * This file is a CLASSIC <script> (NOT type="module"). That is deliberate and
 * load-bearing: opening index.html as a bare file:// URL gives the page the
 * opaque 'null' origin, and Chromium CORS-blocks ES module scripts (and module
 * import()) from that origin -- which previously left this whole block dead
 * offline. A classic script + a classic-script three.js bundle have no such
 * restriction, so the cloud orbit + warp reveal work whether the site is served
 * over http OR opened directly from disk. It writes no globals beyond one
 * namespaced hook; three.js lives under window.__NISE_THREE__.
 *
 * ONE coherent block, TWO coordinated panels:
 *
 *   A) CLOUD ORBIT  (#gcvss-cloud) — "one camera is weak; two lock it"
 *      A three.js viewer of co-registered noisy point clouds with each camera's
 *      FRUSTUM drawn at its REAL pose (apex at the camera origin, pyramid along
 *      the camera +Z axis, sized to the cloud). Two scenes are supported and a
 *      labelled toggle switches between them; GEAR is the default (cleaner
 *      geometry than the petri dish). Each scene declares its PRIMARY camera +
 *      the Kinect; the stages, frustums, legend, and chip all read the scene's
 *      primary id, so the two scenes can use different camera pairs:
 *        - GEAR   : window.__NISE_GCVSS_GEAR_CLOUDS__ {d455, kinect}   (D455 side + Kinect)
 *        - PETRI  : window.__NISE_GCVSS_CLOUDS__      {d405, kinect}   (D405 wrist + Kinect,
 *                   the real-robot DEPLOYMENT pair; eye-in-hand + -190mm Z, carrying
 *                   the accepted residual ~1-3cm hand-eye tilt)
 *      A 3-STAGE animation tells the Noise2Noise story:
 *        STAGE 1  primary cloud in its REAL per-point sensor RGB (the PLY's
 *                 red/green/blue) — one camera, true colour
 *        STAGE 2  the SAME primary cloud recoloured to camera-of-origin tint —
 *                 still ONE weak, one-sided view
 *        STAGE 3  the Kinect cloud + frustum fade in (camera-of-origin: primary
 *                 green + Kinect coral) — two views co-register and LOCK the
 *                 geometry (the payoff)
 *      Stage changes cross-fade the primary cloud's colour, the Kinect cloud's
 *      opacity, and the Kinect frustum together. A clickable 3-step STEPPER (the
 *      .gcvss-tl__step pills) lets the user jump to any stage; Play/Pause loops
 *      it; Replay restarts; arrow keys step. A gentle auto-orbit runs
 *      continuously so the 3D reads even when paused on a stage; grabbing the
 *      viewer hands orbit to the user (auto-orbit stops, stages keep playing).
 *        - orbit (drag), zoom (wheel / pinch)
 *        - legend: camera-of-origin primary / Kinect + a live verdict chip
 *        - LAZY init on scroll into view; GL is DISPOSED when scrolled far
 *          offscreen and rebuilt on return (memory-friendly)
 *        - devicePixelRatio capped (perf); resizes with its box
 *        - graceful fallback: no WebGL OR prefers-reduced-motion -> the static
 *          best-view poster stays up (the fused stage-3 view), fully
 *          keyboard-reachable, no canvas built, no animation. The poster + the
 *          static stepper swap with the scene toggle.
 *
 *   B) WARP REVEAL  (#gcvss-warp)
 *      A drag-divider comparing "Kinect warped into D455" (OVER, clipped) against
 *      "D455 actual" (UNDER), plus an AGREEMENT overlay toggle (green = where
 *      warped == actual within tolerance — the GCVSS supervision signal).
 *      Pure CSS clip + pre-baked stills; needs no three.js, so it works even if
 *      the cloud's WebGL import fails. Pointer + touch + keyboard accessible.
 *
 * Both panels respect prefers-reduced-motion and are touch + keyboard usable.
 * ========================================================================== */
(function () {
  'use strict';

  /* Resolve every asset URL ABSOLUTE against THIS script's own location
     (.../static/js/gcvss3d.js), NOT the document. This is location-independent:
     it works whether index.html sits at the site root or a test harness lives in
     a subdirectory. As a CLASSIC script we read our own URL from
     document.currentScript at parse time (import.meta is unavailable in classic
     scripts); we snapshot it immediately because document.currentScript is only
     valid during synchronous top-level execution.
       static/js/  ->  ../cloud/...   ../images/... */
  var SELF_URL =
    (document.currentScript && document.currentScript.src) || document.baseURI;
  function asURL(rel) {
    try { return new URL(rel, SELF_URL).href; } catch (e) { return rel; }
  }

  /* camera-of-origin id colours — source of truth; the legend swatches in
     gcvss3d.css mirror these values. The PRIMARY view (D455 side in the gear
     scene, D405 wrist in the petri scene) is GREEN; the Kinect (side-top) is
     CORAL. D405 reuses the same primary green as D455 so the "primary view"
     reads consistently across the two scenes. The hex variants drive the
     frustum line/fill/apex. */
  var ID_COLOR = {
    d455: [77 / 255, 217 / 255, 102 / 255],
    d405: [77 / 255, 217 / 255, 102 / 255],
    kinect: [242 / 255, 77 / 255, 77 / 255]
  };
  var ID_HEX = { d455: 0x4dd966, d405: 0x4dd966, kinect: 0xf24d4d };

  /* -------------------------------------------------------------------------
   * REAL camera poses — T_camera_to_base (4x4, row-major) from
   * fused_3cam_visualization_params.json. The fourth column is the camera origin
   * in the robot base frame; the third column is the camera optical +Z (viewing)
   * axis. Recorded COLOR intrinsics give each camera's field of view (256x256
   * recorded frames), which sets the frustum's aspect + apex angle so the drawn
   * pyramid matches what the sensor actually saw. All clouds are already fused
   * into the robot base frame, so apex-at-origin + pyramid-along-+Z lands in the
   * SAME coordinate space as the points (no extra transform).
   *
   *   d455 / kinect : STATIC T_camera_to_base (gear scene rig).
   *   d405          : the PETRI deployment view. EYE-IN-HAND, so its pose is the
   *                   per-frame TCP * T_camera_to_tool at frame 0, with the
   *                   hardcoded -190mm base-frame Z correction FOLDED into the
   *                   translation (T[2][3] += -0.190). This matches the cloud
   *                   build exactly and carries the accepted residual ~1-3cm
   *                   hand-eye tilt; do NOT "straighten" it.
   * ------------------------------------------------------------------------- */
  var CAMERAS = {
    d455: {
      id: 'd455', label: 'D455',
      T: [
        [ 0.779827, -0.298784,  0.550089, -0.394400],
        [-0.624482, -0.432368,  0.650447, -0.524889],
        [ 0.043498, -0.850756, -0.523757,  0.287572],
        [ 0.0,       0.0,       0.0,       1.0     ]
      ],
      // K_color: fx=204.94 fy=204.76 on a 256x256 frame
      fx: 204.94, fy: 204.76, w: 256, h: 256
    },
    d405: {
      id: 'd405', label: 'D405',
      // T_tool_to_base(frame 0) @ T_camera_to_tool, then T[2][3] += -0.190
      // (= frame_0_T_camera_to_base_before_z_offset with the -190mm Z applied).
      T: [
        [-0.995818, -0.081653, -0.040985, -0.129717],
        [-0.091319,  0.875820,  0.473919, -0.447064],
        [-0.002802,  0.475680, -0.879614,  0.298742],
        [ 0.0,       0.0,       0.0,       1.0     ]
      ],
      // K_color: fx=232.52 fy=232.18 on a 256x256 frame (D405 hand)
      fx: 232.52, fy: 232.18, w: 256, h: 256
    },
    kinect: {
      id: 'kinect', label: 'Kinect',
      T: [
        [ 0.026447, -0.864727,  0.501546, -0.469206],
        [-0.999650, -0.022819,  0.013369, -0.289471],
        [-0.000115, -0.501724, -0.865028,  0.538111],
        [ 0.0,       0.0,       0.0,       1.0     ]
      ],
      // K_color: fx=216.62 fy=216.61 on a 256x256 frame
      fx: 216.62, fy: 216.61, w: 256, h: 256
    }
  };

  /* Scene registry. The PRODUCTION scene is PETRI (D405 wrist + Kinect, the
     real-robot deployment pair); the GEAR scene is ARCHIVED — retained here so it
     can be revived, but no longer exposed (no toggle button, not the default).
     Each scene names its PRIMARY camera id
     (the green view) + label, its inline-cloud global (base64 data: URLs read by
     PLYLoader even under file://), an http-fallback relative .ply pair keyed by
     {<primary>, kinect}, and its fallback poster. The gear scene's primary is
     the D455 (side); the petri scene's primary is the D405 (wrist), the
     real-robot deployment view. */
  var SCENES = {
    gear: {
      id: 'gear',
      label: 'Gear',
      primary: 'd455',
      primaryLabel: 'D455 · side',
      globalKey: '__NISE_GCVSS_GEAR_CLOUDS__',
      files: { d455: '../cloud/gcvss_gear_d455.ply', kinect: '../cloud/gcvss_gear_kinect.ply' },
      poster: '../cloud/gcvss_gear_cloud_poster.png'
    },
    petri: {
      id: 'petri',
      label: 'Petri dish',
      primary: 'd405',
      primaryLabel: 'D405 · wrist',
      globalKey: '__NISE_GCVSS_CLOUDS__',
      files: { d405: '../cloud/gcvss_d405.ply', kinect: '../cloud/gcvss_kinect.ply' },
      poster: '../cloud/gcvss_cloud_poster.png'
    }
  };
  var DEFAULT_SCENE = 'petri';   // gear scene archived (SCENES.gear retained, not exposed)

  /* The two camera ids a scene draws, primary first. Backward-compatible: a
     scene with no explicit `primary` falls back to 'd455'. */
  function scenePair(sceneId) {
    var sc = SCENES[sceneId] || SCENES[DEFAULT_SCENE];
    return [sc.primary || 'd455', 'kinect'];
  }

  /* The legend (in index.html) is SHARED across scenes; its FIRST .gcvss-legend__row
     names the scene's PRIMARY camera. Rewrite that row's swatch class + text so
     it reads "D455 · side" for gear and "D405 · wrist" for petri. The second
     row (Kinect · side-top) is identical for both scenes and never touched.
     No-op if the legend markup isn't present (the JS contract stays graceful). */
  function reflectLegendPrimary(root, sc) {
    try {
      var rows = root.querySelectorAll('.gcvss-legend__row');
      if (!rows || !rows.length) return;
      var primRow = rows[0];
      var dot = primRow.querySelector('.gcvss-legend__dot');
      if (dot) {
        // swap dot--d455 / dot--d405 (both render green) to match the primary id
        dot.classList.remove('gcvss-legend__dot--d455', 'gcvss-legend__dot--d405');
        dot.classList.add('gcvss-legend__dot--' + (sc.primary || 'd455'));
      }
      // replace the row's trailing text node (after the dot) with the label
      var label = sc.primaryLabel || 'D455 · side';
      var replaced = false;
      for (var i = primRow.childNodes.length - 1; i >= 0; i--) {
        var nd = primRow.childNodes[i];
        if (nd.nodeType === 3) {                 // text node
          if (!replaced && nd.textContent.trim().length) {
            nd.textContent = label; replaced = true;
          } else {
            nd.textContent = '';
          }
        }
      }
      if (!replaced) primRow.appendChild(document.createTextNode(label));
    } catch (e) { /* graceful: legend stays as authored */ }
  }

  /* Cloud sources for a given scene: prefer the embedded data: URL global, fall
     back to the relative .ply (so http serving still works either way). Keyed by
     the scene's own pair (primary id may be d455 OR d405). */
  function sceneCloudFiles(sceneId) {
    var sc = SCENES[sceneId] || SCENES[DEFAULT_SCENE];
    var inl = null;
    try { inl = (typeof window !== 'undefined') && window[sc.globalKey]; } catch (e) { inl = null; }
    return scenePair(sceneId).map(function (id) {
      var url = (inl && inl[id]) ? inl[id] : asURL(sc.files[id]);
      return { id: id, url: url };
    });
  }

  var REDUCED = false;
  try {
    REDUCED = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { REDUCED = false; }

  /* --------------------------------------------------------- small helpers */
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  function num(v, dflt) { var n = parseFloat(v); return isFinite(n) ? n : dflt; }
  function ease(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

  /* Feature-detect a usable WebGL context without leaking it. */
  function webglOK() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') ||
               c.getContext('webgl') ||
               c.getContext('experimental-webgl');
      if (!gl) return false;
      // free it immediately so we don't hold a context before lazy-init
      var lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (lose && lose.loseContext) { try { lose.loseContext(); } catch (e) {} }
      return true;
    } catch (e) { return false; }
  }

  /* ======================================================================= */
  /* ============================ A. CLOUD ORBIT =========================== */
  /* ======================================================================= */
  function CloudViewer(root) {
    this.root = root;
    this.poster = root.querySelector('.gcvss-cloud__poster');
    this.sceneId = DEFAULT_SCENE;   // 'gear' (default) | 'petri'
    this.THREE = null;
    this.built = false;             // GL scene currently allocated?
    this.loading = false;
    this.geomsByScene = {};         // sceneId -> cached parsed geoms (survive rebuild)
    this.disposed = false;
    this._raf = null;
    this._needsRender = true;       // on-demand rendering (controls 'change' wakes it)
    this._pointObjs = {};           // id -> THREE.Points
    this._frustObjs = {};           // id -> THREE.Group (frustum)
    this._pointMats = {};           // id -> PointsMaterial (per-camera fade)
    this._colorAttrs = {};          // id -> live color BufferAttribute (mutable)
    // 3-STAGE animation state. The panel plays a 3-step narrative:
    //   0  primary cloud, REAL sensor RGB        (one camera, true colour)
    //   1  primary cloud, camera-of-origin tint  (still ONE one-sided view)
    //   2  primary + Kinect, fused               (two views lock the geometry)
    this._anim = {
      stage: 0,                // current stage index (0..2)
      playing: true,           // autoplay/loop on by default
      userOrbiting: false,     // user grabbed -> stop auto-orbit, keep playing
      lead: 'd455',            // the scene's PRIMARY camera id
      follow: 'kinect',        // the second (fusing) camera
      raf: null,
      stageStart: 0,           // performance.now() of the current stage entry
      orbitBase: 0,            // accumulated auto-orbit angle (continuous)
      orbitLast: 0,            // last tick timestamp (for orbit delta)
      tweens: null             // active cross-fade tweens (color / cloud / frustum alpha)
    };
    this._chip = null;         // { txt, dot, verdict } DOM refs (optional)
  }

  /* The 3 stages, parameterised by the scene's primary camera id. Each stage
     declares: which colour buffer the primary cloud shows (rgb|id), whether the
     Kinect cloud + frustum are present, the timeline label, and the verdict. */
  CloudViewer.STAGES = [
    { key: 'rgb',   primColor: 'rgb', kinect: false, verdict: 'weak',   verdictTxt: 'weak · one-sided' },
    { key: 'solo',  primColor: 'id',  kinect: false, verdict: 'weak',   verdictTxt: 'weak · one-sided' },
    { key: 'fused', primColor: 'id',  kinect: true,  verdict: 'locked', verdictTxt: 'geometry locked' }
  ];
  CloudViewer.NSTAGES = 3;
  CloudViewer.HOLD_MS = 2600;        // dwell per stage when auto-playing
  CloudViewer.TWEEN_MS = 760;        // cross-fade duration on a stage change

  /* Resolve the vendored three.js from the classic-script global the bundle
     publishes (window.__NISE_THREE__). No import(), no network. Wrapped in a
     Promise so the rest of the build pipeline (which awaits ensureThree) is
     unchanged; rejects clearly if the bundle <script> failed to load, which the
     caller turns into the graceful static-poster fallback. */
  CloudViewer.prototype.ensureThree = function () {
    var self = this;
    if (this.THREE) return Promise.resolve(this.THREE);
    var NS = (typeof window !== 'undefined') ? window.__NISE_THREE__ : null;
    if (!NS || !NS.WebGLRenderer || !NS.PLYLoader || !NS.OrbitControls) {
      return Promise.reject(new Error(
        'three.bundle.js not loaded (window.__NISE_THREE__ missing or incomplete)'));
    }
    self.THREE = {
      core: NS,
      PLYLoader: NS.PLYLoader,
      OrbitControls: NS.OrbitControls
    };
    return Promise.resolve(self.THREE);
  };

  /* three.js Matrix4.set takes ROW-major args; build one from the [4][4] rows. */
  CloudViewer.prototype._mat4 = function (rows) {
    var core = this.THREE.core;
    var m = new core.Matrix4();
    m.set(
      rows[0][0], rows[0][1], rows[0][2], rows[0][3],
      rows[1][0], rows[1][1], rows[1][2], rows[1][3],
      rows[2][0], rows[2][1], rows[2][2], rows[2][3],
      rows[3][0], rows[3][1], rows[3][2], rows[3][3]
    );
    return m;
  };

  /* Load + parse both PLYs for ONE scene; cache the geometries per scene (they
     survive dispose/rebuild, and a scene already loaded once is instant). Each
     geometry gets TWO per-vertex colour buffers prepared:
       - colorRGB : the REAL per-point sensor colour the PLY carries (PLYLoader
                    builds this 'color' attribute from the red/green/blue uchar
                    triplets, normalised + linearised; rendered back to sRGB on
                    output — i.e. the true captured colour). This is STAGE 1.
       - colorID  : a flat camera-of-origin tint (primary GREEN / Kinect CORAL),
                    the analysis colouring. This is STAGE 2/3.
     The live 'color' attribute is morphed between the two so the recolour reads
     as a smooth transition. (If a PLY ever lacks RGB, colorRGB falls back to the
     id tint so the stage still renders.) */
  CloudViewer.prototype.ensureGeoms = function (T, sceneId) {
    var self = this;
    sceneId = sceneId || this.sceneId;
    if (this.geomsByScene[sceneId]) return Promise.resolve(this.geomsByScene[sceneId]);
    var loader = new T.PLYLoader();
    var files = sceneCloudFiles(sceneId);
    function load(entry) {
      return new Promise(function (resolve, reject) {
        loader.load(entry.url, function (geo) {
          resolve({ id: entry.id, geo: geo });
        }, undefined, function (err) { reject(err); });
      });
    }
    return Promise.all(files.map(load)).then(function (parsed) {
      parsed.forEach(function (p) {
        var geo = p.geo;
        geo.computeBoundingBox();
        var n = geo.getAttribute('position').count;
        // (1) camera-id tint: flat per-cloud colour for every vertex
        var c = ID_COLOR[p.id] || [0.5, 0.5, 0.5];
        var idArr = new Float32Array(n * 3);
        for (var i = 0; i < n; i++) {
          idArr[3 * i] = c[0]; idArr[3 * i + 1] = c[1]; idArr[3 * i + 2] = c[2];
        }
        // (2) real sensor RGB: PLYLoader already parsed red/green/blue into a
        // 'color' attribute (linearised float 0..1). Snapshot it as colorRGB.
        var loaded = geo.getAttribute('color');
        var rgbArr;
        if (loaded && loaded.count === n) {
          rgbArr = new Float32Array(loaded.array);   // copy (don't alias the live buf)
        } else {
          rgbArr = idArr.slice();                    // graceful: no RGB -> id tint
        }
        // store both as named userData buffers; the live 'color' attribute is a
        // separate, mutable Float32 buffer the animation writes into.
        geo.userData.colorRGB = rgbArr;
        geo.userData.colorID = idArr;
        // start the live colour on the camera-id tint (matches the prior viewer);
        // _construct() will set the correct stage colour before first paint.
        geo.setAttribute('color', new T.core.BufferAttribute(idArr.slice(), 3));
      });
      // combined center + radius across both clouds for camera framing
      var box = new T.core.Box3();
      parsed.forEach(function (p) { box.union(p.geo.boundingBox); });
      var center = new T.core.Vector3();
      box.getCenter(center);
      var sphere = new T.core.Sphere();
      box.getBoundingSphere(sphere);
      var g = { list: parsed, center: center, radius: sphere.radius };
      self.geomsByScene[sceneId] = g;
      return g;
    });
  };

  /* Build a camera frustum as a wireframe pyramid at the real pose. Returns a
     Group positioned + oriented by T_camera_to_base; the pyramid spans the
     recorded FOV out to `depth` metres along the camera +Z axis. Every child
     material is tagged with userData.mat (+ baseOpacity on the group) so the
     animation can fade the whole frustum in. */
  CloudViewer.prototype._buildFrustum = function (cam, depth, color) {
    var core = this.THREE.core;
    var T = this._mat4(cam.T);
    var g = new core.Group();
    g.applyMatrix4(T);   // place apex at camera origin, axes = camera frame

    // half-extents at `depth` from the recorded color intrinsics:
    //   tan(hfov/2) = (w/2)/fx  ->  x at depth = depth * (w/2)/fx
    var hx = depth * (cam.w * 0.5) / cam.fx;
    var hy = depth * (cam.h * 0.5) / cam.fy;
    var z = depth;   // camera looks down +Z in this convention

    var c0 = new core.Vector3(-hx, -hy, z);
    var c1 = new core.Vector3( hx, -hy, z);
    var c2 = new core.Vector3( hx,  hy, z);
    var c3 = new core.Vector3(-hx,  hy, z);
    var apex = new core.Vector3(0, 0, 0);

    var segs = [
      apex, c0,  apex, c1,  apex, c2,  apex, c3,   // edges from apex
      c0, c1,  c1, c2,  c2, c3,  c3, c0            // far rectangle
    ];
    var pos = new Float32Array(segs.length * 3);
    for (var i = 0; i < segs.length; i++) {
      pos[3 * i] = segs[i].x; pos[3 * i + 1] = segs[i].y; pos[3 * i + 2] = segs[i].z;
    }
    var lgeo = new core.BufferGeometry();
    lgeo.setAttribute('position', new core.BufferAttribute(pos, 3));
    var lmat = new core.LineBasicMaterial({ color: color, transparent: true, opacity: 0.92 });
    var lines = new core.LineSegments(lgeo, lmat);
    lines.userData.mat = lmat;
    lines.userData.role = 'line';
    g.add(lines);

    // faint translucent fill on the far rectangle (gives the cone volume)
    var fgeo = new core.BufferGeometry();
    var fpos = new Float32Array([
      c0.x, c0.y, c0.z,  c1.x, c1.y, c1.z,  c2.x, c2.y, c2.z,
      c0.x, c0.y, c0.z,  c2.x, c2.y, c2.z,  c3.x, c3.y, c3.z
    ]);
    fgeo.setAttribute('position', new core.BufferAttribute(fpos, 3));
    var fmat = new core.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.06, side: core.DoubleSide, depthWrite: false
    });
    var fill = new core.Mesh(fgeo, fmat);
    fill.userData.mat = fmat;
    fill.userData.role = 'fill';
    g.add(fill);

    // apex marker (small octahedron) so the camera location reads clearly
    var amat = new core.MeshBasicMaterial({ color: color, transparent: true, opacity: 1 });
    var apexMesh = new core.Mesh(new core.OctahedronGeometry(depth * 0.045), amat);
    apexMesh.userData.mat = amat;
    apexMesh.userData.role = 'apex';
    g.add(apexMesh);

    g.userData.baseOpacity = { line: 0.92, fill: 0.06, apex: 1 };
    return g;
  };

  /* Build the live three.js scene (renderer + camera + controls + points +
     frustums) for the CURRENT scene. */
  CloudViewer.prototype.build = function () {
    var self = this;
    if (this.built || this.loading || this.disposed) return;
    this.loading = true;

    this.ensureThree()
      .then(function (T) { return self.ensureGeoms(T, self.sceneId).then(function (g) { return { T: T, g: g }; }); })
      .then(function (r) {
        if (self.disposed) { self.loading = false; return; }
        self._construct(r.T, r.g);
        self.loading = false;
      })
      .catch(function (err) {
        // any failure (import, fetch, parse, GL) -> keep the poster up
        self.loading = false;
        if (window.console && console.warn) {
          console.warn('[gcvss3d] cloud init failed; keeping poster.', err);
        }
      });
  };

  CloudViewer.prototype._construct = function (T, geoms) {
    var core = T.core;
    var root = this.root;
    var self = this;

    this.geoms = geoms;

    // the lead/primary (always present) is the scene's PRIMARY camera; the
    // follow (the fusing view) is always the Kinect. Petri -> d405, gear -> d455.
    this._anim.lead = (SCENES[this.sceneId] && SCENES[this.sceneId].primary) || 'd455';
    this._anim.follow = 'kinect';

    var renderer = new core.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'low-power'
    });
    // CAP devicePixelRatio for perf (Retina would otherwise 4x the fragment work)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    var w = root.clientWidth || 640;
    var h = root.clientHeight || 400;
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);   // transparent -> CSS surface shows
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
    controls.minDistance = geoms.radius * 0.55;
    controls.maxDistance = geoms.radius * 4.2;

    // per-camera point materials (separate so the animation can fade one) +
    // a handle to each cloud's live (mutable) colour attribute, so a stage
    // change can cross-fade the primary cloud from real RGB -> camera-id tint.
    var group = new core.Group();
    geoms.list.forEach(function (p) {
      var mat = new core.PointsMaterial({
        size: 0.006,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.96
      });
      var pts = new core.Points(p.geo, mat);
      pts.userData.id = p.id;
      pts.userData.baseOpacity = 0.96;
      group.add(pts);
      self._pointObjs[p.id] = pts;
      self._pointMats[p.id] = mat;
      self._colorAttrs[p.id] = p.geo.getAttribute('color');
    });

    // frustums sized to the cloud extent so they read at the same scale.
    // The pair is the scene's own (primary id may be d455 OR d405) + kinect.
    var fDepth = geoms.radius * 1.15;
    scenePair(this.sceneId).forEach(function (id) {
      var fr = self._buildFrustum(CAMERAS[id], fDepth, ID_HEX[id]);
      group.add(fr);
      self._frustObjs[id] = fr;
    });

    // recenter the whole rig (points + frusta) on the cloud centroid so orbit
    // pivots about the subject; frustum apexes move with it (rigid).
    group.position.set(-geoms.center.x, -geoms.center.y, -geoms.center.z);
    scene.add(group);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.group = group;

    // initial framing: a 3/4 elevated view of the subject, then SAVE it as the
    // controls' reset state so reset() restores it AND flushes any damping
    // momentum left over from an in-flight drag.
    this._home = this._homeView();
    this._applyHome();
    controls.saveState();

    controls.addEventListener('change', function () { self._needsRender = true; });

    this.built = true;
    this.disposed = false;
    root.classList.add('is-live');

    // start the on-demand render loop
    this._needsRender = true;
    this._loop();

    // keep size in sync with the responsive box
    this._onResize = function () { self._resize(); };
    window.addEventListener('resize', this._onResize);

    // begin the auto-animation (unless reduced-motion — guarded by caller too)
    this._startAnim();
  };

  /* compute the 'home' camera position from the cloud radius (data-space) */
  CloudViewer.prototype._homeView = function () {
    var r = this.geoms.radius;
    // direction chosen to match the static poster's 3/4 elevated angle; both
    // frustum apexes + the cloud sit inside the square frame at this distance.
    var dir = new this.THREE.core.Vector3(0.50, -0.74, 0.58).normalize();
    var dist = r * 2.15;
    return { dir: dir, dist: dist };
  };
  CloudViewer.prototype._applyHome = function () {
    var h = this._home;
    this.camera.position.copy(h.dir).multiplyScalar(h.dist);
    this.camera.up.set(0, 0, 1);          // robot base frame: +Z up
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this._needsRender = true;
  };

  CloudViewer.prototype.reset = function () {
    if (!this.built || !this.controls) return;
    var controls = this.controls;
    var damp = controls.enableDamping;
    // OrbitControls keeps leftover rotate/pan MOMENTUM after a drag, and
    // update() ADDS that momentum to the position before zeroing it. So we
    // (1) flush+zero the residual with one damping-off update(), (2) reset()
    // restores the saved home pose cleanly, (3) restore damping.
    controls.enableDamping = false;
    controls.update();          // consume + zero any pending momentum
    controls.reset();           // now restores the exact saved home pose
    controls.enableDamping = damp;
    this.camera.up.set(0, 0, 1);
    this._damp = false;         // no residual; stop the settle loop cleanly
    // re-hand control to the auto-orbit so Reset feels like "back to the show"
    this._anim.userOrbiting = false;
    this._needsRender = true;
  };

  CloudViewer.prototype._resize = function () {
    if (!this.built || !this.renderer) return;
    var w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._needsRender = true;
  };

  /* On-demand render loop: only paints when damping is active or a change is
     pending, so an idle viewer costs ~0 GPU. The animation marks _needsRender
     every frame it advances, so it keeps painting while playing. */
  CloudViewer.prototype._loop = function () {
    var self = this;
    function frame() {
      if (self.disposed || !self.built) return;
      self._raf = requestAnimationFrame(frame);
      var damping = self.controls && self.controls.enableDamping;
      if (self._needsRender || self._damp) {
        var stillMoving = self.controls ? self.controls.update() : false;
        // controls.update() returns true while damping is still settling (r160)
        self._damp = !!(damping && stillMoving);
        self.renderer.render(self.scene, self.camera);
        self._needsRender = false;
      }
    }
    this._raf = requestAnimationFrame(frame);
  };

  /* --------------------------------------------------------- ANIMATION ----
   * 3-STAGE narrative (a discrete stepper, NOT a continuous timeline):
   *   STAGE 1  primary cloud, REAL sensor RGB     — one camera, its true colour
   *   STAGE 2  primary cloud, camera-of-origin    — still ONE one-sided view
   *   STAGE 3  primary + Kinect, fused            — two views LOCK the geometry
   * Stage changes cross-fade three things together: the primary cloud's COLOUR
   * (RGB <-> id tint), the Kinect cloud's OPACITY (out/in), and the Kinect
   * FRUSTUM's opacity (sweeps/fades in). A gentle auto-orbit runs continuously
   * underneath so the 3D reads even when paused on a stage. The user may step
   * manually (stepper / arrows), auto-play/loop, pause, or replay. Grabbing the
   * viewer hands orbit to the user (auto-orbit stops, stages keep playing).
   * prefers-reduced-motion never reaches here (the poster is shown instead).
   * ------------------------------------------------------------------------- */

  /* set a cloud's point opacity (and hide entirely at ~0 to save fragments) */
  CloudViewer.prototype._setCloudAlpha = function (id, a) {
    var pts = this._pointObjs[id]; if (!pts) return;
    pts.visible = a > 0.001;
    var mat = this._pointMats[id];
    if (mat) mat.opacity = pts.userData.baseOpacity * a;
    this._needsRender = true;
  };
  /* set a frustum group's opacity across its line / fill / apex sub-materials */
  CloudViewer.prototype._setFrustumAlpha = function (id, a) {
    var fr = this._frustObjs[id]; if (!fr) return;
    fr.visible = a > 0.001;
    var bo = fr.userData.baseOpacity;
    fr.traverse(function (o) {
      if (o.userData && o.userData.mat) {
        var m = o.userData.mat;
        if (o.userData.role === 'line') m.opacity = bo.line * a;
        else if (o.userData.role === 'fill') m.opacity = bo.fill * a;
        else m.opacity = bo.apex * a;   // apex marker
        m.transparent = true;
      }
    });
    this._needsRender = true;
  };
  /* blend the PRIMARY cloud's live colour buffer between RGB and id tint.
     k = 0 -> full real RGB; k = 1 -> full camera-id tint. */
  CloudViewer.prototype._setPrimaryColorMix = function (k) {
    var lead = this._anim.lead;
    var attr = this._colorAttrs[lead]; if (!attr) return;
    var geo = this._pointObjs[lead] && this._pointObjs[lead].geometry;
    if (!geo || !geo.userData) return;
    var rgb = geo.userData.colorRGB, id = geo.userData.colorID;
    if (!rgb || !id) return;
    var arr = attr.array, n = arr.length;
    var kk = clamp(k, 0, 1), ik = 1 - kk;
    for (var i = 0; i < n; i++) arr[i] = rgb[i] * ik + id[i] * kk;
    attr.needsUpdate = true;
    this._needsRender = true;
  };

  /* APPLY a fully-resolved stage state to the scene (no tween): used to snap
     (manual step with animate=false, reduced-motion, initial build). */
  CloudViewer.prototype._applyStageInstant = function (i) {
    var lead = this._anim.lead, follow = this._anim.follow;
    var st = CloudViewer.STAGES[i] || CloudViewer.STAGES[0];
    this._setCloudAlpha(lead, 1);
    this._setFrustumAlpha(lead, 1);                 // primary always present
    this._setPrimaryColorMix(st.primColor === 'rgb' ? 0 : 1);
    this._setCloudAlpha(follow, st.kinect ? 1 : 0);
    this._setFrustumAlpha(follow, st.kinect ? 1 : 0);
  };

  /* GO TO a stage. animate=true cross-fades from the current visual state to
     the target; animate=false snaps. Always updates the stepper + chip + clock. */
  CloudViewer.prototype.goToStage = function (i, animate) {
    if (!this.built) return;
    i = ((i % CloudViewer.NSTAGES) + CloudViewer.NSTAGES) % CloudViewer.NSTAGES;
    var a = this._anim;
    a.stage = i;
    a.stageStart = performance.now();
    var st = CloudViewer.STAGES[i];
    var lead = a.lead, follow = a.follow;

    if (animate && !REDUCED) {
      // capture the CURRENT visual state as the tween origin
      var fromMix = this._currentColorMix();          // 0..1 (rgb..id)
      var fromKinect = this._currentCloudAlpha(follow);
      var fromFrust = this._currentFrustumAlpha(follow);
      a.tweens = {
        start: performance.now(),
        dur: CloudViewer.TWEEN_MS,
        fromMix: fromMix,   toMix: (st.primColor === 'rgb' ? 0 : 1),
        fromKin: fromKinect, toKin: (st.kinect ? 1 : 0),
        fromFr:  fromFrust,  toFr:  (st.kinect ? 1 : 0)
      };
    } else {
      a.tweens = null;
      this._applyStageInstant(i);
    }
    // primary cloud + frustum are always fully present
    this._setCloudAlpha(lead, 1);
    this._setFrustumAlpha(lead, 1);
    this._setStage(i);
    this._needsRender = true;
  };
  CloudViewer.prototype.nextStage = function () { this.goToStage(this._anim.stage + 1, true); };
  CloudViewer.prototype.prevStage = function () { this.goToStage(this._anim.stage - 1, true); };

  /* read-back helpers so a mid-tween stage change blends from where we ARE */
  CloudViewer.prototype._currentColorMix = function () {
    // recover k from the live primary buffer's first channel (rgb*[1-k]+id*k)
    var lead = this._anim.lead;
    var geo = this._pointObjs[lead] && this._pointObjs[lead].geometry;
    var attr = this._colorAttrs[lead];
    if (!geo || !attr || !geo.userData) return (CloudViewer.STAGES[this._anim.stage].primColor === 'rgb' ? 0 : 1);
    var rgb = geo.userData.colorRGB, id = geo.userData.colorID;
    if (!rgb || !id) return 0;
    // solve on the channel with the largest rgb/id separation (numerically safe)
    var bestD = 0, k = 0;
    for (var i = 0; i < 3; i++) {
      var d = id[i] - rgb[i];
      if (Math.abs(d) > Math.abs(bestD)) { bestD = d; k = (attr.array[i] - rgb[i]) / d; }
    }
    return clamp(isFinite(k) ? k : 0, 0, 1);
  };
  CloudViewer.prototype._currentCloudAlpha = function (id) {
    var pts = this._pointObjs[id], mat = this._pointMats[id];
    if (!pts || !mat) return 0;
    return pts.visible ? (mat.opacity / (pts.userData.baseOpacity || 1)) : 0;
  };
  CloudViewer.prototype._currentFrustumAlpha = function (id) {
    var fr = this._frustObjs[id]; if (!fr || !fr.visible) return 0;
    var bo = fr.userData.baseOpacity, out = 1;
    fr.traverse(function (o) {
      if (o.userData && o.userData.role === 'line' && o.userData.mat) {
        out = o.userData.mat.opacity / (bo.line || 1);
      }
    });
    return clamp(out, 0, 1);
  };

  /* reflect the current stage on the stepper pills + the verdict chip */
  CloudViewer.prototype._setStage = function (i) {
    if (this._steps) {
      this._steps.forEach(function (s, k) {
        var on = (k === i);
        s.classList.toggle('is-active', on);
        s.classList.toggle('is-done', k < i);
        s.setAttribute('aria-current', on ? 'step' : 'false');
      });
    }
    // STAGE 1 shows real per-point RGB; dim the camera-of-origin legend then.
    try { this.root.classList.toggle('is-stage-rgb', i === 0); } catch (e) {}
    var chip = this._chip;
    if (!chip) return;
    var prim = (SCENES[this.sceneId] && SCENES[this.sceneId].primary) || 'd455';
    var primName = (CAMERAS[prim] && CAMERAS[prim].label) || 'D455';
    var primDot = 'gcvss-chip__dot gcvss-chip__dot--' + prim;
    if (i === 0) {                       // STAGE 1 — real RGB, one camera
      if (chip.txt) chip.txt.textContent = primName + ' alone · sensor RGB';
      if (chip.dot) chip.dot.className = primDot;
      if (chip.verdict) { chip.verdict.textContent = 'weak · one-sided'; chip.verdict.className = 'gcvss-verdict gcvss-verdict--weak'; }
    } else if (i === 1) {                // STAGE 2 — one-sided geometry
      if (chip.txt) chip.txt.textContent = primName + ' alone · one-sided geometry';
      if (chip.dot) chip.dot.className = primDot;
      if (chip.verdict) { chip.verdict.textContent = 'weak · one-sided'; chip.verdict.className = 'gcvss-verdict gcvss-verdict--weak'; }
    } else {                             // STAGE 3 — fused, locked
      if (chip.txt) chip.txt.textContent = primName + ' + Kinect · geometry locked';
      if (chip.dot) chip.dot.className = 'gcvss-chip__dot gcvss-chip__dot--both';
      if (chip.verdict) { chip.verdict.textContent = 'geometry locked'; chip.verdict.className = 'gcvss-verdict gcvss-verdict--locked'; }
    }
  };

  /* the single rAF loop that drives BOTH the auto-orbit and (when playing) the
     stage advance + the cross-fade tween. Started once on build. */
  CloudViewer.prototype._startAnim = function () {
    var self = this;
    var a = this._anim;
    // initial stage is whatever a.stage is (0 on build); snap it (no tween).
    if (REDUCED) {
      // reduced-motion: present the FUSED end state statically, no rAF tick.
      a.stage = CloudViewer.NSTAGES - 1;
      this._applyStageInstant(a.stage);
      this._setStage(a.stage);
      return;
    }
    this._applyStageInstant(a.stage);
    this._setStage(a.stage);
    if (a.raf) return;                   // already running
    a.stageStart = performance.now();
    a.orbitLast = performance.now();
    function tick(now) {
      if (self.disposed || !self.built) { a.raf = null; return; }
      a.raf = requestAnimationFrame(tick);

      // (1) advance the active cross-fade tween, if any
      if (a.tweens) {
        var tw = a.tweens;
        var u = clamp((now - tw.start) / tw.dur, 0, 1);
        var e = ease(u);
        self._setPrimaryColorMix(tw.fromMix + (tw.toMix - tw.fromMix) * e);
        self._setCloudAlpha(self._anim.follow, tw.fromKin + (tw.toKin - tw.fromKin) * e);
        self._setFrustumAlpha(self._anim.follow, tw.fromFr + (tw.toFr - tw.fromFr) * e);
        if (u >= 1) a.tweens = null;
        self._needsRender = true;
      }

      // (2) auto-play: dwell on a stage, then advance + loop (only when settled,
      //     not mid-tween). Pausing freezes the dwell clock.
      if (a.playing && !a.tweens) {
        if (now - a.stageStart >= CloudViewer.HOLD_MS) {
          self.goToStage(a.stage + 1, true);     // loops via modulo
        }
        self._needsRender = true;                // keep ticking so the timer fires
      }

      // (3) gentle continuous auto-orbit (unless the user grabbed the viewer)
      var dt = (now - a.orbitLast) / 1000; a.orbitLast = now;
      if (!a.userOrbiting && dt > 0 && dt < 0.5) {
        a.orbitBase += dt * 0.13;                // rad/s — slow, screenshot-friendly
        var r = self._home.dist;
        var base = self._home.dir.clone();
        var c = Math.cos(a.orbitBase), s = Math.sin(a.orbitBase);
        var x = base.x * c - base.y * s, y = base.x * s + base.y * c;
        self.camera.position.set(x * r, y * r, base.z * r);
        self.camera.up.set(0, 0, 1);
        self.controls.target.set(0, 0, 0);
        self.camera.lookAt(0, 0, 0);
        self._needsRender = true;
      }
    }
    a.raf = requestAnimationFrame(tick);
    this._syncPlayBtn();
  };
  CloudViewer.prototype._stopAnim = function () {
    var a = this._anim;
    if (a.raf) { cancelAnimationFrame(a.raf); a.raf = null; }
    a.tweens = null;
  };
  CloudViewer.prototype.togglePlay = function () {
    if (!this.built || REDUCED) return;
    var a = this._anim;
    a.playing = !a.playing;
    if (a.playing) {                     // resuming: rebase the dwell clock
      a.stageStart = performance.now();
      a.userOrbiting = false;
    }
    this._syncPlayBtn();
    this._needsRender = true;
  };
  /* manual stepping pauses auto-play (the user is driving now) */
  CloudViewer.prototype.stepTo = function (i) {
    if (!this.built || REDUCED) return;
    this._anim.playing = false;
    this.goToStage(i, true);
    this._syncPlayBtn();
  };
  CloudViewer.prototype.replay = function () {
    if (!this.built || REDUCED) return;
    var a = this._anim;
    a.playing = true;
    a.userOrbiting = false;
    a.stageStart = performance.now();
    this.goToStage(0, false);            // snap to stage 1, then auto-advance
    this._syncPlayBtn();
  };
  CloudViewer.prototype._syncPlayBtn = function () {
    var b = this._playBtn; if (!b) return;
    var playing = this._anim.playing;
    b.setAttribute('aria-pressed', playing ? 'true' : 'false');
    var lbl = b.querySelector('.gcvss-btn__lbl');
    if (lbl) lbl.textContent = playing ? 'Pause' : 'Play';
    var ico = b.querySelector('.gcvss-btn__ico');
    if (ico) ico.textContent = playing ? '⏸' : '▶';
  };

  /* deterministic seek hook for screenshots: jump to a stage, paused, snapped.
     Accepts a stage index (0..2) OR a legacy phase name (mapped to a stage). */
  CloudViewer.prototype.seek = function (which) {
    if (!this.built) return;
    var a = this._anim;
    a.playing = false;
    a.userOrbiting = true;               // freeze orbit for a stable shot
    var idx;
    if (typeof which === 'number') {
      idx = which;
    } else {
      var map = { rgb: 0, lead: 0, solo: 1, sweep: 1, fill: 2, fused: 2, locked: 2 };
      idx = map[which] != null ? map[which] : CloudViewer.NSTAGES - 1;
    }
    this.goToStage(idx, false);
    this._syncPlayBtn();
  };

  /* ------------------------------------------------------- SCENE SWITCHING */
  /* Rebuild the cloud + frustums for a different scene. Tears the GL rig down
     and reconstructs it (geoms are cached per scene, so a revisit is instant),
     then swaps the fallback poster + the legend/aria scene label. */
  CloudViewer.prototype.setScene = function (sceneId) {
    if (!SCENES[sceneId] || sceneId === this.sceneId) {
      this._reflectScene(sceneId || this.sceneId);
      return;
    }
    this.sceneId = sceneId;
    this._reflectScene(sceneId);
    // swap the poster src (fallback + the pre-live frame)
    this._swapPoster(sceneId);
    if (!this.built) return;             // not live yet: poster swap is enough
    // tear down + rebuild for the new scene. A scene switch RESTARTS the 3-stage
    // narrative from stage 1, preserving the user's play/pause + orbit choices.
    var wasUserOrbiting = this._anim.userOrbiting;
    var wasPlaying = this._anim.playing;
    this._anim.stage = 0;
    this._anim.tweens = null;
    this._teardownGL();
    var self = this;
    this.build();
    var poll = setInterval(function () {
      if (self.built) {
        self._anim.userOrbiting = wasUserOrbiting;
        self._anim.playing = wasPlaying;
        self._syncPlayBtn();
        clearInterval(poll);
      }
    }, 60);
    setTimeout(function () { clearInterval(poll); }, 4000);
  };

  CloudViewer.prototype._swapPoster = function (sceneId) {
    if (!this.poster) return;
    var sc = SCENES[sceneId] || SCENES[DEFAULT_SCENE];
    try { this.poster.setAttribute('src', asURL(sc.poster)); } catch (e) {}
  };

  /* update the toggle button + legend + aria label to name the current scene */
  CloudViewer.prototype._reflectScene = function (sceneId) {
    var sc = SCENES[sceneId] || SCENES[DEFAULT_SCENE];
    this.root.setAttribute('data-scene', sc.id);
    var btn = this._sceneBtn;
    if (btn) {
      // pressed == showing the gear (default) scene? We instead name the OTHER
      // scene as the action label so the button reads as "switch to X".
      var other = (sc.id === 'gear') ? SCENES.petri : SCENES.gear;
      var lbl = btn.querySelector('.gcvss-btn__lbl');
      if (lbl) lbl.textContent = other.label;
      btn.setAttribute('aria-pressed', sc.id === 'petri' ? 'true' : 'false');
      btn.setAttribute('aria-label', 'Scene: ' + sc.label + '. Activate to switch to the ' + other.label + ' scene.');
    }
    if (this._sceneName) this._sceneName.textContent = sc.label;
    // the legend is SHARED across scenes; rewrite its PRIMARY row to name the
    // scene's primary camera (D455 · side for gear, D405 · wrist for petri).
    reflectLegendPrimary(this.root, sc);
  };

  /* Tear down only the live GL rig (keep cached geoms + DOM controls). */
  CloudViewer.prototype._teardownGL = function () {
    this._stopAnim();
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    try { if (this.controls) this.controls.dispose(); } catch (e) {}
    var self = this;
    Object.keys(this._pointMats).forEach(function (id) {
      try { self._pointMats[id].dispose(); } catch (e) {}
    });
    Object.keys(this._frustObjs).forEach(function (id) {
      var fr = self._frustObjs[id];
      if (!fr) return;
      fr.traverse(function (o) {
        if (o.geometry && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
        if (o.userData && o.userData.mat && o.userData.mat.dispose) { try { o.userData.mat.dispose(); } catch (e) {} }
      });
    });
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
    this._frustObjs = {};
    this._pointMats = {};
    this._colorAttrs = {};
    this.built = false;
    this.root.classList.remove('is-live');
  };

  /* Fully release GL resources (called when scrolled far offscreen). Cached
     parsed geometries (self.geomsByScene) are NOT discarded — only the live GPU
     scene is torn down — so a rebuild is instant and never re-fetches. */
  CloudViewer.prototype.dispose = function () {
    if (!this.built) return;
    this.disposed = true;
    if (this._onResize) { window.removeEventListener('resize', this._onResize); this._onResize = null; }
    this._teardownGL();
    this.disposed = false;   // allow a later rebuild
  };

  /* Lifecycle: lazy build on enter, dispose when far offscreen. */
  CloudViewer.prototype.observe = function () {
    var self = this;
    if (typeof IntersectionObserver === 'undefined') {
      this.build();                       // no IO -> build once eagerly
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          self.build();
        } else if (self.built) {
          self.dispose();
        }
      });
    }, { root: null, rootMargin: '300px 0px 300px 0px', threshold: 0.01 });
    io.observe(this.root);
  };

  /* wire the scene-toggle + play/pause + replay buttons + the 3-stage stepper
     pills + the verdict chip. All live regardless of build state (queued onto
     the viewer; applied on build). The viewer renders the primary cloud's real
     RGB (stage 1) -> camera-id tint (stage 2) -> + Kinect fused (stage 3); the
     stepper lets the user jump to any stage, and Replay restarts the loop. */
  CloudViewer.prototype.wireControls = function (refs) {
    var self = this;
    refs = refs || {};
    this._sceneBtn = refs.sceneBtn || null;
    this._playBtn = refs.playBtn || null;
    this._replayBtn = refs.replayBtn || null;
    this._sceneName = refs.sceneName || null;
    this._steps = refs.steps || null;     // the 3 stepper pills (data-step 0..2)
    this._chip = refs.chip || null;

    if (this._sceneBtn) {
      this._sceneBtn.addEventListener('click', function () {
        self.setScene(self.sceneId === 'gear' ? 'petri' : 'gear');
      });
    }
    if (this._playBtn) {
      this._playBtn.addEventListener('click', function () { self.togglePlay(); });
      if (REDUCED) {                      // no animation under reduced-motion
        this._playBtn.setAttribute('disabled', '');
        this._playBtn.setAttribute('aria-disabled', 'true');
      }
    }
    if (this._replayBtn) {
      this._replayBtn.addEventListener('click', function () { self.replay(); });
      if (REDUCED) {
        this._replayBtn.setAttribute('disabled', '');
        this._replayBtn.setAttribute('aria-disabled', 'true');
      }
    }
    // 3-stage stepper pills: click (or Enter/Space) jumps to that stage + pauses
    if (this._steps && this._steps.length) {
      this._steps.forEach(function (el) {
        el.addEventListener('click', function () {
          if (REDUCED) return;
          self.stepTo(+el.getAttribute('data-step') || 0);
        });
        el.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { el.click(); ev.preventDefault(); }
        });
        if (REDUCED) { el.setAttribute('aria-disabled', 'true'); }
      });
    }
    this._reflectScene(this.sceneId);

    // Keyboard on the canvas region: 'r' resets the orbit, space/'p' play-pause,
    // 's' switches scene, ArrowLeft/Right (or 'b'/'n') step stages.
    this.root.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'r' || k === 'R') { self.reset(); ev.preventDefault(); }
      else if (k === 'p' || k === 'P' || k === ' ') { self.togglePlay(); ev.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'n' || k === 'N') { self.stepTo(self._anim.stage + 1); ev.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'b' || k === 'B') { self.stepTo(self._anim.stage - 1); ev.preventDefault(); }
    });
    // grab cursor feedback + hand orbit to the user (stop auto-orbit)
    this.root.addEventListener('pointerdown', function () {
      self.root.classList.add('is-grabbing');
      self._anim.userOrbiting = true;
    });
    window.addEventListener('pointerup', function () {
      self.root.classList.remove('is-grabbing');
    });
  };

  /* ======================================================================= */
  /* ============================ B. WARP REVEAL =========================== */
  /* ======================================================================= */
  function WarpReveal(root) {
    this.root = root;
    this.rev = clamp(num(root.getAttribute('data-start'), 50), 0, 100);
    this.dragging = false;
    this.pointerId = null;
    this.agree = false;
    this.srEl = root.querySelector('.gcvss-sr');
    this.labelWarped = root.getAttribute('data-label-warped') || 'Kinect warped';
    // the warp panel compares the Kinect warped INTO the D405 frame against the
    // D405 actual (the deployment pair). index.html carries the authored labels
    // via data-label-*; this default is the fallback.
    this.labelActual = root.getAttribute('data-label-actual') || 'D405 actual';
  }

  WarpReveal.prototype.init = function () {
    var root = this.root;
    root.style.setProperty('--gwrev', String(this.rev));

    // ARIA: the root behaves as a slider
    root.setAttribute('role', 'slider');
    root.setAttribute('tabindex', '0');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', '100');
    root.setAttribute('aria-orientation', 'horizontal');
    if (!root.getAttribute('aria-label')) {
      root.setAttribute('aria-label',
        'Warp comparison: ' + this.labelWarped + ' versus ' + this.labelActual +
        '. Drag, or use arrow keys, to reveal more of either image.');
    }
    this.setRev(this.rev, true);
    this.wire();
  };

  WarpReveal.prototype.xToRev = function (clientX) {
    var rect = this.root.getBoundingClientRect();
    if (rect.width <= 0) return this.rev;
    var fromLeft = clamp((clientX - rect.left) / rect.width, 0, 1);
    return clamp((1 - fromLeft) * 100, 0, 100);
  };

  WarpReveal.prototype.setRev = function (rev, silent) {
    this.rev = clamp(rev, 0, 100);
    var rounded = Math.round(this.rev);
    this.root.style.setProperty('--gwrev', String(this.rev));
    var warpedShown = 100 - rounded;
    this.root.setAttribute('aria-valuenow', String(warpedShown));
    this.root.setAttribute('aria-valuetext',
      warpedShown + '% ' + this.labelWarped + ', ' + rounded + '% ' + this.labelActual);
    if (!silent && this.srEl) {
      this.srEl.textContent = warpedShown + ' percent ' + this.labelWarped + ' visible';
    }
  };

  WarpReveal.prototype.setAgree = function (on) {
    this.agree = !!on;
    this.root.classList.toggle('is-agree', this.agree);
  };

  WarpReveal.prototype.wire = function () {
    var self = this;
    var root = this.root;

    function onDown(ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      if (self.agree) return;   // no divider drag while the overlay is composited
      self.dragging = true;
      self.pointerId = ev.pointerId;
      root.classList.add('is-dragging');
      if (root.setPointerCapture && ev.pointerId !== undefined) {
        try { root.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      self.setRev(self.xToRev(ev.clientX));
      ev.preventDefault();
    }
    function onMove(ev) {
      if (!self.dragging) return;
      if (self.pointerId !== null && ev.pointerId !== undefined &&
          ev.pointerId !== self.pointerId) return;
      self.setRev(self.xToRev(ev.clientX));
      ev.preventDefault();
    }
    function onUp() {
      if (!self.dragging) return;
      self.dragging = false;
      root.classList.remove('is-dragging');
      if (root.releasePointerCapture && self.pointerId !== null) {
        try { root.releasePointerCapture(self.pointerId); } catch (e) {}
      }
      self.pointerId = null;
    }

    if (window.PointerEvent) {
      root.addEventListener('pointerdown', onDown);
      root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerup', onUp);
      root.addEventListener('pointercancel', onUp);
      root.addEventListener('lostpointercapture', onUp);
    } else {
      root.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', function (e) { if (self.dragging) onMove(e); });
      window.addEventListener('mouseup', onUp);
      root.addEventListener('touchstart', function (e) {
        if (!e.touches.length || self.agree) return;
        self.dragging = true;
        root.classList.add('is-dragging');
        self.setRev(self.xToRev(e.touches[0].clientX));
        e.preventDefault();
      }, { passive: false });
      root.addEventListener('touchmove', function (e) {
        if (!self.dragging || !e.touches.length) return;
        self.setRev(self.xToRev(e.touches[0].clientX));
        e.preventDefault();
      }, { passive: false });
      root.addEventListener('touchend', onUp);
      root.addEventListener('touchcancel', onUp);
    }

    // Keyboard: ArrowRight -> more warped (rev down); ArrowLeft -> more actual.
    root.addEventListener('keydown', function (ev) {
      var step = ev.shiftKey ? 10 : 2;
      var handled = true;
      switch (ev.key) {
        case 'ArrowRight':
        case 'ArrowUp':   self.setRev(self.rev - step); break;
        case 'ArrowLeft':
        case 'ArrowDown': self.setRev(self.rev + step); break;
        case 'Home':      self.setRev(100); break;
        case 'End':       self.setRev(0); break;
        case 'PageUp':    self.setRev(self.rev - 10); break;
        case 'PageDown':  self.setRev(self.rev + 10); break;
        default:          handled = false;
      }
      if (handled) ev.preventDefault();
    });

    root.addEventListener('dblclick', function (ev) {
      self.setRev(50);
      ev.preventDefault();
    });
  };

  /* ======================================================================= */
  /* ================================= INIT ================================ */
  /* ======================================================================= */
  function init() {
    /* --- B) warp reveal: always available (pure CSS clip, no WebGL) --- */
    var warpRoot = document.getElementById('gcvss-warp');
    if (warpRoot && warpRoot.getAttribute('data-gcvss-ready') !== '1') {
      warpRoot.setAttribute('data-gcvss-ready', '1');
      try {
        var warp = new WarpReveal(warpRoot);
        warp.init();
        var agreeBtn = document.getElementById('gcvss-warp-agree');
        if (agreeBtn) {
          var sync = function () {
            agreeBtn.setAttribute('aria-pressed', warp.agree ? 'true' : 'false');
            var lbl = agreeBtn.querySelector('.gcvss-btn__lbl');
            if (lbl) lbl.textContent = warp.agree ? 'Agreement on' : 'Show agreement';
          };
          agreeBtn.addEventListener('click', function () {
            warp.setAgree(!warp.agree);
            sync();
          });
          sync();
        }
      } catch (e) {
        if (window.console && console.warn) console.warn('[gcvss3d] warp init failed', e);
      }
    }

    /* --- A) cloud orbit: lazy three.js, graceful WebGL/reduced-motion fallback --- */
    var cloudRoot = document.getElementById('gcvss-cloud');
    if (cloudRoot && cloudRoot.getAttribute('data-gcvss-ready') !== '1') {
      cloudRoot.setAttribute('data-gcvss-ready', '1');

      // Keyboard reachability for the cloud region (poster or live).
      if (!cloudRoot.hasAttribute('tabindex')) cloudRoot.setAttribute('tabindex', '0');

      // control refs (all optional; the JS no-ops on any that are absent)
      var sceneBtn  = document.getElementById('gcvss-cloud-scene');
      var playBtn   = document.getElementById('gcvss-cloud-play');
      var replayBtn = document.getElementById('gcvss-cloud-replay');
      var sceneName = document.getElementById('gcvss-cloud-scene-name');
      var chipTxt   = document.getElementById('gcvss-chip-txt');
      var chipDot   = cloudRoot.querySelector('.gcvss-chip__dot');
      var verdict   = document.getElementById('gcvss-verdict');
      // the stage stepper pills live in #gcvss-tl, a SIBLING of #gcvss-cloud
      // inside the figure (NOT a descendant) — query the strip directly.
      var steps     = Array.prototype.slice.call(
        document.querySelectorAll('#gcvss-tl .gcvss-tl__step'));
      var chip = { txt: chipTxt, dot: chipDot, verdict: verdict };

      // GRACEFUL FALLBACK: if WebGL is unavailable OR the user prefers reduced
      // motion, do NOT build a canvas — leave the static poster up (gear by
      // default). The animation controls that only make sense live are disabled;
      // the scene toggle still swaps the poster so both scenes remain reachable.
      if (REDUCED || !webglOK()) {
        cloudRoot.classList.add('is-static-fallback');
        cloudRoot.setAttribute('data-scene', DEFAULT_SCENE);
        // the static poster IS the fused (stage 3) view; keep the stepper strip
        // visible as a static list (mirrors GM3A), with stage 3 marked active +
        // the earlier stages marked done, but make the pills non-interactive.
        steps.forEach(function (s, k) {
          s.classList.toggle('is-active', k === CloudViewer.NSTAGES - 1);
          s.classList.toggle('is-done', k < CloudViewer.NSTAGES - 1);
          s.setAttribute('aria-current', k === CloudViewer.NSTAGES - 1 ? 'step' : 'false');
          s.setAttribute('aria-disabled', 'true');
          s.setAttribute('tabindex', '-1');
        });
        [playBtn, replayBtn].forEach(function (b) {
          if (!b) return;
          b.setAttribute('disabled', '');
          b.setAttribute('aria-disabled', 'true');
          b.setAttribute('title',
            REDUCED ? 'Disabled: reduced-motion is on (showing a static view)'
                    : 'Disabled: 3D viewer unavailable (showing a static view)');
        });
        // the scene toggle stays live in fallback to swap the poster between scenes
        if (sceneBtn) {
          var fbScene = DEFAULT_SCENE;
          var reflectFb = function () {
            var sc = SCENES[fbScene];
            var other = (sc.id === 'gear') ? SCENES.petri : SCENES.gear;
            var lbl = sceneBtn.querySelector('.gcvss-btn__lbl');
            if (lbl) lbl.textContent = other.label;
            sceneBtn.setAttribute('aria-pressed', sc.id === 'petri' ? 'true' : 'false');
            sceneBtn.setAttribute('aria-label', 'Scene: ' + sc.label + '. Activate to switch to the ' + other.label + ' scene.');
            cloudRoot.setAttribute('data-scene', sc.id);
            if (sceneName) sceneName.textContent = sc.label;
            reflectLegendPrimary(cloudRoot, sc);   // shared legend: name the scene's primary cam
            var poster = cloudRoot.querySelector('.gcvss-cloud__poster');
            if (poster) { try { poster.setAttribute('src', asURL(sc.poster)); } catch (e) {} }
          };
          sceneBtn.addEventListener('click', function () {
            fbScene = (fbScene === 'gear') ? 'petri' : 'gear';
            reflectFb();
          });
          reflectFb();
        }
        return;
      }

      try {
        var viewer = new CloudViewer(cloudRoot);
        viewer.wireControls({
          sceneBtn: sceneBtn, playBtn: playBtn, replayBtn: replayBtn,
          sceneName: sceneName, steps: steps, chip: chip
        });
        viewer.observe();
        // tiny namespaced handle for the verify harness / screenshots
        try { window.__niseGcvssCloud = viewer; } catch (e) {}
      } catch (e) {
        if (window.console && console.warn) console.warn('[gcvss3d] cloud setup failed', e);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Tiny namespaced re-scan hook (no other globals).
  try { window.NiseGcvss3D = window.NiseGcvss3D || { rescan: init }; } catch (e) {}
})();
