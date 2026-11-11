/* 《如果世界忘记了你》— layers.js
 * 2D 合成层（在 WebGL 之上、DOM 之下）：
 *   · 右下角的纸堆 / 落下的那张空白相纸
 *   · 第 8 个文件时浮现的 2,417 个"别人的数据"碎片
 *   · 结局里像阳光灰尘一样漂着的痕迹
 */
(function (global) {
  'use strict';
  var LX = (global.LX = global.LX || {});
  var U = LX.U;

  var L = {
    canvas: null,
    ctx: null,
    dpr: 1,
    vw: 0,
    vh: 0,
    sheetSprite: null,
    sheets: 0,              // 视觉上纸堆里有几张
    visualSheets: 0,
    falling: null,
    fragAlpha: 0,
    pileAlpha: 1,
    cardRect: null,
    fragSprites: [],
    fragInstances: [],
    motes: null,
    motesAlpha: 0,
    motesSettle: 0,
    motesOn: false,
    t: 0
  };

  L.init = function (canvas) {
    L.canvas = canvas;
    L.ctx = canvas.getContext('2d');
    L.sheetSprite = LX.Paper.makeSheet(240, 330, 11);
    buildFragments();
    buildMotes();
  };

  /* ================= 纸堆 ================= */
  L.resize = function (vw, vh, dpr) {
    L.vw = vw; L.vh = vh; L.dpr = dpr;
    L.canvas.width = Math.max(1, Math.round(vw * dpr));
    L.canvas.height = Math.max(1, Math.round(vh * dpr));
    layoutFragments();
  };

  L.setSheets = function (n) {
    L.visualSheets = U.clamp(n, 0, 16);
  };

  L.setPileAlpha = function (a) { L.pileAlpha = U.clamp01(a); };

  L.setCardRect = function (r) { L.cardRect = r; layoutFragments(); };

  L.reset = function () {
    L.sheets = 0;
    L.visualSheets = 0;
    L.falling = null;
    L.fragAlpha = 0;
    L.pileAlpha = 1;
    L.motesOn = false;
    L.motesAlpha = 0;
  };

  function pileAnchor() {
    var s = Math.min(L.vw, L.vh);
    var sheetW = U.clamp(s * 0.185, 84, 146);
    return {
      x: L.vw - sheetW * 0.58 - Math.max(14, Math.min(32, L.vw * 0.026)),
      y: L.vh - sheetW * 1.30 - Math.max(12, Math.min(28, L.vh * 0.024)),
      w: sheetW,
      h: sheetW * 330 / 240
    };
  }

  // 一张空白相纸落进纸堆
  L.dropSheet = function (fromRect, canvasSource, onLand) {
    var a = pileAnchor();
    L.falling = {
      t: 0,
      dur: 0.95,
      from: { x: fromRect.x, y: fromRect.y, w: fromRect.w, h: fromRect.h },
      to: { x: a.x, y: a.y, w: a.w, h: a.h },
      src: canvasSource,
      onLand: onLand || null,
      landed: false
    };
  };

  function drawPile(ctx) {
    if (L.visualSheets <= 0 || L.pileAlpha <= 0.01) return;
    var a = pileAnchor();
    var n = L.visualSheets;
    var rnd = U.mulberry32(4231);
    // 整叠底下的影子
    ctx.save();
    ctx.globalAlpha = 0.14 * L.pileAlpha;
    ctx.fillStyle = '#7C7264';
    ctx.beginPath();
    ctx.ellipse(a.x + a.w * 0.54, a.y + n * 2.1 + a.h * 0.99,
      a.w * 0.52, a.h * 0.045, -0.02, 0, 6.2832);
    ctx.fill();
    ctx.restore();
    for (var i = 0; i < n; i++) {
      var jx = (rnd() - 0.5) * 9;
      var jy = (rnd() - 0.5) * 4;
      var rot = (rnd() - 0.5) * 0.10;
      var sc = 1 - i * 0.003;
      var x = a.x + jx;
      var y = a.y + (n - 1 - i) * 2.1 + jy;
      drawSheetSprite(ctx, x, y, a.w * sc, a.h * sc, rot, L.pileAlpha);
    }
  }

  function drawSheetSprite(ctx, x, y, w, h, rot, alpha) {
    if (!L.sheetSprite) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    // 阴影
    ctx.shadowColor = 'rgba(90,80,62,0.22)';
    ctx.shadowBlur = Math.max(4, w * 0.05);
    ctx.shadowOffsetX = 1.5;
    ctx.shadowOffsetY = 2.5;
    ctx.drawImage(L.sheetSprite, 0, 0, w, h);
    ctx.restore();
  }

  function updateFalling(dt) {
    var f = L.falling;
    if (!f) return;
    f.t += dt;
    var k = U.clamp01(f.t / f.dur);
    // 下落：先慢后快，落地有一点点迟滞
    var fall = Math.pow(k, 1.85);
    var wob = Math.sin(k * Math.PI * 1.6) * 0.055 * (1 - k);
    var x = U.lerp(f.from.x, f.to.x, U.easeInOutCubic(k) * 0.35 + fall * 0.65);
    var y = U.lerp(f.from.y, f.to.y, fall);
    var w = U.lerp(f.from.w, f.to.w, U.easeInOutCubic(k));
    var h = U.lerp(f.from.h, f.to.h, U.easeInOutCubic(k));
    var rot = wob + U.lerp(0, -0.16, k);
    if (k >= 1) {
      L.falling = null;
      if (!f.landed) {
        f.landed = true;
        L.visualSheets = Math.min(16, L.visualSheets + 1);
        if (f.onLand) f.onLand();
      }
      return;
    }
    var ctx = L.ctx;
    ctx.save();
    ctx.globalAlpha = 0.98;
    ctx.translate(x + w * 0.5, y + h * 0.5);
    ctx.rotate(rot);
    ctx.shadowColor = 'rgba(90,80,62,0.20)';
    ctx.shadowBlur = Math.max(6, w * 0.045);
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 5;
    if (f.src) ctx.drawImage(f.src, -w * 0.5, -h * 0.5, w, h);
    else {
      var sp = L.sheetSprite;
      if (sp) ctx.drawImage(sp, -w * 0.5, -h * 0.5, w, h);
    }
    ctx.restore();
  }

  /* ================= 别人的数据碎片 ================= */
  function buildFragments() {
    var makers = [makeWeddingCorner, makeWaveformSliver, makeMapRoute, makeMenuWriting,
      makeCakeCorner, makeChatSliver, makeWeddingCorner2, makeBusStop];
    L.fragSprites = [];
    for (var i = 0; i < makers.length; i++) {
      var c = makers[i]();
      tearEdges(c, 311 + i * 47);
      L.fragSprites.push(c);
    }
  }

  // 把碎片边缘撕掉一部分，让它真的像"从别人的照片里掉下来的一角"
  function tearEdges(c, seed) {
    var ctx = c.getContext('2d');
    var w = c.width, h = c.height;
    var rnd = U.mulberry32(seed);
    var sides = [];
    for (var s = 0; s < 4; s++) if (rnd() < 0.62) sides.push(s);
    if (!sides.length) sides.push((rnd() * 4) | 0);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (var i = 0; i < sides.length; i++) {
      var side = sides[i];
      var depth = (0.10 + rnd() * 0.22);
      var n = 26;
      ctx.beginPath();
      if (side === 0 || side === 1) {
        var baseX = side === 0 ? 0 : w;
        var dir = side === 0 ? 1 : -1;
        ctx.moveTo(baseX, 0);
        for (var k = 0; k <= n; k++) {
          var tt = k / n;
          var d = depth * w * (0.35 + U.fbm1(tt * 5.2 + seed * 3.1, 2, seed + side) * 1.2);
          ctx.lineTo(baseX + dir * d, tt * h);
        }
        ctx.lineTo(baseX, h);
      } else {
        var baseY = side === 2 ? 0 : h;
        var dir2 = side === 2 ? 1 : -1;
        ctx.moveTo(0, baseY);
        for (var k2 = 0; k2 <= n; k2++) {
          var tt2 = k2 / n;
          var d2 = depth * h * (0.35 + U.fbm1(tt2 * 5.2 + seed * 2.7, 2, seed + side + 7) * 1.2);
          ctx.lineTo(tt2 * w, baseY + dir2 * d2);
        }
        ctx.lineTo(w, baseY);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function fragCanvas(w, h) {
    var c = U.canvas(w, h);
    return c;
  }

  // 婚礼照一角：白纱、暖肤色、模糊背景
  function makeWeddingCorner() {
    var w = 420, h = 320, c = fragCanvas(w, h), ctx = c.getContext('2d');
    var rnd = U.mulberry32(77);
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#E4DCCB'); g.addColorStop(0.55, '#D9CBAE'); g.addColorStop(1, '#C9B895');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // 虚化背景的人影
    for (var i = 0; i < 26; i++) {
      var x = rnd() * w, y = rnd() * h * 0.8, r = 12 + rnd() * 46;
      var gg = ctx.createRadialGradient(x, y, 0, x, y, r);
      var col = rnd() < 0.5 ? '200,182,150' : '176,158,128';
      gg.addColorStop(0, 'rgba(' + col + ',0.28)');
      gg.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
    // 白纱
    ctx.save();
    ctx.globalAlpha = 0.9;
    var dg = ctx.createLinearGradient(w * 0.55, 0, w, h);
    dg.addColorStop(0, 'rgba(250,247,240,0.95)');
    dg.addColorStop(1, 'rgba(232,224,210,0.6)');
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.moveTo(w * 0.62, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.85);
    ctx.quadraticCurveTo(w * 0.78, h * 0.55, w * 0.62, 0);
    ctx.fill();
    ctx.restore();
    // 撕开的一角
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    var n = 16;
    for (var k = 0; k <= n; k++) {
      var t = k / n;
      ctx.lineTo(w * 0.30 * t + (U.fbm1(t * 4 + 3, 2, 1) - 0.5) * 30, h * (1 - t) * 0.22);
    }
    for (var k2 = 0; k2 <= 8; k2++) {
      var t2 = k2 / 8;
      ctx.lineTo(w * 0.30 + (U.fbm1(t2 * 5 + 9, 2, 2) - 0.5) * 22, h * 0.22 * t2);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // 褪色 + 颗粒
    fadeCard(ctx, w, h, 0.55);
    return c;
  }

  function makeWeddingCorner2() {
    var w = 380, h = 300, c = fragCanvas(w, h), ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, h, w, 0);
    g.addColorStop(0, '#DCD0B7'); g.addColorStop(1, '#E8DFCC');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (var i = 0; i < 7; i++) {
      ctx.fillStyle = 'rgba(150,130,100,0.25)';
      ctx.beginPath();
      ctx.ellipse(w * (0.25 + i * 0.09), h * (0.55 + (i % 3) * 0.07), 18 + i * 3, 46 + i * 6, 0.1, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(w, h);
    for (var k = 0; k <= 14; k++) {
      var t = k / 14;
      ctx.lineTo(w - w * 0.34 * t - (U.fbm1(t * 5, 2, 7) - 0.5) * 26, h - h * 0.10 * t);
    }
    ctx.lineTo(w - w * 0.30, h - h * 0.30);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    fadeCard(ctx, w, h, 0.6);
    return c;
  }

  function makeWaveformSliver() {
    var w = 360, h = 170, c = fragCanvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    var rnd = U.mulberry32(31);
    ctx.strokeStyle = 'rgba(63,74,66,0.55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    var mid = h * 0.5;
    for (var x = 8; x < w - 8; x += 3) {
      var e = (U.fbm1(x / 26, 3, 9) * 0.8 + 0.15) * (0.5 + 0.5 * Math.sin(x / 90 + 1.2));
      var amp = e * h * 0.42;
      ctx.globalAlpha = 0.35 + rnd() * 0.45;
      ctx.beginPath();
      ctx.moveTo(x, mid - amp);
      ctx.lineTo(x, mid + amp * (0.7 + rnd() * 0.5));
      ctx.stroke();
    }
    var gg = ctx.createLinearGradient(0, 0, w, 0);
    gg.addColorStop(0, 'rgba(220,215,203,0.55)');
    gg.addColorStop(0.2, 'rgba(220,215,203,0)');
    gg.addColorStop(0.85, 'rgba(220,215,203,0)');
    gg.addColorStop(1, 'rgba(220,215,203,0.55)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h);
    return c;
  }

  function makeMapRoute() {
    var w = 380, h = 320, c = fragCanvas(w, h), ctx = c.getContext('2d');
    ctx.fillStyle = '#E9E4D6'; ctx.fillRect(0, 0, w, h);
    // 路网
    var rnd = U.mulberry32(19);
    ctx.strokeStyle = 'rgba(150,142,126,0.35)';
    for (var i = 0; i < 26; i++) {
      ctx.lineWidth = rnd() < 0.2 ? 3.2 : 1.1;
      ctx.globalAlpha = 0.25 + rnd() * 0.4;
      ctx.beginPath();
      var horiz = rnd() < 0.5;
      if (horiz) {
        var y = rnd() * h;
        ctx.moveTo(-10, y);
        ctx.lineTo(w + 10, y + (rnd() - 0.5) * 40);
      } else {
        var x = rnd() * w;
        ctx.moveTo(x, -10);
        ctx.lineTo(x + (rnd() - 0.5) * 40, h + 10);
      }
      ctx.stroke();
    }
    // 路线
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(120,100,78,0.75)';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(w * 0.12, h * 0.88);
    ctx.bezierCurveTo(w * 0.34, h * 0.62, w * 0.30, h * 0.34, w * 0.56, h * 0.26);
    ctx.bezierCurveTo(w * 0.74, h * 0.20, w * 0.80, h * 0.34, w * 0.86, h * 0.22);
    ctx.stroke();
    ctx.setLineDash([]);
    // 终点
    ctx.fillStyle = 'rgba(150,52,44,0.75)';
    ctx.beginPath(); ctx.arc(w * 0.86, h * 0.22, 5.5, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(150,52,44,0.35)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(w * 0.86, h * 0.22, 12, 0, 6.2832); ctx.stroke();
    fadeCard(ctx, w, h, 0.35);
    return c;
  }

  function makeMenuWriting() {
    var w = 340, h = 260, c = fragCanvas(w, h), ctx = c.getContext('2d');
    ctx.fillStyle = '#EFE9DC'; ctx.fillRect(0, 0, w, h);
    // 菜单印刷行（淡）
    ctx.fillStyle = 'rgba(140,132,116,0.35)';
    for (var i = 0; i < 7; i++) {
      ctx.fillRect(w * 0.12, h * (0.2 + i * 0.09), w * (0.35 + (i % 3) * 0.12), 2.2);
    }
    // 手写笔迹（蓝黑墨水）
    ctx.strokeStyle = 'rgba(46,58,78,0.62)';
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    var words = [
      [[0.55, 0.30], [0.62, 0.27], [0.68, 0.30], [0.74, 0.26], [0.79, 0.31]],
      [[0.52, 0.45], [0.58, 0.49], [0.64, 0.44], [0.71, 0.48], [0.78, 0.44], [0.84, 0.47]],
      [[0.56, 0.62], [0.63, 0.58], [0.70, 0.63], [0.77, 0.59]]
    ];
    for (var wi = 0; wi < words.length; wi++) {
      ctx.beginPath();
      var pts = words[wi];
      for (var pi = 0; pi < pts.length; pi++) {
        var x = pts[pi][0] * w, y = pts[pi][1] * h;
        if (pi === 0) ctx.moveTo(x, y);
        else {
          var px = pts[pi - 1][0] * w, py = pts[pi - 1][1] * h;
          ctx.quadraticCurveTo((px + x) / 2 + (pi % 2 ? 4 : -4), (py + y) / 2 - 3, x, y);
        }
      }
      ctx.stroke();
    }
    fadeCard(ctx, w, h, 0.4);
    return c;
  }

  function makeCakeCorner() {
    var w = 300, h = 300, c = fragCanvas(w, h), ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#E8D9BE'); g.addColorStop(1, '#C8AF88');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    var gg = ctx.createRadialGradient(w * 0.55, h * 0.35, 0, w * 0.55, h * 0.35, w * 0.7);
    gg.addColorStop(0, 'rgba(255,226,160,0.85)');
    gg.addColorStop(0.4, 'rgba(235,186,110,0.35)');
    gg.addColorStop(1, 'rgba(200,170,130,0)');
    ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(120,96,70,0.30)';
    ctx.beginPath();
    ctx.ellipse(w * 0.45, h * 0.78, w * 0.34, h * 0.13, 0, 0, 6.2832);
    ctx.fill();
    fadeCard(ctx, w, h, 0.5);
    return c;
  }

  function makeChatSliver() {
    var w = 330, h = 240, c = fragCanvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    function bubble(x, y, bw, bh, side) {
      ctx.save();
      ctx.fillStyle = side ? 'rgba(214,224,210,0.85)' : 'rgba(238,234,224,0.95)';
      ctx.beginPath();
      var r = 12;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + bw, y, x + bw, y + bh, r);
      ctx.arcTo(x + bw, y + bh, x, y + bh, r);
      ctx.arcTo(x, y + bh, x, y, r);
      ctx.arcTo(x, y, x + bw, y, r);
      ctx.closePath(); ctx.fill();
      // 文字条
      ctx.fillStyle = 'rgba(90,86,76,0.45)';
      var lines = Math.max(1, Math.floor((bh - 26) / 16));
      for (var i = 0; i < lines; i++) {
        ctx.fillRect(x + 14, y + 14 + i * 16, (bw - 40) * (0.55 + ((i * 37) % 40) / 100), 3);
      }
      ctx.restore();
    }
    bubble(w * 0.06, h * 0.14, w * 0.56, h * 0.26, 0);
    bubble(w * 0.32, h * 0.46, w * 0.60, h * 0.24, 1);
    bubble(w * 0.06, h * 0.76, w * 0.44, h * 0.20, 0);
    return c;
  }

  function makeBusStop() {
    var w = 300, h = 280, c = fragCanvas(w, h), ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#DCD8CA'); g.addColorStop(1, '#C6BFAE');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(120,112,96,0.35)';
    ctx.fillRect(w * 0.1, h * 0.62, w * 0.8, 2.5);
    ctx.fillRect(w * 0.2, h * 0.42, 2.5, h * 0.2);
    ctx.fillRect(w * 0.7, h * 0.42, 2.5, h * 0.2);
    ctx.fillStyle = 'rgba(96,90,78,0.5)';
    ctx.fillRect(w * 0.2, h * 0.42, w * 0.5, 2.5);
    // 站牌
    ctx.strokeStyle = 'rgba(110,102,88,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.78, h * 0.62); ctx.lineTo(w * 0.78, h * 0.24);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,226,212,0.9)';
    ctx.fillRect(w * 0.70, h * 0.20, w * 0.17, h * 0.10);
    fadeCard(ctx, w, h, 0.55);
    return c;
  }

  function fadeCard(ctx, w, h, amount) {
    // 统一的褪色调 + 颗粒 + 边缘压暗（碎片也要像"旧数据"）
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(242,238,230,' + (amount * 0.30).toFixed(3) + ')';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    var img;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return; }
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 4) continue;
      var r = d[i], g2 = d[i + 1], b = d[i + 2];
      var l = r * 0.299 + g2 * 0.587 + b * 0.114;
      var sat = 1 - amount * 0.42;
      r = l + (r - l) * sat; g2 = l + (g2 - l) * sat; b = l + (b - l) * sat;
      // 偏黄
      r += 4; g2 += 1; b -= 8;
      var n = (Math.random() - 0.5) * 16;
      d[i] = r + n; d[i + 1] = g2 + n; d[i + 2] = b + n;
    }
    ctx.putImageData(img, 0, 0);
  }

  function layoutFragments() {
    var vw = L.vw, vh = L.vh;
    var rnd = U.mulberry32(2024);
    L.fragInstances = [];
    var card = L.cardRect;
    function hitsCard(x, y, w, h) {
      if (!card) return false;
      var m = 18;
      return !(x + w < card.x - m || x > card.x + card.w + m ||
        y + h < card.y - m || y > card.y + card.h + m);
    }
    var count = 12;
    for (var i = 0; i < count; i++) {
      var s = L.fragSprites[i % L.fragSprites.length];
      var scale = 0.34 + rnd() * 0.30;
      var w = s.width * scale, h = s.height * scale;
      var x = 0, y = 0, ok = false;
      for (var tries = 0; tries < 14 && !ok; tries++) {
        var side = (i + tries) % 4;
        var r1 = rnd(), r2 = rnd();
        var pad = 6;
        if (side === 0) {
          x = pad + r1 * vw * 0.14 - w * 0.18;
          y = vh * 0.06 + r2 * vh * 0.86 - h * 0.35;
        } else if (side === 1) {
          x = vw - (pad + r1 * vw * 0.13) - w * 0.82;
          y = vh * 0.06 + r2 * vh * 0.86 - h * 0.35;
        } else if (side === 2) {
          x = vw * 0.14 + r1 * vw * 0.72 - w * 0.4;
          y = pad + r2 * vh * 0.07 - h * 0.2;
        } else {
          x = vw * 0.14 + r1 * vw * 0.72 - w * 0.4;
          y = vh - (pad + r2 * vh * 0.08) - h * 0.8;
        }
        ok = !hitsCard(x, y, w, h);
      }
      L.fragInstances.push({
        s: s, x: x, y: y, w: w, h: h,
        rot: (rnd() - 0.5) * 0.20,
        phase: rnd() * 6.28,
        drift: 0.4 + rnd() * 0.9,
        baseA: 0.46 + rnd() * 0.40
      });
    }
  }

  L.setFragmentsAlpha = function (a) { L.fragAlpha = U.clamp01(a); };

  function drawFragments(ctx, t) {
    if (L.fragAlpha <= 0.004 || !L.fragInstances.length) return;
    var reduced = LX.ENV.reducedMotion;
    for (var i = 0; i < L.fragInstances.length; i++) {
      var f = L.fragInstances[i];
      var dy = reduced ? 0 : Math.sin(t * 0.18 + f.phase) * 3.2 * f.drift;
      var dx = reduced ? 0 : Math.cos(t * 0.13 + f.phase * 1.7) * 2.6 * f.drift;
      ctx.save();
      ctx.globalAlpha = L.fragAlpha * f.baseA;
      ctx.translate(f.x + f.w * 0.5 + dx, f.y + f.h * 0.5 + dy);
      ctx.rotate(f.rot + (reduced ? 0 : Math.sin(t * 0.09 + f.phase) * 0.012));
      ctx.drawImage(f.s, -f.w * 0.5, -f.h * 0.5, f.w, f.h);
      ctx.restore();
    }
  }

  /* ================= 结局的灰尘（2417） ================= */
  function buildMotes() {
    var rnd = U.mulberry32(2417);
    var list = [];
    for (var i = 0; i < 2417; i++) {
      list.push({
        x: rnd(), y: rnd(),
        vx: (rnd() - 0.5) * 0.012,
        vy: -0.002 - rnd() * 0.010,
        r: 0.35 + Math.pow(rnd(), 2.2) * 1.9,
        a: 0.035 + rnd() * 0.115,
        ph: rnd() * 6.2832,
        sw: 0.4 + rnd() * 1.2
      });
    }
    L.motes = list;
  }

  L.setMotes = function (on, alpha, settle) {
    L.motesOn = !!on;
    L.motesAlpha = U.clamp01(alpha === undefined ? 1 : alpha);
    L.motesSettle = U.clamp01(settle === undefined ? 0 : settle);
  };

  function drawMotes(ctx, t) {
    if (!L.motesOn || L.motesAlpha <= 0.003) return;
    var motes = L.motes;
    var vw = L.vw, vh = L.vh;
    var reduced = LX.ENV.reducedMotion;
    var settle = L.motesSettle;
    var dmp = 1 - 0.96 * settle;          // 落定时漂移逐渐收住
    var dim = 1 - 0.52 * settle;          // 并且变淡
    ctx.save();
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      var x, y;
      if (reduced) {
        x = m.x * vw; y = m.y * vh;
      } else {
        x = ((m.x + (m.vx * t + Math.sin(t * 0.22 * m.sw + m.ph) * 0.004) * dmp) % 1 + 1) % 1 * vw;
        y = ((m.y + (m.vy * t + Math.cos(t * 0.17 * m.sw + m.ph) * 0.003) * dmp) % 1 + 1) % 1 * vh;
      }
      ctx.globalAlpha = m.a * L.motesAlpha * dim;
      ctx.fillStyle = '#8E8471';
      var s = m.r;
      ctx.fillRect(x, y, s, s);
      if (m.r > 1.5) {
        ctx.globalAlpha = m.a * L.motesAlpha * dim * 0.35;
        ctx.fillRect(x - s * 0.5, y - s * 0.5, s * 2, s * 2);
      }
    }
    // 最后一颗尘埃：慢慢落下来，停在问题那一行旁边，不再动
    if (settle > 0.02) {
      var kk = U.smoothstep(0, 1, settle);
      var kx = U.lerp(vw * 0.5 + 120, vw * 0.5 + 232, kk);
      var ky = U.lerp(vh * 0.5 - 40, vh * 0.556, kk);
      ctx.globalAlpha = 0.13 * L.motesAlpha * Math.min(1, settle * 3);
      ctx.fillStyle = '#8E8471';
      ctx.fillRect(kx, ky, 1.6, 1.6);
    }
    ctx.restore();
  }

  /* ================= 主渲染 ================= */
  L.render = function (dt, t) {
    L.t = t;
    var ctx = L.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    drawFragments(ctx, t);
    drawPile(ctx);
    updateFalling(dt);
    drawMotes(ctx, t);
  };

  L.pileAnchor = pileAnchor;
  LX.Layers = L;
})(window);
