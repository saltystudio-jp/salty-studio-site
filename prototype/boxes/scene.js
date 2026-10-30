/* SALTY STUDIO — Three.js scene for the box-unboxing prototype.
   Isometric-ish desk scene: solid-shaded boxes on a gridded floor, soft
   shadows, mouse-parallax camera drift (no user-draggable orbit). */

(function (global) {
  "use strict";

  var TOKEN_KEYS = { squirrel: 1, chip: 1, heart: 1, board: 1 };

  // Scene-unit box dimensions (own placeholder proportions; real package
  // sizes aren't published anywhere in the source content). 1 unit ~ 40mm.
  var DIMS = {
    yadokari: { w: 2.3, h: 3.1, d: 0.5 },
    donguri: { w: 3.7, h: 3.7, d: 1.1 },
    karuta: { w: 3.7, h: 2.6, d: 0.9 },
    "murder-mystery": { w: 3.4, h: 2.4, d: 0.7 },
    "make-heroine": { w: 4.0, h: 3.0, d: 1.0 },
    ballooning: { w: 3.0, h: 2.1, d: 0.55 },
  };
  var LID_T = 0.14;

  function hexToRgb(hex) {
    var n = parseInt(hex.replace("#", ""), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function shade(hex, amt) {
    var c = hexToRgb(hex);
    function cl(v) { return Math.max(0, Math.min(255, v)); }
    return "rgb(" + cl(c.r + amt) + "," + cl(c.g + amt) + "," + cl(c.b + amt) + ")";
  }

  function makeLabelTexture(title, accent, flagged) {
    var W = 512, H = 680;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, H);
    // soft vertical sheen
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(255,255,255,.14)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(0,0,0,.12)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (flagged) {
      ctx.save();
      ctx.translate(26, 34);
      ctx.fillStyle = "rgba(255,255,255,.95)";
      var w2 = 112, h2 = 34;
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(w2, 0); ctx.lineTo(w2 - 6, h2); ctx.lineTo(0, h2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#1c1c1a";
      ctx.font = "600 20px 'Zen Kaku Gothic New', sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("仮素材", 16, h2 / 2 + 1);
      ctx.restore();
    }

    ctx.fillStyle = "rgba(255,255,255,.96)";
    ctx.font = "600 42px 'Shippori Mincho', serif";
    ctx.textBaseline = "alphabetic";
    var lines = title.split("\n");
    var ly = H - 48 - (lines.length - 1) * 50;
    lines.forEach(function (line) {
      ctx.fillText(line, 28, ly);
      ly += 50;
    });

    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }

  function makeFloorTexture() {
    var S = 512;
    var cv = document.createElement("canvas");
    cv.width = cv.height = S;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#eef1ef";
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = "rgba(20,30,28,.32)";
    ctx.lineWidth = 2.6;
    var step = S / 8;
    for (var i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(S, i * step); ctx.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    return tex;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(current, target, lambda, dt) {
    return lerp(current, target, 1 - Math.exp(-lambda * dt));
  }

  function BoxScene(canvas, opts) {
    this.canvas = canvas;
    this.onPieceClick = opts.onPieceClick || function () {};
    this.onBoxClick = opts.onBoxClick || function () {};
    this.reduceMotion = !!opts.reduceMotion;

    this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camBase = new THREE.Vector3(0, 5.4, 9.4);
    this.camTargetX = 0;
    this.camCurrentX = 0;
    this.lookAt = new THREE.Vector3(0, 1.1, 0);
    this.mouseNorm = { x: 0, y: 0 };
    this.parallax = { x: 0, y: 0 };

    var hemi = new THREE.HemisphereLight(0xffffff, 0xcac3b3, 0.75);
    this.scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(4, 7, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
    sun.shadow.bias = -0.002;
    this.scene.add(sun);
    var fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-5, 3, -4);
    this.scene.add(fill);

    var floorGeo = new THREE.PlaneGeometry(60, 60);
    var floorMat = new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 1, metalness: 0 });
    var floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.games = [];
    this.pieceMeshes = []; // flat list for raycasting
    this.boxHitboxes = []; // flat list for raycasting

    this._bindEvents();
    this._lastT = performance.now();
    this._resize();
    requestAnimationFrame(this._tick.bind(this));
  }

  BoxScene.prototype._bindEvents = function () {
    var self = this;
    window.addEventListener("resize", function () { self._resize(); });
    this.canvas.addEventListener("pointermove", function (e) {
      var r = self.canvas.getBoundingClientRect();
      self.mouseNorm.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      self.mouseNorm.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
    this.canvas.addEventListener("pointerleave", function () {
      self.mouseNorm.x = 0; self.mouseNorm.y = 0;
    });
    this.canvas.addEventListener("click", function (e) { self._handlePick(e); });
  };

  BoxScene.prototype._resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  BoxScene.prototype._handlePick = function (e) {
    var r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    var pieceHits = this.raycaster.intersectObjects(this.pieceMeshes.map(function (p) { return p.mesh; }));
    if (pieceHits.length) {
      var hitMesh = pieceHits[0].object;
      var found = this.pieceMeshes.filter(function (p) { return p.mesh === hitMesh; })[0];
      if (found) { this.onPieceClick(found.gameId, found.groupKey); return; }
    }
    var boxHits = this.raycaster.intersectObjects(this.boxHitboxes.map(function (b) { return b.mesh; }));
    if (boxHits.length) {
      var hb = boxHits[0].object;
      var g = this.boxHitboxes.filter(function (b) { return b.mesh === hb; })[0];
      if (g) this.onBoxClick(g.index);
    }
  };

  BoxScene.prototype.buildGames = function (games) {
    var self = this;
    var gap = 0.9;
    var x = 0;
    var positions = [];
    games.forEach(function (game, i) {
      var d = DIMS[game.id];
      if (i > 0) x += d.w / 2 + gap / 2 + positions[i - 1].halfW;
      positions.push({ x: x, halfW: d.w / 2 });
    });
    var total = positions.length ? positions[positions.length - 1].x : 0;
    var offset = total / 2;

    games.forEach(function (game, i) {
      var d = DIMS[game.id];
      var baseX = positions[i].x - offset;
      var entry = self._buildOne(game, d, baseX, i);
      self.games.push(entry);
    });

    this.activeIndex = 0;
    this.camTargetX = this.games.length ? this.games[0].baseX : 0;
    this.camCurrentX = this.camTargetX;
  };

  BoxScene.prototype._buildOne = function (game, d, baseX, index) {
    var group = new THREE.Group();
    group.position.set(baseX, 0, 0);
    this.scene.add(group);

    var bodyH = d.h - LID_T;
    var accent = game.accent;
    var isPhoto = game.art && game.art.kind === "photo";

    var sideMat = new THREE.MeshStandardMaterial({ color: shade(accent, -22), roughness: 0.75 });
    var backMat = new THREE.MeshStandardMaterial({ color: shade(accent, -34), roughness: 0.85 });
    var innerMat = new THREE.MeshStandardMaterial({ color: "#e9e2cf", roughness: 0.9 });
    var frontMat;
    if (isPhoto) {
      var tex = new THREE.TextureLoader().load(game.art.box);
      tex.encoding = THREE.sRGBEncoding;
      frontMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    } else {
      var labelTex = makeLabelTexture(game.titleShort || game.title, accent, true);
      frontMat = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.6 });
    }

    // BoxGeometry material order: [+x, -x, +y, -y, +z, -z]
    var bodyGeo = new THREE.BoxGeometry(d.w, bodyH, d.d);
    var bodyMats = [sideMat, sideMat, innerMat, backMat, frontMat, backMat];
    var body = new THREE.Mesh(bodyGeo, bodyMats);
    body.position.y = bodyH / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Lid: pivots at the back-top edge, rotates open (toward -Z / up).
    var lidPivot = new THREE.Group();
    lidPivot.position.set(0, bodyH, -d.d / 2);
    group.add(lidPivot);
    var lidMat = new THREE.MeshStandardMaterial({ color: shade(accent, -8), roughness: 0.65 });
    var lidGeo = new THREE.BoxGeometry(d.w, LID_T, d.d);
    var lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.set(0, LID_T / 2, d.d / 2);
    lid.castShadow = true;
    lidPivot.add(lid);

    // Invisible hitbox spanning the whole box footprint (click target).
    var hitGeo = new THREE.BoxGeometry(d.w, d.h, d.d);
    var hitMat = new THREE.MeshBasicMaterial({ visible: false });
    var hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.position.y = d.h / 2;
    group.add(hitbox);
    this.boxHitboxes.push({ mesh: hitbox, index: index });

    // Pieces: built once, positions stored as closed/open targets.
    var pieces = [];
    var groups = game.componentGroups || [];
    var plannedGroups = groups.map(function (g) {
      var isToken = !!TOKEN_KEYS[g.key];
      var maxShow = isToken ? 4 : 5;
      var imgCount = g.sampleImages ? g.sampleImages.length : 0;
      var visibleCount = Math.max(1, Math.min(g.qty, maxShow, imgCount || maxShow));
      return { g: g, isToken: isToken, visibleCount: visibleCount };
    });
    var gapBetweenGroups = 0.35;
    var groupWidths = plannedGroups.map(function (p) {
      var pw = p.isToken ? 0.42 : 0.56;
      return (p.visibleCount - 1) * (pw * 0.72) + pw;
    });
    var totalW = groupWidths.reduce(function (s, w) { return s + w; }, 0) + gapBetweenGroups * Math.max(0, groupWidths.length - 1);
    var cursorX = -totalW / 2;

    plannedGroups.forEach(function (plan, gi) {
      var g = plan.g, isToken = plan.isToken, visibleCount = plan.visibleCount;
      var pw = isToken ? 0.42 : 0.56, ph = isToken ? 0.42 : 0.78;
      var groupW = groupWidths[gi];
      var groupCenter = cursorX + groupW / 2;
      cursorX += groupW + gapBetweenGroups;
      var spread = visibleCount > 1 ? groupW / (visibleCount - 1) * 0.86 : 0;

      for (var i = 0; i < visibleCount; i++) {
        var geo = isToken
          ? new THREE.CylinderGeometry(pw / 2, pw / 2, 0.06, 24)
          : new THREE.BoxGeometry(pw, 0.045, ph);
        var mat;
        var img = g.sampleImages && g.sampleImages[i];
        if (img) {
          var ptex = new THREE.TextureLoader().load(img);
          ptex.encoding = THREE.sRGBEncoding;
          mat = new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.55 });
        } else {
          mat = new THREE.MeshStandardMaterial({ color: shade(accent, isToken ? 30 : (i % 2 ? -4 : 16)), roughness: 0.7 });
        }
        var mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        var px = groupCenter + (i - (visibleCount - 1) / 2) * spread;
        var pz = d.d * 0.32 + gi * 0.05;
        var rotY = (Math.random() - 0.5) * 0.5;
        var closed = { x: 0, y: bodyH * 0.55, z: 0, ry: 0, s: 0.22 };
        var open = { x: px, y: 0.03, z: pz, ry: rotY, s: 1 };

        mesh.position.set(closed.x, closed.y, closed.z);
        mesh.scale.setScalar(closed.s);
        group.add(mesh);

        var pieceEntry = {
          mesh: mesh, closed: closed, open: open,
          cur: { x: closed.x, y: closed.y, z: closed.z, ry: closed.ry, s: closed.s },
          delay: 90 + gi * 120 + i * 40,
          gameId: game.id, groupKey: g.key,
        };
        pieces.push(pieceEntry);
        this.pieceMeshes.push(pieceEntry);
      }
    }, this);

    return {
      id: game.id, baseX: baseX, group: group, body: body, lidPivot: lidPivot,
      pieces: pieces, dims: d,
      state: { lift: 0, forward: 0, lidOpen: 0, openT0: 0 },
      phase: "closed",
    };
  };

  BoxScene.prototype.select = function (index) {
    this.activeIndex = index;
    var g = this.games[index];
    if (g) this.camTargetX = g.baseX;
    this.games.forEach(function (entry, i) {
      entry.liftTarget = i === index ? 1 : 0;
    });
  };

  BoxScene.prototype.open = function (index) {
    var g = this.games[index];
    if (!g) return;
    g.phase = "open";
    g.state.openT0 = performance.now();
  };

  BoxScene.prototype.close = function (index) {
    var g = this.games[index];
    if (!g) return;
    g.phase = "closed";
  };

  BoxScene.prototype._tick = function (now) {
    var dt = Math.min(0.05, (now - this._lastT) / 1000);
    this._lastT = now;
    var k = this.reduceMotion ? 60 : 9;
    var kLid = this.reduceMotion ? 60 : 5;

    this.camCurrentX = damp(this.camCurrentX, this.camTargetX, 7, dt);
    this.parallax.x = damp(this.parallax.x, this.mouseNorm.x * 0.5, 4, dt);
    this.parallax.y = damp(this.parallax.y, this.mouseNorm.y * 0.22, 4, dt);
    this.camera.position.set(
      this.camBase.x + this.camCurrentX + this.parallax.x,
      this.camBase.y - this.parallax.y,
      this.camBase.z
    );
    this.camera.lookAt(this.camCurrentX, this.lookAt.y, this.lookAt.z);

    for (var gi = 0; gi < this.games.length; gi++) {
      var entry = this.games[gi];
      var st = entry.state;
      var liftT = entry.liftTarget || 0;
      st.lift = damp(st.lift, liftT, k, dt);
      st.forward = damp(st.forward, liftT, k, dt);
      entry.group.position.y = st.lift * 0.12;
      entry.group.position.z = st.forward * 0.4;
      var scale = 1 + st.lift * 0.04;
      entry.group.scale.setScalar(scale);

      var lidTarget = entry.phase === "open" ? 1 : 0;
      st.lidOpen = damp(st.lidOpen, lidTarget, kLid, dt);
      entry.lidPivot.rotation.x = -st.lidOpen * (Math.PI * 0.72);

      var elapsed = entry.phase === "open" ? now - st.openT0 : -1;
      for (var pi = 0; pi < entry.pieces.length; pi++) {
        var p = entry.pieces[pi];
        var targetSet = entry.phase === "open" && elapsed > p.delay ? p.open : p.closed;
        var pk = entry.phase === "open" ? k : k * 1.4;
        p.cur.x = damp(p.cur.x, targetSet.x, pk, dt);
        p.cur.y = damp(p.cur.y, targetSet.y, pk, dt);
        p.cur.z = damp(p.cur.z, targetSet.z, pk, dt);
        p.cur.ry = damp(p.cur.ry, targetSet.ry, pk, dt);
        p.cur.s = damp(p.cur.s, targetSet.s, pk, dt);
        p.mesh.position.set(p.cur.x, p.cur.y, p.cur.z);
        p.mesh.rotation.y = p.cur.ry;
        p.mesh.scale.setScalar(p.cur.s);
      }
    }

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._tick.bind(this));
  };

  global.BoxScene = BoxScene;
})(window);
