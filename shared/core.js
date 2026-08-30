/* ============================================================
   《显影》 XianYing — 核心引擎
   状态存档 / 线索登记 / 窗口管理 / WebAudio 合成音效 / 微恐调度
   ============================================================ */
'use strict';

/* ---------------- 全局状态 ---------------- */
const XY = {
  KEY: 'xianying_save_v1',
  _cache: null,

  defaults() {
    return {
      started: false,
      flags: {},            // 各种解锁开关
      clues: [],            // 已获线索 id
      board: { G1: [null,null,null], G2: [null,null,null], G3: [null,null,null] },
      boardOK: { G1:false, G2:false, G3:false },
      rolls: [],            // 已查看扫描卷
      frames: [],           // 已查看印样格
      binRestored: [],      // 回收站已恢复项
      tapes: [],            // 已听磁带
      calls: [],            // 已拨电话
      night: 1,             // 1..7 (12月25日 → 12月31日)
      clock: 20 * 60,       // 当夜分钟数
      horror: 0,
      ended: null,
      muted: false
    };
  },

  load() {
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(this.KEY);
      this._cache = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
    } catch (e) { this._cache = this.defaults(); }
    return this._cache;
  },

  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this._cache || this.load())); } catch (e) {}
  },

  reset() { this._cache = this.defaults(); this.save(); },

  flag(k, v) {
    const s = this.load();
    if (v === undefined) return !!s.flags[k];
    s.flags[k] = v; this.save(); return v;
  },

  addClue(id) {
    const s = this.load();
    if (!s.clues.includes(id)) {
      s.clues.push(id); this.save();
      document.dispatchEvent(new CustomEvent('xy:clue', { detail: id }));
    }
  },
  hasClue(id) { return this.load().clues.includes(id); },

  addList(key, id) {
    const s = this.load();
    const arr = s[key] || (s[key] = []);
    if (!arr.includes(id)) { arr.push(id); this.save(); }
  },
  inList(key, id) { return (this.load()[key] || []).includes(id); },

  /* 夜与钟：每达成一个里程碑推进 */
  advanceNight(reason) {
    const s = this.load();
    if (s.night < 7) {
      s.night += 1; s.clock = 19 * 60 + Math.floor(Math.random() * 90);
      this.save();
      document.dispatchEvent(new CustomEvent('xy:night', { detail: reason || '' }));
    }
  },

  /* 微恐等级：随进度与夜数增长 */
  horrorLevel() {
    const s = this.load();
    const base = Math.floor(s.clues.length / 4) + Math.floor(s.night / 2);
    return Math.min(5, base);
  }
};

/* ---------------- 周期时钟（游戏内时间） ---------------- */
XY.startClock = function (onTick) {
  setInterval(() => {
    const s = XY.load();
    s.clock = (s.clock + 1) % 1440;
    XY.save();
    if (onTick) onTick(s);
  }, 6000);
};

XY.dateOfNight = function (night) {
  return '2024-12-' + (24 + Number(night || 1));
};

XY.clockText = function () {
  const s = XY.load();
  const h = Math.floor(s.clock / 60), m = s.clock % 60;
  return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
};

/* ---------------- WebAudio 合成音效引擎 ---------------- */
const SFX = {
  ctx: null, master: null, rainNode: null, humNode: null,

  ensure() {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = XY.load().muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
    } catch (e) {}
    return this.ctx;
  },

  setMuted(m) {
    XY.load().muted = m; XY.save();
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  },

  _noiseBuffer(sec) {
    const ctx = this.ensure(); if (!ctx) return null;
    const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },

  /* 冬雨环境声（棕噪声+低通，极轻） */
  rain(on) {
    const ctx = this.ensure(); if (!ctx) return;
    if (on && !this.rainNode) {
      const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(3); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.value = 0.05;
      src.connect(lp); lp.connect(g); g.connect(this.master); src.start();
      this.rainNode = { src, g };
    } else if (!on && this.rainNode) {
      try { this.rainNode.src.stop(); } catch (e) {}
      this.rainNode = null;
    }
  },

  /* CRT 电流嗡鸣（极轻，营造老机器在场感） */
  hum(on) {
    const ctx = this.ensure(); if (!ctx) return;
    if (on && !this.humNode) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 50;
      const g = ctx.createGain(); g.gain.value = 0.012;
      o.connect(g); g.connect(this.master); o.start();
      this.humNode = { o, g };
    } else if (!on && this.humNode) {
      try { this.humNode.o.stop(); } catch (e) {}
      this.humNode = null;
    }
  },

  blip(f = 880, dur = 0.05, vol = 0.08) {
    const ctx = this.ensure(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + dur + 0.02);
  },

  /* 硬盘咔哒 */
  hdd() {
    const ctx = this.ensure(); if (!ctx) return;
    let n = 3 + Math.floor(Math.random() * 4);
    const tick = () => {
      this.blip(2200 + Math.random() * 1800, 0.018, 0.03);
      if (--n > 0) setTimeout(tick, 60 + Math.random() * 90);
    };
    tick();
  },

  /* DTMF 拨号音 */
  dtmf(key) {
    const ctx = this.ensure(); if (!ctx) return;
    const map = { '1':[697,1209],'2':[697,1336],'3':[697,1477],'4':[770,1209],'5':[770,1336],'6':[770,1477],'7':[852,1209],'8':[852,1336],'9':[852,1477],'0':[941,1336] };
    const pair = map[key]; if (!pair) return;
    pair.forEach(f => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.06, ctx.currentTime);
      g.gain.setValueAtTime(0.06, ctx.currentTime + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
      o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + 0.18);
    });
  },

  /* 恐惧低鸣：缓慢升起的低频 */
  drone(dur = 4, vol = 0.10) {
    const ctx = this.ensure(); if (!ctx) return;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(42, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(58, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + dur + 0.1);
  },

  /* 心跳两连 */
  heart() {
    this.thump(0.16, 55); setTimeout(() => this.thump(0.12, 50), 260);
  },
  thump(dur, f) {
    const ctx = this.ensure(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, ctx.currentTime + dur);
    g.gain.setValueAtTime(0.14, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + dur + 0.05);
  },

  /* 结局钢琴主题（合成器程序化演奏） */
  theme() {
    const ctx = this.ensure(); if (!ctx) return;
    const notes = [ // 简单的小调动机
      [523.25, 0.9], [415.30, 0.9], [392.00, 0.9], [311.13, 1.4],
      [349.23, 0.9], [392.00, 0.9], [415.30, 1.6],
      [523.25, 0.9], [622.25, 0.9], [523.25, 1.2], [415.30, 2.2]
    ];
    let t = ctx.currentTime + 0.2;
    notes.forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + 0.1);
      // 低八度衬底
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = 'sine'; o2.frequency.value = f / 2;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.linearRampToValueAtTime(0.05, t + 0.05);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o2.connect(g2); g2.connect(this.master); o2.start(t); o2.stop(t + d + 0.1);
      t += d * 0.92;
    });
  }
};

/* ---------------- 微恐调度（缓慢、可预期的异常） ---------------- */
const SCARE = {
  idleTimer: null, armed: false,

  armIdle(dimCallback, seconds = 50) {
    const reset = () => {
      this.clearIdle();
      this.idleTimer = setTimeout(() => {
        dimCallback && dimCallback();
        this.clearIdle();
        this.idleTimer = setTimeout(() => { dimCallback && dimCallback(); }, seconds * 1000);
      }, seconds * 1000);
    };
    if (!this.armed) {
      this.armed = true;
      ['mousemove', 'keydown', 'click', 'wheel', 'touchstart'].forEach(ev =>
        window.addEventListener(ev, reset, { passive: true }));
    }
    reset();
  },
  clearIdle() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }
};

/* ---------------- 打字机 ---------------- */
function typeText(el, text, speed = 34, done) {
  el.textContent = '';
  let i = 0;
  const t = setInterval(() => {
    el.textContent += text[i++];
    if (i >= text.length) { clearInterval(t); done && done(); }
  }, speed);
  return t;
}

/* ---------------- 模态（游戏内窗体，非浏览器弹窗） ---------------- */
function showModal(html, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'xy-modal-wrap';
  wrap.innerHTML = '<div class="xy-modal ' + (opts.cls || '') + '">' + html + '</div>';
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  return {
    el: wrap,
    close() { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 260); }
  };
}

/* ---------------- 密码校验（归一化数字，防爆破） ---------------- */
const BruteGuard = {
  fails: 0, lockedUntil: 0,
  tryGate(input, answers, onOK, onFail, onLock) {
    const now = Date.now();
    if (now < this.lockedUntil) {
      onLock && onLock(Math.ceil((this.lockedUntil - now) / 1000));
      return;
    }
    const norm = String(input || '').replace(/\D/g, '');
    if (answers.includes(norm)) { this.fails = 0; onOK(); }
    else {
      this.fails++;
      if (this.fails >= 5) {
        this.lockedUntil = now + 60000; this.fails = 0;
        onLock && onLock(60);
      } else onFail(5 - this.fails);
    }
  }
};

/* ---------------- 控制台彩蛋 ---------------- */
if (typeof console !== 'undefined') {
  console.log('%c显影 · XianYing', 'color:#e33;font-size:20px;font-weight:bold');
  console.log('%c「暗房里没有鬼。只有没洗完的底片。」', 'color:#999');
  console.log('%c师傅的备忘：卷柜最底层，铁盒，钥匙在我从不戴的那只手套里。', 'color:#8a6');
  console.log('%c——如果你读到这里，去 档案库 → 文档，看看有没有多出来的东西。', 'color:#8a6');
}
