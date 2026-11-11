/* 《如果世界忘记了你》— core.js
 * 共享调色板、缓动、噪声、随机数。所有模块只读使用。
 * classic script（非 module），保证 file:// 直接双击可运行。
 */
(function (global) {
  'use strict';
  var LX = (global.LX = global.LX || {});

  /* ---------------- 调色板（暗房，不是赛博空间） ---------------- */
  LX.PAL = {
    paper:    '#F2EEE6',   // 相纸白（桌面/背景）
    paperRGB: [242, 238, 230],
    card:     '#F5F1E9',   // 打印出来的相纸，比桌面纸略亮
    cardRGB:  [245, 241, 233],
    ink:      '#1C1B19',   // 墨色
    inkRGB:   [28, 27, 25],
    red:      '#9E2B25',   // 暗房安全灯的暗红（只给系统文字和极少数时刻）
    redRGB:   [158, 43, 37],
    mute:     '#8A8378',   // 灰化的墨（元数据）
    muteRGB:  [138, 131, 120]
  };

  LX.DPR_CAP = 2;             // devicePixelRatio 上限
  LX.CARD_W = 1024;           // 所有程序化画面烘焙尺寸
  LX.CARD_H = 1408;

  /* ---------------- 数学 ---------------- */
  var U = (LX.U = {});

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.smoothstep = function (a, b, x) {
    var t = U.clamp01((x - a) / (b - a || 1e-9));
    return t * t * (3 - 2 * t);
  };
  U.mix = function (a, b, t) { return U.lerp(a, b, t); };
  U.easeOutQuint = function (t) { t = U.clamp01(t); return 1 - Math.pow(1 - t, 5); };
  U.easeInOutCubic = function (t) {
    t = U.clamp01(t);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };
  U.easeInOutQuint = function (t) {
    t = U.clamp01(t);
    return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
  };
  U.easeOutCubic = function (t) { t = U.clamp01(t); return 1 - Math.pow(1 - t, 3); };
  U.easeInQuad = function (t) { t = U.clamp01(t); return t * t; };
  U.rgba = function (rgb, a) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  };
  U.lerpRGB = function (a, b, t) {
    return [U.lerp(a[0], b[0], t), U.lerp(a[1], b[1], t), U.lerp(a[2], b[2], t)];
  };

  /* ---------------- 确定性随机 ---------------- */
  U.mulberry32 = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // 带种子的正态近似（irwin-hall），用于自然分布
  U.gauss = function (rand) { return (rand() + rand() + rand() + rand() - 2) * 0.7; };

  /* ---------------- 噪声 ---------------- */
  U.hash2 = function (x, y, seed) {
    var h = Math.sin(x * 127.1 + y * 311.7 + (seed || 0) * 74.7) * 43758.5453123;
    return h - Math.floor(h);
  };

  U.vnoise2 = function (x, y, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = U.hash2(xi, yi, seed), b = U.hash2(xi + 1, yi, seed);
    var c = U.hash2(xi, yi + 1, seed), d = U.hash2(xi + 1, yi + 1, seed);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
  };

  U.fbm2 = function (x, y, oct, lac, gain, seed) {
    oct = oct || 4; lac = lac || 2.03; gain = gain === undefined ? 0.5 : gain;
    var amp = 1, sum = 0, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += amp * U.vnoise2(x, y, (seed || 0) + i * 17);
      norm += amp; amp *= gain; x *= lac; y *= lac;
    }
    return sum / norm;
  };

  U.vnoise1 = function (x, seed) {
    var xi = Math.floor(x), xf = x - xi;
    var u = xf * xf * (3 - 2 * xf);
    return U.lerp(U.hash2(xi, 3.7, seed), U.hash2(xi + 1, 3.7, seed), u);
  };

  U.fbm1 = function (x, oct, seed) {
    oct = oct || 3;
    var amp = 1, sum = 0, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += amp * U.vnoise1(x, (seed || 0) + i * 31);
      norm += amp; amp *= 0.5; x *= 2.07;
    }
    return sum / norm;
  };

  /* ---------------- 画布小工具 ---------------- */
  U.canvas = function (w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  U.roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // 给一段路径加“手抖”：把点沿法线做低频扰动，用于手绘感的直线
  U.wobbleLine = function (ctx, x0, y0, x1, y1, amp, seed, steps) {
    steps = steps || 24;
    var dx = x1 - x0, dy = y1 - y0;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    ctx.beginPath();
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var w = (U.fbm1(t * 3.1 + seed * 7.7, 2, seed) - 0.5) * 2 * amp;
      var x = x0 + dx * t + nx * w;
      var y = y0 + dy * t + ny * w;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  };

  /* ---------------- 时间 ---------------- */
  U.now = function () {
    return (global.performance && performance.now) ? performance.now() : Date.now();
  };

  /* ---------------- 环境探测 ---------------- */
  LX.ENV = (function () {
    var reduced = false, touch = false;
    try {
      reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    } catch (e) {}
    return { reducedMotion: reduced, touch: touch };
  })();
})(window);
