// Magma 마법봉
// Magma 페이지 안에서 직접 실행되는 스크립트. 크롬 확장과 데스크톱 앱 실행기가 같은 파일을 쓴다.
// 동작: 화면에 보이는 그림 픽셀을 읽어 클릭한 곳과 비슷한 색으로 이어진 영역을 계산하고,
//       그 테두리를 따라 Magma 자체 올가미(선택 / 올가미 채우기)를 대신 그어 준다.
// 화면: 왼쪽 도구 막대에 마법봉 버튼, 오른쪽 도구 설정 칸에 설정 (Magma 선택 도구 설정과 함께 표시)
// 새 버전이 같은 페이지에 다시 들어오면 옛 버전을 걷어내고 그 자리를 대신한다(새로고침 없이 업데이트).
(() => {
  'use strict';
  const VERSION = '0.4.0';
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
  // action: 'select'(선택 영역 만들기) | 'fill'(바로 채우기),  ref: 'all'(모든 레이어) | 'layer'(현재 레이어)
  // keys: 마법봉 단축키 목록. 키보드 위치(e.code) 기준이라 한글 입력 상태에서도 동작. 조합은 'Ctrl+Shift+KeyW' 형식
  const DEFAULTS = { tol: 10, expand: 1, action: 'select', ref: 'all', keys: ['KeyW'] };
  const S = Object.assign({}, DEFAULTS, loadSettings(), { active: false, busy: false, switching: false });
  if (!['select', 'fill'].includes(S.action)) S.action = 'select';
  if (!['all', 'layer'].includes(S.ref)) S.ref = 'all';

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('magmaWand.settings') || '{}');
      if (s.mode && !s.action) s.action = s.mode; // 0.2 이하 설정 이어받기
      return s;
    } catch { return {}; }
  }
  function saveSettings() {
    try {
      const { tol, expand, action, ref, keys, growPx } = S;
      localStorage.setItem('magmaWand.settings', JSON.stringify({ tol, expand, action, ref, keys, growPx }));
    } catch { /* 저장 못 해도 동작에는 지장 없음 */ }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  // ---------- Magma 화면 요소 ----------
  const getCanvas = () => document.querySelector('.editor-canvas canvas');
  const toolSliders = () => document.querySelector('.tool-sliders');

  function toolButtons() { return [...document.querySelectorAll('button.tool:not(.mw-tool)')]; }
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
    await waitFor(() => currentTool() === name, 500);
    await nextFrame();
    return currentTool() === name;
  }

  // 현재 도구 설정 칸의 Magma 줄들 (마법봉이 끼워 넣은 줄은 제외)
  function magmaRows() { return [...document.querySelectorAll('.tool-sliders .tool-slider:not(.mw-el)')]; }

  // "Stabilizer"(손떨림 보정) 값
  function stabilizerRow() {
    return magmaRows().find((r) => r.querySelector('.slider-label')?.textContent.trim() === 'Stabilizer');
  }
  function getStabilizer() {
    const row = stabilizerRow();
    if (!row) return null;
    const v = parseFloat(row.querySelector('editable-number')?.textContent.trim());
    return Number.isFinite(v) ? v : null;
  }
  // 조건이 맞을 때까지 짧게 기다림 (고정 대기 대신 — 속도 개선)
  async function waitFor(fn, ms = 300) {
    const end = performance.now() + ms;
    while (!fn()) { if (performance.now() > end) return false; await sleep(8); }
    return true;
  }
  async function setStabilizer(v) {
    const row = stabilizerRow();
    const en = row?.querySelector('editable-number');
    if (!en) return false;
    if (getStabilizer() === v) return true;
    en.querySelector('button')?.click();
    await nextFrame();
    const inp = en.querySelector('input');
    if (!inp) return false;
    inp.focus();
    inp.value = String(v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.blur();
    return waitFor(() => getStabilizer() === v);
  }

  // 올가미 선택의 손떨림 보정: 연속 클릭 동안은 0으로 두고, 1.2초 쉬거나 다른 도구로 갈 때 원래 값으로.
  // 창을 닫아도 다음에 되돌릴 수 있게 원래 값을 저장해 둔다.
  const PENDING_STAB = 'magmaWand.pendingLassoStab';
  let lassoStabSaved = null, stabTimer = null, stabRestoring = null;
  try { const p = localStorage.getItem(PENDING_STAB); if (p !== null && p !== '') lassoStabSaved = +p; } catch { }
  async function lassoStabZero() {
    clearTimeout(stabTimer);
    if (stabRestoring) await stabRestoring;
    if (lassoStabSaved === null) {
      const v = getStabilizer();
      if (!v) return;
      lassoStabSaved = v;
      try { localStorage.setItem(PENDING_STAB, String(v)); } catch { }
    }
    if (getStabilizer() !== 0) await setStabilizer(0);
  }
  function restoreLassoStab() {
    if (lassoStabSaved === null || currentTool() !== 'lassoSelectionIcon') return Promise.resolve(false);
    if (stabRestoring) return stabRestoring;
    const v = lassoStabSaved;
    stabRestoring = (async () => {
      const ok = getStabilizer() === v || await setStabilizer(v);
      if (ok) { lassoStabSaved = null; try { localStorage.removeItem(PENDING_STAB); } catch { } }
      return ok;
    })().finally(() => { stabRestoring = null; });
    return stabRestoring;
  }
  function scheduleStabRestore(ms = 1200) {
    clearTimeout(stabTimer);
    if (lassoStabSaved === null) return;
    stabTimer = setTimeout(() => { if (S.busy) scheduleStabRestore(ms); else restoreLassoStab(); }, ms);
  }
  // 패널이 새 도구 것으로 바뀔 때까지 기다림 (안 그러면 이전 도구 설정을 건드림)
  async function waitPanelChange(oldRow) {
    for (let i = 0; i < 40; i++) {
      const row = stabilizerRow();
      if (row && row !== oldRow) return true;
      await sleep(25);
    }
    return false;
  }

  // 선택 모드 버튼(새 선택 / 추가 / 빼기 / 교차) — Magma 선택 도구 설정 칸에 있는 것
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
    return waitFor(() => getSelectionMode() === v);
  }

  // 올가미 채우기 도구의 "Mode: draw / erase"와 "auto erase mode"
  function brushModeButtons() {
    return [...document.querySelectorAll('.tool-sliders .tool-row-buttons button')]
      .filter((b) => /^(draw|erase)$/i.test(b.textContent.trim()));
  }
  function getBrushMode() {
    const b = brushModeButtons().find((b) => b.classList.contains('on') || b.classList.contains('active'));
    return b ? b.textContent.trim().toLowerCase() : null;
  }
  async function setBrushMode(m) {
    if (!m || getBrushMode() === m) return true;
    const b = brushModeButtons().find((b) => b.textContent.trim().toLowerCase() === m);
    if (!b) return false;
    press(b);
    return waitFor(() => getBrushMode() === m);
  }
  function autoEraseButton() {
    const row = magmaRows().find((r) => /auto erase/i.test(r.textContent));
    return row ? row.querySelector('button.tgl') : null;
  }
  function getAutoErase() {
    const b = autoEraseButton();
    return b ? b.classList.contains('on') : null;
  }
  async function setAutoErase(v) {
    const b = autoEraseButton();
    if (!b || getAutoErase() === v) return;
    press(b);
    if (!(await waitFor(() => getAutoErase() === v, 150))) { // 버튼이 아니라 줄(label)이 반응하는 경우
      const label = b.closest('label');
      if (label) { press(label); await waitFor(() => getAutoErase() === v, 300); }
    }
  }

  // ---------- 레이어 (현재 레이어만 참조할 때) ----------
  // Magma의 "개인 보이기"(내 화면에서만 숨기기)를 써서 다른 레이어를 잠깐 숨긴다. 다른 사람 화면에는 영향 없음.
  // 아이콘 순환: 기본(Inherit) → 숨김(Slash) → 보임(Personal) → 기본
  function layerRows() {
    return [...document.querySelectorAll('.layer')].filter((l) => l.querySelector('.layer-left-bottom'));
  }
  function personalState(row) {
    const c = row.querySelector('.layer-left-bottom svg')?.getAttribute('class') || '';
    if (/Slash/.test(c)) return 'hidden';
    if (/Inherit/.test(c)) return 'inherit';
    return 'shown';
  }
  async function setPersonal(index, want) {
    for (let i = 0; i < 4; i++) {
      const row = layerRows()[index];
      if (!row) return false;
      if (personalState(row) === want) return true;
      press(row.querySelector('.layer-left-bottom'));
      await sleep(50);
    }
    return false;
  }
  async function soloCurrentLayer() {
    const rows = layerRows();
    const cur = rows.findIndex((r) => r.classList.contains('on'));
    if (cur < 0) return null;
    const saved = [];
    for (let i = 0; i < rows.length; i++) {
      if (i === cur) continue;
      const st = personalState(rows[i]);
      if (st !== 'hidden') { saved.push([i, st]); await setPersonal(i, 'hidden'); }
    }
    return saved;
  }
  async function restoreLayers(saved) {
    for (const [i, st] of saved) await setPersonal(i, st);
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

  // 보드 바깥(작업 공간의 어두운 회색 배경)을 찾는다. Magma 올가미 채우기는 보드 밖에 찍힌 점을 버리므로
  // 영역을 반드시 보드 안으로 잘라야 한다.
  const OUTSIDE_RGB = 22;
  function outsideMask(img) {
    const { w, h, data } = img;
    const out = new Uint8Array(w * h);
    const isBg = (p) => {
      const i = p * 4;
      return Math.abs(data[i] - OUTSIDE_RGB) <= 3 && Math.abs(data[i + 1] - OUTSIDE_RGB) <= 3 &&
        Math.abs(data[i + 2] - OUTSIDE_RGB) <= 3;
    };
    const stack = new Int32Array(w * h);
    let sp = 0;
    const push = (p) => { if (!out[p] && isBg(p)) { out[p] = 1; stack[sp++] = p; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    return out;
  }

  // 보드 가장자리에 걸친 꼭짓점을 보드 안쪽으로 살짝 들여서 "보드 밖 점"이 되지 않게 한다
  function insetFromOutside(poly, out, w, h) {
    const isOut = (x, y) => x >= 0 && y >= 0 && x < w && y < h && out[y * w + x] === 1;
    return poly.map(([x, y]) => {
      let dx = 0, dy = 0;
      for (const [px, py] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) {
        if (isOut(px, py)) { dx += px + 0.5 - x; dy += py + 0.5 - y; }
      }
      if (!dx && !dy) return [x, y];
      const L = Math.hypot(dx, dy) || 1;
      return [x - dx / L * 0.75, y - dy / L * 0.75];
    });
  }
  // 선택용 올가미는 반드시 '선택이 있을 수 없는 곳'(보드 바깥)에서 시작한다.
  // Magma는 기존 선택 안쪽에서 시작한 끌기를 '선택 영역 이동'으로 처리하기 때문(실측).
  // 보드 바깥 시작점 → 가장 가까운 꼭짓점까지 폭 0짜리 다리 → 도형 한 바퀴 → 다리로 복귀. 다리는 선택 모양에 영향 없음.
  function offBoardStart(out, w, h, poly) {
    if (!out || !poly.length) return null;
    const [px, py] = poly[0];
    let best = null, bd = Infinity;
    for (let y = 2; y < h - 2; y += 3) {
      for (let x = 2; x < w - 2; x += 3) {
        const p = y * w + x;
        // 보드 경계에서 3픽셀 이상 떨어진 바깥 배경만
        if (!out[p] || !out[p - 3] || !out[p + 3] || !out[p - 3 * w] || !out[p + 3 * w]) continue;
        const d = (x - px) ** 2 + (y - py) ** 2;
        if (d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
      }
    }
    return best;
  }
  function withSpur(poly, start) {
    if (!start) return poly;
    let bi = 0, bd = Infinity;
    poly.forEach(([x, y], i) => { const d = (x - start[0]) ** 2 + (y - start[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
    return [start, ...poly.slice(bi), ...poly.slice(0, bi), poly[bi]];
  }

  // 올가미 시작점은 보드 가장자리에서 떨어진 꼭짓점으로
  function rotateStart(poly, out, w, h) {
    const near = ([x, y]) => {
      const cx = Math.round(x), cy = Math.round(y);
      for (let yy = cy - 3; yy <= cy + 3; yy++) {
        for (let xx = cx - 3; xx <= cx + 3; xx++) {
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && out[yy * w + xx]) return true;
        }
      }
      return false;
    };
    const i = poly.findIndex((p) => !near(p));
    return i > 0 ? poly.slice(i).concat(poly.slice(0, i)) : poly;
  }

  // ---------- 영역 계산 ----------
  // wild: 기존 선택의 점선이 그려진 화면 픽셀 — 색과 상관없이 통과시킨다 (점선이 벽이 되지 않게)
  function floodFill(img, sx, sy, tolPct, wild = null) {
    const { w, h, data } = img;
    const mask = new Uint8Array(w * h);
    const si = (sy * w + sx) * 4;
    const r0 = data[si], g0 = data[si + 1], b0 = data[si + 2];
    const t = Math.round((tolPct / 100) * 255);
    const ok = (p) => {
      const i = p * 4;
      if (wild && wild[p]) return true;
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
    return { poly: holes.length ? mergeHoles(outer, holes) : outer, holes: holes.length, outer, holeLoops: holes };
  }

  // ---------- 올가미 대신 긋기 ----------
  // Magma는 한 프레임에 너무 많은 움직임이 들어오면 일부를 버린다 → perFrame개씩 끊어서 보낸다
  // Magma는 점과 점 사이를 직선으로 잇는다 → 꼭짓점만 보내고, 아주 긴 변만 STEP 간격으로 나눈다
  let PER_FRAME = 100, STEP = 1000;
  async function drawLasso(canvas, poly, mods, perFrame = PER_FRAME, step = STEP) {
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
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
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
    document.documentElement.classList.add('mw-busy');
    const t0 = performance.now();
    const T = {};
    const mark = (k) => { T[k] = Math.round(performance.now() - t0); };
    window.__magmaWand.lastTimings = T;
    const fill = S.action === 'fill';
    let prevStab = null, prevSelMode = null, prevBrushMode = null, prevAutoErase = null, saved = null, wantMode = null;
    try {
      status('영역 계산 중…');
      // 1) 화면 읽기 — 도구는 올가미 선택(커서 원이 화면에 안 그려짐)
      if (currentTool() !== 'lassoSelectionIcon') await selectTool('lassoSelectionIcon');
      if (S.ref === 'layer') {
        saved = await soloCurrentLayer();
        if (!saved) return status('현재 레이어를 찾지 못했어요');
        await nextFrame();
        await sleep(30);
      }
      mark('ready');
      const img = await readScreen(canvas);
      mark('captured');
      if (saved) { await restoreLayers(saved); saved = null; }
      mark('layersRestored');
      if (img.blank) return status('화면을 읽지 못했어요 (Magma 창이 가려져 있지 않은지 확인해 주세요)');

      // 2) 영역 계산
      const rect = canvas.getBoundingClientRect();
      const bx = Math.floor((clientX - rect.left) * canvas.width / rect.width);
      const by = Math.floor((clientY - rect.top) * canvas.height / rect.height);
      if (bx < 0 || by < 0 || bx >= img.w || by >= img.h) return status('그림판 밖을 눌렀어요');
      const outside = outsideMask(img);
      if (outside[by * img.w + bx]) return status('보드 바깥을 눌렀어요');
      // 기존 선택이 있으면 그 점선을 실제 그림 색으로 지운 뒤 계산 (점선이 벽이 되지 않게)
      // ('현재 레이어' 참조일 때는 화면이 현재 레이어만 보여서 합쳐진 색과 다르므로 하지 않는다)
      if (S.ref === 'all' && selectionExists()) {
        const sel = await copyMergedSelection();
        T.repaired = sel.error ? -1 : repairUnderSelection(sel, canvas, img);
        mark('antsRemoved');
      }
      const { mask, count } = floodFill(img, bx, by, S.tol);
      if (S.expand > 0) dilate(mask, img.w, img.h, S.expand);
      for (let i = 0; i < mask.length; i++) if (outside[i]) mask[i] = 0;
      const res = buildPolygon(mask, img.w, img.h);
      if (!res) return status('영역을 만들지 못했어요');
      const fix = (p) => rotateStart(insetFromOutside(p, outside, img.w, img.h), outside, img.w, img.h);
      const poly = fix(res.poly);
      mark('computed'); T.vertices = poly.length;

      // 3) Magma 올가미로 긋기
      if (fill) {
        const oldRow = stabilizerRow();
        if (!(await selectTool('lassoBrushIcon'))) return status('올가미 채우기 도구로 바꾸지 못했어요');
        await waitPanelChange(oldRow);
        prevBrushMode = getBrushMode();
        await setBrushMode('draw');          // 지우기 모드로 남아 있으면 칠 대신 지워짐
        prevAutoErase = getAutoErase();
        if (prevAutoErase) await setAutoErase(false);
        // 안전 확인: '그리기' 모드이고 자동 지우기가 꺼졌는지 확인되지 않으면 절대 긋지 않는다
        if (getBrushMode() !== 'draw' || getAutoErase() === true) {
          return status('안전을 위해 멈췄어요: 올가미 채우기를 그리기 모드로 바꾸지 못했어요');
        }
        prevStab = getStabilizer();
        if (prevStab) await setStabilizer(0);
      } else {
        prevSelMode = getSelectionMode();
        wantMode = mods.alt ? 'subtract' : (mods.shift ? 'add' : null); // Shift: 추가, Alt: 빼기 (그 외엔 설정 칸의 선택 모드)
        if (wantMode) await setSelectionMode(wantMode);
        await lassoStabZero(); // 연속 클릭 동안은 꺼 둔 채로, 쉬면 되돌림
      }
      mark('toolReady');
      // 안전: 반드시 올가미 한 번으로 끝낸다. Magma는 선택을 바꿀 때마다 되돌리기 기록(최대 15칸)을 한 칸 쓰므로,
      // 여러 번 그으면 사용자의 그림 기록이 밀려난다. 구멍은 폭 0짜리 다리로 이어 한 붓에 그린다
      // (화면에 다리 점선이 보일 수 있지만 실제 선택 모양에는 영향 없음 — 선택 마스크를 직접 읽어 확인함).
      let drawPoly = poly;
      if (!fill) {
        // 기존 선택 안쪽에서 시작하면 '선택 이동'이 되므로 보드 바깥에서 시작
        let start = offBoardStart(outside, img.w, img.h, poly);
        if (!start) start = docToBuffer(canvas, -40, -40);
        drawPoly = withSpur(poly, start);
        T.offBoardStart = !!start;
      }
      await drawLasso(canvas, drawPoly, {});
      mark('drawn');
      const ms = Math.round(performance.now() - t0);
      status(`${fill ? '채움' : '선택'}: ${count.toLocaleString()}픽셀${res.holes ? `, 구멍 ${res.holes}개` : ''} (${(ms / 1000).toFixed(1)}초)`);
    } catch (err) {
      console.error('[MagmaWand]', err);
      status('오류: ' + (err && err.message || err));
    } finally {
      try {
        if (saved) await restoreLayers(saved);
        if (prevStab) await setStabilizer(prevStab);
        if (fill) {
          if (prevAutoErase) await setAutoErase(true);
          if (prevBrushMode && prevBrushMode !== 'draw') await setBrushMode(prevBrushMode);
          if (currentTool() !== 'lassoSelectionIcon') await selectTool('lassoSelectionIcon');
        } else if (wantMode && prevSelMode) {
          await setSelectionMode(prevSelMode);
        }
        // 올가미 시작점에 커서 흔적이 남지 않도록 실제 마우스 위치로 되돌림
        const c = getCanvas();
        if (c) {
          const [mx, my] = lastReal || [clientX, clientY];
          lastReal = null;
          const ev = new PointerEvent('pointermove', { clientX: mx, clientY: my, bubbles: true, composed: true,
            view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: -1, buttons: 0 });
          ev.__magmaWand = true;
          c.dispatchEvent(ev);
        }
      } catch (e) { console.warn('[MagmaWand] 복구 실패', e); }
      mark('done');
      console.log('[MagmaWand] 단계별 시간(ms)', JSON.stringify(T));
      if (!fill) scheduleStabRestore();
      S.busy = false;
      document.documentElement.classList.remove('mw-busy');
      ensureSettings();
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
  on(window, 'pointermove', (e) => {
    if (S.active && pendingDown && e.isTrusted && !e.__magmaWand) e.stopImmediatePropagation();
  }, true);

  // 마법봉이 올가미를 대신 긋는 동안에는 실제 마우스·펜·터치 입력을 Magma에 전혀 넘기지 않는다.
  // (넘기면 실제 커서 위치가 올가미 경로에 섞여 선택이 삼각형으로 잘린다 — 0.3.2까지의 버그)
  const BUSY_BLOCK = ['pointermove', 'pointerrawupdate', 'pointerdown', 'pointerup', 'pointercancel',
    'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mousemove', 'mousedown', 'mouseup',
    'mouseover', 'mouseout', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'wheel'];
  const busyGuard = (e) => {
    if (!S.busy || !e.isTrusted || e.__magmaWand) return;
    e.stopImmediatePropagation();
    if (e.cancelable && e.type !== 'wheel') e.preventDefault();
    if (e.type === 'pointermove' || e.type === 'mousemove') lastReal = [e.clientX, e.clientY];
  };
  let lastReal = null;
  for (const t of BUSY_BLOCK) {
    on(window, t, busyGuard, { capture: true, passive: false });
    on(document, t, busyGuard, { capture: true, passive: false });
  }

  // 다른 도구 버튼을 누르면 마법봉 끄기 (Magma가 그 도구로 바꾼다)
  // 손떨림 보정을 아직 되돌리지 못했으면, 먼저 되돌린 뒤(올가미 설정 칸이 보일 때만 가능) 그 도구로 바꿔 준다
  let switchingTo = null;
  const toolSwitchGuard = (e) => {
    if (!e.isTrusted) return;
    const b = e.target && e.target.closest && e.target.closest('button.tool');
    if (!b || b.classList.contains('mw-tool')) return;
    if (switchingTo) { e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (!S.active) return;
    if (lassoStabSaved !== null && currentTool() === 'lassoSelectionIcon' && e.type === 'pointerdown') {
      e.stopImmediatePropagation(); e.preventDefault();
      switchingTo = b;
      (async () => {
        try {
          clearTimeout(stabTimer);
          while (S.busy) await sleep(30);
          await restoreLassoStab();
          await setActive(false);
          press(b);
        } finally { setTimeout(() => { switchingTo = null; }, 50); }
      })();
      return;
    }
    if (e.type === 'pointerdown') setActive(false);
  };
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) on(window, t, toolSwitchGuard, true);

  // ---------- 단축키 (기본 W, Edit → Application settings → Shortcuts → Tools 에서 변경) ----------
  if (!Array.isArray(S.keys)) S.keys = DEFAULTS.keys.slice();
  const MOD_CODES = /^(Control|Shift|Alt|Meta)(Left|Right)$|^(CapsLock|Fn)$/;
  function comboOf(e) {
    if (!e.code || MOD_CODES.test(e.code)) return null;
    const m = [];
    if (e.ctrlKey || e.metaKey) m.push('Ctrl');
    if (e.shiftKey) m.push('Shift');
    if (e.altKey) m.push('Alt');
    return [...m, e.code].join('+');
  }
  const keyLabel = (code) => code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')
    .replace(/^Arrow/, '').replace(/^Bracket(Left|Right)$/, (_, s) => (s === 'Left' ? '[' : ']'));
  const comboParts = (c) => c.split('+').map((p, i, a) => (i === a.length - 1 ? keyLabel(p) : p));
  const comboText = (c) => comboParts(c).join('+');
  function syncTooltip() { if (toolBtn) toolBtn.title = '마법봉' + (S.keys.length ? ` (${S.keys.map(comboText).join(', ')})` : ''); }

  on(window, 'keydown', (e) => {
    if (capturingKey || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!getCanvas() || document.querySelector('.modal-dialog')) return;
    const c = comboOf(e);
    if (!c || !S.keys.includes(c)) return;
    // 사용자가 고른 키이므로 Magma의 같은 키 동작보다 마법봉을 우선한다
    e.preventDefault(); e.stopImmediatePropagation();
    setActive(true);
  }, true);

  // 설정 창의 단축키 표(Tools)에 '마법봉' 줄을 Magma 줄과 같은 모양으로 넣는다.
  // 바꾼 내용은 설정 창의 Save를 눌러야 저장되고, Cancel·닫기면 버려진다 (Magma와 같은 방식)
  let scRow = null, staged = null, capturingKey = false, hookedModal = null;
  function ensureShortcutRow() {
    const modal = [...document.querySelectorAll('.modal-dialog')].find((m) => /Application settings/.test(m.textContent));
    if (!modal) { scRow = null; staged = null; capturingKey = false; hookedModal = null; return; }
    if (staged === null) staged = S.keys.slice();
    if (hookedModal !== modal) {
      hookedModal = modal;
      modal.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('button');
        if (b && b.textContent.trim() === 'Save' && staged) { S.keys = staged.slice(); saveSettings(); syncTooltip(); }
      }, true);
    }
    const lassoTd = [...modal.querySelectorAll('td')].find((td) => td.textContent.trim() === 'Lasso Selection');
    if (!lassoTd) return;
    const tr = lassoTd.parentElement;
    if (scRow && scRow.isConnected) { if (tr.nextElementSibling !== scRow) tr.after(scRow); return; }
    scRow = buildShortcutRow(tr);
    if (scRow) tr.after(scRow);
  }
  function buildShortcutRow(tpl) {
    const row = tpl.cloneNode(true);
    row.classList.add('mw-shortcut', 'mw-el');
    row.children[0].textContent = '마법봉 (Magic Wand)';
    const box = row.children[1].querySelector('.d-flex.flex-wrap') || row.children[1];
    const chipTpl = tpl.querySelector('kbd-short')?.closest('.d-flex.align-items-center') ||
      [...document.querySelectorAll('.modal-dialog kbd-short')].map((k) => k.closest('.d-flex.align-items-center')).find(Boolean);
    const plusTpl = tpl.querySelector('button.shortcut-item');
    if (!chipTpl || !plusTpl) return null;
    const kbdTpl = chipTpl.querySelector('kbd');
    const xSvg = chipTpl.querySelector('button svg');
    const ng = [...plusTpl.attributes].map((a) => a.name).filter((n) => n.startsWith('_ngcontent'));
    const render = () => {
      box.innerHTML = '';
      for (const c of staged) {
        const chip = chipTpl.cloneNode(true);
        const ks = chip.querySelector('kbd-short');
        ks.innerHTML = '';
        comboParts(c).forEach((p, i) => {
          if (i) ks.append(' + ');
          const k = kbdTpl.cloneNode(false); k.textContent = p; ks.append(k);
        });
        chip.querySelector('button').addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          staged = staged.filter((x) => x !== c); render();
        });
        box.append(chip);
      }
      if (capturingKey) {
        const hint = document.createElement('i');
        hint.className = 'text-success';
        ng.forEach((n) => hint.setAttribute(n, ''));
        hint.textContent = '아무 키 조합이나 누르세요';
        const cancel = plusTpl.cloneNode(true);
        if (xSvg) cancel.querySelector('svg')?.replaceWith(xSvg.cloneNode(true));
        cancel.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); capturingKey = false; render(); });
        box.append(hint, cancel);
      } else {
        const plus = plusTpl.cloneNode(true);
        plus.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); capturingKey = true; render(); });
        box.append(plus);
      }
    };
    row.__mwRender = render;
    render();
    return row;
  }
  // 키 입력 받기 (설정 창에서 + 를 누른 뒤)
  on(window, 'keydown', (e) => {
    if (!capturingKey) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code === 'Escape') { capturingKey = false; scRow?.__mwRender?.(); return; }
    const c = comboOf(e);
    if (!c) return; // Shift 등만 누른 상태
    if (!staged.includes(c)) staged.push(c);
    capturingKey = false;
    scRow?.__mwRender?.();
  }, true);
  const modalObserver = new MutationObserver(() => {
    if (modalObserver.pending) return;
    modalObserver.pending = true;
    requestAnimationFrame(() => { modalObserver.pending = false; ensureShortcutRow(); ensureMenuItems(); });
  });
  modalObserver.observe(document.body, { childList: true, subtree: true });
  cleanups.push(() => modalObserver.disconnect());

  // ---------- 선택 범위 확장/축소 (Edit 메뉴 → Invert selection 아래) ----------
  // 1) Magma의 "Copy merged"(Ctrl+Shift+C) 결과를 클립보드에 쓰기 직전에 가로채서 정확한 선택 모양(보드 해상도,
  //    가장자리 투명도 포함)과 보드 위치를 얻는다. 사용자 클립보드는 건드리지 않는다.
  // 2) 거리 변환으로 N픽셀 넓히거나 좁힌다.
  // 3) 주소의 #v… (화면 중심·배율·회전)로 보드 좌표 → 화면 좌표를 계산하고, 실제 화면 색과 맞는지 확인한 뒤에만
  //    올가미 한 번으로 새 선택을 만든다(되돌리기 기록 한 칸).
  function viewTransform() {
    const h = location.hash.replace(/^#/, '');
    if (!/^v[A-Za-z0-9_-]{16,}$/.test(h)) return null;
    let s = h.slice(1).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    let bytes;
    try { bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { return null; }
    if (bytes.length < 16) return null;
    const dv = new DataView(bytes.buffer);
    return { cx: dv.getFloat32(0, false), cy: dv.getFloat32(4, false), zoom: dv.getFloat32(8, false),
      rot: dv.getFloat32(12, false), flags: bytes.length > 16 ? bytes[16] : 0 };
  }

  function selectionExists() {
    const d = document.querySelector('.selection-tool button[command=deselect]');
    return !!(d && !d.disabled && !d.classList.contains('disabled'));
  }
  // 기존 선택의 점선 지우기: Copy merged에 담긴 '선택 안쪽의 실제 그림 색'으로 화면 캡처를 덮어쓴다.
  // (점선을 '통과 가능'으로 두면 점선과 겹친 검은 선화까지 통과해 선 너머로 새므로, 실제 색으로 복원하는 방식)
  function repairUnderSelection(sel, canvas, img) {
    const vt = viewTransform();
    if (!vt || !(vt.zoom > 0) || Math.abs(vt.rot) > 1e-6 || vt.flags) return 0;
    const rect = canvas.getBoundingClientRect();
    const kx = canvas.width / rect.width, ky = canvas.height / rect.height;
    const s = vt.zoom * kx; // 보드 1픽셀 = 화면 버퍼 s픽셀
    const ox = rect.width / 2 * kx - vt.cx * s, oy = rect.height / 2 * ky - vt.cy * s;
    let n = 0;
    // 화면 픽셀마다 그 중심이 가리키는 보드 픽셀이 선택 안쪽(완전 불투명)이면 그 색으로
    const x0 = Math.max(0, Math.floor(ox + sel.x * s)), x1 = Math.min(img.w, Math.ceil(ox + (sel.x + sel.w) * s));
    const y0 = Math.max(0, Math.floor(oy + sel.y * s)), y1 = Math.min(img.h, Math.ceil(oy + (sel.y + sel.h) * s));
    for (let by = y0; by < y1; by++) {
      const dy = Math.floor((by + 0.5 - oy) / s) - sel.y;
      if (dy < 0 || dy >= sel.h) continue;
      for (let bx = x0; bx < x1; bx++) {
        const dx = Math.floor((bx + 0.5 - ox) / s) - sel.x;
        if (dx < 0 || dx >= sel.w) continue;
        const q = (dy * sel.w + dx) * 4;
        if (sel.rgba[q + 3] < 250) continue;
        const p = (by * img.w + bx) * 4;
        img.data[p] = sel.rgba[q]; img.data[p + 1] = sel.rgba[q + 1]; img.data[p + 2] = sel.rgba[q + 2];
        n++;
      }
    }
    return n;
  }

  // 보드 좌표 → 캔버스 버퍼 좌표 (회전·뒤집기 없을 때만; 아니면 null)
  function docToBuffer(canvas, dx, dy) {
    const vt = viewTransform();
    if (!vt || !(vt.zoom > 0) || Math.abs(vt.rot) > 1e-6 || vt.flags) return null;
    const rect = canvas.getBoundingClientRect();
    const cxp = rect.left + rect.width / 2 + (dx - vt.cx) * vt.zoom, cyp = rect.top + rect.height / 2 + (dy - vt.cy) * vt.zoom;
    return [(cxp - rect.left) * canvas.width / rect.width, (cyp - rect.top) * canvas.height / rect.height];
  }

  async function copyMergedSelection() {
    const cb = navigator.clipboard;
    if (!cb) return { error: '클립보드 기능을 쓸 수 없어요' };
    let got = null;
    const hadOwn = Object.prototype.hasOwnProperty.call(cb, 'write');
    const prevOwn = cb.write;
    cb.write = async (items) => {
      try {
        for (const it of items) {
          if (!it.types.includes('image/png')) continue;
          got = { png: await it.getType('image/png'),
            meta: it.types.includes('web application/x-magma-clip')
              ? await (await it.getType('web application/x-magma-clip')).text() : null };
        }
      } catch (e) { got = { error: String(e) }; }
    };
    try {
      const o = { key: 'C', code: 'KeyC', keyCode: 67, which: 67, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true };
      document.dispatchEvent(new KeyboardEvent('keydown', o));
      document.dispatchEvent(new KeyboardEvent('keyup', o));
      await waitFor(() => got, 5000);
    } finally {
      if (hadOwn) cb.write = prevOwn; else delete cb.write;
    }
    if (!got) return { error: 'Magma의 Copy merged(Ctrl+Shift+C)가 응답하지 않았어요' };
    if (got.error || !got.png) return { error: '선택 모양을 읽지 못했어요' };
    // 보드 위치: x-magma-clip 안의 메타데이터(base64 JSON)의 source.region
    let region = null;
    try {
      const m = /magmameta[^A-Za-z0-9+\/]*([A-Za-z0-9+\/=]+)/.exec(got.meta || '');
      const j = JSON.parse(atob(m[1]));
      region = j.source && j.source.region;
    } catch { region = null; }
    const bmp = await createImageBitmap(got.png);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const rgba = g.getImageData(0, 0, cv.width, cv.height).data;
    if (!region || region.w !== cv.width || region.h !== cv.height) return { error: '선택 위치 정보를 읽지 못했어요' };
    return { x: region.x, y: region.y, w: cv.width, h: cv.height, rgba };
  }

  // 정확한 유클리드 거리 변환 (Felzenszwalb) — feature[p]=1 인 픽셀까지의 거리의 제곱
  function edtSq(feature, w, h) {
    const INF = 1e20, n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const out = new Float64Array(w * h);
    const pass = (len) => {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s;
        do { const r = v[k]; s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r); } while (s <= z[k] && --k >= 0);
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + f[r]; }
    };
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = feature[y * w + x] ? 0 : INF;
      pass(h);
      for (let y = 0; y < h; y++) out[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = out[y * w + x];
      pass(w);
      for (let x = 0; x < w; x++) out[y * w + x] = d[x];
    }
    return out;
  }
  function growShrinkMask(sel, n) {
    const P = Math.max(0, n) + 2;
    const W = sel.w + 2 * P, H = sel.h + 2 * P;
    const m = new Uint8Array(W * H);
    for (let y = 0; y < sel.h; y++) for (let x = 0; x < sel.w; x++) if (sel.rgba[(y * sel.w + x) * 4 + 3] >= 128) m[(y + P) * W + x + P] = 1;
    const out = new Uint8Array(W * H);
    if (n >= 0) {
      const d2 = edtSq(m, W, H), r2 = n * n;
      for (let i = 0; i < out.length; i++) out[i] = d2[i] <= r2 ? 1 : 0;
    } else {
      const inv = new Uint8Array(W * H);
      for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
      const d2 = edtSq(inv, W, H), r2 = n * n;
      for (let i = 0; i < out.length; i++) out[i] = m[i] && d2[i] > r2 ? 1 : 0;
    }
    return { mask: out, W, H, ox: sel.x - P, oy: sel.y - P };
  }
  // 모든 테두리(여러 덩어리 + 구멍)를 폭 0짜리 다리로 이어 한 붓 도형으로 (올가미 한 번 = 되돌리기 한 칸)
  function maskToSinglePolygon(mask, W, H) {
    let loops = traceContours(mask, W, H).filter((l) => l.length >= 3)
      .map((l) => ({ l, a: Math.abs(area(l)) })).filter((x) => x.a >= 2);
    if (!loops.length) return null;
    loops.sort((a, b) => b.a - a.a);
    loops = loops.slice(0, 400).map((x) => simplify(x.l, 0.5));
    return loops.length > 1 ? mergeHoles(loops[0], loops.slice(1)) : loops[0];
  }

  // 화면 좌표 변환이 맞는지 실제 화면 색과 비교해 확인 (틀리면 아무것도 하지 않는다)
  function verifyTransform(sel, toClient, img, canvas) {
    const rect = canvas.getBoundingClientRect();
    const kx = canvas.width / rect.width, ky = canvas.height / rect.height;
    let tried = 0, ok = 0;
    for (let i = 0; i < 4000 && tried < 300; i++) {
      const x = Math.floor(Math.random() * sel.w), y = Math.floor(Math.random() * sel.h);
      const p = (y * sel.w + x) * 4;
      if (sel.rgba[p + 3] !== 255) continue;
      // 가장자리에서 떨어진 안쪽 픽셀만 (선택 점선과 겹치지 않게)
      let inner = true;
      for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= sel.w || yy >= sel.h || sel.rgba[(yy * sel.w + xx) * 4 + 3] !== 255) { inner = false; break; }
      }
      if (!inner) continue;
      const [cxp, cyp] = toClient(sel.x + x + 0.5, sel.y + y + 0.5);
      const bx = Math.floor((cxp - rect.left) * kx), by = Math.floor((cyp - rect.top) * ky);
      if (bx < 0 || by < 0 || bx >= img.w || by >= img.h) continue;
      const q = (by * img.w + bx) * 4;
      tried++;
      if (Math.abs(img.data[q] - sel.rgba[p]) <= 24 && Math.abs(img.data[q + 1] - sel.rgba[p + 1]) <= 24 &&
          Math.abs(img.data[q + 2] - sel.rgba[p + 2]) <= 24) ok++;
    }
    return { tried, ok, pass: tried >= 20 && ok / tried >= 0.8 };
  }

  async function growShrinkSelection(n) {
    if (S.busy) return;
    const canvas = getCanvas();
    if (!canvas) return;
    S.busy = true;
    document.documentElement.classList.add('mw-busy');
    const prevTool = currentTool();
    let prevSelMode = null, changedMode = false;
    const label = n >= 0 ? `선택 범위 ${n}px 확장` : `선택 범위 ${-n}px 축소`;
    try {
      toast(`${label} 중…`);
      const vt = viewTransform();
      if (!vt || !(vt.zoom > 0)) return toast('화면 위치 정보를 읽지 못해 멈췄어요');
      if (Math.abs(vt.rot) > 1e-6 || vt.flags) return toast('화면을 회전하거나 뒤집은 상태에서는 아직 쓸 수 없어요');
      const sel = await copyMergedSelection();
      if (sel.error) return toast(sel.error);
      const rect = canvas.getBoundingClientRect();
      const ccx = rect.left + rect.width / 2, ccy = rect.top + rect.height / 2;
      const toClient = (dx, dy) => [ccx + (dx - vt.cx) * vt.zoom, ccy + (dy - vt.cy) * vt.zoom];
      // 안전 확인: 계산한 위치의 화면 색이 선택 안의 실제 색과 맞는지
      if (currentTool() !== 'lassoSelectionIcon') await selectTool('lassoSelectionIcon');
      const img = await readScreen(canvas);
      if (img.blank) return toast('화면을 읽지 못했어요');
      const vr = verifyTransform(sel, toClient, img, canvas);
      if (!vr.pass) return toast(vr.tried < 20 ? '선택 영역이 화면에 충분히 보이도록 한 뒤 다시 해 주세요' : '화면 위치 계산이 맞지 않아 안전을 위해 멈췄어요');
      const gs = growShrinkMask(sel, n);
      const poly = maskToSinglePolygon(gs.mask, gs.W, gs.H);
      prevSelMode = getSelectionMode();
      await lassoStabZero();
      if (!poly) {
        // 축소해서 남는 게 없으면 선택 해제
        const des = document.querySelector('button[command=deselect]');
        if (des && !des.disabled) press(des);
        return toast(`${label}: 남는 영역이 없어서 선택을 해제했어요`);
      }
      if (prevSelMode !== 'select') { changedMode = true; await setSelectionMode('select'); }
      if (getSelectionMode() !== 'select') return toast('선택 모드를 바꾸지 못해 멈췄어요');
      const kx = canvas.width / rect.width, ky = canvas.height / rect.height;
      const pts = poly.map(([x, y]) => { const [c1, c2] = toClient(x + gs.ox, y + gs.oy); return [(c1 - rect.left) * kx, (c2 - rect.top) * ky]; });
      // 기존 선택 안쪽에서 시작하면 '선택 이동'이 되므로 보드 바깥(보드 좌표 -40,-40)에서 시작
      const start = offBoardStart(outsideMask(img), img.w, img.h, pts) || docToBuffer(canvas, -40, -40);
      if (!start) return toast('시작점을 정하지 못해 멈췄어요');
      await drawLasso(canvas, withSpur(pts, start), {});
      toast(`${label} 완료`);
    } catch (e) {
      console.error('[MagmaWand]', e);
      toast('오류: ' + (e && e.message || e));
    } finally {
      try {
        if (changedMode && prevSelMode) await setSelectionMode(prevSelMode);
        if (prevTool && prevTool !== currentTool() && !S.active) {
          await restoreLassoStab();        // 올가미 설정 칸이 보일 때 손떨림 보정 먼저 되돌리고
          await selectTool(prevTool);       // 원래 쓰던 도구로
        }
      } catch { }
      scheduleStabRestore();
      S.busy = false;
      document.documentElement.classList.remove('mw-busy');
      ensureSettings();
    }
  }

  // 화면 아래쪽에 잠깐 뜨는 안내 (마법봉 설정 칸이 안 보일 때도 결과를 알 수 있게)
  let toastEl = null, toastTimer = null;
  function toast(msg) {
    status(msg);
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement('div');
      toastEl.className = 'mw-toast mw-el';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2600);
  }

  // 확장/축소 입력 창 (Magma 설정 창과 같은 버튼 모양)
  function openGrowDialog(grow) {
    document.querySelector('.mw-dialog-wrap')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'mw-dialog-wrap mw-el';
    const last = Number.isFinite(S.growPx) ? S.growPx : 2;
    wrap.innerHTML = `
      <div class="mw-dialog" role="dialog">
        <div class="mw-dialog-title">${grow ? '선택 범위 확장' : '선택 범위 축소'}</div>
        <label class="mw-dialog-row"><span>${grow ? '넓힐' : '좁힐'} 픽셀 수</span>
          <input class="mw-dialog-input" type="number" min="1" max="200" step="1" value="${last}"></label>
        <div class="mw-dialog-btns"><button type="button" class="md btn secondary mw-cancel">Cancel</button>
          <button type="button" class="ml-2 md btn primary mw-ok">OK</button></div>
      </div>`;
    document.body.appendChild(wrap);
    const inp = wrap.querySelector('input');
    const close = () => wrap.remove();
    const ok = () => {
      const v = Math.round(+inp.value);
      if (!(v >= 1 && v <= 200)) { inp.focus(); return; }
      S.growPx = v; saveSettings(); close();
      growShrinkSelection(grow ? v : -v);
    };
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') ok();
      if (e.key === 'Escape') close();
    });
    wrap.querySelector('.mw-cancel').addEventListener('click', close);
    wrap.querySelector('.mw-ok').addEventListener('click', ok);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  }

  // Edit 메뉴에 항목 끼워 넣기 (Invert selection 바로 아래)
  const GROW_SVG = '<path fill="currentColor" d="M64 64h96v32H96v64H64zM352 64h96v96h-32V96h-64zM64 352h32v64h64v32H64zM416 352h32v96h-96v-32h64z"/>' +
    '<path fill="currentColor" d="M240 160h32v80h80v32h-80v80h-32v-80h-80v-32h80z"/>';
  const SHRINK_SVG = '<path fill="currentColor" d="M64 64h96v32H96v64H64zM352 64h96v96h-32V96h-64zM64 352h32v64h64v32H64zM416 352h32v96h-96v-32h64z"/>' +
    '<path fill="currentColor" d="M160 240h192v32H160z"/>';
  function ensureMenuItems() {
    for (const menu of document.querySelectorAll('.dropdown-menu')) {
      const items = [...menu.querySelectorAll('command-menu-item')];
      const inv = items.find((it) => /Invert selection/.test(it.textContent));
      if (!inv || menu.querySelector('.mw-menu')) continue;
      const invBtn = inv.querySelector('button');
      const disabled = !!(invBtn && (invBtn.disabled || invBtn.classList.contains('disabled')));
      const make = (text, svg, grow) => {
        const it = inv.cloneNode(true);
        it.classList.add('mw-menu', 'mw-el');
        it.querySelector('kbd')?.remove();
        const s = it.querySelector('svg');
        if (s) { s.setAttribute('class', 'svg-icon fa-fw icon-mwGrow'); s.setAttribute('viewBox', '0 0 512 512'); s.innerHTML = svg; }
        const walker = document.createTreeWalker(it, NodeFilter.SHOW_TEXT);
        let tn;
        while ((tn = walker.nextNode())) { if (/Invert selection/.test(tn.nodeValue)) tn.nodeValue = tn.nodeValue.replace(/Invert selection/, text); }
        const b = it.querySelector('button');
        if (b) {
          b.removeAttribute('commandclick');
          if (disabled) { b.disabled = true; b.classList.add('disabled'); }
          b.addEventListener('click', (e) => {
            e.preventDefault(); e.stopImmediatePropagation();
            if (b.disabled) return;
            // 메뉴 닫기 (Magma 메뉴는 바깥을 누르면 닫힌다)
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            menu.classList.remove('show');
            document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            openGrowDialog(grow);
          }, true);
        }
        return it;
      };
      const a = make('선택 범위 확장…', GROW_SVG, true);
      const b = make('선택 범위 축소…', SHRINK_SVG, false);
      inv.after(a, b);
    }
  }

  // ---------- 화면: 도구 막대 버튼 + 오른쪽 설정 칸 ----------
  const WAND_SVG = '<path fill="currentColor" d="M40 420 300 160l52 52L92 472z"/>' +
    '<path fill="currentColor" d="M400 20l28 64 64 28-64 28-28 64-28-64-64-28 64-28z"/>' +
    '<path fill="currentColor" d="M210 40l13 30 30 13-30 13-13 30-13-30-30-13 30-13zM470 250l10 23 23 10-23 10-10 23-10-23-23-10 23-10z"/>';
  const CSS = `
    html.mw-on editor-tools button.tool.on:not(.mw-tool) { background: transparent !important; border-color: transparent !important; }
    html.mw-on .editor-view, html.mw-on .editor-view * { cursor: crosshair !important; }
    .mw-hide, html.mw-on .tool-sliders > :not(.mw-el):not(.selection-tool) {
      height: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important;
      overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; }
    .mw-el { animation: mwSlide .22s ease-out; }
    @keyframes mwSlide { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    .mw-seg btn-group button { width: auto !important; min-width: 0 !important; padding: 0 9px !important; white-space: nowrap; }
    .mw-seg { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .mw-status { font-size: 11px; line-height: 1.35; color: #9a9ca5; margin: 2px 0 8px; min-height: 1.35em; }
    .mw-rows { margin-bottom: 4px; }
    .mw-toast { position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%); z-index: 2147483000;
      background: #2b2c31; color: #eee; border: 1px solid #44464f; border-radius: 8px; padding: 8px 14px;
      font: 13px/1.4 system-ui, 'Malgun Gothic', sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.4);
      transition: opacity .3s; pointer-events: none; }
    .mw-dialog-wrap { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.45);
      display: flex; align-items: flex-start; justify-content: center; padding-top: 18vh; }
    .mw-dialog { background: #232323; color: #f4f4f4; border-radius: 6px; padding: 18px 20px 16px; width: 320px;
      box-shadow: 0 10px 40px rgba(0,0,0,.5); font: 14px/1.4 system-ui, 'Malgun Gothic', sans-serif; }
    .mw-dialog-title { font-size: 18px; font-weight: 600; margin-bottom: 14px; }
    .mw-dialog-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
    .mw-dialog-input { width: 90px; background: #151515; color: #f4f4f4; border: 1px solid #555; border-radius: 4px; padding: 5px 8px; font: inherit; }
    .mw-dialog-btns { display: flex; justify-content: flex-end; }
    .mw-slider .slider { cursor: pointer; }
    .mw-slider editable-number button { cursor: text; }
  `;
  let styleEl = null, toolBtn = null, titleEl = null, rowsEl = null, statusEl = null;
  let lastStatus = '';

  function status(msg) {
    lastStatus = msg;
    if (statusEl) statusEl.textContent = msg;
    console.log('[MagmaWand]', msg);
  }
  const hint = () => S.action === 'fill'
    ? '클릭한 영역을 지금 색으로 채워요'
    : '클릭: 선택 · Shift: 추가 · Alt: 빼기';

  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return;
    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
  }

  function ensureToolButton() {
    const ref = toolButtons().find((b) => toolName(b) === 'lassoSelectionIcon');
    if (!ref) return;
    if (!toolBtn) {
      toolBtn = ref.cloneNode(true);
      toolBtn.removeAttribute('id');
      toolBtn.classList.add('mw-tool');
      toolBtn.title = '마법봉';
      const svg = toolBtn.querySelector('svg');
      svg.setAttribute('class', 'svg-icon fa-fw icon-mwWand');
      svg.setAttribute('viewBox', '0 0 512 512');
      svg.innerHTML = WAND_SVG;
      toolBtn.addEventListener('click', (e) => { e.preventDefault(); setActive(true); });
      syncTooltip();
    }
    if (toolBtn.previousElementSibling !== ref) ref.after(toolBtn);
    syncToolButton();
  }
  function syncToolButton() {
    if (!toolBtn) return;
    toolBtn.classList.toggle('on', S.active);
    toolBtn.classList.toggle('active', S.active);
    toolBtn.classList.toggle('off', !S.active);
  }

  // 선택 도구 설정 칸의 Magma 요소를 본떠(복제해) 같은 모양의 줄을 만든다
  function buildSettings(sel) {
    const tplName = sel.querySelector(':scope > .tool-name');
    const tplSeg = sel.querySelector('.selection-buttons-2');
    const tplSlider = [...sel.querySelectorAll('.tool-slider')].find((r) => r.querySelector('.slider-label'));
    if (!tplName || !tplSeg || !tplSlider) return false;

    titleEl = tplName.cloneNode(true);
    titleEl.classList.add('mw-el', 'mw-title');
    titleEl.classList.remove('mw-hide');
    titleEl.textContent = '마법봉';

    rowsEl = document.createElement('div');
    rowsEl.className = 'mw-el mw-rows';
    for (const a of tplSeg.getAttributeNames()) if (a.startsWith('_ngcontent')) rowsEl.setAttribute(a, '');

    const segRow = (label, key, opts) => {
      const row = tplSeg.cloneNode(false);
      row.classList.add('mw-seg');
      const lab = tplSeg.querySelector('label').cloneNode(false);
      lab.textContent = label;
      const group = tplSeg.querySelector('btn-group').cloneNode(false);
      const tplBtn = tplSeg.querySelector('btn-group button');
      const btns = opts.map(([v, text]) => {
        const b = tplBtn.cloneNode(false);
        b.removeAttribute('radiovalue');
        b.removeAttribute('tooltip');
        b.classList.remove('square', 'active', 'on', 'off');
        b.textContent = text;
        b.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          S[key] = v; saveSettings(); sync(); status(hint());
        });
        group.appendChild(b);
        return [v, b];
      });
      const sync = () => btns.forEach(([v, b]) => {
        const onNow = S[key] === v;
        b.classList.toggle('on', onNow); b.classList.toggle('active', onNow); b.classList.toggle('off', !onNow);
      });
      sync();
      row.append(lab, group);
      return row;
    };

    const sliderRow = (label, key, min, max) => {
      const row = tplSlider.cloneNode(true);
      row.classList.add('mw-el', 'mw-slider');
      row.classList.remove('mw-hide');
      row.querySelector('.slider-label').textContent = label;
      const slider = row.querySelector('.slider');
      const thumb = row.querySelector('.slider-thumb');
      const numBtn = row.querySelector('editable-number button');
      const inp = row.querySelector('editable-number input');
      if (inp) inp.style.display = 'none';
      const clamp = (v) => Math.min(max, Math.max(min, Math.round(v)));
      const render = () => {
        if (thumb) { thumb.style.width = ((S[key] - min) / (max - min) * 100) + '%'; thumb.style.left = '0%'; }
        if (numBtn) numBtn.textContent = String(S[key]);
      };
      const setV = (v) => { S[key] = clamp(v); render(); saveSettings(); };
      const fromX = (x) => { const r = slider.getBoundingClientRect(); setV(min + (x - r.left) / r.width * (max - min)); };
      slider.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        try { slider.setPointerCapture(e.pointerId); } catch { }
        fromX(e.clientX);
        const mv = (ev) => fromX(ev.clientX);
        const up = () => { slider.removeEventListener('pointermove', mv); slider.removeEventListener('pointerup', up); };
        slider.addEventListener('pointermove', mv);
        slider.addEventListener('pointerup', up);
      });
      row.addEventListener('wheel', (e) => { e.preventDefault(); setV(S[key] + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
      // 숫자를 누르면 직접 입력
      if (numBtn && inp) {
        numBtn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          numBtn.style.display = 'none'; inp.style.display = 'block';
          inp.value = String(S[key]); inp.focus(); inp.select();
        });
        const finish = () => {
          const v = parseFloat(inp.value);
          if (Number.isFinite(v)) setV(v);
          inp.style.display = 'none'; numBtn.style.display = '';
        };
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); });
        inp.addEventListener('blur', finish);
      }
      render();
      return row;
    };

    statusEl = document.createElement('div');
    statusEl.className = 'mw-status';
    statusEl.textContent = lastStatus || hint();
    rowsEl.append(
      segRow('동작', 'action', [['select', '선택'], ['fill', '채우기']]),
      segRow('참조', 'ref', [['all', '모든 레이어'], ['layer', '현재 레이어']]),
      sliderRow('허용 오차', 'tol', 0, 100),
      sliderRow('영역 확장', 'expand', 0, 10),
      statusEl,
    );
    // 설정 칸 안의 키 입력·휠이 Magma 단축키로 새지 않도록
    for (const t of ['keydown', 'keyup']) rowsEl.addEventListener(t, (e) => e.stopPropagation());
    return true;
  }

  function ensureSettings() {
    if (!S.active) return;
    const ts = toolSliders();
    if (!ts) return;
    const sel = ts.querySelector(':scope > .selection-tool');
    if (!rowsEl && (!sel || !buildSettings(sel))) return;
    if (sel) {
      // Magma 선택 도구의 제목·손떨림 보정·채팅 보내기 줄은 숨긴다 (마법봉에는 필요 없음)
      sel.querySelector(':scope > .tool-name')?.classList.add('mw-hide');
      for (const r of sel.querySelectorAll(':scope > *')) {
        if (r.classList.contains('mw-el')) continue;
        const label = r.querySelector('.slider-label')?.textContent.trim();
        if (label === 'Stabilizer' || /Send to chat|Set as My Avatar/i.test(r.textContent)) r.classList.add('mw-hide');
      }
    }
    if (ts.firstElementChild !== titleEl) ts.prepend(titleEl);
    // 순서: 마법봉 제목 → 전체 선택/해제 → 선택 모드 → (마법봉 설정) → 삭제/반전/복제
    const anchor = sel && sel.querySelector(':scope > .selection-buttons-2');
    if (anchor) { if (anchor.nextElementSibling !== rowsEl) anchor.after(rowsEl); }
    else if (rowsEl.parentElement !== ts) ts.append(rowsEl);  // 채우기 도중(선택 도구 칸이 잠깐 사라짐)
  }
  function removeSettings() {
    titleEl?.remove(); rowsEl?.remove();
    titleEl = null; rowsEl = null; statusEl = null;
    document.querySelectorAll('.mw-hide').forEach((e) => e.classList.remove('mw-hide'));
  }

  async function setActive(onNow) {
    if (onNow === S.active) { if (onNow) ensureSettings(); return; }
    S.active = onNow;
    document.documentElement.classList.toggle('mw-on', onNow);
    syncToolButton();
    if (onNow) {
      S.switching = true;
      try { await selectTool('lassoSelectionIcon'); } finally { S.switching = false; }
      lastStatus = upgradedFrom && !lastStatus ? `v${VERSION}으로 업데이트됐어요` : hint();
      ensureSettings();
    } else {
      pendingDown = false;
      removeSettings();
    }
  }

  // Magma는 페이지 이동 없이 화면을 바꾸므로 주기적으로 상태를 맞춘다
  const tick = setInterval(() => {
    if (!getCanvas()) { if (S.active) setActive(false); return; }
    ensureStyle();
    ensureToolButton();
    if (S.active) {
      // 단축키 등으로 Magma가 다른 도구로 바뀌었으면 마법봉 끄기
      if (!S.busy && !S.switching && !switchingTo && currentTool() !== 'lassoSelectionIcon') { setActive(false); return; }
      ensureSettings();
    } else if (lassoStabSaved !== null && !switchingTo && currentTool() === 'lassoSelectionIcon') {
      // 되돌리지 못한 손떨림 보정(단축키로 도구를 바꿨거나 창을 닫았던 경우)을 올가미 선택이 보일 때 되돌림
      restoreLassoStab();
    }
  }, 400);

  // 새 버전이 들어올 때 이 버전을 깨끗이 걷어낸다
  window.__magmaWand.destroy = () => {
    clearInterval(tick);
    for (const f of cleanups.splice(0)) { try { f(); } catch { /* 무시 */ } }
    removeSettings();
    document.querySelectorAll('.mw-menu, .mw-toast, .mw-dialog-wrap, .mw-shortcut').forEach((e) => e.remove());
    toolBtn?.remove(); styleEl?.remove();
    toolBtn = null; styleEl = null;
    S.active = false;
    document.documentElement.classList.remove('mw-on', 'mw-busy');
  };

  // 개발·시험용
  window.__magmaWand.run = runWand;
  window.__magmaWand.tune = (perFrame, step) => { PER_FRAME = perFrame; STEP = step; }; // 시험용
  window.__magmaWand.state = S;
  window.__magmaWand.setActive = setActive;
  window.__magmaWand.internals = { floodFill, dilate, traceContours, buildPolygon, area, outsideMask,
    selectTool, currentTool, getStabilizer, setStabilizer, getSelectionMode, setSelectionMode, drawLasso, readScreen,
    getBrushMode, setBrushMode, getAutoErase, setAutoErase, layerRows, personalState, soloCurrentLayer, restoreLayers,
    edtSq, growShrinkMask, maskToSinglePolygon, viewTransform, copyMergedSelection, growShrinkSelection, openGrowDialog };
})();
