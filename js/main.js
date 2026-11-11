/* 《如果世界忘记了你》— main.js
 * 拼装：布局、相机呼吸、卡片纹理与动态层、主循环、调试钩子。
 */
(function (global) {
  'use strict';
  var LX = global.LX;
  var U = LX.U;

  var M = {
    dpr: 1,
    vw: 0,
    vh: 0,
    cardRect: { x: 0, y: 0, w: 1, h: 1 },      // CSS px
    cardRectDev: { x: 0, y: 0, w: 1, h: 1 },    // 设备 px（y 自顶部）
    cam: { scale: 1, ox: 0, oy: 0 },
    cardCanvas: null,
    overlay: null,
    fileT: 0,
    t: 0,
    lastT: 0,
    paused: false,
    started: false,
    glOK: false
  };

  function el(id) { return document.getElementById(id); }

  /* ---------------- 布局 ---------------- */
  function layout() {
    var vw = Math.max(1, window.innerWidth);
    var vh = Math.max(1, window.innerHeight);
    var dpr = Math.min(LX.DPR_CAP, window.devicePixelRatio || 1);
    M.vw = vw; M.vh = vh; M.dpr = dpr;

    var aspect = LX.CARD_W / LX.CARD_H;   // 0.7273
    var landscape = vw > vh;
    var ch, cw;
    if (landscape) {
      ch = Math.min(vh * 0.735, (vw * 0.40) / aspect);
      cw = ch * aspect;
    } else {
      ch = Math.min(vh * 0.565, (vw * 0.80) / aspect);
      cw = ch * aspect;
    }
    var cx = vw * 0.5;
    var cy = vh * (landscape ? 0.475 : 0.435);
    var x = Math.round(cx - cw / 2);
    var y = Math.round(cy - ch / 2);
    M.cardRect = { x: x, y: y, w: Math.round(cw), h: Math.round(ch) };
    M.cardRectDev = {
      x: Math.round(x * dpr), y: Math.round(y * dpr),
      w: Math.round(cw * dpr), h: Math.round(ch * dpr)
    };

    // DOM 文字跟卡片对齐
    var meta = el('meta'), pre = el('prelude'), hint = el('hint');
    if (meta) { meta.style.left = x + 'px'; meta.style.top = (y + M.cardRect.h + 15) + 'px'; }
    if (pre) { pre.style.left = x + 'px'; pre.style.top = (y + M.cardRect.h + 18) + 'px'; }
    if (hint) {
      hint.style.left = (x + M.cardRect.w * 0.5) + 'px';
      hint.style.top = (y + M.cardRect.h + 52) + 'px';
    }

    // 画布尺寸
    LX.GL.resize(vw * dpr, vh * dpr);
    if (LX.Layers) {
      LX.Layers.resize(vw, vh, dpr);
      LX.Layers.setCardRect(M.cardRect);
    }

    rebuildTable();
  }

  var tableTimer = null;
  function rebuildTable() {
    if (tableTimer) clearTimeout(tableTimer);
    tableTimer = setTimeout(function () {
      var w = Math.min(M.vw * M.dpr, 2048);
      var scale = w / (M.vw * M.dpr);
      var h = Math.min(M.vh * M.dpr * scale, 2048);
      var c = LX.Paper.makeTable(w, h, 7);
      LX.GL.setTable(c);
    }, 60);
  }

  /* ---------------- 卡片纹理 ---------------- */
  function placeholderCard(id) {
    var c = U.canvas(LX.CARD_W, LX.CARD_H), ctx = c.getContext('2d');
    ctx.fillStyle = LX.PAL.card;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(120,110,95,0.25)';
    ctx.font = '400 44px serif';
    ctx.textAlign = 'center';
    ctx.fillText('文件 ' + id, c.width / 2, c.height / 2);
    return c;
  }

  function setFile(id) {
    M.fileT = 0;
    var canvas = null;
    try {
      if (LX.Art && LX.Art.bake) canvas = LX.Art.bake(id);
    } catch (e) { console.error('[main] bake failed', e); }
    if (!canvas) canvas = placeholderCard(id);
    M.cardCanvas = canvas;
    LX.GL.setCard(canvas);

    // 动态层
    if (M.overlay && M.overlay.ctrl && M.overlay.ctrl.dispose) {
      try { M.overlay.ctrl.dispose(); } catch (e) {}
    }
    M.overlay = null;
    LX.GL.clearOverlay();
    try {
      if (LX.Art && LX.Art.createOverlay) {
        var ctrl = LX.Art.createOverlay(id);
        if (ctrl && typeof ctrl.draw === 'function') {
          var c = U.canvas(LX.CARD_W, LX.CARD_H);
          M.overlay = { id: id, canvas: c, ctx: c.getContext('2d'), ctrl: ctrl };
          LX.GL.setOverlay(c);
        }
      }
    } catch (e) { console.error('[main] overlay failed', e); }
  }

  function updateOverlay(f, dt) {
    var ov = M.overlay;
    if (!ov) return;
    var info = {
      p: f.p,
      holding: f.holding,
      repaired: f.repaired,
      musicTime: f.musicTime,
      t: M.fileT,
      phase: f.phase
    };
    var r;
    try { r = ov.ctrl.draw(ov.ctx, info); } catch (e) {
      if (!M._ovErr) { console.error('[main] overlay draw', e); M._ovErr = true; }
      return;
    }
    if (!r) return;
    if (r === true) LX.GL.setOverlay(ov.canvas);
    else if (typeof r === 'object') LX.GL.setOverlay(ov.canvas, r);
  }

  /* ---------------- 相机呼吸 ---------------- */
  function updateCamera(t) {
    if (LX.ENV.reducedMotion) {
      M.cam.scale = 1; M.cam.ox = 0; M.cam.oy = 0;
      return;
    }
    var f = LX.Story.frame();
    var slow = f.holding ? 0.55 : 1;
    var s = 1 + 0.0115 * (U.fbm1(t * 0.078 * slow, 2, 5) - 0.5) * 2;
    var ox = (U.fbm1(t * 0.062 * slow + 13.1, 2, 6) - 0.5) * 0.011;
    var oy = (U.fbm1(t * 0.057 * slow + 27.7, 2, 8) - 0.5) * 0.011;
    M.cam.scale = s; M.cam.ox = ox; M.cam.oy = oy;
  }

  /* ---------------- 渲染一帧 ---------------- */
  function drawGL(f) {
    LX.GL.render({
      cardRect: M.cardRectDev,
      hasCard: f.hasCard,
      p: f.p,
      reveal: f.reveal,
      cam: M.cam,
      time: M.t,
      grain: LX.ENV.reducedMotion ? 0.012 : 0.017,
      exposure: f.exposure,
      ghost: f.fileIdx === 7 ? 1 : 0,
      ghostImg: f.ghostImg || 0,
      seed: 17
    });
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!M.started) return;
    var dt = M.lastT ? (now - M.lastT) / 1000 : 0.016;
    M.lastT = now;
    if (M.paused) return;
    if (dt > 0.05) dt = 0.05;         // 切回前台不要跳帧
    if (dt < 0) dt = 0;

    M.t += dt;
    M.fileT += dt;

    LX.Story.update(dt);
    updateCamera(M.t);

    var f = LX.Story.frame();
    updateOverlay(f, dt);
    drawGL(f);
    if (LX.Layers) LX.Layers.render(dt, M.t);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var canvas = el('gl');
    M.glOK = LX.GL.create(canvas);
    // 先铺纸，避免白屏
    var c0 = LX.Paper.makeTable(640, 400, 7);
    LX.GL.setTable(c0);
    LX.GL.setFields(LX.Paper.makeFields(256, 3));

    if (LX.Layers) LX.Layers.init(el('pile'));

    layout();

    LX.Input.init({
      onPress: function (src) { LX.Story.press(src); },
      onRelease: function (src) { LX.Story.release(src); },
      onHide: function () {
        M.paused = true;
        if (LX.Audio && LX.Audio.suspend) { try { LX.Audio.suspend(); } catch (e) {} }
      },
      onShow: function () {
        M.paused = false;
        M.lastT = 0;
        if (LX.Audio && LX.Audio.resume) { try { LX.Audio.resume(); } catch (e) {} }
      }
    });

    var startStory = function () {
      document.getElementById('hud').classList.remove('booting');
      LX.Story.start({
        onFile: function (id) { setFile(id); },
        getCardCanvas: function () { return M.cardCanvas; },
        getCardRect: function () { return M.cardRect; }
      });
      M.started = true;
      M.lastT = 0;
      requestAnimationFrame(tick);
    };

    // 预烘焙 8 张画；无 art.js 时直接开始（占位）
    if (LX.Art && LX.Art.prewarm) {
      LX.Art.prewarm(function (prog) {
        if (prog >= 1) {
          if (!M._booted) { M._booted = true; startStory(); }
        }
      });
      // 兜底：3.5s 后无论如何开始
      setTimeout(function () {
        if (!M._booted) { M._booted = true; startStory(); }
      }, 3500);
    } else {
      startStory();
    }
  }

  /* ---------------- 调试钩子（测试用） ---------------- */
  function installDebug() {
    var D = {
      version: 1,
      state: function () {
        var s = LX.Story.state();
        s.glMode = LX.GL.mode;
        s.size = { vw: M.vw, vh: M.vh, dpr: M.dpr };
        s.cardRect = M.cardRect;
        s.audio = (LX.Audio && LX.Audio.state) || 'none';
        s.art = !!(LX.Art && LX.Art.ready && LX.Art.ready());
        return s;
      },
      forceFile: function (n) { LX.Story.forceFile(n); },
      forceScreen: function (n) { LX.Story.forceScreen(n); },
      sampleCard: function (inset) {
        var f = LX.Story.frame();
        drawGL(f);
        var r = M.cardRectDev;
        var i = inset === undefined ? 0.18 : inset;
        return LX.GL.sample({
          x: r.x + r.w * i, y: r.y + r.h * i,
          w: Math.max(1, r.w * (1 - 2 * i)), h: Math.max(1, r.h * (1 - 2 * i))
        });
      },
      sampleWhole: function () {
        var f = LX.Story.frame();
        drawGL(f);
        return LX.GL.sample({ x: 0, y: 0, w: LX.GL.size().w, h: LX.GL.size().h });
      },
      timeline: function () { return LX.Story.state().timeline; },
      audioProbe: function () {
        return (LX.Audio && LX.Audio.state) || 'none';
      },
      renderOffline: function (mode) {
        if (LX.Audio && LX.Audio.renderOffline) return LX.Audio.renderOffline(mode);
        return null;
      },
      melody: function () { return LX.Melody; },
      reset: function () {
        try { localStorage.removeItem('linxia.seen'); } catch (e) {}
        LX.Story.reset();
      },
      layout: function () { return M.cardRect; }
    };
    LX.debug = D;
    global.LX.debug = D;
  }

  /* ---------------- go ---------------- */
  function onResize() {
    layout();
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(onResize, 180);
  });
  window.addEventListener('orientationchange', function () {
    setTimeout(onResize, 260);
  });

  function main() {
    installDebug();
    try {
      boot();
    } catch (e) {
      console.error('[main] boot failed', e);
      // 至少让纸面在
      document.body.style.background = LX.PAL.paper;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }

  LX.App = M;
})(window);
