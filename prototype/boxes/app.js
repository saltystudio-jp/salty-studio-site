(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var canvas = document.getElementById("scene3d");
  var stageFallback = document.getElementById("stageFallback");
  var navPrev = document.getElementById("navPrev");
  var navNext = document.getElementById("navNext");
  var capTitle = document.getElementById("capTitle");
  var capTag = document.getElementById("capTag");
  var btnOpen = document.getElementById("btnOpen");
  var rail = document.getElementById("rail");
  var detail = document.getElementById("detail");
  var detailInfo = document.getElementById("detailInfo");
  var btnClose = document.getElementById("btnClose");
  var btnOther = document.getElementById("btnOther");
  var topbarHint = document.getElementById("topbarHint");
  var rmNote = document.getElementById("rmNote");
  var captionBar = document.getElementById("captionBar");

  var TOKEN_KEYS = { squirrel: 1, chip: 1, heart: 1, board: 1 };

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    document.body.classList.add("no-motion");
    rmNote.hidden = false;
  }

  var games = GAMES.slice().sort(function (a, b) { return a.order - b.order; });
  var activeIndex = Math.max(0, games.findIndex(function (g) { return g.id === FEATURED_ID; }));
  var phase = "browse"; // 'browse' | 'open'
  var transitionGen = 0;

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  // ---------- 3D scene (falls back to a plain list if WebGL is unavailable) ----------
  var scene = null;
  function webglAvailable() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }

  if (window.THREE && window.BoxScene && webglAvailable()) {
    try {
      scene = new window.BoxScene(canvas, {
        reduceMotion: reduceMotion,
        onBoxClick: function (idx) { onBoxActivate(idx); },
        onPieceClick: function (gameId, groupKey) { highlightComponent(gameId, groupKey); },
      });
      scene.buildGames(games);
    } catch (e) {
      scene = null;
    }
  }
  if (!scene) {
    canvas.hidden = true;
    stageFallback.hidden = false;
  }

  function onBoxActivate(idx) {
    if (phase === "open") return;
    if (idx === activeIndex) openBox();
    else selectIndex(idx, true);
  }

  // ---------- Rail (also the keyboard/no-WebGL accessible control surface) ----------
  games.forEach(function (game, idx) {
    var dot = document.createElement("button");
    dot.className = "rail-dot";
    dot.setAttribute("aria-label", (game.titleShort || game.title).replace(/\n/g, " ") + "を選ぶ");
    dot.addEventListener("click", function () { selectIndex(idx, true); });
    rail.appendChild(dot);
  });
  function railDots() { return Array.prototype.slice.call(rail.children); }

  // ---------- Selection ----------
  function selectIndex(idx, userInitiated) {
    idx = clamp(idx, 0, games.length - 1);
    activeIndex = idx;
    var game = games[idx];
    if (scene) scene.select(idx);

    railDots().forEach(function (d, i) { d.classList.toggle("is-active", i === idx); });

    capTitle.textContent = game.titleShort || game.title;
    capTag.textContent = game.tag + "　｜　" + game.players + "　｜　" + game.time + "　｜　" + game.age;
    btnOpen.style.setProperty("--accent", game.accent);
    captionBar.style.setProperty("--accent", game.accent);
    btnOpen.disabled = false;

    navPrev.disabled = idx === 0;
    navNext.disabled = idx === games.length - 1;

    topbarHint.textContent = "「" + (game.titleShort || game.title).split("\n")[0] + "」を選択中 ー 開くには箱をもう一度クリック／タップ";
  }

  // ---------- Open / close ----------
  function openBox() {
    if (phase === "open") return;
    phase = "open";
    var gen = ++transitionGen;
    document.body.classList.add("phase-open");
    var openedIndex = activeIndex;
    if (scene) scene.open(openedIndex);

    renderDetail(games[openedIndex]);
    detail.classList.add("is-visible");
    detail.setAttribute("aria-hidden", "false");

    window.setTimeout(function () {
      if (gen !== transitionGen) return;
      if (phase === "open") btnClose.focus();
    }, reduceMotion ? 0 : 420);
  }

  function closeBox() {
    if (phase !== "open") return;
    phase = "browse";
    var gen = ++transitionGen;
    var closedIndex = activeIndex;
    if (scene) scene.close(closedIndex);

    detail.classList.remove("is-visible");
    detail.setAttribute("aria-hidden", "true");
    document.body.classList.remove("phase-open");

    window.setTimeout(function () {
      if (gen !== transitionGen) return;
      if (phase === "browse") boxEls_focus(closedIndex);
    }, reduceMotion ? 0 : 480);
  }

  function boxEls_focus(idx) {
    var d = railDots()[idx];
    if (d) d.focus();
  }

  // ---------- Detail panel ----------
  function highlightComponent(gameId, groupKey) {
    if (games[activeIndex].id !== gameId) return;
    var row = detailInfo.querySelector('[data-comp-key="' + groupKey + '"]');
    if (!row) return;
    row.classList.add("is-expanded");
    row.classList.add("is-flash");
    row.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    window.setTimeout(function () { row.classList.remove("is-flash"); }, 900);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderDetail(game) {
    detailInfo.innerHTML = "";
    detailInfo.style.setProperty("--accent", game.accent);

    var h1 = el("h1", null, game.titleShort || game.title);
    detailInfo.appendChild(h1);

    var chips = el("div", "chip-row");
    [["人数", game.players], ["時間", game.time], ["対象年齢", game.age]].forEach(function (pair) {
      var c = el("span", "chip");
      var strong = el("strong", null, pair[0]);
      c.appendChild(strong);
      c.appendChild(document.createTextNode(pair[1]));
      chips.appendChild(c);
    });
    detailInfo.appendChild(chips);

    detailInfo.appendChild(el("h3", null, "概要"));
    detailInfo.appendChild(el("p", null, game.overview));

    if (game.highlights && game.highlights.length) {
      detailInfo.appendChild(el("h3", null, "特徴"));
      var ul = el("ul", "feature-list");
      game.highlights.forEach(function (h) { ul.appendChild(el("li", null, h)); });
      detailInfo.appendChild(ul);
    }

    detailInfo.appendChild(el("h3", null, "コンポーネント"));
    if (game.componentGroups && game.componentGroups.length) {
      game.componentGroups.forEach(function (g) {
        var row = el("div", "comp-row");
        row.dataset.compKey = g.key;
        var btn = el("button", "comp-row-btn");
        btn.type = "button";
        btn.setAttribute("aria-expanded", "false");
        var nameSpan = el("span", null, g.label);
        var qtySpan = el("span", "qty", g.qty + (TOKEN_KEYS[g.key] ? "個" : "枚"));
        btn.appendChild(nameSpan);
        btn.appendChild(qtySpan);
        var role = el("p", "comp-role", g.role);
        btn.addEventListener("click", function () {
          var expanded = row.classList.toggle("is-expanded");
          btn.setAttribute("aria-expanded", expanded ? "true" : "false");
        });
        row.appendChild(btn);
        row.appendChild(role);
        detailInfo.appendChild(row);
      });
      if (game.componentTotal) detailInfo.appendChild(el("p", null, game.componentTotal));
    } else if (game.componentNote) {
      detailInfo.appendChild(el("p", null, game.componentNote));
    }

    if (game.manualNote) {
      detailInfo.appendChild(el("h3", null, "説明書"));
      detailInfo.appendChild(el("p", null, game.manualNote));
    }

    detailInfo.appendChild(el("h3", null, "頒布・入手"));
    if (game.distribution && (game.distribution.date || game.distribution.event)) {
      var distP = el("p", null,
        (game.distribution.event ? game.distribution.event : "") +
        (game.distribution.date ? "　" + game.distribution.date + " 頒布" : "") +
        (game.distribution.status ? "　（" + game.distribution.status + "）" : "")
      );
      detailInfo.appendChild(distP);
    }
    if (game.buyLinks && game.buyLinks.length) {
      var buyRow = el("div", "buy-row");
      game.buyLinks.forEach(function (b) {
        var a = el("a", "buy-btn" + (b.kind === "primary" ? " primary" : ""), b.label);
        a.href = b.href;
        if (b.external) { a.target = "_blank"; a.rel = "noopener"; }
        buyRow.appendChild(a);
      });
      detailInfo.appendChild(buyRow);
    }
    if (game.buyNote) detailInfo.appendChild(el("p", "note-box", game.buyNote));

    if (game.staff) {
      detailInfo.appendChild(el("h3", null, "スタッフ"));
      var sp = el("p", null, Object.keys(game.staff).map(function (k) { return k + "：" + game.staff[k]; }).join(" ／ "));
      detailInfo.appendChild(sp);
    }
    if (game.credit) {
      detailInfo.appendChild(el("h3", null, "クレジット"));
      var cp = el("p", null, Object.keys(game.credit).map(function (k) { return k + "：" + game.credit[k]; }).join(" ／ "));
      detailInfo.appendChild(cp);
    }
    if (game.art && game.art.note) {
      detailInfo.appendChild(el("p", "note-box", game.art.note));
    }
  }

  // ---------- Controls ----------
  btnOpen.addEventListener("click", openBox);
  btnClose.addEventListener("click", closeBox);
  btnOther.addEventListener("click", function () {
    closeBox();
    window.setTimeout(function () {
      selectIndex(clamp(activeIndex + 1, 0, games.length - 1), true);
    }, reduceMotion ? 0 : 500);
  });
  navPrev.addEventListener("click", function () { selectIndex(activeIndex - 1, true); });
  navNext.addEventListener("click", function () { selectIndex(activeIndex + 1, true); });

  stage.addEventListener("keydown", function (e) {
    if (phase === "open") return;
    if (e.key === "ArrowRight") { e.preventDefault(); selectIndex(activeIndex + 1, true); }
    if (e.key === "ArrowLeft") { e.preventDefault(); selectIndex(activeIndex - 1, true); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBoxActivate(activeIndex); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && phase === "open") closeBox();
  });

  // init
  selectIndex(activeIndex, false);
})();
