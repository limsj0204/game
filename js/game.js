/* 게임 진행: 루프 관리, 입력, 화면 전환. */
(function () {
  'use strict';

  const Sim = window.LoopSim;
  const Sound = window.LoopAudio;
  const PAL = window.LoopRender.PAL;
  const LEVELS = window.LOOP_LEVELS.map((d, i) => Sim.parseLevel(d, i));
  const STORE_KEY = 'loop10-progress-v1';
  const $ = (id) => document.getElementById(id);
  // 숫자 뒤 조사: 끝자리가 2·4·5·9면 받침이 없다.
  const josa = (n, withF, without) => (/[2459]$/.test(String(n)) ? without : withF);

  // ---------- 진행 저장 ----------
  function loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (p && p.best && typeof p.best === 'object') return p;
    } catch (e) { /* 저장소를 쓸 수 없으면 새로 시작 */ }
    return { best: {}, muted: false };
  }
  function saveProgress() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(progress));
    } catch (e) { /* 무시 */ }
  }
  const progress = loadProgress();
  const unlockAll = location.hash === '#unlock';
  const cleared = (i) => progress.best[i] != null;
  const perfect = (i) => cleared(i) && progress.best[i] <= LEVELS[i].par;
  function unlockedCount() {
    if (unlockAll) return LEVELS.length;
    let n = 0;
    while (n < LEVELS.length && cleared(n)) n++;
    return Math.min(LEVELS.length, n + 1);
  }

  // ---------- 상태 ----------
  const S = {
    screen: 'title',
    L: null,
    recs: [],
    paths: [],
    world: null,
    mode: 'ready', // ready | run | rewind | won
    acc: 0,
    hist: [],
    curPath: [],
    rewind: null,
    particles: [],
    doorAmt: [],
    shake: 0,
    squash: 0,
    loops: 1,
    held: [],
    queued: 0,
    ff: false,
    t: 0,
    lastSec: 10,
    clearIn: 0,
    note: '',
    noteUntil: 0,
    modal: null,
  };

  let renderer = null;

  // ---------- 화면 ----------
  function show(screen) {
    S.screen = screen;
    $('screen-title').hidden = screen !== 'title';
    $('screen-game').hidden = screen !== 'game';
    if (screen === 'title') buildLevelGrid();
  }

  function openModal(id) {
    closeModal();
    S.modal = id;
    $(id).hidden = false;
    const primary = $(id).querySelector('[data-primary]');
    if (primary) primary.focus();
  }
  function closeModal() {
    if (S.modal) $(S.modal).hidden = true;
    S.modal = null;
  }

  function buildLevelGrid() {
    const grid = $('level-grid');
    grid.textContent = '';
    const open = unlockedCount();
    LEVELS.forEach((L, i) => {
      const b = document.createElement('button');
      b.className = 'level-btn';
      b.type = 'button';
      b.disabled = i >= open;
      if (cleared(i)) b.classList.add('cleared');
      if (perfect(i)) b.classList.add('perfect');
      b.innerHTML = `<span class="lv-no">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="lv-name"></span><span class="lv-mark" aria-hidden="true"></span>`;
      b.querySelector('.lv-name').textContent = i >= open ? '잠김' : L.name;
      b.setAttribute('aria-label', `${i + 1}번 스테이지 ${i >= open ? '잠김' : L.name}${perfect(i) ? ', 최소 메아리로 탈출' : cleared(i) ? ', 탈출함' : ''}`);
      b.addEventListener('click', () => {
        Sound.play('ui');
        startLevel(i);
      });
      grid.appendChild(b);
    });
    const next = LEVELS.findIndex((_, i) => !cleared(i));
    const all = next < 0;
    $('btn-play').textContent = all ? '처음부터 다시' : next > 0 ? `${next + 1}번 스테이지 이어하기` : '시작하기';
    $('btn-play').dataset.level = all ? 0 : next;
    const stars = LEVELS.filter((_, i) => perfect(i)).length;
    $('title-stats').textContent = `탈출 ${LEVELS.filter((_, i) => cleared(i)).length}/${LEVELS.length} · 최소 메아리 ★ ${stars}`;
  }

  // ---------- 스테이지와 루프 ----------
  function startLevel(i) {
    closeModal();
    S.L = LEVELS[i];
    S.recs = [];
    S.paths = [];
    S.loops = 1;
    S.particles = [];
    $('stage-no').textContent = String(i + 1).padStart(2, '0');
    $('stage-name').textContent = S.L.name;
    $('hint').textContent = S.L.hint;
    $('ghost-max').textContent = S.L.maxGhosts;
    $('btn-undo').disabled = S.L.maxGhosts === 0;
    buildTracks();
    show('game');
    newLoop();
  }

  function snapshot() {
    const w = S.world;
    return {
      ents: w.ents.map((e) => Sim.renderPos(e)),
      boxes: w.boxes.map((b) => Sim.renderPos(b)),
    };
  }

  function newLoop() {
    S.world = Sim.createWorld(S.L, S.recs);
    S.mode = 'ready';
    S.acc = 0;
    S.hist = [snapshot()];
    S.curPath = [{ x: S.L.start.x, y: S.L.start.y }];
    S.doorAmt = S.world.doorOpen.map((o) => (o ? 1 : 0));
    S.lastSec = Math.ceil(S.L.limit / Sim.TPS);
    S.queued = 0;
    $('loop-no').textContent = S.loops;
    $('ghost-count').textContent = S.recs.length;
    updateTracks(0);
  }

  function begin() {
    if (S.mode !== 'ready') return;
    S.mode = 'run';
    S.acc = 0;
    Sound.play('start');
  }

  function tick() {
    const w = S.world;
    const p = w.player;
    const held = S.held.length ? S.held[S.held.length - 1] : 0;
    const wasIdle = p.mt === 0;
    Sim.step(w, S.queued || held);
    if (wasIdle) S.queued = 0;
    S.hist.push(snapshot());
    const last = S.curPath[S.curPath.length - 1];
    if (p.x !== last.x || p.y !== last.y) S.curPath.push({ x: p.x, y: p.y });
    handleEvents(w.events);

    const sec = Math.ceil((S.L.limit - w.tick) / Sim.TPS);
    if (sec < S.lastSec) {
      S.lastSec = sec;
      if (sec > 0 && sec <= 3) Sound.play('tick', sec === 1);
    }
    if (w.won) win();
    else if (w.tick >= S.L.limit) endLoop(true);
  }

  function endLoop(keep) {
    if (S.mode !== 'run') return;
    const rec = S.world.player.rec;
    let added = false;
    let msg = '';
    if (keep) {
      if (S.recs.length < S.L.maxGhosts) {
        S.recs.push(rec.slice());
        S.paths.push(S.curPath.slice());
        added = true;
      } else if (S.L.maxGhosts > 0) {
        msg = '메아리 자리가 꽉 찼어요. Z로 마지막 메아리를 지울 수 있어요.';
        Sound.play('full');
      } else {
        msg = '시간이 다 됐어요. 다시 가 봐요!';
      }
    }
    S.loops++;
    S.mode = 'rewind';
    S.rewind = { t: 0, dur: Math.min(0.95, 0.4 + (S.hist.length / S.L.limit) * 0.55), added, msg };
    S.shake = 0.06;
    Sound.play('rewind');
  }

  function finishRewind() {
    const r = S.rewind;
    S.rewind = null;
    newLoop();
    if (r.added) {
      Sound.play('echo');
      const n = S.recs.length;
      note(`메아리 ${n}${josa(n, '이', '가')} 생겼어요`);
      const st = S.L.start;
      ring(st.x + 0.5, st.y + 0.5, PAL.echo, 0.6);
    } else if (r.msg) {
      note(r.msg, 3.2);
    }
  }

  function restartLoop() {
    if (S.mode === 'run') endLoop(false);
  }

  function undoGhost() {
    if (S.mode !== 'run' && S.mode !== 'ready') return;
    if (!S.recs.length) {
      note('지울 메아리가 없어요');
      return;
    }
    S.recs.pop();
    S.paths.pop();
    Sound.play('ui');
    if (S.mode === 'run') endLoop(false);
    else newLoop();
    const n = S.recs.length + 1;
    note(`메아리 ${n}${josa(n, '을', '를')} 지웠어요`);
  }

  function win() {
    S.mode = 'won';
    S.clearIn = 1.1;
    const ex = S.L.exit;
    burst(ex.x + 0.5, ex.y + 0.5, PAL.present, 26, 5, 0.12, 0.9);
    burst(ex.x + 0.5, ex.y + 0.5, PAL.exit, 14, 3, 0.09, 1.1);
    ring(ex.x + 0.5, ex.y + 0.5, PAL.present, 0.9);
    Sound.play('win');
    const i = S.L.index;
    const used = S.recs.length;
    if (progress.best[i] == null || used < progress.best[i]) progress.best[i] = used;
    saveProgress();
  }

  function showClear() {
    const L = S.L;
    const used = S.recs.length;
    const last = L.index === LEVELS.length - 1;
    $('clear-ghosts').textContent = used;
    $('clear-par').textContent = L.par;
    $('clear-loops').textContent = S.loops;
    $('clear-badge').hidden = used > L.par;
    $('clear-note').textContent = used > L.par
      ? `메아리 ${L.par}명으로도 풀 수 있어요.`
      : L.par === 0 ? '메아리 없이 탈출했어요.' : '최소 메아리로 탈출했어요.';
    $('btn-next').textContent = last ? '엔딩 보기' : '다음 스테이지';
    openModal('modal-clear');
  }

  function next() {
    const i = S.L.index;
    if (i === LEVELS.length - 1) {
      const stars = LEVELS.filter((_, k) => perfect(k)).length;
      $('end-stars').textContent = `${stars} / ${LEVELS.length}`;
      openModal('modal-end');
    } else startLevel(i + 1);
  }

  function toTitle() {
    closeModal();
    S.held = [];
    S.ff = false;
    show('title');
  }

  // ---------- 효과 ----------
  function burst(x, y, color, n, speed, size, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size });
    }
  }
  function ring(x, y, color, size) {
    S.particles.push({ x, y, vx: 0, vy: 0, life: 0.55, max: 0.55, color, size, ring: true });
  }
  function note(text, secs) {
    S.note = text;
    S.noteUntil = S.t + (secs || 2.2);
  }

  function handleEvents(events) {
    let opened = false;
    let closed = false;
    for (const e of events) {
      if (e.type === 'step' && !e.ghost) {
        Sound.play('step');
        S.squash = 1;
      } else if (e.type === 'bump' && !e.ghost) {
        Sound.play('bump');
        S.shake = Math.max(S.shake, 0.025);
      } else if (e.type === 'push') {
        Sound.play('push');
        burst(e.x + 0.5, e.y + 0.5, PAL.box, 6, 1.6, 0.08, 0.35);
      } else if (e.type === 'press') {
        Sound.play('press', e.c);
        ring(e.x + 0.5, e.y + 0.5, PAL.colors[e.c], 0.42);
      } else if (e.type === 'release') {
        Sound.play('release', e.c);
      } else if (e.type === 'open') {
        if (!opened) Sound.play('open');
        opened = true;
        burst(e.x + 0.5, e.y + 0.5, PAL.colors[e.c], 5, 1.2, 0.07, 0.4);
      } else if (e.type === 'close') {
        if (!closed) Sound.play('close');
        closed = true;
      }
    }
  }

  // ---------- HUD ----------
  function buildTracks() {
    const box = $('tracks');
    box.textContent = '';
    const row = (label, cls) => {
      const r = document.createElement('div');
      r.className = `track ${cls}`;
      r.innerHTML = '<span class="track-label"></span><div class="track-bar"><div class="track-fill"></div><div class="track-head"></div></div>';
      r.querySelector('.track-label').textContent = label;
      box.appendChild(r);
      return r;
    };
    for (let i = 0; i < S.L.maxGhosts; i++) row(`메아리 ${i + 1}`, 'echo');
    row('지금', 'now');
  }

  function updateTracks(p) {
    const rows = $('tracks').children;
    const limit = S.L.limit;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const isNow = i === rows.length - 1;
      let fill = 0;
      if (isNow) fill = p;
      else if (S.recs[i]) fill = S.recs[i].length / limit;
      r.classList.toggle('empty', !isNow && !S.recs[i]);
      r.querySelector('.track-fill').style.width = `${(fill * 100).toFixed(2)}%`;
      r.querySelector('.track-head').style.left = `${(p * 100).toFixed(2)}%`;
    }
  }

  function updateHud() {
    const w = S.world;
    let p = w.tick / S.L.limit;
    if (S.mode === 'rewind') p *= 1 - easeInOut(S.rewind.t / S.rewind.dur);
    const remain = Math.max(0, (S.L.limit / Sim.TPS) * (1 - p));
    const counter = $('counter');
    counter.textContent = remain.toFixed(2).padStart(5, '0');
    counter.classList.toggle('urgent', S.mode === 'run' && remain <= 3);
    updateTracks(p);

    let text = '';
    if (S.mode === 'ready') text = S.recs.length ? '움직이면 메아리도 함께 출발해요' : '움직이면 시간이 흐르기 시작해요';
    else if (S.mode === 'rewind') text = '◀◀ 되감는 중';
    if (S.t < S.noteUntil && S.mode !== 'rewind') text = S.note;
    const banner = $('banner');
    if (banner.textContent !== text) banner.textContent = text;
    banner.hidden = !text;
    banner.classList.toggle('rewinding', S.mode === 'rewind');
  }

  // ---------- 매 프레임 ----------
  function easeInOut(k) {
    k = Math.min(1, Math.max(0, k));
    return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  }

  function buildView() {
    const w = S.world;
    let ents;
    let boxes;
    if (S.mode === 'rewind') {
      const k = easeInOut(S.rewind.t / S.rewind.dur);
      const snap = S.hist[Math.round((1 - k) * (S.hist.length - 1))];
      ents = snap.ents;
      boxes = snap.boxes;
    } else {
      const a = S.mode === 'run' ? S.acc * Sim.TPS : 0;
      ents = w.ents.map((e) => Sim.renderPos(e, a));
      boxes = w.boxes.map((b) => Sim.renderPos(b, a));
    }
    const ghosts = [];
    w.ents.forEach((e, i) => {
      if (e.ghost) {
        ghosts.push({
          x: ents[i].x, y: ents[i].y, id: e.id,
          done: w.tick >= e.rec.length,
          push: S.mode === 'run' && e.blocked ? e.dir : 0,
        });
      }
    });
    const pp = ents[ents.length - 1];
    let progressK = w.tick / S.L.limit;
    if (S.mode === 'rewind') progressK *= 1 - easeInOut(S.rewind.t / S.rewind.dur);
    return {
      L: S.L,
      mode: S.mode,
      t: S.t,
      won: S.mode === 'won',
      progress: progressK,
      plateOn: w.platePressed,
      doorAmt: S.doorAmt,
      paths: S.paths,
      boxes,
      ghosts,
      present: { x: pp.x, y: pp.y, squash: S.squash, push: S.mode === 'run' && w.player.blocked ? w.player.dir : 0 },
      particles: S.particles,
      shake: S.shake,
      rewindK: S.rewind ? S.rewind.t / S.rewind.dur : 0,
    };
  }

  function update(dt) {
    if (S.mode === 'run' && !S.modal) {
      S.acc += dt * (S.ff ? 3 : 1);
      const stepDt = 1 / Sim.TPS;
      let n = 0;
      while (S.acc >= stepDt && S.mode === 'run' && n < 20) {
        S.acc -= stepDt;
        tick();
        n++;
      }
      if (S.mode !== 'run') S.acc = 0;
    } else if (S.mode === 'rewind') {
      S.rewind.t += dt;
      if (S.rewind.t >= S.rewind.dur) finishRewind();
    } else if (S.mode === 'won' && !S.modal) {
      S.clearIn -= dt;
      if (S.clearIn <= 0) showClear();
    }

    const w = S.world;
    S.doorAmt = S.doorAmt.map((v, i) => {
      const target = w.doorOpen[i] ? 1 : 0;
      const d = target - v;
      return Math.abs(d) < 0.01 ? target : v + d * Math.min(1, dt * 14);
    });
    S.squash = Math.max(0, S.squash - dt * 7);
    S.shake = Math.max(0, S.shake - dt * 0.4);
    S.particles = S.particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 3;
      p.vy *= 1 - dt * 3;
      return p.life > 0;
    });

    renderer.draw(buildView());
    updateHud();
  }

  let lastTime = 0;
  function frame(now) {
    const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0;
    lastTime = now;
    S.t += dt;
    if (S.screen === 'game' && S.world) update(dt);
    requestAnimationFrame(frame);
  }

  // ---------- 입력 ----------
  const KEY_DIR = {
    ArrowUp: 1, KeyW: 1, ArrowRight: 2, KeyD: 2, ArrowDown: 3, KeyS: 3, ArrowLeft: 4, KeyA: 4,
  };

  function pressDir(d) {
    Sound.unlock();
    if (S.screen !== 'game' || S.modal) return;
    S.held = S.held.filter((x) => x !== d);
    S.held.push(d);
    if (S.mode === 'ready') begin();
    if (S.mode === 'run') S.queued = d;
  }
  function releaseDir(d) {
    S.held = S.held.filter((x) => x !== d);
  }

  function action(name) {
    Sound.unlock();
    if (S.screen !== 'game') return;
    if (S.modal === 'modal-clear') {
      if (name === 'end') next();
      else if (name === 'restart') startLevel(S.L.index);
      return;
    }
    if (S.modal) return;
    if (name === 'wait') begin();
    else if (name === 'end') {
      if (S.mode === 'run') endLoop(true);
      else if (S.mode === 'ready') note('먼저 움직이거나 Space로 시간을 흘려 보내세요');
    } else if (name === 'restart') restartLoop();
    else if (name === 'undo') undoGhost();
  }

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const d = KEY_DIR[e.code];
    if (d) {
      e.preventDefault();
      if (!e.repeat) pressDir(d);
      return;
    }
    switch (e.code) {
      case 'Space':
        if (S.screen === 'game' && !S.modal) {
          e.preventDefault();
          action('wait');
        }
        break;
      case 'Enter':
      case 'KeyE':
        if (S.screen === 'game' && S.modal !== 'modal-end') {
          if (e.code === 'Enter' && document.activeElement && document.activeElement.tagName === 'BUTTON' && S.modal) return;
          e.preventDefault();
          if (!e.repeat) action('end');
        }
        break;
      case 'KeyR':
        if (!e.repeat) action('restart');
        break;
      case 'KeyZ':
      case 'Backspace':
        if (S.screen === 'game') e.preventDefault();
        if (!e.repeat) action('undo');
        break;
      case 'KeyF':
      case 'ShiftLeft':
      case 'ShiftRight':
        S.ff = true;
        break;
      case 'KeyM':
        toggleMute();
        break;
      case 'Escape':
        if (S.screen === 'game') toTitle();
        break;
      default:
    }
  }

  function onKeyUp(e) {
    const d = KEY_DIR[e.code];
    if (d) releaseDir(d);
    if (e.code === 'KeyF' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') S.ff = false;
  }

  function toggleMute() {
    Sound.setMuted(!Sound.isMuted());
    progress.muted = Sound.isMuted();
    saveProgress();
    const b = $('btn-mute');
    b.setAttribute('aria-pressed', String(Sound.isMuted()));
    b.textContent = Sound.isMuted() ? '소리 꺼짐' : '소리 켜짐';
  }

  function holdButton(el, down, up) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      el.classList.add('is-held');
      down();
    });
    const end = () => {
      el.classList.remove('is-held');
      up();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function bind() {
    // 게임 화면 버튼은 눌러도 포커스를 가져가지 않는다. Enter/Space가 버튼을 다시 누르는 일을 막는다.
    document.querySelectorAll('#screen-game button').forEach((el) => {
      el.addEventListener('mousedown', (e) => e.preventDefault());
    });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => {
      S.held = [];
      S.ff = false;
    });

    document.querySelectorAll('[data-dir]').forEach((el) => {
      const d = Number(el.dataset.dir);
      holdButton(el, () => pressDir(d), () => releaseDir(d));
    });
    holdButton($('btn-ff'), () => {
      S.ff = true;
      action('wait');
    }, () => {
      S.ff = false;
    });
    $('btn-end').addEventListener('click', () => action('end'));
    $('btn-restart').addEventListener('click', () => action('restart'));
    $('btn-undo').addEventListener('click', () => action('undo'));
    $('btn-menu').addEventListener('click', toTitle);
    $('btn-mute').addEventListener('click', toggleMute);
    $('btn-play').addEventListener('click', () => {
      Sound.unlock();
      Sound.play('ui');
      startLevel(Number($('btn-play').dataset.level) || 0);
    });
    $('btn-next').addEventListener('click', next);
    $('btn-retry').addEventListener('click', () => startLevel(S.L.index));
    $('btn-list').addEventListener('click', toTitle);
    $('btn-end-title').addEventListener('click', toTitle);
  }

  // ---------- 시작 ----------
  function boot(data) {
    renderer = window.LoopRender.create($('board'));
    Sound.setMuted(!!progress.muted);
    $('btn-mute').setAttribute('aria-pressed', String(Sound.isMuted()));
    $('btn-mute').textContent = Sound.isMuted() ? '소리 꺼짐' : '소리 켜짐';
    bind();
    show('title');
    if (data && typeof data.level === 'number' && data.level >= 0 && data.level < LEVELS.length) startLevel(data.level);
    requestAnimationFrame(frame);
  }

  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ level: S.screen === 'game' && S.L ? S.L.index : -1 }));
  if (hot && hot.ready) hot.ready(boot);
  else boot((hot && hot.data) || {});
})();
