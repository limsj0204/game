/*
 * 10초 루프 — 결정론적 시뮬레이션.
 * 같은 맵과 같은 입력 기록이면 언제나 같은 결과가 나온다. 메아리(유령)는 이 성질 덕분에
 * 플레이어의 입력 기록을 그대로 다시 넣는 것만으로 재생된다. 브라우저와 Node 양쪽에서 쓴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LoopSim = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TPS = 60;        // 초당 틱
  const MOVE_TICKS = 9;  // 한 칸 이동에 걸리는 틱
  const HALF = 4;        // 남은 이동 틱이 이 값 이하가 되면 도착 칸을 밟은 것으로 본다
  // 0 정지, 1 위, 2 오른쪽, 3 아래, 4 왼쪽
  const DIRS = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]];

  const FLOOR = 0, WALL = 1, PLATE = 2, DOOR = 3, EXIT = 4, BARRIER = 5;
  const CLOCK = 3; // 시계 문이 쓰는 색 번호

  function parseLevel(def, index) {
    const rows = def.map;
    const h = rows.length;
    const w = rows[0].length;
    const grid = new Uint8Array(w * h);
    const plateAt = new Int16Array(w * h).fill(-1);
    const doorAt = new Int16Array(w * h).fill(-1);
    const plates = [];
    const doors = [];
    const boxes = [];
    let start = null;
    let exit = null;

    rows.forEach((row, y) => {
      if (row.length !== w) throw new Error(`${def.name}: ${y}번째 줄 길이가 다릅니다`);
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        const i = y * w + x;
        let t = FLOOR;
        if (ch === '#') t = WALL;
        else if ('abc'.includes(ch)) {
          t = PLATE;
          plateAt[i] = plates.length;
          plates.push({ x, y, c: 'abc'.indexOf(ch) });
        } else if ('ABC'.includes(ch) || 'xyz'.includes(ch)) {
          t = DOOR;
          doorAt[i] = doors.length;
          const inv = 'xyz'.includes(ch);
          doors.push({ x, y, c: (inv ? 'xyz' : 'ABC').indexOf(ch), inv });
        } else if (ch >= '1' && ch <= '9') {
          // 시계 문: 루프가 시작된 지 N초가 되면 1초 동안 열린다.
          t = DOOR;
          doorAt[i] = doors.length;
          doors.push({ x, y, c: CLOCK, inv: false, clock: Number(ch) });
        } else if (ch === '~') t = BARRIER; // 메아리 막: 메아리만 지나간다.
        else if (ch === 'S') start = { x, y };
        else if (ch === 'E') {
          t = EXIT;
          exit = { x, y };
        } else if (ch === 'o') boxes.push({ x, y });
        else if (ch !== '.') throw new Error(`${def.name}: 알 수 없는 타일 '${ch}'`);
        grid[i] = t;
      }
    });
    if (!start || !exit) throw new Error(`${def.name}: 시작(S)과 출구(E)가 필요합니다`);

    const colorPlates = [0, 1, 2].map((c) => plates.map((p, i) => (p.c === c ? i : -1)).filter((i) => i >= 0));
    return {
      index,
      name: def.name,
      hint: def.hint || '',
      w, h, grid, plateAt, doorAt, plates, doors, boxes, start, exit, colorPlates,
      limit: Math.round((def.time || 10) * TPS),
      maxGhosts: def.ghosts == null ? 1 : def.ghosts,
      par: def.par || 0,
      chapter: def.chapter || '',
      solution: def.solution || [],
    };
  }

  function mover(x, y) {
    return { x, y, fx: x, fy: y, mt: 0, dir: 3, blocked: false };
  }

  function createWorld(level, recordings) {
    const ents = recordings.map((rec, id) =>
      Object.assign(mover(level.start.x, level.start.y), { ghost: true, id, rec }));
    const player = Object.assign(mover(level.start.x, level.start.y), { ghost: false, id: -1, rec: [] });
    ents.push(player);
    const world = {
      level,
      tick: 0,
      ents,
      player,
      boxes: level.boxes.map((b) => mover(b.x, b.y)),
      platePressed: level.plates.map(() => false),
      doorOpen: level.doors.map(() => false),
      active: [false, false, false],
      events: [],
      won: false,
    };
    updateSwitches(world, true);
    return world;
  }

  function inside(L, x, y) {
    return x >= 0 && y >= 0 && x < L.w && y < L.h;
  }

  // ghostOk: 메아리는 메아리 막을 지나갈 수 있다.
  function solid(w, x, y, ghostOk) {
    const L = w.level;
    if (!inside(L, x, y)) return true;
    const t = L.grid[y * L.w + x];
    if (t === WALL) return true;
    if (t === BARRIER) return !ghostOk;
    if (t === DOOR) return !w.doorOpen[L.doorAt[y * L.w + x]];
    return false;
  }

  function boxAt(w, x, y) {
    for (const b of w.boxes) if (b.x === x && b.y === y) return b;
    return null;
  }

  function touches(m, x, y) {
    return (m.x === x && m.y === y) || (m.mt > 0 && m.fx === x && m.fy === y);
  }

  function entityAt(w, x, y) {
    return w.ents.some((e) => touches(e, x, y));
  }

  function occupied(w, x, y) {
    return entityAt(w, x, y) || w.boxes.some((b) => touches(b, x, y));
  }

  function startMove(m, x, y) {
    m.fx = m.x;
    m.fy = m.y;
    m.x = x;
    m.y = y;
    m.mt = MOVE_TICKS;
  }

  function tryMove(w, e, d) {
    const [dx, dy] = DIRS[d];
    e.dir = d;
    const tx = e.x + dx;
    const ty = e.y + dy;
    let ok = !solid(w, tx, ty, e.ghost);
    const box = ok ? boxAt(w, tx, ty) : null;
    if (box) {
      const bx = tx + dx;
      const by = ty + dy;
      ok = !solid(w, bx, by) && !boxAt(w, bx, by) && !entityAt(w, bx, by);
      if (ok) {
        startMove(box, bx, by);
        w.events.push({ type: 'push', x: bx, y: by, ghost: e.ghost });
      }
    }
    if (!ok) {
      if (!e.blocked) w.events.push({ type: 'bump', ghost: e.ghost, id: e.id, x: tx, y: ty });
      e.blocked = true;
      return false;
    }
    e.blocked = false;
    startMove(e, tx, ty);
    w.events.push({ type: 'step', ghost: e.ghost, id: e.id, x: tx, y: ty });
    return true;
  }

  // 이동 중인 물체는 절반을 넘게 가야 도착 칸을 밟은 것으로 친다.
  function footTile(m) {
    return m.mt > HALF ? [m.fx, m.fy] : [m.x, m.y];
  }

  function updateSwitches(w, initial) {
    const L = w.level;
    const pressed = L.plates.map(() => false);
    const mark = (m) => {
      const [x, y] = footTile(m);
      const i = L.plateAt[y * L.w + x];
      if (i >= 0) pressed[i] = true;
    };
    w.ents.forEach(mark);
    w.boxes.forEach(mark);

    pressed.forEach((on, i) => {
      if (!initial && on !== w.platePressed[i]) {
        const p = L.plates[i];
        w.events.push({ type: on ? 'press' : 'release', i, c: p.c, x: p.x, y: p.y });
      }
    });
    w.platePressed = pressed;

    for (let c = 0; c < 3; c++) {
      const group = L.colorPlates[c];
      w.active[c] = group.length > 0 && group.every((i) => pressed[i]);
    }

    // 문은 무언가가 걸쳐 있으면 닫히지 않는다. 여기서 정한 상태는 다음 틱에 쓰인다.
    const now = initial ? 0 : w.tick + 1;
    L.doors.forEach((d, i) => {
      let want;
      if (d.clock) want = now >= d.clock * TPS && now < (d.clock + 1) * TPS;
      else want = d.inv ? !w.active[d.c] : w.active[d.c];
      const open = want || occupied(w, d.x, d.y);
      if (!initial && open !== w.doorOpen[i]) {
        w.events.push({ type: open ? 'open' : 'close', i, c: d.c, x: d.x, y: d.y });
      }
      w.doorOpen[i] = open;
    });
  }

  // action: 이번 틱에 플레이어가 누르고 있는 방향(0~4). 기록은 원본 입력 그대로 남긴다.
  function step(w, action) {
    w.events = [];
    if (w.won) return;
    for (const e of w.ents) if (e.mt > 0) e.mt--;
    for (const b of w.boxes) if (b.mt > 0) b.mt--;

    // 출구에 도착한 순간 탈출한다. 방향키를 계속 누르고 있어도 지나쳐 가지 않는다.
    const p = w.player;
    const ex = w.level.exit;
    if (p.mt === 0 && p.x === ex.x && p.y === ex.y) {
      w.won = true;
      w.events.push({ type: 'win', x: ex.x, y: ex.y });
      w.tick++;
      return;
    }

    w.player.rec.push(action);
    for (const e of w.ents) {
      const a = e.ghost ? (w.tick < e.rec.length ? e.rec[w.tick] : 0) : action;
      if (!a) e.blocked = false;
      else if (e.mt === 0) tryMove(w, e, a);
    }

    updateSwitches(w, false);
    w.tick++;
  }

  // alpha: 다음 틱까지 진행된 비율(0~1). 부드러운 그리기용.
  function renderPos(m, alpha) {
    const t = Math.max(0, m.mt - (alpha || 0)) / MOVE_TICKS;
    return { x: m.x + (m.fx - m.x) * t, y: m.y + (m.fy - m.y) * t };
  }

  return {
    TPS, MOVE_TICKS, DIRS,
    FLOOR, WALL, PLATE, DOOR, EXIT, BARRIER, CLOCK,
    parseLevel, createWorld, step, renderPos, solid,
  };
});
