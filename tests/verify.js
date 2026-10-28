/*
 * 스테이지 검증: node tests/verify.js
 *  1) 모든 스테이지의 풀이를 실제 시뮬레이션으로 돌려 탈출하는지 확인한다.
 *  2) 메아리가 필요한 스테이지는 메아리 없이 풀리지 않는지 너비 우선 탐색으로 확인한다.
 *  3) 맵 규칙(발판이 자기 문 바로 옆에 붙어 있지 않은지 등)을 확인한다.
 */
'use strict';
const Sim = require('../js/sim.js');
const DEFS = require('../js/levels.js');

function expand(script) {
  const out = [];
  for (const tok of script.trim().split(/\s+/).filter(Boolean)) {
    const h = /^h([UDLR])$/.exec(tok);
    if (h) {
      out.push({ hold: 'URDL'.indexOf(h[1]) + 1 });
      continue;
    }
    // p<방향><틱>: 움직이든 막히든 그 방향을 정해진 틱 동안 누른다(메아리 막 너머를 미리 입력할 때).
    const pr = /^p([UDLR])(\d+)$/.exec(tok);
    if (pr) {
      out.push({ press: 'URDL'.indexOf(pr[1]) + 1, wait: Number(pr[2]) });
      continue;
    }
    const m = /^([UDLRwX])(\d*)$/.exec(tok);
    if (!m) throw new Error(`알 수 없는 풀이 토큰: ${tok}`);
    const n = m[2] ? Number(m[2]) : 1;
    if (m[1] === 'X') out.push({ end: true });
    else if (m[1] === 'w') out.push({ wait: n });
    else for (let i = 0; i < n; i++) out.push({ dir: 'URDL'.indexOf(m[1]) + 1 });
  }
  return out;
}

function runLoop(level, recs, script) {
  const w = Sim.createWorld(level, recs);
  const q = expand(script);
  while (w.tick < level.limit && !w.won) {
    const head = q[0];
    if (head && head.end) {
      q.shift();
      break;
    }
    const p = w.player;
    const px = p.x;
    const py = p.y;
    Sim.step(w, head ? head.dir || head.hold || head.press || 0 : 0);
    if (!head) continue;
    if (head.dir && (p.x !== px || p.y !== py)) q.shift();
    else if (head.wait != null && --head.wait <= 0) q.shift();
  }
  return { w, left: q.filter((c) => !c.hold).length };
}

function cloneWorld(w) {
  const ents = w.ents.map((e) => Object.assign({}, e, { rec: e.ghost ? e.rec : [] }));
  return Object.assign({}, w, {
    ents,
    player: ents[ents.length - 1],
    boxes: w.boxes.map((b) => Object.assign({}, b)),
    platePressed: w.platePressed.slice(),
    doorOpen: w.doorOpen.slice(),
    active: w.active.slice(),
    filled: w.filled.slice(),
  });
}

// 메아리 없이 탈출할 수 있는지(시간 제한 포함) 탐색한다.
// 한 번의 전이는 한 칸 이동이나 한 칸 이동만큼(9틱) 기다리기다. 시계 문이 있어 시각도 상태에 넣는다.
function solvableAlone(level) {
  const ex = level.exit;
  const key = (w) => [w.tick, w.player.x, w.player.y, ...w.boxes.map((b) => `${b.x},${b.y}`), w.doorOpen.join(''), w.toggle, w.filled.join('')].join('|');
  let frontier = [Sim.createWorld(level, [])];
  const seen = new Set();
  while (frontier.length) {
    const next = [];
    for (const w of frontier) {
      for (let d = 0; d <= 4; d++) {
        const n = cloneWorld(w);
        const px = n.player.x;
        const py = n.player.y;
        Sim.step(n, d);
        if (d && n.player.x === px && n.player.y === py) continue;
        for (let k = 0; k < Sim.MOVE_TICKS - 1; k++) Sim.step(n, 0);
        if (n.tick >= level.limit) continue;
        if (n.player.x === ex.x && n.player.y === ex.y) return true;
        const k = key(n);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  return false;
}

function checkLayout(level) {
  const problems = [];
  for (const d of level.doors) {
    for (const p of level.plates) {
      if (p.c === d.c && Math.abs(p.x - d.x) + Math.abs(p.y - d.y) === 1) {
        problems.push(`발판(${p.x},${p.y})이 문(${d.x},${d.y}) 바로 옆에 있습니다`);
      }
    }
  }
  return problems;
}

let failed = 0;
DEFS.forEach((def, i) => {
  const level = Sim.parseLevel(def, i);
  const errors = checkLayout(level);
  const sol = level.solution;
  const recs = [];
  let won = false;
  let tick = 0;
  sol.forEach((script, li) => {
    const last = li === sol.length - 1;
    const { w, left } = runLoop(level, recs, script);
    if (last) {
      won = w.won;
      tick = w.tick;
      if (!won) {
        const p = w.player;
        errors.push(`마지막 루프에서 탈출 실패 (위치 ${p.x},${p.y}, 틱 ${w.tick}, 남은 명령 ${left})`);
      }
    } else {
      if (w.won) errors.push(`${li + 1}번째 루프에서 이미 탈출함`);
      if (left) errors.push(`${li + 1}번째 루프 명령 ${left}개가 실행되지 못함`);
      recs.push(w.player.rec);
    }
  });
  if (recs.length > level.maxGhosts) errors.push(`메아리 ${recs.length}명 사용, 허용 ${level.maxGhosts}명`);
  if (recs.length !== level.par) errors.push(`풀이는 메아리 ${recs.length}명인데 par는 ${level.par}`);
  if (level.par > 0 && solvableAlone(level)) errors.push('메아리 없이도 풀립니다');

  const label = `${String(i + 1).padStart(2, '0')} ${level.name}`;
  if (errors.length) {
    failed++;
    console.log(`✗ ${label}`);
    errors.forEach((e) => console.log(`    - ${e}`));
  } else {
    console.log(`✓ ${label}  (메아리 ${recs.length}, ${(tick / Sim.TPS).toFixed(2)}초)`);
  }
});

if (failed) {
  console.log(`\n${failed}개 스테이지 실패`);
  process.exit(1);
}
console.log('\n모든 스테이지 통과');
