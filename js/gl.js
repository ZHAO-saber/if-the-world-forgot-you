/* 《如果世界忘记了你》— gl.js
 * WebGL2 全屏合成：桌面纸 + 相纸卡片 + 反向显影 + 结局过曝。
 * 降级链：WebGL2 → 2D 近似 → 纯纸面。
 */
(function (global) {
  'use strict';
  var LX = (global.LX = global.LX || {});

  var G = {
    mode: 'none',
    canvas: null,
    gl: null,
    ctx2d: null,
    prog: null,
    uni: {},
    tex: { table: null, card: null, overlay: null, field: null },
    hasCard: false,
    hasOverlay: false,
    tableCanvas: null,
    cardCanvas: null,
    w: 1,
    h: 1
  };

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      console.error('[GL] shader compile failed:\n' + log);
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function makeTex(gl, mip) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    return t;
  }

  /* ---------------- 初始化 ---------------- */
  G.create = function (canvas) {
    G.canvas = canvas;
    var gl = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false,
        powerPreference: 'high-performance', desynchronized: true
      });
    } catch (e) { gl = null; }

    if (gl) {
      try {
        var vs = compile(gl, gl.VERTEX_SHADER, LX.Shaders.VERT);
        var fs = compile(gl, gl.FRAGMENT_SHADER, LX.Shaders.FRAG);
        if (vs && fs) {
          var p = gl.createProgram();
          gl.attachShader(p, vs);
          gl.attachShader(p, fs);
          gl.bindAttribLocation(p, 0, 'aPos');
          gl.linkProgram(p);
          if (gl.getProgramParameter(p, gl.LINK_STATUS)) {
            G.prog = p;
            gl.useProgram(p);
            var buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

            ['uRes', 'uTable', 'uCard', 'uOverlay', 'uCardRect', 'uHasCard', 'uHasOverlay',
             'uP', 'uReveal', 'uCam', 'uTime', 'uGrain', 'uExposure', 'uGhost', 'uGhostImg', 'uSeed', 'uField'
            ].forEach(function (n) {
              G.uni[n] = gl.getUniformLocation(p, n);
            });

            G.tex.table = makeTex(gl, false);
            G.tex.card = makeTex(gl, true);
            G.tex.overlay = makeTex(gl, true);
            G.tex.field = makeTex(gl, false);
            G.mode = 'webgl2';
            G.gl = gl;
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.clearColor(0.949, 0.933, 0.902, 1);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.BLEND);
            return true;
          } else {
            console.error('[GL] link failed', gl.getProgramInfoLog(p));
          }
        }
      } catch (e) {
        console.error('[GL] init error', e);
      }
    }

    // ---- 2D 降级 ----
    try {
      var c2 = document.createElement('canvas');
      c2.id = 'gl';
      canvas.parentNode.replaceChild(c2, canvas);
      G.canvas = c2;
      G.ctx2d = c2.getContext('2d');
      if (G.ctx2d) { G.mode = '2d'; return true; }
    } catch (e) { /* ignore */ }
    G.mode = 'none';
    return false;
  };

  /* ---------------- 尺寸 ---------------- */
  G.resize = function (w, h) {
    G.w = Math.max(1, Math.round(w));
    G.h = Math.max(1, Math.round(h));
    G.canvas.width = G.w;
    G.canvas.height = G.h;
    if (G.gl) G.gl.viewport(0, 0, G.w, G.h);
  };

  /* ---------------- 纹理 ---------------- */
  function uploadTable(canvas) {
    if (!G.gl) return;
    var gl = G.gl;
    gl.bindTexture(gl.TEXTURE_2D, G.tex.table);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    G.tableCanvas = canvas;
  }

  G.setTable = function (canvas) {
    if (G.mode === 'webgl2') uploadTable(canvas);
    else G.tableCanvas = canvas;
  };

  G.setFields = function (canvas) {
    if (G.mode !== 'webgl2' || !canvas) return;
    var gl = G.gl;
    gl.bindTexture(gl.TEXTURE_2D, G.tex.field);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  };

  G.setCard = function (canvas) {
    G.hasCard = !!canvas;
    if (G.mode === 'webgl2') {
      var gl = G.gl;
      gl.bindTexture(gl.TEXTURE_2D, G.tex.card);
      if (canvas) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.generateMipmap(gl.TEXTURE_2D);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      }
    }
    G.cardCanvas = canvas;
  };

  // dirty = {x,y,w,h}（画布像素）；不传则整张重传
  G.setOverlay = function (canvas, dirty) {
    if (!canvas) { G.clearOverlay(); return; }
    G.hasOverlay = true;
    if (G.mode !== 'webgl2') return;
    var gl = G.gl;
    gl.bindTexture(gl.TEXTURE_2D, G.tex.overlay);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    var fullUpload = function () {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    };
    // 局部更新：把脏矩形先拷进一块 w×h 的暂存画布，再用 9 参形式上传到同一区域。
    // （WebGL 的 TexImageSource 变体要求源尺寸与 width/height 一致）
    if (dirty && dirty.w > 0 && dirty.h > 0 && !G._subImageBad) {
      try {
        var sc = G._scratch;
        if (!sc) { sc = G._scratch = document.createElement('canvas'); }
        if (sc.width !== dirty.w || sc.height !== dirty.h) {
          sc.width = dirty.w; sc.height = dirty.h;
        }
        var sctx = sc.getContext('2d');
        sctx.clearRect(0, 0, dirty.w, dirty.h);
        sctx.drawImage(canvas, dirty.x, dirty.y, dirty.w, dirty.h, 0, 0, dirty.w, dirty.h);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, dirty.x, dirty.y, dirty.w, dirty.h,
          gl.RGBA, gl.UNSIGNED_BYTE, sc);
        if (gl.getError() !== gl.NO_ERROR) {
          G._subImageBad = true;
          fullUpload();
        }
      } catch (e) {
        G._subImageBad = true;
        fullUpload();
      }
    } else {
      fullUpload();
    }
    gl.generateMipmap(gl.TEXTURE_2D);
  };

  G.clearOverlay = function () {
    G.hasOverlay = false;
    if (G.mode !== 'webgl2') return;
    var gl = G.gl;
    gl.bindTexture(gl.TEXTURE_2D, G.tex.overlay);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  };

  /* ---------------- 渲染 ---------------- */
  // st = { p, reveal, cam:{scale,ox,oy}, time, grain, exposure, cardRect:{x,y,w,h}(设备像素,顶部原点) }
  G.render = function (st) {
    if (G.mode === 'webgl2') return renderGL(st);
    if (G.mode === '2d') return render2D(st);
    return false;
  };

  function renderGL(st) {
    var gl = G.gl, u = G.uni;
    gl.viewport(0, 0, G.w, G.h);
    gl.useProgram(G.prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, G.tex.table);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, G.tex.card);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, G.tex.overlay);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, G.tex.field);

    gl.uniform2f(u.uRes, G.w, G.h);
    gl.uniform1i(u.uTable, 0);
    gl.uniform1i(u.uCard, 1);
    gl.uniform1i(u.uOverlay, 2);
    gl.uniform1i(u.uField, 3);

    var r = st.cardRect || { x: 0, y: 0, w: 1, h: 1 };
    gl.uniform4f(u.uCardRect, r.x, r.y, r.w, r.h);
    gl.uniform1f(u.uHasCard, G.hasCard && st.hasCard !== false ? 1 : 0);
    gl.uniform1f(u.uHasOverlay, G.hasOverlay ? 1 : 0);
    gl.uniform1f(u.uP, st.p || 0);
    gl.uniform1f(u.uReveal, st.reveal === undefined ? 1 : st.reveal);
    var cam = st.cam || { scale: 1, ox: 0, oy: 0 };
    gl.uniform3f(u.uCam, cam.scale || 1, cam.ox || 0, cam.oy || 0);
    gl.uniform1f(u.uTime, st.time || 0);
    gl.uniform1f(u.uGrain, st.grain === undefined ? 0.018 : st.grain);
    gl.uniform1f(u.uExposure, st.exposure || 0);
    gl.uniform1f(u.uGhost, st.ghost === undefined ? 0 : st.ghost);
    gl.uniform1f(u.uGhostImg, st.ghostImg || 0);
    gl.uniform1f(u.uSeed, 17.0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  // 2D 降级：近似（不是最终效果，只为不让页面变空白）
  function render2D(st) {
    var ctx = G.ctx2d;
    var W = G.w, H = G.h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (G.tableCanvas) ctx.drawImage(G.tableCanvas, 0, 0, W, H);
    else { ctx.fillStyle = LX.PAL.paper; ctx.fillRect(0, 0, W, H); }

    var r = st.cardRect;
    if (G.hasCard && G.cardCanvas && r && r.w > 1) {
      var p = st.p || 0, rev = st.reveal === undefined ? 1 : st.reveal;
      var a = Math.max(0, rev * (1 - p * 0.97));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.filter = 'saturate(' + (1 - p * 1.0) + ') contrast(' + (1 - p * 0.85) + ') sepia(' + Math.min(0.55, p * 0.6) + ')';
      ctx.drawImage(G.cardCanvas, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    if (st.exposure > 0.001) {
      ctx.globalAlpha = st.exposure;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    return true;
  }

  /* ---------------- 取像素（测试用） ---------------- */
  G.sample = function (rect) {
    if (G.mode === 'webgl2') {
      var gl = G.gl;
      var x = Math.max(0, Math.round(rect.x));
      var yTop = Math.max(0, Math.round(rect.y));
      var w = Math.min(G.w - x, Math.round(rect.w));
      var h = Math.min(G.h - yTop, Math.round(rect.h));
      if (w <= 0 || h <= 0) return { r: 0, g: 0, b: 0, n: 0 };
      var yBot = G.h - yTop - h;      // readPixels 原点在左下
      var buf = new Uint8Array(w * h * 4);
      gl.readPixels(x, yBot, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      var sr = 0, sg = 0, sb = 0, n = w * h;
      for (var i = 0; i < buf.length; i += 4) { sr += buf[i]; sg += buf[i + 1]; sb += buf[i + 2]; }
      return { r: sr / n, g: sg / n, b: sb / n, n: n };
    }
    if (G.mode === '2d') {
      var ctx = G.ctx2d;
      var x2 = Math.max(0, Math.round(rect.x)), y2 = Math.max(0, Math.round(rect.y));
      var w2 = Math.min(G.w - x2, Math.round(rect.w)), h2 = Math.min(G.h - y2, Math.round(rect.h));
      if (w2 <= 0 || h2 <= 0) return { r: 0, g: 0, b: 0, n: 0 };
      try {
        var d = ctx.getImageData(x2, y2, w2, h2).data;
        var sr2 = 0, sg2 = 0, sb2 = 0;
        for (var j = 0; j < d.length; j += 4) { sr2 += d[j]; sg2 += d[j + 1]; sb2 += d[j + 2]; }
        var nn = d.length / 4;
        return { r: sr2 / nn, g: sg2 / nn, b: sb2 / nn, n: nn };
      } catch (e) { return { r: 0, g: 0, b: 0, n: 0 }; }
    }
    return { r: 0, g: 0, b: 0, n: 0 };
  };

  G.size = function () { return { w: G.w, h: G.h }; };

  LX.GL = G;
})(window);
