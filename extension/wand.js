// Magma 마법봉
// Magma 페이지 안에서 직접 실행되는 스크립트. 크롬 확장과 데스크톱 앱 실행기가 같은 파일을 쓴다.
// 동작: 화면에 보이는 그림 픽셀을 읽어 클릭한 곳과 비슷한 색으로 이어진 영역을 계산하고,
//       그 테두리를 따라 Magma 자체 올가미(선택 / 올가미 채우기)를 대신 그어 준다.
// 새 버전이 같은 페이지에 다시 들어오면 옛 버전을 걷어내고 그 자리를 대신한다(새로고침 없이 업데이트).
(() => {
  'use strict';
  const VERSION = '0.2.0';
  const isNewer = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b || '0').split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
  };
  const prev = window.__magmaWand;
  if (prev) {
    if (!isNewer(VERSION, prev.version)) return;
    try { prev.destroy && prev.destroy(); } catch (e) { console.warn('[MagmaWand] 옛 버전 정리 실패', e); }
  }
  const upgradedFrom = prev ? prev.version : null;
  window.__magmaWand = { version: VERSION };

  // 나중에 깨끗하게 걷어낼 수 있도록 등록한 것들을 모아 둔다
  const cleanups = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  // ---------- 설정 ----------
  const DEFAULTS = { tol: 10, expand: 1, mode: 'select', px: null, py: null };
  const S = Object.assign({}, DEFAULTS, loadSettings(), { active: false, busy: false });

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('magmaWand.settings') || '{}'); } catch { return {}; }
  }
  function saveSettings() {
    try {
      const { tol, expand, mode, px, py } = S;
      localStorage.setItem('magmaWand.settings', JSON.stringify({ tol, expand, mode, px, py }));
    } catch { /* 저장 못 해도 동작에는 지장 없음 */ }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  // ---------- Magma 화면 요소 ----------
  const getCanvas = () => document.querySelector('.editor-canvas canvas');

  function toolButtons() { return [...document.querySelectorAll('button.tool')]; }
  function toolName(btn) {
    const cls = btn.querySelector('svg')?.getAttribute('class') || '';
    const m = cls.match(/icon-([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }
  function currentTool() {
    const b = toolButtons().find((b) => !b.classList.contains('off'));
    return b ? toolName(b) : null;
  }
  // 버튼을 사람이 누른 것처럼 (Magma는 click 하나로는 반응하지 않음)
  function press(el) {
    const r = el.getBoundingClientRect();
    const o = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true,
      composed: true, view: window, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
  }
  async function selectTool(name) {
    if (!name || currentTool() === name) return true;
    const b = toolButtons().find((b) => toolName(b) === name);
    if (!b) return false;
    press(b);
    for (let i = 0; i < 20 && currentTool() !== name; i++) await sleep(25);
    await sleep(60);
    return currentTool() === name;
  }

  // 현재 도구 설정 패널의 "Stabilizer"(손떨림 보정) 값
  function stabilizerRow() {
    return [...document.querySelectorAll('.tool-slider')].find(
      (r) => r.offsetParent !== null && r.querySelector('.slider-label')?.textContent.trim() === 'Stabilizer');
  }
  function getStabilizer() {
    const row = stabilizerRow();
    if (!row) return null;
    const v = parseFloat(row.querySelector('editable-number')?.textContent.trim());
    return Number.isFinite(v) ? v : null;
  }
  async function setStabilizer(v) {
    const row = stabilizerRow();
    const en = row?.querySelector('editable-number');
    if (!en) return false;
    if (getStabilizer() === v) return true;
    en.querySelector('button')?.click();
    await sleep(40);
    const inp = en.querySelector('input');
    if (!inp) return false;
    inp.focus();
    inp.value = String(v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.blur();
    await sleep(60);
    return getStabilizer() === v;
  }

  // 선택 모드 버튼(새 선택 / 추가 / 빼기)
  function selectionModeButtons() {
    return [...document.querySelectorAll('.selection-tool button[radiovalue]')];
  }
  function getSelectionMode() {
    const b = selectionModeButtons().find((b) => b.classList.contains('active') || b.classList.contains('on'));
    return b ? b.getAttribute('radiovalue') : null;
  }
  async function setSelectionMode(v) {
    if (!v || getSelectionMode() === v) return true;
    const b = selectionModeButtons().find((b) => b.getAttribute('radiovalue') === v);
    if (!b) return false;
    press(b);
    await sleep(60);
    return getSelectionMode() === v;
  }

  // ---------- 픽셀 읽기 ----------
  // Magma의 WebGL 화면은 그린 직후 한 프레임 안에서만 읽을 수 있다. 그래서 그리기 직후 프레임에서 읽는다.
  function readScreen(canvas) {
    return new Promise((resolve) => {
      // 창이 가려져 화면 갱신이 멈춘 경우 영원히 기다리지 않도록
      const timer = setTimeout(() => resolve({ w: 0, h: 0, data: null, blank: true }), 3000);
      const done = (v) => { clearTimeout(timer); resolve(v); };
      const tryRead = (left) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const w = canvas.width, h = canvas.height;
          const tmp = document.createElement('canvas');
          tmp.width = w; tmp.height = h;
          const g = tmp.getContext('2d', { willReadFrequently: true });
          g.drawImage(canvas, 0, 0);
          const data = g.getImageData(0, 0, w, h).data;
          // 화면 전체가 완전한 검정이면 아직 못 읽은 것 → 다시 시도
          let blank = true;
          for (let i = 0; i < data.length; i += 4 * 997) {
            if (data[i] || data[i + 1] || data[i + 2]) { blank = false; break; }
          }
          if (blank && left > 0) tryRead(left - 1);
          else done({ w, h, data, blank });
        }));
      };
      tryRead(8);
    });
  }

  // ---------- 영역 계산 ----------
  function floodFill(img, sx, sy, tolPct) {
    const { w, h, data } = img;
    const mask = new Uint8Array(w * h);
    const si = (sy * w + sx) * 4;
    const r0 = data[si], g0 = data[si + 1], b0 = data[si + 2];
    const t = Math.round((tolPct / 100) * 255);
    const ok = (p) => {
      const i = p * 4;
      return Math.abs(data[i] - r0) <= t && Math.abs(data[i + 1] - g0) <= t && Math.abs(data[i + 2] - b0) <= t;
    };
    const stack = new Int32Array(w * h);
    let sp = 0;
    const start = sy * w + sx;
    mask[start] = 1; stack[sp++] = start;
    let count = 0;
    while (sp) {
      const p = stack[--sp];
      count++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && !mask[p - 1] && ok(p - 1)) { mask[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !mask[p + 1] && ok(p + 1)) { mask[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !mask[p - w] && ok(p - w)) { mask[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && !mask[p + w] && ok(p + w)) { mask[p + w] = 1; stack[sp++] = p + w; }
    }
    return { mask, count };
  }

  // 영역을 바깥으로 n픽셀 넓힘 (선화의 부드러운 가장자리 밑까지 칠하기 위함)
  function dilate(mask, w, h, n) {
    for (let k = 0; k < n; k++) {
      const src = mask.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (src[p]) continue;
          if ((x > 0 && src[p - 1]) || (x < w - 1 && src[p + 1]) ||
              (y > 0 && src[p - w]) || (y < h - 1 && src[p + w])) mask[p] = 1;
        }
      }
    }
    return mask;
  }

  // 픽셀 경계선을 따라 닫힌 테두리들을 추적 (바깥 테두리 1개 + 구멍들)
  function traceContours(mask, w, h) {
    const W1 = w + 1, NV = (w + 1) * (h + 1);
    const e1 = new Int32Array(NV).fill(-1), p1 = new Int32Array(NV);
    const e2 = new Int32Array(NV).fill(-1), p2 = new Int32Array(NV);
    const in_ = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    const add = (ax, ay, bx, by, pix) => {
      const a = ay * W1 + ax, b = by * W1 + bx;
      if (e1[a] < 0) { e1[a] = b; p1[a] = pix; } else { e2[a] = b; p2[a] = pix; }
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const pix = y * w + x;
        if (!in_(x, y - 1)) add(x + 1, y, x, y, pix);
        if (!in_(x - 1, y)) add(x, y, x, y + 1, pix);
        if (!in_(x, y + 1)) add(x, y + 1, x + 1, y + 1, pix);
        if (!in_(x + 1, y)) add(x + 1, y + 1, x + 1, y, pix);
      }
    }
    const used1 = new Uint8Array(NV), used2 = new Uint8Array(NV);
    const loops = [];
    for (let v0 = 0; v0 < NV; v0++) {
      for (const slot of [1, 2]) {
        const E = slot === 1 ? e1 : e2, U = slot === 1 ? used1 : used2, P = slot === 1 ? p1 : p2;
        if (E[v0] < 0 || U[v0]) continue;
        const pts = [];
        let v = v0, s = slot, pix = P[v0];
        for (;;) {
          (s === 1 ? used1 : used2)[v] = 1;
          pts.push(v);
          const nv = (s === 1 ? e1 : e2)[v];
          v = nv;
          // 다음 변 고르기: 꼭짓점에 두 갈래가 있으면 같은 픽셀을 계속 도는 쪽 (4방향 연결 유지)
          let ns;
          if (e2[v] < 0) ns = 1;
          else ns = (p1[v] === pix) ? 1 : (p2[v] === pix ? 2 : (used1[v] ? 2 : 1));
          if ((ns === 1 ? used1 : used2)[v]) break;
          s = ns;
          pix = (ns === 1 ? p1 : p2)[v];
        }
        // 꼭짓점 번호 → 좌표, 일직선 위의 점은 제거
        const xy = [];
        for (let i = 0; i < pts.length; i++) xy.push([pts[i] % W1, (pts[i] / W1) | 0]);
        loops.push(compressCollinear(xy));
      }
    }
    return loops;
  }

  function compressCollinear(pts) {
    const n = pts.length;
    if (n < 4) return pts;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (cross !== 0) out.push(b);
    }
    return out;
  }

  function area(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  // 계단 모양 테두리를 매끈한 선으로 줄임 (닫힌 도형용 Douglas-Peucker)
  function simplify(pts, eps) {
    if (pts.length < 8) return pts;
    const rdp = (arr) => {
      if (arr.length < 3) return arr;
      const a = arr[0], b = arr[arr.length - 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      let best = -1, bi = 0;
      for (let i = 1; i < arr.length - 1; i++) {
        const d = Math.abs(dy * arr[i][0] - dx * arr[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
        if (d > best) { best = d; bi = i; }
      }
      if (best <= eps) return [a, b];
      const l = rdp(arr.slice(0, bi + 1)), r = rdp(arr.slice(bi));
      return l.slice(0, -1).concat(r);
    };
    // 가장 먼 두 점으로 둘로 나눠 처리
    let far = 0, fd = -1;
    for (let i = 1; i < pts.length; i++) {
      const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
      if (d > fd) { fd = d; far = i; }
    }
    const A = rdp(pts.slice(0, far + 1));
    const B = rdp(pts.slice(far).concat([pts[0]]));
    const out = A.slice(0, -1).concat(B.slice(0, -1));
    return out.length >= 3 ? out : pts;
  }

  // 구멍을 바깥 테두리에 "폭 0짜리 다리"로 이어 붙여 한 붓 그리기 도형으로 만든다
  function mergeHoles(outer, holes) {
    let poly = outer.slice();
    const rest = holes.slice();
    while (rest.length) {
      let best = Infinity, bh = -1, bi = 0, bj = 0;
      for (let k = 0; k < rest.length; k++) {
        const H = rest[k];
        for (let j = 0; j < H.length; j++) {
          const hx = H[j][0], hy = H[j][1];
          for (let i = 0; i < poly.length; i++) {
            const d = (poly[i][0] - hx) ** 2 + (poly[i][1] - hy) ** 2;
            if (d < best) { best = d; bh = k; bi = i; bj = j; }
          }
        }
      }
      const H = rest.splice(bh, 1)[0];
      const loop = H.slice(bj).concat(H.slice(0, bj), [H[bj]]);
      poly = poly.slice(0, bi + 1).concat(loop, [poly[bi]], poly.slice(bi + 1));
    }
    return poly;
  }

  const MIN_HOLE = 24; // 픽셀 넓이
  function buildPolygon(mask, w, h) {
    const loops = traceContours(mask, w, h).filter((l) => l.length >= 3);
    if (!loops.length) return null;
    let oi = 0, oa = 0;
    loops.forEach((l, i) => { const a = Math.abs(area(l)); if (a > oa) { oa = a; oi = i; } });
    const outer = simplify(loops[oi], 0.7);
    // 아주 작은 구멍(기존 선택의 점선 테두리, 잡티 등)은 메운다
    let holes = loops.filter((_, i) => i !== oi).map((l) => ({ l, a: Math.abs(area(l)) }))
      .filter((x) => x.a > MIN_HOLE);
    holes.sort((a, b) => b.a - a.a);
    holes = holes.slice(0, 300).map((x) => simplify(x.l, 0.7));
    return { poly: holes.length ? mergeHoles(outer, holes) : outer, holes: holes.length };
  }

  // ---------- 올가미 대신 긋기 ----------
  // Magma는 한 프레임에 너무 많은 움직임이 들어오면 일부를 버린다 → perFrame개씩 끊어서 보낸다
  let PER_FRAME = 40;
  async function drawLasso(canvas, poly, mods, perFrame = PER_FRAME) {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
    const P = poly.map(([x, y]) => [rect.left + x * sx, rect.top + y * sy]);
    P.push(P[0]);
    const base = { bubbles: true, cancelable: true, composed: true, view: window, pointerId: 1,
      pointerType: 'mouse', isPrimary: true, width: 1, height: 1,
      shiftKey: !!mods.shift, altKey: !!mods.alt, ctrlKey: false, metaKey: false };
    const fire = (type, x, y, down) => {
      const o = { ...base, clientX: x, clientY: y, screenX: x, screenY: y,
        button: type === 'pointermove' ? -1 : 0, buttons: down ? 1 : 0, pressure: down ? 0.5 : 0 };
      const ev = new PointerEvent(type, o);
      ev.__magmaWand = true;
      canvas.dispatchEvent(ev);
    };
    fire('pointermove', P[0][0], P[0][1], false);
    await nextFrame();
    fire('pointerdown', P[0][0], P[0][1], true);
    let n = 0;
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
      for (let t = 1; t <= steps; t++) {
        fire('pointermove', ax + (bx - ax) * t / steps, ay + (by - ay) * t / steps, true);
        if (++n % perFrame === 0) await nextFrame();
      }
    }
    fire('pointerup', P[0][0], P[0][1], false);
    await nextFrame();
  }

  // ---------- 클릭 한 번의 전체 흐름 ----------
  async function runWand(clientX, clientY, mods) {
    const canvas = getCanvas();
    if (!canvas) return status('그림판 화면을 찾지 못했어요');
    S.busy = true;
    const t0 = performance.now();
    const prevTool = currentTool();
    const lassoTool = S.mode === 'fill' ? 'lassoBrushIcon' : 'lassoSelectionIcon';
    let prevStab = null, prevSelMode = null;
    try {
      status('영역 계산 중…');
      const oldRow = stabilizerRow();
      const switched = prevTool !== lassoTool;
      if (!(await selectTool(lassoTool))) return status('올가미 도구로 바꾸지 못했어요');
      // 오른쪽 설정 패널이 새 도구 것으로 바뀔 때까지 기다림 (안 그러면 이전 도구 설정을 건드림)
      if (switched) {
        for (let i = 0; i < 40; i++) {
          const row = stabilizerRow();
          if (row && row !== oldRow) break;
          await sleep(25);
        }
      }
      prevStab = getStabilizer();
      if (prevStab !== null && prevStab !== 0) await setStabilizer(0);
      if (S.mode === 'select') {
        prevSelMode = getSelectionMode();
        const want = mods.alt ? 'subtract' : (mods.shift ? 'add' : 'select');
        await setSelectionMode(want);
      }
      await nextFrame();
      const img = await readScreen(canvas);
      if (img.blank) return status('화면 픽셀을 읽지 못했어요 (Magma 창이 가려져 있지 않은지 확인해 주세요)');
      const rect = canvas.getBoundingClientRect();
      const bx = Math.floor((clientX - rect.left) * canvas.width / rect.width);
      const by = Math.floor((clientY - rect.top) * canvas.height / rect.height);
      if (bx < 0 || by < 0 || bx >= img.w || by >= img.h) return status('그림판 밖을 눌렀어요');
      const { mask, count } = floodFill(img, bx, by, S.tol);
      if (count >= img.w * img.h * 0.995) return status('화면 전체가 잡혀서 취소했어요 (허용 오차를 낮춰 보세요)');
      if (S.expand > 0) dilate(mask, img.w, img.h, S.expand);
      const res = buildPolygon(mask, img.w, img.h);
      if (!res) return status('영역을 만들지 못했어요');
      await drawLasso(canvas, res.poly, {});
      const ms = Math.round(performance.now() - t0);
      status(`완료: ${count.toLocaleString()}픽셀, 꼭짓점 ${res.poly.length}개, 구멍 ${res.holes}개 (${ms}ms)`);
    } catch (err) {
      console.error('[MagmaWand]', err);
      status('오류: ' + (err && err.message || err));
    } finally {
      try {
        if (prevSelMode && S.mode === 'select') await setSelectionMode(prevSelMode);
        if (prevStab !== null && prevStab !== 0) await setStabilizer(prevStab);
        if (prevTool && prevTool !== lassoTool) await selectTool(prevTool);
        // 붓 커서가 올가미 시작점에 남지 않도록 실제 마우스 위치로 되돌림
        const c = getCanvas();
        if (c) {
          const ev = new PointerEvent('pointermove', { clientX, clientY, bubbles: true, composed: true,
            view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: -1, buttons: 0 });
          ev.__magmaWand = true;
          c.dispatchEvent(ev);
        }
      } catch (e) { console.warn('[MagmaWand] 복구 실패', e); }
      S.busy = false;
    }
  }

  // ---------- 입력 가로채기 ----------
  // 마법봉이 켜져 있으면 그림판 위의 실제 클릭은 Magma에 넘기지 않고 마법봉이 처리한다.
  const BLOCK = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'];
  let pendingDown = false;
  function onInput(e) {
    if (!S.active || e.__magmaWand || !e.isTrusted) return;
    const canvas = getCanvas();
    if (!canvas || e.target !== canvas) return;
    if (e.type.startsWith('touch')) { e.stopImmediatePropagation(); return; }
    if (e.button !== 0) return; // 가운데/오른쪽 버튼(화면 이동 등)은 그대로 통과
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.type === 'pointerdown') pendingDown = true;
    if (e.type === 'pointerup' && pendingDown) {
      pendingDown = false;
      if (!S.busy) runWand(e.clientX, e.clientY, { shift: e.shiftKey, alt: e.altKey });
    }
  }
  for (const t of BLOCK) on(window, t, onInput, true);
  // 누른 채로 끄는 동안의 이동도 막는다
  on(window, 'pointermove', (e) => {
    if (S.active && pendingDown && e.isTrusted && !e.__magmaWand) e.stopImmediatePropagation();
  }, true);

  on(window, 'keydown', (e) => {
    if (e.key === 'Escape' && S.active) setActive(false);
  }, true);

  // ---------- 화면 패널 ----------
  let ui = null, css = null;
  function status(msg) {
    if (ui) ui.querySelector('.mw-status').textContent = msg;
    console.log('[MagmaWand]', msg);
  }
  function setActive(on) {
    S.active = on;
    document.documentElement.classList.toggle('mw-on', on);
    if (ui) {
      ui.querySelector('.mw-toggle').classList.toggle('on', on);
      ui.querySelector('.mw-toggle').textContent = on ? '🪄 마법봉 켜짐' : '🪄 마법봉 꺼짐';
    }
    status(on ? (S.mode === 'select' ? '클릭: 새 선택 · Shift+클릭: 추가 · Alt+클릭: 빼기 · Esc: 끄기' : '클릭한 영역을 지금 색으로 채워요 · Esc: 끄기') : '꺼짐');
  }

  function buildUI() {
    if (ui || !document.body) return;
    css = document.createElement('style');
    css.textContent = `
      html.mw-on .editor-view, html.mw-on .editor-view * { cursor: crosshair !important; }
      .mw-panel { position: fixed; z-index: 2147483000; width: 236px; background: #1e1f24; color: #e6e6e6;
        border: 1px solid #3a3c44; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.45);
        font: 12px/1.4 system-ui, 'Malgun Gothic', sans-serif; user-select: none; }
      .mw-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px;
        cursor: move; border-bottom: 1px solid #33353c; font-weight: 600; }
      .mw-head button { all: unset; cursor: pointer; padding: 0 4px; color: #aaa; }
      .mw-ver { font-weight: 400; color: #7c7e88; font-size: 10px; margin-left: 4px; }
      .mw-body { padding: 8px 10px 10px; display: grid; gap: 8px; }
      .mw-panel.min .mw-body { display: none; }
      .mw-toggle { all: unset; text-align: center; padding: 7px 0; border-radius: 7px; cursor: pointer;
        background: #2c2e35; border: 1px solid #44464f; font-weight: 600; }
      .mw-toggle.on { background: #6d4aff; border-color: #8a6dff; color: #fff; }
      .mw-row { display: grid; grid-template-columns: 70px 1fr 34px; align-items: center; gap: 6px; }
      .mw-row input[type=range] { width: 100%; accent-color: #8a6dff; }
      .mw-row output { text-align: right; color: #bbb; }
      .mw-seg { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #44464f; border-radius: 7px; overflow: hidden; }
      .mw-seg button { all: unset; text-align: center; padding: 5px 0; cursor: pointer; color: #bbb; }
      .mw-seg button.on { background: #3b3d46; color: #fff; }
      .mw-status { color: #9a9ca5; min-height: 2.8em; font-size: 11px; }
    `;
    document.head.appendChild(css);
    ui = document.createElement('div');
    ui.className = 'mw-panel';
    ui.innerHTML = `
      <div class="mw-head"><span>마법봉<span class="mw-ver">v${VERSION}</span></span><button class="mw-min" title="접기">–</button></div>
      <div class="mw-body">
        <button class="mw-toggle">🪄 마법봉 꺼짐</button>
        <div class="mw-seg"><button data-mode="select">선택</button><button data-mode="fill">바로 채우기</button></div>
        <label class="mw-row"><span>허용 오차</span><input class="mw-tol" type="range" min="0" max="100" step="1"><output class="mw-tol-v"></output></label>
        <label class="mw-row"><span>영역 확장</span><input class="mw-exp" type="range" min="0" max="6" step="1"><output class="mw-exp-v"></output></label>
        <div class="mw-status">${upgradedFrom ? `v${VERSION}으로 업데이트됐어요` : '꺼짐'}</div>
      </div>`;
    document.body.appendChild(ui);
    const place = () => {
      const x = S.px ?? Math.max(10, innerWidth - 520), y = S.py ?? 52;
      ui.style.left = Math.min(Math.max(0, x), innerWidth - 60) + 'px';
      ui.style.top = Math.min(Math.max(0, y), innerHeight - 30) + 'px';
    };
    place();
    on(window, 'resize', place);

    // 패널 안의 입력이 Magma 단축키로 새지 않도록
    for (const t of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'wheel']) {
      ui.addEventListener(t, (e) => e.stopPropagation());
    }
    ui.querySelector('.mw-toggle').addEventListener('click', () => setActive(!S.active));
    ui.querySelector('.mw-min').addEventListener('click', () => ui.classList.toggle('min'));
    const segs = [...ui.querySelectorAll('.mw-seg button')];
    const syncMode = () => segs.forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
    segs.forEach((b) => b.addEventListener('click', () => { S.mode = b.dataset.mode; syncMode(); saveSettings(); if (S.active) setActive(true); }));
    syncMode();
    const bind = (sel, key, suffix) => {
      const inp = ui.querySelector(sel), out = ui.querySelector(sel + '-v');
      inp.value = S[key]; out.textContent = S[key] + suffix;
      inp.addEventListener('input', () => { S[key] = +inp.value; out.textContent = inp.value + suffix; saveSettings(); });
    };
    bind('.mw-tol', 'tol', '%');
    bind('.mw-exp', 'expand', 'px');

    // 머리 부분을 끌어서 옮기기
    const head = ui.querySelector('.mw-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = ui.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = (ev) => { S.px = ev.clientX - ox; S.py = ev.clientY - oy; place(); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); saveSettings(); };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  }

  // 그림판 화면에서만 패널을 보이게 (Magma는 페이지 이동 없이 화면을 바꾸므로 주기적으로 확인)
  const tick = setInterval(() => {
    const inEditor = !!getCanvas();
    if (inEditor && !ui) buildUI();
    if (ui) {
      ui.style.display = inEditor ? '' : 'none';
      if (!inEditor && S.active) setActive(false);
    }
  }, 800);

  // 새 버전이 들어올 때 이 버전을 깨끗이 걷어낸다
  window.__magmaWand.destroy = () => {
    if (S.active) setActive(false);
    clearInterval(tick);
    for (const f of cleanups.splice(0)) { try { f(); } catch { /* 무시 */ } }
    ui?.remove(); css?.remove();
    ui = null; css = null;
    document.documentElement.classList.remove('mw-on');
  };

  // 개발·시험용
  window.__magmaWand.run = runWand;
  window.__magmaWand.state = S;
  window.__magmaWand.internals = { floodFill, dilate, traceContours, buildPolygon, area,
    selectTool, currentTool, getStabilizer, setStabilizer, getSelectionMode, setSelectionMode, drawLasso, readScreen };
})();
