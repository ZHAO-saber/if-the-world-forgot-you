/* 《如果世界忘记了你》— art.js
 * 8 个文件：被打印在一张相纸上的褪色暖调胶片照片（暗房，不是科技感）。
 * 全部 Canvas2D 程序化烘焙，零外部素材。classic script，IIFE，挂 window.LX.Art。
 *
 * 烘焙画布固定 1024×1408：相纸底（LX.PAL.card + 纤维 + 颗粒 + 边缘压暗），
 * 内缩 26px 的画面区里画内容，画面区边缘是相纸药膜的不规则软边。
 * 动态层与 bake 共用同一套 LAYOUT 常量，坐标系完全一致。
 */
(function (global) {
  'use strict';
  var LX = global.LX;
  if (!LX || !LX.U || !LX.CARD_W) return;

  var U = LX.U;
  var W = LX.CARD_W;          // 1024
  var H = LX.CARD_H;          // 1408
  var M = 26;                 // 画面区内缩
  var IW = W - M * 2;
  var IH = H - M * 2;
  var TAU = Math.PI * 2;

  var FONT_HAND = '"KaiTi","Kaiti SC","STKaiti","Xingkai SC","Noto Serif CJK SC","Songti SC",serif';
  var FONT_SERIF = '"Georgia","Times New Roman","Songti SC","SimSun","Noto Serif CJK SC",serif';
  var FONT_NUM = '"Times New Roman","Cambria","Georgia",serif';

  /* ============================================================
   *  基础工具
   * ============================================================ */
  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  }
  function c2d(c) { return c.getContext('2d'); }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function rgba(rgb, a) {
    return 'rgba(' + clamp255(rgb[0]) + ',' + clamp255(rgb[1]) + ',' + clamp255(rgb[2]) + ',' + a + ')';
  }
  function rgbStr(rgb) {
    return 'rgb(' + clamp255(rgb[0]) + ',' + clamp255(rgb[1]) + ',' + clamp255(rgb[2]) + ')';
  }

  // 柔和椭圆光斑（渐变，不是实心椭圆）
  function softBlob(ctx, cx, cy, rx, ry, rgb, alpha) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(Math.max(1, rx), Math.max(1, ry));
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgba(rgb, alpha));
    g.addColorStop(0.5, rgba(rgb, alpha * 0.55));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 手抖的线
  function strokeWob(ctx, x0, y0, x1, y1, amp, seed, color, width, steps) {
    U.wobbleLine(ctx, x0, y0, x1, y1, amp, seed, steps || 22);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 不规则闭合形状
  function blobPath(ctx, cx, cy, rx, ry, seed, amp, n) {
    n = n || 72;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var a = t * TAU;
      var k = 1 + (U.fbm1(t * 4.3 + seed * 0.37, 3, seed) - 0.5) * 2 * amp;
      var x = cx + Math.cos(a) * rx * k;
      var y = cy + Math.sin(a) * ry * k;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // 长的木纹/纤维笔画
  function grainStroke(ctx, x0, y0, x1, y1, amp, seed, color, width, steps) {
    steps = steps || Math.max(8, Math.round(Math.abs(x1 - x0) / 26));
    ctx.beginPath();
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var x = x0 + (x1 - x0) * t;
      var y = y0 + (y1 - y0) * t + (U.fbm1(t * 3.7 + seed * 1.3, 3, seed) - 0.5) * 2 * amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  var _mc = null;
  function measureCtx() {
    if (!_mc) _mc = c2d(cv(8, 8));
    return _mc;
  }

  // 逐字的手写/印刷不齐
  function drawCharText(ctx, text, x, base, size, font, color, seed, spacing, bleed) {
    ctx.save();
    ctx.font = size + 'px ' + font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === ' ') { cx += size * 0.34 + (spacing || 0); continue; }
      var w = ctx.measureText(ch).width;
      var jy = (U.hash2(i, seed, 7) - 0.5) * size * 0.10;
      var jr = (U.hash2(i, seed, 11) - 0.5) * 0.055;
      ctx.save();
      ctx.translate(cx + w * 0.5, base + jy);
      ctx.rotate(jr);
      ctx.fillStyle = color;
      ctx.fillText(ch, -w * 0.5, 0);
      if (bleed !== false) {
        ctx.globalAlpha = 0.22;
        ctx.fillText(ch, -w * 0.5 + 0.7, 0.6);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      cx += w + (spacing || 0);
    }
    ctx.restore();
    return cx;
  }

  /* ============================================================
   *  预生成素材（全部固定种子 → 确定性）
   * ============================================================ */
  var _assets = null;

  function makeGrainTile(size, seed, cell, amp) {
    var c = cv(size, size);
    var x = c2d(c);
    var img = x.createImageData(size, size);
    var d = img.data;
    var rnd = U.mulberry32(seed);
    var cols = Math.ceil(size / cell);
    var vals = new Float32Array(cols * cols);
    for (var i = 0; i < vals.length; i++) vals[i] = rnd() * 2 - 1;
    for (var y = 0; y < size; y++) {
      for (var xx = 0; xx < size; xx++) {
        var v = vals[((y / cell) | 0) * cols + ((xx / cell) | 0)];
        var g = 128 + v * amp;
        var p = (y * size + xx) * 4;
        d[p] = d[p + 1] = d[p + 2] = g;
        d[p + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  function makeGlow(size, rgb) {
    var c = cv(size, size);
    var x = c2d(c);
    var h = size / 2;
    var g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, rgba(rgb, 0.9));
    g.addColorStop(0.22, rgba(rgb, 0.52));
    g.addColorStop(0.55, rgba(rgb, 0.16));
    g.addColorStop(1, rgba(rgb, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    return c;
  }

  // 虚焦的人影（头+肩，底部淡出，避免硬边）
  function makeSilhouette(seed, w, h) {
    var c = cv(w, h);
    var x = c2d(c);
    x.fillStyle = 'rgb(16,12,9)';
    x.beginPath();
    x.arc(w * 0.52, h * 0.30, h * 0.165, 0, TAU);
    x.fill();
    x.beginPath();
    x.moveTo(w * 0.16, h);
    x.quadraticCurveTo(w * 0.18, h * 0.52, w * 0.52, h * 0.45);
    x.quadraticCurveTo(w * 0.88, h * 0.52, w * 0.90, h);
    x.closePath();
    x.fill();
    blurCanvas(c, 10);
    // 底部淡出
    x.save();
    x.globalCompositeOperation = 'destination-out';
    var g = x.createLinearGradient(0, h * 0.55, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = g;
    x.fillRect(0, h * 0.55, w, h * 0.45);
    x.restore();
    return c;
  }

  function assets() {
    if (_assets) return _assets;
    var n = 65536;
    var dither = new Float32Array(n);
    var rnd = U.mulberry32(0x1a2b3c4d);
    for (var i = 0; i < n; i++) dither[i] = rnd() * 2 - 1;
    _assets = {
      dither: dither,
      tile1: makeGrainTile(256, 0x51ed2701, 1, 36),
      tile2: makeGrainTile(256, 0x2f9e3b17, 2, 28),
      tile3: makeGrainTile(256, 0x77aa11cc, 3, 42),
      glowWarm: makeGlow(256, [255, 210, 146]),
      glowCandle: makeGlow(256, [255, 186, 108]),
      sil1: makeSilhouette(0x71a3, 420, 360),
      sil2: makeSilhouette(0x9c5f, 400, 360)
    };
    return _assets;
  }

  /* ============================================================
   *  柔焦 / 模糊（缩小再放大，比 filter blur 稳）
   * ============================================================ */
  function blurCanvas(c, factor) {
    var w = c.width, h = c.height;
    var f = Math.max(2, Math.round(factor || 2));
    var sw = Math.max(4, Math.round(w / f)), sh = Math.max(4, Math.round(h / f));
    var tmp = cv(sw, sh);
    var tc = c2d(tmp);
    tc.imageSmoothingEnabled = true;
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(c, 0, 0, sw, sh);
    var x = c2d(c);
    x.save();
    x.clearRect(0, 0, w, h);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(tmp, 0, 0, w, h);
    x.restore();
  }

  function addBloom(c, amount) {
    var sw = Math.round(W / 4), sh = Math.round(H / 4);
    var tmp = cv(sw, sh);
    var tc = c2d(tmp);
    tc.imageSmoothingEnabled = true;
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(c, 0, 0, sw, sh);
    var x = c2d(c);
    x.save();
    x.globalCompositeOperation = 'lighter';
    x.globalAlpha = amount;
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(tmp, 0, 0, W, H);
    x.restore();
  }

  // 横向拖影（低码率视频 / 慢快门）
  function motionBlurH(c, dist) {
    var tmp = cv(c.width, c.height);
    c2d(tmp).drawImage(c, 0, 0);
    var x = c2d(c);
    x.save();
    x.globalAlpha = 0.15;
    for (var i = 1; i <= dist; i++) {
      x.drawImage(tmp, i, 0);
      x.drawImage(tmp, -i, 0);
    }
    x.restore();
  }

  /* ============================================================
   *  药膜软边遮罩
   * ============================================================ */
  function makeMask(seed) {
    var c = cv(W, H);
    var x = c2d(c);
    var edgeSeed = seed + 311;
    var wob = 7;
    var steps = 64;
    var i, t, xx, yy;
    function inset(t, side) {
      var n = U.fbm1(t * 3.3 + side * 11.7 + edgeSeed * 0.37, 3, edgeSeed + side);
      return M + (n - 0.5) * 2 * wob;
    }
    x.beginPath();
    for (i = 0; i <= steps; i++) {
      t = i / steps; xx = M + t * IW; yy = inset(t, 0);
      if (i === 0) x.moveTo(xx, yy); else x.lineTo(xx, yy);
    }
    for (i = 1; i <= steps; i++) {
      t = i / steps; yy = M + t * IH; xx = W - inset(t, 1);
      x.lineTo(xx, yy);
    }
    for (i = 1; i <= steps; i++) {
      t = i / steps; xx = W - M - t * IW; yy = H - inset(t, 2);
      x.lineTo(xx, yy);
    }
    for (i = 1; i <= steps; i++) {
      t = i / steps; yy = H - M - t * IH; xx = inset(t, 3);
      x.lineTo(xx, yy);
    }
    x.closePath();
    x.fillStyle = '#fff';
    x.fill();
    blurCanvas(c, 6);
    blurCanvas(c, 4);
    return c;
  }

  function composeScene(paperCtx, scene, seed) {
    var mask = makeMask(seed);
    var sc = c2d(scene);
    sc.save();
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(mask, 0, 0);
    sc.restore();
    paperCtx.drawImage(scene, 0, 0);
  }

  /* ============================================================
   *  统一调色 / 颗粒 / 漏光 / 晕影
   * ============================================================ */
  var _luts = null;
  function buildLUTs() {
    if (_luts) return _luts;
    var base = new Uint8ClampedArray(256);
    for (var i = 0; i < 256; i++) {
      var v = i / 255;
      // 抬黑位 + 轻微 S 曲线 + 高光滚降（褪色胶片）
      var s = Math.pow(v, 0.93);
      s = 0.078 + s * 0.882;
      s = s + 0.027 * Math.sin(Math.PI * (s - 0.5));
      base[i] = Math.round(Math.max(0, Math.min(1, s)) * 255);
    }
    var rl = new Uint8ClampedArray(256);
    var gl = new Uint8ClampedArray(256);
    var bl = new Uint8ClampedArray(256);
    for (i = 0; i < 256; i++) {
      // 只有暗部发暖（褪色胶片的影子偏棕），高光/纸底保持接近原色，
      // 避免整张卡被染黄/染粉。
      var sh = Math.pow(1 - i / 255, 1.6);
      rl[i] = base[i] + 2 + Math.round(4 * sh);
      gl[i] = base[i] + 2 + Math.round(1 * sh);
      bl[i] = base[i] - Math.round(6 * sh);
    }
    _luts = { r: rl, g: gl, b: bl };
    return _luts;
  }

  function addLeak(ctx, cfg) {
    if (!cfg) return;
    var g = ctx.createRadialGradient(cfg.x, cfg.y, 0, cfg.x, cfg.y, cfg.r);
    var rgb = cfg.rgb, a = cfg.a;
    g.addColorStop(0, rgba(rgb, a));
    g.addColorStop(0.45, rgba(rgb, a * 0.5));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function addVignette(ctx, strength) {
    var g = ctx.createRadialGradient(W * 0.5, H * 0.46, H * 0.30, W * 0.5, H * 0.46, H * 0.80);
    g.addColorStop(0, 'rgba(38,29,21,0)');
    g.addColorStop(0.55, 'rgba(38,29,21,' + (0.035 * strength).toFixed(4) + ')');
    g.addColorStop(1, 'rgba(38,29,21,' + (0.30 * strength).toFixed(4) + ')');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function addDust(ctx, seed) {
    var r = U.mulberry32((seed ^ 0x7f4a7c15) >>> 0);
    var i, x, y, rad;
    for (i = 0; i < 18; i++) {
      x = r() * W; y = r() * H; rad = 0.5 + r() * 1.8;
      ctx.fillStyle = r() < 0.55 ? 'rgba(255,250,235,0.20)' : 'rgba(46,36,26,0.16)';
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, TAU);
      ctx.fill();
    }
    // 极淡的划痕
    for (i = 0; i < 3; i++) {
      var x0 = r() * W, y0 = r() * H;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + 80 + r() * 160, y0 + (r() - 0.5) * 60, x0 + 40 + r() * 260, y0 + 30 + r() * 90);
      ctx.strokeStyle = 'rgba(255,248,236,0.06)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  // 印相不匀（很淡的大块明暗，避免平色块像矢量）
  function addPrintUneven(ctx, seed) {
    var r = U.mulberry32((seed ^ 0xabcdef) >>> 0);
    for (var i = 0; i < 4; i++) {
      var x = M + r() * IW, y = M + r() * IH, rad = 280 + r() * 420;
      var warm = r() < 0.5;
      softBlob(ctx, x, y, rad, rad * (0.6 + r() * 0.6),
        warm ? [255, 248, 232] : [84, 68, 50], 0.035 + r() * 0.045);
    }
  }

  // 局部的焦点不实（一个角更虚），只处理一小块，代价小
  function addCornerSoft(ctx, cfg) {
    if (!cfg) return;
    var r = Math.round(cfg.r || 360);
    var size = r * 2;
    var sx = Math.round(cfg.x - r), sy = Math.round(cfg.y - r);
    var patch = cv(size, size);
    var pc = c2d(patch);
    try { pc.drawImage(ctx.canvas, sx, sy, size, size, 0, 0, size, size); } catch (e) { return; }
    blurCanvas(patch, cfg.f || 3);
    var m = cv(size, size);
    var mc = c2d(m);
    var g = mc.createRadialGradient(r, r, r * 0.12, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.78)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    mc.fillStyle = g;
    mc.fillRect(0, 0, size, size);
    pc.save();
    pc.globalCompositeOperation = 'destination-in';
    pc.drawImage(m, 0, 0);
    pc.restore();
    ctx.save();
    ctx.drawImage(patch, sx, sy);
    ctx.restore();
  }

  function addGrainTiles(ctx, seed) {
    var A = assets();
    var ox = (seed * 73) & 255;
    var oy = (seed * 151) & 255;
    var p1 = ctx.createPattern(A.tile1, 'repeat');
    var p2 = ctx.createPattern(A.tile2, 'repeat');
    var p3 = ctx.createPattern(A.tile3, 'repeat');
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.17;
    ctx.translate(ox, oy);
    ctx.fillStyle = p1;
    ctx.fillRect(-ox, -oy, W, H);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.11;
    ctx.translate((oy * 3) & 255, (ox * 5) & 255);
    ctx.fillStyle = p2;
    ctx.fillRect(-((oy * 3) & 255), -((ox * 5) & 255), W, H);
    ctx.restore();
    // 粗颗粒：这是能在 440px 显示尺寸下活下来的那层银盐
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.22;
    ctx.translate((ox * 7) & 255, (oy * 11) & 255);
    ctx.fillStyle = p3;
    ctx.fillRect(-((ox * 7) & 255), -((oy * 11) & 255), W, H);
    ctx.restore();
  }

  // 画面区一侧的暗边（相纸上的不均匀印相）
  function addEdgeShade(ctx, cfg) {
    if (!cfg) return;
    var a = cfg.a === undefined ? 0.10 : cfg.a;
    var w = cfg.w || 90;
    var g;
    if (cfg.side === 'left') g = ctx.createLinearGradient(M, 0, M + w, 0);
    else if (cfg.side === 'right') g = ctx.createLinearGradient(W - M, 0, W - M - w, 0);
    else if (cfg.side === 'top') g = ctx.createLinearGradient(0, M, 0, M + w);
    else g = ctx.createLinearGradient(0, H - M, 0, H - M - w);
    g.addColorStop(0, 'rgba(44,32,20,' + a + ')');
    g.addColorStop(1, 'rgba(44,32,20,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = g;
    ctx.fillRect(M, M, IW, IH);
    ctx.restore();
  }

  // 一次全画布像素：降饱和 + 胶片 LUT + 暖调偏移 + 色散 + 银盐抖动
  function grade(ctx, seed, grainAmt, chromaAmt, chromaNoise) {
    var img = ctx.getImageData(0, 0, W, H);
    var src = img.data;
    var out = ctx.createImageData(W, H);
    var d = out.data;
    var L = buildLUTs();
    var N = assets().dither;
    var ox = (seed * 37) & 255, oy = (seed * 91) & 255;
    var ox2 = (seed * 17 + 91) & 255, oy2 = (seed * 53 + 17) & 255;
    var gA = 2.5 * grainAmt, gB = 1.9 * grainAmt;
    var ca = chromaAmt || 0;
    var cn = chromaNoise || 0;
    var p = 0, x, y;
    for (y = 0; y < H; y++) {
      var row = ((y + oy) & 255) << 8;
      var row2 = ((((y >> 1) + oy2) & 255)) << 8;
      for (x = 0; x < W; x++, p += 4) {
        var r, g, b;
        if (ca) {
          // 轻微色散：R 右移 ~1px，B 左移 ~1px（只在高反差边缘看得出来）
          r = src[x + 1 < W ? p + 4 : p];
          g = src[p + 1];
          b = src[x > 0 ? p - 2 : p + 2];
        } else {
          r = src[p]; g = src[p + 1]; b = src[p + 2];
        }
        var lum = (r * 77 + g * 151 + b * 28) >> 8;
        r = (lum + (r - lum) * 0.71) | 0;
        g = (lum + (g - lum) * 0.71) | 0;
        b = (lum + (b - lum) * 0.71) | 0;
        var n = N[row | ((x + ox) & 255)];
        var gr = n * gA + N[row2 | (((x >> 1) + ox2) & 255)] * gB;
        if (cn) {
          var cr = n * cn;
          d[p] = L.r[r] + gr + cr;
          d[p + 1] = L.g[g] + gr;
          d[p + 2] = L.b[b] + gr - cr;
        } else {
          d[p] = L.r[r] + gr;
          d[p + 1] = L.g[g] + gr;
          d[p + 2] = L.b[b] + gr;
        }
        d[p + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  function finish(ctx, cfg, seed) {
    if (cfg.leak) addLeak(ctx, cfg.leak);
    addVignette(ctx, cfg.vignette === undefined ? 0.7 : cfg.vignette);
    addEdgeShade(ctx, cfg.edge);
    addPrintUneven(ctx, seed);
    addDust(ctx, seed);
    addGrainTiles(ctx, seed);
    grade(ctx, seed, cfg.grain === undefined ? 1 : cfg.grain, 1, cfg.chromaNoise ? 3.4 : 0);
    addCornerSoft(ctx, cfg.focus);
  }

  /* ============================================================
   *  相纸底
   * ============================================================ */
  function paintPaper(ctx, seed, rnd) {
    ctx.fillStyle = LX.PAL.card;
    ctx.fillRect(0, 0, W, H);

    // 大尺度纸张不匀
    var i;
    for (i = 0; i < 8; i++) {
      var x = rnd() * W, y = rnd() * H, r = 260 + rnd() * 520;
      var warm = rnd() < 0.55;
      softBlob(ctx, x, y, r, r * (0.5 + rnd() * 0.8), warm ? [255, 250, 236] : [206, 196, 176], 0.05 + rnd() * 0.04);
    }
    // 纸纤维
    ctx.save();
    ctx.lineCap = 'round';
    for (i = 0; i < 430; i++) {
      var fx = rnd() * W, fy = rnd() * H;
      var len = 5 + rnd() * 26;
      var ang = (rnd() - 0.5) * 0.7 + (rnd() < 0.22 ? Math.PI / 2 : 0);
      var dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
      var light = rnd() < 0.5;
      ctx.strokeStyle = light
        ? 'rgba(255,252,242,' + (0.05 + rnd() * 0.08).toFixed(3) + ')'
        : 'rgba(140,128,110,' + (0.03 + rnd() * 0.055).toFixed(3) + ')';
      ctx.lineWidth = 0.5 + rnd() * 0.9;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(fx + dx * 0.5 + (rnd() - 0.5) * 3, fy + dy * 0.5 + (rnd() - 0.5) * 3, fx + dx, fy + dy);
      ctx.stroke();
    }
    // 小纸点
    for (i = 0; i < 100; i++) {
      var px = rnd() * W, py = rnd() * H;
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,108,92,' + (0.04 + rnd() * 0.07).toFixed(3) + ')' : 'rgba(255,252,242,0.16)';
      ctx.beginPath();
      ctx.arc(px, py, 0.4 + rnd() * 1.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // 边缘轻微压暗
    var g = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.42, W * 0.5, H * 0.5, H * 0.80);
    g.addColorStop(0, 'rgba(120,105,85,0)');
    g.addColorStop(1, 'rgba(120,105,85,0.10)');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /* ============================================================
   *  布局常量（bake 与 overlay 共用，坐标系 1024×1408）
   * ============================================================ */
  var LAYOUTS = {};
  function layout(id) {
    if (!LAYOUTS[id]) LAYOUTS[id] = buildLayout(id);
    return LAYOUTS[id];
  }

  function buildLayout(id) {
    var L, rnd, i;
    if (id === 1) {
      return {
        plate: { x: 348, y: 606, rx: 332, ry: 314, rot: -0.07 },
        egg: { x: 372, y: 578, rx: 158, ry: 130 },
        yolk: { x: 366, y: 560, r: 64 },
        glass: { x: 762, top: 800, h: 306, topW: 178, botW: 162, milk: 0.58 },
        beam: { angle: 0.63, y: -140, x: W * 0.02 }
      };
    }
    if (id === 2) {
      return { x0: 112, x1: 912, cy: 690, halfMax: 330, period: 4.0 };
    }
    if (id === 3) {
      return {
        box: { x: 72, y: 466, w: 880, h: 392, r: 10 },
        textX: 128,
        baseline: 648,
        fontSize: 46,
        maxTextW: 768,
        underline: { x0: 124, x1: 900, y: 694 },
        caretH: 56
      };
    }
    if (id === 4) {
      return {
        play: { x: 512, y: 700, r: 46 },
        glows: [
          { x: 316, y: 604, r: 100, rgb: [255, 206, 142], a: 0.85 },
          { x: 442, y: 676, r: 148, rgb: [255, 190, 120], a: 0.70 },
          { x: 560, y: 628, r: 82, rgb: [255, 214, 158], a: 0.80 }
        ],
        haze: { x: 420, y: 690, r: 520 },
        sil: [
          { x: 206, y: 1310, s: 1.06, spr: 0 },
          { x: 826, y: 1326, s: 0.96, spr: 1 }
        ]
      };
    }
    if (id === 5) {
      return {
        items: [
          { text: '青梅怎么腌', x: 150, y: 380, size: 64 },
          { text: '北京到大理 火车', x: 188, y: 580, size: 58 },
          { text: '一个人去看海 安全吗', x: 132, y: 780, size: 56 },
          { text: '失眠 怎么办', x: 206, y: 980, size: 64 }
        ],
        stagger: 0.55,
        dur: 0.5
      };
    }
    if (id === 6) {
      L = { size: 246, base: 764 };
      var mc6 = measureCtx();
      mc6.font = L.size + 'px ' + FONT_NUM;
      var w0 = mc6.measureText('0').width;
      var w7 = mc6.measureText('7').width;
      var w1 = mc6.measureText('1').width;
      var gap = L.size * 0.44;
      var total = w0 + w7 + gap + w1 + w0;
      var start = (W - total) / 2;
      L.start = start;
      L.x0 = start;
      L.x7 = start + w0;
      L.x1 = start + w0 + w7 + gap;
      L.x0b = start + w0 + w7 + gap + w1;
      L.colonX = start + w0 + w7 + gap / 2;
      L.colonTop = L.base - L.size * 0.615;
      L.colonBot = L.base - L.size * 0.255;
      L.colonR = L.size * 0.047;
      L.dayY = L.base + 128;
      L.noteY = L.base + 204;
      return L;
    }
    if (id === 7) {
      var cx = 470, rimY = 846, rx = 340, dip = 82;
      var apexY = rimY - 360;
      var rnd7 = U.mulberry32(0x7011);
      var rimPts = [];
      for (i = 0; i <= 8; i++) {
        var u = -1 + (2 * i) / 8;
        rimPts.push({ x: cx + u * rx, y: rimY + (1 - u * u) * dip });
      }
      var goreTone = [];
      for (i = 0; i < 8; i++) goreTone.push(0.70 + rnd7() * 0.46);
      return {
        cx: cx,
        rimY: rimY,
        rx: rx,
        dip: dip,
        apex: { x: cx, y: apexY },
        rimPts: rimPts,
        goreTone: goreTone,
        handle: { x: cx, y: rimY + 26, endY: 1104, hookX: cx - 92, hookY: 1136 },
        text: { x: 118, y: 1254, size: 40, rot: -0.028 }
      };
    }
    if (id === 8) {
      rnd = U.mulberry32(0x8808);
      var kb = { x: 194, y: 700, w: 620, h: 206 };
      var base = kb.w / 15;
      var widths = [], sum = 0;
      for (i = 0; i < 15; i++) {
        // 白键等宽：只留 ±1px 随机（像塑料模具的误差）
        var kw = base + (rnd() - 0.5) * 2;
        widths.push(kw);
        sum += kw;
      }
      var scale = kb.w / sum;
      var whites = [];
      var acc = 0;
      for (i = 0; i < 15; i++) {
        var ww = widths[i] * scale;
        whites.push({ x: kb.x + acc, y: kb.y, w: ww, h: kb.h });
        acc += ww;
      }
      var bounds = [1, 2, 4, 5, 6, 8, 9, 11, 12, 13];
      var blackMidis = [61, 63, 66, 68, 70, 73, 75, 78, 80, 82];
      var blacks = [];
      for (i = 0; i < bounds.length; i++) {
        var bx = whites[bounds[i]].x;
        var bwma = base * 0.56;
        // 黑键严格骑在白键缝上
        blacks.push({ x: bx - bwma / 2, y: kb.y, w: bwma, h: kb.h * 0.60 });
      }
      return {
        kb: kb,
        whites: whites,
        blacks: blacks,
        blackMidis: blackMidis,
        case: { x: 136, y: 462, w: 752, h: 632 },
        lid: { y0: 462, y1: 542 },
        nameboard: { y0: 542, y1: 700 },
        keySlip: { y0: 906, y1: 932 },
        frontRail: { y0: 932, y1: 1016 },
        bottomPanel: { y0: 1016, y1: 1094 },
        legs: [{ x: 192, y: 1094, w: 56, h: 68 }, { x: 768, y: 1094, w: 56, h: 68 }],
        repairBody: { x: 604, y: 974, w: 96, h: 16 }
      };
    }
    return {};
  }

  /* ============================================================
   *  第 1 个：早餐照片
   * ============================================================ */
  function scene1(ctx, seed, rnd) {
    var L = layout(1);
    paintWood(ctx, seed, rnd);
    paintPlate(ctx, L);
    paintEgg(ctx, L, seed);
    paintGlass(ctx, L, seed);
    paintCrumbs(ctx, L, seed);
    paintMorningLight(ctx, L);
    return {
      blur: [3],
      bloom: 0.13,
      leak: { x: W * -0.06, y: -140, r: 1020, rgb: [255, 178, 88], a: 0.20 },
      vignette: 0.98,
      grain: 1.08,
      edge: { side: 'right', a: 0.13, w: 110 },
      focus: { x: W * 0.88, y: H * 0.10, r: 400, f: 3 }
    };
  }

  function paintWood(ctx, seed, rnd) {
    // 底色：左上受光，右下入暗
    var g = ctx.createLinearGradient(0, 0, W * 0.72, H);
    g.addColorStop(0, '#6e563a');
    g.addColorStop(0.34, '#59432c');
    g.addColorStop(0.72, '#49351f');
    g.addColorStop(1, '#332414');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var i, j;
    // 大尺度明暗
    for (i = 0; i < 18; i++) {
      var bx = rnd() * W, by = rnd() * H, br = 160 + rnd() * 460;
      softBlob(ctx, bx, by, br, br * (0.5 + rnd() * 0.7),
        rnd() < 0.5 ? [168, 128, 78] : [24, 16, 9], 0.05 + rnd() * 0.09);
    }

    var y = -150, plankIdx = 0;
    while (y < H + 150) {
      var ph = 168 + rnd() * 84;
      var tone = rnd();
      var base = U.lerpRGB([52, 37, 23], [128, 100, 66], 0.16 + tone * 0.62);
      var topSeed = seed + plankIdx * 17;
      var k, t, xx, yy;
      ctx.beginPath();
      var pts = 24;
      for (k = 0; k <= pts; k++) {
        t = k / pts;
        xx = -24 + t * (W + 48);
        yy = y + (U.fbm1(t * 2.4 + topSeed * 1.7, 2, topSeed) - 0.5) * 8;
        if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      var botY = y + ph;
      for (k = pts; k >= 0; k--) {
        t = k / pts;
        xx = -24 + t * (W + 48);
        yy = botY + (U.fbm1(t * 2.0 + topSeed * 2.3, 2, topSeed + 3) - 0.5) * 8;
        ctx.lineTo(xx, yy);
      }
      ctx.closePath();
      var pg = ctx.createLinearGradient(0, y, 0, botY);
      pg.addColorStop(0, rgbStr(U.lerpRGB(base, [176, 144, 102], 0.16)));
      pg.addColorStop(0.4, rgbStr(base));
      pg.addColorStop(0.82, rgbStr(U.lerpRGB(base, [28, 19, 11], 0.30)));
      pg.addColorStop(1, rgbStr(U.lerpRGB(base, [22, 15, 9], 0.42)));
      ctx.fillStyle = pg;
      ctx.fill();

      // 木纹：深色长纹 + 浅色反光纹
      var lines = 20 + ((rnd() * 10) | 0);
      for (j = 0; j < lines; j++) {
        var gy = y + 10 + rnd() * (ph - 20);
        var x0 = rnd() * W * 0.45 - 100;
        var x1 = x0 + 280 + rnd() * 700;
        var dark = rnd() < 0.68;
        var col = dark ? [26, 17, 9] : [206, 172, 124];
        grainStroke(ctx, x0, gy, x1, gy + (rnd() - 0.5) * 20, 2 + rnd() * 7,
          seed + j * 11 + plankIdx * 37, rgba(col, (dark ? 0.10 : 0.06) + rnd() * (dark ? 0.16 : 0.09)),
          0.8 + rnd() * 2.2, 16);
      }
      // 板缝：深缝 + 上方受光
      strokeWob(ctx, -24, botY - 1, W + 24, botY - 1, 2.4, seed + plankIdx * 101 + 1, 'rgba(18,12,7,0.72)', 3.4, 24);
      strokeWob(ctx, -24, botY - 5, W + 24, botY - 5, 1.8, seed + plankIdx * 101 + 3, 'rgba(226,190,138,0.13)', 1.4, 24);
      strokeWob(ctx, -24, botY + 3, W + 24, botY + 3, 2.0, seed + plankIdx * 101 + 5, 'rgba(20,13,8,0.30)', 2.2, 24);

      // 木节
      if (rnd() < 0.42) {
        var kx = 90 + rnd() * (W - 180);
        var ky = y + 40 + rnd() * (ph - 90);
        var krx = 18 + rnd() * 26;
        var kry = krx * (0.45 + rnd() * 0.35);
        ctx.save();
        ctx.translate(kx, ky);
        ctx.scale(1, kry / krx);
        for (var ring = 0; ring < 6; ring++) {
          ctx.beginPath();
          ctx.arc(0, 0, krx * (0.18 + ring * 0.19), 0, TAU);
          ctx.strokeStyle = 'rgba(22,14,8,' + (0.22 - ring * 0.028).toFixed(3) + ')';
          ctx.lineWidth = 1.2 + ring * 0.25;
          ctx.stroke();
        }
        ctx.restore();
        softBlob(ctx, kx, ky, krx * 0.7, kry * 0.7, [30, 20, 11], 0.15);
      }
      // 板面小坑与磨损
      for (j = 0; j < 7; j++) {
        var px = rnd() * W, py = y + 12 + rnd() * (ph - 24);
        ctx.fillStyle = 'rgba(24,16,9,' + (0.10 + rnd() * 0.16).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(px, py, 0.5 + rnd() * 1.6, 0, TAU);
        ctx.fill();
      }
      y += ph;
      plankIdx++;
    }

    // 细划痕
    for (i = 0; i < 14; i++) {
      var sx = rnd() * W, sy = rnd() * H;
      grainStroke(ctx, sx, sy, sx + 60 + rnd() * 220, sy + (rnd() - 0.5) * 18, 1.0,
        seed + 900 + i * 13, 'rgba(220,190,146,' + (0.05 + rnd() * 0.07).toFixed(3) + ')',
        0.6 + rnd() * 0.8, 10);
    }
    // 局部污渍/水渍
    for (i = 0; i < 5; i++) {
      softBlob(ctx, rnd() * W, rnd() * H, 60 + rnd() * 140, 40 + rnd() * 110, [26, 17, 10], 0.08 + rnd() * 0.07);
    }

    // 漆面反光
    var sg = ctx.createLinearGradient(0, 0, W * 0.66, H * 0.9);
    sg.addColorStop(0, 'rgba(255,236,198,0.14)');
    sg.addColorStop(0.42, 'rgba(255,236,198,0.04)');
    sg.addColorStop(1, 'rgba(255,236,198,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function paintPlate(ctx, L) {
    var p = L.plate;
    softBlob(ctx, p.x + 34, p.y + 46, p.rx * 0.98, p.ry * 0.92, [18, 11, 6], 0.44);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot || 0);
    ctx.scale(1, p.ry / p.rx);
    blobPath(ctx, 0, 0, p.rx, p.rx, 811, 0.012, 96);
    var g = ctx.createRadialGradient(-p.rx * 0.30, -p.rx * 0.34, p.rx * 0.05, 0, 0, p.rx * 1.04);
    g.addColorStop(0, '#faf5e8');
    g.addColorStop(0.48, '#ece3ce');
    g.addColorStop(0.82, '#d9ccb2');
    g.addColorStop(1, '#b9a989');
    ctx.fillStyle = g;
    ctx.fill();
    // 盘沿受光（左上）
    ctx.beginPath();
    ctx.arc(0, 0, p.rx * 0.96, Math.PI * 0.92, Math.PI * 1.72);
    ctx.strokeStyle = 'rgba(255,253,244,0.40)';
    ctx.lineWidth = p.rx * 0.022;
    ctx.stroke();
    // 盘沿背光（右下）
    ctx.beginPath();
    ctx.arc(0, 0, p.rx * 0.975, -0.15, Math.PI * 0.78);
    ctx.strokeStyle = 'rgba(96,78,54,0.30)';
    ctx.lineWidth = p.rx * 0.026;
    ctx.stroke();
    // 盘心凹陷
    ctx.beginPath();
    ctx.arc(0, 0, p.rx * 0.82, 0, TAU);
    ctx.strokeStyle = 'rgba(120,100,74,0.20)';
    ctx.lineWidth = p.rx * 0.012;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, p.rx * 0.80, Math.PI * 0.95, Math.PI * 1.8);
    ctx.strokeStyle = 'rgba(255,250,238,0.22)';
    ctx.lineWidth = p.rx * 0.014;
    ctx.stroke();
    // 磕碰小缺口
    var rp = U.mulberry32(0x9a11);
    for (var i = 0; i < 6; i++) {
      var a = rp() * TAU;
      ctx.fillStyle = 'rgba(120,100,72,' + (0.10 + rp() * 0.16).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * p.rx * 0.955, Math.sin(a) * p.rx * 0.955, 1 + rp() * 3.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // 盘面污痕与油光
    softBlob(ctx, p.x + 70, p.y + 60, 150, 110, [128, 100, 62], 0.09);
    softBlob(ctx, p.x - 110, p.y + 120, 130, 90, [120, 96, 60], 0.06);
    softBlob(ctx, p.x + 10, p.y - 10, p.rx * 0.55, p.ry * 0.5, [255, 250, 236], 0.05);
  }

  function paintEgg(ctx, L, seed) {
    var e = L.egg;
    var yk = L.yolk;
    var i;
    softBlob(ctx, e.x + 14, e.y + 18, e.rx * 1.12, e.ry * 1.06, [58, 40, 22], 0.34);
    // 蛋白
    ctx.save();
    blobPath(ctx, e.x, e.y, e.rx, e.ry, seed + 31, 0.09, 88);
    var g = ctx.createRadialGradient(e.x - e.rx * 0.30, e.y - e.ry * 0.42, 8, e.x, e.y, e.rx * 1.3);
    g.addColorStop(0, '#fffdf7');
    g.addColorStop(0.42, '#f8f1e1');
    g.addColorStop(0.78, '#ecdfc6');
    g.addColorStop(1, '#d8c5a4');
    ctx.fillStyle = g;
    ctx.fill();
    // 蛋白下缘的厚度阴影（让白不再和白纸糊在一起）
    blobPath(ctx, e.x, e.y, e.rx, e.ry, seed + 31, 0.09, 88);
    ctx.clip();
    var wsh = ctx.createLinearGradient(0, e.y - e.ry * 0.25, 0, e.y + e.ry * 1.05);
    wsh.addColorStop(0, 'rgba(120,100,68,0)');
    wsh.addColorStop(0.7, 'rgba(120,100,68,0.10)');
    wsh.addColorStop(1, 'rgba(120,100,68,0.26)');
    ctx.fillStyle = wsh;
    ctx.fillRect(e.x - e.rx, e.y - e.ry, e.rx * 2, e.ry * 2);
    // 蛋白厚度（边缘暗）
    blobPath(ctx, e.x, e.y, e.rx, e.ry, seed + 31, 0.09, 88);
    ctx.strokeStyle = 'rgba(118,92,58,0.20)';
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.restore();

    // 焦边：右下侧一圈短促的褐色笔触
    var rc = U.mulberry32(seed + 611);
    var n = 34;
    for (i = 0; i < n; i++) {
      var a = -0.25 + (i / n) * 2.2;
      var kk = 1 + (U.fbm1(i * 0.37 + seed * 0.01, 2, seed + 611) - 0.5) * 0.16;
      var bx = e.x + Math.cos(a) * e.rx * kk;
      var by = e.y + Math.sin(a) * e.ry * kk;
      var tx = -Math.sin(a), ty = Math.cos(a);
      var len = 6 + rc() * 16;
      ctx.strokeStyle = 'rgba(132,84,34,' + (0.25 + rc() * 0.40).toFixed(3) + ')';
      ctx.lineWidth = 1.6 + rc() * 4.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx - tx * len * 0.4, by - ty * len * 0.4);
      ctx.lineTo(bx + tx * len * 0.6, by + ty * len * 0.6);
      ctx.stroke();
      if (rc() < 0.4) {
        ctx.fillStyle = 'rgba(120,74,30,' + (0.2 + rc() * 0.3).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(bx + tx * len * 0.8, by + ty * len * 0.8, 0.8 + rc() * 2.2, 0, TAU);
        ctx.fill();
      }
    }

    // 蛋黄影
    softBlob(ctx, yk.x + 8, yk.y + 12, yk.r * 1.16, yk.r * 1.1, [112, 64, 20], 0.36);
    // 蛋黄
    ctx.save();
    ctx.translate(yk.x, yk.y);
    blobPath(ctx, 0, 0, yk.r, yk.r * 0.95, seed + 133, 0.075, 64);
    var yg = ctx.createRadialGradient(-yk.r * 0.3, -yk.r * 0.34, yk.r * 0.08, 0, 0, yk.r * 1.08);
    yg.addColorStop(0, '#f8cc68');
    yg.addColorStop(0.5, '#e9ab3e');
    yg.addColorStop(0.88, '#d18a2c');
    yg.addColorStop(1, '#b97522');
    ctx.fillStyle = yg;
    ctx.fill();
    // 边缘暗环（下侧）
    ctx.beginPath();
    ctx.arc(0, 0, yk.r * 0.93, 0.3, 2.0);
    ctx.strokeStyle = 'rgba(150,86,24,0.28)';
    ctx.lineWidth = yk.r * 0.07;
    ctx.stroke();
    // 小斑点
    var rk = U.mulberry32(seed + 77);
    for (i = 0; i < 5; i++) {
      ctx.fillStyle = 'rgba(190,120,40,' + (0.10 + rk() * 0.12).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc((rk() - 0.5) * yk.r * 1.2, (rk() - 0.5) * yk.r * 1.1, 2 + rk() * 6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    softBlob(ctx, yk.x - yk.r * 0.32, yk.y - yk.r * 0.4, yk.r * 0.3, yk.r * 0.22, [255, 248, 220], 0.8);
    softBlob(ctx, yk.x + yk.r * 0.26, yk.y + yk.r * 0.34, yk.r * 0.44, yk.r * 0.3, [150, 80, 20], 0.2);
    // 蛋白上的碎屑
    var r = U.mulberry32(seed + 411);
    for (i = 0; i < 10; i++) {
      var ang2 = r() * TAU, dist = e.rx * (0.85 + r() * 0.5);
      var cx = e.x + Math.cos(ang2) * dist;
      var cy = e.y + Math.sin(ang2) * dist * 0.8;
      ctx.fillStyle = 'rgba(104,74,40,' + (0.2 + r() * 0.32).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, 0.8 + r() * 3, 0, TAU);
      ctx.fill();
    }
  }

  function paintGlass(ctx, L, seed) {
    var G = L.glass;
    var x = G.x, top = G.top, h = G.h, tw = G.topW, bw = G.botW;
    var rimRy = 20;
    softBlob(ctx, x + 36, top + h * 0.7, tw * 0.86, h * 0.42, [20, 13, 8], 0.32);

    function bodyPath() {
      ctx.beginPath();
      ctx.moveTo(x - tw / 2, top);
      ctx.lineTo(x - bw / 2, top + h - rimRy);
      ctx.quadraticCurveTo(x, top + h + rimRy * 0.8, x + bw / 2, top + h - rimRy);
      ctx.lineTo(x + tw / 2, top);
      ctx.closePath();
    }

    ctx.save();
    bodyPath();
    ctx.clip();
    var bg = ctx.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
    bg.addColorStop(0, 'rgba(250,248,238,0.52)');
    bg.addColorStop(0.08, 'rgba(222,216,198,0.28)');
    bg.addColorStop(0.5, 'rgba(200,195,176,0.14)');
    bg.addColorStop(0.85, 'rgba(160,150,128,0.22)');
    bg.addColorStop(1, 'rgba(236,231,214,0.40)');
    ctx.fillStyle = bg;
    ctx.fillRect(x - tw, top - 30, tw * 2, h + 80);

    var milkTop = top + h * G.milk;
    var mg = ctx.createLinearGradient(0, milkTop, 0, top + h);
    mg.addColorStop(0, '#f4ead4');
    mg.addColorStop(0.14, '#eadfc4');
    mg.addColorStop(1, '#d5c5a2');
    ctx.fillStyle = mg;
    ctx.fillRect(x - tw, milkTop, tw * 2, h + 40);

    // 液面
    ctx.save();
    ctx.translate(x, milkTop);
    ctx.scale(tw / 2 - 7, 15);
    var sg = ctx.createRadialGradient(-0.3, -0.3, 0, 0, 0, 1);
    sg.addColorStop(0, '#fbf4e1');
    sg.addColorStop(1, '#e1d2b0');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    // 液面下暗影
    softBlob(ctx, x, milkTop + 28, tw * 0.42, 26, [120, 94, 58], 0.16);

    // 竖直高光
    var hg = ctx.createLinearGradient(x - tw * 0.36, 0, x - tw * 0.16, 0);
    hg.addColorStop(0, 'rgba(255,255,246,0)');
    hg.addColorStop(0.5, 'rgba(255,255,246,0.20)');
    hg.addColorStop(1, 'rgba(255,255,246,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(x - tw * 0.36, top + 8, tw * 0.2, h);
    // 右侧暗边
    var dg = ctx.createLinearGradient(x + tw * 0.28, 0, x + tw * 0.5, 0);
    dg.addColorStop(0, 'rgba(70,58,40,0)');
    dg.addColorStop(1, 'rgba(70,58,40,0.20)');
    ctx.fillStyle = dg;
    ctx.fillRect(x + tw * 0.28, top, tw * 0.24, h + 10);
    ctx.restore();

    // 杯口
    ctx.beginPath();
    ctx.ellipse(x, top, tw / 2, rimRy, 0, 0, TAU);
    ctx.fillStyle = 'rgba(96,84,66,0.14)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, top, tw / 2, rimRy, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(252,248,236,0.42)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, top + 3, tw / 2 - 5, rimRy - 3, 0, 0, Math.PI);
    ctx.strokeStyle = 'rgba(255,253,245,0.30)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 杯底
    ctx.beginPath();
    ctx.ellipse(x, top + h - rimRy, bw / 2, rimRy * 0.8, 0, 0, Math.PI);
    ctx.strokeStyle = 'rgba(250,244,230,0.30)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 桌面焦散
    softBlob(ctx, x + 10, top + h + 18, tw * 0.52, 24, [255, 238, 200], 0.16);
  }

  function paintCrumbs(ctx, L, seed) {
    var r = U.mulberry32(seed + 909);
    for (var i = 0; i < 14; i++) {
      var a = r() * TAU;
      var d = 300 + r() * 190;
      var x = L.plate.x + Math.cos(a) * d;
      var y = L.plate.y + Math.sin(a) * d * 0.82;
      ctx.fillStyle = 'rgba(60,44,26,' + (0.10 + r() * 0.20).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + r() * 2.6, 0, TAU);
      ctx.fill();
    }
  }

  function paintMorningLight(ctx, L) {
    var b = L.beam;
    function beam(alpha, width, offset) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(b.x + offset, b.y);
      ctx.rotate(b.angle);
      var g = ctx.createLinearGradient(0, -width, 0, width);
      g.addColorStop(0, 'rgba(255,226,168,0)');
      g.addColorStop(0.3, 'rgba(255,224,168,' + (alpha * 0.55).toFixed(3) + ')');
      g.addColorStop(0.5, 'rgba(255,236,194,' + alpha.toFixed(3) + ')');
      g.addColorStop(0.7, 'rgba(255,224,168,' + (alpha * 0.55).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,226,168,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-240, -width, 2000, width * 2);
      ctx.restore();
    }
    beam(0.135, 330, 0);
    beam(0.10, 128, 62);
    // 光束里的浮尘（极少量）
    var r = U.mulberry32(0x1eaf);
    for (var i = 0; i < 9; i++) {
      var t = 0.15 + r() * 0.7;
      var x = b.x + 140 + t * 560 + (r() - 0.5) * 60;
      var y = -40 + t * 900 + (r() - 0.5) * 60;
      ctx.fillStyle = 'rgba(255,244,214,' + (0.10 + r() * 0.16).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + r() * 1.8, 0, TAU);
      ctx.fill();
    }
  }

  /* ============================================================
   *  第 2 个：雨声录音（墨迹波形）
   * ============================================================ */
  function scene2(ctx, seed, rnd) {
    var L = layout(2);
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#ece3d2');
    g.addColorStop(0.5, '#e5dac6');
    g.addColorStop(1, '#d7cbb4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var i;
    for (i = 0; i < 10; i++) {
      var bx = rnd() * W, by = rnd() * H, br = 220 + rnd() * 380;
      softBlob(ctx, bx, by, br, br * (0.45 + rnd() * 0.5), rnd() < 0.5 ? [255, 250, 238] : [186, 172, 148], 0.07 + rnd() * 0.06);
    }
    // 纸张横向纤维（像旧纸带）
    ctx.save();
    for (i = 0; i < 240; i++) {
      var fy = rnd() * H;
      var fx = rnd() * W;
      ctx.strokeStyle = 'rgba(120,108,88,' + (0.02 + rnd() * 0.045).toFixed(3) + ')';
      ctx.lineWidth = 0.6 + rnd() * 0.8;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + 40 + rnd() * 260, fy + (rnd() - 0.5) * 3);
      ctx.stroke();
    }
    ctx.restore();

    paintInkWave(ctx, L, seed, rnd);

    // 四角的化学污渍
    softBlob(ctx, 60, 70, 190, 150, [120, 92, 56], 0.10);
    softBlob(ctx, W - 60, H - 80, 210, 170, [110, 84, 50], 0.09);
    softBlob(ctx, W - 110, 90, 150, 120, [130, 104, 66], 0.06);

    return {
      blur: [2],
      bloom: 0.05,
      leak: { x: W + 80, y: H * 0.18, r: 760, rgb: [255, 174, 92], a: 0.14 },
      vignette: 0.86,
      grain: 1.12,
      edge: { side: 'bottom', a: 0.10, w: 90 },
      focus: { x: W * 0.10, y: H * 0.88, r: 380, f: 3 }
    };
  }

  function paintInkWave(ctx, L, seed, rnd) {
    var span = L.x1 - L.x0;
    var step = 2.4;
    var N = Math.max(8, Math.round(span / step));
    var mid = L.cy;
    var i, j, k;

    // 4 秒的人声/雨声轮廓：3–4 段声部起伏 + 两段接近静音
    var br = U.mulberry32((seed + 77) >>> 0);
    var swells = [
      { c: 0.135 + br() * 0.02, w: 0.058 + br() * 0.014, a: 0.78 },
      { c: 0.400 + br() * 0.02, w: 0.074 + br() * 0.016, a: 0.94 },
      { c: 0.700 + br() * 0.02, w: 0.070 + br() * 0.016, a: 0.72 },
      { c: 0.870 + br() * 0.015, w: 0.046 + br() * 0.012, a: 0.40 }
    ];
    var quiet = [
      { c: 0.262 + br() * 0.02, w: 0.022 + br() * 0.008 },
      { c: 0.565 + br() * 0.024, w: 0.026 + br() * 0.008 }
    ];
    function env(t) {
      var e = 0.018 + 0.03 * U.fbm1(t * 3.1 + 2.7, 2, seed + 501);
      for (var s = 0; s < swells.length; s++) {
        var d = (t - swells[s].c) / swells[s].w;
        e += swells[s].a * Math.exp(-d * d);
      }
      // 语音/雨点的毛糙起伏（让包络边缘不光滑）
      e *= 0.74 + 0.40 * U.fbm1(t * 15.3 + 1.9, 3, seed + 77);
      for (s = 0; s < quiet.length; s++) {
        var dq = Math.abs(t - quiet[s].c) / quiet[s].w;
        if (dq < 1) e *= 0.02 + 0.98 * U.smoothstep(0, 1, dq);
      }
      // 两端淡出：开头 5%，结尾 8%
      e *= U.smoothstep(0, 0.05, t) * (1 - U.smoothstep(0.92, 1, t));
      return Math.max(0, Math.min(1, e));
    }

    // 逐列采样：x 每 2.4px 一列，上下严格镜像
    var cols = [];
    for (i = 0; i <= N; i++) {
      var t = i / N;
      var e = env(t);
      var x = L.x0 + t * span;
      var amp = L.halfMax * e * (0.92 + 0.14 * U.hash2(i, 3, seed));
      // 端点毛糙：让它多伸或少伸 1–4px
      amp += (U.hash2(i, 7, seed) - 0.5) * 2 * (1.2 + 4.5 * e);
      cols.push({
        x: x,
        a: amp > 2 ? amp : 0,
        e: e,
        h1: U.hash2(i, 11, seed),
        h2: U.hash2(i, 13, seed),
        h3: U.hash2(i, 17, seed)
      });
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (i = 0; i <= N; i++) {
      var c = cols[i];
      if (c.a <= 0) continue;                    // 静音/淡出区：留白，只有轴线
      var loud = Math.min(1, c.a / (L.halfMax * 0.8));
      // 弱音处要虚、要断
      if (loud < 0.26 && c.h1 < 0.34) continue;
      var xj = (c.h3 - 0.5) * 1.2;
      var x = c.x + xj;
      var wMain = 1.5 + 1.6 * loud;              // 1.5–3px
      var alpha = (0.24 + 0.58 * loud) * (loud < 0.26 ? 0.72 : 1);
      // 主笔：一条从 mid-A 到 mid+A 的竖线（严格镜像）
      ctx.strokeStyle = 'rgba(46,36,27,' + Math.min(0.90, alpha).toFixed(3) + ')';
      ctx.lineWidth = wMain;
      ctx.beginPath();
      ctx.moveTo(x, mid - c.a);
      ctx.lineTo(x, mid + c.a);
      ctx.stroke();
      // 第二笔：错位 1–2px 的棕边（弱音处省略，避免糊成一片灰）
      if (loud > 0.22 && c.h2 < 0.82) {
        var ox = (c.h2 - 0.5) * 3.0;
        ctx.strokeStyle = 'rgba(94,70,46,' + (0.07 + 0.17 * loud).toFixed(3) + ')';
        ctx.lineWidth = wMain + 1.6;
        ctx.beginPath();
        ctx.moveTo(x + ox, mid - c.a + 2);
        ctx.lineTo(x + ox, mid + c.a - 2);
        ctx.stroke();
      }
      // 第三笔：很淡的渗墨，让边缘不齐
      if (loud > 0.30 && c.h3 < 0.55) {
        var ox2 = (c.h3 - 0.5) * 4.6;
        ctx.strokeStyle = 'rgba(58,45,33,' + (0.04 + 0.08 * loud).toFixed(3) + ')';
        ctx.lineWidth = 1.2 + loud;
        ctx.beginPath();
        ctx.moveTo(x + ox2, mid - c.a - 1.5);
        ctx.lineTo(x + ox2, mid + c.a + 1.5);
        ctx.stroke();
      }
      // 强音处的钝口/墨团
      if (loud > 0.58 && c.h1 < 0.36) {
        ctx.fillStyle = 'rgba(44,34,25,' + (0.34 + c.h2 * 0.3).toFixed(3) + ')';
        var rr = 1.1 + loud * 2.3;
        ctx.beginPath();
        ctx.arc(c.x, mid - c.a, rr, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(c.x, mid + c.a, rr * 0.88, 0, TAU);
        ctx.fill();
      }
    }

    // 飞溅墨点：每 20–40 列 1 个，偏离端点 10–30px
    var sp = U.mulberry32((seed + 999) >>> 0);
    var next = 14;
    while (next < N) {
      var cc = cols[next];
      if (cc.a > 22) {
        var side = sp() < 0.6 ? -1 : 1;
        var off = 10 + sp() * sp() * 30;
        var sx = cc.x + (sp() - 0.5) * 10;
        var sy = mid + side * (cc.a + off);
        ctx.fillStyle = 'rgba(42,32,24,' + (0.22 + sp() * 0.5).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(sx, sy, 0.8 + sp() * sp() * 4.0, 0, TAU);
        ctx.fill();
        for (j = 0; j < 2; j++) {
          if (sp() < 0.55) continue;
          ctx.fillStyle = 'rgba(42,32,24,' + (0.14 + sp() * 0.26).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(sx + (sp() - 0.5) * 22, sy + (sp() - 0.5) * 14, 0.6 + sp() * 1.4, 0, TAU);
          ctx.fill();
        }
      }
      next += 20 + Math.floor(sp() * 22);
    }

    // 静音段里只留 1–2 个墨点
    for (k = 0; k < quiet.length; k++) {
      for (j = 0; j < 1 + (k % 2); j++) {
        var qx = L.x0 + (quiet[k].c + (U.hash2(k, j, seed) - 0.5) * 0.03) * span;
        ctx.fillStyle = 'rgba(44,34,25,' + (0.20 + U.hash2(k, j + 3, seed) * 0.22).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(qx, mid + (U.hash2(k, j + 7, seed) - 0.5) * 10, 0.9 + U.hash2(k, j + 11, seed) * 1.6, 0, TAU);
        ctx.fill();
      }
    }

    // 中线（轴）
    strokeWob(ctx, L.x0 - 24, mid, L.x1 + 24, mid, 0.8, seed + 42, 'rgba(48,38,28,0.30)', 1.0, 48);
    ctx.fillStyle = 'rgba(48,38,28,0.38)';
    ctx.beginPath(); ctx.arc(L.x0 - 24, mid, 1.8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(L.x1 + 24, mid, 1.8, 0, TAU); ctx.fill();
  }

  /* ============================================================
   *  第 3 个：未发送的消息
   * ============================================================ */
  function scene3(ctx, seed, rnd) {
    var L = layout(3);
    var g = ctx.createRadialGradient(W * 0.34, H * 0.30, 60, W * 0.5, H * 0.48, H * 0.95);
    g.addColorStop(0, '#f3ecde');
    g.addColorStop(0.45, '#e8dfcc');
    g.addColorStop(0.8, '#d5cab4');
    g.addColorStop(1, '#bfb299');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var i;
    for (i = 0; i < 9; i++) {
      softBlob(ctx, rnd() * W, rnd() * H, 180 + rnd() * 360, 140 + rnd() * 300,
        rnd() < 0.5 ? [255, 252, 242] : [180, 166, 142], 0.04 + rnd() * 0.05);
    }
    // 特写级纤维
    ctx.save();
    for (i = 0; i < 620; i++) {
      var fx = rnd() * W, fy = rnd() * H;
      var len = 10 + rnd() * 70;
      var ang = (rnd() - 0.5) * 0.5;
      var light = rnd() < 0.5;
      ctx.strokeStyle = light
        ? 'rgba(255,253,244,' + (0.06 + rnd() * 0.10).toFixed(3) + ')'
        : 'rgba(130,116,96,' + (0.035 + rnd() * 0.06).toFixed(3) + ')';
      ctx.lineWidth = 0.5 + rnd() * 1.0;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(ang) * len, fy + Math.sin(ang) * len + (rnd() - 0.5) * 6);
      ctx.stroke();
    }
    ctx.restore();
    // 折痕
    for (i = 0; i < 2; i++) {
      var y0 = 260 + i * 640 + rnd() * 100;
      strokeWob(ctx, -40, y0, W + 40, y0 + 40 + rnd() * 50, 12, seed + 300 + i * 17, 'rgba(255,252,242,0.12)', 2.6, 26);
      strokeWob(ctx, -40, y0 + 2, W + 40, y0 + 42 + rnd() * 50, 12, seed + 301 + i * 17, 'rgba(120,102,80,0.07)', 1.4, 26);
    }
    // 一边的阴影（光从左上进来）+ 左上一点亮
    var sh = ctx.createLinearGradient(W * 0.5, H * 0.1, W * 1.02, H * 0.96);
    sh.addColorStop(0, 'rgba(90,72,52,0)');
    sh.addColorStop(0.6, 'rgba(90,72,52,0.08)');
    sh.addColorStop(1, 'rgba(90,72,52,0.18)');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    softBlob(ctx, W * 0.28, H * 0.2, 520, 400, [255, 250, 234], 0.07);

    // 输入框
    ctx.save();
    U.roundRect(ctx, L.box.x, L.box.y, L.box.w, L.box.h, L.box.r);
    ctx.fillStyle = 'rgba(255,253,246,0.34)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,58,46,0.30)';
    ctx.lineWidth = 1.1;
    U.roundRect(ctx, L.box.x, L.box.y, L.box.w, L.box.h, L.box.r);
    ctx.stroke();
    // 底线（比边框重一点，略手抖）
    strokeWob(ctx, L.underline.x0, L.underline.y, L.underline.x1, L.underline.y, 0.7, seed + 55, 'rgba(56,44,34,0.58)', 1.9, 44);
    ctx.restore();

    return {
      blur: [2],
      bloom: 0.04,
      leak: { x: W * 0.92, y: H * 1.02, r: 720, rgb: [255, 186, 110], a: 0.14 },
      vignette: 1.06,
      grain: 1.0,
      edge: { side: 'right', a: 0.12, w: 120 },
      focus: { x: W * 0.86, y: H * 0.90, r: 420, f: 3 }
    };
  }

  /* ============================================================
   *  第 4 个：生日录像
   * ============================================================ */
  function scene4(ctx, seed, rnd) {
    var L = layout(4);
    var A = assets();
    var i;
    // 不是纯黑：低码率视频的暗部是发灰的暖棕
    var g = ctx.createLinearGradient(0, 0, W * 0.34, H);
    g.addColorStop(0, '#2c231a');
    g.addColorStop(0.32, '#3d2f22');
    g.addColorStop(0.66, '#2a2017');
    g.addColorStop(1, '#1a130d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 模糊的门框/墙
    ctx.fillStyle = 'rgba(20, 15, 10, 0.45)';
    ctx.fillRect(W * 0.85, 0, W * 0.15, H);
    softBlob(ctx, W * 0.88, H * 0.4, 170, 520, [14, 10, 7], 0.45);
    softBlob(ctx, W * 0.45, H * 0.98, W * 0.75, H * 0.2, [18, 13, 8], 0.50);

    // 暖雾（把暗部抬起来一点）
    softBlob(ctx, L.haze.x, L.haze.y, L.haze.r, L.haze.r * 0.85, [255, 178, 106], 0.22);
    softBlob(ctx, 430, 700, 330, 260, [255, 200, 136], 0.14);
    softBlob(ctx, 520, 840, 420, 200, [255, 186, 120], 0.08);

    // 蛋糕与三根蜡烛（剪影轮廓要能读出来）
    ctx.save();
    // 海绵蛋糕体（比盘子暗）
    ctx.fillStyle = 'rgba(58, 38, 20, 0.86)';
    ctx.beginPath();
    ctx.ellipse(436, 858, 206, 76, 0, 0, TAU);
    ctx.fill();
    softBlob(ctx, 436, 898, 196, 34, [28, 18, 10], 0.50);
    // 奶油顶面
    ctx.fillStyle = 'rgba(238, 210, 162, 0.36)';
    ctx.beginPath();
    ctx.ellipse(436, 810, 186, 44, 0, 0, TAU);
    ctx.fill();
    softBlob(ctx, 436, 806, 176, 24, [255, 228, 176], 0.20);
    softBlob(ctx, 436, 826, 176, 20, [96, 62, 30], 0.24);
    // 蜡烛
    ctx.fillStyle = 'rgba(70, 46, 24, 0.62)';
    for (i = 0; i < L.glows.length; i++) {
      ctx.fillRect(L.glows[i].x - 6, L.glows[i].y + 12, 12, 806 - (L.glows[i].y + 12));
    }
    ctx.restore();

    // 三团烛光 + 火苗
    for (i = 0; i < L.glows.length; i++) {
      var gl = L.glows[i];
      softBlob(ctx, gl.x, gl.y, gl.r, gl.r, gl.rgb, 0.38 * gl.a);
      softBlob(ctx, gl.x, gl.y, gl.r * 0.45, gl.r * 0.45, [255, 234, 196], 0.50 * gl.a);
      softBlob(ctx, gl.x, gl.y, gl.r * 0.14, gl.r * 0.14, [255, 250, 235], 0.70 * gl.a);
      // 火苗：小竖椭圆 + 亮芯
      softBlob(ctx, gl.x, gl.y - 10, gl.r * 0.085, gl.r * 0.20, [255, 242, 214], 0.70 * gl.a);
      softBlob(ctx, gl.x, gl.y - 18, gl.r * 0.045, gl.r * 0.12, [255, 254, 245], 0.90 * gl.a);
    }

    // 静态人影（动态层会再叠一层会动的，形成虚影）
    for (i = 0; i < L.sil.length; i++) {
      var s = L.sil[i];
      var spr = i === 0 ? A.sil1 : A.sil2;
      var sw = spr.width * s.s, sh = spr.height * s.s;
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.drawImage(spr, s.x - sw / 2, s.y - sh, sw, sh);
      ctx.restore();
    }

    return {
      blur: [3, 2],
      motion: 3,
      bloom: 0.32,
      leak: { x: W * 1.05, y: -120, r: 900, rgb: [255, 156, 74], a: 0.26 },
      vignette: 1.0,
      grain: 1.20,
      chromaNoise: true,
      edge: { side: 'bottom', a: 0.10, w: 100 },
      focus: { x: W * 0.12, y: H * 0.9, r: 420, f: 3 },
      post: function (ctx2) { paintPlayButton(ctx2, L.play); }
    };
  }

  function paintPlayButton(ctx, p) {
    // 暗底衬托，保证播放键在亮光前也看得见
    softBlob(ctx, p.x, p.y, p.r * 1.7, p.r * 1.7, [12, 9, 6], 0.30);
    ctx.save();
    ctx.strokeStyle = 'rgba(246,239,224,0.66)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(246,239,224,0.68)';
    ctx.beginPath();
    ctx.moveTo(p.x - p.r * 0.30, p.y - p.r * 0.42);
    ctx.lineTo(p.x + p.r * 0.46, p.y);
    ctx.lineTo(p.x - p.r * 0.30, p.y + p.r * 0.42);
    ctx.closePath();
    ctx.fill();
    // 轻微模糊，像视频 UI
    ctx.restore();
  }

  /* ============================================================
   *  第 5 个：搜索记录
   * ============================================================ */
  function scene5(ctx, seed, rnd) {
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#eee5d4');
    g.addColorStop(0.5, '#e3d9c5');
    g.addColorStop(1, '#d3c7b0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var i;
    for (i = 0; i < 10; i++) {
      softBlob(ctx, rnd() * W, rnd() * H, 170 + rnd() * 380, 130 + rnd() * 300,
        rnd() < 0.5 ? [255, 252, 242] : [178, 164, 140], 0.04 + rnd() * 0.05);
    }
    // 纤维
    ctx.save();
    for (i = 0; i < 360; i++) {
      var fx = rnd() * W, fy = rnd() * H;
      var len = 8 + rnd() * 44;
      var ang = (rnd() - 0.5) * 0.55;
      ctx.strokeStyle = rnd() < 0.5
        ? 'rgba(255,253,244,' + (0.05 + rnd() * 0.09).toFixed(3) + ')'
        : 'rgba(130,116,96,' + (0.03 + rnd() * 0.05).toFixed(3) + ')';
      ctx.lineWidth = 0.5 + rnd() * 0.9;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(ang) * len, fy + Math.sin(ang) * len + (rnd() - 0.5) * 4);
      ctx.stroke();
    }
    ctx.restore();
    // 折痕与斜向斜光
    strokeWob(ctx, -60, 1080, W + 60, 1010, 10, seed + 41, 'rgba(255,252,242,0.10)', 2.4, 28);
    strokeWob(ctx, -60, 1083, W + 60, 1013, 10, seed + 43, 'rgba(118,100,78,0.06)', 1.4, 28);
    softBlob(ctx, W * 0.18, H * 0.12, 520, 400, [255, 248, 232], 0.08);
    // 角落水渍
    softBlob(ctx, 46, H - 60, 200, 170, [122, 94, 58], 0.08);
    softBlob(ctx, W - 40, 70, 170, 140, [122, 94, 58], 0.06);
    // 光从左上进来，右下压暗
    softBlob(ctx, W * 0.2, H * 0.14, 560, 430, [255, 250, 234], 0.12);
    var sh5 = ctx.createLinearGradient(0, 0, W * 0.95, H);
    sh5.addColorStop(0, 'rgba(90,72,52,0)');
    sh5.addColorStop(0.55, 'rgba(90,72,52,0.06)');
    sh5.addColorStop(1, 'rgba(90,72,52,0.17)');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = sh5;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    return {
      blur: [2],
      bloom: 0.03,
      leak: { x: W * 0.05, y: H * 1.04, r: 740, rgb: [255, 188, 116], a: 0.12 },
      vignette: 0.92,
      grain: 1.02,
      edge: { side: 'left', a: 0.10, w: 100 },
      focus: { x: W * 0.10, y: H * 0.10, r: 380, f: 3 }
    };
  }

  /* ============================================================
   *  第 6 个：闹钟
   * ============================================================ */
  function scene6(ctx, seed, rnd) {
    var L = layout(6);
    var g = ctx.createRadialGradient(W * 0.42, H * 0.36, 80, W * 0.5, H * 0.5, H);
    g.addColorStop(0, '#f5efe2');
    g.addColorStop(0.5, '#ece3d0');
    g.addColorStop(0.85, '#d9cdb6');
    g.addColorStop(1, '#c8bba1');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var i;
    for (i = 0; i < 9; i++) {
      softBlob(ctx, rnd() * W, rnd() * H, 190 + rnd() * 360, 150 + rnd() * 300,
        rnd() < 0.5 ? [255, 252, 242] : [176, 162, 138], 0.035 + rnd() * 0.045);
    }
    ctx.save();
    for (i = 0; i < 340; i++) {
      var fx = rnd() * W, fy = rnd() * H;
      var len = 8 + rnd() * 50;
      var ang = (rnd() - 0.5) * 0.6;
      ctx.strokeStyle = rnd() < 0.5
        ? 'rgba(255,253,244,' + (0.05 + rnd() * 0.08).toFixed(3) + ')'
        : 'rgba(130,116,96,' + (0.028 + rnd() * 0.05).toFixed(3) + ')';
      ctx.lineWidth = 0.5 + rnd() * 0.9;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(ang) * len, fy + Math.sin(ang) * len + (rnd() - 0.5) * 4);
      ctx.stroke();
    }
    ctx.restore();
    // 一道很淡的折痕
    strokeWob(ctx, -40, 300, W + 40, 260, 9, seed + 61, 'rgba(255,252,242,0.08)', 2, 26);
    strokeWob(ctx, -40, 303, W + 40, 263, 9, seed + 63, 'rgba(118,100,78,0.05)', 1.2, 26);
    // 左上光 / 右下暗
    softBlob(ctx, W * 0.22, H * 0.22, 560, 420, [255, 250, 234], 0.11);
    var sh6 = ctx.createLinearGradient(0, 0, W, H);
    sh6.addColorStop(0, 'rgba(80,64,46,0)');
    sh6.addColorStop(0.5, 'rgba(80,64,46,0.05)');
    sh6.addColorStop(1, 'rgba(80,64,46,0.16)');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = sh6;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // 大数字（只画数字，冒号在动态层；这里留一点极淡的底）
    var font = L.size + 'px ' + FONT_NUM;
    var digits = [['0', L.x0], ['7', L.x7], ['1', L.x1], ['0', L.x0b]];
    var r = U.mulberry32(seed + 606);
    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (i = 0; i < digits.length; i++) {
      ctx.save();
      ctx.translate(digits[i][1], L.base + (r() - 0.5) * 7);
      ctx.rotate((r() - 0.5) * 0.014);
      ctx.fillStyle = 'rgba(42,35,27,0.85)';
      ctx.fillText(digits[i][0], 0, 0);
      ctx.globalAlpha = 0.16;
      ctx.fillText(digits[i][0], 0.9, 0.8);
      ctx.restore();
    }
    // 冒号：bake 里只剩一层很淡的底，动态层负责呼吸
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = 'rgba(42,35,27,1)';
    ctx.beginPath();
    ctx.arc(L.colonX, L.colonTop, L.colonR, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(L.colonX, L.colonBot, L.colonR, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // 每天
    var mc = measureCtx();
    mc.font = '46px ' + FONT_SERIF;
    var wDay = mc.measureText('每天').width;
    drawCharText(ctx, '每天', (W - wDay) / 2, L.dayY, 46, FONT_SERIF, 'rgba(46,38,29,0.78)', seed + 11, 10, true);
    // 小字
    mc.font = '34px ' + FONT_HAND;
    var wNote = mc.measureText('起来给多肉浇水').width;
    drawCharText(ctx, '起来给多肉浇水', (W - wNote) / 2, L.noteY, 34, FONT_HAND, 'rgba(52,43,33,0.60)', seed + 12, 3, true);

    return {
      blur: [2],
      bloom: 0.04,
      leak: { x: W * 1.02, y: -100, r: 760, rgb: [255, 186, 110], a: 0.13 },
      vignette: 0.92,
      grain: 1.02,
      edge: { side: 'bottom', a: 0.10, w: 100 },
      focus: { x: W * 0.10, y: H * 0.90, r: 400, f: 3 }
    };
  }

  /* ============================================================
   *  第 7 个：购物车（黄色雨伞）
   * ============================================================ */
  function scene7(ctx, seed, rnd) {
    var L = layout(7);
    var g = ctx.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, '#9a8c76');
    g.addColorStop(0.5, '#80715c');
    g.addColorStop(1, '#5f5240');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var i;
    for (i = 0; i < 16; i++) {
      softBlob(ctx, rnd() * W, rnd() * H, 200 + rnd() * 420, 150 + rnd() * 320,
        rnd() < 0.5 ? [196, 182, 156] : [52, 42, 30], 0.05 + rnd() * 0.05);
    }
    // 墙面细纹
    ctx.save();
    for (i = 0; i < 40; i++) {
      var sx = rnd() * W, sy = rnd() * H;
      ctx.strokeStyle = 'rgba(255,244,222,' + (0.02 + rnd() * 0.04).toFixed(3) + ')';
      ctx.lineWidth = 0.6 + rnd() * 1.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 10 + rnd() * 80, sy + (rnd() - 0.5) * 20);
      ctx.stroke();
    }
    ctx.restore();
    // 顶部来光 + 右侧压暗
    softBlob(ctx, W * 0.22, -60, 640, 400, [255, 238, 206], 0.19);
    softBlob(ctx, W * 0.82, H * 0.2, 320, 520, [38, 30, 20], 0.15);
    // 地面
    softBlob(ctx, W * 0.5, H * 1.04, W * 0.85, H * 0.22, [40, 32, 23], 0.60);
    // 投影
    softBlob(ctx, L.cx + 64, L.rimY + 150, 390, 160, [26, 19, 12], 0.50);

    paintUmbrella(ctx, L, seed, rnd);

    return {
      blur: [3],
      bloom: 0.12,
      leak: { x: W * 1.06, y: H * 0.86, r: 820, rgb: [255, 168, 86], a: 0.18 },
      vignette: 1.02,
      grain: 1.05,
      edge: { side: 'right', a: 0.12, w: 110 },
      focus: { x: W * 0.5, y: H * 0.90, r: 440, f: 3 },
      // 便签文字放在柔焦之后画，保证缩到 312px 宽仍能读清
      post: function (c) {
        c.save();
        c.translate(L.text.x, L.text.y);
        c.rotate(L.text.rot);
        drawCharText(c, '已在购物车 3 年', 0, 0, L.text.size * 1.14, FONT_SERIF,
          'rgba(42,38,32,0.88)', seed + 77, 1.2, true);
        c.restore();
      }
    };
  }

  function paintUmbrella(ctx, L, seed, rnd) {
    var cx = L.cx, rimY = L.rimY, rx = L.rx, dip = L.dip;
    var apex = L.apex;
    var ryTop = rimY - apex.y;
    var rimPts = L.rimPts;
    var baseCol = [196, 166, 88];
    var i;

    function rimArc(reverse) {
      // 伞缘的海浪形：两根伞骨之间向伞顶收
      var k, a, b, mx, my;
      if (!reverse) {
        for (k = 0; k < 8; k++) {
          a = rimPts[k]; b = rimPts[k + 1];
          mx = (a.x + b.x) / 2; my = (a.y + b.y) / 2 - 16;
          ctx.quadraticCurveTo(mx, my, b.x, b.y);
        }
      } else {
        for (k = 7; k >= 0; k--) {
          a = rimPts[k + 1]; b = rimPts[k];
          mx = (a.x + b.x) / 2; my = (a.y + b.y) / 2 - 16;
          ctx.quadraticCurveTo(mx, my, b.x, b.y);
        }
      }
    }
    function domePath() {
      ctx.beginPath();
      ctx.moveTo(cx - rx, rimY);
      ctx.ellipse(cx, rimY, rx, ryTop, 0, Math.PI, TAU, false);
      rimArc(true);
      ctx.closePath();
    }

    ctx.save();
    domePath();
    var bg = ctx.createLinearGradient(cx, apex.y, cx, rimY + dip);
    bg.addColorStop(0, rgbStr(U.lerpRGB(baseCol, [255, 236, 180], 0.34)));
    bg.addColorStop(0.55, rgbStr(baseCol));
    bg.addColorStop(1, rgbStr(U.lerpRGB(baseCol, [92, 72, 34], 0.30)));
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();

    // 8 个扇区
    ctx.save();
    domePath();
    ctx.clip();
    for (i = 0; i < 8; i++) {
      var p0 = rimPts[i], p1 = rimPts[i + 1];
      var uc = -1 + (2 * i + 1) / 8;
      var lit = 1 + (-uc) * 0.15;
      var tone = L.goreTone[i] * lit;
      var col = U.lerpRGB(baseCol, [248, 226, 158], 0.10 + 0.14 * (1 - Math.abs(uc)));
      var cc = [col[0] * tone, col[1] * tone, col[2] * tone];
      ctx.beginPath();
      ctx.moveTo(apex.x, apex.y);
      ctx.lineTo(p0.x, p0.y);
      var mx = (p0.x + p1.x) / 2;
      var my = (p0.y + p1.y) / 2 - 20;
      ctx.quadraticCurveTo(mx, my, p1.x, p1.y);
      ctx.closePath();
      var gg = ctx.createLinearGradient(apex.x, apex.y, mx, my + 40);
      gg.addColorStop(0, rgbStr(U.lerpRGB(cc, [255, 246, 205], 0.26)));
      gg.addColorStop(0.5, rgbStr(cc));
      gg.addColorStop(1, rgbStr(U.lerpRGB(cc, [72, 54, 22], 0.34)));
      ctx.fillStyle = gg;
      ctx.fill();
      // 布纹：从伞顶向伞缘的细线
      for (var s = 0; s < 10; s++) {
        var f = (s + 0.5) / 10;
        var ex = p0.x + (p1.x - p0.x) * f;
        var ey = p0.y + (p1.y - p0.y) * f;
        ctx.strokeStyle = 'rgba(120,96,44,' + (0.05 + (s % 2) * 0.025).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(apex.x + (ex - apex.x) * 0.10, apex.y + (ey - apex.y) * 0.10);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }
    // 布面的横向织纹
    for (var wv = 0; wv < 6; wv++) {
      var wy = apex.y + (rimY - apex.y) * (0.32 + wv * 0.12);
      ctx.beginPath();
      ctx.moveTo(cx - rx, wy);
      ctx.quadraticCurveTo(cx, wy + 30, cx + rx, wy);
      ctx.strokeStyle = 'rgba(90,70,32,0.045)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    // 伞缘内侧的暗（布往下坠）
    var rimSh = ctx.createLinearGradient(0, rimY - 110, 0, rimY + dip);
    rimSh.addColorStop(0, 'rgba(60,44,18,0)');
    rimSh.addColorStop(1, 'rgba(60,44,18,0.28)');
    ctx.fillStyle = rimSh;
    ctx.fillRect(cx - rx - 10, rimY - 110, rx * 2 + 20, dip + 120);
    // 上部受光
    softBlob(ctx, cx - rx * 0.28, apex.y + 96, rx * 0.52, 150, [255, 240, 196], 0.18);
    // 右下阴影
    softBlob(ctx, cx + rx * 0.42, rimY - 40, rx * 0.46, 130, [64, 46, 18], 0.18);
    ctx.restore();

    // 伞骨
    ctx.save();
    domePath();
    ctx.clip();
    ctx.lineCap = 'round';
    for (i = 0; i <= 8; i++) {
      var p = rimPts[i];
      var qx = (apex.x + p.x) / 2 + (i - 4) * 1.4;
      var qy = (apex.y + p.y) / 2;
      ctx.beginPath();
      ctx.moveTo(apex.x, apex.y);
      ctx.quadraticCurveTo(qx, qy, p.x, p.y);
      ctx.strokeStyle = 'rgba(94, 72, 40, 0.50)';
      ctx.lineWidth = 3.0;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(apex.x + 1.5, apex.y + 3);
      ctx.quadraticCurveTo(qx + 1.5, qy, p.x + 1.5, p.y);
      ctx.strokeStyle = 'rgba(64, 46, 22, 0.20)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(apex.x - 1, apex.y + 2);
      ctx.quadraticCurveTo(qx - 1, qy, p.x - 1, p.y);
      ctx.strokeStyle = 'rgba(255, 240, 200, 0.15)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();

    // 伞缘（沿波浪边）
    ctx.beginPath();
    ctx.moveTo(rimPts[0].x, rimPts[0].y);
    rimArc(false);
    ctx.strokeStyle = 'rgba(86, 64, 34, 0.42)';
    ctx.lineWidth = 2.8;
    ctx.stroke();
    ctx.save();
    ctx.translate(0, -2);
    ctx.beginPath();
    ctx.moveTo(rimPts[0].x, rimPts[0].y);
    rimArc(false);
    ctx.strokeStyle = 'rgba(255, 238, 196, 0.12)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    // 伞骨端点
    for (i = 0; i < rimPts.length; i++) {
      ctx.fillStyle = 'rgba(70, 52, 26, 0.62)';
      ctx.beginPath();
      ctx.arc(rimPts[i].x, rimPts[i].y - 1, 3.4, 0, TAU);
      ctx.fill();
    }

    // 伞顶
    softBlob(ctx, apex.x - 8, apex.y + 10, 30, 26, [255, 238, 190], 0.22);
    ctx.beginPath();
    ctx.arc(apex.x, apex.y, 15, 0, TAU);
    ctx.fillStyle = '#4e3a22';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(apex.x, apex.y, 15, 0, TAU);
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.16)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 金属箍（伞面下露出的那一小截）
    var sx = cx, sy = rimY + dip + 2;
    var ey = L.handle.endY;
    softBlob(ctx, sx, sy + 6, 14, 20, [40, 30, 20], 0.35);
    ctx.save();
    ctx.fillStyle = '#6b6252';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 11, 15, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(232, 226, 206, 0.22)';
    ctx.beginPath();
    ctx.ellipse(sx - 3, sy - 3, 3, 6, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // J 形伞柄
    function handlePath() {
      ctx.beginPath();
      ctx.moveTo(sx, sy + 8);
      ctx.lineTo(sx - 4, ey);
      ctx.bezierCurveTo(sx - 6, ey + 40, sx - 66, ey + 52, sx - 76, ey + 8);
      ctx.bezierCurveTo(sx - 82, ey - 18, sx - 62, ey - 26, sx - 54, ey - 10);
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    handlePath();
    ctx.strokeStyle = 'rgba(30, 20, 12, 0.35)';
    ctx.lineWidth = 15;
    ctx.stroke();
    handlePath();
    ctx.strokeStyle = '#4a3220';
    ctx.lineWidth = 12;
    ctx.stroke();
    handlePath();
    ctx.strokeStyle = 'rgba(224, 194, 148, 0.22)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  /* ============================================================
   *  第 8 个：玩具钢琴
   * ============================================================ */
  function scene8(ctx, seed, rnd) {
    var L = layout(8);
    var g = ctx.createLinearGradient(0, 0, W * 0.45, H);
    g.addColorStop(0, '#7c7260');
    g.addColorStop(0.5, '#665c4c');
    g.addColorStop(1, '#473d30');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var i;
    for (i = 0; i < 9; i++) {
      softBlob(ctx, rnd() * W, rnd() * H, 200 + rnd() * 400, 150 + rnd() * 320,
        rnd() < 0.5 ? [172, 158, 134] : [40, 32, 22], 0.05 + rnd() * 0.05);
    }
    softBlob(ctx, W * 0.2, -80, 600, 360, [255, 240, 210], 0.13);
    // 桌面/地面
    softBlob(ctx, W * 0.5, H * 1.02, W * 0.8, H * 0.2, [30, 24, 17], 0.55);

    paintPianoBody(ctx, L, seed, rnd);
    paintPianoKeys(ctx, L, seed, rnd);
    paintPianoWear(ctx, L, seed, rnd);

    return {
      blur: [2],
      bloom: 0.08,
      leak: { x: -80, y: -120, r: 780, rgb: [255, 186, 110], a: 0.15 },
      vignette: 0.94,
      grain: 1.05,
      edge: { side: 'top', a: 0.08, w: 90 },
      focus: { x: W * 0.10, y: H * 0.10, r: 400, f: 3 }
    };
  }

  function wobRect(ctx, x, y, w, h, amp, seed) {
    var i, t, pts = [];
    for (i = 0; i <= 10; i++) { t = i / 10; pts.push([x + t * w, y + (U.fbm1(t * 2.4 + seed, 2, seed) - 0.5) * 2 * amp]); }
    for (i = 1; i <= 10; i++) { t = i / 10; pts.push([x + w + (U.fbm1(t * 2.2 + seed + 3, 2, seed + 3) - 0.5) * 2 * amp, y + t * h]); }
    for (i = 1; i <= 10; i++) { t = i / 10; pts.push([x + w - t * w, y + h + (U.fbm1(t * 2.3 + seed + 7, 2, seed + 7) - 0.5) * 2 * amp]); }
    for (i = 1; i <= 10; i++) { t = i / 10; pts.push([x + (U.fbm1(t * 2.1 + seed + 11, 2, seed + 11) - 0.5) * 2 * amp, y + h - t * h]); }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  function paintPianoBody(ctx, L, seed, rnd) {
    var C = L.case;
    var i;
    // 琴身投影
    softBlob(ctx, C.x + C.w * 0.52, C.y + C.h + 72, C.w * 0.64, 74, [24, 18, 13], 0.42);
    // 腿
    for (i = 0; i < L.legs.length; i++) {
      var lg = L.legs[i];
      wobRect(ctx, lg.x, lg.y, lg.w, lg.h, 1.2, seed + 21 + i * 7);
      var lgg = ctx.createLinearGradient(lg.x, 0, lg.x + lg.w, 0);
      lgg.addColorStop(0, '#6e4f30');
      lgg.addColorStop(0.5, '#553c24');
      lgg.addColorStop(1, '#3c2918');
      ctx.fillStyle = lgg;
      ctx.fill();
      ctx.fillStyle = 'rgba(240, 214, 168, 0.10)';
      ctx.fillRect(lg.x + 3, lg.y + 3, 3, lg.h - 6);
      softBlob(ctx, lg.x + lg.w / 2, lg.y + lg.h + 4, lg.w, 10, [22, 16, 11], 0.4);
    }

    // 琴身
    wobRect(ctx, C.x, C.y, C.w, C.h, 2.2, seed + 7);
    var wg = ctx.createLinearGradient(C.x, C.y, C.x, C.y + C.h);
    wg.addColorStop(0, '#7c5938');
    wg.addColorStop(0.45, '#6a4b2e');
    wg.addColorStop(1, '#4a3120');
    ctx.fillStyle = wg;
    ctx.fill();

    // 木纹（clip 在琴身里）
    ctx.save();
    wobRect(ctx, C.x, C.y, C.w, C.h, 2.2, seed + 7);
    ctx.clip();
    // 大块木色不匀
    var j;
    for (j = 0; j < 6; j++) {
      softBlob(ctx, C.x + rnd() * C.w, C.y + rnd() * C.h,
        120 + rnd() * 260, 90 + rnd() * 200,
        rnd() < 0.55 ? [176, 138, 90] : [48, 30, 16], 0.10 + rnd() * 0.10);
    }
    for (i = 0; i < 70; i++) {
      var gy = C.y + 8 + rnd() * (C.h - 16);
      var x0 = C.x + rnd() * 160 - 60;
      var x1 = x0 + 160 + rnd() * 700;
      var dark = rnd() < 0.62;
      grainStroke(ctx, x0, gy, x1, gy + (rnd() - 0.5) * 12, 1.4 + rnd() * 4.4,
        seed + 300 + i * 9, dark
          ? 'rgba(38, 24, 14, ' + (0.12 + rnd() * 0.14).toFixed(3) + ')'
          : 'rgba(228, 198, 148, ' + (0.06 + rnd() * 0.09).toFixed(3) + ')',
        0.8 + rnd() * 2.0, 18);
    }
    // 大木纹的深色带
    for (j = 0; j < 4; j++) {
      grainStroke(ctx, C.x - 20, C.y + 40 + rnd() * (C.h - 80), C.x + C.w + 20,
        C.y + 40 + rnd() * (C.h - 80), 3 + rnd() * 6, seed + 700 + j * 31,
        'rgba(30, 18, 10, ' + (0.08 + rnd() * 0.10).toFixed(3) + ')', 3 + rnd() * 4, 20);
    }
    // 左上方进来的一点窗光
    var lightG = ctx.createLinearGradient(C.x, C.y, C.x + C.w * 0.65, C.y + C.h);
    lightG.addColorStop(0, 'rgba(255, 232, 190, 0.16)');
    lightG.addColorStop(0.5, 'rgba(255, 232, 190, 0.03)');
    lightG.addColorStop(1, 'rgba(255, 232, 190, 0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = lightG;
    ctx.fillRect(C.x, C.y, C.w, C.h);
    ctx.restore();
    // 顶盖
    var lidG = ctx.createLinearGradient(0, L.lid.y0, 0, L.lid.y1);
    lidG.addColorStop(0, 'rgba(158, 120, 78, 0.42)');
    lidG.addColorStop(1, 'rgba(88, 60, 36, 0.30)');
    ctx.fillStyle = lidG;
    ctx.fillRect(C.x, L.lid.y0, C.w, L.lid.y1 - L.lid.y0);
    // 面板
    var nbG = ctx.createLinearGradient(0, L.nameboard.y0, 0, L.nameboard.y1);
    nbG.addColorStop(0, 'rgba(52, 36, 22, 0.18)');
    nbG.addColorStop(0.5, 'rgba(78, 55, 33, 0.10)');
    nbG.addColorStop(1, 'rgba(40, 27, 17, 0.22)');
    ctx.fillStyle = nbG;
    ctx.fillRect(C.x, L.nameboard.y0, C.w, L.nameboard.y1 - L.nameboard.y0);
    // 键盘槽的暗
    ctx.fillStyle = 'rgba(24, 16, 10, 0.62)';
    ctx.fillRect(L.kb.x - 12, L.kb.y - 16, L.kb.w + 24, 20);
    // 前挡板（键下方）
    var railG = ctx.createLinearGradient(0, L.keySlip.y0, 0, L.frontRail.y1);
    railG.addColorStop(0, '#7a5737');
    railG.addColorStop(0.25, '#684930');
    railG.addColorStop(1, '#4b3220');
    ctx.fillStyle = railG;
    ctx.fillRect(C.x + 6, L.keySlip.y0, C.w - 12, L.frontRail.y1 - L.keySlip.y0);
    // 底板
    ctx.fillStyle = 'rgba(32, 21, 13, 0.22)';
    ctx.fillRect(C.x + 4, L.bottomPanel.y0, C.w - 8, L.bottomPanel.y1 - L.bottomPanel.y0);
    // 边缘高光
    strokeWob(ctx, C.x + 3, C.y + 10, C.x + 3, C.y + C.h - 10, 1.4, seed + 71, 'rgba(246, 218, 170, 0.16)', 2.2, 20);
    strokeWob(ctx, C.x + 3, C.y + 3, C.x + C.w - 3, C.y + 3, 1.2, seed + 73, 'rgba(246, 218, 170, 0.20)', 2.0, 24);
    strokeWob(ctx, C.x + 6, L.keySlip.y0 + 1, C.x + C.w - 6, L.keySlip.y0 + 1, 1.3, seed + 79, 'rgba(250, 226, 178, 0.24)', 2.2, 24);
    ctx.restore();

    // 边缘磨损：亮刮痕 + 磕掉漆的小块
    for (i = 0; i < 16; i++) {
      var wx = C.x + 10 + rnd() * (C.w - 20);
      var wy = C.y + (rnd() < 0.5 ? 1 + rnd() * 8 : C.h - 8 - rnd() * 8);
      grainStroke(ctx, wx, wy, wx + 14 + rnd() * 60, wy + (rnd() - 0.5) * 3, 0.8,
        seed + 900 + i * 11, 'rgba(214, 184, 138, ' + (0.10 + rnd() * 0.16).toFixed(3) + ')',
        0.8 + rnd() * 1.6, 8);
    }
    for (i = 0; i < 8; i++) {
      var cxp = C.x + (rnd() < 0.5 ? 2 + rnd() * 26 : C.w - 4 - rnd() * 26);
      var cyp = C.y + (rnd() < 0.5 ? 2 + rnd() * 26 : C.h - 6 - rnd() * 26);
      softBlob(ctx, cxp, cyp, 4 + rnd() * 14, 3 + rnd() * 10, [214, 186, 142], 0.16 + rnd() * 0.18);
    }
    // 键盘下的接触阴影
    var kbSh = ctx.createLinearGradient(0, L.kb.y + L.kb.h - 26, 0, L.kb.y + L.kb.h + 8);
    kbSh.addColorStop(0, 'rgba(24, 15, 9, 0)');
    kbSh.addColorStop(1, 'rgba(24, 15, 9, 0.44)');
    ctx.save();
    ctx.fillStyle = kbSh;
    ctx.fillRect(L.kb.x - 20, L.kb.y + L.kb.h - 26, L.kb.w + 40, 34);
    ctx.restore();
    // 琴身底部的环境遮蔽
    var ao = ctx.createLinearGradient(0, C.y + C.h * 0.62, 0, C.y + C.h);
    ao.addColorStop(0, 'rgba(20, 13, 8, 0)');
    ao.addColorStop(1, 'rgba(20, 13, 8, 0.20)');
    ctx.fillStyle = ao;
    ctx.fillRect(C.x, C.y + C.h * 0.62, C.w, C.h * 0.38);

    // 顶盖分缝
    strokeWob(ctx, C.x + 5, L.lid.y1, C.x + C.w - 5, L.lid.y1, 1.4, seed + 83, 'rgba(30, 20, 12, 0.5)', 2.0, 26);
    strokeWob(ctx, C.x + 5, L.lid.y1 - 3, C.x + C.w - 5, L.lid.y1 - 3, 1.2, seed + 85, 'rgba(236, 206, 160, 0.14)', 1.4, 26);
    // 前挡板上缘
    strokeWob(ctx, C.x + 7, L.keySlip.y0, C.x + C.w - 7, L.keySlip.y0, 1.0, seed + 89, 'rgba(28, 18, 11, 0.42)', 1.6, 26);
  }

  function paintPianoKeys(ctx, L, seed, rnd) {
    var i;
    var r = U.mulberry32(seed + 2024);
    // 白键：等宽等高的塑料键，只靠明暗和磨损区分
    for (i = 0; i < L.whites.length; i++) {
      var k = L.whites[i];
      var tone = 0.97 + r() * 0.06;
      var g = ctx.createLinearGradient(0, k.y, 0, k.y + k.h);
      g.addColorStop(0, rgbStr([234 * tone, 226 * tone, 207 * tone]));
      g.addColorStop(0.20, rgbStr([231 * tone, 222 * tone, 201 * tone]));
      g.addColorStop(0.78, rgbStr([212 * tone, 201 * tone, 176 * tone]));
      g.addColorStop(1, rgbStr([184 * tone, 172 * tone, 146 * tone]));
      ctx.fillStyle = g;
      ctx.fillRect(k.x, k.y, k.w - 0.8, k.h);
      // 键缝（细）
      ctx.fillStyle = 'rgba(58, 44, 30, 0.40)';
      ctx.fillRect(k.x + k.w - 1.0, k.y + 1, 1.0, k.h - 2);
      // 左侧塑料边的高光
      ctx.fillStyle = 'rgba(255,252,242,0.20)';
      ctx.fillRect(k.x + 0.6, k.y + 3, 1.2, k.h - 6);
      // 上缘暗（键槽挡下的阴影）
      ctx.fillStyle = 'rgba(40, 28, 18, 0.30)';
      ctx.fillRect(k.x, k.y, k.w - 1, 5);
      // 下缘亮边 + 前挡板暗线
      ctx.fillStyle = 'rgba(255, 248, 228, 0.20)';
      ctx.fillRect(k.x, k.y + k.h - 3, k.w - 1, 2);
      ctx.fillStyle = 'rgba(40, 26, 16, 0.34)';
      ctx.fillRect(k.x, k.y + k.h - 0.5, k.w - 1, 1.5);
    }
    // 黑键：骑在缝上，光泽塑料
    for (i = 0; i < L.blacks.length; i++) {
      var b = L.blacks[i];
      var bg = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      bg.addColorStop(0, '#4a3b2b');
      bg.addColorStop(0.10, '#2a2119');
      bg.addColorStop(0.45, '#1c1611');
      bg.addColorStop(1, '#0e0b08');
      ctx.fillStyle = bg;
      U.roundRect(ctx, b.x, b.y, b.w, b.h, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 238, 205, 0.16)';
      ctx.fillRect(b.x + 2, b.y + 1.5, Math.max(1, b.w - 4), 2.4);
      ctx.fillStyle = 'rgba(255, 238, 205, 0.08)';
      ctx.fillRect(b.x + 1.5, b.y + 6, 1.4, b.h * 0.5);
      softBlob(ctx, b.x + b.w / 2, b.y + b.h, b.w * 0.7, 10, [10, 7, 5], 0.22);
    }
    // 键面整体一道柔光
    var lg = ctx.createLinearGradient(0, L.kb.y, W, L.kb.y + L.kb.h);
    lg.addColorStop(0, 'rgba(255, 244, 214, 0.10)');
    lg.addColorStop(0.5, 'rgba(255, 244, 214, 0.02)');
    lg.addColorStop(1, 'rgba(255, 244, 214, 0.05)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = lg;
    ctx.fillRect(L.kb.x, L.kb.y, L.kb.w, L.kb.h);
    ctx.restore();
  }

  function paintPianoWear(ctx, L, seed, rnd) {
    var i;
    var C = L.case;
    // 木边亮刮痕
    for (i = 0; i < 12; i++) {
      var x = C.x + 12 + rnd() * (C.w - 24);
      var y0 = C.y + rnd() * 22;
      grainStroke(ctx, x, y0, x + 16 + rnd() * 58, y0 + (rnd() - 0.5) * 4, 1.1,
        seed + 500 + i * 13, 'rgba(226, 196, 150, ' + (0.07 + rnd() * 0.12).toFixed(3) + ')',
        0.9 + rnd() * 1.1, 8);
    }
    // 磕碰的暗点
    for (i = 0; i < 8; i++) {
      var cx = C.x + 8 + rnd() * (C.w - 16);
      var cy = C.y + 6 + rnd() * 40;
      ctx.fillStyle = 'rgba(26, 17, 10, ' + (0.15 + rnd() * 0.25).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.2 + rnd() * 2.6, 0, TAU);
      ctx.fill();
    }
    // 键面磨损亮斑
    for (i = 0; i < 8; i++) {
      var k = L.whites[(rnd() * L.whites.length) | 0];
      softBlob(ctx, k.x + rnd() * k.w, k.y + k.h * (0.3 + rnd() * 0.5),
        4 + rnd() * 10, 3 + rnd() * 7, [255, 250, 232], 0.10 + rnd() * 0.08);
    }
    // 前挡板上的旧磨痕
    for (i = 0; i < 5; i++) {
      var fx = C.x + 20 + rnd() * (C.w - 40);
      grainStroke(ctx, fx, L.frontRail.y0 + 8 + rnd() * 40, fx + 40 + rnd() * 90,
        L.frontRail.y0 + 8 + rnd() * 40, 1.6, seed + 700 + i * 17,
        'rgba(210, 180, 138, 0.09)', 1.4 + rnd() * 1.6, 10);
    }
  }

  /* ============================================================
   *  烘焙
   * ============================================================ */
  var SEEDS = {
    1: 0x20110101,
    2: 0x20110202,
    3: 0x20110303,
    4: 0x20110404,
    5: 0x20110505,
    6: 0x20110606,
    7: 0x20110707,
    8: 0x20110808
  };

  var SCENES = {
    1: scene1,
    2: scene2,
    3: scene3,
    4: scene4,
    5: scene5,
    6: scene6,
    7: scene7,
    8: scene8
  };

  function bakeOne(id) {
    var seed = SEEDS[id];
    var paper = cv(W, H);
    var pc = c2d(paper);
    paintPaper(pc, seed, U.mulberry32((seed ^ 0x45d9f3b) >>> 0));

    var scene = cv(W, H);
    var sc = c2d(scene);
    var cfg = SCENES[id](sc, seed, U.mulberry32((seed ^ 0x2545f491) >>> 0)) || {};
    if (cfg.blur) {
      for (var i = 0; i < cfg.blur.length; i++) blurCanvas(scene, cfg.blur[i]);
    }
    if (cfg.motion) motionBlurH(scene, cfg.motion);
    if (cfg.bloom) addBloom(scene, cfg.bloom);
    if (cfg.post) cfg.post(sc);

    composeScene(pc, scene, seed);
    finish(pc, cfg, seed);
    return paper;
  }

  var BAKED = {};
  function bake(id) {
    id = id | 0;
    if (id < 1 || id > 8) return null;
    if (BAKED[id]) return BAKED[id];
    var c = bakeOne(id);
    BAKED[id] = c;
    return c;
  }

  /* ============================================================
   *  动态层：脏矩形工具
   * ============================================================ */
  function rect(x, y, w, h) {
    x = Math.round(x); y = Math.round(y);
    w = Math.round(w); h = Math.round(h);
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > W) w = W - x;
    if (y + h > H) h = H - y;
    if (w <= 0 || h <= 0) return null;
    return { x: x, y: y, w: w, h: h };
  }
  function unionRect(a, b) {
    if (!a) return b;
    if (!b) return a;
    var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    var x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
    return rect(x0, y0, x1 - x0, y1 - y0);
  }

  function keyRect(L, midi) {
    if (LX.Melody.isBlack(midi)) {
      var bi = L.blackMidis.indexOf(midi);
      return bi < 0 ? null : L.blacks[bi];
    }
    var wi = LX.Melody.whiteIndex(midi);
    if (wi < 0 || wi >= L.whites.length) return null;
    return L.whites[wi];
  }

  /* ============================================================
   *  第 2 个动态层：极细播放头
   * ============================================================ */
  function overlay2() {
    var L = layout(2);
    var lastSig = -1;
    var lastX = -1;
    var halfTop = L.cy - L.halfMax - 36;
    var halfBot = L.cy + L.halfMax + 36;
    var bandW = 40;
    return {
      draw: function (ctx, info) {
        info = info || {};
        var t = info.t || 0;
        var sig = Math.round(t * 10000);
        if (sig === lastSig) return false;
        lastSig = sig;
        var span = L.x1 - L.x0;
        var x = L.x0 + ((t % L.period) / L.period) * span;
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        var g = ctx.createLinearGradient(0, halfTop, 0, halfBot);
        g.addColorStop(0, 'rgba(40,32,24,0)');
        g.addColorStop(0.16, 'rgba(40,32,24,0.32)');
        g.addColorStop(0.5, 'rgba(38,30,22,0.54)');
        g.addColorStop(0.84, 'rgba(40,32,24,0.32)');
        g.addColorStop(1, 'rgba(40,32,24,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x, halfTop);
        ctx.lineTo(x, halfBot);
        ctx.stroke();
        ctx.fillStyle = 'rgba(36,29,22,0.46)';
        ctx.beginPath();
        ctx.arc(x, halfTop + 2, 2.2, 0, TAU);
        ctx.fill();
        ctx.restore();
        var dr = rect(x - bandW / 2, 0, bandW, H);
        if (lastX >= 0) dr = unionRect(dr, rect(lastX - bandW / 2, 0, bandW, H));
        lastX = x;
        return dr || true;
      },
      dispose: function () { }
    };
  }

  /* ============================================================
   *  第 3 个动态层：打字 / 回删 / 呼吸光标
   * ============================================================ */
  function overlay3() {
    var L = layout(3);
    var TEXT = '最近好吗？我其实一直想跟你说——';
    var chars = TEXT.split('');
    var TYPE = 0.155, HOLD = 1.9, DEL = 0.115, PAUSE = 1.5;
    var typeDur = chars.length * TYPE;
    var delDur = chars.length * DEL;
    var cycle = typeDur + HOLD + delDur + PAUSE;
    var lastSig = null;
    var band = rect(L.textX - 36, L.baseline - L.caretH - 32, L.maxTextW + 80, L.caretH + 70);
    return {
      draw: function (ctx, info) {
        info = info || {};
        var t = info.t || 0;
        var sig = Math.round(t * 10000);
        if (sig === lastSig) return false;
        lastSig = sig;

        var ph = t % cycle;
        var n;
        if (ph < typeDur) n = Math.min(chars.length, Math.ceil(ph / TYPE));
        else if (ph < typeDur + HOLD) n = chars.length;
        else if (ph < typeDur + HOLD + delDur) n = Math.max(0, chars.length - Math.ceil((ph - typeDur - HOLD) / DEL));
        else n = 0;

        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = L.fontSize + 'px ' + FONT_SERIF;
        var total = ctx.measureText(TEXT).width || 1;
        var scale = Math.min(1, L.maxTextW / total);
        var size = L.fontSize * scale;
        ctx.font = size + 'px ' + FONT_SERIF;
        var x = L.textX;
        var caretX = x;
        for (var i = 0; i < n; i++) {
          var ch = chars[i];
          var w = ctx.measureText(ch).width;
          var jy = (U.hash2(i, 5, 91) - 0.5) * 2.2;
          var jr = (U.hash2(i, 7, 17) - 0.5) * 0.02;
          ctx.save();
          ctx.translate(x + w * 0.5, L.baseline + jy);
          ctx.rotate(jr);
          ctx.fillStyle = 'rgba(42,35,27,0.87)';
          ctx.fillText(ch, -w * 0.5, 0);
          ctx.globalAlpha = 0.20;
          ctx.fillText(ch, -w * 0.5 + 0.7, 0.6);
          ctx.restore();
          x += w;
          caretX = x;
        }
        // 光标极慢呼吸（不闪）
        var breathe = 0.5 - 0.5 * Math.cos(t * TAU / 3.1);
        var ca = 0.10 + 0.52 * breathe;
        ctx.fillStyle = 'rgba(46,38,29,' + ca.toFixed(3) + ')';
        ctx.fillRect(caretX + 1.5, L.baseline - L.caretH + 8, 2.2, L.caretH + 2);
        ctx.restore();
        return band;
      },
      dispose: function () { }
    };
  }

  /* ============================================================
   *  第 4 个动态层：烛光闪烁 + 人影轻摇（全屏光，返回 true）
   * ============================================================ */
  function overlay4() {
    var L = layout(4);
    var A = assets();
    var lastSig = null;
    var reduced = !!(LX.ENV && LX.ENV.reducedMotion);
    var flickAmt = reduced ? 0.25 : 1;
    var swayAmt = reduced ? 0.25 : 1;
    return {
      draw: function (ctx, info) {
        info = info || {};
        var t = info.t || 0;
        var sig = Math.round(t * 10000);
        if (sig === lastSig) return false;
        lastSig = sig;
        ctx.clearRect(0, 0, W, H);

        // 烛光呼吸
        var i;
        for (i = 0; i < L.glows.length; i++) {
          var gl = L.glows[i];
          var f = 0.5 + 0.5 * Math.sin(t * (6.1 + i * 0.83) + i * 2.4);
          var f2 = 0.5 + 0.5 * U.fbm1(t * 1.6 + i * 7.3, 2, 71 + i * 13);
          var k = 0.70 + 0.30 * (0.5 + 0.5 * (f * 0.6 + f2 * 0.4));
          k = 1 + (k - 1) * flickAmt;
          var rr = gl.r * (0.94 + 0.10 * (k - 1) / 0.30);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.16 * k;
          ctx.drawImage(A.glowWarm, gl.x - rr, gl.y - rr, rr * 2, rr * 2);
          ctx.restore();
        }

        // 人影轻摇（覆盖 bake 里的静态人影，形成动态虚影）
        for (i = 0; i < L.sil.length; i++) {
          var s = L.sil[i];
          var spr = i === 0 ? A.sil1 : A.sil2;
          var sw = spr.width * s.s, sh = spr.height * s.s;
          var ox = Math.sin(t * 0.85 + i * 1.7) * 5.5 * swayAmt;
          var oy = Math.sin(t * 1.27 + i * 2.3) * 2.2 * swayAmt;
          ctx.save();
          ctx.globalAlpha = 0.34;
          ctx.drawImage(spr, s.x - sw / 2 + ox, s.y - sh + oy, sw, sh);
          ctx.restore();
        }
        return true;
      },
      dispose: function () { }
    };
  }

  /* ============================================================
   *  第 5 个动态层：搜索词逐条淡入
   * ============================================================ */
  function overlay5() {
    var L = layout(5);
    var n = L.items.length;
    var prevA = null;
    function bandFor(it) {
      return rect(it.x - 24, it.y - it.size * 1.22 - 14, W - it.x + 16, it.size * 1.68);
    }
    return {
      draw: function (ctx, info) {
        info = info || {};
        var t = info.t || 0;
        var i;
        var a = [];
        for (i = 0; i < n; i++) {
          a.push(U.smoothstep(i * L.stagger, i * L.stagger + L.dur, t));
        }
        if (!prevA) {
          prevA = a.slice();
          var allZero = true;
          for (i = 0; i < n; i++) if (a[i] > 0.002) allZero = false;
          if (allZero) return false;
        } else {
          var changed = false;
          for (i = 0; i < n; i++) if (Math.abs(a[i] - prevA[i]) > 0.004) changed = true;
          if (!changed) return false;
        }
        ctx.clearRect(0, 0, W, H);
        var dr = null;
        for (i = 0; i < n; i++) {
          if (Math.abs(a[i] - prevA[i]) > 0.004) dr = unionRect(dr, bandFor(L.items[i]));
          if (a[i] <= 0.002) continue;
          var it = L.items[i];
          var col = 'rgba(44,36,27,' + (0.88 * a[i]).toFixed(3) + ')';
          drawCharText(ctx, it.text, it.x, it.y, it.size, FONT_HAND, col, 200 + i * 37, 2, true);
        }
        prevA = a.slice();
        return dr || true;
      },
      dispose: function () { }
    };
  }

  /* ============================================================
   *  第 6 个动态层：冒号极慢呼吸
   * ============================================================ */
  function overlay6() {
    var L = layout(6);
    var lastSig = null;
    var pad = 10;
    var band = rect(
      L.colonX - L.colonR - pad,
      L.colonTop - L.colonR - pad,
      (L.colonR + pad) * 2,
      (L.colonBot - L.colonTop) + (L.colonR + pad) * 2
    );
    return {
      draw: function (ctx, info) {
        info = info || {};
        var t = info.t || 0;
        var sig = Math.round(t * 10000);
        if (sig === lastSig) return false;
        lastSig = sig;
        ctx.clearRect(0, 0, W, H);
        var a = 0.26 + 0.58 * (0.5 - 0.5 * Math.cos(t * TAU / 3.8));
        var rr = L.colonR * (0.92 + 0.10 * a);
        ctx.fillStyle = 'rgba(42,35,27,' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(L.colonX, L.colonTop, rr, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(L.colonX, L.colonBot, rr, 0, TAU);
        ctx.fill();
        return band || true;
      },
      dispose: function () { }
    };
  }

  /* ============================================================
   *  第 8 个动态层：发声键微光 + 修复痕迹
   * ============================================================ */
  var WRONG_MIDI = 75;

  function drawKeyGlow(ctx, L, midi, inten) {
    var r = keyRect(L, midi);
    if (!r) return;
    var x = r.x - 8, y = r.y - 6, w = r.w + 16, h = r.h + 14;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    var cx = r.x + r.w * 0.5, cy = r.y + r.h * 0.30;
    var rad = Math.max(r.w, r.h) * 1.15;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(255,241,208,' + (0.48 * inten).toFixed(3) + ')');
    g.addColorStop(0.45, 'rgba(255,232,188,' + (0.24 * inten).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,226,176,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,246,218,' + (0.30 * inten).toFixed(3) + ')';
    ctx.fillRect(r.x + 2, r.y + 2, Math.max(1, r.w - 4), 3);
    ctx.restore();
  }

  function paintRepair(ctx, L) {
    var r = keyRect(L, WRONG_MIDI);
    var rects = [];
    if (r) {
      var px = r.x + r.w * 0.12, py = r.y + r.h * 0.10;
      var pw = r.w * 0.76, ph = r.h * 0.30;
      ctx.save();
      ctx.fillStyle = 'rgba(246,237,216,0.92)';
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = 'rgba(238,226,200,0.50)';
      ctx.fillRect(px, py + ph - 1.5, pw, 1.5);
      ctx.restore();
      rects.push(rect(r.x - 4, py - 4, r.w + 8, ph + 10));
    }
    var b = L.repairBody;
    ctx.save();
    ctx.fillStyle = 'rgba(110,82,55,0.70)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(214,192,152,0.32)';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.restore();
    rects.push(rect(b.x - 6, b.y - 6, b.w + 12, b.h + 12));
    return rects;
  }

  function overlay8() {
    var L = layout(8);
    var lastMidi = null;
    var lastBucket = -1;
    var lastRep = false;
    var dur = (LX.Melody && LX.Melody.duration) || 16;
    return {
      draw: function (ctx, info) {
        info = info || {};
        var repaired = !!info.repaired;
        var mt = (typeof info.musicTime === 'number' && info.musicTime >= 0) ? info.musicTime : -1;
        var note = mt >= 0 ? LX.Melody.noteAt(mt % dur, repaired) : null;
        var inten = 0;
        if (note) {
          inten = U.smoothstep(0, 0.03, note.since) * (0.30 + 0.70 * Math.exp(-note.since / 0.55));
        }
        var bucket = Math.round(inten * 64);
        var midi = note ? note.midi : null;
        if (midi === lastMidi && bucket === lastBucket && repaired === lastRep) return false;

        ctx.clearRect(0, 0, W, H);
        var dr = null;
        var glowRects = [];
        if (note && inten > 0.012) {
          drawKeyGlow(ctx, L, midi, inten);
          var gr = keyRect(L, midi);
          if (gr) glowRects.push(rect(gr.x - 10, gr.y - 8, gr.w + 20, gr.h + 18));
        }
        if (repaired) {
          var prs = paintRepair(ctx, L);
          if (repaired !== lastRep) for (var j = 0; j < prs.length; j++) dr = unionRect(dr, prs[j]);
        }
        // 上一帧的亮键位置也要刷掉（否则会留残光）
        if (lastMidi !== null && (midi === null || lastMidi !== midi)) {
          var lr = keyRect(L, lastMidi);
          if (lr) glowRects.push(rect(lr.x - 10, lr.y - 8, lr.w + 20, lr.h + 18));
        }
        for (var i = 0; i < glowRects.length; i++) dr = unionRect(dr, glowRects[i]);
        if (repaired !== lastRep) {
          var wr = keyRect(L, WRONG_MIDI);
          if (wr) dr = unionRect(dr, rect(wr.x - 6, wr.y - 6, wr.w + 12, wr.h * 0.6 + 14));
          dr = unionRect(dr, rect(L.repairBody.x - 8, L.repairBody.y - 8, L.repairBody.w + 16, L.repairBody.h + 16));
        }
        lastMidi = midi;
        lastBucket = bucket;
        lastRep = repaired;
        return dr || false;
      },
      dispose: function () { }
    };
  }

  /* ============================================================
   *  对外接口
   * ============================================================ */
  function createOverlay(id) {
    id = id | 0;
    if (id === 2) return overlay2();
    if (id === 3) return overlay3();
    if (id === 4) return overlay4();
    if (id === 5) return overlay5();
    if (id === 6) return overlay6();
    if (id === 8) return overlay8();
    return {
      draw: function () { return false; },
      dispose: function () { }
    };
  }

  function ready() {
    for (var i = 1; i <= 8; i++) if (!BAKED[i]) return false;
    return true;
  }

  function raf(fn) {
    if (global.requestAnimationFrame) global.requestAnimationFrame(fn);
    else global.setTimeout(fn, 16);
  }

  var PW = { started: false, done: false, progress: 0, cbs: [] };
  function prewarm(onProgress) {
    if (typeof onProgress === 'function') {
      PW.cbs.push(onProgress);
      if (PW.done) onProgress(1);
      else if (PW.started) onProgress(PW.progress);
    }
    if (PW.started || PW.done) return;

    function emit(p) {
      PW.progress = p;
      for (var i = 0; i < PW.cbs.length; i++) {
        try { PW.cbs[i](p); } catch (e) { }
      }
    }

    PW.started = true;
    var next = 1;
    function step() {
      try { bake(next); } catch (e) {
        if (global.console && global.console.error) global.console.error('art bake ' + next, e);
      }
      next++;
      if (next > 8) {
        PW.done = true;
        emit(1);
        return;
      }
      emit((next - 1) / 8);
      raf(step);
    }
    raf(step);
  }

  var META = {
    1: 'IMG_2291.jpg · 3 月 14 日 07:42 · 未分享',
    2: '录音 047 · 0:04 · 无标题',
    3: '草稿 · 最后编辑于 412 天前',
    4: 'VID_0619.mp4 · 播放次数：0',
    5: '搜索记录 · 共 1,284 条',
    6: '闹钟 · 已响铃 1,096 次',
    7: '购物车 · 1 件商品',
    8: '录音 · 发送给：妈妈 · 已读'
  };

  // 预生成一次性素材（颗粒 tile / 光斑 / 人影），不占用第一张烘焙的耗时
  try { assets(); } catch (e) { }

  LX.Art = {
    META: META,
    bake: bake,
    createOverlay: createOverlay,
    ready: ready,
    prewarm: prewarm
  };
})(window);
