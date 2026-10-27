/* 효과음. 음원 파일 없이 Web Audio로 그때그때 합성한다. */
(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function env(gain, t, attack, dur, vol) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(o) {
    const t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    env(gain, t, o.attack || 0.004, o.dur, o.vol || 0.2);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  function noise(o) {
    const t = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter || 'lowpass';
    filter.Q.value = o.q || 1;
    filter.frequency.setValueAtTime(o.from, t);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    const gain = ctx.createGain();
    env(gain, t, o.attack || 0.005, o.dur, o.vol || 0.2);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.dur + 0.05);
  }

  const COLOR_FREQ = [523.25, 659.25, 783.99];

  const SOUNDS = {
    step() {
      tone({ freq: 190 + Math.random() * 30, to: 120, type: 'triangle', dur: 0.06, vol: 0.12 });
    },
    bump() {
      tone({ freq: 90, to: 60, type: 'square', dur: 0.08, vol: 0.06 });
    },
    push() {
      noise({ from: 500, to: 180, dur: 0.16, vol: 0.22 });
      tone({ freq: 70, to: 50, type: 'sine', dur: 0.14, vol: 0.2 });
    },
    press(c) {
      const f = COLOR_FREQ[c] || 523.25;
      tone({ freq: f, type: 'triangle', dur: 0.09, vol: 0.14 });
      tone({ freq: f * 1.5, type: 'sine', dur: 0.14, vol: 0.1, delay: 0.05 });
    },
    release(c) {
      const f = COLOR_FREQ[c] || 523.25;
      tone({ freq: f * 1.5, to: f, type: 'triangle', dur: 0.1, vol: 0.08 });
    },
    open() {
      noise({ filter: 'bandpass', from: 400, to: 2400, q: 2, dur: 0.22, vol: 0.18 });
    },
    close() {
      noise({ filter: 'bandpass', from: 2000, to: 300, q: 2, dur: 0.18, vol: 0.14 });
      tone({ freq: 110, to: 70, type: 'square', dur: 0.08, vol: 0.05, delay: 0.12 });
    },
    tick(urgent) {
      tone({ freq: urgent ? 1760 : 1320, type: 'square', dur: 0.03, vol: urgent ? 0.07 : 0.04 });
    },
    start() {
      tone({ freq: 880, to: 1320, type: 'sine', dur: 0.08, vol: 0.08 });
    },
    rewind() {
      tone({ freq: 900, to: 120, type: 'sawtooth', dur: 0.6, vol: 0.06 });
      noise({ filter: 'bandpass', from: 3000, to: 400, q: 4, dur: 0.6, vol: 0.12 });
    },
    echo() {
      [659.25, 987.77].forEach((f, i) =>
        tone({ freq: f, type: 'sine', dur: 0.5, vol: 0.08, delay: i * 0.09, attack: 0.02 }));
    },
    full() {
      tone({ freq: 220, to: 180, type: 'square', dur: 0.2, vol: 0.06 });
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.35, vol: 0.13, delay: i * 0.08 }));
      tone({ freq: 2093, type: 'sine', dur: 0.8, vol: 0.05, delay: 0.32, attack: 0.03 });
    },
    ui() {
      tone({ freq: 660, type: 'triangle', dur: 0.05, vol: 0.07 });
    },
  };

  window.LoopAudio = {
    unlock() {
      ensure();
    },
    play(name, arg) {
      if (muted || !SOUNDS[name] || !ensure()) return;
      SOUNDS[name](arg);
    },
    setMuted(m) {
      muted = m;
    },
    isMuted() {
      return muted;
    },
  };
})();
