/* ドングリどこだ？ 体験版 — Vanilla JS 版ゲームエンジン */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";

  /* ---------- ルール定数 ---------- */
  var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  var DIRLABEL = ["北", "東", "南", "西"];

  var PLAYERS = [
    { name: "あか", color: "#E2664B", mark: "circle" },
    { name: "あお", color: "#57A6C9", mark: "triangle" },
    { name: "き", color: "#DFAF3C", mark: "square" },
    { name: "むらさき", color: "#A87CC8", mark: "diamond" }
  ];
  var WILD = { name: "のら", color: "#9C8B75", mark: "circle" };
  function unitOf(s) { return s.player < 0 ? WILD : PLAYERS[s.player]; }

  var PERSONA = [
    { name: "速攻", want: { 1: 3.5, 2: 2.5, 3: 1.5, 4: 1.0 }, spite: 0.4, tip: "高い実を足元に埋めて先に掘る" },
    { name: "釣り", want: { 1: 1.0, 2: 2.5, 3: 2.5, 4: 3.5 }, spite: 1.0, tip: "安い実を目の前に置いて釣る" },
    { name: "秘匿", want: { 1: 2.0, 2: 1.5, 3: 3.0, 4: 4.2 }, spite: 0.7, tip: "高い実を遠くに隠す" },
    { name: "きまぐれ", want: null, spite: 1.5, tip: "気分で埋め、勝っている人の邪魔をする" }
  ];

  var NUT = { 1: "🫘", 2: "🥜", 3: "🍄", 4: "🌰" };
  function nutSize(v) { return 20 + v * 6; }

  var QUADC = ["#C7AE76", "#AFAE80", "#C39F80", "#A4B085"];
  var DUGC = ["#54452F", "#4B4633", "#523F35", "#464B36"];
  var SUBW = 33, SUBH = 46, CW = 66, CH = 92, PAD = 14;

  function K(x, y) { return x + "," + y; }

  function makeFriendly(teams) {
    return function (a, b) {
      if (!a || !b || a.player < 0 || b.player < 0) return false;
      if (a.player === b.player) return true;
      return !!teams && a.player % 2 === b.player % 2;
    };
  }
  function cardOf(gx, gy) { return [Math.floor(gx / 2), Math.floor(gy / 2)]; }

  /* ---------- 視線 ---------- */
  function traceRay(a, squirrels, b, opt) {
    var block = !opt || opt.block !== false;
    var fr = (opt && opt.fr) || function () { return false; };
    var dx = DIRS[a.facing][0], dy = DIRS[a.facing][1];
    var x = a.gx, y = a.gy;
    var seenIdx = [];
    for (var step = 0; step < 120; step++) {
      var nx = x + dx, ny = y + dy;
      if (nx < b.minGx - 1 || nx > b.maxGx + 1 || ny < b.minGy - 1 || ny > b.maxGy + 1)
        return { x: nx, y: ny, seenIdx: seenIdx, blocked: false };
      x = nx; y = ny;
      var occ = [];
      squirrels.forEach(function (s, i) { if (s.gx === x && s.gy === y) occ.push({ s: s, i: i }); });
      occ.forEach(function (o) { seenIdx.push(o.i); });
      if (block && occ.some(function (o) { return o.s.facing % 2 === a.facing % 2 && !fr(a, o.s); }))
        return { x: x, y: y, seenIdx: seenIdx, blocked: true };
    }
    return { x: x, y: y, seenIdx: seenIdx, blocked: false };
  }

  function watchedIn(hyp, idx, bounds, opt) {
    var fr = (opt && opt.fr) || function () { return false; };
    for (var i = 0; i < hyp.length; i++) {
      if (i === idx || fr(hyp[i], hyp[idx])) continue;
      if (traceRay(hyp[i], hyp, bounds, opt).seenIdx.indexOf(idx) !== -1) return true;
    }
    return false;
  }

  /* ---------- 山札 ---------- */
  function shuffle(a) {
    var d = a.slice();
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = d[i]; d[i] = d[j]; d[j] = t;
    }
    return d;
  }

  function dealCards(np, deal) {
    var per = np === 4 ? 4 : np === 3 ? 5 : 8;
    if (deal === "even" && np === 4)
      return { hands: [[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]], wild: null };
    var deck = shuffle([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
    var hands = [];
    for (var i = 0; i < np; i++) hands.push(deck.slice(i * per, i * per + per));
    var used = np * per;
    return { hands: hands, wild: used < 16 ? deck[used] : null };
  }

  /* ---------- CPUの推理 ---------- */
  function estValue(card, viewer, cards, marks) {
    if (card.owner === viewer) return card.value;
    var byOwner = marks && card.owner >= 0;
    var pool = Object.keys(cards).map(function (k) { return cards[k]; })
      .filter(function (c) { return c.owner !== -1 && !c.dug && c.owner !== viewer && (!byOwner || c.owner === card.owner); })
      .map(function (c) { return c.value; });
    if (!pool.length) return 2.5;
    return pool.reduce(function (a, b) { return a + b; }, 0) / pool.length;
  }

  /* ---------- CPUの手番プラン ---------- */
  function bestPlan(cards, squirrels, idx, budget, bounds, opt) {
    var marks = opt.marks, scores = opt.scores, goal = opt.goal, spite = opt.spite,
      owner = opt.owner, isWild = opt.isWild, fr = opt.fr, block = opt.block;
    var ray = { fr: fr, block: block };
    var me = squirrels[idx];
    function sk(s) { return s.gx + "," + s.gy + "," + s.f; }
    var start = { gx: me.gx, gy: me.gy, f: me.facing };
    var dist = {}; dist[sk(start)] = 0;
    var prev = {};
    var q = [start], all = [start];
    while (q.length) {
      var s = q.shift();
      var d = dist[sk(s)];
      if (d >= budget) continue;
      var nb = [
        { st: { gx: s.gx, gy: s.gy, f: (s.f + 3) % 4 }, a: "L" },
        { st: { gx: s.gx, gy: s.gy, f: (s.f + 1) % 4 }, a: "R" }
      ];
      var dx = DIRS[s.f][0], dy = DIRS[s.f][1];
      var nx = s.gx + dx, ny = s.gy + dy;
      var blocked = squirrels.some(function (o, i) { return i !== idx && o.gx === nx && o.gy === ny; });
      if (cards[K.apply(null, cardOf(nx, ny))] && !blocked) nb.push({ st: { gx: nx, gy: ny, f: s.f }, a: "F" });
      nb.forEach(function (item) {
        var key = sk(item.st);
        if (dist[key] === undefined) {
          dist[key] = d + 1; prev[key] = { p: s, a: item.a }; q.push(item.st); all.push(item.st);
        }
      });
    }

    var targets = [];
    if (!isWild)
      Object.keys(cards).forEach(function (k) {
        var c = cards[k];
        if (c.owner !== -1 && !c.dug) targets.push({ c: c, v: estValue(c, owner, cards, marks) });
      });

    var myScore = scores[owner] || 0;
    var menace = squirrels.map(function (o) {
      if (o.player < 0 || fr({ player: owner }, o)) return 0;
      var sc = scores[o.player] || 0;
      var m = Math.max(0, sc - myScore) * 0.5;
      if (goal > 0) m += Math.max(0, sc - (goal - 5)) * 1.2;
      return m;
    });

    function evalState(s, d) {
      var cc = cardOf(s.gx, s.gy), cx = cc[0], cy = cc[1];
      var card = cards[K(cx, cy)];
      var hyp = squirrels.map(function (o, i) {
        return i === idx ? { player: o.player, gx: s.gx, gy: s.gy, facing: s.f } : o;
      });
      var alone = !squirrels.some(function (o, i) {
        if (i === idx) return false;
        var oc = cardOf(o.gx, o.gy);
        return oc[0] === cx && oc[1] === cy;
      });
      var watched = watchedIn(hyp, idx, bounds, ray);
      var sc = 0;

      if (!isWild) {
        var v = 0;
        if (card && card.owner !== -1 && !card.dug) v = estValue(card, owner, cards, marks);
        if (v > 0) {
          if (alone && !watched) sc += v * 12 + 8;
          else if (alone) sc += v * 2;
          else sc += v * 0.5;
        }
        if (targets.length) {
          var pull = -99;
          targets.forEach(function (t) {
            var dxs = Math.max(0, t.c.cx * 2 - s.gx, s.gx - (t.c.cx * 2 + 1));
            var dys = Math.max(0, t.c.cy * 2 - s.gy, s.gy - (t.c.cy * 2 + 1));
            var p = t.v * 2 - (dxs + dys) * 0.9;
            if (p > pull) pull = p;
          });
          sc += pull * 0.6;
        }
      }

      var myRay = traceRay(hyp[idx], hyp, bounds, ray);
      myRay.seenIdx.forEach(function (j) {
        if (j === idx || fr({ player: owner }, hyp[j])) return;
        var tcc = cardOf(hyp[j].gx, hyp[j].gy);
        var tc = cards[K(tcc[0], tcc[1])];
        if (tc && tc.owner !== -1 && !tc.dug) sc += estValue(tc, owner, cards, marks) * 1.6 + 1;
        sc += menace[j] * 4 * spite;
      });
      squirrels.forEach(function (o, j) {
        if (j === idx || menace[j] <= 0) return;
        var occ = cardOf(o.gx, o.gy), ox = occ[0], oy = occ[1];
        var oc = cards[K(ox, oy)];
        if (oc && oc.owner !== -1 && !oc.dug && ox === cx && oy === cy) sc += menace[j] * 6 * spite;
        if (o.gx + DIRS[o.facing][0] === s.gx && o.gy + DIRS[o.facing][1] === s.gy) sc += menace[j] * 2 * spite;
      });

      return sc - d * 0.12;
    }

    var best = null;
    all.forEach(function (s) {
      var sc = evalState(s, dist[sk(s)]);
      if (!best || sc > best.sc) best = { s: s, sc: sc };
    });
    var seq = [];
    var c = best.s;
    while (sk(c) !== sk(start)) { var p = prev[sk(c)]; seq.unshift(p.a); c = p.p; }
    return { seq: seq, score: best.sc };
  }

  window.__DONGURI__ = {
    SVGNS: SVGNS, DIRS: DIRS, DIRLABEL: DIRLABEL, PLAYERS: PLAYERS, WILD: WILD, unitOf: unitOf,
    PERSONA: PERSONA, NUT: NUT, nutSize: nutSize, QUADC: QUADC, DUGC: DUGC,
    SUBW: SUBW, SUBH: SUBH, CW: CW, CH: CH, PAD: PAD, K: K, makeFriendly: makeFriendly, cardOf: cardOf,
    traceRay: traceRay, watchedIn: watchedIn, shuffle: shuffle, dealCards: dealCards,
    estValue: estValue, bestPlan: bestPlan
  };
})();

/* ============================================================
   状態管理 + CPUループ
   ============================================================ */
(function () {
  "use strict";
  var E = window.__DONGURI__;
  var DIRS = E.DIRS, DIRLABEL = E.DIRLABEL, PLAYERS = E.PLAYERS, WILD = E.WILD, unitOf = E.unitOf,
    PERSONA = E.PERSONA, K = E.K, makeFriendly = E.makeFriendly, cardOf = E.cardOf,
    traceRay = E.traceRay, watchedIn = E.watchedIn, dealCards = E.dealCards, estValue = E.estValue, bestPlan = E.bestPlan;

  function freshState() {
    return {
      mode: "4", block: true, seats: ["human", "cpu", "cpu", "cpu"], deal: "random", marks: false,
      endMode: "rest4", goal: 10,
      phase: "setup", cards: {}, hands: [[], [], [], []], wildCard: null, cur: 0,
      selIdx: null, pendingSlot: null, squirrels: [], deployOrder: [], deployStep: 0, deployQ: null,
      active: 0, ap: 4, scores: [0, 0, 0, 0], digs: [0, 0, 0, 0], stall: 0, history: [], handoff: false,
      result: null, log: [{ t: "人数と席を決めて、ゲームをはじめてください。" }],
      showLos: true, showAll: false, showMine: false, fast: false, running: true, tilt3d: true,
      help: false, pg: 0,
      justDugKey: null, justPlacedKey: null, _cpuTimer: null
    };
  }

  var S = freshState();
  window.__DONGURI_APP__ = window.__DONGURI_APP__ || { render: function () {} };
  var App = window.__DONGURI_APP__;
  function render() { App.render(); }

  function say(t, c) { S.log = [{ t: t, c: c }].concat(S.log).slice(0, 60); }

  function np() { return S.mode === "team" ? 4 : Number(S.mode); }
  function teams() { return S.mode === "team"; }
  function fr() { return makeFriendly(teams()); }
  function rayOpt() { return { fr: fr(), block: S.block }; }
  function humanCount() { return S.seats.slice(0, np()).filter(function (s) { return s === "human"; }).length; }
  function perHand() { var n = np(); return n === 4 ? 4 : n === 3 ? 5 : 8; }

  function afterCurChange() {
    if (humanCount() >= 2 && S.phase !== "over" && S.phase !== "setup" && S.seats[S.cur] === "human") S.handoff = true;
  }

  /* ===== 開始・リセット ===== */
  function startGame() {
    var n = np();
    var dealt = dealCards(n, S.deal);
    var full = [[], [], [], []];
    dealt.hands.forEach(function (h, i) { full[i] = h; });
    var order = n === 4 ? [0, 1, 2, 3] : n === 3 ? [0, 1, 2] : [0, 1, 0, 1];
    S.cards = {}; S.cards["0,0"] = { cx: 0, cy: 0, owner: -1, value: null, dug: false };
    S.hands = full; S.wildCard = dealt.wild;
    S.deployOrder = order; S.deployStep = 0; S.deployQ = null;
    S.squirrels = []; S.cur = 0; S.active = 0; S.ap = 4;
    S.scores = [0, 0, 0, 0]; S.digs = [0, 0, 0, 0];
    S.selIdx = null; S.pendingSlot = null; S.stall = 0;
    S.history = []; S.result = null; S.handoff = false;
    S.phase = "place";
    S.log = [{ t: n + "人でスタート。まん中のきりかぶから、木の実を埋めていきます。" }];
    afterCurChange();
    render();
  }

  function backToSetup() {
    S.phase = "setup"; S.cards = {}; S.squirrels = []; S.result = null;
    S.history = []; S.handoff = false;
    S.log = [{ t: "人数と席を決めて、ゲームをはじめてください。" }];
    render();
  }

  /* ===== 派生 ===== */
  function getSlots() {
    if (S.phase !== "place") return [];
    var out = {};
    Object.keys(S.cards).forEach(function (k) {
      var c = S.cards[k];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var kk = K(c.cx + d[0], c.cy + d[1]);
        if (!S.cards[kk]) out[kk] = true;
      });
    });
    return Object.keys(out).map(function (k) { return k.split(",").map(Number); });
  }

  function getBounds() {
    var slots = getSlots();
    var xs = [0], ys = [0];
    Object.keys(S.cards).forEach(function (k) { var c = S.cards[k]; xs.push(c.cx); ys.push(c.cy); });
    slots.forEach(function (s) { xs.push(s[0]); ys.push(s[1]); });
    var minCx = Math.min.apply(null, xs), maxCx = Math.max.apply(null, xs);
    var minCy = Math.min.apply(null, ys), maxCy = Math.max.apply(null, ys);
    return {
      minCx: minCx, maxCx: maxCx, minCy: minCy, maxCy: maxCy,
      minGx: minCx * 2, maxGx: maxCx * 2 + 1, minGy: minCy * 2, maxGy: maxCy * 2 + 1,
      w: (maxCx - minCx + 1) * E.CW + E.PAD * 2, h: (maxCy - minCy + 1) * E.CH + E.PAD * 2
    };
  }

  function px(bounds, gx) { return E.PAD + (gx - bounds.minGx) * E.SUBW; }
  function py(bounds, gy) { return E.PAD + (gy - bounds.minGy) * E.SUBH; }

  function getRays(bounds) {
    var opt = rayOpt();
    return S.squirrels.map(function (a) { return traceRay(a, S.squirrels, bounds, opt); });
  }
  function getWatchers(rays) {
    var frf = fr();
    var m = S.squirrels.map(function () { return []; });
    rays.forEach(function (r, i) {
      r.seenIdx.forEach(function (j) { if (j !== i && !frf(S.squirrels[i], S.squirrels[j])) m[j].push(i); });
    });
    return m;
  }
  function getMyUnits() {
    var n = np();
    return S.squirrels.map(function (s, i) { return i; })
      .filter(function (i) { return S.squirrels[i].player === S.cur || (n === 3 && S.squirrels[i].player < 0); });
  }

  function unitInfo(u, watchers) {
    var s = S.squirrels[u];
    if (!s) return null;
    var cc = cardOf(s.gx, s.gy), cx = cc[0], cy = cc[1];
    var card = S.cards[K(cx, cy)];
    var frf = fr();
    var foes = S.squirrels.filter(function (o, i) {
      if (i === u || frf(s, o)) return false;
      var oc = cardOf(o.gx, o.gy);
      return oc[0] === cx && oc[1] === cy;
    }).length;
    var seen = (watchers && watchers[u]) || [];
    var fx = DIRS[s.facing][0], fy = DIRS[s.facing][1];
    var nx = s.gx + fx, ny = s.gy + fy;
    var fc = cardOf(nx, ny);
    var fwdCard = S.cards[K(fc[0], fc[1])];
    var fwdBlocked = S.squirrels.some(function (o, i) { return i !== u && o.gx === nx && o.gy === ny; });
    var isMine = s.player === S.cur;
    var digTarget = !!(card && card.owner !== -1 && !card.dug);
    return {
      s: s, cx: cx, cy: cy, card: card, foes: foes, seen: seen, nx: nx, ny: ny, isMine: isMine,
      digTarget: digTarget, fwdBlocked: fwdBlocked,
      canFwd: !!fwdCard && !fwdBlocked,
      canDig: isMine && S.ap === 4 && digTarget && foes === 0 && seen.length === 0
    };
  }

  var undug, restLimit;
  function recomputeMisc() {
    undug = Object.keys(S.cards).filter(function (k) { var c = S.cards[k]; return c.owner !== -1 && !c.dug; }).length;
    restLimit = S.endMode === "rest4" ? 4 : 0;
  }

  /* ===== 履歴 ===== */
  function snap() {
    return {
      phase: S.phase, cards: S.cards, hands: S.hands, wildCard: S.wildCard, squirrels: S.squirrels,
      deployStep: S.deployStep, ap: S.ap, cur: S.cur, active: S.active, scores: S.scores, digs: S.digs, stall: S.stall
    };
  }
  function pushHist() { S.history = S.history.concat([snap()]).slice(-80); }
  function undo() {
    if (!S.history.length) return;
    var h = S.history.slice();
    var sp = h.pop();
    var hasHuman = S.seats.slice(0, np()).indexOf("human") !== -1;
    while (h.length && hasHuman && S.seats[sp.cur] !== "human") sp = h.pop();
    S.phase = sp.phase; S.cards = sp.cards; S.hands = sp.hands; S.wildCard = sp.wildCard;
    S.squirrels = sp.squirrels; S.deployStep = sp.deployStep; S.ap = sp.ap;
    S.cur = sp.cur; S.active = sp.active; S.scores = sp.scores; S.digs = sp.digs; S.stall = sp.stall;
    S.result = null; S.selIdx = null; S.pendingSlot = null; S.deployQ = null; S.history = h;
    say("1手もどした");
    render();
  }

  /* ===== 配置フェイズ ===== */
  function finishPlacing(C) {
    var next = C;
    if (S.wildCard != null) {
      var cand = [];
      Object.keys(C).forEach(function (k) {
        var c = C[k];
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var kk = K(c.cx + d[0], c.cy + d[1]);
          if (!C[kk] && cand.indexOf(kk) === -1) cand.push(kk);
        });
      });
      var k = cand[Math.floor(Math.random() * cand.length)];
      var wx = Number(k.split(",")[0]), wy = Number(k.split(",")[1]);
      next = Object.assign({}, C);
      next[k] = { cx: wx, cy: wy, owner: -2, value: S.wildCard, dug: false };
      say("野生の実がひとつ、だれにも知られずに埋まっている");
    }
    S.cards = next;
    S.phase = "deploy"; S.cur = 0; S.deployStep = 0;
    say("森ができた。きりかぶに立ってください。");
  }

  function doPlace(cx, cy, v, who) {
    pushHist();
    var key = K(cx, cy);
    var C = Object.assign({}, S.cards);
    C[key] = { cx: cx, cy: cy, owner: who, value: v, dug: false };
    var nh = S.hands.map(function (h, i) {
      if (i !== who) return h;
      var k = h.indexOf(v);
      return k < 0 ? h : h.slice(0, k).concat(h.slice(k + 1));
    });
    S.hands = nh;
    S.selIdx = null; S.pendingSlot = null;
    S.justPlacedKey = key;
    say(PLAYERS[who].name + "リスが木の実を埋めた", PLAYERS[who].color);
    if (nh.slice(0, np()).every(function (h) { return h.length === 0; })) { finishPlacing(C); }
    else {
      S.cards = C;
      var n = (who + 1) % np();
      while (nh[n].length === 0) n = (n + 1) % np();
      S.cur = n;
    }
    afterCurChange();
    render();
  }

  /* ===== 配備フェイズ ===== */
  function doDeploy(q, f, who) {
    pushHist();
    var add = { player: who, gx: q % 2, gy: Math.floor(q / 2), facing: f };
    var Sq = S.squirrels.concat([add]);
    say((who < 0 ? WILD.name : PLAYERS[who].name) + "リスが" + DIRLABEL[f] + "をむいて立った",
      who < 0 ? WILD.color : PLAYERS[who].color);
    var step = S.deployStep + 1;
    S.deployQ = null;
    if (step >= S.deployOrder.length) {
      if (np() === 3) {
        var used = Sq.map(function (s) { return s.gy * 2 + s.gx; });
        var free = [0, 1, 2, 3].filter(function (x) { return used.indexOf(x) === -1; });
        var fq = free[Math.floor(Math.random() * free.length)];
        Sq = Sq.concat([{ player: -1, gx: fq % 2, gy: Math.floor(fq / 2), facing: Math.floor(Math.random() * 4) }]);
        say("のらリスも起きてきた。だれの手番でも動かせます。", WILD.color);
      }
      S.squirrels = Sq; S.deployStep = step;
      S.phase = "play"; S.cur = 0; S.ap = 4;
      S.active = Sq.map(function (s) { return s.player; }).indexOf(0);
      say("――さがしはじめる。");
    } else {
      S.squirrels = Sq; S.deployStep = step; S.cur = S.deployOrder[step];
    }
    afterCurChange();
    render();
  }

  /* ===== プレイ ===== */
  function upd(u, fn) { S.squirrels = S.squirrels.map(function (s, i) { return i === u ? fn(s) : s; }); }

  function endTurn(auto) {
    var n = (S.cur + 1) % np();
    S.ap = 4; S.cur = n; S.stall += 1;
    S.active = S.squirrels.map(function (s) { return s.player; }).indexOf(n);
    if (!auto) say("手番をおえた");
    afterCurChange();
  }
  function spend(n) {
    var left = S.ap - n; S.ap = left;
    if (left <= 0) endTurn(true);
  }

  function forward(u) {
    var watchers = getWatchers(getRays(getBounds()));
    var q = unitInfo(u, watchers);
    if (!q || !q.canFwd || S.ap < 1) return;
    pushHist();
    var nx = q.nx, ny = q.ny;
    upd(u, function (s) { return Object.assign({}, s, { gx: nx, gy: ny }); });
    spend(1);
    render();
  }
  function rotate(u, d) {
    if (S.ap < 1) return;
    pushHist();
    upd(u, function (s) { return Object.assign({}, s, { facing: (s.facing + d + 4) % 4 }); });
    spend(1);
    render();
  }

  function dig(u) {
    var watchers = getWatchers(getRays(getBounds()));
    var q = unitInfo(u, watchers);
    if (!q || !q.canDig) return;
    pushHist();
    var k = K(q.cx, q.cy);
    var v = q.card.value;
    var C = Object.assign({}, S.cards);
    C[k] = Object.assign({}, C[k], { dug: true });
    S.cards = C;
    S.justDugKey = k;
    var ns = S.scores.map(function (s, i) { return i === S.cur ? s + v : s; });
    var nd = S.digs.map(function (s, i) { return i === S.cur ? s + 1 : s; });
    S.scores = ns; S.digs = nd; S.stall = 0;
    say(PLAYERS[S.cur].name + "リスが掘りだした → " + v + "点", PLAYERS[S.cur].color);

    recomputeMisc();
    var rest = undug;
    var tScore = [ns[0] + ns[2], ns[1] + ns[3]];
    var t = teams();
    var reached = S.goal > 0 && (t ? tScore[S.cur % 2] >= S.goal : ns[S.cur] >= S.goal);
    if (reached || rest <= restLimit) {
      var best, tie;
      if (t) {
        best = tScore[0] >= tScore[1] ? 0 : 1;
        tie = tScore[0] === tScore[1];
      } else {
        best = 0;
        for (var i = 1; i < np(); i++)
          if (ns[i] > ns[best] || (ns[i] === ns[best] && nd[i] > nd[best])) best = i;
        var sameScore = ns.slice(0, np()).filter(function (x) { return x === ns[best]; }).length > 1;
        var sameDigs = nd.slice(0, np()).filter(function (x) { return x === nd[best]; }).length > 1;
        tie = sameScore && sameDigs;
      }
      S.result = {
        scores: ns, digs: nd, best: best, tie: tie, teams: t, tScore: tScore,
        why: reached ? S.goal + "点先取" : S.endMode === "rest4" ? "のこり4枚" : "ぜんぶ掘った"
      };
      S.phase = "over";
      render();
      return;
    }
    var n = (S.cur + 1) % np();
    S.ap = 4; S.cur = n;
    S.active = S.squirrels.map(function (s) { return s.player; }).indexOf(n);
    afterCurChange();
    render();
  }

  /* ===== CPU ===== */
  function cpuPlace() {
    var p = PERSONA[S.cur];
    var best = null;
    var slots = getSlots();
    var pool = S.deal === "draw" ? [S.hands[S.cur][0]] : S.hands[S.cur];
    pool.forEach(function (v) {
      slots.forEach(function (xy) {
        var x = xy[0], y = xy[1];
        var d = Math.abs(x) + Math.abs(y);
        var want = p.want ? p.want[v] : 1 + Math.random() * 3;
        var fit = -Math.abs(d - want) + Math.random() * 0.7;
        if (!best || fit > best.fit) best = { v: v, x: x, y: y, fit: fit };
      });
    });
    if (best) doPlace(best.x, best.y, best.v, S.cur);
  }

  function cpuDeploy() {
    var used = S.squirrels.map(function (s) { return s.gy * 2 + s.gx; });
    var free = [0, 1, 2, 3].filter(function (x) { return used.indexOf(x) === -1; });
    var q = free[Math.floor(Math.random() * free.length)];
    var mineList = Object.keys(S.cards).map(function (k) { return S.cards[k]; })
      .filter(function (c) { return c.owner === S.cur; }).sort(function (a, b) { return b.value - a.value; });
    var mine = mineList[0];
    var f = Math.floor(Math.random() * 4);
    if (mine) f = Math.abs(mine.cx) >= Math.abs(mine.cy) ? (mine.cx > 0 ? 1 : 3) : (mine.cy > 0 ? 2 : 0);
    doDeploy(q, f, S.cur);
  }

  function cpuStep() {
    recomputeMisc();
    var bounds = getBounds();
    var watchers = getWatchers(getRays(bounds));
    var myUnits = getMyUnits();
    if (S.ap === 4) {
      for (var i = 0; i < myUnits.length; i++) {
        var u = myUnits[i];
        var q = unitInfo(u, watchers);
        if (q && q.canDig) {
          var v = estValue(q.card, S.cur, S.cards, S.marks);
          if (v >= (undug <= 8 ? 1 : 2)) { S.active = u; dig(u); return; }
        }
      }
    }
    var best = null;
    myUnits.forEach(function (u) {
      var isWild = S.squirrels[u].player < 0;
      var plan = bestPlan(S.cards, S.squirrels, u, S.ap, bounds, {
        marks: S.marks, scores: S.scores, goal: S.goal, spite: PERSONA[S.cur].spite,
        owner: S.cur, isWild: isWild, fr: fr(), block: S.block
      });
      if (plan.seq.length && (!best || plan.score > best.score)) best = Object.assign({ u: u }, plan);
    });
    if (best) {
      S.active = best.u;
      if (best.seq[0] === "F") forward(best.u);
      else if (best.seq[0] === "L") rotate(best.u, -1);
      else rotate(best.u, 1);
      return;
    }
    var own = myUnits.filter(function (u) { return S.squirrels[u].player === S.cur; })[0];
    var qq = own != null ? unitInfo(own, watchers) : null;
    if (qq && (!qq.digTarget || S.stall > 10)) {
      S.active = own;
      if (qq.canFwd) forward(own); else rotate(own, 1);
      return;
    }
    endTurn(true);
    render();
  }

  function humanEndTurn() {
    pushHist();
    endTurn(false);
    render();
  }

  function scheduleCpu() {
    if (S._cpuTimer) { clearTimeout(S._cpuTimer); S._cpuTimer = null; }
    if (!S.running || S.phase === "setup" || S.phase === "over") return;
    if (S.seats[S.cur] !== "cpu") return;
    if (S.phase === "deploy" && S.deployOrder[S.deployStep] !== S.cur) return;
    S._cpuTimer = setTimeout(function () {
      S._cpuTimer = null;
      if (S.phase === "place") cpuPlace();
      else if (S.phase === "deploy") cpuDeploy();
      else if (S.phase === "play") cpuStep();
    }, S.fast ? 90 : 460);
  }

  recomputeMisc();

  window.__DONGURI_STATE__ = {
    S: S, say: say, np: np, teams: teams, fr: fr, rayOpt: rayOpt, humanCount: humanCount, perHand: perHand,
    afterCurChange: afterCurChange, startGame: startGame, backToSetup: backToSetup,
    getSlots: getSlots, getBounds: getBounds, px: px, py: py, getRays: getRays, getWatchers: getWatchers,
    getMyUnits: getMyUnits, unitInfo: unitInfo, recomputeMisc: function () { recomputeMisc(); return { undug: undug, restLimit: restLimit }; },
    pushHist: pushHist, undo: undo, doPlace: doPlace, doDeploy: doDeploy, forward: forward, rotate: rotate,
    dig: dig, endTurn: endTurn, humanEndTurn: humanEndTurn, scheduleCpu: scheduleCpu
  };
})();

/* ============================================================
   盤面(SVG)レンダラー — リス・カードだけ持続ノードでアニメーションさせる
   ============================================================ */
(function () {
  "use strict";
  var E = window.__DONGURI__, ST = window.__DONGURI_STATE__;
  var S = ST.S;
  var DIRS = E.DIRS, PLAYERS = E.PLAYERS, WILD = E.WILD, unitOf = E.unitOf, NUT = E.NUT, nutSize = E.nutSize,
    QUADC = E.QUADC, DUGC = E.DUGC, SUBW = E.SUBW, SUBH = E.SUBH, CW = E.CW, CH = E.CH, K = E.K, cardOf = E.cardOf;

  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  function ownerMarkSVG(kind, color, x, y, r) {
    r = r || 5;
    if (kind === "circle") return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + color + '"/>';
    if (kind === "square") return '<rect x="' + (x - r) + '" y="' + (y - r) + '" width="' + (r * 2) + '" height="' + (r * 2) + '" rx="1" fill="' + color + '"/>';
    if (kind === "triangle") return '<polygon points="' + x + ',' + (y - r - 1) + ' ' + (x + r + 1) + ',' + (y + r) + ' ' + (x - r - 1) + ',' + (y + r) + '" fill="' + color + '"/>';
    return '<polygon points="' + x + ',' + (y - r - 1) + ' ' + (x + r + 1) + ',' + y + ' ' + x + ',' + (y + r + 1) + ' ' + (x - r - 1) + ',' + y + '" fill="' + color + '"/>';
  }

  function revealOwner(o) {
    return S.showAll || S.phase === "over" ||
      (o >= 0 && S.showMine && !S.handoff && S.seats[o] === "human" && (ST.humanCount() === 1 || o === S.cur));
  }

  function cardMarkupAt(c, bounds, animClass) {
    var x = ST.px(bounds, c.cx * 2), y = ST.py(bounds, c.cy * 2);
    if (c.owner === -1) {
      return '<g class="dg-cardgroup">' +
        '<rect x="' + x + '" y="' + y + '" width="' + CW + '" height="' + CH + '" rx="5" fill="#6E5638" stroke="#4A3A26" stroke-width="1.5"/>' +
        '<ellipse cx="' + (x + CW / 2) + '" cy="' + (y + CH / 2) + '" rx="23" ry="30" fill="#8A6C46"/>' +
        '<ellipse cx="' + (x + CW / 2) + '" cy="' + (y + CH / 2) + '" rx="15" ry="20" fill="none" stroke="#6E5638" stroke-width="1.5"/>' +
        '<ellipse cx="' + (x + CW / 2) + '" cy="' + (y + CH / 2) + '" rx="8" ry="11" fill="none" stroke="#6E5638" stroke-width="1.5"/>' +
        '<text x="' + (x + CW / 2) + '" y="' + (y + CH - 8) + '" text-anchor="middle" class="dg-lbl">きりかぶ</text></g>';
    }
    var reveal = c.dug || revealOwner(c.owner);
    var html = '<g class="dg-cardgroup' + (animClass ? " " + animClass : "") + '">';
    var q, cols;
    if (c.dug) {
      cols = DUGC;
      for (q = 0; q < 4; q++)
        html += '<rect x="' + (x + (q % 2) * SUBW) + '" y="' + (y + Math.floor(q / 2) * SUBH) + '" width="' + SUBW + '" height="' + SUBH + '" fill="' + cols[q] + '"/>';
      html += '<rect x="' + x + '" y="' + y + '" width="' + CW + '" height="' + CH + '" rx="5" fill="none" stroke="#382E24" stroke-width="1.5"/>';
      html += '<line x1="' + (x + SUBW) + '" y1="' + y + '" x2="' + (x + SUBW) + '" y2="' + (y + CH) + '" stroke="#0000002E" stroke-width="1"/>';
      html += '<line x1="' + x + '" y1="' + (y + SUBH) + '" x2="' + (x + CW) + '" y2="' + (y + SUBH) + '" stroke="#0000002E" stroke-width="1"/>';
    } else {
      cols = QUADC;
      for (q = 0; q < 4; q++)
        html += '<rect x="' + (x + (q % 2) * SUBW) + '" y="' + (y + Math.floor(q / 2) * SUBH) + '" width="' + SUBW + '" height="' + SUBH + '" fill="' + cols[q] + '"/>';
      html += '<rect x="' + x + '" y="' + y + '" width="' + CW + '" height="' + CH + '" rx="5" fill="none" stroke="#7A6647" stroke-width="1.5"/>';
      html += '<line x1="' + (x + SUBW) + '" y1="' + y + '" x2="' + (x + SUBW) + '" y2="' + (y + CH) + '" stroke="#00000018" stroke-width="1"/>';
      html += '<line x1="' + x + '" y1="' + (y + SUBH) + '" x2="' + (x + CW) + '" y2="' + (y + SUBH) + '" stroke="#00000018" stroke-width="1"/>';
      if (S.marks && c.owner >= 0) html += ownerMarkSVG(PLAYERS[c.owner].mark, PLAYERS[c.owner].color, x + CW - 10, y + 10);
    }
    if (reveal) {
      html += '<text x="' + (x + CW / 2) + '" y="' + (y + 13) + '" text-anchor="middle" dominant-baseline="hanging" font-size="' + nutSize(c.value) + '" opacity="' + (c.dug ? 0.8 : 1) + '">' + NUT[c.value] + '</text>';
      html += '<rect x="' + (x + CW / 2 - 17) + '" y="' + (y + CH - 26) + '" width="34" height="19" rx="9.5" fill="#241C15" opacity="' + (c.dug ? 0.55 : 0.8) + '"/>';
      html += '<text x="' + (x + CW / 2) + '" y="' + (y + CH - 12) + '" text-anchor="middle" class="dg-val">' + c.value + '</text>';
    }
    if (c.dug && S.marks && c.owner >= 0) html += ownerMarkSVG(PLAYERS[c.owner].mark, PLAYERS[c.owner].color + "80", x + CW - 10, y + 10, 4);
    html += '</g>';
    return html;
  }

  function renderCardsLayer(bounds) {
    var html = "";
    Object.keys(S.cards).forEach(function (k) {
      var c = S.cards[k];
      var anim = null;
      if (k === S.justDugKey) anim = "dug-anim";
      else if (k === S.justPlacedKey) anim = "spawn-anim";
      html += cardMarkupAt(c, bounds, anim);
    });
    S.justDugKey = null; S.justPlacedKey = null;
    return html;
  }

  function renderSlotsLayer(bounds, slots) {
    return slots.map(function (xy) {
      var x = xy[0], y = xy[1];
      var sel = S.pendingSlot && S.pendingSlot[0] === x && S.pendingSlot[1] === y;
      return '<rect class="dg-slot' + (sel ? " sel" : "") + '" data-action="board-slot" data-x="' + x + '" data-y="' + y + '" ' +
        'x="' + ST.px(bounds, x * 2) + '" y="' + ST.py(bounds, y * 2) + '" width="' + CW + '" height="' + CH + '" rx="5"/>';
    }).join("");
  }

  function renderRaysLayer(bounds, rays) {
    if (!S.showLos || S.phase === "place") return "";
    return rays.map(function (r, i) {
      var s = S.squirrels[i], p = unitOf(s);
      var x1 = ST.px(bounds, s.gx) + SUBW / 2, y1 = ST.py(bounds, s.gy) + SUBH / 2;
      var x2 = ST.px(bounds, r.x) + SUBW / 2, y2 = ST.py(bounds, r.y) + SUBH / 2;
      var html = '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + p.color + '" stroke-width="1.5" opacity="0.42" stroke-dasharray="3 4"/>';
      if (r.blocked) html += '<circle cx="' + x2 + '" cy="' + y2 + '" r="3" fill="' + p.color + '" opacity="0.5"/>';
      return html;
    }).join("");
  }

  function squirrelInnerSVG(s, i, isActive, mine, watched) {
    var p = unitOf(s);
    var html = "";
    if (mine && !isActive) html += '<circle r="16" fill="none" stroke="' + p.color + '" stroke-width="1" opacity="0.45" stroke-dasharray="2 3"/>';
    if (isActive) html += '<circle r="17" fill="none" stroke="' + p.color + '" stroke-width="2" opacity="0.95"/>';
    if (isActive && watched) html += '<circle r="20" fill="none" stroke="#E2664B" stroke-width="1.5" class="dg-pulse"/>';
    html += '<polygon points="0,-8.5 4.5,-2.5 -4.5,-2.5" fill="' + p.color + '" opacity="0.95"/>';
    html += '<rect x="-13" y="-4.5" width="26" height="9" rx="2.5" fill="' + p.color + '" stroke="' + (s.player < 0 ? "#5A4A38" : "#241C15") + '" stroke-width="1"' +
      (s.player < 0 ? ' stroke-dasharray="3 2"' : "") + '/>';
    return html;
  }

  var squirrelNodes = [];
  function updateSquirrelsLayer(bounds, watchers, myUnits) {
    var layer = window.__DONGURI_DOM__.layerSquirrels;
    if (S.squirrels.length === 0 && squirrelNodes.length) {
      layer.innerHTML = "";
      squirrelNodes = [];
    }
    S.squirrels.forEach(function (s, i) {
      var node = squirrelNodes[i];
      var isNew = false;
      if (!node) {
        node = document.createElementNS(E.SVGNS, "g");
        node.setAttribute("data-action", "select-unit");
        node.setAttribute("data-i", i);
        node.classList.add("dg-squirrel", "spawn");
        layer.appendChild(node);
        squirrelNodes[i] = node;
        isNew = true;
      }
      var cx = ST.px(bounds, s.gx) + SUBW / 2, cy = ST.py(bounds, s.gy) + SUBH / 2;
      var deg = s.facing * 90;
      node.setAttribute("transform", "translate(" + cx + "," + cy + ") rotate(" + deg + ")");
      var isActive = S.phase === "play" && i === S.active;
      var mine = S.phase === "play" && myUnits.indexOf(i) !== -1;
      var watched = watchers[i] && watchers[i].length > 0;
      node.classList.toggle("mine", !!mine);
      node.innerHTML = squirrelInnerSVG(s, i, isActive, mine, watched);
      if (isNew) { setTimeout(function () { node.classList.remove("spawn"); }, 450); }
    });
  }

  function renderBoard() {
    var bounds = ST.getBounds();
    var slots = ST.getSlots();
    var rays = ST.getRays(bounds);
    var watchers = ST.getWatchers(rays);
    var myUnits = ST.getMyUnits();
    var dom = window.__DONGURI_DOM__;
    dom.svg.setAttribute("viewBox", "0 0 " + bounds.w + " " + bounds.h);
    dom.layerSlots.innerHTML = renderSlotsLayer(bounds, slots);
    dom.layerCards.innerHTML = renderCardsLayer(bounds);
    dom.layerRays.innerHTML = renderRaysLayer(bounds, rays);
    updateSquirrelsLayer(bounds, watchers, myUnits);
    dom.boardWrap.classList.toggle("dg-tilt", S.tilt3d);
    return { bounds: bounds, slots: slots, rays: rays, watchers: watchers, myUnits: myUnits };
  }

  window.__DONGURI_BOARD__ = { renderBoard: renderBoard, revealOwner: revealOwner };
})();

/* ============================================================
   サイドパネル・ヘッダー・ログのレンダラー
   ============================================================ */
(function () {
  "use strict";
  var E = window.__DONGURI__, ST = window.__DONGURI_STATE__, App = window.__DONGURI_APP__;
  var S = ST.S;
  var DIRLABEL = E.DIRLABEL, PLAYERS = E.PLAYERS, WILD = E.WILD, unitOf = E.unitOf, PERSONA = E.PERSONA, NUT = E.NUT;

  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function teamName(t) { return t === 0 ? "あか＆き" : "あお＆むらさき"; }

  function scoreListHTML(sc) {
    var t = ST.teams();
    var rows;
    if (t) {
      rows = [0, 1].map(function (team) {
        var now = S.phase === "play" && S.cur % 2 === team;
        return '<div class="dg-scrow' + (now ? " now" : "") + '">' +
          '<span class="dg-dot" style="background:' + PLAYERS[team].color + '"></span>' +
          '<span class="dg-dot" style="background:' + PLAYERS[team + 2].color + ';margin-left:-3px"></span>' +
          '<span class="dg-sn">' + teamName(team) + '</span>' +
          '<span class="dg-sv">' + (sc[team] + sc[team + 2]) + '</span></div>';
      });
    } else {
      rows = PLAYERS.slice(0, ST.np()).map(function (p, i) {
        var now = i === S.cur && S.phase === "play";
        return '<div class="dg-scrow' + (now ? " now" : "") + '">' +
          '<span class="dg-dot" style="background:' + p.color + '"></span>' +
          '<span class="dg-sn">' + p.name + '</span>' +
          '<span class="dg-sv">' + sc[i] + '</span></div>';
      });
    }
    return '<div class="dg-sc">' + rows.join("") + '</div>';
  }

  /* ===== 設定画面 ===== */
  function panelSetup() {
    var np = ST.np();
    var modeBtns = [["2", "2人"], ["3", "3人"], ["4", "4人"], ["team", "2vs2"]].map(function (m) {
      return '<button class="dg-gbtn' + (S.mode === m[0] ? " on" : "") + '" data-action="set-mode" data-value="' + m[0] + '">' + m[1] + '</button>';
    }).join("");
    var hints = {
      "4": "1人1体のリスを動かします。カードは4枚ずつ。",
      "3": "1人1体＋だれの味方でもない「のらリス」が1体。カードは5枚ずつ配り、あまり1枚は野生の実として、だれも中身を知らないまま埋まります。",
      "2": "1人2体のリスを動かします。4APを2体に好きなだけ配分できます。カードは8枚ずつ。",
      "team": "あか＆き / あお＆むらさき の2チーム戦。カードは4枚ずつで、中身は埋めた本人だけが知っています（会話で伝えてください）。味方のリスは視線を切らず、同じ札に乗っていても邪魔になりません。得点はチーム合計。総40点なので16〜20点あたりが目安です。"
    };
    var seatBtns = PLAYERS.slice(0, np).map(function (p, i) {
      var isHuman = S.seats[i] === "human";
      return '<button class="dg-seat' + (isHuman ? " on" : "") + '" data-action="toggle-seat" data-i="' + i + '">' +
        '<span class="dg-dot" style="background:' + p.color + '"></span><b>' + p.name + '</b>' +
        '<i>' + (isHuman ? "👤" : "🤖 " + PERSONA[i].name) + '</i></button>';
    }).join("");
    var dealBtns = [["random", "ランダム"], ["draw", "ドロー"], ["even", "均等"]].map(function (d) {
      var disabled = d[0] === "even" && np !== 4;
      return '<button class="dg-gbtn' + (S.deal === d[0] ? " on" : "") + '" data-action="set-deal" data-value="' + d[0] + '"' + (disabled ? " disabled" : "") + '>' + d[1] + '</button>';
    }).join("");
    var blockBtns = [["on", "あり"], ["off", "なし"]].map(function (b) {
      return '<button class="dg-gbtn' + ((S.block === (b[0] === "on")) ? " on" : "") + '" data-action="set-block" data-value="' + b[0] + '">' + b[1] + '</button>';
    }).join("");
    var marksBtns = [["on", "あり"], ["off", "なし"]].map(function (b) {
      return '<button class="dg-gbtn' + ((S.marks === (b[0] === "on")) ? " on" : "") + '" data-action="set-marks" data-value="' + b[0] + '">' + b[1] + '</button>';
    }).join("");
    var endBtns = [["rest4", "4枚残し"], ["all", "全掘り"]].map(function (b) {
      return '<button class="dg-gbtn' + (S.endMode === b[0] ? " on" : "") + '" data-action="set-endmode" data-value="' + b[0] + '">' + b[1] + '</button>';
    }).join("");
    return '<div class="dg-pane">' +
      '<div class="dg-turnbar" style="border-color:#DFAF3C"><b>ゲームの設定</b></div>' +
      '<div class="dg-og"><span class="dg-glabel">人数</span>' + modeBtns + '</div>' +
      '<p class="dg-hint">' + hints[S.mode] + '</p>' +
      '<div class="dg-og"><span class="dg-glabel">席</span></div>' +
      '<div class="dg-seats">' + seatBtns + '</div>' +
      '<div class="dg-og"><span class="dg-glabel">配り方</span>' + dealBtns + '</div>' +
      '<div class="dg-og"><span class="dg-glabel">遮蔽</span>' + blockBtns + '</div>' +
      '<p class="dg-hint">' + (S.block ? "リスの正面（背中）が視線をさえぎります。よこ向きのリスはすりぬけます。" : "リスは視線をさえぎりません。まっすぐ先まで、ずっと見えます。") + '</p>' +
      '<div class="dg-og"><span class="dg-glabel">マーク</span>' + marksBtns + '</div>' +
      '<div class="dg-og"><span class="dg-glabel">終了</span>' + endBtns + '</div>' +
      '<div class="dg-og"><span class="dg-glabel">ゴール</span>' +
      '<button class="dg-gbtn step" data-action="goal-step" data-delta="-1">−</button>' +
      '<span class="dg-gval">' + (S.goal === 0 ? "なし" : S.goal + "点") + '</span>' +
      '<button class="dg-gbtn step" data-action="goal-step" data-delta="1">＋</button></div>' +
      '</div>';
  }

  function panelHandoff() {
    var p = PLAYERS[S.cur];
    return '<div class="dg-pane"><div class="dg-cover">' +
      '<div class="dg-ckicker">つぎの人にわたしてください</div>' +
      '<div class="dg-cname" style="color:' + p.color + '">' + p.name + 'リス</div>' +
      '<button class="dg-btn go" data-action="handoff-ready">じゅんびOK</button>' +
      '</div></div>';
  }

  function panelOver() {
    var r = S.result;
    var teamRows = "";
    if (r.teams) {
      teamRows = '<div class="dg-sc">' + [0, 1].map(function (t) {
        return '<div class="dg-scrow"><span class="dg-dot" style="background:' + PLAYERS[t].color + '"></span>' +
          '<span class="dg-sn">' + teamName(t) + '</span><span class="dg-sv">' + r.tScore[t] + '</span></div>';
      }).join("") + '</div>';
    }
    var indivRows = '<div class="dg-sc">' + PLAYERS.slice(0, ST.np()).map(function (p, i) {
      return '<div class="dg-scrow"><span class="dg-dot" style="background:' + p.color + '"></span>' +
        '<span class="dg-sn">' + p.name + '</span><span class="dg-sv">' + r.scores[i] + '</span>' +
        '<span class="dg-sd">' + r.digs[i] + '枚</span></div>';
    }).join("") + '</div>';
    var winLabel = r.tie ? "ひきわけ" : r.teams ? teamName(r.best) + "の勝ち" : PLAYERS[r.best].name + "リスの勝ち";
    return '<div class="dg-pane"><div class="dg-over">' +
      '<div class="dg-okicker">' + r.why + '</div>' +
      '<div class="dg-owin" style="color:' + PLAYERS[r.best].color + '">' + winLabel + '</div>' +
      '</div>' + teamRows + indivRows +
      '<button class="dg-btn go" data-action="play-again">もういちど</button></div>';
  }

  function headHTML(info) {
    var cpu = S.seats[S.cur] === "cpu";
    return '<div class="dg-turnbar" style="border-color:' + PLAYERS[S.cur].color + '">' +
      '<span class="dg-dot" style="background:' + PLAYERS[S.cur].color + '"></span><b>' + PLAYERS[S.cur].name + 'リス</b>' +
      (cpu ? '<span class="dg-cpubadge">🤖 ' + PERSONA[S.cur].name + '</span>' : "") +
      (S.phase === "play" && info ? '<span class="dg-face">' + DIRLABEL[info.s.facing] + 'むき</span>' : "") +
      '</div>';
  }

  function panelCpuTurn(ctx) {
    var undugInfo = ST.recomputeMisc();
    return '<div class="dg-pane">' + headHTML(null) +
      '<p class="dg-hint">' + PERSONA[S.cur].tip + '。' + (S.running ? "考えています…" : "（CPU停止中）") + '</p>' +
      (S.phase === "play" ? scoreListHTML(S.scores) : "") +
      (S.phase === "play" ? '<div class="dg-mini">未発掘 ' + undugInfo.undug + ' 枚</div>' : "") +
      '</div>';
  }

  function panelPlace() {
    var myHand = S.hands[S.cur] || [];
    var list = S.deal === "draw" ? myHand.slice(0, 1) : myHand;
    var nuts = list.map(function (v, i) {
      var on = S.deal === "draw" || S.selIdx === i;
      return '<button class="dg-nut' + (on ? " on" : "") + '" data-action="place-hand" data-i="' + i + '" data-v="' + v + '"' + (S.deal === "draw" ? " disabled" : "") + '>' +
        '<span class="dg-nv" style="font-size:' + (13 + v * 4) + 'px">' + NUT[v] + '</span>' +
        '<span class="dg-nl">' + v + '点</span></button>';
    }).join("");
    return '<div class="dg-pane">' + headHTML(null) +
      '<p class="dg-hint">' + (S.deal === "draw" ? "山から引いた実を、そのまま点線の場所に埋めます。" : "木の実と場所を、どちらの順にえらんでもかまいません。") + '中身はあなただけが知っている。</p>' +
      '<div class="dg-hand">' + nuts + '</div>' +
      '<div class="dg-mini">のこり ' + (17 - Object.keys(S.cards).length) + ' 枚</div>' +
      '<button class="dg-btn ghost" data-action="undo"' + (S.history.length ? "" : " disabled") + '>1手もどす</button>' +
      '</div>';
  }

  function panelDeploy() {
    var who = S.deployOrder[S.deployStep];
    var QW = 46, QH = 64, G = 4, MG = 32;
    function qpos(q) { return { L: MG + (q % 2) * (QW + G), T: MG + Math.floor(q / 2) * (QH + G) }; }
    var squares = [0, 1, 2, 3].map(function (q) {
      var pos = qpos(q);
      var occ = S.squirrels.filter(function (s) { return s.gx === q % 2 && s.gy === Math.floor(q / 2); })[0];
      var bg = occ ? unitOf(occ).color : E.QUADC[q];
      return '<button class="dg-sq' + (S.deployQ === q ? " on" : "") + '" ' + (occ ? "disabled" : "") +
        ' style="left:' + pos.L + 'px;top:' + pos.T + 'px;width:' + QW + 'px;height:' + QH + 'px;background:' + bg + '" ' +
        'data-action="deploy-pick-q" data-q="' + q + '"></button>';
    }).join("");
    var arrows = "";
    if (S.deployQ !== null) {
      var basePos = qpos(S.deployQ);
      var arrowPos = [
        { left: basePos.L + QW / 2 - 14, top: basePos.T - 30 },
        { left: basePos.L + QW + 6, top: basePos.T + QH / 2 - 14 },
        { left: basePos.L + QW / 2 - 14, top: basePos.T + QH + 6 },
        { left: basePos.L - 34, top: basePos.T + QH / 2 - 14 }
      ];
      var glyphs = ["▲", "▶", "▼", "◀"];
      arrows = [0, 1, 2, 3].map(function (f) {
        return '<button class="dg-arrow" style="left:' + arrowPos[f].left + 'px;top:' + arrowPos[f].top + 'px" title="' + DIRLABEL[f] + 'をむく" ' +
          'data-action="deploy-confirm" data-q="' + S.deployQ + '" data-f="' + f + '">' + glyphs[f] + '</button>';
      }).join("");
    }
    return '<div class="dg-pane">' + headHTML(null) +
      '<p class="dg-hint">' + (S.deployQ === null ? "きりかぶのどこに立つか選んでください。" : "出てきた矢印で、見る方向を決めます。") +
      (ST.np() === 2 ? " （2体ぶん、順番に置きます）" : "") + '</p>' +
      '<div class="dg-stump" style="width:' + (QW * 2 + G + MG * 2) + 'px;height:' + (QH * 2 + G + MG * 2) + 'px">' + squares + arrows + '</div>' +
      '<button class="dg-btn ghost" data-action="undo"' + (S.history.length ? "" : " disabled") + '>1手もどす</button>' +
      '</div>';
  }

  function panelPlay(ctx) {
    var info = S.squirrels[S.active] ? ST.unitInfo(S.active, ctx.watchers) : null;
    var myUnits = ctx.myUnits;
    var undugInfo = ST.recomputeMisc();
    var unitsBar = "";
    if (myUnits.length > 1) {
      var mineOnlyIdx = 0;
      unitsBar = '<div class="dg-units">' + myUnits.map(function (u) {
        var s = S.squirrels[u];
        var p = unitOf(s);
        var label = s.player < 0 ? "のら" : "リス" + (myUnits.filter(function (x) { return S.squirrels[x].player === S.cur; }).indexOf(u) + 1);
        return '<button class="dg-unit' + (S.active === u ? " on" : "") + '" data-action="select-unit" data-i="' + u + '">' +
          '<span class="dg-dot" style="background:' + p.color + '"></span>' + label + '<i>' + DIRLABEL[s.facing] + '</i></button>';
      }).join("") + '</div>';
    }
    var apDots = "";
    for (var i = 0; i < 4; i++) apDots += '<span class="dg-ap' + (i < S.ap ? " on" : "") + '"></span>';
    var reasons = [];
    if (info) {
      if (!info.isMine) reasons.push("のらリスは掘れません");
      else {
        if (S.ap !== 4) reasons.push("発掘は手番のはじめだけ");
        if (!info.digTarget) reasons.push(info.card && info.card.dug ? "掘りおわった札" : "きりかぶは掘れない");
        if (info.foes > 0) reasons.push("同じ札に敵リスがいる");
        if (info.seen.length) reasons.push(info.seen.map(function (idx) { return unitOf(S.squirrels[idx]).name; }).join("・") + "リスに見られている");
      }
    }
    return '<div class="dg-pane">' + headHTML(info) + unitsBar +
      '<div class="dg-apbar"><span class="dg-aplabel">AP</span>' + apDots + '</div>' +
      '<div class="dg-row">' +
      '<button class="dg-btn" data-action="forward"' + (!info || !info.canFwd || S.ap < 1 ? " disabled" : "") + '>まえへ<em>1</em></button>' +
      '<button class="dg-btn" data-action="rotate" data-d="-1"' + (S.ap < 1 ? " disabled" : "") + '>ひだり<em>1</em></button>' +
      '<button class="dg-btn" data-action="rotate" data-d="1"' + (S.ap < 1 ? " disabled" : "") + '>みぎ<em>1</em></button>' +
      '</div>' +
      '<button class="dg-btn dig' + (info && info.canDig ? " ok" : "") + '" data-action="dig"' + (!info || !info.canDig ? " disabled" : "") + '>ほりだす<em>4</em></button>' +
      (info && !info.canDig && reasons.length ? '<ul class="dg-why">' + reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + '</ul>' : "") +
      '<div class="dg-row">' +
      '<button class="dg-btn ghost" data-action="undo"' + (S.history.length ? "" : " disabled") + '>1手もどす</button>' +
      '<button class="dg-btn ghost" data-action="end-turn">手番をおえる</button>' +
      '</div>' +
      scoreListHTML(S.scores) +
      '<div class="dg-mini">未発掘 ' + undugInfo.undug + ' 枚 ／ ' + (S.goal > 0 ? S.goal + "点先取 or " : "") + (S.endMode === "rest4" ? "のこり4枚" : "ぜんぶ掘る") + 'で終了</div>' +
      (S.stall > 8 ? '<div class="dg-mini" style="color:#C08A6E">だれも掘れないまま ' + S.stall + ' 手番</div>' : "") +
      '</div>';
  }

  function renderPanel(ctx) {
    var dom = window.__DONGURI_DOM__;
    var html;
    if (S.phase === "setup") html = panelSetup();
    else if (S.handoff && S.phase !== "over") html = panelHandoff();
    else if (S.phase === "over") html = panelOver();
    else if (S.seats[S.cur] === "cpu") html = panelCpuTurn(ctx);
    else if (S.phase === "place") html = panelPlace();
    else if (S.phase === "deploy") html = panelDeploy();
    else html = panelPlay(ctx);
    dom.panel.innerHTML = html;
  }

  function renderTop() {
    var dom = window.__DONGURI_DOM__;
    if (S.phase === "setup") {
      dom.restartBtn.textContent = "ゲームスタート";
      dom.restartBtn.className = "dg-restart go";
      dom.restartBtn.dataset.action = "start-game";
      dom.tog.style.display = "none";
      dom.summary.style.display = "none";
      return;
    }
    dom.restartBtn.textContent = "↺ リセット";
    dom.restartBtn.className = "dg-restart";
    dom.restartBtn.dataset.action = "reset";
    dom.tog.style.display = "";
    dom.summary.style.display = "";
    var toggles = [
      ["showLos", "視線"], ["showMine", "自分の札"], ["showAll", "全公開"],
      ["fast", "早送り"], ["tilt3d", "3D表示"]
    ];
    var html = toggles.map(function (t) {
      return '<button class="dg-tg' + (S[t[0]] ? " on" : "") + '" data-action="toggle-flag" data-flag="' + t[0] + '">' + t[1] + '</button>';
    }).join("") +
      '<button class="dg-tg' + (S.running ? " on" : "") + '" data-action="toggle-flag" data-flag="running">' + (S.running ? "CPU動作中" : "CPU停止") + '</button>';
    dom.tog.innerHTML = html;
    dom.summary.textContent =
      (ST.teams() ? "2vs2" : ST.np() + "人") + " ／ " +
      (S.deal === "random" ? "ランダム" : S.deal === "draw" ? "ドロー" : "均等") + " ／ 遮蔽" + (S.block ? "あり" : "なし") +
      " ／ マーク" + (S.marks ? "あり" : "なし") + " ／ " + (S.goal > 0 ? S.goal + "点先取・" : "") +
      (S.endMode === "rest4" ? "のこり4枚で終了" : "全掘りで終了");
  }

  function renderLog() {
    var dom = window.__DONGURI_DOM__;
    dom.logpane.innerHTML = S.log.map(function (l) {
      return '<div class="dg-logline"' + (l.c ? ' style="color:' + l.c + '"' : "") + '>' + esc(l.t) + '</div>';
    }).join("");
  }

  window.__DONGURI_PANEL__ = { renderPanel: renderPanel, renderTop: renderTop, renderLog: renderLog, scoreListHTML: scoreListHTML, teamName: teamName };
})();

/* ============================================================
   あそびかたページ (静止SVG図解)
   ============================================================ */
(function () {
  "use strict";
  var E = window.__DONGURI__;
  var DIRS = E.DIRS;
  var QUADC = E.QUADC, DUGC = E.DUGC;

  function tCard(x, y, w, h, dug, val) {
    w = w || 44; h = h || 62;
    var sw = w / 2, sh = h / 2;
    var cols = dug ? DUGC : QUADC;
    var html = "";
    for (var q = 0; q < 4; q++)
      html += '<rect x="' + (x + (q % 2) * sw) + '" y="' + (y + Math.floor(q / 2) * sh) + '" width="' + sw + '" height="' + sh + '" fill="' + cols[q] + '"/>';
    html += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="none" stroke="' + (dug ? "#382E24" : "#7A6647") + '" stroke-width="1.2"/>';
    html += '<line x1="' + (x + sw) + '" y1="' + y + '" x2="' + (x + sw) + '" y2="' + (y + h) + '" stroke="#00000022" stroke-width="1"/>';
    html += '<line x1="' + x + '" y1="' + (y + sh) + '" x2="' + (x + w) + '" y2="' + (y + sh) + '" stroke="#00000022" stroke-width="1"/>';
    if (val) html += '<text x="' + (x + w / 2) + '" y="' + (y + h * 0.14) + '" text-anchor="middle" dominant-baseline="hanging" font-size="' + (w * 0.34) + '">' + E.NUT[val] + '</text>';
    return html;
  }

  function tStump(x, y, w, h) {
    w = w || 44; h = h || 62;
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="#6E5638" stroke="#4A3A26" stroke-width="1.2"/>' +
      '<ellipse cx="' + (x + w / 2) + '" cy="' + (y + h / 2) + '" rx="' + (w * 0.34) + '" ry="' + (h * 0.32) + '" fill="#8A6C46"/>' +
      '<ellipse cx="' + (x + w / 2) + '" cy="' + (y + h / 2) + '" rx="' + (w * 0.21) + '" ry="' + (h * 0.2) + '" fill="none" stroke="#6E5638" stroke-width="1.2"/>';
  }

  function tSq(x, y, f, color, s) {
    color = color || "#E2664B"; s = s || 1;
    var horiz = f % 2 === 0;
    var hw = (horiz ? 10 : 3.5) * s, hh = (horiz ? 3.5 : 10) * s;
    var dx = DIRS[f][0], dy = DIRS[f][1];
    var nx = -dy, ny = dx;
    var t = 8.5 * s, b = 2.5 * s, wd = 4.5 * s;
    var nose = (x + dx * t) + "," + (y + dy * t) + " " + (x + dx * b + nx * wd) + "," + (y + dy * b + ny * wd) + " " + (x + dx * b - nx * wd) + "," + (y + dy * b - ny * wd);
    return '<polygon points="' + nose + '" fill="' + color + '"/>' +
      '<rect x="' + (x - hw) + '" y="' + (y - hh) + '" width="' + (hw * 2) + '" height="' + (hh * 2) + '" rx="2" fill="' + color + '" stroke="#241C15" stroke-width="0.8"/>';
  }

  function gaze(x1, y1, x2, y2, blocked) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#E2664B" stroke-width="1.6" stroke-dasharray="4 4" opacity="0.9"/>' +
      (blocked ? '<circle cx="' + x2 + '" cy="' + y2 + '" r="3" fill="#E2664B" opacity="0.8"/>' : "");
  }

  function svgWrap(inner) { return '<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet">' + inner + '</svg>'; }

  var HELP = [
    {
      t: "このゲームは",
      fig: svgWrap(tCard(84, 40) + tCard(128, 40, null, null, false, 4) + tCard(172, 40) +
        gaze(104, 55.5, 175, 55.5) + tSq(95, 55.5, 1, "#57A6C9") + tSq(183, 55.5, 0, "#E2664B") +
        '<text x="95" y="130" text-anchor="middle" font-size="10" fill="#8A7A66">見張っている</text>' +
        '<text x="195" y="130" text-anchor="middle" font-size="10" fill="#C08A6E">見られていて掘れない</text>'),
      b: "森に木の実を埋め、掘り返して集めます。中身を知っているのは埋めた本人だけ。そして、ほかのリスに正面から見られていると掘り返せません。"
    },
    {
      t: "じゅんび",
      fig: svgWrap(tCard(130, 6, 40, 56) + tCard(50, 62, 40, 56) + tCard(90, 62, 40, 56) + tCard(170, 62, 40, 56) + tCard(210, 62, 40, 56) + tCard(130, 118, 40, 56) +
        tStump(130, 62, 40, 56) + tSq(140, 76, 0, "#E2664B", 0.85) + tSq(160, 76, 1, "#57A6C9", 0.85) + tSq(140, 104, 3, "#DFAF3C", 0.85) + tSq(160, 104, 2, "#A87CC8", 0.85) +
        '<text x="150" y="192" text-anchor="middle" font-size="10" fill="#8A7A66">まん中がきりかぶ。リスはここから出発</text>'),
      b: "カードを配ったら中身を自分だけ見て、順番に1枚ずつ裏向きで置きます。タテヨコでつながっていれば、森の形は自由です。全部置いたら、きりかぶに好きな向きで立ちます。"
    },
    {
      t: "カードは4マス",
      fig: svgWrap(tCard(30, 37, 90, 126) + tSq(52.5, 68.5, 1, "#E2664B", 1.6) +
        '<text x="145" y="72" font-size="11" fill="#EDE2CE">1枚＝2×2の4マス</text>' +
        '<text x="145" y="98" font-size="11" fill="#EDE2CE">リスはマスに立つ</text>' +
        '<text x="145" y="128" font-size="10.5" fill="#C08A6E">同じマスには入れない</text>' +
        '<text x="145" y="148" font-size="10.5" fill="#C08A6E">通りぬけもできない</text>'),
      b: "カードは4つのマスに分かれていて、リスはマスの上に立ちます。ほかのリスがいるマスには入れず、通りぬけもできません。だから体で通せんぼができます。"
    },
    {
      t: "てばん＝4AP",
      fig: svgWrap(tCard(106, 40) + tCard(150, 40) + tSq(117, 55.5, 1, "#E2664B") +
        [139, 161, 183].map(function (cx, i) {
          return '<circle cx="' + cx + '" cy="55.5" r="7.5" fill="none" stroke="#DFAF3C" stroke-width="1" stroke-dasharray="2 2"/>' +
            '<text x="' + cx + '" y="59" text-anchor="middle" font-size="8.5" fill="#DFAF3C">' + (i + 2) + '</text>';
        }).join("") +
        '<text x="150" y="135" text-anchor="middle" font-size="10.5" fill="#8A7A66">まっすぐなら4マス＝カード2枚ぶん</text>' +
        '<text x="150" y="162" text-anchor="middle" font-size="10.5" fill="#DFAF3C">ほりだす＝4APぜんぶ（その手番は動けない）</text>'),
      b: "毎てばん4APです。まえへ1AP／むきをかえる1AP／ほりだす4AP。カードは4マスあるので、掘り返すのに4マス分＝4APかかる、と覚えてください。"
    },
    {
      t: "掘れないとき ①",
      fig: svgWrap(tCard(62, 40) + tCard(106, 40) + tCard(150, 40) + tCard(194, 40) +
        gaze(82, 55.5, 197, 55.5) + tSq(73, 55.5, 1, "#57A6C9") + tSq(205, 55.5, 0, "#E2664B") +
        '<text x="150" y="140" text-anchor="middle" font-size="11" fill="#C08A6E">正面の一直線上にいると掘れない</text>'),
      b: "ほかのリスの正面から一直線（タテかヨコ）の先にいると掘れません。空いているところ・裏向きの札・掘りおわった札・きりかぶは、視線を通します。"
    },
    {
      t: "掘れないとき ②",
      fig: svgWrap(tCard(128, 38, 44, 62) + tSq(139, 53.5, 0, "#E2664B") + tSq(161, 84.5, 2, "#DFAF3C") +
        '<text x="150" y="140" text-anchor="middle" font-size="11" fill="#C08A6E">同じカードに2匹以上いると</text>' +
        '<text x="150" y="160" text-anchor="middle" font-size="11" fill="#C08A6E">どちらも掘れない</text>'),
      b: "足元のカードに自分をふくめて2匹以上乗っていると掘れません。マスが別でもカードが同じならロックされます。おいしそうな札ほど、みんなで固まって掘れなくなります。"
    },
    {
      t: "さえぎるもの",
      fig: svgWrap(tCard(30, 14, 40, 56) + tCard(110, 14, 40, 56) + tCard(190, 14, 40, 56) +
        gaze(48, 28, 113, 28, true) + tSq(40, 28, 1, "#57A6C9", 0.85) + tSq(120, 28, 3, "#DFAF3C", 0.85) + tSq(200, 28, 0, "#E2664B", 0.85) +
        '<text x="120" y="88" text-anchor="middle" font-size="9.5" fill="#8A7A66">正面＝かべ</text>' +
        '<text x="238" y="88" text-anchor="middle" font-size="10" fill="#8FBF7A">とどかない → 掘れる</text>' +
        tCard(30, 112, 40, 56) + tCard(110, 112, 40, 56) + tCard(190, 112, 40, 56) +
        gaze(48, 126, 193, 126) + tSq(40, 126, 1, "#57A6C9", 0.85) + tSq(120, 126, 0, "#DFAF3C", 0.85) + tSq(200, 126, 0, "#E2664B", 0.85) +
        '<text x="120" y="186" text-anchor="middle" font-size="9.5" fill="#8A7A66">よこ＝すりぬける</text>' +
        '<text x="238" y="186" text-anchor="middle" font-size="10" fill="#C08A6E">とどく → 掘れない</text>'),
      b: "視線をさえぎるのは、その線に正面（または背中）を向けているリスだけです。紙のリスは薄いので、よこ向きだと向こうが見えてしまいます。設定で「遮蔽なし」にすると、リスは一切さえぎらず、まっすぐ先までずっと見えるようになります。"
    },
    {
      t: "おわりかた",
      fig: svgWrap(tCard(50, 52, 40, 56, true, 2) + tCard(90, 52, 40, 56, true, 4) + tCard(130, 52, 40, 56) + tCard(170, 52, 40, 56) + tCard(210, 52, 40, 56) +
        '<text x="150" y="140" text-anchor="middle" font-size="10.5" fill="#8A7A66">掘った札は裏返して、その場に残ります</text>' +
        '<text x="150" y="160" text-anchor="middle" font-size="10.5" fill="#8A7A66">（森に穴はあかない）</text>'),
      b: "だれかが決められた点数に達すると、その人の勝ちです。または掘っていない札がのこり4枚になったら終了し、点数がいちばん多い人が勝ちます。パスはありません。"
    },
    {
      t: "人数によるちがい",
      fig: svgWrap('<text x="16" y="44" font-size="11.5" fill="#EDE2CE">4人</text>' +
        ["#E2664B", "#57A6C9", "#DFAF3C", "#A87CC8"].map(function (c, i) { return tSq(70 + i * 30, 40, 0, c); }).join("") +
        '<text x="200" y="44" font-size="9.5" fill="#9C8B75">1人1体</text>' +
        '<text x="16" y="104" font-size="11.5" fill="#EDE2CE">3人</text>' +
        ["#E2664B", "#57A6C9", "#DFAF3C"].map(function (c, i) { return tSq(70 + i * 30, 100, 0, c); }).join("") +
        tSq(160, 100, 0, "#9C8B75") +
        '<text x="182" y="97" font-size="9.5" fill="#9C8B75">のらリス</text>' +
        '<text x="182" y="110" font-size="9.5" fill="#9C8B75">（掘れない）</text>' +
        '<text x="16" y="164" font-size="11.5" fill="#EDE2CE">2人</text>' +
        tSq(70, 160, 0, "#E2664B") + tSq(100, 160, 0, "#E2664B") + tSq(140, 160, 0, "#57A6C9") + tSq(170, 160, 0, "#57A6C9") +
        '<text x="196" y="164" font-size="9.5" fill="#9C8B75">1人2体で4APを配分</text>'),
      b: "リスはいつも4体です。3人のときは、だれの味方でもない「のらリス」が加わります。だれの手番でもAPを使って動かせますが、掘れません。2vs2のチーム戦もあり、味方のリスは視線をさえぎらず、同じ札に乗っても邪魔になりません。敵にだけ気をつけてください。"
    },
    {
      t: "がめんの見かた",
      fig: svgWrap(tCard(44, 50, 44, 62) +
        '<circle cx="55" cy="65.5" r="13" fill="none" stroke="#E2664B" stroke-width="2"/>' + tSq(55, 65.5, 0, "#E2664B") +
        '<circle cx="77" cy="96.5" r="12" fill="none" stroke="#E2664B" stroke-width="1" opacity="0.5" stroke-dasharray="2 3"/>' + tSq(77, 96.5, 1, "#E2664B") +
        '<text x="110" y="69" font-size="10.5" fill="#EDE2CE">実線＝いま動かすリス</text>' +
        '<text x="110" y="100" font-size="10.5" fill="#9C8B75">点線＝ひかえのリス</text>'),
      b: "動かすリスは、盤の上のリスか操作パネルのボタンで切り替えます。上のトグルで視線の表示、自分が埋めた札の中身、全公開を切り替えられます。まちがえたら「1手もどす」で戻せます。「3D表示」トグルで盤を斜めから見た表示にも切り替えられます。"
    }
  ];

  window.__DONGURI_HELP__ = HELP;
})();

/* ============================================================
   マウント・イベント委譲・メインループ
   ============================================================ */
(function () {
  "use strict";
  var E = window.__DONGURI__, ST = window.__DONGURI_STATE__, App = window.__DONGURI_APP__,
    Board = window.__DONGURI_BOARD__, Panel = window.__DONGURI_PANEL__, HELP = window.__DONGURI_HELP__;
  var S = ST.S;

  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  function renderHelp() {
    var dom = window.__DONGURI_DOM__;
    dom.helpBtn.textContent = S.help ? "▲ とじる" : "▼ あそびかたをみる";
    dom.helpBtn.classList.toggle("on", S.help);
    dom.helpBox.hidden = !S.help;
    if (!S.help) return;
    var page = HELP[S.pg];
    var dots = HELP.map(function (_, i) {
      return '<button class="dg-hdot' + (i === S.pg ? " on" : "") + '" data-action="help-goto" data-i="' + i + '"></button>';
    }).join("");
    dom.helpBox.innerHTML =
      '<div class="dg-htitle">' + esc(page.t) + '</div>' +
      '<div class="dg-hfig">' + page.fig + '</div>' +
      '<p class="dg-hbody">' + esc(page.b) + '</p>' +
      '<div class="dg-hnav">' +
      '<button class="dg-hbtn" data-action="help-prev"' + (S.pg === 0 ? " disabled" : "") + '>‹</button>' +
      '<div class="dg-hdots">' + dots + '</div>' +
      '<button class="dg-hbtn" data-action="help-next"' + (S.pg === HELP.length - 1 ? " disabled" : "") + '>›</button>' +
      '</div>';
  }

  function handleAction(action, ds) {
    var i, v, x, y;
    switch (action) {
      case "start-game": ST.startGame(); break;
      case "reset": ST.backToSetup(); break;
      case "set-mode": S.mode = ds.value; render(); break;
      case "toggle-seat":
        i = Number(ds.i);
        S.seats = S.seats.map(function (s, j) { return j === i ? (s === "cpu" ? "human" : "cpu") : s; });
        render();
        break;
      case "set-deal": S.deal = ds.value; render(); break;
      case "set-block": S.block = ds.value === "on"; render(); break;
      case "set-marks": S.marks = ds.value === "on"; render(); break;
      case "set-endmode": S.endMode = ds.value; render(); break;
      case "goal-step":
        S.goal = Math.max(0, Math.min(40, S.goal + Number(ds.delta)));
        render();
        break;
      case "handoff-ready": S.handoff = false; render(); break;
      case "play-again": ST.startGame(); break;
      case "undo": ST.undo(); break;
      case "place-hand":
        if (S.deal === "draw") break;
        v = Number(ds.v);
        if (S.pendingSlot) ST.doPlace(S.pendingSlot[0], S.pendingSlot[1], v, S.cur);
        else { S.selIdx = Number(ds.i); render(); }
        break;
      case "board-slot":
        if (S.handoff || S.seats[S.cur] !== "human") break;
        x = Number(ds.x); y = Number(ds.y);
        var myHand = S.hands[S.cur] || [];
        var placingValue = S.deal === "draw" ? myHand[0] : (S.selIdx != null ? myHand[S.selIdx] : undefined);
        if (placingValue != null) ST.doPlace(x, y, placingValue, S.cur);
        else if (S.pendingSlot && S.pendingSlot[0] === x && S.pendingSlot[1] === y) { S.pendingSlot = null; render(); }
        else { S.pendingSlot = [x, y]; render(); }
        break;
      case "deploy-pick-q": S.deployQ = Number(ds.q); render(); break;
      case "deploy-confirm": ST.doDeploy(Number(ds.q), Number(ds.f), S.deployOrder[S.deployStep]); break;
      case "select-unit":
        if (S.phase !== "play" || S.handoff || S.seats[S.cur] !== "human") break;
        i = Number(ds.i);
        if (ST.getMyUnits().indexOf(i) === -1) break;
        S.active = i; render();
        break;
      case "forward": ST.forward(S.active); break;
      case "rotate": ST.rotate(S.active, Number(ds.d)); break;
      case "dig": ST.dig(S.active); break;
      case "end-turn": ST.humanEndTurn(); break;
      case "toggle-flag": S[ds.flag] = !S[ds.flag]; render(); break;
      case "toggle-help": S.help = !S.help; render(); break;
      case "help-prev": if (S.pg > 0) { S.pg--; render(); } break;
      case "help-next": if (S.pg < HELP.length - 1) { S.pg++; render(); } break;
      case "help-goto": S.pg = Number(ds.i); render(); break;
    }
  }

  function render() {
    Panel.renderTop();
    var ctx = Board.renderBoard();
    Panel.renderPanel(ctx);
    Panel.renderLog();
    renderHelp();
    ST.scheduleCpu();
  }
  App.render = render;

  function mount() {
    var root = document.getElementById("dg-root");
    if (!root) return;
    root.innerHTML =
      '<div class="dg-hdr">' +
      '<div class="dg-ttl">ドングリ<em>どこだ？</em></div>' +
      '<div class="dg-sub">WEB DEMO</div>' +
      '<button class="dg-restart go" data-action="start-game">ゲームスタート</button>' +
      '</div>' +
      '<div class="dg-tog"></div>' +
      '<div class="dg-summary"></div>' +
      '<div class="dg-main">' +
      '<div class="dg-boardstage"><div class="dg-boardwrap">' +
      '<svg class="dg-board" viewBox="0 0 400 400">' +
      '<g class="layer-slots"></g><g class="layer-cards"></g><g class="layer-rays"></g><g class="layer-squirrels"></g>' +
      '</svg></div></div>' +
      '<div class="dg-side"><div class="dg-panel"></div><div class="dg-logpane"></div></div>' +
      '</div>' +
      '<div class="dg-helpwrap">' +
      '<button class="dg-helpbtn" data-action="toggle-help">▼ あそびかたをみる</button>' +
      '<div class="dg-helpbox" hidden></div>' +
      '</div>';

    var dom = {
      root: root,
      restartBtn: root.querySelector(".dg-restart"),
      tog: root.querySelector(".dg-tog"),
      summary: root.querySelector(".dg-summary"),
      boardWrap: root.querySelector(".dg-boardwrap"),
      svg: root.querySelector(".dg-board"),
      layerSlots: root.querySelector(".layer-slots"),
      layerCards: root.querySelector(".layer-cards"),
      layerRays: root.querySelector(".layer-rays"),
      layerSquirrels: root.querySelector(".layer-squirrels"),
      panel: root.querySelector(".dg-panel"),
      logpane: root.querySelector(".dg-logpane"),
      helpBtn: root.querySelector(".dg-helpbtn"),
      helpBox: root.querySelector(".dg-helpbox")
    };
    window.__DONGURI_DOM__ = dom;

    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn || btn.disabled) return;
      handleAction(btn.dataset.action, btn.dataset);
    });

    var swipeX = null;
    dom.helpBox.addEventListener("touchstart", function (e) { swipeX = e.touches[0].clientX; }, { passive: true });
    dom.helpBox.addEventListener("touchend", function (e) {
      if (swipeX == null) return;
      var d = e.changedTouches[0].clientX - swipeX;
      if (d < -45 && S.pg < HELP.length - 1) { S.pg++; render(); }
      if (d > 45 && S.pg > 0) { S.pg--; render(); }
      swipeX = null;
    });

    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
