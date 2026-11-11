/* 《如果世界忘记了你》— melody.js
 * 《生日快乐》单旋律：音符表 + 那个弹错的音。
 * art.js（琴键亮起）与 audio.js（玩具钢琴）共用同一份时间表，保证键与声严格对齐。
 *
 * 第 2 句的最高音弹错：D5(74) → D#5(75)，高了半音。
 */
(function (global) {
  'use strict';
  var LX = (global.LX = global.LX || {});

  // [beat, midi]  beat 以四分音符为 1
  var RAW = [
    // 祝你生日快乐 (第 1 句)
    [0, 67], [1, 67], [2, 69], [3, 67], [4, 72], [5, 71],
    // 祝你生日快乐 (第 2 句) —— 第 10 拍那个音弹错了
    [6, 67], [7, 67], [8, 69], [9, 67], [10, 74], [11, 72],
    // 祝你生日快乐 (第 3 句)
    [12, 67], [13, 67], [14, 79], [15, 76], [16, 72], [17, 71], [18, 69],
    // 祝你生日快乐 (第 4 句)
    [19, 77], [20, 77], [21, 76], [22, 72], [23, 74], [24, 72]
  ];

  var BEAT_DUR = 0.62;          // 玩具钢琴，慢一点
  var WRONG_INDEX = 10;         // 第 2 句最高音
  var WRONG_MIDI = 75;          // D#5 —— 弹错的音
  var RIGHT_MIDI = 74;          // D5  —— 正确的音

  var notes = RAW.map(function (n, i) {
    return {
      i: i,
      beat: n[0],
      midiRight: n[1],
      midiPlayed: i === WRONG_INDEX ? WRONG_MIDI : n[1],
      wrong: i === WRONG_INDEX,
      time: n[0] * BEAT_DUR
    };
  });

  // 最后一个音延音，让歌“放完”
  var TAIL = 2.2 * BEAT_DUR;

  LX.Melody = {
    beatDur: BEAT_DUR,
    notes: notes,
    wrongIndex: WRONG_INDEX,
    wrongMidi: WRONG_MIDI,
    rightMidi: RIGHT_MIDI,
    totalBeats: 24,
    duration: 24 * BEAT_DUR + TAIL,

    // 白键序号：以 C4(60) 为 0，白键 C4 D4 E4 F4 G4 A4 B4 C5 ...
    whiteIndex: function (midi) {
      var m = midi - 60;
      if (m < 0) return -1;
      var oct = Math.floor(m / 12), pc = m % 12;
      var map = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
      if (map[pc] === undefined) return -1;    // 黑键
      return oct * 7 + map[pc];
    },

    isBlack: function (midi) {
      var pc = ((midi - 60) % 12 + 12) % 12;
      return [1, 3, 6, 8, 10].indexOf(pc) >= 0;
    },

    // 给定播放进度（秒）与“是否已被修复”，返回此刻应发声音符（可能为 null）
    noteAt: function (t, repaired) {
      for (var i = 0; i < notes.length; i++) {
        var n = notes[i];
        var next = i + 1 < notes.length ? notes[i + 1].time : 24 * BEAT_DUR + TAIL;
        if (t >= n.time && t < next) {
          return {
            index: n.i,
            midi: n.wrong && repaired ? RIGHT_MIDI : n.midiPlayed,
            wrong: n.wrong,
            since: t - n.time,
            dur: next - n.time
          };
        }
      }
      return null;
    }
  };
})(window);
