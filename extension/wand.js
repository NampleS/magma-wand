// Magma 마법봉
// Magma 페이지 안에서 직접 실행되는 스크립트. 크롬 확장과 데스크톱 앱 실행기가 같은 파일을 쓴다.
// 동작: 보드의 실제 그림 픽셀(Magma 내부 읽기 전용 함수, 못 쓰면 화면)을 읽어 클릭한 곳과 비슷한 색의 영역을 계산하고,
//       그 테두리를 픽셀 그대로 따라 Magma 자체 올가미(선택 / 올가미 채우기)를 한 번 대신 그어 준다.
// 화면: 왼쪽 도구 막대에 마법봉 버튼, 오른쪽 도구 설정 칸에 설정 (Magma 선택 도구 설정과 함께 표시)
// 새 버전이 같은 페이지에 다시 들어오면 옛 버전을 걷어내고 그 자리를 대신한다(새로고침 없이 업데이트).
(() => {
  'use strict';
  const VERSION = '0.8.0';
  const isNewer = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b || '0').split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
  };
  const prev = window.__magmaWand;
  if (prev) {
    // 끝까지 시작된(ready) 같은·더 높은 버전이 있으면 그대로 둔다. 시작하다 멈춘 버전은 새로 덮어쓴다
    if (prev.ready && !isNewer(VERSION, prev.version)) return;
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
  // tool: 도구 묶음에서 마지막으로 쓴 도구 ('wand' 마법봉 | 'quick' 빠른 선택)
  // 빠른 선택: brush(보드 픽셀), qtol, qexpand, qref, qkeys
  // contig: true = 이어진 영역만, false = 보드 전체에서 같은 색 모두 (CSP·포토샵의 '인접'/'연속' 옵션)
  const DEFAULTS = { tol: 10, expand: 1, action: 'select', ref: 'all', keys: ['KeyW'], contig: true, histOn: true,
    tool: 'wand', brush: 20, qtol: 12, qexpand: 1, qref: 'all', qkeys: ['Shift+KeyW'] };
  const S = Object.assign({}, DEFAULTS, loadSettings(), { active: false, busy: false, switching: false });
  if (!['select', 'fill'].includes(S.action)) S.action = 'select';
  if (!['all', 'layer'].includes(S.ref)) S.ref = 'all';
  if (!['all', 'layer'].includes(S.qref)) S.qref = 'all';
  if (!['wand', 'quick'].includes(S.tool)) S.tool = 'wand';
  if (!Array.isArray(S.qkeys)) S.qkeys = DEFAULTS.qkeys.slice();
  if (typeof S.contig !== 'boolean') S.contig = true;

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('magmaWand.settings') || '{}');
      if (s.mode && !s.action) s.action = s.mode; // 0.2 이하 설정 이어받기
      return s;
    } catch { return {}; }
  }
  function saveSettings() {
    try {
      const { tol, expand, action, ref, keys, contig, histOn, growPx, tool, brush, qtol, qexpand, qref, qkeys } = S;
      localStorage.setItem('magmaWand.settings',
        JSON.stringify({ tol, expand, action, ref, keys, contig, histOn, growPx, tool, brush, qtol, qexpand, qref, qkeys }));
    } catch { /* 저장 못 해도 동작에는 지장 없음 */ }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  // ---------- Magma 화면 요소 ----------
  const getCanvas = () => document.querySelector('.editor-canvas canvas');
  const toolSliders = () => document.querySelector('editor-sliders .tool-sliders') || document.querySelector('.tool-sliders:not(.layers-options)');

  // Magma 도구 막대의 버튼들 (마법봉 묶음 버튼·펼침 상자 버튼 제외)
  function toolButtons() {
    const bar = document.querySelector('editor-tools') || document;
    return [...bar.querySelectorAll('button.tool:not(.mw-tool):not(.mw-fly-btn)')];
  }
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
  function magmaRows() { return [...document.querySelectorAll('editor-sliders .tool-sliders .tool-slider:not(.mw-el)')]; }

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
  // 안티에일리어스(Anti-alias)도 같은 방식: 켜져 있으면 선택 가장자리가 반투명이 되어 픽셀 단위로 정확하지 않으므로
  // 마법봉이 긋는 동안만 끄고 되돌린다.
  const PENDING_STAB = 'magmaWand.pendingLassoStab', PENDING_AA = 'magmaWand.pendingLassoAA';
  let lassoStabSaved = null, lassoAASaved = null, stabTimer = null, stabRestoring = null;
  try { const p = localStorage.getItem(PENDING_STAB); if (p !== null && p !== '') lassoStabSaved = +p; } catch { }
  try { if (localStorage.getItem(PENDING_AA) === '1') lassoAASaved = true; } catch { }
  function aaButton() {
    const cb = [...document.querySelectorAll('editor-sliders .selection-tool custom-checkbox')]
      .find((c) => /^Anti-?alias$/i.test(c.textContent.trim()));
    return cb ? cb.querySelector('button.tgl') : null;
  }
  function getAA() { const b = aaButton(); return b ? b.classList.contains('on') : null; }
  async function setAA(v) {
    const b = aaButton();
    if (!b) return false;
    if (getAA() === v) return true;
    b.click();
    return waitFor(() => getAA() === v);
  }
  const pendingLasso = () => lassoStabSaved !== null || lassoAASaved !== null;
  async function lassoStabZero() {
    clearTimeout(stabTimer);
    if (stabRestoring) await stabRestoring;
    if (lassoStabSaved === null) {
      const v = getStabilizer();
      if (v) {
        lassoStabSaved = v;
        try { localStorage.setItem(PENDING_STAB, String(v)); } catch { }
      }
    }
    if (lassoAASaved === null && getAA() === true) {
      lassoAASaved = true;
      try { localStorage.setItem(PENDING_AA, '1'); } catch { }
    }
    if (getStabilizer()) await setStabilizer(0);
    if (getAA() === true) await setAA(false);
  }
  function restoreLassoStab() {
    if (!pendingLasso() || currentTool() !== 'lassoSelectionIcon') return Promise.resolve(false);
    if (stabRestoring) return stabRestoring;
    stabRestoring = (async () => {
      let ok = true;
      if (lassoStabSaved !== null) {
        const v = lassoStabSaved;
        if (getStabilizer() === v || await setStabilizer(v)) { lassoStabSaved = null; try { localStorage.removeItem(PENDING_STAB); } catch { } }
        else ok = false;
      }
      if (lassoAASaved !== null) {
        if (await setAA(true)) { lassoAASaved = null; try { localStorage.removeItem(PENDING_AA); } catch { } }
        else ok = false;
      }
      return ok;
    })().finally(() => { stabRestoring = null; });
    return stabRestoring;
  }
  function scheduleStabRestore(ms = 1200) {
    clearTimeout(stabTimer);
    if (!pendingLasso()) return;
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
    return [...document.querySelectorAll('editor-sliders .tool-sliders .tool-row-buttons button')]
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
  // (0.4.0의 '보드 바깥에서 다리로 시작' 방식은 다리가 진한 선으로 선택에 남아 폐기 — planSelectionLasso 참고)

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

  // ---------- Magma 편집기 안의 그림 직접 읽기 (읽기 전용, 트래픽 0) ----------
  // Magma가 '다운로드'에 쓰는 내부 함수(renderer.getDrawingSnapshotAsBinary / getLayerRawData)로 보드 해상도의
  // 실제 픽셀을 읽는다. 화면 확대·축소와 상관없이 정확하고, 서버로 아무것도 보내지 않는다(내 컴퓨터 안에서만 읽음).
  // 편집기 객체는 Angular가 화면 조각을 등록하는 표(Map)에서 찾는다: Map.prototype.set을 잠깐 감싸 그 표를 한 번
  // 알아낸 뒤 바로 원래대로 돌린다. 읽기 함수만 부르고, 그림을 바꾸는 함수는 절대 부르지 않는다.
  let lviewMap = null, editorRef = null, unhookMap = null;
  function hookLViewMap() {
    if (lviewMap || unhookMap) return;
    const MS = Map.prototype.set;
    const hook = function (k, v) {
      if (!lviewMap && typeof k === 'number' && Array.isArray(v) && v.length > 20 && v[1] && typeof v[1] === 'object' &&
          'blueprint' in v[1]) {
        lviewMap = this;
        queueMicrotask(() => unhookMap && unhookMap());
      }
      return MS.call(this, k, v);
    };
    const timer = setTimeout(() => unhookMap && unhookMap(), 30 * 60 * 1000);
    unhookMap = () => { clearTimeout(timer); if (Map.prototype.set === hook) Map.prototype.set = MS; unhookMap = null; };
    Map.prototype.set = hook;
  }
  hookLViewMap();
  cleanups.push(() => unhookMap && unhookMap());
  const isEditor = (e) => {
    try {
      return !!(e && e.drawing && e.model && e.view && e.renderer &&
        typeof e.renderer.getDrawingSnapshotAsBinary === 'function' && typeof e.renderer.getLayerRawData === 'function');
    } catch { return false; }
  };
  function getEditor() {
    if (isEditor(editorRef) && editorRef.element?.isConnected !== false) return editorRef;
    editorRef = null;
    if (!lviewMap) return null;
    let n = 0;
    for (const el of document.querySelectorAll('drawing-page, editor-box, editor-sliders, editor-tools, editor-box *')) {
      if (typeof el.__ngContext__ !== 'number' || ++n > 400) continue;
      const lv = lviewMap.get(el.__ngContext__);
      if (!Array.isArray(lv)) continue;
      for (let i = 0; i < lv.length && i < 300; i++) {
        const o = lv[i];
        if (!o || typeof o !== 'object' || o instanceof Node) continue;
        try {
          if (isEditor(o.editor) && o.editor.element?.isConnected !== false) { editorRef = o.editor; return editorRef; }
        } catch { /* 무시 */ }
      }
    }
    return null;
  }
  // 편집기가 아직 안 잡혔으면, Angular가 화면 조각을 하나 새로 만들게 해서(도구 설정 칸 다시 그리기) 잡는다
  async function ensureEditor() {
    if (getEditor()) return editorRef;
    if (lviewMap) return null;
    hookLViewMap();
    if (currentTool() === 'lassoSelectionIcon') {
      await selectTool('lassoBrushIcon'); await sleep(60); await selectTool('lassoSelectionIcon');
    } else await selectTool('lassoSelectionIcon');
    await sleep(60);
    return getEditor();
  }

  // 보드 좌표 ↔ 화면 좌표. 회전·뒤집기 상태거나 주소(#v)의 값과 어긋나면 null (그때는 예전 화면 기준 방식)
  const MAX_DOC_PX = 50e6;
  function docContext(canvas) {
    const E = getEditor();
    if (!E || !canvas) return null;
    let v, d;
    try { v = E.view; d = E.drawing; } catch { return null; }
    if (!v || !(v.scale > 0) || v.rotation || v.flipped) return null;
    if (!d || !(d.w > 0) || !(d.h > 0) || d.w * d.h > MAX_DOC_PX) return null;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0)) return null;
    const kx = canvas.width / rect.width, ky = canvas.height / rect.height;
    const vx = v.x, vy = v.y, sc = v.scale;
    // 안전 확인: 주소의 화면 정보와 같은 곳을 가리키는지 (1.5보드픽셀 이내)
    const vt = viewTransform();
    if (vt && vt.zoom > 0) {
      const cx = (rect.width / 2 - vx) / sc, cy = (rect.height / 2 - vy) / sc;
      if (Math.abs(cx - vt.cx) > 1.5 || Math.abs(cy - vt.cy) > 1.5 || Math.abs(sc - vt.zoom) / vt.zoom > 0.01) return null;
    }
    return {
      E, W: d.w, H: d.h, scale: sc, kx, ky, rect,
      toDoc: (cx, cy) => [(cx - rect.left - vx) / sc, (cy - rect.top - vy) / sc],
      toBuf: ([x, y]) => [(vx + x * sc) * kx, (vy + y * sc) * ky],
      xf: [sc * kx, vx * kx, vy * ky],                // 보드 → 화면 버퍼 (덧그림용)
      spike: SPIKE,                                    // 정밀 올가미의 최소 점 간격 (보드 픽셀)
    };
  }
  // 보드 크기의 RGBA 그림. ref: 'all' 보이는 그림 전체 / 'layer' 현재 레이어만(없는 곳은 투명)
  // { fallback: true } = 이 방법으로는 못 읽음 → 예전 방식으로
  function docImage(D, ref) {
    const { E, W, H } = D;
    try {
      if (ref === 'layer') {
        const L = E.model.user && E.model.user.activeLayers && E.model.user.activeLayers[0];
        if (!L) return { error: '현재 레이어를 찾지 못했어요' };
        const data = new Uint8ClampedArray(W * H * 4);
        const r = L.rect;
        if (r && r.w > 0 && r.h > 0) {
          if (!L.texture || L.unloadedImage) return { fallback: true };
          const raw = E.renderer.getLayerRawData(L);
          if (!raw || raw.width !== r.w || raw.height !== r.h || raw.data.length !== r.w * r.h * 4) return { fallback: true };
          for (let y = 0; y < r.h; y++) {
            const by = r.y + y;
            if (by < 0 || by >= H) continue;
            const x0 = Math.max(0, -r.x), x1 = Math.min(r.w, W - r.x);
            if (x1 <= x0) continue;
            data.set(raw.data.subarray((y * r.w + x0) * 4, (y * r.w + x1) * 4), (by * W + r.x + x0) * 4);
          }
        }
        return { w: W, h: H, data, layer: L.name };
      }
      if (E.drawing.layers.some((l) => l.unloadedImage && !l.texture)) return { fallback: true };
      const buf = E.renderer.getDrawingSnapshotAsBinary(E.drawing);
      if (!buf || buf.length !== W * H * 4) return { fallback: true };
      return { w: W, h: H, data: buf };
    } catch (e) {
      console.warn('[MagmaWand] 보드 그림 읽기 실패 → 화면 기준으로', e);
      return { fallback: true };
    }
  }

  // ---------- 픽셀 정확한 올가미 경로 ----------
  // 선택 마스크를 Magma 올가미 한 번으로 '픽셀 단위로 똑같이' 옮기기 위한 경로를 만든다.
  // Magma 올가미 동작(소스 확인 + 실측):
  //  - 점은 보드 좌표를 정수로 반올림해 저장하고, 앞 점과 가로·세로 모두 1픽셀 이내면 버린다
  //    → 1픽셀 계단의 모서리가 버려져 대각선으로 뭉개짐 (예전 '끄트머리 픽셀이 남는' 원인)
  //  - 안티에일리어스를 끄면 정수 다각형을 그림판(2D 캔버스)으로 칠해 선택 마스크를 만든다
  //  - 한 번에 약 5,000점을 넘으면 모양이 깨진다(4,828점 정상, 5,518점 깨짐 실측)
  // 그래서:
  //  1) 픽셀 테두리(정수 모서리)를 그대로 따라간다 — 가로·세로 변뿐이라 칠하면 픽셀이 정확히 0 또는 1로 덮인다
  //  2) 가까운 점 사이에는 그 변 방향으로 2픽셀 튀어나갔다 돌아오는 점(폭 0 가시)을 넣어 Magma가 버리지 않게 한다
  //  3) 덩어리·구멍들은 폭 0 왕복 다리로 이어 한 붓으로 만든다
  //  4) Magma가 버릴 점·반올림까지 흉내 내서 칠해 보고, 원래 마스크와 한 픽셀도 다르지 않을 때만 정밀 경로를 쓴다
  //  점이 너무 많으면 작은 조각부터 빼고, 그래도 많으면 예전처럼 매끈하게 줄인다(이때만 정밀도가 떨어짐).
  const MAX_LASSO_PTS = 4500;
  const SPIKE = 2; // 앞 점과 가로·세로 1픽셀 넘게 떨어지도록
  function hilbertD(n, x, y) {
    let d = 0;
    for (let s = n >> 1; s > 0; s >>= 1) {
      const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; }
    }
    return d;
  }
  // 앞 점과 가로·세로 모두 1픽셀 이내인 점 앞에, 그 변 방향으로 SPIKE만큼 나갔다 오는 점을 넣는다(폭 0 가시).
  // 방향은 가로·세로 중 큰 쪽이 1이 되게 맞춰서, 정수 좌표 경로에서는 가시도 정수 좌표(같은 선 위)가 된다.
  // 가시가 보드 밖으로 나가면 Magma가 보드 가장자리로 당겨 다시 가까워지므로, 그때는 반대쪽(앞 점 너머)으로 낸다.
  function withSpikes(loop, W = Infinity, H = Infinity) {
    const out = [];
    const n = loop.length;
    const inB = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H;
    for (let i = 0; i < n; i++) {
      const A = loop[(i - 1 + n) % n], B = loop[i];
      const dx = B[0] - A[0], dy = B[1] - A[1];
      if ((dx || dy) && Math.abs(dx) <= 1.05 && Math.abs(dy) <= 1.05) {
        const c = Math.max(Math.abs(dx), Math.abs(dy)), ux = dx / c, uy = dy / c;
        let sx = B[0] + ux * SPIKE, sy = B[1] + uy * SPIKE;
        if (!inB(sx, sy)) { sx = B[0] - ux * (SPIKE + 1); sy = B[1] - uy * (SPIKE + 1); }
        out.push([sx, sy]);
      }
      out.push(B);
    }
    return out;
  }
  // Magma 올가미가 실제로 받아들일 점만 남겨 본다 (정수로 반올림 → 보드 안으로 당김 → 앞 점과 가로·세로 모두 1픽셀 이내면 버림)
  function magmaKeep(pts, W, H) {
    const out = [];
    let lx = -1e5, ly = -1e5;
    for (const [x0, y0] of pts) {
      const x = Math.min(W, Math.max(0, Math.round(x0))), y = Math.min(H, Math.max(0, Math.round(y0)));
      if (Math.abs(x - lx) > 1 || Math.abs(y - ly) > 1) { out.push([x, y]); lx = x; ly = y; }
    }
    return out;
  }
  // 경로(닫힌 한 붓)를 Magma와 같은 방식으로 칠해 본다: 픽셀 중심에서 오른쪽으로 뻗은 선이 변을 홀수 번 넘으면 안
  // (Magma 소스: 안티에일리어스 끈 올가미는 픽셀 중심 홀짝 판정 → 그 마스크의 테두리를 다시 따서 채움).
  // 단, Magma의 테두리 다시 따기는 '모서리로만 맞닿은 1픽셀 구멍'을 메우는 일이 드물게 있다(올가미로는 피할 수 없음).
  function rasterPath(pts, W, H) {
    const n = pts.length, cnt = new Int32Array(H + 1);
    const rows = (a, b) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      return [Math.max(0, Math.ceil(lo - 0.5)), Math.min(H - 1, Math.ceil(hi - 0.5) - 1)];
    };
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (a[1] === b[1]) continue;
      const [r0, r1] = rows(a[1], b[1]);
      for (let r = r0; r <= r1; r++) cnt[r + 1]++;
    }
    for (let r = 0; r < H; r++) cnt[r + 1] += cnt[r];
    const xs = new Float64Array(cnt[H]), fillp = cnt.slice(0, H);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (a[1] === b[1]) continue;
      const [r0, r1] = rows(a[1], b[1]);
      for (let r = r0; r <= r1; r++) {
        const y = r + 0.5, k = fillp[r]++;
        xs[k] = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
      }
    }
    const out = new Uint8Array(W * H);
    const idx = [];
    for (let r = 0; r < H; r++) {
      const s = cnt[r], e = cnt[r + 1];
      if (e - s < 2) continue;
      idx.length = 0;
      for (let k = s; k < e; k++) idx.push(k);
      idx.sort((p, q) => xs[p] - xs[q]);
      let par = 0;
      for (let j = 0; j < idx.length; j++) {
        const k = idx[j];
        if (j > 0 && par) {
          const x0 = Math.max(0, Math.ceil(xs[idx[j - 1]] - 0.5)), x1 = Math.min(W, Math.ceil(xs[k] - 0.5));
          for (let x = x0; x < x1; x++) out[r * W + x] = 1;
        }
        par ^= 1;
      }
    }
    return out;
  }
  // 테두리들을 한 붓으로: s0 → 테두리0 → s0 → s1 → 테두리1 → s1 → … → sN → 테두리N → sN → s(N-1) → … → s1 (→ s0)
  // 가까운 테두리끼리 이어지도록 시작점을 힐베르트 곡선 순서로 놓는다(다리가 짧아 점선이 덜 어지럽다).
  function chainLoops(loops, W, H) {
    const n2 = 1 << Math.ceil(Math.log2(Math.max(W, H, 2)));
    const ls = loops.map((l) => ({ l, k: hilbertD(n2, Math.min(n2 - 1, Math.max(0, l[0][0] | 0)), Math.min(n2 - 1, Math.max(0, l[0][1] | 0))) }))
      .sort((a, b) => a.k - b.k).map((o) => o.l);
    const path = [];
    for (const l of ls) path.push(...l, l[0]);
    for (let i = ls.length - 2; i >= 1; i--) path.push(ls[i][0]);
    if (ls.length === 1) path.pop();
    const out = [];
    for (const p of path) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return withSpikes(out, W, H);
  }
  // 픽셀 계단을 긴 직선으로 바꾼다 (꼭짓점은 정수 좌표 그대로).
  // Magma는 '픽셀 중심이 도형 안에 있는가'로 칠하므로(실측: 넓이 40%만 덮인 픽셀도 중심이 안이면 선택),
  // 직선이 테두리 양옆 픽셀 중심들의 '안쪽/바깥쪽'을 그대로 지키면 결과가 똑같다.
  // 한 꼭짓점에서 출발해, 지나온 테두리의 안쪽 중심은 모두 직선의 안쪽, 바깥쪽 중심은 모두 바깥쪽에 오게 하는
  // 방향 범위(부채꼴)를 좁혀 가며 가장 멀리 갈 수 있는 꼭짓점까지 한 번에 잇는다. 중심을 정확히 지나는 직선은 쓰지 않는다.
  function straightLoop(loop) {
    // 단위 길이 꼭짓점들로 펼치기
    const P = [];
    const n0 = loop.length;
    for (let i = 0; i < n0; i++) {
      const a = loop[i], b = loop[(i + 1) % n0];
      const sx = Math.sign(b[0] - a[0]), sy = Math.sign(b[1] - a[1]), len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      for (let k = 0; k < len; k++) P.push([a[0] + sx * k, a[1] + sy * k]);
    }
    const m = P.length;
    if (m < 8) return loop;
    const out = [];
    const MAXRUN = 400, MARGIN = 0.1; // 직선은 모든 픽셀 중심에서 0.1픽셀 넘게 떨어져야 (그림판 칠하기의 반올림 차이 대비)
    const cin = new Float64Array(MAXRUN * 2), cout = new Float64Array(MAXRUN * 2);
    let i = 0;
    while (i < m) {
      const vx = P[i][0], vy = P[i][1];
      let Ax = 0, Ay = 0, hasA = false, Bx = 0, By = 0, hasB = false;
      const cands = [];
      let nc = 0;
      for (let j = i + 1; j <= m && j - i <= MAXRUN; j++) {
        // 변 j-1 → j 양옆의 픽셀 중심 (안쪽 = 진행 방향 기준 (dy, -dx) 쪽)
        const a = P[(j - 1) % m], b = P[j % m];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const mx = (a[0] + b[0]) / 2 - vx, my = (a[1] + b[1]) / 2 - vy;
        const ix = mx + dy * 0.5, iy = my - dx * 0.5, ox = mx - dy * 0.5, oy = my + dx * 0.5;
        cin[nc * 2] = ix; cin[nc * 2 + 1] = iy; cout[nc * 2] = ox; cout[nc * 2 + 1] = oy; nc++;
        // 안쪽 중심: 방향이 그보다 반시계 쪽이어야 → 가장 반시계인 것을 A로
        if (!hasA || Ax * iy - Ay * ix > 0) { Ax = ix; Ay = iy; hasA = true; }
        // 바깥쪽 중심: 방향이 그보다 시계 쪽이어야 → 가장 시계인 것을 B로
        if (!hasB || ox * By - oy * Bx > 0) { Bx = ox; By = oy; hasB = true; }
        if (Ax * By - Ay * Bx <= 0) break; // 가능한 방향이 없어짐
        const ex = b[0] - vx, ey = b[1] - vy;
        if (Ax * ey - Ay * ex > 0 && ex * By - ey * Bx > 0) cands.push([j, nc]);
      }
      // 먼 후보부터: 지나온 모든 중심이 직선에서 MARGIN 넘게 떨어져 있으면 채택
      let best = i + 1;
      for (let q = cands.length - 1; q >= 0; q--) {
        const [j, cnt] = cands[q];
        if (j - i <= 1) break;
        const ex = P[j % m][0] - vx, ey = P[j % m][1] - vy, L = Math.hypot(ex, ey), lim = MARGIN * L;
        let ok = true;
        for (let k = 0; k < cnt && ok; k++) {
          if (-(ex * cin[k * 2 + 1] - ey * cin[k * 2]) <= lim) ok = false;      // 안쪽 중심: cross(e, c) < -lim
          else if (ex * cout[k * 2 + 1] - ey * cout[k * 2] <= lim) ok = false;  // 바깥쪽 중심: cross(e, c) > lim
        }
        if (ok) { best = j; break; }
      }
      out.push(P[i]);
      i = best;
    }
    return out;
  }

  function exactPath(mask, W, H, _unused, opts = {}) {
    const maxPts = opts.maxPts || MAX_LASSO_PTS;
    const loops = traceContours(mask, W, H).filter((l) => l.length >= 3);
    if (!loops.length) return null;
    const total = loops.length;
    const straight = opts.pixelOnly ? loops : loops.map(straightLoop);
    const cost = (l) => withSpikes(l).length + 3;
    let keep = loops.map((_, i) => i), dropped = 0;
    let sum = straight.reduce((s, l) => s + cost(l), 0);
    if (sum > maxPts && loops.length > 1) {
      // 점이 너무 많으면 작은 조각(구멍·덩어리)부터 뺀다
      const order = loops.map((l, i) => ({ i, a: Math.abs(area(l)) })).sort((a, b) => b.a - a.a);
      const k2 = [];
      let s2 = 0;
      for (const o of order) {
        const c = cost(straight[o.i]);
        if (s2 + c > maxPts && k2.length) { dropped++; continue; }
        k2.push(o.i); s2 += c;
      }
      keep = k2.sort((a, b) => a - b); sum = s2;
    }
    const kept = keep.map((i) => loops[i]);
    let target = mask;
    if (dropped) { target = new Uint8Array(W * H); for (const l of kept) rasterPath(l, W, H).forEach((v, i) => { if (v) target[i] ^= 1; }); }
    // 확인: Magma가 실제로 받아들일 점으로 칠한 결과가 (뺀 조각을 뺀) 마스크와 같아야 하고,
    // 경로를 아주 조금씩 흔들어도 같아야 한다(픽셀 중심을 정확히 지나는 선이 없음 = Magma의 경계 처리에 기대지 않음)
    const verify = (path) => {
      if (path.length > maxPts * 1.1) return false;
      const k = magmaKeep(path, W, H);
      for (const [ox, oy] of [[0, 0], [0.011, 0.004], [-0.011, -0.004], [0.004, -0.011], [-0.004, 0.011]]) {
        const r = rasterPath(ox || oy ? k.map(([x, y]) => [x + ox, y + oy]) : k, W, H);
        for (let i = 0; i < r.length; i++) if (r[i] !== (target[i] ? 1 : 0)) return false;
      }
      return true;
    };
    // pixelOnly: 올가미 채우기용 — 채우기는 대각선 변의 가장자리를 반투명하게 칠하므로 가로·세로 변(픽셀 테두리)만 쓴다
    let path = opts.pixelOnly ? null : chainLoops(keep.map((i) => straight[i]), W, H), mode = 'straight';
    if (!path || !verify(path)) {
      path = chainLoops(kept, W, H); mode = 'pixel';
      if (!verify(path)) {
        // 점이 너무 많으면(아주 복잡한 테두리) 예전처럼 매끈하게 줄인다 — 이때만 정밀도가 조금 떨어짐
        path = chainLoops(kept.map((l) => simplify(l, 0.7)), W, H); mode = 'rough';
      }
    }
    return { pts: path, loops: keep.length, dropped, simplified: mode === 'rough', mode, total };
  }

  // ---------- 영역 계산 ----------
  // wild: 기존 선택의 점선이 그려진 화면 픽셀 — 색과 상관없이 통과시킨다 (점선이 벽이 되지 않게)
  // withAlpha: 레이어 그림처럼 투명도가 있는 그림 — 투명도까지 비교 (투명끼리는 같은 색으로 본다)
  function floodFill(img, sx, sy, tolPct, wild = null, withAlpha = false, contig = true) {
    const { w, h, data } = img;
    const mask = new Uint8Array(w * h);
    const si = (sy * w + sx) * 4;
    const r0 = data[si], g0 = data[si + 1], b0 = data[si + 2], a0 = data[si + 3];
    const t = Math.round((tolPct / 100) * 255);
    const ok = withAlpha ? (p) => {
      const i = p * 4, a = data[i + 3];
      if (a0 === 0 && a === 0) return true;
      if (Math.abs(a - a0) > t) return false;
      // 반투명 가장자리는 색에 투명도를 곱해 비교
      return Math.abs(data[i] * a - r0 * a0) / 255 <= t && Math.abs(data[i + 1] * a - g0 * a0) / 255 <= t &&
        Math.abs(data[i + 2] * a - b0 * a0) / 255 <= t;
    } : (p) => {
      const i = p * 4;
      if (wild && wild[p]) return true;
      return Math.abs(data[i] - r0) <= t && Math.abs(data[i + 1] - g0) <= t && Math.abs(data[i + 2] - b0) <= t;
    };
    if (contig === false) {
      // 이어지지 않아도 보드 전체에서 같은 색이면 모두 (CSP·포토샵의 '인접' 끄기)
      let count = 0;
      for (let p = 0, n = w * h; p < n; p++) if (ok(p)) { mask[p] = 1; count++; }
      return { mask, count };
    }
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

  // ---------- 영역 계산: 화면 기준 ('모든 레이어') ----------
  async function regionFromScreen(canvas, clientX, clientY, T, mark) {
    const img = await readScreen(canvas);
    mark('captured');
    if (img.blank) return { error: '화면을 읽지 못했어요 (Magma 창이 가려져 있지 않은지 확인해 주세요)' };
    const rect = canvas.getBoundingClientRect();
    const bx = Math.floor((clientX - rect.left) * canvas.width / rect.width);
    const by = Math.floor((clientY - rect.top) * canvas.height / rect.height);
    if (bx < 0 || by < 0 || bx >= img.w || by >= img.h) return { error: '그림판 밖을 눌렀어요' };
    const outside = outsideMask(img);
    if (outside[by * img.w + bx]) return { error: '보드 바깥을 눌렀어요' };
    // 기존 선택이 있으면 그 점선을 실제 그림 색으로 지운 뒤 계산 (점선이 벽이 되지 않게)
    if (selectionExists()) {
      const sel = await copyMergedSelection();
      T.repaired = sel.error ? -1 : repairUnderSelection(sel, canvas, img);
      mark('antsRemoved');
    }
    const { mask, count } = floodFill(img, bx, by, S.tol, null, false, S.contig);
    if (S.expand > 0) dilate(mask, img.w, img.h, S.expand);
    for (let i = 0; i < mask.length; i++) if (outside[i]) mask[i] = 0;
    if (!S.contig) {
      const P = exactPath(mask, img.w, img.h, 2, { pixelOnly: S.action === 'fill' });
      if (!P) return { error: '영역을 만들지 못했어요' };
      return { poly: P.pts, count, holes: 0, pieces: P.loops, samples: sampleMask(mask, img.w, img.h) };
    }
    const res = buildPolygon(mask, img.w, img.h);
    if (!res) return { error: '영역을 만들지 못했어요' };
    const poly = rotateStart(insetFromOutside(res.poly, outside, img.w, img.h), outside, img.w, img.h);
    return { poly, count, holes: res.holes, samples: sampleMask(mask, img.w, img.h) };
  }

  // ---------- 영역 계산: 현재 레이어 기준 ('현재 레이어') ----------
  // Magma의 Copy(Ctrl+C)를 클립보드에 쓰기 직전에 가로채 현재 레이어 그림과 위치를 얻는다.
  // 화면·레이어 보이기를 전혀 바꾸지 않아 깜빡임이 없고, 오가는 데이터도 아주 작다(실측 392바이트).
  // 선택이 있으면 Ctrl+C가 선택 안쪽만 복사하므로, 직전에 받아 둔 레이어 그림을 다시 쓴다(그동안 그림이 바뀌지 않았을 때만).
  let layerCache = null, layerDirty = true;
  function currentLayerRow() { return layerRows().find((r) => r.classList.contains('on')) || null; }
  // 레이어 목록은 보이는 만큼만 그려져 줄 수·순서가 바뀔 수 있으므로, 현재 레이어 줄의 글자(이름·모드·주인)로 구분
  function currentLayerKey() {
    const row = currentLayerRow();
    return row ? row.textContent.replace(/\s+/g, ' ').trim() : null;
  }
  // 사용자가 그리거나(캔버스에서 손을 뗌) 되돌리기·붙여넣기·지우기를 하면 받아 둔 그림을 버린다
  on(window, 'pointerup', (e) => { if (e.isTrusted && !S.busy && !S.active && e.target === getCanvas()) layerDirty = true; }, true);
  on(window, 'keydown', (e) => {
    if (!e.isTrusted) return;
    if (((e.ctrlKey || e.metaKey) && /^Key[ZYVX]$/.test(e.code)) || e.code === 'Delete' || e.code === 'Backspace') layerDirty = true;
  }, true);

  async function interceptCopy(keyOpts, waitMs) {
    const cb = navigator.clipboard;
    if (!cb) return { error: '클립보드 기능을 쓸 수 없어요' };
    let got = null;
    const hadOwn = Object.prototype.hasOwnProperty.call(cb, 'write');
    const prevOwn = cb.write;
    cb.write = async (items) => {
      try {
        const o = {};
        for (const it of items) {
          if (it.types.includes('image/png')) o.png = await it.getType('image/png');
          if (it.types.includes('web application/x-magma-clip')) o.clip = await (await it.getType('web application/x-magma-clip')).text();
        }
        got = o;
      } catch (e) { got = { error: String(e) }; }
    };
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { ...keyOpts, bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { ...keyOpts, bubbles: true, cancelable: true }));
      await waitFor(() => got, waitMs);
    } finally {
      if (hadOwn) cb.write = prevOwn; else delete cb.write;
    }
    return got || { none: true };
  }
  async function decodeClipPayload(clip) {
    const m = /data-clip-payload="[^"]*?magmapayload[^A-Za-z0-9+\/_-]*([A-Za-z0-9+\/=_-]+)/.exec(clip || '');
    if (!m) return null;
    const bin = Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const txt = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'))).text();
    return JSON.parse(txt);
  }
  async function pngToRgba(png) {
    const bmp = await createImageBitmap(png);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return { w: cv.width, h: cv.height, rgba: g.getImageData(0, 0, cv.width, cv.height).data };
  }
  async function getCurrentLayerImage() {
    const key = currentLayerKey();
    if (!key) return { error: '현재 레이어를 찾지 못했어요' };
    const foreign = currentLayerRow()?.classList.contains('foreign'); // 다른 사람 레이어는 언제든 바뀔 수 있음
    if (layerCache && !layerDirty && !foreign && layerCache.key === key && Date.now() - layerCache.at < 5 * 60 * 1000) return layerCache;
    if (selectionExists()) {
      return { error: '현재 레이어 참조: 선택이 있는 상태에서는 레이어를 새로 읽을 수 없어요. 선택을 해제하고 한 번 클릭한 뒤 이어서 쓰세요' };
    }
    const got = await interceptCopy({ key: 'c', code: 'KeyC', keyCode: 67, which: 67, ctrlKey: true }, 1500);
    if (got.error) return { error: '현재 레이어를 읽지 못했어요' };
    let info = null;
    try { info = got.clip ? await decodeClipPayload(got.clip) : null; } catch { info = null; }
    let board = info && info.canvas && info.canvas.rect;
    if (!board) {
      // 빈 레이어는 복사할 게 없어 아무것도 오지 않는다 → 보드 크기는 Copy merged 대신 화면에서 알 수 없으니 큰 빈 영역으로
      if (got.none) return { error: '현재 레이어가 비어 있어요' };
      return { error: '현재 레이어 위치를 읽지 못했어요' };
    }
    const L = info.layers && info.layers[0];
    if (!L || !L.rect || !got.png) return { error: '현재 레이어 위치를 읽지 못했어요' };
    const px = await pngToRgba(got.png);
    if (px.w !== L.rect.w || px.h !== L.rect.h) return { error: '현재 레이어 크기가 맞지 않아요' };
    layerCache = { key, at: Date.now(), board: { w: board.w, h: board.h }, rect: L.rect, w: px.w, h: px.h, rgba: px.rgba };
    layerDirty = false;
    return layerCache;
  }
  async function regionFromLayer(canvas, clientX, clientY, fill, T, mark) {
    const vt = viewTransform();
    if (!vt || !(vt.zoom > 0)) return { error: '화면 위치 정보를 읽지 못했어요' };
    if (Math.abs(vt.rot) > 1e-6 || vt.flags) return { error: '화면을 회전하거나 뒤집은 상태에서는 현재 레이어 참조를 쓸 수 없어요' };
    const L = await getCurrentLayerImage();
    mark('layerRead');
    if (L.error) return L;
    const W = L.board.w, H = L.board.h;
    const rect = canvas.getBoundingClientRect();
    const dx = Math.floor(vt.cx + (clientX - (rect.left + rect.width / 2)) / vt.zoom);
    const dy = Math.floor(vt.cy + (clientY - (rect.top + rect.height / 2)) / vt.zoom);
    if (dx < 0 || dy < 0 || dx >= W || dy >= H) return { error: '보드 바깥을 눌렀어요' };
    // 보드 크기의 레이어 그림 (레이어가 없는 곳은 투명)
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < L.h; y++) {
      const by = L.rect.y + y;
      if (by < 0 || by >= H) continue;
      for (let x = 0; x < L.w; x++) {
        const bx = L.rect.x + x;
        if (bx < 0 || bx >= W) continue;
        const s = (y * L.w + x) * 4, d = (by * W + bx) * 4;
        data[d] = L.rgba[s]; data[d + 1] = L.rgba[s + 1]; data[d + 2] = L.rgba[s + 2]; data[d + 3] = L.rgba[s + 3];
      }
    }
    const { mask, count } = floodFill({ w: W, h: H, data }, dx, dy, S.tol, null, true, S.contig);
    if (S.expand > 0) dilate(mask, W, H, S.expand);
    // 보드 좌표 → 캔버스 버퍼 좌표 (exactPath가 보드 밖 점을 안쪽으로 당겨 둠)
    const kx = canvas.width / rect.width, ky = canvas.height / rect.height;
    const toBuf = ([x, y]) => [(rect.width / 2 + (x - vt.cx) * vt.zoom) * kx, (rect.height / 2 + (y - vt.cy) * vt.zoom) * ky];
    const spike = SPIKE;
    const P = exactPath(mask, W, H, spike, { pixelOnly: fill });
    if (!P) return { error: '영역을 만들지 못했어요' };
    T.docRegion = true;
    return { poly: P.pts.map(toBuf), count, holes: Math.max(0, P.loops - 1), pieces: P.loops,
      samples: sampleMask(mask, W, H, 1500, toBuf), minSeg: spike * vt.zoom * kx };
  }

  // ---------- 영역 계산: 보드 실제 픽셀 기준 (기본) ----------
  // 화면이 아니라 보드 해상도 그림으로 계산하므로 축소해 봐도 깨지지 않고, 테두리를 픽셀 그대로 따라 긋는다.
  async function regionFromDoc(D, clientX, clientY, fill, T, mark) {
    const img = docImage(D, S.ref);
    mark('docRead');
    if (img.fallback || img.error) return img;
    const [fx, fy] = D.toDoc(clientX, clientY);
    const dx = Math.floor(fx), dy = Math.floor(fy);
    if (dx < 0 || dy < 0 || dx >= img.w || dy >= img.h) return { error: '보드 바깥을 눌렀어요' };
    const { mask, count } = floodFill(img, dx, dy, S.tol, null, true, S.contig);
    if (S.expand > 0) dilate(mask, img.w, img.h, S.expand);
    mark('filled');
    const P = exactPath(mask, img.w, img.h, D.spike, { pixelOnly: fill });
    if (!P) return { error: '영역을 만들지 못했어요' };
    T.doc = true; T.loops = P.loops; T.points = P.pts.length; T.pathMode = P.mode;
    if (P.dropped) T.dropped = P.dropped;
    const note = P.dropped ? ` · 작은 조각 ${P.dropped}개는 점이 너무 많아 뺐어요` : (P.simplified ? ' · 테두리가 복잡해 조금 매끈하게 그었어요' : '');
    return { poly: P.pts.map(D.toBuf), count, holes: Math.max(0, P.loops - 1), samples: sampleMask(mask, img.w, img.h, 1500, D.toBuf),
      minSeg: D.spike * D.scale * D.kx, note, pieces: P.loops };
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
      if (currentTool() !== 'lassoSelectionIcon') await selectTool('lassoSelectionIcon');
      mark('ready');
      // 1~2) 영역 계산 — 기본은 보드 실제 픽셀(Magma 내부 읽기). 못 쓰면(화면 회전 등) 예전 방식:
      //      '모든 레이어'는 화면 기준, '현재 레이어'는 Ctrl+C 가로채기
      await ensureEditor();
      const D = docContext(canvas);
      let R = D ? await regionFromDoc(D, clientX, clientY, fill, T, mark) : { fallback: true };
      if (R.fallback) {
        T.fallback = true;
        R = S.ref === 'layer' ? await regionFromLayer(canvas, clientX, clientY, fill, T, mark)
          : await regionFromScreen(canvas, clientX, clientY, T, mark);
      }
      if (R.error) return status(R.error);
      const { poly, count, holes } = R;
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
        await lassoStabZero(); // 연속 클릭 동안은 꺼 둔 채로, 쉬면 되돌림
      }
      mark('toolReady');
      // 안전: 반드시 올가미 한 번으로 끝낸다. Magma는 선택을 바꿀 때마다 되돌리기 기록(최대 15칸)을 한 칸 쓰므로,
      // 여러 번 그으면 사용자의 그림 기록이 밀려난다. 구멍은 선택된 영역 안을 지나는 폭 0짜리 다리로 이어 한 붓에 그린다
      // (선택 마스크를 직접 읽어 다리 자리에 틈이 없음을 확인함).
      if (fill) {
        await drawLasso(canvas, poly, {});
      } else {
        // Shift: 추가, Alt: 빼기 (그 외엔 설정 칸의 선택 모드)
        const mode = mods.alt ? 'subtract' : (mods.shift ? 'add' : prevSelMode || 'select');
        const plan = await planSelectionLasso(canvas, poly, mode, R.samples || [], R.minSeg || 0);
        T.plan = plan.mode + (plan.deselectFirst ? '+deselect' : '');
        if (plan.mode !== prevSelMode) wantMode = plan.mode; // finally에서 원래 모드로 되돌림
        await drawSelectionPlan(canvas, plan);
      }
      mark('drawn');
      if (fill) layerDirty = true; // 현재 레이어가 바뀌었으므로 받아 둔 레이어 그림은 버림
      const ms = Math.round(performance.now() - t0);
      const parts = !S.contig && R.pieces > 1 ? `, 테두리 ${R.pieces}개` : (holes ? `, 구멍 ${holes}개` : '');
      status(`${fill ? '채움' : '선택'}: ${count.toLocaleString()}픽셀${parts} (${(ms / 1000).toFixed(1)}초)` +
        (R.note || '') + (T.fallback ? ' · 화면 기준' : ''));
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

  // ---------- 빠른 선택 (Quick Selection) ----------
  // 브러시로 문지른 곳의 색들을 표본으로 모아, 비슷한 색으로 이어진 영역을 넓혀 간다(색 경계에서는 멈춤).
  // 문지르는 동안의 미리보기는 내 화면에만 그리는 덧그림이고, 손을 떼면 Magma에 올가미 한 번으로 확정한다.
  const Q = { stroking: false, prep: null, src: null, pts: [], done: 0, mask: null, blockedFlag: null, blocked: [],
    accept: null, sampled: null, subtract: false, add: false, ov: null, ovCtx: null, off: null, offCtx: null, ovImg: null,
    dirty: null, raf: 0, cursor: null };
  const KEY_RGB = [8, 247, 16]; // '현재 레이어'에서 투명한 곳을 나타내는 색 (그림에 거의 안 쓰이는 색)

  async function prepareQuickSource(canvas) {
    const rect = canvas.getBoundingClientRect();
    const kx = canvas.width / rect.width, ky = canvas.height / rect.height;
    const vt = viewTransform();
    // 기본: 보드 실제 픽셀 (투명한 곳은 KEY_RGB로 깔아 RGB만으로 비교)
    await ensureEditor();
    const D = docContext(canvas);
    if (D) {
      const img = docImage(D, S.qref);
      if (img.error) return img;
      if (!img.fallback) {
        const n = img.w * img.h, src = img.data, data = new Uint8ClampedArray(n * 4);
        for (let i = 0, o = 0; i < n; i++, o += 4) {
          const a = src[o + 3];
          if (a === 255) { data[o] = src[o]; data[o + 1] = src[o + 1]; data[o + 2] = src[o + 2]; }
          else {
            const f = a / 255;
            data[o] = src[o] * f + KEY_RGB[0] * (1 - f) + 0.5; data[o + 1] = src[o + 1] * f + KEY_RGB[1] * (1 - f) + 0.5;
            data[o + 2] = src[o + 2] * f + KEY_RGB[2] * (1 - f) + 0.5;
          }
          data[o + 3] = 255;
        }
        return { w: img.w, h: img.h, data, space: 'doc', xf: D.xf, rect, kx, ky, forbid: null,
          toSrc: D.toDoc, toBuf: D.toBuf, radius: () => S.brush, spike: D.spike, minSeg: D.spike * D.scale * D.kx };
      }
    }
    if (S.qref === 'layer') {
      if (!vt || !(vt.zoom > 0) || Math.abs(vt.rot) > 1e-6 || vt.flags) return { error: '화면을 회전·뒤집은 상태에서는 현재 레이어 참조를 쓸 수 없어요' };
      const L = await getCurrentLayerImage();
      if (L.error) return L;
      const W = L.board.w, H = L.board.h, data = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) { data[i * 4] = KEY_RGB[0]; data[i * 4 + 1] = KEY_RGB[1]; data[i * 4 + 2] = KEY_RGB[2]; data[i * 4 + 3] = 255; }
      for (let y = 0; y < L.h; y++) {
        const by = L.rect.y + y; if (by < 0 || by >= H) continue;
        for (let x = 0; x < L.w; x++) {
          const bx = L.rect.x + x; if (bx < 0 || bx >= W) continue;
          const s = (y * L.w + x) * 4, d = (by * W + bx) * 4, a = L.rgba[s + 3] / 255;
          for (let c = 0; c < 3; c++) data[d + c] = Math.round(L.rgba[s + c] * a + KEY_RGB[c] * (1 - a));
        }
      }
      const spike = SPIKE;
      return { w: W, h: H, data, space: 'doc', rect, kx, ky, forbid: null,
        xf: [vt.zoom * kx, (rect.width / 2 - vt.cx * vt.zoom) * kx, (rect.height / 2 - vt.cy * vt.zoom) * ky],
        toSrc: (cx, cy) => [vt.cx + (cx - (rect.left + rect.width / 2)) / vt.zoom, vt.cy + (cy - (rect.top + rect.height / 2)) / vt.zoom],
        toBuf: ([x, y]) => [(rect.width / 2 + (x - vt.cx) * vt.zoom) * kx, (rect.height / 2 + (y - vt.cy) * vt.zoom) * ky],
        radius: () => S.brush, spike, minSeg: spike * vt.zoom * kx };
    }
    const img = await readScreen(canvas);
    if (img.blank) return { error: '화면을 읽지 못했어요 (Magma 창이 가려져 있지 않은지 확인해 주세요)' };
    if (selectionExists()) { const sel = await copyMergedSelection(); if (!sel.error) repairUnderSelection(sel, canvas, img); }
    const outside = outsideMask(img);
    const z = vt && vt.zoom > 0 ? vt.zoom : 1;
    return { w: img.w, h: img.h, data: img.data, space: 'buf', rect, kx, ky, forbid: outside,
      toSrc: (cx, cy) => [(cx - rect.left) * kx, (cy - rect.top) * ky],
      toBuf: (p) => p,
      radius: () => S.brush * z * kx, outside };
  }

  // 색 표: RGB 각 5비트(32단계)로 나눈 칸마다 '받아들일 색인지'를 미리 표시해 두면 픽셀마다 빠르게 판정할 수 있다
  const qBucket = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  function qAddSample(r, g, b) {
    const q = qBucket(r, g, b);
    if (Q.sampled[q]) return false;
    Q.sampled[q] = 1;
    const rad = Math.ceil((S.qtol / 100) * 255 / 8);
    const r5 = r >> 3, g5 = g >> 3, b5 = b >> 3;
    for (let i = Math.max(0, r5 - rad); i <= Math.min(31, r5 + rad); i++)
      for (let j = Math.max(0, g5 - rad); j <= Math.min(31, g5 + rad); j++)
        for (let k = Math.max(0, b5 - rad); k <= Math.min(31, b5 + rad); k++) Q.accept[(i << 10) | (j << 5) | k] = 1;
    return true;
  }
  function qMark(p) {
    Q.mask[p] = 1;
    const x = p % Q.src.w, y = (p - x) / Q.src.w;
    const o = p * 4;
    Q.ovImg.data[o] = Q.subtract ? 255 : 60; Q.ovImg.data[o + 1] = Q.subtract ? 70 : 140; Q.ovImg.data[o + 2] = Q.subtract ? 70 : 255; Q.ovImg.data[o + 3] = 110;
    const d = Q.dirty;
    if (x < d[0]) d[0] = x; if (y < d[1]) d[1] = y; if (x > d[2]) d[2] = x; if (y > d[3]) d[3] = y;
  }
  // 넓히기: 받아들일 색이고, 이웃과의 색 차이가 크지 않을 때(=경계가 아닐 때)만 퍼진다
  function qGrow(stack, sp) {
    const { w, h, data } = Q.src, forbid = Q.src.forbid;
    const edge = Math.max(24, Math.round((S.qtol / 100) * 255) + 8);
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w, i = p * 4;
      for (let n = 0; n < 4; n++) {
        let q;
        if (n === 0) { if (x === 0) continue; q = p - 1; }
        else if (n === 1) { if (x === w - 1) continue; q = p + 1; }
        else if (n === 2) { if (y === 0) continue; q = p - w; }
        else { if (y === h - 1) continue; q = p + w; }
        if (Q.mask[q] || (forbid && forbid[q])) continue;
        const j = q * 4;
        const okColor = Q.accept[qBucket(data[j], data[j + 1], data[j + 2])];
        const okEdge = Math.max(Math.abs(data[j] - data[i]), Math.abs(data[j + 1] - data[i + 1]), Math.abs(data[j + 2] - data[i + 2])) <= edge;
        if (okColor && okEdge) { qMark(q); stack[sp++] = q; }
        else if (!Q.blockedFlag[q]) { Q.blockedFlag[q] = 1; Q.blocked.push(q); }
      }
    }
  }
  // 문지른 점들 처리: 브러시 자국은 무조건 포함 + 그 색을 표본으로 추가 → 넓히기
  function qProcess() {
    if (!Q.src) return;
    const { w, h, data, forbid } = Q.src;
    const r = Math.max(1, Q.src.radius()), r2 = r * r;
    const stack = Q.stack;
    let sp = 0, newSamples = false;
    const stamp = (cx, cy) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
          const p = y * w + x;
          if (forbid && forbid[p]) continue;
          const i = p * 4;
          if (((x + y) & 1) === 0 && qAddSample(data[i], data[i + 1], data[i + 2])) newSamples = true;
          if (!Q.mask[p]) { qMark(p); stack[sp++] = p; }
        }
      }
    };
    while (Q.done < Q.pts.length) {
      const [cx, cy] = Q.src.toSrc(...Q.pts[Q.done]);
      const prev = Q.done > 0 ? Q.src.toSrc(...Q.pts[Q.done - 1]) : null;
      if (prev) {
        const dist = Math.hypot(cx - prev[0], cy - prev[1]), steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 2)));
        for (let s = 1; s <= steps; s++) stamp(prev[0] + (cx - prev[0]) * s / steps, prev[1] + (cy - prev[1]) * s / steps);
      } else stamp(cx, cy);
      Q.done++;
    }
    // 표본이 늘었으면 전에 막혔던 경계 픽셀을 다시 시도
    if (newSamples && Q.blocked.length) {
      const retry = Q.blocked; Q.blocked = []; Q.blockedFlag.fill(0);
      for (const q of retry) {
        if (Q.mask[q]) continue;
        const j = q * 4;
        if (!Q.accept[qBucket(data[j], data[j + 1], data[j + 2])]) { Q.blockedFlag[q] = 1; Q.blocked.push(q); continue; }
        const x = q % w, y = (q - x) / w;
        const nb = [x > 0 && q - 1, x < w - 1 && q + 1, y > 0 && q - w, y < h - 1 && q + w].filter((v) => v !== false && Q.mask[v]);
        if (nb.length) { qMark(q); stack[sp++] = q; } else { Q.blockedFlag[q] = 1; Q.blocked.push(q); }
      }
    }
    qGrow(stack, sp);
    qRender();
  }

  // 미리보기 덧그림 (내 화면에만 보임)
  function qEnsureOverlay(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!Q.ov) {
      Q.ov = document.createElement('canvas');
      Q.ov.className = 'mw-overlay mw-el';
      document.body.appendChild(Q.ov);
      Q.ovCtx = Q.ov.getContext('2d');
    }
    Object.assign(Q.ov.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', display: 'block' });
    Q.ov.width = canvas.width; Q.ov.height = canvas.height;
  }
  function qRender() {
    if (Q.raf) return;
    Q.raf = requestAnimationFrame(() => {
      Q.raf = 0;
      if (!Q.src || !Q.ov) return;
      const d = Q.dirty;
      if (d[2] >= d[0]) {
        Q.offCtx.putImageData(Q.ovImg, 0, 0, d[0], d[1], d[2] - d[0] + 1, d[3] - d[1] + 1);
        Q.dirty = [Infinity, Infinity, -1, -1];
      }
      const g = Q.ovCtx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, Q.ov.width, Q.ov.height);
      if (Q.src.space === 'doc') {
        const [s, ox, oy] = Q.src.xf;
        g.imageSmoothingEnabled = false;
        g.setTransform(s, 0, 0, s, ox, oy);
      }
      g.drawImage(Q.off, 0, 0);
    });
  }
  function qClearOverlay() { if (Q.ov) Q.ov.style.display = 'none'; }

  function qCursor(cx, cy, show) {
    if (!Q.cursor) { Q.cursor = document.createElement('div'); Q.cursor.className = 'mw-brush mw-el'; document.body.appendChild(Q.cursor); }
    if (!show) { Q.cursor.style.display = 'none'; return; }
    const vt = viewTransform();
    const d = S.brush * 2 * (vt && vt.zoom > 0 ? vt.zoom : 1);
    Object.assign(Q.cursor.style, { display: 'block', width: d + 'px', height: d + 'px', left: (cx - d / 2) + 'px', top: (cy - d / 2) + 'px' });
  }

  function qStart(e, canvas) {
    Q.stroking = true; Q.pts = [[e.clientX, e.clientY]]; Q.done = 0; Q.src = null;
    Q.subtract = e.altKey; Q.add = e.shiftKey;
    status(Q.subtract ? '빼는 중… (손을 떼면 확정)' : '선택 중… (손을 떼면 확정)');
    Q.prep = (async () => {
      if (currentTool() !== 'lassoSelectionIcon') await selectTool('lassoSelectionIcon');
      const src = await prepareQuickSource(canvas);
      if (src.error) { status(src.error); return src; }
      Q.src = src;
      const n = src.w * src.h;
      Q.mask = new Uint8Array(n); Q.blockedFlag = new Uint8Array(n); Q.blocked = []; Q.stack = new Int32Array(n);
      Q.accept = new Uint8Array(32768); Q.sampled = new Uint8Array(32768);
      Q.off = document.createElement('canvas'); Q.off.width = src.w; Q.off.height = src.h;
      Q.offCtx = Q.off.getContext('2d'); Q.ovImg = Q.offCtx.createImageData(src.w, src.h);
      Q.dirty = [Infinity, Infinity, -1, -1];
      qEnsureOverlay(canvas);
      qProcess();
      return src;
    })();
  }
  async function qFinish(canvas, cancel) {
    Q.stroking = false;
    const src = await Q.prep;
    if (cancel || !src || src.error || !Q.src) { qClearOverlay(); Q.src = null; if (cancel) status('취소했어요'); return; }
    qProcess();
    if (S.busy) { qClearOverlay(); return; }
    S.busy = true;
    document.documentElement.classList.add('mw-busy');
    let prevSelMode = null, changed = false;
    try {
      const { w, h } = Q.src;
      const mask = Q.mask;
      if (S.qexpand > 0) dilate(mask, w, h, S.qexpand);
      if (Q.src.forbid) for (let i = 0; i < mask.length; i++) if (Q.src.forbid[i]) mask[i] = 0;
      let count = 0; for (let i = 0; i < mask.length; i++) count += mask[i];
      // 보드 픽셀 기준이면 픽셀 그대로의 정밀 경로, 화면 기준(예전 방식)이면 매끈하게 줄인 경로
      let poly0 = null;
      if (Q.src.space === 'doc') { const P = exactPath(mask, w, h, Q.src.spike); poly0 = P && P.pts; }
      else poly0 = maskToSinglePolygon(mask, w, h);
      if (!poly0) { status('영역을 만들지 못했어요'); return; }
      const poly = poly0.map(Q.src.toBuf);
      const mode = Q.subtract ? 'subtract' : (Q.add || selectionExists() ? 'add' : 'select');
      prevSelMode = getSelectionMode();
      await lassoStabZero();
      const plan = await planSelectionLasso(canvas, poly, mode, sampleMask(mask, w, h, 1500, Q.src.toBuf), Q.src.minSeg || 0);
      changed = plan.mode !== prevSelMode;
      await drawSelectionPlan(canvas, plan); // 올가미 한 번 = 되돌리기 한 칸
      status(`${Q.subtract ? '뺌' : '선택'}: ${count.toLocaleString()}픽셀`);
    } catch (err) {
      console.error('[MagmaWand]', err);
      status('오류: ' + (err && err.message || err));
    } finally {
      try { if (changed && prevSelMode) await setSelectionMode(prevSelMode); } catch { }
      qClearOverlay();
      Q.src = null; Q.mask = null; Q.ovImg = null; Q.off = null; Q.stack = null;
      scheduleStabRestore();
      S.busy = false;
      document.documentElement.classList.remove('mw-busy');
      ensureSettings();
    }
  }

  // ---------- Ctrl+Alt 끌기로 브러시 크기 바꾸기 (클립 스튜디오 방식) ----------
  // 펜·브러시·지우개·블렌드·리퀴파이(그리고 빠른 선택)에서 Ctrl+Alt를 누른 채 그림판을 끌면:
  //  - 원의 중심(영점)에서 마우스까지의 거리가 브러시 반지름이 된다.
  //  - 영점은 '지금 크기의 원 위에, 마지막으로 조정을 끝냈던 방향에 마우스가 오도록' 잡는다.
  //    그래서 다시 조정할 때 원이 지난번과 같은 방향으로 나타나고, 누르는 순간 크기가 튀지 않는다.
  //  - 끄는 동안은 내 화면에만 원을 그리고, 손을 뗄 때 Magma 크기 칸에 한 번만 넣는다(설정 변경 1회).
  // Magma의 Size = 지름(보드 픽셀). 크기 칸은 1~500까지 입력된다(Magma 소스).
  const SIZE_TOOLS = new Set(['faPencil', 'faPaintBrush', 'faEraser', 'blendIcon', 'liquifyIcon']);
  const SIZE_DIR_KEY = 'magmaWand.sizeDir';
  const BSZ = { on: false, quick: false, ox: 0, oy: 0, zoom: 1, size: 0, el: null, label: null, pid: null };
  function sizeRow() {
    return magmaRows().find((r) => /^Size(\s+x[\d.]+)?$/.test(r.querySelector('.slider-label')?.textContent.replace(/\s+/g, ' ').trim() || ''));
  }
  function getBrushSize() {
    const v = parseFloat(sizeRow()?.querySelector('editable-number')?.textContent.trim());
    return Number.isFinite(v) ? v : null;
  }
  async function setRowNumber(row, v) {
    const en = row?.querySelector('editable-number');
    if (!en) return false;
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
    return true;
  }
  // Magma는 Alt를 누르고 있는 동안 도구를 잠깐 스포이트로 바꾼다 → 수정키를 누르기 전의 도구를 기억해 둔다
  let plainTool = null, rememberAt = 0;
  const rememberTool = (force) => {
    const now = performance.now();
    if (!force && now - rememberAt < 250) return; // 마우스 움직임마다 화면을 뒤지지 않게
    rememberAt = now;
    const t = currentTool();
    if (!t) return;
    plainTool = t;
    if (SIZE_TOOLS.has(t)) { const v = getBrushSize(); if (v) BSZ.lastSize = v; }
  };
  on(window, 'keydown', (e) => {
    if (!e.isTrusted || e.repeat) return;
    if ((e.key === 'Alt' && !e.ctrlKey) || (e.key === 'Control' && !e.altKey)) rememberTool(true);
  }, true);
  on(window, 'pointermove', (e) => { if (e.isTrusted && !e.altKey && !e.ctrlKey && !BSZ.on) rememberTool(); }, { capture: true, passive: true });
  function sizeGestureTarget() {
    if (S.busy) return null;
    if (S.active) return S.tool === 'quick' ? 'quick' : null;
    const t = SIZE_TOOLS.has(currentTool()) ? currentTool() : plainTool;
    return SIZE_TOOLS.has(t) ? 'brush' : null;
  }
  function viewZoom() {
    const E = getEditor();
    const z = E && E.view && E.view.scale;
    if (z > 0) return z;
    const vt = viewTransform();
    return vt && vt.zoom > 0 ? vt.zoom : 1;
  }
  function loadSizeDir() {
    try {
      const d = JSON.parse(localStorage.getItem(SIZE_DIR_KEY) || 'null');
      if (Array.isArray(d) && Number.isFinite(d[0]) && Number.isFinite(d[1]) && Math.hypot(d[0], d[1]) > 0.5) return d;
    } catch { /* 무시 */ }
    return [1, 0]; // 처음: 원의 오른쪽 가장자리에 마우스
  }
  const roundSize = (v) => Math.min(500, Math.max(1, v < 10 ? Math.round(v * 10) / 10 : Math.round(v)));
  function sizeRender(mx, my) {
    const r = Math.hypot(mx - BSZ.ox, my - BSZ.oy);
    BSZ.size = BSZ.quick ? Math.min(500, Math.max(1, Math.round(r / BSZ.zoom))) : roundSize((2 * r) / BSZ.zoom);
    const rr = BSZ.quick ? BSZ.size * BSZ.zoom : (BSZ.size / 2) * BSZ.zoom;
    Object.assign(BSZ.el.style, { left: (BSZ.ox - rr) + 'px', top: (BSZ.oy - rr) + 'px', width: 2 * rr + 'px', height: 2 * rr + 'px' });
    BSZ.label.textContent = BSZ.quick ? `브러시 크기 ${BSZ.size}` : `Size ${BSZ.size}`;
    Object.assign(BSZ.label.style, { left: mx + 14 + 'px', top: my + 14 + 'px' });
  }
  function sizeStart(e, kind) {
    const zoom = viewZoom();
    const cur = kind === 'quick' ? S.brush : (getBrushSize() || BSZ.lastSize);
    if (!(cur > 0)) return false;
    const rScreen = kind === 'quick' ? cur * zoom : (cur / 2) * zoom;
    const [dx, dy] = loadSizeDir();
    const L = Math.hypot(dx, dy) || 1;
    Object.assign(BSZ, { on: true, quick: kind === 'quick', zoom, pid: e.pointerId,
      ox: e.clientX - (dx / L) * rScreen, oy: e.clientY - (dy / L) * rScreen });
    if (!BSZ.el) {
      BSZ.el = document.createElement('div'); BSZ.el.className = 'mw-size-ring mw-el';
      BSZ.label = document.createElement('div'); BSZ.label.className = 'mw-size-label mw-el';
    }
    document.body.append(BSZ.el, BSZ.label);
    BSZ.el.style.display = BSZ.label.style.display = 'block';
    if (kind === 'quick') qCursor(0, 0, false);
    sizeRender(e.clientX, e.clientY);
    return true;
  }
  async function sizeEnd(e, cancel) {
    if (!BSZ.on) return;
    BSZ.on = false;
    BSZ.el.style.display = BSZ.label.style.display = 'none';
    if (cancel) return;
    sizeRender(e.clientX, e.clientY);
    const vx = e.clientX - BSZ.ox, vy = e.clientY - BSZ.oy, L = Math.hypot(vx, vy);
    if (L > 2) { try { localStorage.setItem(SIZE_DIR_KEY, JSON.stringify([vx / L, vy / L])); } catch { } }
    if (BSZ.quick) {
      S.brush = BSZ.size; saveSettings(); rowsEl?.__mwSync?.();
      qCursor(e.clientX, e.clientY, true);
      return;
    }
    const want = BSZ.size;
    try {
      // Alt를 떼서 원래 도구(크기 칸)가 돌아올 때까지 기다렸다가 한 번만 넣는다
      await waitFor(() => SIZE_TOOLS.has(currentTool()) && sizeRow(), 3000);
      if (!sizeRow() || !SIZE_TOOLS.has(currentTool())) { toast('브러시 크기 칸을 찾지 못해 바꾸지 못했어요'); return; }
      if (getBrushSize() === want) return;
      await setRowNumber(sizeRow(), want);
      await waitFor(() => getBrushSize() === want, 400);
    } catch (err) { console.warn('[MagmaWand] 브러시 크기 바꾸기 실패', err); }
  }
  const SIZE_EVENTS = ['pointerdown', 'pointermove', 'pointerrawupdate', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'contextmenu'];
  function onSizeGesture(e) {
    if (!e.isTrusted || e.__magmaWand) return;
    if (BSZ.on) {
      // 조정 중에는 Magma가 그리지 않도록 모든 입력을 가로챈다
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
      if (e.type === 'pointermove' && e.pointerId === BSZ.pid) sizeRender(e.clientX, e.clientY);
      else if ((e.type === 'pointerup' || e.type === 'pointercancel') && e.pointerId === BSZ.pid) sizeEnd(e, e.type === 'pointercancel');
      return;
    }
    if (e.type !== 'pointerdown' || !e.ctrlKey || !e.altKey || e.button !== 0) return;
    const canvas = getCanvas();
    if (!canvas || e.target !== canvas) return;
    const kind = sizeGestureTarget();
    if (!kind) return;
    if (!sizeStart(e, kind)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
  }
  // 마법봉 입력 처리보다 먼저 받도록 맨 앞에 등록 (window 캡처 단계, 등록 순서대로 실행)
  for (const t of SIZE_EVENTS) on(window, t, onSizeGesture, true);
  on(window, 'blur', () => { if (BSZ.on) sizeEnd({ clientX: BSZ.ox, clientY: BSZ.oy }, true); });

  // ---------- 입력 가로채기 ----------
  // 도구가 켜져 있으면 그림판 위의 실제 클릭·끌기는 Magma에 넘기지 않고 이 도구가 처리한다.
  const BLOCK = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'];
  let pendingDown = false;
  function onInput(e) {
    if (!S.active || e.__magmaWand || !e.isTrusted) return;
    const canvas = getCanvas();
    if (!canvas) return;
    // 빠른 선택: 끌기 도중 손을 캔버스 밖에서 떼도 마무리한다
    if (S.tool === 'quick' && Q.stroking && (e.type === 'pointerup' || e.type === 'mouseup')) {
      e.stopImmediatePropagation(); e.preventDefault();
      if (e.type === 'pointerup') qFinish(canvas, false);
      return;
    }
    if (e.target !== canvas) return;
    if (e.type.startsWith('touch')) { e.stopImmediatePropagation(); return; }
    if (e.button !== 0) return; // 가운데/오른쪽 버튼(화면 이동 등)은 그대로 통과
    e.stopImmediatePropagation();
    e.preventDefault();
    if (S.tool === 'quick') {
      if (e.type === 'pointerdown' && !S.busy && !Q.stroking) qStart(e, canvas);
      return;
    }
    if (e.type === 'pointerdown') pendingDown = true;
    if (e.type === 'pointerup' && pendingDown) {
      pendingDown = false;
      if (!S.busy) runWand(e.clientX, e.clientY, { shift: e.shiftKey, alt: e.altKey });
    }
  }
  for (const t of BLOCK) on(window, t, onInput, true);
  on(window, 'pointermove', (e) => {
    if (!S.active || !e.isTrusted || e.__magmaWand) return;
    const canvas = getCanvas();
    if (S.tool === 'quick' && canvas) {
      const r = canvas.getBoundingClientRect();
      const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      qCursor(e.clientX, e.clientY, over || Q.stroking);
      if (Q.stroking) {
        e.stopImmediatePropagation();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ce of (evs.length ? evs : [e])) Q.pts.push([ce.clientX, ce.clientY]);
        if (Q.src) qProcess();
      }
      return;
    }
    if (pendingDown) e.stopImmediatePropagation();
  }, true);
  on(window, 'keydown', (e) => {
    if (!S.active || S.tool !== 'quick' || !e.isTrusted) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.code === 'Escape' && Q.stroking) { e.preventDefault(); e.stopImmediatePropagation(); qFinish(getCanvas(), true); return; }
    // [ ] : 브러시 크기 (포토샵과 같음)
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      const step = S.brush < 10 ? 1 : S.brush < 50 ? 5 : 10;
      S.brush = Math.min(500, Math.max(1, S.brush + (e.code === 'BracketRight' ? step : -step)));
      saveSettings(); rowsEl?.__mwSync?.();
      if (Q.cursor && Q.cursor.style.display === 'block') {
        const cx = parseFloat(Q.cursor.style.left) + parseFloat(Q.cursor.style.width) / 2, cy = parseFloat(Q.cursor.style.top) + parseFloat(Q.cursor.style.height) / 2;
        qCursor(cx, cy, true);
      }
    }
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
    if (!b || b.classList.contains('mw-tool') || b.closest('.mw-flyout')) return;
    if (switchingTo) { e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (!S.active) return;
    if (pendingLasso() && currentTool() === 'lassoSelectionIcon' && e.type === 'pointerdown') {
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
  const TOOL_LABEL = { wand: '마법봉', quick: '빠른 선택' };
  const TOOL_KEYS = { wand: 'keys', quick: 'qkeys' };
  function syncTooltip() {
    if (!toolBtn) return;
    const k = S[TOOL_KEYS[S.tool]];
    toolBtn.title = TOOL_LABEL[S.tool] + (k.length ? ` (${k.map(comboText).join(', ')})` : '') + ' — 누르면 묶인 도구가 펼쳐져요';
  }

  on(window, 'keydown', (e) => {
    if (capturingKey || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!getCanvas() || document.querySelector('.modal-dialog')) return;
    const c = comboOf(e);
    if (!c) return;
    const tool = S.keys.includes(c) ? 'wand' : S.qkeys.includes(c) ? 'quick' : null;
    if (!tool) return;
    // 사용자가 고른 키이므로 Magma의 같은 키 동작보다 이 도구를 우선한다
    e.preventDefault(); e.stopImmediatePropagation();
    setActive(true, tool);
  }, true);

  // 설정 창의 단축키 표(Tools)에 '마법봉'·'빠른 선택' 줄을 Magma 줄과 같은 모양으로 넣는다.
  // 바꾼 내용은 설정 창의 Save를 눌러야 저장되고, Cancel·닫기면 버려진다 (Magma와 같은 방식)
  const SC_ROWS = [{ key: 'keys', label: '마법봉 (Magic Wand)' }, { key: 'qkeys', label: '빠른 선택 (Quick Selection)' }];
  let scRows = {}, stagedAll = null, capturingKey = false, hookedModal = null;
  function ensureShortcutRow() {
    const modal = [...document.querySelectorAll('.modal-dialog')].find((m) => /Application settings/.test(m.textContent));
    if (!modal) { scRows = {}; stagedAll = null; capturingKey = false; hookedModal = null; return; }
    if (stagedAll === null) stagedAll = { keys: S.keys.slice(), qkeys: S.qkeys.slice() };
    if (hookedModal !== modal) {
      hookedModal = modal;
      modal.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('button');
        if (b && b.textContent.trim() === 'Save' && stagedAll) {
          S.keys = stagedAll.keys.slice(); S.qkeys = stagedAll.qkeys.slice(); saveSettings(); syncTooltip();
        }
      }, true);
    }
    const lassoTd = [...modal.querySelectorAll('td')].find((td) => td.textContent.trim() === 'Lasso Selection');
    if (!lassoTd) return;
    let after = lassoTd.parentElement;
    for (const def of SC_ROWS) {
      let row = scRows[def.key];
      if (!row || !row.isConnected) { row = buildShortcutRow(lassoTd.parentElement, def); if (!row) return; scRows[def.key] = row; }
      if (after.nextElementSibling !== row) after.after(row);
      after = row;
    }
  }
  function buildShortcutRow(tpl, def) {
    const row = tpl.cloneNode(true);
    row.classList.add('mw-shortcut', 'mw-el');
    row.children[0].textContent = def.label;
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
      for (const c of stagedAll[def.key]) {
        const chip = chipTpl.cloneNode(true);
        const ks = chip.querySelector('kbd-short');
        ks.innerHTML = '';
        comboParts(c).forEach((p, i) => {
          if (i) ks.append(' + ');
          const k = kbdTpl.cloneNode(false); k.textContent = p; ks.append(k);
        });
        chip.querySelector('button').addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          stagedAll[def.key] = stagedAll[def.key].filter((x) => x !== c); render();
        });
        box.append(chip);
      }
      if (capturingKey === def.key) {
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
        plus.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const prevKey = capturingKey; capturingKey = def.key; render();
          if (prevKey && prevKey !== def.key) scRows[prevKey]?.__mwRender?.();
        });
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
    const k = capturingKey;
    if (e.code === 'Escape') { capturingKey = false; scRows[k]?.__mwRender?.(); return; }
    const c = comboOf(e);
    if (!c) return; // Shift 등만 누른 상태
    // 같은 키가 다른 마법봉 묶음 도구에 있으면 그쪽에서 뺀다 (한 키 = 한 도구)
    for (const other of Object.keys(stagedAll)) if (other !== k) stagedAll[other] = stagedAll[other].filter((x) => x !== c);
    if (!stagedAll[k].includes(c)) stagedAll[k].push(c);
    capturingKey = false;
    for (const r of Object.values(scRows)) r?.__mwRender?.();
  }, true);
  const modalObserver = new MutationObserver(() => {
    if (modalObserver.pending) return;
    modalObserver.pending = true;
    requestAnimationFrame(() => { modalObserver.pending = false; ensureShortcutRow(); ensureMenuItems(); });
  });
  // 페이지 본문이 생기기 전에 들어와도 멈추지 않도록 문서 전체를 지켜본다 (0.4.0 버그)
  modalObserver.observe(document.documentElement, { childList: true, subtree: true });
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

  // ---------- 선택용 올가미의 시작점 정하기 ----------
  // Magma는 '새 선택' 모드에서 기존 선택 안쪽에서 시작한 끌기를 '선택 이동'으로 처리한다(실측).
  // 추가·빼기·교차 모드는 안쪽에서 시작해도 정상. 그리고 바깥에서 들어오는 '다리'는 안티에일리어스 때문에
  // 진한 선으로 선택에 남으므로(실측 최대 254/255) 쓰지 않는다.
  //  - 새 선택 + 기존 선택 없음 → 그대로
  //  - 새 선택 + 기존 선택 있음 → 기존 선택 바깥의 꼭짓점에서 시작
  //  - 새 영역이 기존 선택 안에 완전히 들어감 → '교차' 모드 (결과가 새 영역과 정확히 같음)
  //  - 그 밖(드묾) → 선택 해제 후 그음 (이때만 되돌리기 2칸)
  // samples: 새 영역 안쪽 점들(버퍼 좌표) — 포함 여부 확인용
  async function planSelectionLasso(canvas, poly, mode, samples, minSeg = 0) {
    if (mode !== 'select' || !selectionExists()) return { poly, mode };
    const sel = await copyMergedSelection();
    const vt = viewTransform();
    if (sel.error || !vt || !(vt.zoom > 0) || Math.abs(vt.rot) > 1e-6 || vt.flags) return { poly, mode: 'select', deselectFirst: true };
    const rect = canvas.getBoundingClientRect();
    const kx = canvas.width / rect.width, ky = canvas.height / rect.height;
    const inSel = (bx, by) => {
      const dx = Math.floor(vt.cx + (bx / kx - rect.width / 2) / vt.zoom) - sel.x;
      const dy = Math.floor(vt.cy + (by / ky - rect.height / 2) / vt.zoom) - sel.y;
      return dx >= 0 && dy >= 0 && dx < sel.w && dy < sel.h && sel.rgba[(dy * sel.w + dx) * 4 + 3] >= 8;
    };
    // 기존 선택 바깥(주변 2픽셀까지 바깥)인 꼭짓점
    const r = 2 * kx;
    const i = poly.findIndex(([x, y]) => !inSel(x, y) && !inSel(x - r, y) && !inSel(x + r, y) && !inSel(x, y - r) && !inSel(x, y + r));
    if (i >= 0) return { poly: poly.slice(i).concat(poly.slice(0, i)), mode: 'select' };
    // 새 영역 안쪽 점 중 기존 선택 바깥인 점에서 시작 → 가장 가까운 꼭짓점까지 짧은 다리(새 영역 안을 지나므로 흔적 없음)
    let best = null;
    for (const [x, y] of samples) {
      if (inSel(x, y) || inSel(x - r, y) || inSel(x + r, y) || inSel(x, y - r) || inSel(x, y + r)) continue;
      for (let j = 0; j < poly.length; j++) {
        const d = (poly[j][0] - x) ** 2 + (poly[j][1] - y) ** 2;
        if (d >= minSeg * minSeg && (!best || d < best.d)) best = { d, s: [x, y], j };
      }
    }
    if (best && best.d <= (12 * kx) ** 2) {
      const j = best.j;
      return { poly: [best.s, ...poly.slice(j), ...poly.slice(0, j), poly[j]], mode: 'select' };
    }
    let inside = 0;
    for (const [x, y] of samples) if (inSel(x, y)) inside++;
    if (samples.length && inside === samples.length && poly.every(([x, y]) => inSel(x, y))) return { poly, mode: 'intersect' };
    return { poly, mode: 'select', deselectFirst: true };
  }
  // 영역 안쪽 점 표본 (최대 n개)
  function sampleMask(mask, w, h, n = 1500, map = null) {
    const out = [];
    let total = 0;
    for (let i = 0; i < mask.length; i++) total += mask[i];
    if (!total) return out;
    const step = Math.max(1, Math.floor(total / n));
    let k = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      if (k++ % step) continue;
      const x = i % w + 0.5, y = (i - (i % w)) / w + 0.5;
      out.push(map ? map([x, y]) : [x, y]);
    }
    return out;
  }
  // 계획대로 긋기 (선택 모드 설정·복원 포함). 반환: 실제로 쓴 모드
  async function drawSelectionPlan(canvas, plan) {
    if (plan.deselectFirst) {
      const des = document.querySelector('.selection-tool button[command=deselect]');
      if (des && !des.disabled) { press(des); await waitFor(() => !selectionExists(), 500); }
    }
    if (getSelectionMode() !== plan.mode) await setSelectionMode(plan.mode);
    if (getSelectionMode() !== plan.mode) throw new Error('선택 모드를 바꾸지 못했어요');
    await drawLasso(canvas, plan.poly, {});
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
      // 픽셀 그대로의 정밀 경로 (짧은 변 사이를 벌려 Magma가 계단을 뭉개지 않게)
      const spike = SPIKE;
      const EP = exactPath(gs.mask, gs.W, gs.H, spike);
      const poly = EP && EP.pts;
      prevSelMode = getSelectionMode();
      await lassoStabZero();
      if (!poly) {
        // 축소해서 남는 게 없으면 선택 해제
        const des = document.querySelector('button[command=deselect]');
        if (des && !des.disabled) press(des);
        return toast(`${label}: 남는 영역이 없어서 선택을 해제했어요`);
      }
      const kx = canvas.width / rect.width, ky = canvas.height / rect.height;
      const toBuf = ([x, y]) => { const [c1, c2] = toClient(x, y); return [(c1 - rect.left) * kx, (c2 - rect.top) * ky]; };
      const pts = poly.map(([x, y]) => toBuf([x + gs.ox, y + gs.oy]));
      // 새 선택으로 바꾼다 (축소는 기존 선택 안쪽이므로 '교차' 모드로 정확히 같은 결과)
      const plan = await planSelectionLasso(canvas, pts, 'select',
        sampleMask(gs.mask, gs.W, gs.H, 1500, ([x, y]) => toBuf([x + gs.ox, y + gs.oy])), spike * vt.zoom * kx);
      changedMode = plan.mode !== prevSelMode;
      await drawSelectionPlan(canvas, plan);
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
  const HIST_SVG = '<path fill="currentColor" d="M256 48a208 208 0 1 1-147 61l-37-37v112h112l-43-43a144 144 0 1 1-34 93H43A213 213 0 1 0 256 48z"/>' +
    '<path fill="currentColor" d="M240 144h40v104l72 44-20 34-92-56z"/>';
  function ensureMenuItems() {
    for (const menu of document.querySelectorAll('.dropdown-menu')) {
      const items = [...menu.querySelectorAll('command-menu-item')];
      const inv = items.find((it) => /Invert selection/.test(it.textContent));
      if (!inv || menu.querySelector('.mw-menu')) continue;
      const invBtn = inv.querySelector('button');
      const disabled = !!(invBtn && (invBtn.disabled || invBtn.classList.contains('disabled')));
      const make = (text, svg, grow, onClick) => {
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
          if (onClick) { b.disabled = false; b.classList.remove('disabled'); b.removeAttribute('disabled'); it.querySelectorAll('.disabled').forEach((x) => x.classList.remove('disabled')); }
          else if (disabled) { b.disabled = true; b.classList.add('disabled'); }
          b.addEventListener('click', (e) => {
            e.preventDefault(); e.stopImmediatePropagation();
            if (b.disabled) return;
            // 메뉴 닫기 (Magma 메뉴는 바깥을 누르면 닫힌다)
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            menu.classList.remove('show');
            document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            if (onClick) onClick(); else openGrowDialog(grow);
          }, true);
        }
        return it;
      };
      const a = make('선택 범위 확장…', GROW_SVG, true);
      const b = make('선택 범위 축소…', SHRINK_SVG, false);
      const h = make('작업 기록 (내 컴퓨터)…', HIST_SVG, false, () => openHistoryDialog());
      inv.after(a, b, h);
    }
  }

  // ---------- 작업 기록 (내 컴퓨터에만 저장하는 레이어 백업) ----------
  // Magma 되돌리기는 서버가 보드마다 15칸으로 관리해서 늘릴 수 없다(내 쪽에서만 늘리면 보드가 어긋남).
  // 대신 몇 분마다 '바뀐 레이어만' 이 컴퓨터(IndexedDB)에 PNG로 저장해 두고, 필요하면 그 시점의 레이어를
  // 보드 크기 그림으로 클립보드에 복사해 준다. 붙이기는 사용자가 Edit → Paste on new layer(또는 Ctrl+V)로 직접 한다
  // — 마법봉이 보드를 직접 바꾸지 않는다(보드 크기 그림은 화면 위치와 상관없이 제자리에 붙음, 실측).
  // 저장은 Magma 내부 '읽기' 함수만 쓰고 서버로 아무것도 보내지 않는다(트래픽 0).
  const HIST_DB = 'magmaWand.history';
  const HIST_EVERY = 2 * 60 * 1000;        // 바뀐 레이어 확인 간격
  const HIST_FULL_EVERY = 10 * 60 * 1000;  // 썸네일로 안 보이는 작은 변화까지 보는 정밀 확인 간격
  const HIST_KEEP = 60;                    // 보드마다 남길 시점 수
  const HIST_MAX_BYTES = 300 * 1024 * 1024; // 모든 보드를 합친 저장 상한
  const HS = { db: null, timer: 0, boards: new Map(), orders: new Map(), lastFull: 0, running: false, lastInput: 0, rr: 0 };
  on(window, 'pointerdown', (e) => { if (e.isTrusted) HS.lastInput = Date.now(); }, true);
  on(window, 'keydown', (e) => { if (e.isTrusted) HS.lastInput = Date.now(); }, true);

  function histOpen() {
    if (HS.db) return Promise.resolve(HS.db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open(HIST_DB, 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        db.createObjectStore('points', { keyPath: 'id', autoIncrement: true }).createIndex('board', 'board');
        db.createObjectStore('blobs', { keyPath: 'key' });
      };
      rq.onsuccess = () => { HS.db = rq.result; res(HS.db); };
      rq.onerror = () => rej(rq.error);
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function hstore(name, mode = 'readonly') { return (await histOpen()).transaction(name, mode).objectStore(name); }
  async function histPoints(board) {
    const pts = await reqP((await hstore('points')).index('board').getAll(board));
    return pts.sort((a, b) => a.id - b.id);
  }
  const boardId = () => (/\/d\/([^/?#]+)/.exec(location.pathname) || [])[1] || null;
  function hash32(u8) {
    const u = new Uint32Array(u8.buffer, u8.byteOffset, u8.byteLength >> 2);
    let h = 2166136261, h2 = 0;
    for (let i = 0; i < u.length; i++) { h = Math.imul(h ^ u[i], 16777619); h2 = (h2 + Math.imul(u[i], i + 1)) | 0; }
    return (h >>> 0).toString(36) + '.' + (h2 >>> 0).toString(36);
  }
  async function rawToPng(raw) {
    const cv = new OffscreenCanvas(raw.width, raw.height);
    const px = new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength);
    cv.getContext('2d').putImageData(new ImageData(px, raw.width, raw.height), 0, 0);
    return cv.convertToBlob({ type: 'image/png' });
  }

  // 바뀐 레이어가 있으면 새 시점을 저장한다. force: 지금 바로(사용자가 '지금 저장'을 누름)
  async function histCheck(force = false) {
    if (HS.running || S.busy || Q.stroking || S.histOn === false && !force) return false;
    if (!force && (document.hidden || Date.now() - HS.lastInput < 4000)) return false; // 그리는 중이면 다음에
    const board = boardId();
    const E = getEditor();
    if (!board || !E) return false;
    HS.running = true;
    try {
      const d = E.drawing;
      if (!d || !Array.isArray(d.layers)) return false;
      let known = HS.boards.get(board);
      if (!known) {
        known = new Map();
        const last = (await histPoints(board)).pop();
        if (last) { for (const l of last.layers) known.set(l.uid, l); HS.orders.set(board, last.layers.map((l) => l.uid).join(',')); }
        HS.boards.set(board, known);
      }
      const fullDue = force || Date.now() - HS.lastFull > HIST_FULL_EVERY;
      const now = Date.now();
      const layers = [];
      let changed = 0, fullReads = 0;
      // 정밀 확인(썸네일로 안 보이는 작은 변화)은 큰 보드에서 버벅이지 않게 한 번에 3개 레이어씩 돌아가며
      const nL = d.layers.length, rrStart = HS.rr % Math.max(1, nL);
      const fullPick = new Set();
      for (let k = 0; k < Math.min(3, nL); k++) fullPick.add((rrStart + k) % nL);
      if (fullDue && !force) HS.rr += 3;
      let li = -1;
      for (const L of d.layers) {
        li++;
        const uid = L.uid || 'id' + L.id;
        const r = L.rect;
        const empty = !r || !(r.w > 0 && r.h > 0);
        const rectKey = empty ? '0' : `${r.x},${r.y},${r.w},${r.h}`;
        const prev = known.get(uid);
        const meta = { name: String(L.name || ''), rect: empty ? null : { x: r.x, y: r.y, w: r.w, h: r.h }, visible: L.visible !== false };
        if (!empty && (!L.texture || L.unloadedImage)) { if (prev) layers.push({ ...prev, ...meta }); continue; } // 지금은 못 읽음 → 전 기록 유지
        const thumbSig = rectKey + ':' + (L.thumbData && L.thumbData.data ? hash32(L.thumbData.data) : '');
        let entry;
        if (prev && prev.rectKey === rectKey && prev.thumbSig === thumbSig && (!fullDue || (!force && !fullPick.has(li)))) entry = prev;
        else if (empty) entry = { uid, rectKey, thumbSig, hash: 'empty', key: null, size: 0 };
        else {
          if (fullReads++) await nextFrame();          // 레이어 사이에 한 프레임씩 쉬어 화면이 멈추지 않게
          const raw = E.renderer.getLayerRawData(L);  // 읽기 전용
          if (!raw || raw.width !== r.w || raw.height !== r.h) { if (prev) layers.push({ ...prev, ...meta }); continue; }
          const h = hash32(raw.data);
          if (prev && prev.hash === h && prev.rectKey === rectKey) entry = { ...prev, thumbSig };
          else {
            const blob = await rawToPng(raw);
            const key = `${board}:${uid}:${now}`;
            await reqP((await hstore('blobs', 'readwrite')).put({ key, board, size: blob.size, blob }));
            entry = { uid, rectKey, thumbSig, hash: h, key, size: blob.size };
            changed++;
          }
        }
        layers.push({ ...entry, ...meta });
      }
      if (fullDue) HS.lastFull = Date.now();
      const order = layers.map((l) => l.uid).join(',');
      for (const l of layers) known.set(l.uid, l);
      if (!changed && order === HS.orders.get(board)) return false; // 바뀐 게 없음
      HS.orders.set(board, order);
      let thumb = null;
      try {
        if (E.renderer.getDrawingSnapshotScaledBlob) thumb = await E.renderer.getDrawingSnapshotScaledBlob(d, { x: 0, y: 0, w: d.w, h: d.h }, 240, 'image/png');
      } catch { thumb = null; }
      await reqP((await hstore('points', 'readwrite')).add({ board, t: now, w: d.w, h: d.h, layers, thumb, title: document.title, changed }));
      await histPrune(board);
      return true;
    } catch (e) {
      console.warn('[MagmaWand] 작업 기록 저장 실패', e);
      return false;
    } finally {
      HS.running = false;
    }
  }
  // 오래된 시점 지우기 + 어느 시점도 쓰지 않는 그림 지우기 + 전체 용량 제한
  async function histGc(board) {
    const keep = new Set();
    for (const p of await histPoints(board)) for (const l of p.layers) if (l.key) keep.add(l.key);
    const bs = await hstore('blobs', 'readwrite');
    const keys = await reqP(bs.getAllKeys(IDBKeyRange.bound(board + ':', board + ':￿')));
    const del = await hstore('blobs', 'readwrite');
    for (const k of keys) if (!keep.has(k)) del.delete(k);
  }
  async function histPrune(board) {
    const pts = await histPoints(board);
    if (pts.length > HIST_KEEP) {
      const st = await hstore('points', 'readwrite');
      for (const p of pts.slice(0, pts.length - HIST_KEEP)) st.delete(p.id);
    }
    await histGc(board);
    // 전체 용량이 넘으면 가장 오래된 시점부터 (모든 보드)
    for (let guard = 0; guard < 50; guard++) {
      const all = await reqP((await hstore('blobs')).getAll());
      const total = all.reduce((s, b) => s + (b.size || 0), 0);
      if (total <= HIST_MAX_BYTES) break;
      const oldest = await reqP((await hstore('points')).openCursor());
      if (!oldest) break;
      const p = oldest.value;
      await reqP((await hstore('points', 'readwrite')).delete(p.id));
      await histGc(p.board);
    }
  }
  async function histUsage() {
    const all = await reqP((await hstore('blobs')).getAll());
    return all.reduce((s, b) => s + (b.size || 0), 0);
  }
  function histStart() {
    clearInterval(HS.timer);
    HS.timer = setInterval(() => { histCheck(false); }, HIST_EVERY);
    setTimeout(() => histCheck(false), 20000);
  }
  if (typeof indexedDB !== 'undefined' && typeof OffscreenCanvas !== 'undefined') histStart();
  cleanups.push(() => { clearInterval(HS.timer); try { HS.db && HS.db.close(); } catch { } });

  // 그 시점의 레이어를 보드 크기 그림으로 만들어 클립보드에 복사
  async function histCopyLayer(point, l) {
    const rec = await reqP((await hstore('blobs')).get(l.key));
    if (!rec) throw new Error('저장된 그림을 찾지 못했어요');
    const E = getEditor();
    const W = (E && E.drawing && E.drawing.w) || point.w, H = (E && E.drawing && E.drawing.h) || point.h;
    let png = rec.blob;
    if (!(l.rect && l.rect.x === 0 && l.rect.y === 0 && l.rect.w === W && l.rect.h === H)) {
      const bmp = await createImageBitmap(rec.blob);
      const cv = new OffscreenCanvas(W, H);
      cv.getContext('2d').drawImage(bmp, l.rect.x, l.rect.y);
      png = await cv.convertToBlob({ type: 'image/png' });
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }

  function fmtTime(t) {
    const d = new Date(t), now = Date.now(), s = Math.round((now - t) / 1000);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const ago = s < 60 ? '방금' : s < 3600 ? `${Math.round(s / 60)}분 전` : s < 86400 ? `${Math.round(s / 3600)}시간 전` : `${Math.round(s / 86400)}일 전`;
    const day = new Date(now).toDateString() === d.toDateString() ? '오늘' : `${d.getMonth() + 1}/${d.getDate()}`;
    return `${day} ${hm} · ${ago}`;
  }
  const fmtMB = (b) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + 'MB';

  async function openHistoryDialog() {
    document.querySelector('.mw-dialog-wrap')?.remove();
    const board = boardId();
    const wrap = document.createElement('div');
    wrap.className = 'mw-dialog-wrap mw-el';
    wrap.innerHTML = `
      <div class="mw-dialog mw-hist" role="dialog">
        <div class="mw-dialog-title">작업 기록 <span class="mw-hist-sub">내 컴퓨터에만 저장</span></div>
        <div class="mw-hist-help">몇 분마다 바뀐 레이어를 이 컴퓨터에 저장해요(다른 사람에게 보내는 건 없어요).
          되살리고 싶은 레이어의 <b>복사</b>를 누른 뒤 <b>Edit → Paste on new layer</b>를 누르면 새 레이어로 원래 자리에 들어가요.</div>
        <div class="mw-hist-list"><div class="mw-hist-empty">불러오는 중…</div></div>
        <div class="mw-hist-foot">
          <label class="mw-hist-auto"><input type="checkbox" ${S.histOn === false ? '' : 'checked'}> 자동 기록</label>
          <span class="mw-hist-usage"></span>
          <span class="mw-hist-gap"></span>
          <button type="button" class="md btn secondary mw-hist-clear">이 보드 기록 지우기</button>
          <button type="button" class="ml-2 md btn secondary mw-hist-now">지금 저장</button>
          <button type="button" class="ml-2 md btn primary mw-ok">닫기</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const urls = [];
    const close = () => { urls.forEach((u) => URL.revokeObjectURL(u)); wrap.remove(); };
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    wrap.querySelector('.mw-ok').addEventListener('click', close);
    const list = wrap.querySelector('.mw-hist-list');
    const usage = wrap.querySelector('.mw-hist-usage');
    wrap.querySelector('.mw-hist-auto input').addEventListener('change', (e) => { S.histOn = e.target.checked; saveSettings(); });
    const render = async () => {
      urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      list.innerHTML = '';
      usage.textContent = '';
      if (!board) { list.innerHTML = '<div class="mw-hist-empty">보드를 연 상태에서 쓸 수 있어요</div>'; return; }
      let pts = [];
      try { pts = (await histPoints(board)).reverse(); usage.textContent = `이 컴퓨터 사용량 ${fmtMB(await histUsage())}`; } catch (e) { list.innerHTML = '<div class="mw-hist-empty">기록을 읽지 못했어요</div>'; return; }
      if (!pts.length) { list.innerHTML = '<div class="mw-hist-empty">아직 저장된 기록이 없어요. 그림을 그리면 몇 분 안에 저장돼요(지금 저장도 돼요).</div>'; return; }
      for (const p of pts) {
        const row = document.createElement('div');
        row.className = 'mw-hist-row';
        const img = document.createElement('img');
        img.className = 'mw-hist-thumb';
        if (p.thumb) { const u = URL.createObjectURL(p.thumb); urls.push(u); img.src = u; }
        const info = document.createElement('div');
        info.className = 'mw-hist-info';
        info.innerHTML = `<div class="mw-hist-time"></div><div class="mw-hist-meta"></div>`;
        info.querySelector('.mw-hist-time').textContent = fmtTime(p.t);
        info.querySelector('.mw-hist-meta').textContent = `레이어 ${p.layers.length}개` + (p.changed ? ` · ${p.changed}개 바뀜` : '');
        const layersEl = document.createElement('div');
        layersEl.className = 'mw-hist-layers';
        row.append(img, info);
        const toggle = () => {
          if (layersEl.childElementCount) { layersEl.innerHTML = ''; layersEl.remove(); return; }
          for (const l of p.layers) {
            const lr = document.createElement('div');
            lr.className = 'mw-hist-layer';
            const name = document.createElement('span');
            name.className = 'mw-hist-lname';
            name.textContent = l.name + (l.key ? '' : ' (빈 레이어)');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sm btn secondary';
            btn.textContent = '복사';
            btn.disabled = !l.key;
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              btn.disabled = true; btn.textContent = '복사 중…';
              try {
                await histCopyLayer(p, l);
                btn.textContent = '복사됨';
                toast(`"${l.name}"(${fmtTime(p.t).split(' · ')[0]})을 복사했어요 → Edit → Paste on new layer로 붙이세요`);
              } catch (err) {
                console.warn('[MagmaWand]', err);
                btn.textContent = '복사';
                toast('복사하지 못했어요: ' + (err && err.message || err));
              } finally { btn.disabled = false; }
            });
            lr.append(name, btn);
            layersEl.appendChild(lr);
          }
          row.after(layersEl);
        };
        row.addEventListener('click', toggle);
        list.appendChild(row);
      }
    };
    wrap.querySelector('.mw-hist-now').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = '저장 중…';
      HS.lastFull = 0;
      const saved = await histCheck(true);
      b.disabled = false; b.textContent = '지금 저장';
      toast(saved ? '지금 상태를 저장했어요' : '마지막 기록과 달라진 게 없어요');
      render();
    });
    let armed = false;
    wrap.querySelector('.mw-hist-clear').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!armed) { armed = true; b.textContent = '한 번 더 누르면 지워요'; setTimeout(() => { armed = false; b.textContent = '이 보드 기록 지우기'; }, 3000); return; }
      armed = false;
      try {
        const pts = await histPoints(board);
        const st = await hstore('points', 'readwrite');
        for (const p of pts) st.delete(p.id);
        await histGc(board);
        HS.boards.delete(board); HS.orders.delete(board);
        toast('이 보드의 작업 기록을 지웠어요 (Magma 보드는 그대로예요)');
      } catch { toast('지우지 못했어요'); }
      b.textContent = '이 보드 기록 지우기';
      render();
    });
    render();
  }

  // ---------- 화면: 도구 막대 버튼 + 오른쪽 설정 칸 ----------
  const WAND_SVG = '<path fill="currentColor" d="M40 420 300 160l52 52L92 472z"/>' +
    '<path fill="currentColor" d="M400 20l28 64 64 28-64 28-28 64-28-64-64-28 64-28z"/>' +
    '<path fill="currentColor" d="M210 40l13 30 30 13-30 13-13 30-13-30-30-13 30-13zM470 250l10 23 23 10-23 10-10 23-10-23-23-10 23-10z"/>';
  // 빠른 선택: 점선 원(선택) + 붓
  const QUICK_SVG = '<path fill="none" stroke="currentColor" stroke-width="34" stroke-dasharray="58 40" d="M256 60a196 196 0 1 0 0.1 0"/>' +
    '<path fill="currentColor" d="M330 120l62 62-150 150-62-62z"/><path fill="currentColor" d="M168 300c40 0 70 30 64 66-8 46-74 76-132 64 34-20 22-56 30-84 6-28 18-46 38-46z"/>';
  const TOOL_SVG = { wand: WAND_SVG, quick: QUICK_SVG };
  const CSS = `
    html.mw-on editor-tools button.tool.on:not(.mw-tool) { background: transparent !important; border-color: transparent !important; }
    html.mw-on .editor-view, html.mw-on .editor-view * { cursor: crosshair !important; }
    .mw-hide, html.mw-on editor-sliders .tool-sliders:not(.layers-options) > :not(.mw-el):not(.selection-tool) {
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
    .mw-size-ring { position: fixed; z-index: 2147482000; pointer-events: none; border-radius: 50%; box-sizing: border-box;
      border: 1px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.75), inset 0 0 0 1px rgba(0,0,0,.75); display: none; }
    .mw-size-label { position: fixed; z-index: 2147482001; pointer-events: none; display: none; background: rgba(20,20,22,.85);
      color: #fff; font: 12px/1.3 system-ui, 'Malgun Gothic', sans-serif; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
    .mw-hist { width: min(640px, 94vw); }
    .mw-hist-sub { font-size: 12px; font-weight: 400; color: #9a9a9a; margin-left: 6px; }
    .mw-hist-help { font-size: 12.5px; color: #c8c8c8; margin: -4px 0 12px; }
    .mw-hist-list { max-height: 52vh; overflow-y: auto; border: 1px solid #3a3a3a; border-radius: 4px; background: #1b1b1b; }
    .mw-hist-empty { padding: 18px; color: #9a9a9a; font-size: 13px; }
    .mw-hist-row { display: flex; align-items: center; gap: 12px; padding: 8px 10px; cursor: pointer; border-bottom: 1px solid #2c2c2c; }
    .mw-hist-row:hover { background: #2a2a2a; }
    .mw-hist-thumb { width: 72px; height: 54px; object-fit: contain; background: #0e0e0e; border-radius: 3px; flex: none; }
    .mw-hist-time { font-size: 13.5px; }
    .mw-hist-meta { font-size: 12px; color: #9a9a9a; }
    .mw-hist-layers { background: #151515; border-bottom: 1px solid #2c2c2c; padding: 4px 10px 6px 94px; }
    .mw-hist-layer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 3px 0; font-size: 13px; }
    .mw-hist-lname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mw-hist-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 12px; font-size: 12.5px; }
    .mw-hist-gap { flex: 1; }
    .mw-hist-usage { color: #9a9a9a; }
    .mw-hist-auto { display: flex; align-items: center; gap: 5px; cursor: pointer; }
    .mw-slider .slider { cursor: pointer; }
    .mw-slider editable-number button { cursor: text; }
    /* 도구 묶음: 오른쪽 아래 작은 삼각형 = 펼칠 수 있는 묶음 */
    button.mw-tool { position: relative; }
    button.mw-tool::after { content: ''; position: absolute; right: 2px; bottom: 2px; width: 0; height: 0;
      border-left: 5px solid transparent; border-bottom: 5px solid currentColor; opacity: .75; pointer-events: none; }
    .mw-flyout { position: fixed; z-index: 2147482000; display: flex; gap: 2px; padding: 3px;
      border-radius: 5px; box-shadow: 0 4px 16px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.08);
      animation: mwFly .14s ease-out; }
    @keyframes mwFly { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
    .mw-overlay { position: fixed; z-index: 2147481000; pointer-events: none; image-rendering: pixelated; display: none; }
    .mw-brush { position: fixed; z-index: 2147481500; pointer-events: none; border-radius: 50%; display: none;
      border: 1px solid rgba(255,255,255,.95); box-shadow: 0 0 0 1px rgba(0,0,0,.7), inset 0 0 0 1px rgba(0,0,0,.35); }
    html.mw-on.mw-quick .editor-view, html.mw-on.mw-quick .editor-view * { cursor: none !important; }
  `;
  let styleEl = null, toolBtn = null, titleEl = null, rowsEl = null, statusEl = null;
  let lastStatus = '';

  function status(msg) {
    lastStatus = msg;
    if (statusEl) statusEl.textContent = msg;
    console.log('[MagmaWand]', msg);
  }
  const hint = () => S.tool === 'quick'
    ? '문지르기: 선택(선택이 있으면 추가) · Alt: 빼기 · [ ]: 브러시 크기'
    : S.action === 'fill' ? '클릭한 영역을 지금 색으로 채워요' : '클릭: 선택 · Shift: 추가 · Alt: 빼기';

  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return;
    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
  }

  // 도구 묶음 버튼 (마지막으로 쓴 도구 아이콘이 보임). 누르면 그 도구를 켜고 오른쪽에 묶인 도구 상자를 펼친다
  function setIcon(btn, tool) {
    const svg = btn.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('class', `svg-icon fa-fw icon-mw-${tool}`);
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.innerHTML = TOOL_SVG[tool];
  }
  function ensureToolButton() {
    const ref = toolButtons().find((b) => toolName(b) === 'lassoSelectionIcon');
    if (!ref) return;
    if (!toolBtn) {
      toolBtn = ref.cloneNode(true);
      toolBtn.removeAttribute('id');
      toolBtn.classList.add('mw-tool');
      toolBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const wasOpen = !!(flyEl && flyEl.isConnected);
        setActive(true, S.tool);
        if (wasOpen) closeFlyout(); else openFlyout();
      });
    }
    if (toolBtn.previousElementSibling !== ref) ref.after(toolBtn);
    syncToolButton();
  }
  function syncToolButton() {
    if (!toolBtn) return;
    if (toolBtn.dataset.tool !== S.tool) { setIcon(toolBtn, S.tool); toolBtn.dataset.tool = S.tool; syncTooltip(); }
    toolBtn.classList.toggle('on', S.active);
    toolBtn.classList.toggle('active', S.active);
    toolBtn.classList.toggle('off', !S.active);
    if (flyEl && flyEl.isConnected) {
      for (const b of flyEl.querySelectorAll('button')) {
        const onNow = S.active && b.dataset.tool === S.tool;
        b.classList.toggle('on', onNow); b.classList.toggle('active', onNow); b.classList.toggle('off', !onNow);
      }
    }
  }

  // 펼침 상자: 도구 막대 오른쪽에 뜨는 작은 가로 상자 (도구 막대와 같은 버튼 모양)
  let flyEl = null;
  function openFlyout() {
    closeFlyout();
    if (!toolBtn) return;
    const r = toolBtn.getBoundingClientRect();
    const bar = document.querySelector('editor-tools');
    let bg = '';
    for (let el = bar; el && !bg; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) bg = c; }
    flyEl = document.createElement('div');
    flyEl.className = 'mw-flyout mw-el';
    flyEl.style.background = bg || '#2a2a2a';
    for (const tool of ['wand', 'quick']) {
      const b = toolBtn.cloneNode(true);
      b.classList.remove('mw-tool');
      b.classList.add('mw-fly-btn');
      b.dataset.tool = tool;
      setIcon(b, tool);
      const k = S[TOOL_KEYS[tool]];
      b.title = TOOL_LABEL[tool] + (k.length ? ` (${k.map(comboText).join(', ')})` : '');
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeFlyout(); setActive(true, tool); });
      flyEl.appendChild(b);
    }
    document.body.appendChild(flyEl);
    const barR = (bar || toolBtn).getBoundingClientRect();
    flyEl.style.left = (Math.max(r.right, barR.right) + 4) + 'px';
    flyEl.style.top = (r.top - 3) + 'px';
    syncToolButton();
  }
  function closeFlyout() { flyEl?.remove(); flyEl = null; }
  on(window, 'pointerdown', (e) => {
    if (!flyEl || !e.isTrusted) return;
    if (e.target.closest && (e.target.closest('.mw-flyout') || e.target.closest('.mw-tool'))) return;
    closeFlyout();
  }, true);
  on(window, 'keydown', (e) => { if (flyEl && e.code === 'Escape') closeFlyout(); }, true);

  // 선택 도구 설정 칸의 Magma 요소를 본떠(복제해) 같은 모양의 줄을 만든다
  function buildSettings(sel) {
    const tplName = sel.querySelector(':scope > .tool-name');
    const tplSeg = sel.querySelector('.selection-buttons-2');
    const tplSlider = [...sel.querySelectorAll('.tool-slider')].find((r) => r.querySelector('.slider-label'));
    if (!tplName || !tplSeg || !tplSlider) return false;

    titleEl = tplName.cloneNode(true);
    titleEl.classList.add('mw-el', 'mw-title');
    titleEl.classList.remove('mw-hide');
    titleEl.textContent = TOOL_LABEL[S.tool];
    titleEl.dataset.tool = S.tool;

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
      syncers.push(render);
      return row;
    };

    const syncers = [];
    statusEl = document.createElement('div');
    statusEl.className = 'mw-status';
    statusEl.textContent = lastStatus || hint();
    if (S.tool === 'quick') {
      rowsEl.append(
        segRow('참조', 'qref', [['all', '모든 레이어'], ['layer', '현재 레이어']]),
        sliderRow('브러시 크기', 'brush', 1, 200),
        sliderRow('허용 오차', 'qtol', 0, 100),
        sliderRow('영역 확장', 'qexpand', 0, 10),
        statusEl,
      );
    } else {
      rowsEl.append(
        segRow('동작', 'action', [['select', '선택'], ['fill', '채우기']]),
        segRow('참조', 'ref', [['all', '모든 레이어'], ['layer', '현재 레이어']]),
        segRow('범위', 'contig', [[true, '이어진 곳만'], [false, '전체 같은 색']]),
        sliderRow('허용 오차', 'tol', 0, 100),
        sliderRow('영역 확장', 'expand', 0, 10),
        statusEl,
      );
    }
    rowsEl.__mwSync = () => syncers.forEach((f) => f());
    // 설정 칸 안의 키 입력·휠이 Magma 단축키로 새지 않도록
    for (const t of ['keydown', 'keyup']) rowsEl.addEventListener(t, (e) => e.stopPropagation());
    return true;
  }

  function ensureSettings() {
    if (!S.active) return;
    const ts = toolSliders();
    if (!ts) return;
    const sel = ts.querySelector(':scope > .selection-tool');
    if (rowsEl && titleEl && titleEl.dataset.tool !== S.tool) removeSettings(); // 묶음 안에서 도구를 바꿨으면 다시 만든다
    if (!rowsEl && (!sel || !buildSettings(sel))) return;
    if (sel) {
      // Magma 선택 도구의 제목·손떨림 보정·채팅 보내기 줄은 숨긴다 (마법봉에는 필요 없음)
      sel.querySelector(':scope > .tool-name')?.classList.add('mw-hide');
      for (const r of sel.querySelectorAll(':scope > *')) {
        if (r.classList.contains('mw-el')) continue;
        const label = r.querySelector('.slider-label')?.textContent.trim();
        if (label === 'Stabilizer' || /Send to chat|Set as My Avatar/i.test(r.textContent)) r.classList.add('mw-hide');
      }
      // 안티에일리어스는 마법봉이 알아서 끄고 켜므로 숨긴다 (마법봉은 항상 픽셀 단위로 정확하게)
      aaButton()?.closest('custom-checkbox')?.classList.add('mw-hide');
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

  async function setActive(onNow, tool) {
    if (onNow && tool && tool !== S.tool) {
      if (Q.stroking) return; // 문지르는 도중에는 도구를 바꾸지 않음
      S.tool = tool; saveSettings();
      lastStatus = '';
      if (S.active) { removeSettings(); lastStatus = hint(); }
    }
    document.documentElement.classList.toggle('mw-quick', S.tool === 'quick');
    if (S.tool !== 'quick') qCursor(0, 0, false);
    if (onNow === S.active) { syncToolButton(); if (onNow) ensureSettings(); return; }
    S.active = onNow;
    document.documentElement.classList.toggle('mw-on', onNow);
    syncToolButton();
    if (!onNow) { closeFlyout(); qCursor(0, 0, false); if (Q.stroking) qFinish(getCanvas(), true); }
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
    } else if (pendingLasso() && !switchingTo && currentTool() === 'lassoSelectionIcon') {
      // 되돌리지 못한 손떨림 보정(단축키로 도구를 바꿨거나 창을 닫았던 경우)을 올가미 선택이 보일 때 되돌림
      restoreLassoStab();
    }
  }, 400);

  // 새 버전이 들어올 때 이 버전을 깨끗이 걷어낸다
  window.__magmaWand.destroy = () => {
    clearInterval(tick);
    clearTimeout(stabTimer); // 되돌릴 설정은 localStorage에 남아 있어 새 버전이 이어서 되돌린다
    BSZ.el?.remove(); BSZ.label?.remove(); BSZ.on = false;
    for (const f of cleanups.splice(0)) { try { f(); } catch { /* 무시 */ } }
    removeSettings();
    document.querySelectorAll('.mw-menu, .mw-toast, .mw-dialog-wrap, .mw-shortcut, .mw-flyout, .mw-overlay, .mw-brush').forEach((e) => e.remove());
    document.documentElement.classList.remove('mw-quick');
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
    edtSq, growShrinkMask, maskToSinglePolygon, viewTransform, copyMergedSelection, growShrinkSelection, openGrowDialog,
    getEditor, ensureEditor, docContext, docImage, exactPath, withSpikes, magmaKeep, rasterPath, straightLoop,
    histCheck, histPoints, histCopyLayer, openHistoryDialog, histUsage, getBrushSize, sizeRow, getAA, setAA, docToBuffer, selectionExists };
  window.__magmaWand.ready = true; // 끝까지 시작됨 (실행기는 이 표시가 없으면 다시 넣는다)
})();
