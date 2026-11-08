// Magma 마법봉
// Magma 페이지 안에서 직접 실행되는 스크립트. 크롬 확장과 데스크톱 앱 실행기가 같은 파일을 쓴다.
// 동작: 화면에 보이는 그림 픽셀을 읽어 클릭한 곳과 비슷한 색으로 이어진 영역을 계산하고,
//       그 테두리를 따라 Magma 자체 올가미(선택 / 올가미 채우기)를 대신 그어 준다.
// 화면: 왼쪽 도구 막대에 마법봉 버튼, 오른쪽 도구 설정 칸에 설정 (Magma 선택 도구 설정과 함께 표시)
// 새 버전이 같은 페이지에 다시 들어오면 옛 버전을 걷어내고 그 자리를 대신한다(새로고침 없이 업데이트).
(() => {
  'use strict';
  const VERSION = '0.3.3';
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
  const DEFAULTS = { tol: 10, expand: 1, action: 'select', ref: 'all' };
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
      const { tol, expand, action, ref } = S;
      localStorage.setItem('magmaWand.settings', JSON.stringify({ tol, expand, action, ref }));
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
    for (let i = 0; i < 20 && currentTool() !== name; i++) await sleep(25);
    await sleep(60);
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
    await sleep(60);
    return getSelectionMode() === v;
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
    await sleep(60);
    return getBrushMode() === m;
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
    await sleep(80);
    if (getAutoErase() !== v) { // 버튼이 아니라 줄(label)이 반응하는 경우
      const label = b.closest('label');
      if (label) { press(label); await sleep(80); }
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
    document.documentElement.classList.add('mw-busy');
    const t0 = performance.now();
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
      const img = await readScreen(canvas);
      if (saved) { await restoreLayers(saved); saved = null; }
      if (img.blank) return status('화면을 읽지 못했어요 (Magma 창이 가려져 있지 않은지 확인해 주세요)');

      // 2) 영역 계산
      const rect = canvas.getBoundingClientRect();
      const bx = Math.floor((clientX - rect.left) * canvas.width / rect.width);
      const by = Math.floor((clientY - rect.top) * canvas.height / rect.height);
      if (bx < 0 || by < 0 || bx >= img.w || by >= img.h) return status('그림판 밖을 눌렀어요');
      const outside = outsideMask(img);
      if (outside[by * img.w + bx]) return status('보드 바깥을 눌렀어요');
      const { mask, count } = floodFill(img, bx, by, S.tol);
      if (S.expand > 0) dilate(mask, img.w, img.h, S.expand);
      for (let i = 0; i < mask.length; i++) if (outside[i]) mask[i] = 0;
      const res = buildPolygon(mask, img.w, img.h);
      if (!res) return status('영역을 만들지 못했어요');
      const poly = rotateStart(insetFromOutside(res.poly, outside, img.w, img.h), outside, img.w, img.h);

      // 3) Magma 올가미로 긋기
      if (fill) {
        const oldRow = stabilizerRow();
        if (!(await selectTool('lassoBrushIcon'))) return status('올가미 채우기 도구로 바꾸지 못했어요');
        await waitPanelChange(oldRow);
        prevBrushMode = getBrushMode();
        await setBrushMode('draw');          // 지우기 모드로 남아 있으면 칠 대신 지워짐
        prevAutoErase = getAutoErase();
        if (prevAutoErase) await setAutoErase(false);
      } else {
        prevSelMode = getSelectionMode();
        wantMode = mods.alt ? 'subtract' : (mods.shift ? 'add' : null); // Shift: 추가, Alt: 빼기 (그 외엔 설정 칸의 선택 모드)
        if (wantMode) await setSelectionMode(wantMode);
      }
      prevStab = getStabilizer();
      if (prevStab) await setStabilizer(0);
      await drawLasso(canvas, poly, {});
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
  on(window, 'pointerdown', (e) => {
    if (!S.active || !e.isTrusted) return;
    const b = e.target && e.target.closest && e.target.closest('button.tool');
    if (b && !b.classList.contains('mw-tool')) setActive(false);
  }, true);

  // 단축키 W (클립 스튜디오와 같음)
  on(window, 'keydown', (e) => {
    if (e.key !== 'w' && e.key !== 'W') return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!getCanvas()) return;
    setActive(true);
  }, true);

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
      toolBtn.title = '마법봉 (W)';
      const svg = toolBtn.querySelector('svg');
      svg.setAttribute('class', 'svg-icon fa-fw icon-mwWand');
      svg.setAttribute('viewBox', '0 0 512 512');
      svg.innerHTML = WAND_SVG;
      toolBtn.addEventListener('click', (e) => { e.preventDefault(); setActive(true); });
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
      if (!S.busy && !S.switching && currentTool() !== 'lassoSelectionIcon') { setActive(false); return; }
      ensureSettings();
    }
  }, 400);

  // 새 버전이 들어올 때 이 버전을 깨끗이 걷어낸다
  window.__magmaWand.destroy = () => {
    clearInterval(tick);
    for (const f of cleanups.splice(0)) { try { f(); } catch { /* 무시 */ } }
    removeSettings();
    toolBtn?.remove(); styleEl?.remove();
    toolBtn = null; styleEl = null;
    S.active = false;
    document.documentElement.classList.remove('mw-on', 'mw-busy');
  };

  // 개발·시험용
  window.__magmaWand.run = runWand;
  window.__magmaWand.state = S;
  window.__magmaWand.setActive = setActive;
  window.__magmaWand.internals = { floodFill, dilate, traceContours, buildPolygon, area, outsideMask,
    selectTool, currentTool, getStabilizer, setStabilizer, getSelectionMode, setSelectionMode, drawLasso, readScreen,
    getBrushMode, setBrushMode, getAutoErase, setAutoErase, layerRows, personalState, soloCurrentLayer, restoreLayers };
})();
