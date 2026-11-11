/* 《如果世界忘记了你》— input.js
 * Pointer Events 统一鼠标/触屏；键盘空格；多指只认第一根；
 * 阻止长按菜单、文字选择、拖拽、iOS 手势缩放。
 */
(function (global) {
  'use strict';
  var LX = (global.LX = global.LX || {});

  var I = {
    activePointer: null,
    down: false,
    handlers: null,
    blocked: false
  };

  function nowMs() {
    return LX.U.now();
  }

  I.init = function (handlers) {
    I.handlers = handlers || {};
    var onPress = I.handlers.onPress || function () {};
    var onRelease = I.handlers.onRelease || function () {};

    function isUI(target) {
      return !!(target && target.closest && target.closest('[data-ui]'));
    }

    function press(src) {
      if (I.down) return;
      I.down = true;
      try { onPress(src); } catch (e) { console.error('[input] press', e); }
    }

    function release(src) {
      if (!I.down) return;
      I.down = false;
      try { onRelease(src); } catch (e) { console.error('[input] release', e); }
    }

    I.release = release;

    /* ---------------- Pointer ---------------- */
    window.addEventListener('pointerdown', function (e) {
      if (isUI(e.target)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (I.activePointer !== null) return;         // 多指：只认第一根
      I.activePointer = e.pointerId;
      try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
      if (e.cancelable) e.preventDefault();
      press('pointer');
    }, { passive: false });

    function endPointer(e) {
      if (I.activePointer === null) return;
      if (e.pointerId !== I.activePointer) return;
      I.activePointer = null;
      if (e.cancelable) e.preventDefault();
      release('pointer');
    }

    window.addEventListener('pointerup', endPointer, { passive: false });
    window.addEventListener('pointercancel', endPointer, { passive: false });
    window.addEventListener('lostpointercapture', function (e) {
      if (I.activePointer !== null && e.pointerId === I.activePointer) {
        I.activePointer = null;
        release('capture-lost');
      }
    });

    /* ---------------- 键盘空格 ---------------- */
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (e.repeat) return;
        press('keyboard');
      }
    }, { passive: false });

    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        release('keyboard');
      }
    }, { passive: false });

    /* ---------------- 失焦 / 切后台 = 松手 ---------------- */
    window.addEventListener('blur', function () { release('blur'); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        release('hidden');
        if (I.handlers.onHide) I.handlers.onHide();
      } else if (I.handlers.onShow) {
        I.handlers.onShow();
      }
    });

    /* ---------------- 各种系统默认行为 ---------------- */
    window.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('selectstart', function (e) {
      if (!isUI(e.target)) e.preventDefault();
    });

    document.addEventListener('dragstart', function (e) {
      e.preventDefault();
    });

    // iOS：阻止双指缩放 / 手势
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
      document.addEventListener(name, function (e) { e.preventDefault(); }, { passive: false });
    });

    // 双击缩放（部分浏览器仍会）
    var lastTap = 0;
    document.addEventListener('touchend', function (e) {
      var t = nowMs();
      if (t - lastTap < 320) e.preventDefault();
      lastTap = t;
    }, { passive: false });

    // 页面滚动的残余
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
  };

  I.isDown = function () { return I.down; };

  LX.Input = I;
})(window);
