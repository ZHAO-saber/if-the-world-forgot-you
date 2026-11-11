/* 《如果世界忘记了你》— audio.js
 * 声音工程师。classic script（非 module），IIFE，挂 window.LX.Audio。
 * 零外部素材：粉噪、雨、欢呼、雨滴、键盘、闹钟、木质吱呀、纸落、玩具钢琴全部程序化合成。
 *
 * 合成结构总览（实时/离线共用同一套代码，createEngine 接受任意 BaseAudioContext）：
 *   总线     : 各分总线 → mix → 按住低通(holdLP, 380Hz) → master → 硬限幅(±0.18 ≈ -14.9dBFS) → destination
 *   房间底噪 : 4s 无缝循环粉噪（Voss-Kellet 生成，接缝交叉淡化）→ 35Hz 高通 → 850Hz 低通 → 极低增益
 *   文件 1   : 房间底噪 + 偶发木质吱呀（窄带扫频噪声，4–9s 随机一次）
 *   文件 2   : 雨 = 粉噪 → 约 550–3200Hz 带通 → 两个慢速不可公约 LFO 调幅；+ 泊松分布雨滴
 *              （1.5–4kHz 正弦，约 30ms 指数衰减，随机声像）
 *   文件 3   : 键盘 = 极短白噪瞬态（带通 ~1.9kHz）+ 约 2kHz 正弦点 ping；内部打字/回删节律触发
 *   文件 4   : 门的另一边 = 粉噪 → 带通 → 3 个共振峰 → 2–6Hz 幅度调制 → 900Hz 低通
 *   文件 5/7 : 只有房间底噪（不要数字静音）
 *   文件 6   : 闹钟 = 880/1174Hz 交替短正弦鸣，20ms 软起音，900Hz 低通（像隔壁房间）
 *   文件 8   : 玩具钢琴 = 正弦基音 + 三角波 + ×2.01 微失谐谐波 + ×3.1 不和谐泛音 + 塑料"咔"瞬态；
 *              5ms 起音、0.35–0.6s 指数衰减；轻卷积混响（程序化脉冲响应，空房间）
 *   按住     : 48Hz + 55.5Hz 双正弦嗡声 0.6s 内升起；mix 低通滑到 380Hz（被手捂住）；松开 0.8s 复原
 *
 * 电平：总线峰值被限幅器钉死在 -14.9dBFS 以下；环境声 RMS 约 -30 后半段量级；钢琴是全片最响。
 * 调度：100ms 前瞻 setInterval（music 用 ctx 绝对时间表排音符，不漂移；循环回绕按拍长累加）。
 */
(function (global) {
  'use strict';
  var LX = (global.LX = global.LX || {});
  if (LX.Audio) return; // 防止重复加载

  /* =====================================================================
   * 0. 常量
   * ===================================================================== */
  var LIMIT = 0.18;          // 总线硬限幅；0.18 = -14.9 dBFS（要求峰值 ≤ -14 dBFS）
  var LP_OPEN = 18000;       // 不按住时混音总线的低通
  var LP_HOLD = 380;         // 按住时低通滑到 380Hz
  var HOLD_DEPTH = 140;      // setDepth 再往下压的幅度
  var FADE_FILE = 0.6;       // setFile 交叉淡化
  var LOOKAHEAD = 0.18;      // 调度前瞻（秒）
  var TICK_MS = 100;         // 调度器间隔
  var MUSIC_LEVEL = 0.9;     // 钢琴总线电平
  var BED_GAIN = 0.13;       // 房间底噪增益（粉噪缓冲 RMS≈0.22，经高通/低通后约 -34dBFS RMS）
  var PINK_RMS = 0.22;       // 粉噪缓冲归一化 RMS
  var WHITE_RMS = 0.3;       // 白噪缓冲归一化 RMS
  var PINK_SECONDS = 4;      // 雨/底噪共用 4 秒无缝循环缓冲

  /* =====================================================================
   * 1. 小工具
   * ===================================================================== */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function noop() {}

  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) { var f = mulberry32(seed); return function () { return f(); }; }

  /* =====================================================================
   * 2. 噪声缓冲（Voss-Kellet 粉噪 / 白噪），可无缝循环
   *    4 秒循环的接缝用「尾段交叉淡化进头段」的方法做掉：生成 len+fade 个样本，
   *    把 [len, len+fade) 的尾音淡入 [0, fade)，于是 loop 回绕时波形连续。
   * ===================================================================== */
  function makeNoiseBuffer(ctx, seconds, kind, seed) {
    var sr = ctx.sampleRate || 44100;
    var len = Math.max(2, Math.floor(sr * seconds));
    var fade = Math.min(Math.floor(sr * 0.045), len >> 2);
    var total = len + fade;
    var rng = makeRng(seed || 1);
    var buf = ctx.createBuffer(2, len, sr);
    var targetRms = kind === 'white' ? WHITE_RMS : PINK_RMS;

    for (var ch = 0; ch < 2; ch++) {
      var tmp = new Float32Array(total);
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      var i, white;
      for (i = 0; i < total; i++) {
        white = (rng() * 2 - 1) * (kind === 'white' ? 1 : 1);
        if (kind === 'white') {
          tmp[i] = white;
        } else {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          tmp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        }
      }
      // 归一化到目标 RMS
      var sq = 0;
      for (i = 0; i < len; i++) sq += tmp[i] * tmp[i];
      var rms = Math.sqrt(sq / len) || 1;
      var scale = targetRms / rms;
      for (i = 0; i < total; i++) tmp[i] *= scale;

      // 循环接缝：head[i] = head[i]*(i/fade) + tail[i]*(1-i/fade)，tail = tmp[len..len+fade)
      var out = buf.getChannelData(ch);
      for (i = 0; i < len; i++) {
        if (i < fade) {
          var a = i / fade;
          out[i] = tmp[i] * a + tmp[len + i] * (1 - a);
        } else {
          out[i] = tmp[i];
        }
      }
    }
    return buf;
  }

  function getNoise(ctx, kind) {
    var cache = ctx.__lxNoise;
    if (!cache) { cache = ctx.__lxNoise = {}; }
    if (cache[kind]) return cache[kind];
    var buf;
    try {
      if (kind === 'white') buf = makeNoiseBuffer(ctx, 1, 'white', 0x1f2e3d4c);
      else buf = makeNoiseBuffer(ctx, PINK_SECONDS, 'pink', 0x51ed270b);
    } catch (e) {
      // 极端降级：给一个静音缓冲，绝不让上层拿到 null
      try { buf = ctx.createBuffer(2, Math.max(2, Math.floor((ctx.sampleRate || 44100) * 1)), ctx.sampleRate || 44100); }
      catch (e2) { buf = null; }
    }
    cache[kind] = buf;
    return buf;
  }

  /* =====================================================================
   * 3. 限幅曲线 & 房间脉冲响应（空房间的卷积混响）
   * ===================================================================== */
  function makeLimitCurve(limit) {
    var n = 4096;
    var curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      curve[i] = clamp(x, -limit, limit);
    }
    return curve;
  }

  function makeRoomIR(ctx) {
    var sr = ctx.sampleRate || 44100;
    var dur = 0.85;
    var len = Math.max(8, Math.floor(sr * dur));
    var buf = ctx.createBuffer(2, len, sr);
    var rng = makeRng(0x2f7a1b3d);
    var early = [[0.011, 0.55], [0.019, 0.38], [0.031, 0.26], [0.047, 0.18], [0.071, 0.12]];
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var lp = 0, i;
      for (i = 0; i < len; i++) {
        var t = i / sr;
        var env = Math.exp(-t * 4.6);
        var w = rng() * 2 - 1;
        lp += (w - lp) * 0.4;              // 一阶低通：暗一点的空房间
        d[i] = lp * env * 0.35;
      }
      for (var e = 0; e < early.length; e++) {
        var idx = Math.floor((early[e][0] + (ch ? 0.0017 : 0)) * sr);
        if (idx < len) d[idx] += early[e][1] * (ch ? -1 : 1);
      }
    }
    return buf;
  }

  // 软拐点限幅曲线：|x| ≤ knee 时完全线性，再往上平滑饱和到 ±limit。
  // 用在雨层上——压住噪声的尖峰（峰值≈-16.5dBFS）以便把持续 RMS 提上来，又不至于像硬削波那样发糊。
  function makeKneeCurve(limit, knee) {
    var n = 4096;
    var curve = new Float32Array(n);
    var span = Math.max(1e-6, limit - knee);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      var ax = x < 0 ? -x : x;
      var y = ax <= knee ? ax : knee + span * Math.tanh((ax - knee) / span);
      curve[i] = x < 0 ? -y : y;
    }
    return curve;
  }

  // 30–60ms 的极短房间 IR：雨打在窗台/地面时那一点点近场反射（湿 8%）
  function makeShortIR(ctx, seconds) {
    var sr = ctx.sampleRate || 44100;
    var len = Math.max(8, Math.floor(sr * seconds));
    var buf = ctx.createBuffer(2, len, sr);
    var rng = makeRng(0x6b1f9c3d);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / sr;
        var env = Math.exp(-t / (seconds * 0.34));
        lp += ((rng() * 2 - 1) - lp) * 0.55;
        d[i] = lp * env * 0.6;
      }
      // 两三个很短的早期反射
      var taps = ch ? [0.0021, 0.0067] : [0.0013, 0.0049, 0.0115];
      for (var k = 0; k < taps.length; k++) {
        var idx = Math.floor(taps[k] * sr);
        if (idx < len) d[idx] += (k % 2 ? -0.35 : 0.35);
      }
    }
    return buf;
  }

  /* =====================================================================
   * 4. 引擎工厂：同一套合成器，实时 & 离线共用
   * ===================================================================== */
  function createEngine(ctx, opts) {
    opts = opts || {};
    var E = { ctx: ctx, offline: !!opts.offline };
    var R = makeRng(0x6d2b79f5);         // 固定种子：离线渲染可复现，用于 FFT 断言
    E.rand = R;
    // 离线测试用：可单独开关雨的某一层（'bed' / 'drops' / 'surface'），方便数雨滴。不影响实时。
    var RAIN_CFG = opts.rain || {};

    /* ---------- 4.1 母线 ---------- */
    var master = ctx.createGain();
    master.gain.value = 1;

    var limiter = ctx.createWaveShaper();
    try {
      // 纯安全网：-16.5dBFS 以下完全线性（雨滴/钢琴的峰值都不会被压），
      // 只有接近总线上限的瞬时峰才平滑饱和到 ±0.18 ≈ -14.9dBFS。
      limiter.curve = makeKneeCurve(LIMIT, LIMIT * 0.83);
      limiter.oversample = 'none';
    } catch (e) {}

    var mix = ctx.createGain();
    mix.gain.value = 1;

    var holdLP = ctx.createBiquadFilter();
    holdLP.type = 'lowpass';
    holdLP.frequency.value = LP_OPEN;
    holdLP.Q.value = 0.55;

    mix.connect(holdLP);
    holdLP.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);

    /* ---------- 4.2 按住嗡声：常驻双正弦，增益默认为 0（setHold 只改增益，不新建节点）---------- */
    var humEnv = ctx.createGain();
    humEnv.gain.value = 0;
    var humBus = ctx.createGain();
    humBus.gain.value = 0.05;
    humEnv.connect(humBus);
    humBus.connect(master);              // 嗡声绕过 holdLP（低频本来就被闷，不需要再闷）

    var hum1 = ctx.createOscillator(); hum1.type = 'sine'; hum1.frequency.value = 48;
    var hum2 = ctx.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 55.5;
    var humG1 = ctx.createGain(); humG1.gain.value = 0.5;
    var humG2 = ctx.createGain(); humG2.gain.value = 0.36;
    hum1.connect(humG1); humG1.connect(humEnv);
    hum2.connect(humG2); humG2.connect(humEnv);
    try { hum1.start(); hum2.start(); } catch (e) {}

    /* ---------- 4.3 分总线 ---------- */
    var bedBus = ctx.createGain(); bedBus.gain.value = 0; bedBus.connect(mix);
    var fileBus = ctx.createGain(); fileBus.gain.value = 1; fileBus.connect(mix);
    var sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(mix);
    var musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(mix);
    var memoryBus = ctx.createGain(); memoryBus.gain.value = 0.9; memoryBus.connect(mix);

    // 钢琴/记忆/结尾最后那个音的轻混响（程序化 IR，零素材）
    var roomIR = null;
    try { roomIR = makeRoomIR(ctx); } catch (e) {}
    var convolver = ctx.createConvolver();
    var wet = ctx.createGain();
    wet.gain.value = (opts.wet == null) ? 0.18 : clamp(opts.wet, 0, 1);   // 离线探针可置 0 以隔离直达声
    try {
      if (roomIR) { convolver.buffer = roomIR; convolver.normalize = true; }
    } catch (e) {}
    try {
      musicBus.connect(convolver);
      memoryBus.connect(convolver);
      convolver.connect(wet);
      wet.connect(mix);
    } catch (e) {}

    // 结尾「最后一个错音」的独立总线：更远、更湿（20–25%），不受 musicStart/musicStop 影响
    var lastBus = ctx.createGain(); lastBus.gain.value = 1; lastBus.connect(mix);
    var lastConv = ctx.createConvolver();
    var lastWet = ctx.createGain(); lastWet.gain.value = 0.23;
    try {
      if (roomIR) { lastConv.buffer = roomIR; lastConv.normalize = true; }
      lastBus.connect(lastConv); lastConv.connect(lastWet); lastWet.connect(mix);
    } catch (e) {}

    /* ---------- 4.4 房间底噪 ---------- */
    var bedSrc = ctx.createBufferSource();
    bedSrc.buffer = getNoise(ctx, 'pink');
    bedSrc.loop = true;
    var bedHP = ctx.createBiquadFilter(); bedHP.type = 'highpass'; bedHP.frequency.value = 35;
    var bedLP = ctx.createBiquadFilter(); bedLP.type = 'lowpass'; bedLP.frequency.value = 850; bedLP.Q.value = 0.5;
    var bedGain = ctx.createGain(); bedGain.gain.value = BED_GAIN;
    // 极慢的呼吸：避免底噪听起来像数字循环
    var bedLfo = ctx.createOscillator(); bedLfo.frequency.value = 0.043;
    var bedLfoGain = ctx.createGain(); bedLfoGain.gain.value = BED_GAIN * 0.12;
    bedLfo.connect(bedLfoGain); bedLfoGain.connect(bedGain.gain);
    bedSrc.connect(bedHP); bedHP.connect(bedLP); bedLP.connect(bedGain); bedGain.connect(bedBus);
    try { bedSrc.start(); bedLfo.start(); } catch (e) {}

    /* ---------- 4.5 通用小工具 ---------- */
    function panNode(pan) {
      try {
        if (ctx.createStereoPanner) {
          var p = ctx.createStereoPanner();
          p.pan.value = clamp(pan, -1, 1);
          return p;
        }
      } catch (e) {}
      return ctx.createGain();
    }

    // 从 4s 粉噪/1s 白噪里随机取一段（不循环）
    function srcNoise(kind, when, dur, loop) {
      var s = ctx.createBufferSource();
      s.buffer = getNoise(ctx, kind);
      s.loop = !!loop;
      if (loop) {
        try { s.start(when); } catch (e) {}
      } else {
        var bd = s.buffer ? s.buffer.duration : 1;
        var d = Math.min(dur, Math.max(0.01, bd - 0.02));
        var off = R() * Math.max(0, bd - d - 0.005);
        try { s.start(when, off, d); } catch (e) {}
      }
      return s;
    }

    function fadeGainTo(node, value, when, fade) {
      try {
        var g = node.gain;
        g.cancelScheduledValues(when);
        g.setValueAtTime(g.value, when);
        g.linearRampToValueAtTime(value, when + Math.max(0.001, fade));
      } catch (e) {}
    }

    /* ---------- 4.6 层（每个文件的环境声）----------
     * 层内所有节点都接到 layer.gain，layer.gain 只负责 0.6s 交叉淡化。
     * L.sources 只登记「循环/长命」源，用于切走后 stop；一次性瞬态自己 stop，不进列表，避免泄漏。
     */
    var layers = [];

    function newLayer(id, when) {
      var g = ctx.createGain();
      g.gain.value = 0;
      g.connect(fileBus);
      try {
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(1, when + FADE_FILE);
      } catch (e) {}
      return { id: id, gain: g, sources: [], killAt: Infinity, schedule: noop };
    }

    function fadeLayer(L, when, fade) {
      fadeGainTo(L.gain, 0, when, fade);
      L.killAt = when + fade + 0.25;
    }

    function stopLayer(L) {
      try { L.gain.disconnect(); } catch (e) {}
      for (var i = 0; i < L.sources.length; i++) {
        try { L.sources[i].stop(); } catch (e) {}
        try { L.sources[i].disconnect(); } catch (e) {}
      }
      L.sources = [];
      L.schedule = noop;
    }

    /* ===== 文件 1：室内环境声 + 木质吱呀 ===== */
    function buildLayer1(when) {
      var L = newLayer(1, when);
      // 底噪由全局房间底噪提供；这一层只负责偶发的木头受力声
      var next = when + 2.2 + R() * 2.8;
      L.schedule = function (horizon) {
        var guard = 0;
        while (next <= horizon && guard++ < 64) {
          creak(next);
          next += 4 + R() * 5;           // 4–9 秒一次
        }
      };
      function creak(t) {
        // 木质吱呀：粉噪 → 窄带通（Q≈7）的中心频率从 240–420Hz 慢慢滑到更高，
        // 像木头受力的呻吟；30ms 起音，0.36s 指数衰减。
        var ns = srcNoise('pink', t, 0.45, false);
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 5;              // Q≈5：比纯音宽一点，像木头而不是哨子
        var f0 = 240 + R() * 180;
        var f1 = f0 + 160 + R() * 260;
        try {
          bp.frequency.setValueAtTime(f0, t);
          bp.frequency.linearRampToValueAtTime(f1, t + 0.3);
        } catch (e) {}
        var gg = ctx.createGain();
        // 窄带通后的粉噪本身已经很弱，包络峰值要开得很大才听得见（约 -30dBFS 瞬态）
        var pk = 0.34 + R() * 0.22;
        try {
          gg.gain.setValueAtTime(0.0001, t);
          gg.gain.exponentialRampToValueAtTime(pk, t + 0.03);
          gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
        } catch (e) {}
        ns.connect(bp); bp.connect(gg); gg.connect(L.gain);
        try { ns.stop(t + 0.45); } catch (e) {}
      }
      return L;
    }

    /* ===== 文件 2：雨 =====
     * 取向：床噪刻意退后、单滴刻意突出，不靠压缩凑响度。
     *   底噪层 : 4s 无缝粉噪 → 600–1800Hz 四阶带通 → 0.15–0.4Hz 慢速随机起伏，退成"远处的雨幕"（RMS ≈ -38dBFS）
     *   雨滴层 : 每秒 18–35 颗泊松水滴；每颗 = 0.5–2ms 硬起音 + 2–7kHz 带通 + 8–40ms 指数衰减，
     *            单颗峰值 -18~-20dBFS（比床噪高 15dB 以上），约 28% 附带 1.2–2kHz 短 resonant ping
     *   表面层 : 400–900Hz 的极轻"啪嗒"，每秒 1–3 次，峰值约 -30dBFS
     * 三层相加后只过一道安全限幅（-16.5dBFS 以下完全线性，峰值硬上限 -15.4dBFS），正常渲染不动作。
     * 再补 45ms/8% 的极短房间混响。
     */
    function buildLayer2(when) {
      var L = newLayer(2, when);
      var doBed = RAIN_CFG.bed !== false;
      var doDrops = RAIN_CFG.drops !== false;
      var doSurface = RAIN_CFG.surface !== false;

      // 三层汇合点 → 安全限幅（仅兜底）→ 响度对齐（+4dB）→ 层增益
      var sum = ctx.createGain(); sum.gain.value = 1;
      var lim = ctx.createWaveShaper();
      lim.curve = makeKneeCurve(0.17, 0.15);        // 纯安全网：-16.5dBFS 以下完全线性，峰值硬上限 -15.4dBFS
      lim.oversample = 'none';
      // 文件 2 的三层一起 +4dB：与其余 7 个文件（-29~-33 dBFS RMS）对齐，
      // 同时保持"单滴比床噪高 17.5dB"，不靠压缩凑响度。
      var boost = ctx.createGain();
      boost.gain.value = 1.48;      // +3.4dB：与其余文件对齐，同时让安全限幅几乎不动作
      var doLim = RAIN_CFG.limiter !== false;       // 离线测试可 bypass，用来量限幅器实际增益衰减
      if (doLim) { sum.connect(lim); lim.connect(boost); boost.connect(L.gain); }
      else { sum.connect(boost); boost.connect(L.gain); }

      /* ---- 底噪层：600–1800Hz 带通（两级，滚降更陡），刻意退到远处 ---- */
      if (doBed) {
        var src = srcNoise('pink', when, 0, true);
        var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600; hp.Q.value = 0.65;
        var hp2 = ctx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 600; hp2.Q.value = 0.65;
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = 0.55;
        var lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 1800; lp2.Q.value = 0.55;
        var mod = ctx.createGain(); mod.gain.value = 0.9;          // 慢速随机音量起伏（远处雨幕的潮汐）
        var bedLevel = ctx.createGain(); bedLevel.gain.value = 0.15;
        src.connect(hp); hp.connect(hp2); hp2.connect(lp); lp.connect(lp2); lp2.connect(mod);
        mod.connect(bedLevel); bedLevel.connect(sum);
        L.sources.push(src);

        // 0.15–0.4Hz 的慢速随机起伏：每 2–4.5s 抽一个新的目标音量，0.75s 时间常数接近一阶低通
        var nextMod = when + 0.5;
        var scheduleMod = function (horizon) {
          var guard = 0;
          while (nextMod <= horizon && guard++ < 128) {
            try { mod.gain.setTargetAtTime(0.62 + R() * 0.52, nextMod, 0.75); } catch (e) {}
            nextMod += 2 + R() * 2.5;
          }
        };
        L.scheduleMod = scheduleMod;
      }

      /* ---- 雨滴层：泊松颗粒 ---- */
      var rate = 24;                     // 每秒水滴数（18–35 之间慢变）
      var nextDrop = when + 0.06;
      var nextRate = when + 1.2;
      function drop(t) {
        // 大中小三档：主要差在亮度与衰减长度；单颗峰值都做到 -18~-20dBFS，
        // 这样才能比 -38dBFS 的床噪高出 15dB 以上，被清楚地听成"一颗一颗"。
        var u = R();
        var f, dec, pk;
        if (u < 0.55) {                  // 小雨滴：高频、短
          f = Math.exp(Math.log(4200) + R() * Math.log(7000 / 4200));
          dec = 0.008 + R() * 0.008;
          pk = 0.096 + R() * 0.010;      // -20.3..-19.4 dBFS
        } else if (u < 0.88) {           // 中雨滴
          f = Math.exp(Math.log(2800) + R() * Math.log(4200 / 2800));
          dec = 0.016 + R() * 0.012;
          pk = 0.104 + R() * 0.008;      // -19.7..-19.0 dBFS
        } else {                         // 大雨滴：低频、长尾巴
          f = Math.exp(Math.log(2000) + R() * Math.log(3000 / 2000));
          dec = 0.028 + R() * 0.012;
          pk = 0.112 + R() * 0.006;      // -19.0..-18.7 dBFS
        }
        var ns = srcNoise('white', t, Math.min(0.08, dec + 0.03), false);
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = 0.6 + R() * 0.8;    // 稍宽一点：噪声颗粒的"水感"更足
        var env = ctx.createGain();
        try {
          env.gain.setValueAtTime(0.0001, t);
          env.gain.exponentialRampToValueAtTime(pk, t + 0.0006 + R() * 0.0014);  // 0.5–2ms 硬起音
          env.gain.exponentialRampToValueAtTime(0.0001, t + dec);                // 8–40ms 衰减
        } catch (e) {}
        var p = panNode(R() * 1.4 - 0.7);
        ns.connect(bp); bp.connect(env); env.connect(p); p.connect(sum);
        try { ns.stop(t + dec + 0.03); } catch (e) {}
        // 部分水滴带一点短 resonant ping：水滴落在积水/金属上的"叮"
        if (R() < 0.28) {
          var o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = 1200 + R() * 800;     // 1.2–2kHz
          var og = ctx.createGain();
          try {
            og.gain.setValueAtTime(0.0001, t);
            og.gain.exponentialRampToValueAtTime(pk * 0.45, t + 0.002);
            og.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + R() * 0.02);
          } catch (e) {}
          o.connect(og); og.connect(p);
          try { o.start(t); o.stop(t + 0.055); } catch (e) {}
        }
      }
      function scheduleDrops(horizon) {
        var guard = 0;
        while (nextRate <= horizon && guard++ < 64) {
          rate = 18 + R() * 17;                     // 每秒 18–35 个
          nextRate += 2 + R() * 2;
        }
        guard = 0;
        while (nextDrop <= horizon && guard++ < 1024) {
          drop(nextDrop);
          nextDrop += -Math.log(1 - R() * 0.999) / rate;
        }
      }

      /* ---- 表面水声层：400–900Hz 极轻啪嗒，1–3 次/秒 ---- */
      var nextPat = when + 0.35;
      var patRate = 2;
      var nextPatRate = when + 1.5;
      function pat(t) {        var ns = srcNoise('white', t, 0.2, false);
        var bhp = ctx.createBiquadFilter(); bhp.type = 'highpass'; bhp.frequency.value = 400; bhp.Q.value = 0.7;
        var blp = ctx.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 900; blp.Q.value = 0.7;
        var gg = ctx.createGain();
        var pk = 0.024 + R() * 0.012;    // 约 -32..-28dBFS，和雨滴拉开层次
        try {
          gg.gain.setValueAtTime(0.0001, t);
          gg.gain.exponentialRampToValueAtTime(pk, t + 0.004 + R() * 0.004);
          gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07 + R() * 0.06);
        } catch (e) {}
        var p = panNode(R() * 1.2 - 0.6);
        ns.connect(bhp); bhp.connect(blp); blp.connect(gg); gg.connect(p); p.connect(sum);
        try { ns.stop(t + 0.18); } catch (e) {}
      }
      function schedulePats(horizon) {
        var guard = 0;
        while (nextPatRate <= horizon && guard++ < 64) {
          patRate = 1 + R() * 2;                    // 每秒 1–3 次
          nextPatRate += 2 + R() * 2;
        }
        guard = 0;
        while (nextPat <= horizon && guard++ < 256) {
          pat(nextPat);
          nextPat += -Math.log(1 - R() * 0.999) / patRate;
        }
      }

      /* ---- 极短房间混响：30–60ms，湿 8%（湿声也过安全限幅）---- */
      var shortIR = null;
      try { shortIR = makeShortIR(ctx, 0.045); } catch (e) {}
      var conv = ctx.createConvolver();
      var wet8 = ctx.createGain(); wet8.gain.value = 0.08;
      try {
        if (shortIR) { conv.buffer = shortIR; conv.normalize = true; }
        sum.connect(conv); conv.connect(wet8); wet8.connect(doLim ? lim : L.gain);
      } catch (e) {}

      L.schedule = function (horizon) {
        if (L.scheduleMod) { try { L.scheduleMod(horizon); } catch (e) {} }
        if (doDrops) { try { scheduleDrops(horizon); } catch (e) {} }
        if (doSurface) { try { schedulePats(horizon); } catch (e) {} }
      };
      return L;
    }

    /* ===== 文件 3：极轻键盘（打字/回删节律）===== */
    function buildLayer3(when) {
      var L = newLayer(3, when);
      var next = when + 0.45;
      var burst = 0;
      var lastIsDelete = false;
      var pauseUntil = when + 0.45;
      L.schedule = function (horizon) {
        var guard = 0;
        while (next <= horizon && guard++ < 256) {
          if (next < pauseUntil) { next = pauseUntil; continue; }
          if (burst <= 0) {
            burst = 3 + Math.floor(R() * 10);       // 一次打 3–12 下
            lastIsDelete = R() < 0.45;              // 这一段结束时回删
          }
          var isDel = (burst === 1 && lastIsDelete);
          keyClick(next, isDel);
          burst--;
          if (burst <= 0) {
            pauseUntil = next + 1.2 + R() * 2.6;    // 停下来，像在想下一句
            next = pauseUntil;
          } else {
            next += 0.08 + R() * 0.15;
          }
        }
      };
      function keyClick(t, isDel) {
        // 键盘：极短宽带瞬态（白噪 → 带通 ~1.9kHz，8–22ms）+ 约 2kHz 的塑料点 ping
        var ns = srcNoise('white', t, 0.03, false);
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = isDel ? 1250 : (1750 + R() * 500);
        bp.Q.value = 1.2;
        var ng = ctx.createGain();
        var pk = (isDel ? 0.018 : 0.015) + R() * 0.008;
        try {
          ng.gain.setValueAtTime(0.0001, t);
          ng.gain.exponentialRampToValueAtTime(pk, t + 0.0015);
          ng.gain.exponentialRampToValueAtTime(0.0001, t + (isDel ? 0.03 : 0.022));
        } catch (e) {}
        var p = panNode(R() * 0.5 - 0.25);
        ns.connect(bp); bp.connect(ng); ng.connect(p); p.connect(L.gain);
        try { ns.stop(t + 0.035); } catch (e) {}

        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = (isDel ? 1500 : 1950 + R() * 800);
        var og = ctx.createGain();
        try {
          og.gain.setValueAtTime(0.0001, t);
          og.gain.exponentialRampToValueAtTime(0.0035, t + 0.002);
          og.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        } catch (e) {}
        o.connect(og); og.connect(L.gain);
        try { o.start(t); o.stop(t + 0.04); } catch (e) {}
      }
      return L;
    }

    /* ===== 文件 4：隔着门的模糊欢呼 ===== */
    function buildLayer4(when) {
      var L = newLayer(4, when);
      var s = srcNoise('pink', when, 0, true);
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220; hp.Q.value = 0.6;
      var lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 1800; lp1.Q.value = 0.4;
      // 三个共振峰：人群的模糊元音堆叠（不采样任何人声）
      var f1 = ctx.createBiquadFilter(); f1.type = 'peaking'; f1.frequency.value = 480; f1.Q.value = 5; f1.gain.value = 5;
      var f2 = ctx.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 820; f2.Q.value = 6; f2.gain.value = 4;
      var f3 = ctx.createBiquadFilter(); f3.type = 'peaking'; f3.frequency.value = 1280; f3.Q.value = 5; f3.gain.value = 2;
      var lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 900; lp2.Q.value = 0.6;
      var am = ctx.createGain(); am.gain.value = 0.7;           // 被 2–6Hz LFO 调制
      var body = ctx.createGain(); body.gain.value = 0.125;     // 目标 RMS ≈ -31dBFS，别盖过别的
      s.connect(hp); hp.connect(lp1); lp1.connect(f1); f1.connect(f2); f2.connect(f3); f3.connect(lp2);
      lp2.connect(am); am.connect(body); body.connect(L.gain);
      // 幅度调制：2–6Hz 几个正弦叠加，像门后人群忽高忽低的声浪
      var l1 = ctx.createOscillator(); l1.frequency.value = 2.7;
      var l2 = ctx.createOscillator(); l2.frequency.value = 4.3;
      var l3 = ctx.createOscillator(); l3.frequency.value = 5.6;
      var sweep = ctx.createOscillator(); sweep.frequency.value = 0.09;
      var g1 = ctx.createGain(); g1.gain.value = 0.2;
      var g2 = ctx.createGain(); g2.gain.value = 0.12;
      var g3 = ctx.createGain(); g3.gain.value = 0.06;
      var gs = ctx.createGain(); gs.gain.value = 0.16;
      l1.connect(g1); g1.connect(am.gain);
      l2.connect(g2); g2.connect(am.gain);
      l3.connect(g3); g3.connect(am.gain);
      sweep.connect(gs); gs.connect(am.gain);
      try { l1.start(when); l2.start(when); l3.start(when); sweep.start(when); } catch (e) {}
      L.sources.push(s, l1, l2, l3, sweep);
      return L;
    }

    /* ===== 文件 6：隔壁房间的闹钟（880/1174Hz 交替短鸣）===== */
    function buildLayer6(when) {
      var L = newLayer(6, when);
      var next = when + 0.35;
      var period = 1.75;
      L.schedule = function (horizon) {
        var guard = 0;
        while (next <= horizon && guard++ < 128) {
          beep(next, 880);
          beep(next + 0.23, 1174);
          next += period;
        }
      };
      function beep(t, f) {
        // 软起音正弦短鸣 + 轻微失谐的第二只振铃 → 廉价电子闹钟的拍频，再过 900Hz 低通变闷
        var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 1.003;
        var mg = ctx.createGain(); mg.gain.value = 0.5;
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.7;
        var gg = ctx.createGain();
        var pk = 0.016;
        try {
          gg.gain.setValueAtTime(0.0001, t);
          gg.gain.exponentialRampToValueAtTime(pk, t + 0.02);
          gg.gain.setValueAtTime(pk, t + 0.075);
          gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        } catch (e) {}
        o.connect(mg); o2.connect(mg); mg.connect(lp); lp.connect(gg); gg.connect(L.gain);
        try { o.start(t); o.stop(t + 0.2); o2.start(t); o2.stop(t + 0.2); } catch (e) {}
      }
      return L;
    }

    function buildLayer(id, when) {
      try {
        if (id === 1) return buildLayer1(when);
        if (id === 2) return buildLayer2(when);
        if (id === 3) return buildLayer3(when);
        if (id === 4) return buildLayer4(when);
        if (id === 6) return buildLayer6(when);
      } catch (e) {}
      return null;
    }

    /* ---------- 4.7 玩具钢琴 ----------
     * 正弦基音 + 三角波（奇数泛音）+ ×2.01 微失谐正弦 + ×3.1 很轻的不和谐泛音，
     * 5ms 起音、0.35–0.6s 指数衰减，外加一个塑料"咔"的噪声瞬态。
     * 频点记录在 wrongVoices 里，musicRepair 直接改这些振荡器的 frequency（滑音）。
     */
    var wrongVoices = [];

    function addPianoNote(midi, when, info, o) {
      o = o || {};
      try {
        var f = midiToFreq(midi);
        var lvl = o.level == null ? 1 : o.level;
        var amp = 0.058 * (0.85 + R() * 0.3) * lvl;
        var decay = 0.38 + R() * 0.2;              // 0.35–0.58s
        var end = when + 0.005 + decay + 0.12;
        var dest = o.bus || musicBus;

        var out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, when);
        out.gain.linearRampToValueAtTime(amp, when + 0.005);
        out.gain.exponentialRampToValueAtTime(Math.max(0.00001, amp * 0.0012), when + 0.005 + decay);

        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = o.lp || 5200; lp.Q.value = 0.3;
        var hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 105;
        out.connect(hp); hp.connect(lp); lp.connect(dest);

        var oscs = [];
        function add(type, ratio, weight) {
          var osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.setValueAtTime(f * ratio, when);
          var og = ctx.createGain(); og.gain.value = weight;
          osc.connect(og); og.connect(out);
          try { osc.start(when); osc.stop(end); } catch (e) {}
          oscs.push({ osc: osc, ratio: ratio });
        }
        add('sine', 1.0, 0.56);       // 正弦基音
        add('triangle', 1.0, 0.30);   // 三角波：玩具钢琴的塑料味奇数泛音
        add('sine', 2.01, 0.10);      // 微失谐 2 次谐波
        add('sine', 3.1, 0.045);      // 很轻的不和谐泛音

        // 塑料"咔"：起音瞬间的一小段带通噪声
        var ns = srcNoise('white', when, 0.022, false);
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.4;
        var ng = ctx.createGain();
        try {
          ng.gain.setValueAtTime(0.0001, when);
          ng.gain.exponentialRampToValueAtTime(amp * 0.35, when + 0.0015);
          ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.02);
        } catch (e) {}
        ns.connect(bp); bp.connect(ng); ng.connect(dest);
        try { ns.stop(when + 0.03); } catch (e) {}

        var voice = { when: when, end: end, currentMidi: midi, oscs: oscs };
        if (info && info.wrong) wrongVoices.push(voice);
        return voice;
      } catch (e) { return null; }
    }

    // 滑音：把正在发声的错音从当前音高指数滑到目标音高（250–400ms）
    function glideVoice(v, targetMidi, at, dur) {
      var f1 = midiToFreq(targetMidi);
      for (var i = 0; i < v.oscs.length; i++) {
        var osc = v.oscs[i].osc;
        var ratio = v.oscs[i].ratio;
        var f0 = midiToFreq(v.currentMidi) * ratio;
        try {
          osc.frequency.cancelScheduledValues(at);
          osc.frequency.setValueAtTime(f0, at);
          osc.frequency.exponentialRampToValueAtTime(f1 * ratio, at + dur);
        } catch (e) {}
      }
      v.currentMidi = targetMidi;
    }

    function retuneVoiceNow(v, targetMidi) {
      var f = midiToFreq(targetMidi);
      for (var i = 0; i < v.oscs.length; i++) {
        try {
          var p = v.oscs[i].osc.frequency;
          p.cancelScheduledValues(v.when);
          p.setValueAtTime(f * v.oscs[i].ratio, v.when);
        } catch (e) {}
      }
      v.currentMidi = targetMidi;
    }

    /* ---------- 4.8 音乐调度 ---------- */
    var music = {
      playing: false,
      loop: false,
      active: false,      // 是否还要继续排音符
      idx: 0,
      loopStart: 0,       // 当前这一遍的绝对起点
      origin: 0           // 第一遍的绝对起点（musicTime 用）
    };
    E.music = music;
    var repairEnabled = false;

    function M() { return LX.Melody || null; }

    function scheduleMusic(horizon) {
      if (!music.active) return;
      var m = M();
      if (!m || !m.notes || !m.notes.length) { music.active = false; return; }
      var notes = m.notes;
      var total = m.duration;
      var now = ctx.currentTime;
      var guard = 0;
      while (music.active && guard++ < 512) {
        var n = notes[music.idx];
        if (!n) { music.active = false; break; }
        var when = music.loopStart + n.time;
        if (when > horizon) break;
        if (when >= now - 0.06) {   // 掉到过去的音符直接跳过（切后台回来时不追着补）
          var midi = (n.wrong && repairEnabled) ? m.rightMidi : n.midiPlayed;
          addPianoNote(midi, when, { wrong: n.wrong, index: n.i }, null);
        }
        music.idx++;
        if (music.idx >= notes.length) {
          if (!music.loop) { music.active = false; break; }
          music.idx = 0;
          music.loopStart += total;    // 累加整段时长：拍子连续、不漂移
        }
      }
    }

    /* ---------- 4.9 引擎方法 ---------- */
    E.currentFile = 0;
    E.endingMode = false;
    E.holdActive = false;
    E.depth = 0;
    // 玩具钢琴是否已"准备"（finalEnter）。离线渲染自动视为已准备。
    // 这样 story 在任何文件的按住里调用 musicStart(true) 都不会让钢琴提前响起。
    E.prepared = !!opts.offline;

    E.bedOn = function (on, when, fade) {
      var t = when == null ? ctx.currentTime : when;
      fadeGainTo(bedBus, on ? 1 : 0, t, fade == null ? 0.8 : fade);
    };

    E.setFile = function (id, when) {
      id = Math.round(id) || 0;
      id = clamp(id, 0, 8);
      var t = when == null ? ctx.currentTime : when;
      if (id === E.currentFile) return;         // 重复调用同一个 id 无副作用
      E.currentFile = id;
      for (var i = 0; i < layers.length; i++) fadeLayer(layers[i], t, FADE_FILE);
      layers = [];
      // 1..8 都有房间底噪；0 = 无。文件 2 例外：雨自带 45ms 近场混响与 400–900Hz 表面层，
      // 不再叠房间底噪（否则雨层峰值会被底噪顶高，也听不出"雨"自己的空间）。
      E.bedOn(id >= 1 && id !== 2, t, 0.8);
      if (id === 5 || id === 7 || id === 8) return;   // 5/7/8：只有底噪（8 的钢琴另走音乐总线）
      var L = buildLayer(id, t);
      if (L) layers.push(L);
    };

    E.setHold = function (active, when) {
      active = !!active;
      if (active === E.holdActive) return;      // 幂等：反复调用不堆叠、不咔嗒
      E.holdActive = active;
      var t = when == null ? ctx.currentTime : when;
      try {
        humEnv.gain.setTargetAtTime(active ? (1 + 0.35 * E.depth) : 0, t, active ? 0.16 : 0.22);
        holdLP.frequency.setTargetAtTime(active ? (LP_HOLD - HOLD_DEPTH * E.depth) : LP_OPEN, t, active ? 0.15 : 0.24);
      } catch (e) {}
    };

    E.setDepth = function (p) {
      p = clamp01(p);
      // 每帧调用：变化很小时直接跳过，只写 setTargetAtTime，绝不新建节点
      if (Math.abs(p - E.depth) < 0.02 && p !== 0 && p !== 1) return;
      E.depth = p;
      if (!E.holdActive) return;
      var t = ctx.currentTime;
      try {
        humEnv.gain.setTargetAtTime(1 + 0.35 * p, t, 0.12);
        holdLP.frequency.setTargetAtTime(LP_HOLD - HOLD_DEPTH * p, t, 0.12);
      } catch (e) {}
    };

    // 纸落：带通扫频噪声（纸面摩擦）+ 78Hz 低频"噗" + 一次小回弹
    E.paperDrop = function (when) {
      var t = when == null ? ctx.currentTime : when;
      try {
        var ns = srcNoise('white', t, 0.4, false);
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.Q.value = 0.9;
        bp.frequency.setValueAtTime(2400, t);
        bp.frequency.linearRampToValueAtTime(800, t + 0.18);
        var gg = ctx.createGain();
        gg.gain.setValueAtTime(0.0001, t);
        gg.gain.exponentialRampToValueAtTime(0.062, t + 0.006);
        gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        ns.connect(bp); bp.connect(gg); gg.connect(sfxBus);
        try { ns.stop(t + 0.24); } catch (e) {}

        var o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = 78;
        var olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 250;
        var og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.024, t + 0.004);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(olp); olp.connect(og); og.connect(sfxBus);
        try { o.start(t); o.stop(t + 0.14); } catch (e) {}

        // 回弹：第二下更轻的纸声
        var ns2 = srcNoise('white', t + 0.055, 0.18, false);
        var bp2 = ctx.createBiquadFilter();
        bp2.type = 'bandpass'; bp2.frequency.value = 1500; bp2.Q.value = 0.8;
        var gg2 = ctx.createGain();
        gg2.gain.setValueAtTime(0.0001, t + 0.055);
        gg2.gain.exponentialRampToValueAtTime(0.024, t + 0.062);
        gg2.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        ns2.connect(bp2); bp2.connect(gg2); gg2.connect(sfxBus);
        try { ns2.stop(t + 0.19); } catch (e) {}
      } catch (e) {}
    };

    E.musicLevel = function (fade) {
      fadeGainTo(musicBus, MUSIC_LEVEL, ctx.currentTime, fade == null ? 0.25 : fade);
    };

    E.musicStart = function (loop, when) {
      var m = M();
      if (!m) return;
      if (!E.prepared) return;            // 还没进第 8 个文件：玩具钢琴尚未准备，静默
      loop = !!loop;
      var t = when == null ? ctx.currentTime + 0.12 : when;
      // 幂等：已经在循环里就不要再重新起头（Lead 会反复调用）；
      // 单遍已弹完（musicTime 为 null）时允许重新开始。
      if (music.playing && music.loop === loop) {
        if (loop) return;
        if (E.musicTime() != null) return;
      }
      music.playing = true;
      music.loop = loop;
      music.active = true;
      music.idx = 0;
      music.loopStart = t;
      music.origin = t;
      E.musicLevel(0.25);
    };

    E.musicStop = function (fade) {
      music.playing = false;
      music.active = false;
      var f = fade == null ? 0.4 : Math.max(0.01, fade);
      try {
        var now = ctx.currentTime;
        var g = musicBus.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + f);
      } catch (e) {}
    };

    // 修复错音：正在响的那个做滑音；还没响的直接改成正确音高；之后的错音直接弹对
    E.repair = function (on, at) {
      repairEnabled = !!on;
      var m = M();
      if (!m) return;
      var t = (at == null) ? ctx.currentTime : at;
      var target = on ? m.rightMidi : m.wrongMidi;
      for (var i = 0; i < wrongVoices.length; i++) {
        var v = wrongVoices[i];
        if (v.end <= t) continue;
        if (v.currentMidi === target) continue;
        if (v.when > t + 0.02) {
          retuneVoiceNow(v, target);           // 还没开始：直接从目标音高弹出
        } else {
          glideVoice(v, target, t + 0.005, 0.32);   // 正在响：250–400ms 的刺耳滑音
        }
      }
    };

    E.endingStart = function () {
      E.endingMode = true;
      var t = ctx.currentTime;
      E.bedOn(false, t, 1.2);
      for (var i = 0; i < layers.length; i++) fadeLayer(layers[i], t, 1.2);
      fadeGainTo(sfxBus, 0, t, 1.2);
      // 按住状态放掉
      if (E.holdActive) {
        E.holdActive = false;
        try {
          humEnv.gain.setTargetAtTime(0, t, 0.2);
          holdLP.frequency.setTargetAtTime(LP_OPEN, t, 0.3);
        } catch (e) {}
      }
      E.musicLevel(1.2);
    };

    E.endingSongOnce = function () {
      var m = M();
      var dur = m ? m.duration : 16.24;
      E.prepared = true;
      E.repair(false);                 // 完整的错音
      E.musicLevel(0.2);
      // 强制从头弹一遍（不循环）；musicStart 的幂等检查需要绕开旧状态
      music.playing = true;
      music.loop = false;
      music.active = true;
      music.idx = 0;
      music.loopStart = ctx.currentTime + 0.12;
      music.origin = music.loopStart;
      return dur;
    };

    E.memorySong = function () {
      var m = M();
      if (!m || !m.notes) return;
      var t = ctx.currentTime + 0.25;
      for (var i = 0; i < 6 && i < m.notes.length; i++) {
        var n = m.notes[i];
        addPianoNote(n.midiRight, t + n.time, { wrong: false, index: n.i }, { level: 0.42, lp: 760, bus: memoryBus });
      }
    };

    // 结尾的「心头一颤」：歌放完之后，她弹错的那个音再响一次，然后消失。
    // 与歌同一套玩具钢琴音色（正弦+三角+×2.01+×3.1+塑料咔），但更轻（峰值≈-26dBFS）、
    // 更闷（低通 2.2kHz，像隔着房间/像回忆）、尾巴更长（3.15s）、混响更湿（23%）。
    // 独立一次性事件：不走调度器，不影响 musicStart / musicStop / musicRepair。
    E.lastNote = function (when) {
      try {
        var t = (when == null) ? ctx.currentTime + 0.04 : when;
        var f = midiToFreq(75);              // D#5 = 622.25Hz，那个错音
        var amp = 0.052;                     // 目标峰值 ≈ -26dBFS
        var decay = 3.15;                    // 整体包络 2.8–3.5s
        var out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, t);
        out.gain.linearRampToValueAtTime(amp, t + 0.006);
        out.gain.exponentialRampToValueAtTime(Math.max(0.00001, amp * 0.0005), t + 0.006 + decay);
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.Q.value = 0.45;
        var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
        out.connect(hp); hp.connect(lp); lp.connect(lastBus);
        var end = t + 0.006 + decay + 0.3;
        function addOsc(type, ratio, weight) {
          var o = ctx.createOscillator();
          o.type = type;
          o.frequency.setValueAtTime(f * ratio, t);
          var g = ctx.createGain(); g.gain.value = weight;
          o.connect(g); g.connect(out);
          try { o.start(t); o.stop(end); } catch (e) {}
        }
        addOsc('sine', 1.0, 0.56);       // 正弦基音
        addOsc('triangle', 1.0, 0.30);   // 三角波
        addOsc('sine', 2.01, 0.10);      // 微失谐 2 次谐波
        addOsc('sine', 3.1, 0.045);      // 不和谐泛音
        // 很轻的塑料咔（被 2.2kHz 低通磨掉大半）
        var ns = srcNoise('white', t, 0.02, false);
        var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.2;
        var ng = ctx.createGain();
        try {
          ng.gain.setValueAtTime(0.0001, t);
          ng.gain.exponentialRampToValueAtTime(amp * 0.22, t + 0.0015);
          ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
        } catch (e) {}
        ns.connect(bp); bp.connect(ng); ng.connect(lastBus);
        try { ns.stop(t + 0.03); } catch (e) {}
        // 若之前 silenceAll 把 lastBus 归零过，这里把总线恢复（一次性尾音，仅此一声）
        try {
          lastBus.gain.cancelScheduledValues(t);
          lastBus.gain.setValueAtTime(lastBus.gain.value, t);
          lastBus.gain.linearRampToValueAtTime(1, t + 0.05);
        } catch (e) {}
      } catch (e) {}
    };

    E.finalEnter = function () {
      E.prepared = true;               // 准备玩具钢琴：此后 musicStart 才真正发声
      E.repair(false);                 // 修复状态由进入第 8 个文件的剧情决定
      if (music.playing) E.musicLevel(0.3);
    };

    E.silenceAll = function (fade) {
      var f = fade == null ? 0.6 : Math.max(0.01, fade);
      var t = ctx.currentTime;
      music.playing = false;
      music.active = false;
      E.bedOn(false, t, f);
      fadeGainTo(fileBus, 0, t, f);
      fadeGainTo(sfxBus, 0, t, f);
      fadeGainTo(musicBus, 0, t, f);
      fadeGainTo(memoryBus, 0, t, f);
      fadeGainTo(lastBus, 0, t, f);
      for (var i = 0; i < layers.length; i++) fadeLayer(layers[i], t, f);
      if (E.holdActive) {
        E.holdActive = false;
        try {
          humEnv.gain.setTargetAtTime(0, t, 0.2);
          holdLP.frequency.setTargetAtTime(LP_OPEN, t, 0.3);
        } catch (e) {}
      }
    };

    E.handleResume = function () {
      // suspend/resume 时 ctx.currentTime 也会冻结，music 时钟本来就不用重置。
      // 只有计时器被长时间节流、调度器落后一整遍以上时才重新对齐，避免一口气补过期音符。
      var m = M();
      if (!m || !music.playing) return;
      var total = m.duration || 16.24;
      if (music.loop) {
        var behind = ctx.currentTime - music.loopStart;
        if (behind > total || behind < -0.5) {
          music.idx = 0;
          music.loopStart = ctx.currentTime + 0.1;
          music.origin = music.loopStart;
          music.active = true;
        }
      } else if (ctx.currentTime - music.origin > total) {
        music.active = false;
      }
    };

    E.musicTime = function () {
      var m = M();
      if (!m || !music.playing) return null;
      var pos = ctx.currentTime - music.origin;
      if (pos < 0) return null;
      if (music.loop) {
        var total = m.duration;
        if (!(total > 0)) return null;
        return pos % total;                      // 循环时取模，返回当前这一遍的秒数
      }
      if (pos > m.duration) return null;          // 单遍已弹完
      return pos;
    };

    E.tick = function () {
      var t = ctx.currentTime;
      E.scheduleAll(t + LOOKAHEAD);
      // 清理已淡出的层
      for (var i = layers.length - 1; i >= 0; i--) {
        if (t > layers[i].killAt) { stopLayer(layers[i]); layers.splice(i, 1); }
      }
      // 清理过期的错音记录
      for (var j = wrongVoices.length - 1; j >= 0; j--) {
        if (t > wrongVoices[j].end + 0.5) wrongVoices.splice(j, 1);
      }
    };

    E.scheduleAll = function (horizon) {
      if (!E.endingMode) {
        for (var i = 0; i < layers.length; i++) {
          try { layers[i].schedule(horizon); } catch (e) {}
        }
      }
      scheduleMusic(horizon);
    };

    // 供离线「修复滑移」探针：在绝对时刻 at 对已排程的错音做滑音
    E.glideWrongAt = function (at) {
      var m = M();
      if (!m) return;
      for (var i = 0; i < wrongVoices.length; i++) {
        var v = wrongVoices[i];
        if (v.when < at && v.end > at && v.currentMidi !== m.rightMidi) {
          glideVoice(v, m.rightMidi, at, 0.32);
        }
      }
      repairEnabled = true;
    };

    return E;
  }

  /* =====================================================================
   * 5. 公共 API（LX.Audio）
   * ===================================================================== */
  var A = {};
  var ctx = null;
  var engine = null;
  var state = 'uninitialized';
  var tickTimer = null;
  var unlockedOnce = false;
  var pendingFile = 0;
  var pendingHold = false;
  var pendingRepair = false;
  var pendingMusic = null;    // null / true(loop) / false(once)
  var pendingEnding = false;
  var pendingFinalEnter = false;

  function A_try(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function melodyDuration() {
    return (LX.Melody && LX.Melody.duration) || 16.24;
  }

  function onRunning() {
    if (!engine) return;
    try { engine.handleResume(); } catch (e) {}
  }

  function startTicker() {
    if (tickTimer || !engine) return;
    tickTimer = global.setInterval(function () {
      try {
        if (!engine || state !== 'running') return;
        engine.tick();
      } catch (e) {}                 // 调度器永不抛异常
    }, TICK_MS);
  }

  A.unlock = function () {
    if (state === 'failed') return;
    try {
      if (!ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) { state = 'failed'; return; }
        ctx = new AC();
        try {
          engine = createEngine(ctx, { offline: false });
        } catch (e) {
          engine = null;
          state = 'failed';
          return;
        }
        state = (ctx.state === 'running') ? 'running' : 'suspended';
        try {
          ctx.onstatechange = function () {
            try {
              if (ctx.state === 'running') { state = 'running'; onRunning(); }
              else if (ctx.state === 'suspended') state = 'suspended';
              else if (ctx.state === 'closed') state = 'failed';
            } catch (e) {}
          };
        } catch (e) {}

        // 把 unlock 之前就排队的意图补上（finalEnter 必须在 musicStart 之前）
        if (pendingFinalEnter) { pendingFinalEnter = false; engine.finalEnter(); }
        if (pendingFile) engine.setFile(pendingFile);
        if (pendingHold) engine.setHold(true);
        if (pendingRepair) engine.repair(true);
        startTicker();
      }

      if (ctx.state === 'suspended') {
        var pr = ctx.resume();
        if (pr && pr.then) {
          pr.then(function () {
            state = (ctx.state === 'running') ? 'running' : 'suspended';
            if (state === 'running') onRunning();
          }, function () { state = 'suspended'; });
        }
      } else if (ctx.state === 'running') {
        state = 'running';
      }

      // iOS：必须在用户手势里播一个 1 sample 的静音 buffer 才能真解锁（只做一次）
      if (!unlockedOnce) {
        try {
          var b = ctx.createBuffer(1, 1, ctx.sampleRate);
          var s = ctx.createBufferSource();
          s.buffer = b;
          s.connect(ctx.destination);
          s.start(0);
        } catch (e) {}
        unlockedOnce = true;
      }

      if (pendingMusic !== null) {
        var pm = pendingMusic;
        pendingMusic = null;
        engine.musicStart(pm);
      }
      if (pendingEnding) {
        pendingEnding = false;
        A.endingSongOnce();
      }
    } catch (e) {
      state = 'failed';
    }
  };

  A.suspend = function () {
    A_try(function () {
      if (!ctx) return;
      var p = ctx.suspend();
      if (p && p.then) p.then(function () { state = 'suspended'; }, noop);
    });
  };

  A.resume = function () {
    A_try(function () {
      if (!ctx) return;
      var p = ctx.resume();
      if (p && p.then) {
        p.then(function () {
          state = (ctx.state === 'running') ? 'running' : 'suspended';
          if (state === 'running') onRunning();
        }, noop);
      }
    });
  };

  A.setFile = function (id) {
    A_try(function () {
      id = Math.round(id) || 0;
      id = clamp(id, 0, 8);
      pendingFile = id;
      if (engine) engine.setFile(id);
    });
  };

  A.setHold = function (active) {
    A_try(function () {
      active = !!active;
      pendingHold = active;
      if (engine) engine.setHold(active);
    });
  };

  A.setDepth = function (p) {
    A_try(function () { if (engine) engine.setDepth(p); });
  };

  A.paperDrop = function () {
    A_try(function () { if (engine) engine.paperDrop(); });
  };

  A.finalEnter = function () {
    A_try(function () {
      if (engine) engine.finalEnter();
      else pendingFinalEnter = true;
    });
  };

  A.musicStart = function (loop) {
    A_try(function () {
      loop = !!loop;
      if (!engine) { pendingMusic = loop; return; }
      pendingMusic = null;
      engine.musicStart(loop);
    });
  };

  A.musicStop = function (fadeSec) {
    A_try(function () {
      if (engine) engine.musicStop(fadeSec);
    });
  };

  A.musicRepair = function (on) {
    A_try(function () {
      pendingRepair = !!on;
      if (engine) engine.repair(!!on);
    });
  };

  A.musicTime = function () {
    return A_try(function () { return engine ? engine.musicTime() : null; }, null);
  };

  A.endingStart = function () {
    A_try(function () { if (engine) engine.endingStart(); });
  };

  A.endingSongOnce = function () {
    var dur = melodyDuration();
    A_try(function () {
      if (!engine) { pendingEnding = true; return; }
      engine.endingSongOnce();
    });
    return dur;
  };

  A.memorySong = function () {
    A_try(function () { if (engine) engine.memorySong(); });
  };

  // 结尾「最后一个错音」：单发，一次，只响一次；未 unlock 时静默返回
  A.lastNote = function () {
    A_try(function () { if (engine) engine.lastNote(); });
  };

  A.silenceAll = function (fadeSec) {
    A_try(function () { if (engine) engine.silenceAll(fadeSec); });
  };

  /* =====================================================================
   * 6. renderOffline：同一套引擎在 OfflineAudioContext 里离线渲染
   *    mode = 'wrong' | 'repaired'（约 8 秒，够覆盖第 10 拍错音）
   *    可选 opts（dev/测试用，不影响 SPEC 签名）：
   *      duration, file, music, loop, bed, repair, repairAt, hold, events
   * ===================================================================== */
  A.renderOffline = function (mode, options) {
    return new Promise(function (resolve) {
      try {
        var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        if (!OAC) { resolve(null); return; }
        mode = (mode === 'repaired') ? 'repaired' : 'wrong';
        var o = options || {};
        var duration = o.duration || 8;
        var sr = o.sampleRate || 48000;
        var frames = Math.max(64, Math.ceil(duration * sr));
        var oac = null;
        try { oac = new OAC(2, frames, sr); }
        catch (e) {
          try { oac = new OAC(1, frames, 44100); } catch (e2) { resolve(null); return; }
        }
        var eng = createEngine(oac, { offline: true, wet: o.wet, rain: o.rain });
        var wantMusic = (o.music === undefined) ? true : !!o.music;

        if (o.file) eng.setFile(o.file, 0);
        if (o.bed === false) eng.bedOn(false, 0, 0.05);

        if (wantMusic) {
          eng.musicStart(!!o.loop, 0);
          if (mode === 'repaired' || o.repair) eng.repair(true, 0);
        }
        // 额外事件（dev 用）：paperDrop / hold / endingStart / silenceAll / musicStart / musicStop
        if (o.events && o.events.length) {
          for (var ei = 0; ei < o.events.length; ei++) {
            var ev = o.events[ei] || {};
            var at = (ev.at == null) ? 0 : ev.at;
            try {
              if (ev.type === 'paperDrop') eng.paperDrop(at);
              else if (ev.type === 'hold') eng.setHold(!!ev.on, at);
              else if (ev.type === 'file') eng.setFile(ev.id, at);
              else if (ev.type === 'lastNote') eng.lastNote(at);
              else if (ev.type === 'endingStart') eng.endingStart();
              else if (ev.type === 'silenceAll') eng.silenceAll(ev.fade);
              else if (ev.type === 'musicStart') eng.musicStart(!!ev.loop, at);
              else if (ev.type === 'musicStop') eng.musicStop(ev.fade);
            } catch (e3) {}
          }
        }
        if (o.hold) {
          eng.setHold(true, o.hold.at == null ? 0 : o.hold.at);
          if (o.hold.offAt != null) eng.setHold(false, o.hold.offAt);
        }
        eng.scheduleAll(duration + 1.5);
        if (o.repairAt != null) eng.glideWrongAt(o.repairAt);

        var p = oac.startRendering();
        if (p && p.then) p.then(function (buf) { resolve(buf); }, function () { resolve(null); });
        else resolve(null);
      } catch (e) {
        resolve(null);   // 永不抛异常
      }
    });
  };

  /* =====================================================================
   * 7. 状态属性 & 页面可见性
   * ===================================================================== */
  Object.defineProperty(A, 'state', {
    get: function () { return state; },
    enumerable: true
  });

  // 页面不可见时暂停；回来时恢复（幂等，不依赖外部调用方）
  A_try(function () {
    if (global.document && global.document.addEventListener) {
      global.document.addEventListener('visibilitychange', function () {
        A_try(function () {
          if (!ctx) return;
          if (global.document.hidden) A.suspend();
          else A.resume();
        });
      });
    }
  });

  LX.Audio = A;
})(window);
