(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var stage3d = document.getElementById("stage3d");
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

  // Box proportions are this prototype's own placeholder choices (real package
  // dimensions are not published anywhere in the source content), kept distinct
  // per title rather than a uniform size.
  var DIMS = {
    yadokari: { w: 90, h: 125, d: 20 },
    donguri: { w: 150, h: 150, d: 45 },
    karuta: { w: 148, h: 105, d: 35 },
    "murder-mystery": { w: 135, h: 95, d: 28 },
    "make-heroine": { w: 160, h: 120, d: 40 },
    ballooning: { w: 120, h: 85, d: 22 },
  };
  var TOKEN_KEYS = { squirrel: 1, chip: 1, heart: 1, board: 1 };

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    document.body.classList.add("no-motion");
    rmNote.hidden = false;
  }

  var games = GAMES.slice().sort(function (a, b) { return a.order - b.order; });
  var activeIndex = Math.max(0, games.findIndex(function (g) { return g.id === FEATURED_ID; }));
  var phase = "browse"; // 'browse' | 'open'
  var transitionGen = 0; // bumped on every open/close so stale timeouts can no-op
  var boxEls = [];
  var pieceEls = {}; // gameId -> [{el, closedT, openT}]

  // pop distances below were tuned against the desktop --scale; scale them down
  // proportionally on smaller boxes (e.g. the mobile carousel) so contents never
  // spring further than the stage can show.
  var popFactor = 1;
  (function computePopFactor() {
    var probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:var(--scale);";
    document.body.appendChild(probe);
    var px = parseFloat(getComputedStyle(probe).width) || 1.8;
    document.body.removeChild(probe);
    popFactor = clamp(px / 1.8, 0.62, 1.1);
  })();

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function shade(hex, amt) {
    var c = hex.replace("#", "");
    var num = parseInt(c, 16);
    var r = clamp(((num >> 16) & 255) + amt, 0, 255);
    var g = clamp(((num >> 8) & 255) + amt, 0, 255);
    var b = clamp((num & 255) + amt, 0, 255);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  // ---------- Build boxes ----------
  function buildBox(game, idx) {
    var wrap = document.createElement("div");
    wrap.className = "boxwrap";
    wrap.dataset.id = game.id;
    wrap.setAttribute("role", "option");
    wrap.setAttribute("tabindex", "0");
    wrap.setAttribute("aria-label", (game.titleShort || game.title).replace(/\n/g, " "));
    var dims = DIMS[game.id];
    wrap.style.setProperty("--bw-raw", dims.w);
    wrap.style.setProperty("--bh-raw", dims.h);
    wrap.style.setProperty("--bd-raw", dims.d);
    wrap.style.setProperty("--accent", game.accent);

    var pedestal = document.createElement("div");
    pedestal.className = "box-pedestal";

    var shadowEl = document.createElement("div");
    shadowEl.className = "box-shadow";

    var box3d = document.createElement("div");
    box3d.className = "box3d";

    var front = document.createElement("div");
    front.className = "face face-front";
    if (game.art.kind === "photo") {
      front.style.backgroundImage = "url(" + game.art.box + ")";
      front.style.boxShadow = "inset 0 -60px 50px -20px rgba(0,0,0,.55)";
    } else {
      front.style.background = game.art.light ? shade(game.accent, 40) : game.accent;
      var flag = document.createElement("span");
      flag.className = "ph-flag";
      flag.textContent = "仮素材";
      front.appendChild(flag);
    }
    var titlePlate = document.createElement("span");
    titlePlate.className = "box-title-plate";
    titlePlate.textContent = game.titleShort || game.title;
    if (game.art.kind === "photo") titlePlate.style.textShadow = "0 1px 4px rgba(0,0,0,.65)";
    front.appendChild(titlePlate);

    var right = document.createElement("div");
    right.className = "face face-right";
    right.style.background = game.art.light ? shade(game.accent, 20) : game.accent;

    var lidHinge = document.createElement("div");
    lidHinge.className = "lid-hinge";
    var lidFace = document.createElement("div");
    lidFace.className = "lid-face";
    lidFace.style.background = game.art.light ? shade(game.accent, 30) : game.accent;
    lidHinge.appendChild(lidFace);

    box3d.appendChild(front);
    box3d.appendChild(right);
    box3d.appendChild(lidHinge);
    pedestal.appendChild(shadowEl);
    pedestal.appendChild(box3d);

    var tray = document.createElement("div");
    tray.className = "tray";
    var groups = game.componentGroups || [];
    var pieces = [];

    // Pre-pass: work out how wide each group's fan would be at full size, then
    // derive a single global scale so every group together still fits the
    // viewport. Scaling per-group independently isn't enough — the groups sit
    // side by side, so what matters is their combined width, not any one
    // group's share of it.
    var trayBudget = Math.min(560, window.innerWidth * 0.86);
    var plannedGroups = groups.map(function (g) {
      var isToken = !!TOKEN_KEYS[g.key];
      var maxShow = isToken ? 4 : 5;
      var imgCount = g.sampleImages ? g.sampleImages.length : 0;
      var visibleCount = Math.max(1, Math.min(g.qty, maxShow, imgCount || maxShow));
      var baseSpread = (isToken ? 15 : 19) * popFactor;
      var fanWidth = 52 + (visibleCount - 1) * baseSpread;
      return { g: g, isToken: isToken, visibleCount: visibleCount, baseSpread: baseSpread, fanWidth: fanWidth };
    });
    var neededWidth = plannedGroups.reduce(function (sum, p) { return sum + p.fanWidth; }, 0) + Math.max(0, groups.length - 1) * 14;
    var globalFanScale = neededWidth > trayBudget ? Math.max(0.4, trayBudget / neededWidth) : 1;

    plannedGroups.forEach(function (plan, gi) {
      var g = plan.g, isToken = plan.isToken, visibleCount = plan.visibleCount;
      var groupEl = document.createElement("div");
      groupEl.className = "piece-group";
      groupEl.dataset.groupKey = g.key;

      var stack = document.createElement("div");
      stack.className = "piece-stack";

      for (var i = 0; i < visibleCount; i++) {
        var piece = document.createElement("div");
        piece.className = "piece" + (isToken ? " token" : "");
        piece.tabIndex = 0;
        piece.setAttribute("role", "button");
        piece.setAttribute("aria-label", g.label + "の役割を見る");
        var img = g.sampleImages && g.sampleImages[i];
        if (img) piece.style.backgroundImage = "url(" + img + ")";
        else piece.style.background = shade(game.accent, isToken ? 26 : (i % 2 ? -6 : 14));

        var spread = plan.baseSpread * globalFanScale;
        var popX = (i - (visibleCount - 1) / 2) * spread;
        // Pieces rest tucked at the box's bottom edge and pop DOWN into the
        // clear space below it — not up into the box's own front face, which
        // would overlap it for any box shorter than the pop distance (this
        // broke visibly on karuta's short, wide package before the fix).
        var popY = (26 + gi * 16 + (isToken ? 0 : 6)) * popFactor;
        var rot = (i - (visibleCount - 1) / 2) * (isToken ? 7 : 5);
        var closedT = "translateX(" + popX + "px) translateY(0px) rotate(0deg) scale(.3)";
        var openT = "translateX(" + popX + "px) translateY(" + popY + "px) rotate(" + rot + "deg) scale(1)";
        var openDelay = reduceMotion ? "0ms" : (140 + gi * 130 + i * 45) + "ms";
        piece.style.transform = closedT;
        piece.style.transitionDelay = openDelay;

        (function (gKey, pieceEl) {
          function act(e) {
            e.stopPropagation();
            highlightComponent(game.id, gKey);
          }
          piece.addEventListener("click", act);
          piece.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(e); }
          });
        })(g.key, piece);

        stack.appendChild(piece);
        pieces.push({ el: piece, closedT: closedT, openT: openT, openDelay: openDelay });
      }

      var label = document.createElement("div");
      label.className = "piece-label";
      label.textContent = g.label;
      var count = document.createElement("div");
      count.className = "piece-count";
      count.textContent = g.qty > visibleCount ? "全" + g.qty + "枚中 " + visibleCount + "枚を表示" : "全" + g.qty + (isToken ? "個" : "枚");

      groupEl.appendChild(stack);
      groupEl.appendChild(label);
      groupEl.appendChild(count);
      tray.appendChild(groupEl);
    });
    pieceEls[game.id] = pieces;

    pedestal.appendChild(tray);
    wrap.appendChild(pedestal);

    wrap.addEventListener("click", function () { onBoxActivate(idx); });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBoxActivate(idx); }
      if (e.key === "ArrowRight") { e.preventDefault(); selectIndex(activeIndex + 1, true); }
      if (e.key === "ArrowLeft") { e.preventDefault(); selectIndex(activeIndex - 1, true); }
    });

    return wrap;
  }

  function onBoxActivate(idx) {
    if (phase === "open") return; // clicking inert collapsed boxes while open does nothing
    if (idx === activeIndex) {
      openBox();
    } else {
      selectIndex(idx, true);
    }
  }

  // ---------- Render list ----------
  games.forEach(function (game, idx) {
    var el = buildBox(game, idx);
    boxEls.push(el);
    stage3d.appendChild(el);

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

    boxEls.forEach(function (el, i) {
      el.classList.toggle("is-selected", i === idx);
    });
    railDots().forEach(function (d, i) { d.classList.toggle("is-active", i === idx); });

    capTitle.textContent = game.titleShort || game.title;
    capTag.textContent = game.tag + "　｜　" + game.players + "　｜　" + game.time + "　｜　" + game.age;
    btnOpen.style.setProperty("--accent", game.accent);
    captionBarAccent(game.accent);
    btnOpen.disabled = false;

    navPrev.disabled = idx === 0;
    navNext.disabled = idx === games.length - 1;

    topbarHint.textContent = "「" + (game.titleShort || game.title).split("\n")[0] + "」を選択中 ー 開くには箱をもう一度クリック／タップ";

    if (userInitiated) {
      var el = boxEls[idx];
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", inline: "center", block: "nearest" });
      }
    }
  }

  function captionBarAccent(hex) {
    document.getElementById("captionBar").style.setProperty("--accent", hex);
  }

  // ---------- Open / close ----------
  // Both actions only ever touch `phase` + classes/transforms and are safe to
  // call at any time: closing can interrupt an in-progress opening (and vice
  // versa) because CSS transitions retarget smoothly from whatever the current
  // computed value is — nothing is gated on "animation finished" timers, so a
  // fast tap sequence (open, then close before the lid finishes) always lands
  // in a clean, consistent state instead of a stuck or duplicated one.
  function openBox() {
    if (phase === "open") return;
    phase = "open";
    var gen = ++transitionGen;
    document.body.classList.add("phase-open");
    stage.classList.add("phase-open");
    var openedIndex = activeIndex;
    var el = boxEls[openedIndex];
    el.classList.add("is-open");

    var pieces = pieceEls[games[openedIndex].id];
    pieces.forEach(function (p) {
      p.el.style.transitionDelay = p.openDelay;
      p.el.style.transform = p.openT;
      p.el.style.opacity = "1";
    });

    renderDetail(games[openedIndex]);
    detail.classList.add("is-visible");
    detail.setAttribute("aria-hidden", "false");

    // mobile's carousel keeps whatever horizontal scroll it had while browsing;
    // once siblings collapse to width:0 that old offset would push the open
    // box (and its popped-out pieces) outside the viewport, so re-home it.
    stage3d.scrollLeft = 0;

    window.setTimeout(function () {
      if (gen !== transitionGen) return; // superseded by a later open/close
      if (phase === "open") btnClose.focus();
    }, reduceMotion ? 0 : 460);
    // Deliberately no auto-scroll here: the box stays exactly where it was in
    // the stage so its popped-out pieces stay clickable, and the detail text
    // simply grows the page below it for the reader to scroll into at will.
  }

  function closeBox() {
    if (phase !== "open") return;
    phase = "browse";
    var gen = ++transitionGen;
    var closedIndex = activeIndex;
    var el = boxEls[closedIndex];
    el.classList.remove("is-open");
    var pieces = pieceEls[games[closedIndex].id];
    pieces.forEach(function (p) {
      p.el.style.transitionDelay = "0ms";
      p.el.style.transform = p.closedT;
      p.el.style.opacity = "0";
    });
    detail.classList.remove("is-visible");
    detail.setAttribute("aria-hidden", "true");
    document.body.classList.remove("phase-open");
    stage.classList.remove("phase-open");

    window.setTimeout(function () {
      if (gen !== transitionGen) return;
      if (phase === "browse") {
        boxEls[closedIndex].focus();
        var elx = boxEls[activeIndex];
        if (elx) elx.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
      }
    }, reduceMotion ? 0 : 520);
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
    }, reduceMotion ? 0 : 520);
  });
  navPrev.addEventListener("click", function () { selectIndex(activeIndex - 1, true); });
  navNext.addEventListener("click", function () { selectIndex(activeIndex + 1, true); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && phase === "open") closeBox();
  });

  // mobile: sync selection to whichever box the scroll-snap carousel centers on
  var scrollSyncTimer = null;
  stage3d.addEventListener("scroll", function () {
    if (phase === "open") return;
    window.clearTimeout(scrollSyncTimer);
    scrollSyncTimer = window.setTimeout(function () {
      var stageRect = stage3d.getBoundingClientRect();
      var centerX = stageRect.left + stageRect.width / 2;
      var closest = 0, closestDist = Infinity;
      boxEls.forEach(function (elx, i) {
        var r = elx.getBoundingClientRect();
        var d = Math.abs((r.left + r.width / 2) - centerX);
        if (d < closestDist) { closestDist = d; closest = i; }
      });
      if (closest !== activeIndex) selectIndex(closest, false);
    }, 90);
  }, { passive: true });

  window.addEventListener("resize", function () {
    if (phase === "browse") {
      var elx = boxEls[activeIndex];
      if (elx) elx.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
    }
  });

  // init
  selectIndex(activeIndex, false);
  window.setTimeout(function () { selectIndex(activeIndex, true); }, 60);
})();
