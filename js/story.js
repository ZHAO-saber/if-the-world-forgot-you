/* 《如果世界忘记了你》— story.js
 * 状态机 + 文案 + 时间轴。整件作品的情绪节奏都在这里。
 *
 *  prelude → idle ⇄ holding → recovering
 *                     ↓
 *                  deleted → reveal → …（8 个文件）
 *  第 7 个删完后：interlude（8s，不可交互）→ final（第 8 个，永远删不完）
 *  final 上累计按住 > 3s 后松手 → ending（白色，不可交互）
 */
(function (global) {
  'use strict';
  var LX = (global.LX = global.LX || {});
  var U = LX.U;

  /* ---------------- 8 个文件 ---------------- */
  var FILES = [
    { id: 1, hold: 2300, res: 0.000, final: false },  // 早餐照片
    { id: 2, hold: 2300, res: 0.004, final: false },  // 雨声
    { id: 3, hold: 2450, res: 0.008, final: false },  // 未发送的消息
    { id: 4, hold: 2550, res: 0.013, final: false },  // 生日录像
    { id: 5, hold: 2600, res: 0.018, final: false },  // 搜索记录
    { id: 6, hold: 2700, res: 0.023, final: false },  // 闹钟
    { id: 7, hold: 2800, res: 0.028, final: false },  // 购物车
    { id: 8, hold: Infinity, res: 0.034, final: true } // 生日歌
  ];

  var META_FALLBACK = {
    1: 'IMG_2291.jpg · 3 月 14 日 07:42 · 未分享',
    2: '录音 047 · 0:04 · 无标题',
    3: '草稿 · 最后编辑于 412 天前',
    4: 'VID_0619.mp4 · 播放次数：0',
    5: '搜索记录 · 共 1,284 条',
    6: '闹钟 · 已响铃 1,096 次',
    7: '购物车 · 1 件商品',
    8: '录音 · 发送给：妈妈 · 已读'
  };

  var SYS_FINAL = [
    [3000, '正在删除最后一个文件……'],
    [6000, '检测到关联数据：2,417 位用户'],
    [10000, '继续删除将同时移除他们记忆中的部分内容']
  ];

  var BASE_DELETED = 31200;

  /* ---------------- 状态 ---------------- */
  var S = {
    phase: 'boot',
    phaseT: 0,
    t: 0,
    fileIdx: 0,
    p: 0,
    pBase: 0,
    reveal: 0,
    exposure: 0,
    hasCard: false,
    holding: false,
    held: 0,
    holdTotal: 0,
    deleted: 0,
    recFrom: 0,
    fragA: 0,
    fragTarget: 0,
    repaired: false,
    musicT: 0,
    musicStartT: 0,
    musicOn: false,
    ghostImg: 0,
    sysShown: 0,
    hintAt: -1,
    endingT: 0,
    endingStep: 0,
    motesA: 0,
    hooks: {},
    timeline: [],
    memory: false,
    boot: true
  };

  var dom = {};

  function $(id) { return document.getElementById(id); }

  function fade(el, v, ms) {
    if (!el) return;
    if (ms != null) el.style.transition = 'opacity ' + ms + 'ms ease';
    el.style.opacity = String(v);
  }

  function log(event, extra) {
    S.timeline.push({ t: Math.round(S.t * 1000), event: event, phase: S.phase, file: S.fileIdx });
    if (S.timeline.length > 400) S.timeline.shift();
  }

  /* ---------------- 音频（全部安全调用） ---------------- */
  function A(name, a1, a2, a3) {
    var M = LX.Audio;
    if (!M || typeof M[name] !== 'function') return undefined;
    try { return M[name](a1, a2, a3); } catch (e) { console.warn('[audio]', name, e); }
  }

  /* ---------------- 文案 ---------------- */
  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function updateCounter() {
    if (S.memory) {
      dom.counter.innerHTML = '剩余：<span class="num">1</span>';
    } else {
      dom.counter.innerHTML = '已删除 <span class="num">' + fmt(BASE_DELETED + S.deleted) + '</span>';
    }
  }

  function setMeta(id) {
    var text = (LX.Art && LX.Art.META && LX.Art.META[id]) || META_FALLBACK[id] || '';
    fade(dom.meta, 0, 260);
    setTimeout(function () {
      dom.meta.textContent = text;
      fade(dom.meta, 1, 700);
    }, 280);
  }

  function clearSys() {
    if (dom.sys) dom.sys.innerHTML = '';
    S.sysShown = 0;
  }

  function addSysLine(text) {
    if (!dom.sys) return;
    var d = document.createElement('div');
    d.className = 'sl';
    d.textContent = text;
    dom.sys.appendChild(d);
    // 触发淡入
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { d.style.opacity = '0.92'; });
    });
  }

  function checkFinalSys() {
    for (var i = 0; i < SYS_FINAL.length; i++) {
      if (S.sysShown <= i && S.holdTotal >= SYS_FINAL[i][0]) {
        addSysLine(SYS_FINAL[i][1]);
        S.sysShown = i + 1;
        log('sys:' + i);
      }
    }
  }

  /* ---------------- 文件切换 ---------------- */
  function enterFile(idx, opts) {
    opts = opts || {};
    S.fileIdx = idx;
    var f = FILES[idx];
    S.p = f.res;
    S.pBase = 0;
    S.held = 0;
    S.holdTotal = 0;
    S.reveal = opts.instant ? 1 : 0;
    S.hasCard = true;
    S.repaired = false;
    S.fragTarget = 0;
    S.phase = opts.instant ? 'idle' : 'reveal';
    S.phaseT = 0;
    S.musicOn = false;
    clearSys();
    fade(dom.hint, 0, 300);
    setMeta(f.id);
    log('enterFile:' + f.id);
    if (S.hooks.onFile) S.hooks.onFile(f.id);
    A('setFile', f.id);
    if (f.final) {
      A('finalEnter');
      A('musicStart', true);
      S.musicOn = true;
      S.musicStartT = S.t;
      S.musicT = 0;
    }
  }

  function completeFile() {
    S.p = 1;
    S.phase = 'deleted';
    S.phaseT = 0;
    S.holding = false;
    S.deleted++;
    S.fragTarget = 0;
    updateCounter();
    A('setHold', false);
    A('paperDrop');
    A('setFile', 0);
    log('deleted:' + FILES[S.fileIdx].id);
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
    var canvas = (S.hooks.getCardCanvas && S.hooks.getCardCanvas()) || null;
    var rect = (S.hooks.getCardRect && S.hooks.getCardRect()) || { x: 0, y: 0, w: 10, h: 10 };
    if (LX.Layers) {
      LX.Layers.setSheets(S.deleted);
      LX.Layers.dropSheet(rect, canvas, function () {
        if (LX.Layers) LX.Layers.setSheets(S.deleted);
      });
    }
    fade(dom.meta, 0, 500);
  }

  function advance() {
    if (S.fileIdx === 6) {
      // 第 7 个删完 → 过场
      S.phase = 'interlude';
      S.phaseT = 0;
      S.hasCard = false;
      S.reveal = 0;
      S.p = 0;
      clearSys();
      if (LX.Layers) LX.Layers.setFragmentsAlpha(0);
      fade(dom.interlude, 1, 1800);
      fade(dom.interlude.querySelector('.i2'), 0, 10);
      fade(dom.interlude.querySelector('.i3'), 0, 10);
      log('interlude');
    } else if (S.fileIdx < 6) {
      enterFile(S.fileIdx + 1);
    }
  }

  /* ---------------- 结局 ---------------- */
  function startEnding() {
    S.phase = 'ending';
    S.phaseT = 0;
    S.endingT = 0;
    S.endingStep = 0;
    S.holding = false;
    S.repaired = false;
    S.recFrom = S.p;
    S.fragTarget = 0.85;
    S.ghostImg = 0;
    S.lastNoteDone = false;
    S.restartShown = false;
    log('ending');
    try { localStorage.setItem('linxia.seen', '1'); } catch (e) {}
    S.memory = false;
    A('setHold', false);
    A('musicRepair', false);
    A('musicStop', 0.7);
    A('endingStart');
    clearSys();
    fade(dom.sys, 0, 1400);
    fade(dom.meta, 0, 1200);
    fade(dom.counter, 0, 1600);
    fade(dom.hint, 0, 600);
    fade(dom.prelude, 0, 600);
    fade(dom.interlude, 0, 600);
    fade(dom.ending, 1, 1200);
  }

  function updateEnding(dt) {
    S.endingT += dt;
    var t = S.endingT;

    // 画面恢复（她被放过了）：慢一点，让她真的回来
    var k = U.clamp01((t - 0.1) / 2.6);
    S.p = S.recFrom * (1 - U.easeInOutCubic(k));
    if (k >= 1) S.p = FILES[7].res;

    // 歌：0.5s 起，从头完整一遍（带错音），约 16.2s
    if (S.endingStep < 1 && t >= 0.5) {
      S.endingStep = 1;
      S.musicStartT = S.t;
      A('endingSongOnce');
      log('songOnce');
    }
    if (S.endingStep >= 1) {
      S.musicT = Math.max(0, S.t - S.musicStartT);
    }

    // 碎片：先回来，再被白光一起吞掉
    S.fragTarget = k >= 0.9
      ? 0.95 * (1 - U.clamp01((t - 4.5) / 4.5))
      : 0.55;

    // 让恢复后的照片多停一会儿（0.1~4.0s 完全不白），再开始从中间往外烧开；
    // 照片比桌面先走一步（着色器里卡片区域的过曝更快），于是先消失的是她。
    S.exposure = U.easeInOutCubic(U.clamp01((t - 4.0) / 7.0));

    // 三行字（加一条系统日志）：跟着白光一点点浮出来
    if (S.endingStep < 2 && t >= 7.6) { S.endingStep = 2; fade(dom.e1, 1, 3400); log('e1'); }
    if (S.endingStep < 3 && t >= 10.2) { S.endingStep = 3; fade(dom.e2, 1, 3400); log('e2'); }
    if (S.endingStep < 4 && t >= 11.9) {
      S.endingStep = 4;
      if (dom.e2b) fade(dom.e2b, 0.95, 2400);
      log('e2b');
    }
    if (S.endingStep < 5 && t >= 13.4) { S.endingStep = 5; fade(dom.e3, 1, 3400); log('e3'); }

    // 全白之前把前几行收回，最后一行再久一点
    if (t >= 15.6) {
      fade(dom.e1, 0, 3400);
      fade(dom.e2, 0, 3400);
    }
    if (t >= 16.8 && dom.e2b) fade(dom.e2b, 0, 2600);
    if (t >= 17.6) fade(dom.e3, 0, 3400);

    // 灰尘 + 纸堆淡出
    S.motesA = U.clamp01((t - 9.5) / 8.5);
    if (LX.Layers) {
      LX.Layers.setMotes(true, S.motesA, 0);
      LX.Layers.setPileAlpha(1 - U.clamp01(t / 1.3));
      LX.Layers.setFragmentsAlpha(S.fragA);
    }

    if (t >= 12.0) fade(dom.interlude, 0, 400);

    // 最后一问：歌放完（约 16.7s）之后，先留一段真正的安静
    if (S.endingStep < 6 && t >= 22.0) {
      S.endingStep = 6;
      fade(dom.e4, 1, 6200);
      log('e4');
      S.phase = 'white';
      S.phaseT = 0;
    }
  }

  /* ---------------- 记忆（再次打开） ---------------- */
  function startMemory() {
    S.memory = true;
    S.phase = 'memory';
    S.phaseT = 0;
    S.hasCard = false;
    S.reveal = 0;
    S.p = 0;
    S.exposure = 0.96;
    S.boot = false;
    updateCounter();
    fade(dom.counter, 1, 3000);
    fade(dom.ending, 1, 2000);
    fade(dom.e4, 0.5, 8000);
    fade(dom.e1, 0, 10);
    fade(dom.e2, 0, 10);
    fade(dom.e3, 0, 10);
    if (LX.Layers) {
      LX.Layers.reset();
      LX.Layers.setMotes(true, 0.0);
    }
    log('memory');
    var startSong = function () {
      if (S.songStarted) return;
      A('unlock');
      var st = (LX.Audio && LX.Audio.state) || 'none';
      if (st !== 'running') return;   // 还没解锁（自动播放被拦），留给下一次手势
      S.songStarted = true;
      A('memorySong');
    };
    setTimeout(startSong, 400);
    window.addEventListener('pointerdown', startSong, { passive: true });
    window.addEventListener('keydown', startSong, { passive: true });
  }

  function updateMemory(dt) {
    S.phaseT += 0;
    S.exposure = Math.min(1, S.exposure + dt * 0.012);
    S.motesA = Math.min(1, S.motesA + dt * 0.22);
    if (LX.Layers) {
      // 回访时的灰尘：很久之后也开始慢慢落定
      LX.Layers.setMotes(true, S.motesA, U.clamp01((S.phaseT - 18) / 40));
      LX.Layers.setFragmentsAlpha(0);
      LX.Layers.setSheets(0);
    }
    if (S.phaseT > 8 && !S.restartShown) {
      S.restartShown = true;
      dom.restart.classList.add('on');
    }
  }

  /* ---------------- 开场 ---------------- */
  function startPrelude() {
    S.phase = 'prelude';
    S.phaseT = 0;
    S.boot = false;
    S.hasCard = true;
    S.fileIdx = 0;
    S.p = 0;
    S.reveal = 0;
    S.deleted = 0;
    updateCounter();
    fade(dom.counter, 1, 2200);
    if (S.hooks.onFile) S.hooks.onFile(1);
    // 开场不显示元数据：卡片下面留给「她是谁 / 已经删了多少 / 你要做什么」
    dom.meta.textContent = (LX.Art && LX.Art.META && LX.Art.META[1]) || META_FALLBACK[1];
    fade(dom.meta, 0, 10);
    log('prelude');
    // 四行字依次落下：她是谁 / 系统已经删了多少 / 还剩多少 / 你该做什么
    var pl0 = dom.prelude.querySelector('.l0');
    var pl1 = dom.prelude.querySelector('.l1');
    var pl2 = dom.prelude.querySelector('.l2');
    setTimeout(function () { fade(dom.prelude, 1, 400); }, 350);
    setTimeout(function () { fade(pl0, 0.72, 2000); }, 700);
    setTimeout(function () { fade(pl1, 1, 2000); }, 1500);
    setTimeout(function () { fade(pl2, 1, 1800); }, 2500);
  }

  function updatePrelude(dt) {
    var t = S.phaseT;
    // 照片自己褪到一半，停住，再重新显影
    S.reveal = 0.66 * U.easeOutCubic(U.clamp01(t / 1.7));
    S.reveal = Math.min(1, S.reveal + 0.34 * U.smoothstep(1.7, 5.2, t));

    if (t > 2.7) {
      var d = U.clamp01((t - 2.7) / 1.35);
      S.p = 0.46 * U.easeInOutCubic(d);
    }
    if (t > 4.15) {
      var r = U.clamp01((t - 4.15) / 1.5);
      S.p = 0.46 * (1 - U.easeInOutCubic(r));
    }
    if (t > 6.0) S.p = 0;
  }

  /* ---------------- 输入 ---------------- */
  function beginHold(src) {
    var f = FILES[S.fileIdx];
    S.phase = f.final ? 'finalHold' : 'holding';
    S.phaseT = 0;
    S.held = 0;
    S.holding = true;
    S.pBase = S.p;
    S.hintAt = -1;
    fade(dom.hint, 0, 300);
    fade(dom.prelude, 0, 1000);
    if (dom.meta) setTimeout(function () { fade(dom.meta, 1, 1100); }, 700);
    A('unlock');
    A('setFile', f.id);
    A('setHold', true);
    if (f.final) {
      S.repaired = true;
      A('musicStart', true);
      A('musicRepair', true);
      S.fragTarget = 0.9;
      if (!S.musicOn) {
        S.musicOn = true;
        S.musicStartT = S.t;
      }
    }
    log('press:' + f.id);
  }

  S.press = function (src) {
    if (S.boot) return;
    switch (S.phase) {
      case 'prelude':
      case 'idle':
      case 'reveal':
      case 'recovering':
      case 'final':
      case 'finalRecover':
        beginHold(src);
        break;
      default:
        break;
    }
  };

  S.release = function (src) {
    if (S.phase === 'holding') {
      S.holding = false;
      S.phase = 'recovering';
      S.phaseT = 0;
      S.recFrom = S.p;
      A('setHold', false);
      log('release');
    } else if (S.phase === 'finalHold') {
      S.holding = false;
      A('setHold', false);
      A('musicRepair', false);
      S.repaired = false;
      log('releaseFinal:' + Math.round(S.holdTotal));
      if (S.holdTotal > 3000) {
        startEnding();
      } else {
        S.phase = 'finalRecover';
        S.phaseT = 0;
        S.recFrom = S.p;
        S.fragTarget = 0;
        S.hintAt = 0.75;
      }
    }
  };

  /* ---------------- 主更新 ---------------- */
  S.update = function (dt) {
    S.t += dt;
    S.phaseT += dt;

    // 碎片透明度平滑
    S.fragA += (S.fragTarget - S.fragA) * Math.min(1, dt * 2.6);
    if (LX.Layers) LX.Layers.setFragmentsAlpha(S.fragA);

    switch (S.phase) {
      case 'prelude':
        updatePrelude(dt);
        break;

      case 'idle': {
        var res = FILES[S.fileIdx].res;
        if (S.p > res) S.p += (res - S.p) * Math.min(1, dt * 3.2);
        break;
      }

      case 'holding': {
        var f = FILES[S.fileIdx];
        S.held += dt * 1000;
        S.holdTotal += dt * 1000;
        var span = f.hold - 100;
        var u = U.clamp01((S.held - 100) / span);
        var c = Math.pow(u, 1.35);
        S.p = S.pBase + (1 - S.pBase) * c;
        A('setDepth', S.p);
        if (S.p >= 0.997) completeFile();
        break;
      }

      case 'recovering': {
        var k = U.clamp01(S.phaseT / 1.5);
        var e = U.easeInOutCubic(k);
        // 药水涌动：恢复速度不均匀，局部快慢不一，最后一点拖得很长
        e = U.clamp01(e + 0.06 * Math.sin(k * 8.5 + S.fileIdx * 1.7) * Math.sin(Math.PI * k));
        var res2 = FILES[S.fileIdx].res;
        S.p = S.recFrom * (1 - e);
        if (S.p < res2) S.p = res2;
        if (S.phaseT >= 1.5) {
          S.p = res2;
          S.phase = 'idle';
          S.phaseT = 0;
        }
        break;
      }

      case 'deleted':
        S.p = 1;
        if (S.phaseT > 0.95) advance();
        break;

      case 'reveal': {
        var rk = U.clamp01(S.phaseT / 1.55);
        var re = U.easeOutCubic(rk);
        re = U.clamp01(re + 0.035 * Math.sin(rk * 9.0 + S.fileIdx) * Math.sin(Math.PI * rk));
        S.reveal = re;
        S.p = FILES[S.fileIdx].res;
        if (rk >= 1) {
          S.reveal = 1;
          S.phase = 'idle';
          S.phaseT = 0;
        }
        break;
      }

      case 'interlude': {
        var it = S.phaseT;
        if (it > 2.6) fade(dom.interlude.querySelector('.i2'), 1, 1900);
        if (it > 4.4) fade(dom.interlude.querySelector('.i3'), 1, 2600);
        if (it > 7.3) fade(dom.interlude, 0, 2200);
        if (it > 8.6) {
          enterFile(7);
        }
        break;
      }

      case 'final': {
        var res3 = FILES[7].res;
        if (S.p > res3) S.p += (res3 - S.p) * Math.min(1, dt * 3.2);
        S.fragTarget = 0;
        S.musicT = (S.t - S.musicStartT) % LX.Melody.duration;
        break;
      }

      case 'finalHold': {
        S.holdTotal += dt * 1000;
        S.held += dt * 1000;
        var target = 0.985 * (1 - Math.exp(-S.holdTotal / 7000));
        S.p = Math.max(S.p, target);
        A('setDepth', S.p);
        S.musicT = (S.t - S.musicStartT) % LX.Melody.duration;
        var appear = U.smoothstep(1100, 4200, S.holdTotal);
        S.fragTarget = appear * (1 - 0.52 * S.p) * 0.95;
        checkFinalSys();
        break;
      }

      case 'finalRecover': {
        var k2 = U.clamp01(S.phaseT / 1.5);
        var e2 = U.easeInOutCubic(k2);
        e2 = U.clamp01(e2 + 0.05 * Math.sin(k2 * 8.0) * Math.sin(Math.PI * k2));
        S.p = S.recFrom * (1 - e2);
        if (S.p < FILES[7].res) S.p = FILES[7].res;
        S.musicT = (S.t - S.musicStartT) % LX.Melody.duration;
        if (S.hintAt > 0 && S.phaseT >= S.hintAt) {
          fade(dom.hint, 0.16, 1400);
          S.hintAt = -1;
          setTimeout(function () { fade(dom.hint, 0, 2600); }, 2600);
        }
        if (S.phaseT >= 1.5) {
          S.phase = 'final';
          S.phaseT = 0;
          A('musicRepair', false);
        }
        break;
      }

      case 'ending':
        updateEnding(dt);
        break;

      case 'white': {
        var w = S.phaseT;

        // 「她回来一次」：白光里极淡地再浮现一下，再被光淹没
        S.ghostImg = U.smoothstep(1.5, 5.2, w) * (1 - U.smoothstep(9.2, 13.6, w));
        S.exposure = 1;

        if (LX.Layers) {
          // 灰尘慢慢落定：漂移变慢、变淡，最后一动不动
          LX.Layers.setMotes(true, 1, U.clamp01((w - 8.0) / 28));
          LX.Layers.setSheets(0);
        }

        // 她弹错的那个音：在余像最清楚的时候，很轻地再响一次，然后消失
        if (!S.lastNoteDone && w >= 5.6) {
          S.lastNoteDone = true;
          A('lastNote');
          log('lastNote');
        }

        if (w > 9 && !S.restartShown) {
          S.restartShown = true;
          dom.restart.classList.add('on');
        }

        // 这一问要停很久；然后极慢地淡下去——但不消失
        if (w >= 22) {
          var q = U.clamp01((w - 22) / 42);
          dom.e4.style.transition = 'none';
          dom.e4.style.opacity = String(1 - 0.46 * q);
        }
        break;
      }

      case 'memory':
        updateMemory(dt);
        break;
    }

    // 按住时如果显影还没走完，就让它温柔地补完，不要硬切
    if (S.reveal < 1 && (S.phase === 'holding' || S.phase === 'finalHold')) {
      S.reveal = Math.min(1, S.reveal + dt * 1.6);
    }

    // 记住按住的相位（供画面用）
    if (S.phase !== 'holding' && S.phase !== 'finalHold') S.holding = false;
  };

  /* ---------------- 对外 ---------------- */
  S.frame = function () {
    return {
      p: S.p,
      reveal: S.reveal,
      exposure: S.exposure,
      hasCard: S.hasCard,
      phase: S.phase,
      fileIdx: S.fileIdx,
      fileId: FILES[S.fileIdx] ? FILES[S.fileIdx].id : 1,
      holding: S.holding,
      repaired: S.repaired,
      musicTime: S.musicTime(),
      motesA: S.motesA,
      ghostImg: S.ghostImg,
      fragA: S.fragA
    };
  };

  S.musicTime = function () {
    if (LX.Audio && typeof LX.Audio.musicTime === 'function') {
      try { var v = LX.Audio.musicTime(); if (typeof v === 'number' && isFinite(v)) return v; } catch (e) {}
    }
    return S.musicT;
  };

  S.start = function (hooks) {
    S.hooks = hooks || {};
    dom.counter = $('counter');
    dom.meta = $('meta');
    dom.prelude = $('prelude');
    dom.sys = $('sys');
    dom.interlude = $('interlude');
    dom.ending = $('ending');
    dom.e1 = $('ending').querySelector('.e1');
    dom.e2 = $('ending').querySelector('.e2');
    dom.e3 = $('ending').querySelector('.e3');
    dom.e2b = $('ending').querySelector('.e2b');
    dom.e4 = $('ending').querySelector('.e4');
    dom.hint = $('hint');
    dom.restart = $('restart');

    dom.restart.addEventListener('click', function () {
      try { localStorage.removeItem('linxia.seen'); } catch (e) {}
      try { location.reload(); } catch (e) {}
    });

    var seen = false;
    try { seen = localStorage.getItem('linxia.seen') === '1'; } catch (e) {}

    if (seen) {
      startMemory();
    } else {
      startPrelude();
    }
  };

  S.state = function () {
    return {
      phase: S.phase,
      fileIndex: S.fileIdx,
      fileId: FILES[S.fileIdx] ? FILES[S.fileIdx].id : 1,
      holding: S.holding,
      p: S.p,
      reveal: S.reveal,
      exposure: S.exposure,
      deleted: S.deleted,
      holdTotal: S.holdTotal,
      memory: S.memory,
      timeline: S.timeline.slice(-80)
    };
  };

  S.forceFile = function (n) {
    n = U.clamp(n | 0, 0, 7);
    S.deleted = n;
    updateCounter();
    enterFile(n, { instant: true });
    S.exposure = 0;
    if (LX.Layers) { LX.Layers.reset(); LX.Layers.setSheets(n); }
  };

  S.forceScreen = function (name) {
    if (name === 'ending') {
      S.fileIdx = 7;
      S.recFrom = 0.97;
      S.p = 0.97;
      startEnding();
      S.endingT = 0;
    } else if (name === 'memory') {
      startMemory();
    } else if (name === 'final') {
      S.forceFile(7);
    }
  };

  S.reset = function () {
    S.deleted = 0;
    S.p = 0;
    S.exposure = 0;
    S.phase = 'prelude';
    S.phaseT = 0;
    S.motesA = 0;
    S.restartShown = false;
    if (dom.restart) dom.restart.classList.remove('on');
    if (LX.Layers) LX.Layers.reset();
    updateCounter();
  };

  LX.Story = S;
})(window);
