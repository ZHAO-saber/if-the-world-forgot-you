/* 《如果世界忘记了你》— paper.js
 * 程序化相纸：桌面纸（全屏底）+ 小相纸精灵（纸堆用）。
 * 全部一次烘焙，运行时不再重绘。
 */
(function (global) {
  'use strict';
  var LX = (global.LX = global.LX || {});
  var U = LX.U;

  var grainTile = null;

  // 256×256 纯随机颗粒 tile（无缝，因为它是白噪声）
  function getGrainTile() {
    if (grainTile) return grainTile;
    var n = 256, c = U.canvas(n, n), ctx = c.getContext('2d');
    var img = ctx.createImageData(n, n), d = img.data;
    var rnd = U.mulberry32(9137);
    for (var i = 0; i < d.length; i += 4) {
      var v = 128 + (rnd() - 0.5) * 255;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    grainTile = c;
    return c;
  }

  // 平铺颗粒
  function tileGrain(ctx, w, h, alpha, scale) {
    var tile = getGrainTile();
    var ts = Math.max(64, Math.round(256 * (scale || 1)));
    var pat = ctx.createPattern(tile, 'repeat');
    if (!pat) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'overlay';
    ctx.translate((Math.random() * 10) | 0, (Math.random() * 10) | 0);
    var m = ctx.getTransform();
    if (m && m.a) { /* ctx 已按 dpr 缩放，pattern 需要反向补偿 */ }
    ctx.fillStyle = pat;
    var k = (m && m.a ? m.a : 1);
    ctx.scale(1 / k, 1 / k);
    ctx.fillRect(0, 0, w * k, h * k);
    ctx.restore();
  }

  /* ---------------- 桌面纸 ---------------- */
  LX.Paper = LX.Paper || {};

  LX.Paper.makeTable = function (w, h, seed) {
    seed = seed || 7;
    w = Math.round(w); h = Math.round(h);
    var c = U.canvas(w, h), ctx = c.getContext('2d');
    var P = LX.PAL;

    ctx.fillStyle = P.paper;
    ctx.fillRect(0, 0, w, h);

    // 1) 大块纸浆不匀：64×64 噪声上采样
    var sm = 64;
    var nc = U.canvas(sm, sm), nctx = nc.getContext('2d');
    var img = nctx.createImageData(sm, sm), d = img.data;
    for (var y = 0; y < sm; y++) {
      for (var x = 0; x < sm; x++) {
        var v = U.fbm2(x / 9.5, y / 9.5, 4, 2.05, 0.5, seed);
        var v2 = U.fbm2(x / 3.1 + 11, y / 3.1 + 7, 3, 2.1, 0.5, seed + 4);
        var g = 244 + (v - 0.5) * 16 + (v2 - 0.5) * 8;
        var idx = (y * sm + x) * 4;
        d[idx] = g; d[idx + 1] = g - 1; d[idx + 2] = g - 7; d[idx + 3] = 255;
      }
    }
    nctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(nc, 0, 0, w, h);
    // 再压一层很轻的乘算，制造不均匀
    ctx.globalAlpha = 0.16;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(nc, 0, 0, w, h);
    ctx.restore();

    // 2) 纤维：大量极短极淡的毛发
    var rnd = U.mulberry32(seed * 31 + 5);
    var fibers = Math.round((w * h) / 2600);
    fibers = Math.min(fibers, 4200);
    ctx.lineCap = 'round';
    for (var i = 0; i < fibers; i++) {
      var fx = rnd() * w, fy = rnd() * h;
      var len = 4 + rnd() * 34;
      var ang = (rnd() - 0.5) * 0.22 + (rnd() < 0.18 ? Math.PI * 0.5 : 0);
      var dark = rnd() < 0.55;
      ctx.globalAlpha = 0.022 + rnd() * 0.045;
      ctx.strokeStyle = dark ? 'rgba(120,110,96,1)' : 'rgba(255,252,244,1)';
      ctx.lineWidth = 0.5 + rnd() * 0.9;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(ang) * len, fy + Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 3) 纸屑/杂质：极少
    var specks = Math.round((w * h) / 60000);
    for (var s = 0; s < specks; s++) {
      var sx = rnd() * w, sy = rnd() * h, sr = 0.4 + rnd() * 1.3;
      ctx.globalAlpha = 0.05 + rnd() * 0.1;
      ctx.fillStyle = rnd() < 0.5 ? '#7C7264' : '#5F584E';
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 4) 细颗粒
    tileGrain(ctx, w, h, 0.13, 1);

    return c;
  };

  /* ---------------- 小相纸精灵（纸堆/落纸用） ---------------- */
  LX.Paper.makeSheet = function (w, h, seed) {
    seed = seed || 3;
    w = Math.round(w); h = Math.round(h);
    var c = U.canvas(w, h), ctx = c.getContext('2d');
    var P = LX.PAL;
    var rnd = U.mulberry32(seed * 17 + 1);

    // 不规则毛边（相纸边）
    ctx.beginPath();
    var steps = 60, pts = [];
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var e = 1.2 + (U.fbm1(t * 6.2 + seed, 2, seed) - 0.5) * 2.6;
      // 上边
      pts.push([w * t, e]);
    }
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var e = 1.2 + (U.fbm1(t * 6.2 + seed + 30, 2, seed + 1) - 0.5) * 2.6;
      pts.push([w - e, h * t]);
    }
    for (var i = 0; i <= steps; i++) {
      var t = 1 - i / steps;
      var e = 1.2 + (U.fbm1(t * 6.2 + seed + 60, 2, seed + 2) - 0.5) * 2.6;
      pts.push([w * t, h - e]);
    }
    for (var i = 0; i <= steps; i++) {
      var t = 1 - i / steps;
      var e = 1.2 + (U.fbm1(t * 6.2 + seed + 90, 2, seed + 3) - 0.5) * 2.6;
      pts.push([e, h * t]);
    }
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
      else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();

    ctx.fillStyle = P.card;
    ctx.fill();

    ctx.save();
    ctx.clip();

    // 纸面渐变（略有不匀）
    var g = ctx.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, 'rgba(255,253,247,0.55)');
    g.addColorStop(0.6, 'rgba(238,232,220,0.18)');
    g.addColorStop(1, 'rgba(215,206,190,0.28)');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 极细纤维
    ctx.globalCompositeOperation = 'source-over';
    for (var i = 0; i < Math.round(w * h / 500); i++) {
      var fx = rnd() * w, fy = rnd() * h, len = 2 + rnd() * 8;
      ctx.globalAlpha = 0.03 + rnd() * 0.04;
      ctx.strokeStyle = rnd() < 0.5 ? '#8E8578' : '#FFFFFF';
      ctx.lineWidth = 0.4 + rnd() * 0.5;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + len, fy + (rnd() - 0.5) * 1.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 边缘压暗（纸厚感）
    var vg = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    vg.addColorStop(0, 'rgba(120,110,95,0)');
    vg.addColorStop(1, 'rgba(120,110,95,0.16)');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
    return c;
  };

  LX.Paper.tileGrain = tileGrain;

  /* ---------------- 4 通道噪声场（着色器用） ----------------
   * R: 潮水 A（大尺度，域扭曲用）
   * G: 细颗粒（药膜边、颗粒）
   * B: 潮水 B（纵向拉伸，从底往上吞）
   * A: 显影深度噪声
   * 一次烘焙，全片共用，片元着色器里就不用跑 fbm 了。
   */
  LX.Paper.makeFields = function (size, seed) {
    size = size || 256;
    seed = seed || 3;
    var c = U.canvas(size, size), ctx = c.getContext('2d');
    var img = ctx.createImageData(size, size), d = img.data;
    function stretch(v) { return U.clamp(0.5 + (v - 0.5) * 1.45, 0.06, 0.94); }
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var u = x / size, v = y / size;
        var r = stretch(U.fbm2(u * 4.2, v * 5.0, 4, 2.03, 0.55, seed + 11));
        var g = stretch(U.fbm2(u * 15.0, v * 19.0, 3, 2.11, 0.55, seed + 37));
        var b = stretch(U.fbm2(u * 3.0, v * 6.6, 4, 2.03, 0.55, seed + 61));
        var a = stretch(U.fbm2(u * 5.6, v * 2.6, 3, 2.10, 0.55, seed + 89));
        var i = (y * size + x) * 4;
        d[i] = r * 255;
        d[i + 1] = g * 255;
        d[i + 2] = b * 255;
        d[i + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };
})(window);
