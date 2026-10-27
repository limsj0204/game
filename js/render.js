/* 캔버스 그리기. 게임 상태를 읽기만 하고 바꾸지 않는다. */
(function () {
  'use strict';

  const PAL = {
    ink: '#120f24',
    floorA: '#1c1838',
    floorB: '#1f1b3e',
    wallTop: '#332d63',
    wallFace: '#231e4a',
    wallEdge: '#4a4290',
    present: '#ffc04d',
    presentDeep: '#c27a12',
    echo: '#7ee8d8',
    exit: '#fff1cf',
    colors: ['#ff5d7a', '#4aa8ff', '#c8e05a'],
    box: '#c08f5c',
    boxDark: '#7d5934',
    boxLight: '#e3b67f',
  };

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, ts = 32, ox = 0, oy = 0, dpr = 1;

    function layout(L) {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, Math.round(rect.width * dpr));
      const ch = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      W = cw;
      H = ch;
      ts = Math.max(8, Math.floor(Math.min(W / (L.w + 0.6), H / (L.h + 0.6))));
      ox = Math.round((W - ts * L.w) / 2);
      oy = Math.round((H - ts * L.h) / 2);
    }

    const px = (x) => ox + x * ts;
    const py = (y) => oy + y * ts;

    function tileAt(L, x, y) {
      if (x < 0 || y < 0 || x >= L.w || y >= L.h) return 1;
      return L.grid[y * L.w + x];
    }

    function drawBoard(L) {
      for (let y = 0; y < L.h; y++) {
        for (let x = 0; x < L.w; x++) {
          if (tileAt(L, x, y) === 1) continue;
          ctx.fillStyle = (x + y) % 2 ? PAL.floorA : PAL.floorB;
          ctx.fillRect(px(x), py(y), ts, ts);
        }
      }
      // 벽: 윗면 + 아래쪽이 트인 곳에는 앞면을 그려 입체감을 준다.
      const face = Math.round(ts * 0.22);
      for (let y = 0; y < L.h; y++) {
        for (let x = 0; x < L.w; x++) {
          if (tileAt(L, x, y) !== 1) continue;
          const open = tileAt(L, x, y + 1) !== 1;
          const inner = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => tileAt(L, x + dx, y + dy) !== 1);
          ctx.fillStyle = inner ? PAL.wallTop : PAL.ink;
          ctx.fillRect(px(x), py(y), ts + 1, ts + 1);
          if (open) {
            ctx.fillStyle = PAL.wallFace;
            ctx.fillRect(px(x), py(y + 1) - face, ts + 1, face);
            ctx.fillStyle = PAL.wallEdge;
            ctx.fillRect(px(x), py(y + 1) - face - 1, ts + 1, Math.max(1, dpr));
          }
        }
      }
    }

    function drawExit(L, t, won) {
      const cx = px(L.exit.x + 0.5);
      const cy = py(L.exit.y + 0.5);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, ts * 0.9);
      g.addColorStop(0, alpha(PAL.exit, won ? 0.7 : 0.35));
      g.addColorStop(1, alpha(PAL.exit, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - ts, cy - ts, ts * 2, ts * 2);
      ctx.lineWidth = Math.max(1.5, ts * 0.06);
      for (let i = 0; i < 2; i++) {
        const r = ts * (0.3 - i * 0.1);
        const a0 = t * (i ? -2.4 : 1.6);
        ctx.strokeStyle = alpha(i ? PAL.present : PAL.exit, 0.9);
        ctx.setLineDash([ts * 0.12, ts * 0.09]);
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a0 + Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    function drawPlates(L, on, t) {
      L.plates.forEach((p, i) => {
        const col = PAL.colors[p.c];
        const m = ts * 0.2;
        const x = px(p.x) + m;
        const y = py(p.y) + m;
        const s = ts - m * 2;
        ctx.save();
        if (on[i]) {
          ctx.shadowColor = col;
          ctx.shadowBlur = ts * 0.5;
          ctx.fillStyle = alpha(col, 0.85);
        } else {
          ctx.fillStyle = alpha(col, 0.12 + 0.05 * Math.sin(t * 3 + i));
        }
        rr(ctx, x, y, s, s, ts * 0.12);
        ctx.fill();
        ctx.restore();
        ctx.lineWidth = Math.max(1.5, ts * 0.06);
        ctx.strokeStyle = col;
        rr(ctx, x, y, s, s, ts * 0.12);
        ctx.stroke();
      });
    }

    function drawDoors(L, amt) {
      L.doors.forEach((d, i) => {
        const col = PAL.colors[d.c];
        const x = px(d.x);
        const y = py(d.y);
        const a = amt[i];
        // 문틀
        ctx.strokeStyle = alpha(col, 0.55);
        ctx.lineWidth = Math.max(1, ts * 0.04);
        ctx.strokeRect(x + ts * 0.08, y + ts * 0.08, ts * 0.84, ts * 0.84);
        if (a >= 0.99) return;
        // 양쪽으로 갈라지며 열린다.
        const half = (ts * 0.84 / 2) * (1 - a);
        const top = y + ts * 0.08;
        const h = ts * 0.84;
        [[x + ts * 0.08, half], [x + ts * 0.92 - half, half]].forEach(([lx, w]) => {
          ctx.save();
          ctx.beginPath();
          ctx.rect(lx, top, w, h);
          ctx.clip();
          ctx.fillStyle = alpha(col, 0.88);
          ctx.fillRect(lx, top, w, h);
          ctx.strokeStyle = alpha(PAL.ink, 0.45);
          ctx.lineWidth = Math.max(1, ts * 0.07);
          ctx.beginPath();
          if (d.inv) {
            for (let k = -h; k < ts * 2; k += ts * 0.24) {
              ctx.moveTo(x + k, top);
              ctx.lineTo(x + k + h, top + h);
            }
          } else {
            for (let k = ts * 0.22; k < h; k += ts * 0.22) {
              ctx.moveTo(lx, top + k);
              ctx.lineTo(lx + w, top + k);
            }
          }
          ctx.stroke();
          ctx.restore();
        });
      });
    }

    function drawPaths(paths) {
      ctx.lineWidth = Math.max(1, ts * 0.05);
      ctx.setLineDash([ts * 0.08, ts * 0.14]);
      paths.forEach((path) => {
        if (path.length < 2) return;
        ctx.strokeStyle = alpha(PAL.echo, 0.28);
        ctx.beginPath();
        path.forEach((p, i) => {
          const x = px(p.x + 0.5);
          const y = py(p.y + 0.5);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      });
      ctx.setLineDash([]);
      paths.forEach((path, i) => {
        const end = path[path.length - 1];
        if (!end) return;
        const x = px(end.x + 0.5);
        const y = py(end.y + 0.5);
        ctx.strokeStyle = alpha(PAL.echo, 0.45);
        ctx.lineWidth = Math.max(1, ts * 0.04);
        ctx.beginPath();
        ctx.arc(x, y, ts * 0.36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = alpha(PAL.echo, 0.6);
        ctx.font = `600 ${Math.round(ts * 0.22)}px "IBM Plex Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x + ts * 0.32, y - ts * 0.32);
      });
    }

    function drawBox(b) {
      const m = ts * 0.1;
      const x = px(b.x) + m;
      const y = py(b.y) + m;
      const s = ts - m * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      rr(ctx, x + ts * 0.04, y + ts * 0.08, s, s, ts * 0.1);
      ctx.fill();
      ctx.fillStyle = PAL.box;
      rr(ctx, x, y, s, s, ts * 0.1);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, ts * 0.07);
      ctx.strokeStyle = PAL.boxDark;
      rr(ctx, x + ts * 0.06, y + ts * 0.06, s - ts * 0.12, s - ts * 0.12, ts * 0.06);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + ts * 0.14, y + ts * 0.14);
      ctx.lineTo(x + s - ts * 0.14, y + s - ts * 0.14);
      ctx.moveTo(x + s - ts * 0.14, y + ts * 0.14);
      ctx.lineTo(x + ts * 0.14, y + s - ts * 0.14);
      ctx.stroke();
      ctx.fillStyle = PAL.boxLight;
      ctx.fillRect(x + ts * 0.1, y + ts * 0.02, s - ts * 0.2, Math.max(1, ts * 0.04));
    }

    // 막힌 쪽으로 계속 밀고 있으면 그쪽으로 몸을 기울이고 화살표를 띄운다.
    function lean(dir, t) {
      if (!dir) return [0, 0];
      const [dx, dy] = window.LoopSim.DIRS[dir];
      const k = ts * (0.07 + 0.025 * Math.sin(t * 20));
      return [dx * k, dy * k];
    }

    function drawChevron(cx, cy, dir, color, t) {
      if (!dir) return;
      const [dx, dy] = window.LoopSim.DIRS[dir];
      const d = ts * (0.47 + 0.03 * Math.sin(t * 20));
      const s = ts * 0.1;
      const x = cx + dx * d;
      const y = cy + dy * d;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, ts * 0.055);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x - dx * s + dy * s, y - dy * s - dx * s);
      ctx.lineTo(x, y);
      ctx.lineTo(x - dx * s - dy * s, y - dy * s + dx * s);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
    }

    function drawGhost(e, t) {
      const [lx, ly] = lean(e.push, t);
      const cx = px(e.x + 0.5) + lx;
      const cy = py(e.y + 0.5) + ly + Math.sin(t * 4 + e.id) * ts * 0.03;
      const r = ts * 0.3;
      // 테이프 잔상처럼 살짝 어긋난 색 테두리
      ctx.lineWidth = Math.max(1, ts * 0.05);
      ctx.strokeStyle = 'rgba(255,93,170,0.35)';
      ctx.beginPath();
      ctx.arc(cx - ts * 0.035, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.shadowColor = PAL.echo;
      ctx.shadowBlur = ts * 0.35;
      ctx.fillStyle = alpha(PAL.echo, e.done ? 0.22 : 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = alpha(PAL.echo, 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      drawChevron(cx, cy, e.push, PAL.echo, t);
      ctx.fillStyle = PAL.echo;
      ctx.font = `600 ${Math.round(ts * 0.28)}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(e.id + 1), cx, cy + ts * 0.01);
    }

    function drawPresent(e, view) {
      const [lx, ly] = lean(e.push, view.t);
      const cx = px(e.x + 0.5) + lx;
      const cy = py(e.y + 0.5) + ly;
      const r = ts * 0.32;
      const sq = e.squash || 0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1 + sq * 0.12, 1 - sq * 0.12);
      if (view.mode === 'ready') {
        const k = (view.t * 1.2) % 1;
        ctx.strokeStyle = alpha(PAL.present, 0.6 * (1 - k));
        ctx.lineWidth = Math.max(1, ts * 0.05);
        ctx.beginPath();
        ctx.arc(0, 0, r * (1 + k * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowColor = PAL.present;
      ctx.shadowBlur = ts * 0.45;
      ctx.fillStyle = PAL.present;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // 시계 바늘: 이번 루프에서 흐른 시간
      ctx.strokeStyle = PAL.ink;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, ts * 0.07);
      const ang = -Math.PI / 2 + view.progress * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(ang) * r * 0.66, Math.sin(ang) * r * 0.66);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, ts * 0.045);
      ctx.strokeStyle = alpha(PAL.ink, 0.35);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
        ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
        ctx.stroke();
      }
      ctx.fillStyle = PAL.ink;
      ctx.beginPath();
      ctx.arc(0, 0, ts * 0.045, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.lineCap = 'butt';
      drawChevron(cx, cy, e.push, PAL.present, view.t);
    }

    function drawParticles(list) {
      list.forEach((p) => {
        const k = p.life / p.max;
        ctx.fillStyle = alpha(p.color, Math.max(0, k));
        const s = ts * p.size * (0.4 + k * 0.6);
        if (p.ring) {
          ctx.strokeStyle = alpha(p.color, Math.max(0, k) * 0.8);
          ctx.lineWidth = Math.max(1, ts * 0.05 * k);
          ctx.beginPath();
          ctx.arc(px(p.x), py(p.y), ts * p.size * (1.6 - k), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillRect(px(p.x) - s / 2, py(p.y) - s / 2, s, s);
        }
      });
    }

    function drawRewind(view) {
      const k = view.rewindK;
      ctx.fillStyle = alpha(PAL.echo, 0.06 + 0.06 * Math.sin(k * Math.PI));
      ctx.fillRect(0, 0, W, H);
      let seed = Math.floor(view.t * 30);
      const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let i = 0; i < 7; i++) {
        const y = rnd() * H;
        const h = (2 + rnd() * 10) * dpr;
        ctx.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.08})`;
        ctx.fillRect(0, y, W, h);
        ctx.fillStyle = 'rgba(255,93,170,0.07)';
        ctx.fillRect(rnd() * 20 * dpr, y + h, W, h * 0.5);
      }
    }

    function drawVignette() {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(4,3,12,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    function draw(view) {
      const L = view.L;
      layout(L);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, W, H);
      if (view.shake) {
        ctx.translate((Math.random() - 0.5) * view.shake * ts, (Math.random() - 0.5) * view.shake * ts);
      }
      drawBoard(L);
      drawExit(L, view.t, view.won);
      drawPlates(L, view.plateOn, view.t);
      if (view.mode === 'ready' || view.mode === 'run') drawPaths(view.paths);
      drawDoors(L, view.doorAmt);
      view.boxes.forEach(drawBox);
      view.ghosts.forEach((g) => drawGhost(g, view.t));
      if (view.present && !view.won) drawPresent(view.present, view);
      drawParticles(view.particles);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (view.mode === 'rewind') drawRewind(view);
      drawVignette();
    }

    // 화면 좌표 → 타일 좌표(터치 조작용)
    function toTile(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) * dpr - ox) / ts,
        y: ((clientY - rect.top) * dpr - oy) / ts,
      };
    }

    return { draw, toTile };
  }

  window.LoopRender = { create, PAL };
})();
