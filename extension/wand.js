// Magma Extension
// Magma 페이지 안에서 직접 실행되는 스크립트. 크롬 확장과 데스크톱 앱 실행기가 같은 파일을 쓴다.
// 동작: 보드의 실제 그림 픽셀(Magma 내부 읽기 전용 함수, 못 쓰면 화면)을 읽어 클릭한 곳과 비슷한 색의 영역을 계산하고,
//       그 테두리를 픽셀 그대로 따라 Magma 자체 올가미(선택 / 올가미 채우기)를 한 번 대신 그어 준다.
// 화면: 왼쪽 도구 막대에 마법봉 버튼, 오른쪽 도구 설정 칸에 설정 (Magma 선택 도구 설정과 함께 표시)
// 새 버전이 같은 페이지에 다시 들어오면 옛 버전을 걷어내고 그 자리를 대신한다(새로고침 없이 업데이트).
(() => {
  'use strict';
  const VERSION = '0.28.2';
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
  // ----- 언어: Magma 계정 언어가 영어면 확장 문구도 영어로 (한국어가 기본) -----
  let LANG = null, LANG_AT = 0;
  // 확장 언어: Window 메뉴에서 고른 값(magmaWand.settings의 lang: 'ko'|'en'), 없으면(자동) Magma 계정 언어를 따른다.
  // Magma는 계정 언어를 <html lang>에 넣는다(한국어 = ko-KR, 영어 = en). 한국어가 아니면 영어로.
  function detectLang() {
    try { const o = JSON.parse(localStorage.getItem('magmaWand.settings') || '{}').lang; if (o === 'ko' || o === 'en') return o; } catch { /* 무시 */ }
    const v = document.documentElement.getAttribute('lang') || '';
    if (v) return /^ko/i.test(v) ? 'ko' : 'en';
    return 'ko';
  }
  const LANG_EN = () => { const t = Date.now(); if (!LANG || t - LANG_AT > 3000) { LANG = detectLang(); LANG_AT = t; } return LANG === 'en'; };
  const L = (ko, en) => (LANG_EN() ? en : ko);
  let destroyed = false; // 새 버전으로 바뀐 뒤에는 화면 요소를 다시 만들지 않음
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
    tool: 'wand', brush: 20, qtol: 12, qexpand: 1, qref: 'all', qkeys: ['Shift+KeyW'],
    bkeys: ['Shift+KeyB'], akeys: ['KeyC'], advBrushId: null, advOpacity: 100, advSize: 10,
    blurSize: 40, blurStrength: 6, blurDensity: 50, koAuto: true, koFont: 'Paperlogy', groupLast: {},
    gap: 0, qmSize: 30, qmMode: 'add', fillGrow: 0, lkeys: [], mkeys: ['KeyQ'] };
  const S = Object.assign({}, DEFAULTS, loadSettings(), { active: false, busy: false, switching: false });
  if (!['select', 'fill'].includes(S.action)) S.action = 'select';
  if (!['all', 'layer'].includes(S.ref)) S.ref = 'all';
  if (!['all', 'layer'].includes(S.qref)) S.qref = 'all';
  if (!['wand', 'quick', 'brush', 'blur', 'qmask'].includes(S.tool)) S.tool = 'wand';
  if (!['add', 'sub'].includes(S.qmMode)) S.qmMode = 'add';
  if (!Number.isFinite(S.fillGrow)) S.fillGrow = 0;
  if (!Array.isArray(S.lkeys)) S.lkeys = DEFAULTS.lkeys.slice();
  if (!Array.isArray(S.mkeys)) S.mkeys = DEFAULTS.mkeys.slice();
  if (!Array.isArray(S.bkeys)) S.bkeys = DEFAULTS.bkeys.slice();
  if (!Array.isArray(S.akeys)) S.akeys = DEFAULTS.akeys.slice();
  S.alpha = false; // 투명색은 켤 때마다 새로 (저장하지 않음)
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
      const { tol, expand, action, ref, keys, contig, histOn, growPx, tool, brush, qtol, qexpand, qref, qkeys, bkeys, akeys, advBrushId, advOpacity, blurSize, blurStrength, blurDensity, koAuto, koFont, groupLast, txtFont, txtSize, gap, qmSize, qmMode, fillGrow, lkeys, mkeys, lang } = S;
      localStorage.setItem('magmaWand.settings',
        JSON.stringify({ tol, expand, action, ref, keys, contig, histOn, growPx, tool, brush, qtol, qexpand, qref, qkeys, bkeys, akeys, advBrushId, advOpacity, blurSize, blurStrength, blurDensity, koAuto, koFont, groupLast, txtFont, txtSize, gap, qmSize, qmMode, fillGrow, lkeys, mkeys, lang }));
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
    // 도구를 막 바꿨으면 설정 칸이 늦게 나올 수 있다 → 안티에일리어스가 아직 켜져 있으면 칸을 기다렸다가 한 번 더
    if (getAA() !== false) {
      await waitFor(() => aaButton(), 800);
      if (lassoAASaved === null && getAA() === true) { lassoAASaved = true; try { localStorage.setItem(PENDING_AA, '1'); } catch { } }
      if (getAA() === true) await setAA(false);
    }
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

  // 편집기를 잡느라 도구가 바뀌었으면 원래 도구로 되돌린다 (마법봉 도구 밖에서 쓸 때)
  async function editorKeepTool() {
    const t = currentTool(), sw = S.switching;
    S.switching = true;
    try { const E = await ensureEditor(); if (t && currentTool() !== t) await selectTool(t); return E; } finally { S.switching = sw; }
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
    let ff = null;
    if (S.gap > 0 && S.contig) { ff = gapBridgeFill(img, dx, dy, S.tol, 2 * S.gap); if (!ff) T.gapSkip = true; }
    const { mask, count } = ff || floodFill(img, dx, dy, S.tol, null, true, S.contig);
    if (S.expand > 0) dilate(mask, img.w, img.h, S.expand);
    mark('filled');
    const P = exactPath(mask, img.w, img.h, D.spike, { pixelOnly: fill });
    if (!P) return { error: '영역을 만들지 못했어요' };
    T.doc = true; T.loops = P.loops; T.points = P.pts.length; T.pathMode = P.mode;
    if (P.dropped) T.dropped = P.dropped;
    const note = (P.dropped ? ` · 작은 조각 ${P.dropped}개는 점이 너무 많아 뺐어요` : (P.simplified ? ' · 테두리가 복잡해 조금 매끈하게 그었어요' : '')) +
      (T.gapSkip ? ' · 선 위를 눌러 빈틈 닫기 없이 했어요' : '');
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
        const wantMode = S.alpha ? 'erase' : 'draw'; // 투명색이면 그 영역을 지운다
        await setBrushMode(wantMode);          // 반대 모드로 남아 있으면 칠 대신 지워짐(또는 그 반대)
        prevAutoErase = getAutoErase();
        if (prevAutoErase) await setAutoErase(false);
        // 안전 확인: 원하는 모드이고 자동 지우기가 꺼졌는지 확인되지 않으면 절대 긋지 않는다
        if (getBrushMode() !== wantMode || getAutoErase() === true) {
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
        const gref0 = guRef();
        if (plan.mode !== prevSelMode) wantMode = plan.mode; // finally에서 원래 모드로 되돌림
        await drawSelectionPlan(canvas, plan);
        if (plan.deselectFirst) { await nextFrame(); guAdd(gref0, '마법봉 선택'); }
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
    if (SIZE_TOOLS.has(t) && BSZ.pending == null && !BSZ.applying) { const v = getBrushSize(); if (v) BSZ.lastSize = v; }
  };
  on(window, 'keydown', (e) => {
    if (!e.isTrusted || e.repeat) return;
    if ((e.key === 'Alt' && !e.ctrlKey) || (e.key === 'Control' && !e.altKey)) rememberTool(true);
  }, true);
  on(window, 'pointermove', (e) => { if (e.isTrusted && !e.altKey && !e.ctrlKey && !BSZ.on) rememberTool(); }, { capture: true, passive: true });
  function sizeGestureTarget() {
    if (S.busy) return null;
    if (S.active) return S.tool === 'quick' ? 'quick' : S.tool === 'brush' && ADV.brush ? 'adv' : S.tool === 'blur' ? 'blur' : S.tool === 'qmask' ? 'qmask' : null;
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
  // 마법봉이 만든 브러시 도구의 크기(지름, 보드 픽셀): 블러·퀵 마스크
  const OWN_SIZE = {
    blur: { get: () => S.blurSize, set: (v) => { S.blurSize = v; }, max: 500, cursor: (x, y) => blurCursor(x, y, true) },
    qmask: { get: () => S.qmSize, set: (v) => { S.qmSize = v; }, max: 1000, cursor: (x, y) => qmCursor(x, y, true) },
  };
  function sizeRender(mx, my) {
    const r = Math.hypot(mx - BSZ.ox, my - BSZ.oy);
    const own = OWN_SIZE[BSZ.kind];
    BSZ.size = BSZ.quick ? Math.min(500, Math.max(1, Math.round(r / BSZ.zoom)))
      : BSZ.adv ? Math.min(3000, Math.max(0.5, Math.round((20 * r) / BSZ.zoom) / 10))
      : own ? Math.min(own.max, Math.max(1, Math.round((2 * r) / BSZ.zoom))) : roundSize((2 * r) / BSZ.zoom);
    const rr = BSZ.quick ? BSZ.size * BSZ.zoom : (BSZ.size / 2) * BSZ.zoom;
    Object.assign(BSZ.el.style, { left: (BSZ.ox - rr) + 'px', top: (BSZ.oy - rr) + 'px', width: 2 * rr + 'px', height: 2 * rr + 'px' });
    BSZ.label.textContent = BSZ.quick || BSZ.adv || own ? `브러시 크기 ${BSZ.size}` : `Size ${BSZ.size}`;
    Object.assign(BSZ.label.style, { left: mx + 14 + 'px', top: my + 14 + 'px' });
  }
  function sizeStart(e, kind) {
    const zoom = viewZoom();
    // Magma 브러시: 아직 크기 칸에 못 넣은 값(BSZ.pending)이 있으면 그 값에서 이어서 (빠르게 반복해도 옛 크기로 안 돌아가게)
    const cur = kind === 'quick' ? S.brush : kind === 'adv' ? ADV.brush.size : OWN_SIZE[kind] ? OWN_SIZE[kind].get() : (BSZ.pending ?? (SIZE_TOOLS.has(currentTool()) && getBrushSize()) ?? BSZ.lastSize) || BSZ.lastSize;
    if (!(cur > 0)) return false;
    const rScreen = kind === 'quick' ? cur * zoom : (cur / 2) * zoom;
    const [dx, dy] = loadSizeDir();
    const L = Math.hypot(dx, dy) || 1;
    Object.assign(BSZ, { on: true, kind, quick: kind === 'quick', adv: kind === 'adv', zoom, pid: e.pointerId,
      ox: e.clientX - (dx / L) * rScreen, oy: e.clientY - (dy / L) * rScreen });
    if (!BSZ.el) {
      BSZ.el = document.createElement('div'); BSZ.el.className = 'mw-size-ring mw-el';
      BSZ.label = document.createElement('div'); BSZ.label.className = 'mw-size-label mw-el';
    }
    document.body.append(BSZ.el, BSZ.label);
    BSZ.el.style.display = BSZ.label.style.display = 'block';
    if (kind !== 'brush') qCursor(0, 0, false);
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
    if (BSZ.adv) {
      if (ADV.brush) { ADV.brush.size = BSZ.size; S.advSize = BSZ.size; advSaveSoon(); rowsEl?.__mwSync?.(); }
      advCursor(e.clientX, e.clientY, true);
      return;
    }
    const own = OWN_SIZE[BSZ.kind];
    if (own) { own.set(BSZ.size); saveSettings(); rowsEl?.__mwSync?.(); own.cursor(e.clientX, e.clientY); return; }
    // 넣을 값을 기억해 두고, Alt를 떼서 원래 도구(크기 칸)가 돌아오면 가장 마지막 값 하나만 넣는다.
    // Ctrl+Alt를 누른 채 여러 번 끌어도 기다리는 동안 값만 바뀌고, 칸이 돌아오면 그때 한 번 넣는다.
    BSZ.pending = BSZ.size; BSZ.lastSize = BSZ.size;
    if (BSZ.applying) return;
    BSZ.applying = (async () => {
      try {
        while (BSZ.pending != null) {
          await waitFor(() => SIZE_TOOLS.has(currentTool()) && sizeRow() && !BSZ.on, 120000);
          const want = BSZ.pending;
          if (want == null || !sizeRow() || !SIZE_TOOLS.has(currentTool())) { BSZ.pending = null; break; } // 다른 도구로 갔음
          if (getBrushSize() !== want) { await setRowNumber(sizeRow(), want); await waitFor(() => getBrushSize() === want, 600); }
          if (BSZ.pending === want) BSZ.pending = null;
        }
      } catch (err) { console.warn('[MagmaWand] 브러시 크기 바꾸기 실패', err); BSZ.pending = null; }
      finally { BSZ.applying = null; }
    })();
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
  // 색을 쓰는 마법봉 도구(고급 브러시, 마법봉 '채우기')에서도 Alt를 누른 채 누르면 스포이트 (Magma 브러시와 같게)
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click']) on(window, t, (e) => onOwnEye(e), true);
  // Ctrl+Shift 클릭 레이어 찾기도 마법봉 입력보다 먼저 (본문은 아래 '레이어 찾기')
  for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click']) on(window, t, (e) => onPick(e), true);
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) on(window, t, (e) => onThumb(e), true);
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) on(window, t, (e) => onMsRow(e), true);
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) on(window, t, (e) => onClipClick(e), true);
  on(window, 'blur', () => { if (BSZ.on) sizeEnd({ clientX: BSZ.ox, clientY: BSZ.oy }, true); });

  // ---------- 고급 브러시 ① 클립 스튜디오 브러시(.sut) 읽기 ----------
  // .sut = SQLite 파일. Variant 표 한 줄에 브러시 설정(크기·간격·필압 곡선·끝 모양·텍스처·스프레이…)이 평범하게 들어 있다.
  // 끝 모양·텍스처 이미지(MaterialFile)는 tar 안의 C2F 묶음에 PNG로 들어 있는데, ASSETS 소재는 보호(암호화·바이트 섞기)돼
  // 있어 풀지 않는다 → 온전한 PNG만 쓰고, 나머지는 사용자가 CSP에서 직접 저장한 PNG를 넣게 한다.
  function sqliteTables(u8) {
    if (new TextDecoder().decode(u8.subarray(0, 15)) !== 'SQLite format 3') throw new Error('클립 스튜디오 브러시(.sut) 파일이 아니에요');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let ps = dv.getUint16(16); if (ps === 1) ps = 65536;
    const U = ps - u8[20];
    const enc = dv.getUint32(56);
    const td = new TextDecoder(enc === 2 ? 'utf-16le' : enc === 3 ? 'utf-16be' : 'utf-8');
    const base = (n) => (n - 1) * ps;
    const vi = (b, p) => { let v = 0; for (let i = 0; i < 8; i++) { const c = b[p + i]; v = v * 128 + (c & 127); if (!(c & 128)) return [v, p + i + 1]; } return [v * 256 + b[p + 8], p + 9]; };
    const payload = (p, P) => {
      const X = U - 35;
      if (P <= X) return u8.subarray(p, p + P);
      const M = Math.floor(((U - 12) * 32) / 255) - 23;
      let K = M + ((P - M) % (U - 4)); if (K > X) K = M;
      const out = new Uint8Array(P); out.set(u8.subarray(p, p + K), 0);
      let off = K, ov = dv.getUint32(p + K), guard = 0;
      while (off < P && ov && guard++ < 1e6) {
        const b = base(ov), n = Math.min(U - 4, P - off);
        out.set(u8.subarray(b + 4, b + 4 + n), off); off += n; ov = dv.getUint32(b);
      }
      return out;
    };
    const record = (b) => {
      let [hs, p] = vi(b, 0); const types = [];
      while (p < hs) { const r = vi(b, p); types.push(r[0]); p = r[1]; }
      const bd = new DataView(b.buffer, b.byteOffset, b.byteLength); let q = hs; const vals = [];
      for (const t of types) {
        if (t === 0) vals.push(null);
        else if (t >= 1 && t <= 6) { const n = [0, 1, 2, 3, 4, 6, 8][t]; let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[q + i]; if (b[q] & 0x80) v -= Math.pow(2, 8 * n); vals.push(v); q += n; }
        else if (t === 7) { vals.push(bd.getFloat64(q)); q += 8; }
        else if (t === 8 || t === 9) vals.push(t - 8);
        else if (t >= 12 && !(t & 1)) { const n = (t - 12) / 2; vals.push(b.slice(q, q + n)); q += n; }
        else if (t >= 13) { const n = (t - 13) / 2; vals.push(td.decode(b.subarray(q, q + n))); q += n; }
        else vals.push(null);
      }
      return vals;
    };
    const walk = (pg, cb, depth = 0) => {
      if (depth > 40) return;
      const b = base(pg) + (pg === 1 ? 100 : 0), type = u8[b], n = dv.getUint16(b + 3), hdr = type === 5 || type === 2 ? 12 : 8;
      for (let i = 0; i < n; i++) {
        const cp = base(pg) + dv.getUint16(b + hdr + i * 2);
        if (type === 13) { const [P, p] = vi(u8, cp); const [rowid, p2] = vi(u8, p); cb(rowid, record(payload(p2, P))); }
        else if (type === 5) walk(dv.getUint32(cp), cb, depth + 1);
      }
      if (type === 5) walk(dv.getUint32(b + 8), cb, depth + 1);
    };
    const master = [];
    walk(1, (_, r) => master.push(r));
    const tables = {};
    for (const [type, name, , root, sql] of master) {
      if (type !== 'table' || !sql) continue;
      const inner = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
      const parts = []; let depth = 0, cur = '';
      for (const ch of inner) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
      parts.push(cur);
      const cols = parts.map((s) => s.trim()).filter((s) => s && !/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(s))
        .map((s) => ({ name: s.split(/\s+/)[0].replace(/["`[\]]/g, ''), ipk: /INTEGER\s+PRIMARY\s+KEY/i.test(s) }));
      tables[name] = { read: () => { const rows = []; walk(root, (rowid, vals) => { const o = {}; cols.forEach((c, i) => { o[c.name] = c.ipk && vals[i] == null ? rowid : vals[i]; }); rows.push(o); }); return rows; } };
    }
    return tables;
  }
  function untar(u8) {
    const out = {}; let p = 0;
    const cstr = (b) => { let e = b.indexOf(0); if (e < 0) e = b.length; return new TextDecoder().decode(b.subarray(0, e)); };
    while (p + 512 <= u8.length) {
      const name = cstr(u8.subarray(p, p + 100)); if (!name) break;
      const size = parseInt(cstr(u8.subarray(p + 124, p + 136)).trim() || '0', 8) || 0;
      out[name] = u8.subarray(p + 512, p + 512 + size);
      p += 512 + Math.ceil(size / 512) * 512;
    }
    return out;
  }
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b, s, e) => { let c = 0xffffffff; for (let i = s; i < e; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  // C2F 묶음에서 온전한(조각 CRC가 모두 맞는) PNG만 꺼낸다. 보호돼 깨진 것은 null
  function c2fPng(u8) {
    if (!(u8[0] === 0x89 && u8[1] === 0x43 && u8[2] === 0x32 && u8[3] === 0x46)) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const parts = []; let q = 8;
    while (q + 8 <= u8.length) {
      const ln = dv.getUint32(q, true), t = String.fromCharCode(u8[q + 4], u8[q + 5], u8[q + 6], u8[q + 7]);
      if (t === 'dATA' && u8[q + 8] === 0 && u8[q + 9] === 0) parts.push(u8.subarray(q + 8, q + 8 + ln)); // 01 00 으로 시작하는 조각은 암호화 → 건너뜀
      q += 12 + ln; if (t === 'TAIL') break;
    }
    for (const d of parts) {
      for (let s = 0; s + 8 < d.length; s++) {
        if (!(d[s] === 0x89 && d[s + 1] === 0x50 && d[s + 2] === 0x4e && d[s + 3] === 0x47)) continue;
        const dd = new DataView(d.buffer, d.byteOffset, d.byteLength);
        let p = s + 8, ok = true;
        while (p + 12 <= d.length) {
          const ln = dd.getUint32(p), t = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]);
          if (p + 12 + ln > d.length || crc32(d, p + 4, p + 8 + ln) !== dd.getUint32(p + 8 + ln)) { ok = false; break; }
          p += 12 + ln;
          if (t === 'IEND') return d.slice(s, p);
        }
        if (!ok) return null;
      }
    }
    return null;
  }
  // 필압·속도·무작위 효과 (빅엔디언 정수 배열 + 곡선 [점 개수, (x,y) 실수 쌍])
  function parseEffector(b) {
    if (!b || b.length < 44) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), w = (i) => dv.getUint32(i * 4);
    const mask = w(2);
    const curve = (off) => {
      if (!off || off + 12 > b.length) return null;
      const n = dv.getUint32(off + 4), st = dv.getUint32(off + 8) || 16, pts = [];
      for (let i = 0; i < n && off + 12 + i * st + 16 <= b.length; i++) pts.push([dv.getFloat64(off + 12 + i * st), dv.getFloat64(off + 20 + i * st)]);
      return pts.length >= 2 ? pts.sort((a, c) => a[0] - c[0]) : null;
    };
    // 곡선 묶음은 머리 길이(w(0)) 바로 뒤부터 차례로: 첫째 = 필압 곡선(길이 w(8)), 둘째 = 속도 곡선(길이 w(9)).
    // 머리 길이는 예전 파일 44, 새 클립 스튜디오 파일 48 — 44로 고정해 읽으면 4바이트 어긋나 곡선이 엉망이 된다(실측)
    const base = w(0) >= 40 && w(0) <= 256 && w(0) % 4 === 0 ? w(0) : 44;
    const c1 = w(8) ? curve(base) : null, c2 = w(9) ? curve(base + w(8)) : null;
    const e = {};
    if (mask & 0x10) e.pressure = { min: w(3) / 100, curve: c1 };
    if (mask & 0x40) e.velocity = { min: w(5) / 100, curve: c2 };
    if (mask & 0x80) e.random = { min: w(6) / 100 };
    return Object.keys(e).length ? e : null;
  }
  // 곡선이 0~1 밖이거나 이상한 수(예전 버전이 잘못 읽은 곡선)면 쓰지 않고 곧은 곡선으로
  const curveOk = (pts) => Array.isArray(pts) && pts.length >= 2 && pts.every((p) => Array.isArray(p) && p.every((v) => Number.isFinite(v) && v >= -0.001 && v <= 1.001 && (v === 0 || Math.abs(v) > 1e-200)));
  const evalCurve = (pts, x) => {
    if (!pts || !curveOk(pts)) return x;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1); }
    return pts[pts.length - 1][1];
  };
  // 효과 값(0~1): 필압·속도는 곡선을 거쳐 최소값~1, 무작위는 최소값~1 사이
  function effectorValue(e, pr, speed, rnd) {
    if (!e) return 1;
    let v = 1;
    if (e.pressure) v *= e.pressure.min + (1 - e.pressure.min) * Math.max(0, Math.min(1, evalCurve(e.pressure.curve, pr)));
    // 속도 곡선도 필압처럼 '출력 = 크기 비율'(클립 스튜디오: 곡선이 없으면 빠를수록 작아지는 기본값). 화면 20px/ms(아주 빠른 휘두름)에서 끝.
    if (e.velocity) { const t = Math.min(1, speed / 20), c = e.velocity.curve ? evalCurve(e.velocity.curve, t) : 1 - t; v *= e.velocity.min + (1 - e.velocity.min) * Math.max(0, Math.min(1, c)); }
    if (e.random) v *= e.random.min + (1 - e.random.min) * rnd;
    return v;
  }
  // 소재 이름표 블롭(UTF-16LE 문자열들) 안의 소재 고유번호들
  const blobStrings = (b) => {
    if (!b || !b.length) return [];
    const s = new TextDecoder('utf-16le').decode(b.subarray(b.length & 1 ? 1 : 0));
    return (s.match(/[0-9a-f]{6,}-[0-9a-f-]{8,}/gi) || []);
  };
  async function parseSut(buf, fileName) {
    const T = sqliteTables(new Uint8Array(buf));
    if (!T.Variant) throw new Error('브러시 설정을 찾지 못했어요');
    const node = T.Node ? T.Node.read().find((n) => n.NodeVariantID != null) : null;
    const vars = T.Variant.read();
    const v = (node && vars.find((r) => r.VariantID === node.NodeVariantID)) || vars[0];
    const mats = T.MaterialFile ? T.MaterialFile.read() : [];
    const materials = [];
    for (const m of mats) {
      const fd = m.FileData instanceof Uint8Array ? m.FileData : null;
      let png = null, thumb = null;
      if (fd) {
        const files = untar(fd);
        for (const [n, data] of Object.entries(files)) {
          if (/\.layer$/i.test(n) && !png) png = c2fPng(data);
          if (/thumbnail\.png$/i.test(n)) thumb = data.slice();
        }
      }
      const uuid = (String(m.OriginalPath || m.CatalogPath || '').match(/[0-9a-f]{6,}-[0-9a-f-]{8,}/i) || [''])[0];
      materials.push({ uuid, png: png ? new Blob([png], { type: 'image/png' }) : null, thumb: thumb ? new Blob([thumb], { type: 'image/png' }) : null });
    }
    const tipIds = blobStrings(v.BrushPatternImageArray), texIds = blobStrings(v.TextureImage), dualIds = v.UseDualBrush ? blobStrings(v.DualPatternImageArray) : [];
    const findMat = (id, i) => materials.find((m) => m.uuid && id && (m.uuid.includes(id) || id.includes(m.uuid))) || null;
    const tips = v.BrushUsePatternImage ? [...new Set(tipIds.map((id) => findMat(id)).filter(Boolean))] : [];
    if (v.BrushUsePatternImage && !tips.length && materials.length) tips.push(materials[0]);
    const texture = texIds.length ? (findMat(texIds[0]) || materials.find((m) => !tips.includes(m)) || null) : null;
    const num = (x, d) => (Number.isFinite(x) ? x : d);
    const brush = {
      name: (node && node.NodeName) || String(fileName || '브러시').replace(/\.sut$/i, ''),
      size: num(v.BrushSize, 10), sizeEff: parseEffector(v.BrushSizeEffector),
      opacity: num(v.Opacity, 100) / 100, opacityEff: parseEffector(v.BrushOpacityEffector),
      flow: num(v.BrushFlow, 100) / 100, flowEff: parseEffector(v.BrushFlowEffector),
      hardness: num(v.BrushHardness, 100) / 100,
      interval: Math.max(0.01, num(v.BrushInterval, 10) / 100), intervalEff: parseEffector(v.BrushIntervalEffector),
      thickness: num(v.BrushThickness, 100) / 100, thickEff: parseEffector(v.BrushThicknessEffector), vertical: !!v.BrushVerticalThicknes,
      rotation: num(v.BrushRotation, 0), rotMask: num(v.BrushRotationEffector, 3), rotRandom: num(v.BrushRotationRandomScale, 100) / 100,
      aa: num(v.AntiAlias, 1), smoothing: num(v.FlickerReduction, 0),
      tipOrder: num(v.BrushPatternOrderType, 0), flipH: num(v.BrushPatternReverseHorizontal, 0), flipV: num(v.BrushPatternReverseVertical, 0),
      ribbon: !!v.BrushRibbon,
      texDensity: num(v.TextureDensity, 50) / 100, texDensEff: parseEffector(v.TextureDensityEffector), texScale: num(v.TextureScale2, 100) / 100,
      texRotate: num(v.TextureRotate, 0), texInvert: !!v.TextureReverseDensity, texPerStamp: !!v.TextureForPlot,
      spray: v.BrushUseSpray ? { size: num(v.BrushSpraySize, 2), sync: !!v.BrushSpraySizeSyncBrushSize, density: Math.max(1, num(v.BrushSprayDensity, 1)),
        bias: num(v.BrushSprayBias, 0) / 100, sizeEff: parseEffector(v.BrushSpraySizeEffector), densEff: parseEffector(v.BrushSprayDensityEffector) } : null,
      jitter: v.BrushChangePatternColor ? { h: num(v.BrushHueChange, 0), s: num(v.BrushSaturationChange, 0), v: num(v.BrushValueChange, 0) } : null,
      taperIn: v.BrushUseIn ? num(v.BrushInLength, 20) : 0, taperOut: v.BrushUseOut ? num(v.BrushOutLength, 20) : 0,
      // 합성 모드: 아직 번호 뜻을 다 모름 → 막지 않고 '보통'으로 그린다(설정 창에서 곱하기·지우기로 바꿀 수 있음)
      erase: false, compositeRaw: num(v.CompositeMode, 0),
      // 2중 브러시: 두 번째 끝 모양을 따로 찍어 만든 무늬로 획을 깎아 낸다(곱하기)
      dual: v.UseDualBrush ? { size: num(v.DualSize, 30), sizeEff: parseEffector(v.DualSizeEffector), flow: num(v.DualFlow, 100) / 100, hardness: num(v.DualHardness, 100) / 100,
        interval: Math.max(0.01, num(v.DualInterval, 10) / 100), thickness: num(v.DualThickness, 100) / 100, rotation: num(v.DualRotation, 0), rotMask: num(v.DualRotationEffector, 3),
        rotRandom: num(v.DualRotationRandomScale, 100) / 100, spray: !!v.DualUseSpray, flipH: num(v.DualPatternReverseHorizontal, 0), flipV: num(v.DualPatternReverseVertical, 0) } : null,
      // 색 혼합: BrushWaterColor 1 = 블렌드, 그 밖 = 물감 섞기 · 물감량 BrushMixColor · 물감 농도 BrushMixAlpha · 색 늘이기 BrushMixColorExtension
      mix: v.BrushUseWaterColor ? { mode: num(v.BrushWaterColor, 0) === 1 ? 'blend' : 'paint', amount: num(v.BrushMixColor, 50) / 100, density: num(v.BrushMixAlpha, 50) / 100,
        stretch: num(v.BrushMixColorExtension, 10) / 100, amountEff: parseEffector(v.BrushMixColorEffector), densEff: parseEffector(v.BrushMixAlphaEffector), ref: 'layer' } : null,
      wedge: v.BrushUseWaterEdge ? { on: true, radius: num(v.BrushWaterEdgeRadius, 3), alpha: num(v.BrushWaterEdgeAlphaPower, 20) / 100, value: num(v.BrushWaterEdgeValuePower, 0) / 100 } : null,
      unsupported: [num(v.CompositeMode, 0) !== 0 && `합성 모드(${num(v.CompositeMode, 0)}번)는 '보통'으로 그려요 — 지우개 브러시면 ⚙ 설정 → 잉크 → 합성 모드에서 '지우기'`].filter(Boolean),
    };
    brush.baseSize = brush.size;
    const dualTip = dualIds.length ? (findMat(dualIds[0]) || null) : null;
    return { brush, tips, texture, dualTip };
  }

  // 불러온 브러시 저장 (IndexedDB, 이 컴퓨터에만)
  const ADV_DB = 'magmaWand.brushes';
  let advDbP = null;
  function advDb() {
    if (advDbP) return advDbP;
    advDbP = new Promise((res, rej) => {
      const rq = indexedDB.open(ADV_DB, 1);
      rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('brushes', { keyPath: 'id' }); db.createObjectStore('images', { keyPath: 'key' }); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    return advDbP;
  }
  async function advStore(name, mode = 'readonly') { return (await advDb()).transaction(name, mode).objectStore(name); }
  async function advPutImage(blob) {
    const key = 'img_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await reqP((await advStore('images', 'readwrite')).put({ key, blob }));
    return key;
  }
  async function advGetImage(key) { const r = key ? await reqP((await advStore('images')).get(key)) : null; return r ? r.blob : null; }
  async function advListBrushes() { const all = await reqP((await advStore('brushes')).getAll()); return all.sort((a, b) => a.added - b.added); }
  async function advSaveBrush(b) { await reqP((await advStore('brushes', 'readwrite')).put(b)); }
  async function advDeleteBrush(b) {
    await reqP((await advStore('brushes', 'readwrite')).delete(b.id));
    const st = await advStore('images', 'readwrite');
    for (const k of [...(b.tips || []).flatMap((t) => [t.key, t.thumbKey]), b.texture && b.texture.key, b.texture && b.texture.thumbKey]) if (k) st.delete(k);
  }
  // .sut 파일 → 저장된 브러시 (끝 모양 PNG가 보호돼 있으면 needPng 표시)
  async function advImportSut(file) {
    const { brush, tips, texture, dualTip } = await parseSut(await file.arrayBuffer(), file.name);
    // 온전한 PNG라도 그림이 비어 있으면(전부 투명이거나 한 가지 색) 실제 소재가 아니다 → PNG 필요
    const usable = async (blob) => {
      if (!blob) return false;
      try {
        const bmp = await createImageBitmap(blob);
        const sc = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
        const oc = new OffscreenCanvas(w, h), g = oc.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        let amin = 255, amax = 0, lmin = 255, lmax = 0;
        for (let i = 0; i < d.length; i += 4) {
          amin = Math.min(amin, d[i + 3]); amax = Math.max(amax, d[i + 3]);
          if (d[i + 3] > 8) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; lmin = Math.min(lmin, l); lmax = Math.max(lmax, l); }
        }
        if (amax < 8) return false;                       // 전부 투명
        if (amin > 247 && lmax - lmin < 8) return false;  // 불투명한 한 가지 색
        return true;
      } catch { return false; }
    };
    const slot = async (m) => {
      const ok = await usable(m.png);
      return { key: ok ? await advPutImage(m.png) : null, thumbKey: m.thumb ? await advPutImage(m.thumb) : null, needPng: !ok };
    };
    brush.id = 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    brush.added = Date.now();
    brush.tips = [];
    for (const m of tips) brush.tips.push(await slot(m));
    brush.texture = texture ? await slot(texture) : null;
    if (brush.dual) brush.dual.tip = dualTip ? await slot(dualTip) : null; // 끝 모양이 없으면 원형
    await advSaveBrush(brush);
    return brush;
  }

  // ---------- 고급 브러시 ② 그리는 엔진 ----------
  // 끝 모양(도장)을 획을 따라 일정 간격으로 찍는다. 필압·속도·무작위로 크기·흐름·불투명도·두께·회전이 바뀌고,
  // 스프레이(흩뿌리기)·텍스처·리본(긴 띠 끝 모양)·색 흔들기를 지원한다.
  //  - 긋는 동안: 보드 크기의 내 WebGL 텍스처(획 버퍼)에 찍고, Magma 화면 위 내 캔버스에만 보여 준다(트래픽 0).
  //  - 손을 떼면: 획을 보드 크기 PNG로 만들어 Magma에 '붙여넣기' 한 번(= 되돌리기 한 칸, 다른 사람에게도 보임).
  const ADV = { gl: null, cv: null, P: {}, vao: null, ibuf: null, fb: null, W: 0, H: 0, S: null, C: null, cTimer: 0,
    tips: new Map(), tex: null, brush: null, tipTex: [], texInfo: null, stroke: null, batch: [], dbatch: [], raf: 0, lost: false, commitQ: Promise.resolve() };
  const ADV_VS = `#version 300 es
in vec2 aPos; in float aSize; in float aAngle; in vec2 aSq; in float aAlpha; in vec3 aColor; in vec2 aFlip; in vec2 aV; in vec2 aX;
uniform vec2 uDoc; uniform float uRibbon;
out vec2 vUV; out float vA; out vec3 vC; out vec2 vDoc; out vec2 vVSpan; out vec2 vX;
void main(){
  int k = gl_VertexID; vec2 c = vec2((k == 1 || k == 2 || k == 4) ? 1.0 : -1.0, (k == 2 || k == 4 || k == 5) ? 1.0 : -1.0);
  vUV = c * 0.5 + 0.5; if (aFlip.x < 0.0) vUV.x = 1.0 - vUV.x; if (aFlip.y < 0.0) vUV.y = 1.0 - vUV.y;
  vec2 hs = vec2(aSize * 0.5 * aSq.x, aSize * 0.5 * aSq.y);
  if (uRibbon > 0.5) hs = vec2(aSize * 0.5 * aSq.x, aSq.y * 0.5);
  vec2 l = c * hs; float cs = cos(aAngle), sn = sin(aAngle);
  vec2 p = aPos + vec2(l.x * cs - l.y * sn, l.x * sn + l.y * cs);
  vDoc = p; vA = aAlpha; vC = aColor; vVSpan = aV; vX = aX;
  gl_Position = vec4(p / uDoc * 2.0 - 1.0, 0.0, 1.0);
}`;
  const ADV_FS = `#version 300 es
precision highp float;
in vec2 vUV; in float vA; in vec3 vC; in vec2 vDoc; in vec2 vVSpan; in vec2 vX;
uniform sampler2D uTip; uniform sampler2D uTex; uniform float uRound; uniform float uHard; uniform float uAA;
uniform float uUseTex; uniform float uTexDen; uniform vec2 uTexScale; uniform float uTexInv; uniform float uRibbon; uniform float uTexCon;
uniform float uBN; uniform float uBStr; uniform float uBShape; uniform float uBVar; uniform float uBSeed; uniform float uPass; uniform float uRidge;
out vec4 o;
float h11(float n){ return fract(sin(n * 12.9898 + uBSeed * 78.233) * 43758.5453); }
float vn1(float x, float k){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h11(i * 1.31 + k), h11((i + 1.0) * 1.31 + k), f); }
void main(){
  float m;
  vec3 col = vC;
  float hgt = -1.0;
  if (uBN > 0.5) {
    // 붓털: 털마다 굵기·자리·물감 양이 다르고, 물감 양은 획을 따라 천천히 바뀐다(털이 하나씩 마르며 갈라짐).
    // 도장이 진행 방향에 맞춰 돌아가므로 같은 털은 같은 자리를 지나 → 끊김 없는 결이 남는다.
    vec2 q = vUV * 2.0 - 1.0; // x: 붓 폭(획을 가로지름), y: 진행 방향
    float fp = uBShape > 0.5 ? (1.0 - smoothstep(0.86, 1.0, abs(q.x))) * (1.0 - smoothstep(0.3, 1.0, abs(q.y)))
                             : 1.0 - smoothstep(0.72, 1.0, length(q));
    float t = vX.x, load = vX.y, thr = 1.0 - load, bri = 0.0, tint = 0.0;
    for (int L = 0; L < 2; L++) {
      float n = L == 0 ? uBN : floor(uBN * 1.618);
      float x = vUV.x * n + float(L) * 0.37, i = floor(x), f = fract(x), k = i + float(L) * 517.0;
      float w = 0.4 + 0.5 * h11(k * 1.7), c = 0.5 + (h11(k * 2.3) - 0.5) * (1.0 - w);
      float aw = max(fwidth(x) * 0.75, 0.04);
      float prof = 1.0 - smoothstep(w * 0.5 - aw, w * 0.5 + aw, abs(f - c));
      float ld = vn1(t * (0.25 + 0.55 * h11(k * 3.1)) + h11(k * 4.7) * 40.0, k * 0.71) * 0.85 + 0.15 * h11(k * 6.1);
      float on = smoothstep(thr - 0.04, thr + 0.04, ld); // 털은 묻었거나 말랐거나 — 어중간한 값이 겹쳐 뿌옇게 되지 않게
      float v = prof * on * (L == 0 ? 1.0 : 0.8);
      if (v > bri) { bri = v; tint = h11(k * 5.9) - 0.5; }
    }
    float body = smoothstep(0.35, 0.75, load); // 물감이 줄면 몸통부터 빠지고 털 자국만 남는다
    float edge = smoothstep(0.5, 0.95, abs(q.x)); // 붓 가장자리는 털이 삐져나와 들쭉날쭉
    m = fp * mix(body, bri, clamp(uBStr + edge * 0.7, 0.0, 1.0));
    if (uRidge > 0.0) m = fp * mix(body, max(bri, body * 0.85), uBStr); // 나이프: 털 대신 가는 긁힘
    col = clamp(vC * (1.0 + tint * uBVar * 2.0), 0.0, 1.0);
    hgt = smoothstep(0.0, 0.6, fp) * (0.62 + 0.38 * mix(1.0, bri, 0.85)); // 윗면은 평평하게, 털 자국만 굴곡
    if (uRidge > 0.0) hgt = fp * (0.3 + 0.7 * mix(bri, 1.0, 0.6) * (0.55 + 0.45 * smoothstep(0.45, 0.95, abs(q.x))) + 0.25 * smoothstep(0.2, -0.9, q.y));
  } else if (uRound > 0.5) {
    float r = length(vUV * 2.0 - 1.0);
    float edge = max(fwidth(r), 0.0001);
    m = uHard >= 0.999 ? 1.0 - smoothstep(1.0 - edge, 1.0, r) : 1.0 - smoothstep(uHard, 1.0, r);
  } else {
    vec2 uv = vUV;
    if (uRibbon > 0.5) uv = vec2(vUV.x, fract(vVSpan.x + vUV.y * vVSpan.y));
    m = texture(uTip, uv).r;
  }
  if (uAA < 0.5) m = m >= 0.5 ? 1.0 : 0.0;
  if (uUseTex > 0.5) { float t = texture(uTex, vDoc / uTexScale).r; if (uTexInv > 0.5) t = 1.0 - t; t = clamp((t - 0.5) * (1.0 + uTexCon * 4.0) + 0.5, 0.0, 1.0); m *= mix(1.0, t, uTexDen); }
  if (uPass > 0.5) { // 두께(높이) 버퍼: 맨 위 물감 면의 높낮이. 묽은 물감일수록 얇게 덮는다
    float h = hgt >= 0.0 ? hgt : m;
    float ah = clamp(m * min(1.0, vA * 2.5), 0.0, 1.0) * 0.55;
    if (ah <= 0.0005) discard;
    o = vec4(h * ah, 0.0, 0.0, ah); return;
  }
  float a = clamp(m * vA, 0.0, 1.0);
  if (a <= 0.0005) discard;
  o = vec4(col * a, a);
}`;
  const ADV_SHOW_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;
  // 화면 표시(uMode 0) / 확정용 잘라내기(uMode 1): 획 버퍼 × 전체 불투명도 × (획 단위 텍스처)
  const ADV_SHOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uS; uniform sampler2D uTex; uniform vec3 uInv0; uniform vec3 uInv1; uniform float uH; uniform vec2 uDoc;
uniform float uOp; uniform float uUseTex; uniform float uTexDen; uniform vec2 uTexScale; uniform float uTexInv; uniform float uMode; uniform vec2 uOff;
uniform sampler2D uD; uniform float uUseD; uniform float uTexCon;
uniform float uTexMode; uniform float uTexFloor;
uniform float uCtx; uniform sampler2D uK; uniform float uUseK; uniform sampler2D uA; uniform float uUseA;
uniform float uErase; uniform float uMul; uniform float uLock; uniform float uLop;
uniform float uImp; uniform float uShine; uniform sampler2D uHb;
uniform float uWet; uniform float uWob; uniform float uGran; uniform float uSoft; uniform sampler2D uNz; uniform float uNzS; uniform vec3 uEdge;
out vec4 o;
float aAt(vec2 q){ q = clamp(q, vec2(0.0), uDoc - 1.0); return uMode > 0.5 ? texelFetch(uS, ivec2(q), 0).a : textureLod(uS, q / uDoc, 0.0).a; }
// 젖은 물감: 쌓인 물감 양의 등고선 하나를 물 가장자리로 삼아 또렷하게, 낮은 주파수 노이즈로 가장자리가 구불구불
float wshape(vec2 q, float a){
  if (uWet < 0.5) return a;
  float n = textureLod(uNz, q / uNzS, 0.0).r - 0.5;
  return smoothstep(0.17 - uSoft * 0.15, 0.27 + uSoft * 0.3, a + n * uWob);
}
float hAt(ivec2 q){ return texelFetch(uHb, clamp(q, ivec2(0), ivec2(uDoc) - 1), 0).r; }
vec3 kmKS(vec3 r){ r = clamp(r, 0.004, 0.996); return (1.0 - r) * (1.0 - r) / (2.0 * r); }
vec3 kmGl(vec3 b, vec3 s){ vec3 k = kmKS(b) + kmKS(s); return 1.0 + k - sqrt(k * k + 2.0 * k); } // 물감 겹치기(감산)
void main(){
  vec2 p;
  if (uMode > 0.5) p = uOff + gl_FragCoord.xy;
  else { vec2 sp = vec2(gl_FragCoord.x, uH - gl_FragCoord.y); p = vec2(dot(uInv0, vec3(sp, 1.0)), dot(uInv1, vec3(sp, 1.0))); }
  if (p.x < 0.0 || p.y < 0.0 || p.x >= uDoc.x || p.y >= uDoc.y) discard;
  vec4 c = uMode > 0.5 ? texelFetch(uS, ivec2(p), 0) : texture(uS, p / uDoc);
  if (uUseD > 0.5) c *= uMode > 0.5 ? texelFetch(uD, ivec2(p), 0).a : texture(uD, p / uDoc).a; // 2중 브러시 무늬로 깎기
  float k = uOp;
  // 수채: 물 가장자리(또렷·구불) + 가장자리에 고인 물감(수채 경계) + 종이 골에 가라앉은 안료 알갱이 — 그리는 중에도 확정과 똑같이
  if ((uWet > 0.5 || uEdge.x > 0.5) && c.a > 0.0) {
    float a0 = c.a, sh = wshape(p, a0);
    vec3 cc = c.rgb / a0;
    float na = uWet > 0.5 ? sh * (0.72 + 0.28 * clamp(a0 * 1.3, 0.0, 1.0)) : a0;
    if (uEdge.x > 0.5 && sh > 0.003) {
      float r = uEdge.x, B = sh;
      for (int i = 0; i < 12; i++) {
        vec2 d = vec2(cos(float(i) * 0.5236), sin(float(i) * 0.5236));
        vec2 q1 = p + d * r, q2 = p + d * r * 0.5;
        B += wshape(q1, aAt(q1)) + wshape(q2, aAt(q2));
      }
      B /= 25.0;
      float e = clamp((sh - B) * 2.5, 0.0, 1.0);
      na = min(1.0, na + (1.0 - na) * uEdge.y * e + na * uEdge.y * e * 0.6);
      cc *= 1.0 - uEdge.z * e * 0.55;
    }
    if (uGran > 0.0) {
      // 안료 알갱이: 종이 결 + 아주 잔 노이즈 (큰 얼룩이 되지 않게)
      float hn = fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); // 픽셀마다 다른 잔 알갱이
      float t = mix(textureLod(uNz, p / 64.0, 0.0).r, hn, 0.4);
      if (uUseTex > 0.5) { float pt = textureLod(uTex, p / uTexScale, 0.0).r; if (uTexInv > 0.5) pt = 1.0 - pt; t = mix(pt, hn, 0.3); }
      na = clamp(na * (1.0 + uGran * ((1.0 - t) - 0.5) * 1.6), 0.0, 1.0);
    }
    c = vec4(cc * na, na);
  }
  // 두께감(임파스토): 물감 높이 버퍼의 기울기로 왼쪽 위 빛을 받은 음영·광택 — 붓 자국이 도드라져 보인다
  if (uImp > 0.0 && c.a > 0.0001) {
    ivec2 ip = ivec2(p);
    // 2픽셀 간격 소벨: 털 하나하나의 날카로운 굴곡 대신 물감 덩어리의 완만한 굴곡을 본다
    float tl = hAt(ip + ivec2(-2, -2)), tc = hAt(ip + ivec2(0, -2)), tr = hAt(ip + ivec2(2, -2));
    float ml = hAt(ip + ivec2(-2, 0)), mr = hAt(ip + ivec2(2, 0));
    float bl = hAt(ip + ivec2(-2, 2)), bc = hAt(ip + ivec2(0, 2)), br = hAt(ip + ivec2(2, 2));
    float gx = ((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl)) * 0.25, gy = ((bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)) * 0.25;
    float kk = uImp * 2.2;
    vec3 n = normalize(vec3(-gx * kk, -gy * kk, 1.0)), L = normalize(vec3(-0.55, -0.65, 0.8)), Hh = normalize(L + vec3(0.0, 0.0, 1.0));
    float dif = dot(n, L) - L.z;
    float sp = max(0.0, pow(max(dot(n, Hh), 0.0), 18.0) - pow(Hh.z, 18.0));
    vec3 cc = c.rgb / c.a;
    cc = cc * (1.0 + (dif > 0.0 ? dif * 0.7 : dif * 0.55)) + sp * uShine * 0.3;
    c.rgb = clamp(cc, 0.0, 1.0) * c.a;
  }
  if (uUseTex > 0.5 && uWet < 0.5) {
    float t = texture(uTex, p / uTexScale).r; if (uTexInv > 0.5) t = 1.0 - t; t = clamp((t - 0.5) * (1.0 + uTexCon * 4.0) + 0.5, 0.0, 1.0);
    if (uTexMode > 0.5) { // 깊이: 살살 칠하면 종이 높은 곳에만, 겹치고 세게 칠할수록 골까지 채워짐 (연필·목탄·파스텔)
      float th = uTexDen * (1.0 - t), a0 = c.a, a1 = max(clamp((a0 - th) / max(0.04, 1.0 - th), 0.0, 1.0), a0 * uTexFloor); // 골에도 옅은 가루막(브러시마다)
      c *= a0 > 0.00001 ? a1 / a0 : 0.0;
    } else k *= mix(1.0, t, uTexDen);
  }
  if (uMode > 0.5) { o = c.a > 0.00001 ? vec4(clamp(c.rgb / c.a, 0.0, 1.0), clamp(c.a * k, 0.0, 1.0)) : vec4(0.0); return; }
  vec4 s = c * k;
  if (uCtx < 0.5) { o = s; return; }
  // 실제 결과처럼: K.a = 보이는 정도(위 레이어에 가린 만큼·클리핑·선택 영역), K.rgb = 지울 때 드러날 아래 그림
  ivec2 ip = ivec2(p);
  vec4 K = uUseK > 0.5 ? texelFetch(uK, ip, 0) : vec4(1.0);
  if (uErase > 0.5) { float e = clamp(s.a * K.a, 0.0, 1.0); o = vec4(K.rgb * e, e); return; }
  vec3 col = s.a > 0.00001 ? s.rgb / s.a : vec3(0.0);
  float a = clamp(s.a * uLop * K.a, 0.0, 1.0);
  if (uUseA > 0.5) { vec4 A = texelFetch(uA, ip, 0); if (uMul > 2.5) col = kmGl(mix(K.rgb, A.rgb, A.a), col); else if (uMul > 1.5) col = mix(col, kmGl(A.rgb, col), A.a); else if (uMul > 0.5) col = mix(col, A.rgb * col, A.a); if (uLock > 0.5) a *= A.a; }
  o = vec4(col * a, a);
}`;
  const advComp = (gl, vs, fs) => {
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('셰이더: ' + gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('셰이더 연결: ' + gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u };
  };
  const INST = 16; // aPos2 aSize aAngle aSq2 aAlpha aColor3 aFlip2 aV2 aX2(획 길이·남은 물감)
  function advEnsureGL(canvas, W, H) {
    if (!ADV.cv || !ADV.cv.isConnected || ADV.cv.parentElement !== canvas.parentElement) {
      ADV.cv?.remove();
      ADV.cv = document.createElement('canvas'); ADV.cv.className = 'mw-adv mw-el';
      ADV.gl = ADV.cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
      if (!ADV.gl) throw new Error('WebGL2를 쓸 수 없어요');
      ADV.cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ADV.lost = true; });
      ADV.cv.addEventListener('webglcontextrestored', () => { ADV.lost = false; ADV.P = {}; ADV.S = ADV.C = ADV.K = ADV.A = ADV.Hb = ADV.nz = null; ADV.tips.clear(); ADV.tex = null; ADV.W = 0; });
      ADV.P = {}; ADV.S = ADV.C = ADV.K = ADV.A = ADV.Hb = ADV.nz = null; ADV.tips.clear(); ADV.tex = null; ADV.W = 0;
      canvas.after(ADV.cv);
    }
    Object.assign(ADV.cv.style, { position: 'absolute', left: canvas.offsetLeft + 'px', top: canvas.offsetTop + 'px',
      width: canvas.offsetWidth + 'px', height: canvas.offsetHeight + 'px', pointerEvents: 'none' });
    if (ADV.cv.width !== canvas.width || ADV.cv.height !== canvas.height) { ADV.cv.width = canvas.width; ADV.cv.height = canvas.height; }
    const gl = ADV.gl;
    if (!ADV.P.stamp) {
      ADV.P.stamp = advComp(gl, ADV_VS, ADV_FS); ADV.P.show = advComp(gl, ADV_SHOW_VS, ADV_SHOW_FS);
      ADV.vao = gl.createVertexArray(); gl.bindVertexArray(ADV.vao);
      ADV.ibuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ADV.ibuf);
      const p = ADV.P.stamp.p, stride = INST * 4;
      const attr = (name, n, off) => { const loc = gl.getAttribLocation(p, name); if (loc < 0) return; gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off * 4); gl.vertexAttribDivisor(loc, 1); };
      attr('aPos', 2, 0); attr('aSize', 1, 2); attr('aAngle', 1, 3); attr('aSq', 2, 4); attr('aAlpha', 1, 6); attr('aColor', 3, 7); attr('aFlip', 2, 10); attr('aV', 2, 12); attr('aX', 2, 14);
      gl.bindVertexArray(null);
      ADV.fb = gl.createFramebuffer();
      const blank = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, blank);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
      ADV.blank = blank;
      // 수채 가장자리 흔들림·알갱이용 이음매 없는 노이즈 (한 번만 만든다)
      const NZ = 256, f = fbm(NZ, 4, 3, 77, 0.45), nb = new Uint8Array(NZ * NZ);
      for (let i = 0; i < nb.length; i++) nb[i] = Math.round(f[i] * 255);
      ADV.nz = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, ADV.nz);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NZ, NZ, 0, gl.RED, gl.UNSIGNED_BYTE, nb);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }
    if (ADV.W !== W || ADV.H !== H || !ADV.S) {
      for (const t of [ADV.S, ADV.C]) if (t) gl.deleteTexture(t);
      // 에어브러시처럼 아주 옅게 여러 번 겹쳐도 색이 틀어지지 않게 16비트 실수 버퍼 (보드가 아주 크면 메모리 때문에 8비트)
      ADV.float = W * H <= 9e6 && !!gl.getExtension('EXT_color_buffer_float');
      const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, ADV.float ? gl.RGBA16F : gl.RGBA8, W, H);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
      ADV.S = mk(); ADV.C = mk(); ADV.W = W; ADV.H = H; ADV.cBox = null;
      if (ADV.D) gl.deleteTexture(ADV.D);
      ADV.D = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, ADV.D); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H); // 2중 브러시 무늬
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (ADV.Hb) gl.deleteTexture(ADV.Hb);
      ADV.Hb = mk(); // 두께(높이) 버퍼
      advClear(ADV.S, null); advClear(ADV.C, null); advClear(ADV.D, null); advClear(ADV.Hb, null);
      for (const t of [ADV.K, ADV.A]) if (t) gl.deleteTexture(t);
      ADV.K = ADV.A = null;
    }
    return gl;
  }
  function advClear(tex, box) {
    const gl = ADV.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, ADV.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, ADV.W, ADV.H);
    if (box) { gl.enable(gl.SCISSOR_TEST); gl.scissor(box.x, box.y, box.w, box.h); }
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // 끝 모양·텍스처 이미지 → 한 채널 마스크 (투명도가 있으면 알파, 없으면 어두운 정도)
  async function advMaskTexture(key, repeat) {
    const k = key + (repeat ? ':r' : '');
    if (ADV.tips.has(k)) return ADV.tips.get(k);
    const blob = await advGetImage(key);
    if (!blob) return null;
    return advMaskFromBlob(k, blob, repeat);
  }
  async function advMaskFromBlob(k, blob, repeat) {
    const bmp = await createImageBitmap(blob);
    const MAX = repeat ? 2048 : 1024;
    const sc = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
    const oc = new OffscreenCanvas(w, h), g = oc.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
    let transp = 0;
    for (let i = 3; i < px.length; i += 4 * 7) if (px[i] < 200) transp++;
    const useAlpha = transp > (w * h) / 7 * 0.02;
    for (let i = 0, j = 0; j < m.length; i += 4, j++) {
      const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
      m[j] = useAlpha ? px[i + 3] * (1 - (lum / 255) * 0.0) : 255 - lum;
    }
    const gl = ADV.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, m);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const info = { tex: t, w: bmp.width, h: bmp.height };
    ADV.tips.set(k, info);
    return info;
  }
  // 지금 브러시의 끝 모양·텍스처를 GPU에 올려 둔다
  function advHasBadCurve(o, d = 0) {
    if (!o || typeof o !== 'object' || d > 4) return false;
    if (Array.isArray(o.curve) && !curveOk(o.curve)) return true;
    return Object.entries(o).some(([k, v]) => k !== 'tips' && k !== 'texture' && v && typeof v === 'object' && !Array.isArray(v) && advHasBadCurve(v, d + 1));
  }
  async function advPrepare(brush) {
    const canvas = getCanvas(), E = getEditor();
    if (!canvas || !E || !brush) return false;
    advEnsureGL(canvas, E.drawing.w, E.drawing.h);
    // 기본 모양·텍스처는 그리는 방법이 좋아지면 새 그림으로 바꿔 둔다
    let changed = false;
    for (const t of [...(brush.tips || []), ...(brush.texture ? [brush.texture] : [])]) {
      if (!t || !t.builtinId || t.bver === BUILTIN_VER) continue;
      const item = BUILTIN_TIPS.find((x) => x.id === t.builtinId) || BUILTIN_TEX.find((x) => x.id === t.builtinId);
      if (!item) continue;
      t.key = await advPutImage(await builtinBlob(item, item.size || 256)); t.bver = BUILTIN_VER; changed = true;
    }
    // 예전 버전이 잘못 읽은 효과 곡선(새 클립 스튜디오 .sut): 그리기는 곧은 곡선으로 하고, 다시 가져오라고 한 번 알린다
    if (!brush.preset && !brush.badCurveWarned && advHasBadCurve(brush)) { brush.badCurveWarned = true; changed = true; toast(`'${brush.name}'의 필압·속도 곡선을 예전 버전이 잘못 읽었어요 — 지금은 곧은 곡선으로 그려요. .sut를 다시 가져오면 원래 곡선대로 돼요`); }
    // 수채 프리셋으로 만든 예전 브러시: 곱하기 → 물감 겹치기(감산 혼합)로 한 번만 바꿔 준다
    if (brush.cat === '수채' && brush.preset && brush.blend === 'multiply' && !brush.kmMig) { brush.blend = 'glaze'; brush.kmMig = true; changed = true; }
    if (changed) { ADV.tips.clear(); await advSaveBrush(brush); }
    const tips = [];
    const proc = (brush.tips || []).length === 1 && PROC_TIPS.has(brush.tips[0].builtinId); // 원형: 수학 원(완벽한 안티에일리어싱)
    if (proc && brush.tips[0].builtinId === 'round-soft' && brush.hardness >= 0.99) { brush.hardness = 0.15; await advSaveBrush(brush); }
    if (!proc) for (const t of brush.tips || []) { if (t.key) { const i = await advMaskTexture(t.key, false); if (i) tips.push(i); } }
    const texInfo = brush.texture && brush.texture.key ? await advMaskTexture(brush.texture.key, true) : null;
    ADV.dualTex = brush.dual && brush.dual.tip && brush.dual.tip.key ? await advMaskTexture(brush.dual.tip.key, false) : null;
    ADV.tipTex = tips; ADV.texInfo = texInfo; ADV.brush = brush; ADV.proc = proc;
    return true;
  }
  const hsv = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx]; };
  const rgb = (h, s, v) => { const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [r + m, g + m, b + m]; };
  function advColor() {
    if (S.alpha) return [0, 0, 0]; // 투명색: 색은 쓰지 않음 (미리보기는 실제로 지운 모습)
    const E = getEditor();
    const n = E && Number.isFinite(E.primaryColor) ? E.primaryColor >>> 8 : 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  // 획 시작
  function advStrokeStart(e) {
    const b = ADV.brush;
    if (!b) return false;
    // 설정 칸의 크기를 이 브러시 크기로 (바뀌었으면 저장)
    if (S.advSize > 0 && S.advSize !== b.size) { b.size = S.advSize; advSaveSoon(); }
    const er = !!S.alpha || b.blend === 'erase';
    const s = { pts: [], acc: 0, dist: 0, last: null, speed: 0, idx: 0, dir: 1, box: null, color: er ? [0, 0, 0] : advColor(), erase: er, v: 0, n: 0, zoom: viewZoom() || 1 };
    s.hsv = hsv(...s.color);
    if (b.mix && b.mix.mode !== 'none' && !s.erase) s.mix = advMixStart(b);
    s.ctx = advCtxStart(s, b);
    if (ADV.cv) ADV.cv.style.mixBlendMode = s.erase || !s.ctx ? '' : cssBlend(s.ctx.L.mode);
    ADV.stroke = s;
    advAddPoint(e);
    return true;
  }
  function advDocPoint(e) {
    const E = getEditor(), canvas = getCanvas();
    const m = E.computedView.inverseTransform, r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  function advAddPoint(e, docPt) {
    const s = ADV.stroke, b = ADV.brush;
    if (!s || !b) return;
    let [x, y] = docPt || advDocPoint(e);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const pr = e.pointerType === 'pen' ? Math.pow(Math.max(0.01, e.pressure || 0), b.pressGamma || 1) : 1; // 필압 곡선(감도)
    const t = e.timeStamp || performance.now();
    // 튀는 점 막기: 아주 짧은 시간에 화면에서 300픽셀 넘게 건너뛴 점은 입력 오류로 보고 버린다
    if (s.rawLast && !s.straight) { const jump = Math.hypot(x - s.rawLast.x, y - s.rawLast.y) * viewZoom(); if (jump > 300 && t - s.rawLast.t < 40) return; }
    s.rawLast = { x, y, p: pr, t }; s.ptype = e.pointerType;
    if (s.last && b.smoothing > 0 && !s.straight) { const k = Math.min(0.85, b.smoothing * 0.05); x = s.last.x + (x - s.last.x) * (1 - k); y = s.last.y + (y - s.last.y) * (1 - k); }
    const cur = { x, y, p: pr, t };
    // 첫 점은 바로 찍지 않고 다음 점이 와서 속도·방향을 안 뒤에 찍는다 (속도 0·각도 0으로 찍으면 시작에 동그란 덩어리가 생김)
    if (!s.last) { s.last = cur; s.pend = cur; return; }
    const a = s.last, dx = x - a.x, dy = y - a.y, L = Math.hypot(dx, dy);
    if (L < 0.01) return;
    const dt = Math.max(1, t - a.t);
    // 속도(화면 픽셀/ms): 획 첫 구간은 바로 실제 속도로(0에서 시작하면 시작점이 뭉툭하게 커짐), 이후 60ms 시간 상수로 부드럽게
    const inst = (L / dt) * (s.zoom || 1);
    if (!s.spInit) { s.speed = inst; s.spInit = true; } else s.speed += (inst - s.speed) * (1 - Math.exp(-dt / 60));
    // 진행 방향은 브러시 크기의 0.6배 거리에 걸쳐 천천히 따라간다 (급커브에서 끝 모양이 홱 돌지 않게)
    const raw = Math.atan2(dy, dx);
    const ang0 = s.dirAng == null ? raw : s.dirAng;
    if (s.dirAng == null) s.dirAng = raw;
    else { let d = raw - s.dirAng; d = Math.atan2(Math.sin(d), Math.cos(d)); s.dirAng += d * Math.min(1, L / Math.max(2, b.size * 0.6)); }
    let dA = s.dirAng - ang0; dA = Math.atan2(Math.sin(dA), Math.cos(dA));
    if (s.pend) { const p0 = s.pend; s.pend = null; advStamp(p0.x, p0.y, p0.p, ang0, 0); }
    // 끝 모양이 진행 방향을 따라 돌 때: 이 구간에서 도는 만큼 도장을 촘촘히 찍고 각도도 조금씩 돌린다
    // (끝 모양 가장자리가 한 도장에 1픽셀 넘게 휙 돌지 않게 → 급커브 바깥에 깃털처럼 삐죽한 자국이 안 생김)
    const turns = (b.rotMask & 0x40) || b.ribbon;
    const rotStep = turns ? Math.abs(dA) * b.size * 0.5 : 0;
    let walked = 0;
    for (let guard = 0; guard < 20000; guard++) {
      const pNow = a.p + (pr - a.p) * (walked / L);
      const size = Math.max(0.5, b.size * effectorValue(b.sizeEff, pNow, s.speed, 1));
      let step = Math.max(0.3, size * b.interval * effectorValue(b.intervalEff, pNow, s.speed, Math.random()));
      if (rotStep > 1) step = Math.max(0.15, Math.min(step, L / rotStep));
      const need = step - s.acc;
      if (walked + need > L) { s.acc += L - walked; break; }
      walked += need; s.acc = 0;
      const f = walked / L;
      s.dist += need;
      advStamp(a.x + dx * f, a.y + dy * f, a.p + (pr - a.p) * f, ang0 + dA * f, need);
    }
    s.last = cur;
  }
  function advStamp(x, y, p, ang, stepLen) {
    const s = ADV.stroke, b = ADV.brush;
    const rnd = Math.random;
    const taper = b.taperIn > 0 ? Math.min(1, 0.15 + s.dist / b.taperIn) : 1;
    let size = b.size * effectorValue(b.sizeEff, p, s.speed, rnd()) * taper;
    let flow = b.flow * effectorValue(b.flowEff, p, s.speed, rnd()) * effectorValue(b.opacityEff, p, s.speed, rnd());
    // 물감 마름: 획 길이를 따라 붓의 물감이 줄어든다 (갈필·마른 붓). 깊이 결과 같이 쓰면 끝으로 갈수록 종이 결만 남는다
    const dryF = b.dryOut && b.dryOut.len > 0 ? 1 - (1 - (b.dryOut.min || 0)) * sstep(0, b.dryOut.len, s.dist) : 1;
    const br = advBristle(b);
    // 붓털 브러시는 물감이 마르면 털이 하나씩 갈라지고(남은 물감), 흐름은 조금만 준다. 살살 누르면 닿는 털도 적다
    let load = 1;
    if (br) { flow *= 0.6 + 0.4 * dryF; load = dryF * (0.55 + 0.45 * Math.min(1, p)); } else flow *= dryF;
    let th = b.thickness * effectorValue(b.thickEff, p, s.speed, rnd());
    let sq = [1, 1];
    if (th < 1) sq = b.vertical ? [th, 1] : [1, th]; else if (th > 1) sq = b.vertical ? [1, 1 / th] : [1 / th, 1];
    let angle = (b.rotation * Math.PI) / 180;
    if (b.rotMask & 0x10) angle *= p;
    if (b.rotMask & 0x40) angle += ang;
    if (b.ribbon) angle = ang + Math.PI / 2; // 리본: 띠의 가로가 획을 가로지르게
    if (br) { angle = ang + Math.PI / 2 + (rnd() - 0.5) * 0.03; sq = [1, Math.max(0.08, Math.min(1, th))]; } // 붓털: 폭이 획을 가로지르게
    if (b.rotMask & 0x80) angle += (rnd() - 0.5) * 2 * Math.PI * b.rotRandom;
    let col = s.color, mixA = 1;
    if (s.mix) { const r = advMixColor(s, b, x, y, size, p, stepLen); col = r.c; mixA = r.a; }
    if (b.jitter && (b.jitter.h || b.jitter.s || b.jitter.v)) {
      const [h, sat, v] = s.hsv;
      col = rgb((h + (rnd() - 0.5) * 2 * b.jitter.h * 1.8 + 360) % 360, Math.max(0, Math.min(1, sat + (rnd() - 0.5) * 2 * b.jitter.s / 100)), Math.max(0, Math.min(1, v + (rnd() - 0.5) * 2 * b.jitter.v / 100)));
    }
    const flip = () => [b.flipH === 2 ? (rnd() < 0.5 ? -1 : 1) : b.flipH === 1 ? -1 : 1, b.flipV === 2 ? (rnd() < 0.5 ? -1 : 1) : b.flipV === 1 ? -1 : 1];
    const nTips = Math.max(1, ADV.tipTex.length);
    const pickTip = () => {
      if (nTips === 1) return 0;
      if (b.tipOrder === 2 || b.tipOrder === 3) return Math.floor(rnd() * nTips);
      if (b.tipOrder === 1) { const i = s.idx; s.idx += s.dir; if (s.idx >= nTips || s.idx < 0) { s.dir = -s.dir; s.idx += 2 * s.dir; } return Math.max(0, Math.min(nTips - 1, i)); }
      return s.idx++ % nTips;
    };
    const tipAspect = (ti) => { const t = ADV.tipTex[ti]; if (!t) return [1, 1]; const mx = Math.max(t.w, t.h); return [t.w / mx, t.h / mx]; };
    const push = (px, py, sz, a, sqx, sqy, alpha, ti) => {
      const fl = br ? [1, 1] : flip(), asp = b.ribbon || br ? [1, 1] : tipAspect(ti);
      let v = [0, 1];
      let sy = sqy * asp[1], sx = sqx * asp[0];
      if (b.ribbon) { const t = ADV.tipTex[ti]; const len = Math.max(0.5, stepLen || sz * 0.1); const rel = t ? (len / sz) * (t.w / t.h) : 0.01; v = [s.v, rel]; s.v = (s.v + rel) % 1; sy = len + 1; }
      ADV.batch.push({ ti, dist: s.dist, d: [px, py, sz, a, sx, sy, alpha * mixA, col[0], col[1], col[2], fl[0], fl[1], v[0], v[1], s.dist / Math.max(1, b.size), load] });
      const ext = sz * 0.75 * Math.max(sx, b.ribbon ? 1 : sy, 1) + (b.ribbon ? sy : 0) + 3;
      const bx = { x: Math.floor(px - ext), y: Math.floor(py - ext), w: Math.ceil(2 * ext) + 1, h: Math.ceil(2 * ext) + 1 };
      s.box = runion(s.box, bx);
    };
    if (b.spray) {
      const n = Math.max(1, Math.round(b.spray.density * effectorValue(b.spray.densEff, p, s.speed, rnd())));
      const R = size / 2;
      const part = Math.max(0.5, (b.spray.sync ? b.spray.size * (b.size / (b.baseSize || b.size)) : b.spray.size) * effectorValue(b.spray.sizeEff, p, s.speed, rnd()));
      const ex = Math.max(0.05, 0.5 * (1 + b.spray.bias));
      for (let i = 0; i < n; i++) {
        const th2 = rnd() * Math.PI * 2, r = R * Math.pow(rnd(), ex);
        let a2 = (b.rotation * Math.PI) / 180 + ((b.rotMask & 0x80) ? (rnd() - 0.5) * 2 * Math.PI * b.rotRandom : 0) + ((b.rotMask & 0x40) ? ang : 0);
        push(x + Math.cos(th2) * r, y + Math.sin(th2) * r, part, a2, sq[0], sq[1], flow, pickTip());
      }
    } else {
      // 흩어짐: 도장 자리를 크기에 비례해 조금씩 흔든다 (목탄·파스텔 가장자리가 매끈하게 반복되지 않게)
      if (b.scatter > 0 && !br) { const a = rnd() * Math.PI * 2, r = size * b.scatter * Math.sqrt(rnd()); x += Math.cos(a) * r; y += Math.sin(a) * r; }
      push(x, y, Math.max(0.5, size), angle, sq[0], sq[1], flow, pickTip());
    }
    // 2중 브러시: 자기 간격마다 두 번째 끝 모양을 D 버퍼용으로 찍는다
    const du = advDual(b);
    if (du) {
      const dsz = Math.max(0.5, du.size * (b.size / (b.baseSize || b.size)) * effectorValue(du.sizeEff, p, s.speed, rnd()));
      const dstep = Math.max(0.5, dsz * du.interval);
      if (s.dualNext == null) s.dualNext = 0;
      while (s.dist >= s.dualNext) {
        let a2 = (du.rotation * Math.PI) / 180; if (du.rotMask & 0x40) a2 += ang; if (du.rotMask & 0x80) a2 += (rnd() - 0.5) * 2 * Math.PI * du.rotRandom;
        const R = size / 2, th2 = rnd() * Math.PI * 2, rr = du.spray ? R * Math.sqrt(rnd()) : 0;
        const fx = du.flipH === 2 ? (rnd() < 0.5 ? -1 : 1) : du.flipH === 1 ? -1 : 1, fy = du.flipV === 2 ? (rnd() < 0.5 ? -1 : 1) : du.flipV === 1 ? -1 : 1;
        const asp = ADV.dualTex ? (() => { const mx = Math.max(ADV.dualTex.w, ADV.dualTex.h); return [ADV.dualTex.w / mx, ADV.dualTex.h / mx]; })() : [1, 1];
        ADV.dbatch.push([x + Math.cos(th2) * rr, y + Math.sin(th2) * rr, dsz, a2, asp[0], asp[1] * du.thickness, du.flow, 1, 1, 1, fx, fy, 0, 1, 0, 0]);
        s.dualNext += dstep;
      }
    }
    s.n++;
    advKick();
  }
  function advKick() { if (!ADV.raf) ADV.raf = requestAnimationFrame(advFrame); }
  // 모아 둔 도장들을 획 버퍼에 찍고 화면에 보여 준다
  function advFlush() {
    const gl = ADV.gl, b = ADV.brush;
    if (!gl || !ADV.batch.length || !b) return;
    const P = ADV.P.stamp;
    if (ADV.dbatch.length && ADV.D) advFlushDual(P);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ADV.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ADV.S, 0);
    gl.viewport(0, 0, ADV.W, ADV.H);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.p); gl.bindVertexArray(ADV.vao);
    gl.uniform2f(P.u.uDoc, ADV.W, ADV.H);
    const round = !ADV.tipTex.length;
    gl.uniform1f(P.u.uRound, round ? 1 : 0); gl.uniform1f(P.u.uHard, b.hardness); gl.uniform1f(P.u.uAA, b.aa ? 1 : 0);
    gl.uniform1f(P.u.uRibbon, b.ribbon && !round ? 1 : 0);
    const useTex = ADV.texInfo && b.texPerStamp;
    gl.uniform1f(P.u.uUseTex, useTex ? 1 : 0);
    if (ADV.texInfo) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ADV.texInfo.tex);
      gl.uniform1i(P.u.uTex, 1); gl.uniform1f(P.u.uTexDen, b.texDensity); gl.uniform2f(P.u.uTexScale, ADV.texInfo.w * b.texScale, ADV.texInfo.h * b.texScale); gl.uniform1f(P.u.uTexInv, b.texInvert ? 1 : 0); gl.uniform1f(P.u.uTexCon, b.texContrast || 0);
    } else { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ADV.blank); gl.uniform1i(P.u.uTex, 1); }
    gl.uniform1i(P.u.uTip, 0);
    const br = advBristle(b);
    // 털 수는 브러시 크기에 맞춰 줄인다 (털 하나가 2픽셀보다 가늘면 지글거림)
    gl.uniform1f(P.u.uBN, br ? Math.max(3, Math.min(br.count || 24, Math.floor(b.size / 2.2))) : 0);
    gl.uniform1f(P.u.uBStr, br ? (br.streak == null ? 0.5 : br.streak) : 0); gl.uniform1f(P.u.uBShape, br && br.shape === 'flat' ? 1 : 0);
    gl.uniform1f(P.u.uBVar, br ? (br.var || 0) : 0); gl.uniform1f(P.u.uRidge, br && br.knife ? 1 : 0);
    if (ADV.stroke && ADV.stroke.seed == null) ADV.stroke.seed = Math.random() * 50;
    gl.uniform1f(P.u.uBSeed, ADV.stroke ? ADV.stroke.seed : 0);
    gl.uniform1f(P.u.uPass, 0);
    const imp = advImp(b) && ADV.Hb;
    gl.bindBuffer(gl.ARRAY_BUFFER, ADV.ibuf);
    // 출(끝 가늘게): 획이 끝날 때 줄일 수 있도록 끝에서 taperOut 길이만큼의 도장은 붙잡아 둔다
    let todo = ADV.batch;
    const st = ADV.stroke;
    if (st && !st.ending && b.taperOut > 0) { const lim = st.dist - b.taperOut; todo = ADV.batch.filter((it) => it.dist <= lim); ADV.batch = ADV.batch.filter((it) => it.dist > lim); }
    else ADV.batch = [];
    if (!todo.length) { gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
    const groups = new Map();
    for (const it of todo) { const k = round ? 0 : it.ti; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it.d); }
    for (const [ti, list] of groups) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, round ? ADV.blank : ADV.tipTex[ti].tex);
      const arr = new Float32Array(list.length * INST);
      list.forEach((d, i) => arr.set(d, i * INST));
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STREAM_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, list.length);
      if (imp) { // 같은 도장을 두께 버퍼에도
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ADV.Hb, 0);
        gl.uniform1f(P.u.uPass, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, list.length); gl.uniform1f(P.u.uPass, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ADV.S, 0);
      }
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // 붓털·두께감·수채 물기 설정 (꺼져 있으면 null)
  const advBristle = (b) => (b && b.bristle && b.bristle.on ? b.bristle : null);
  const advImp = (b) => (b && b.impasto && b.impasto.depth > 0 ? b.impasto : null);
  const advWet = (b) => (b && b.wet && b.wet.on ? b.wet : null);
  // 화면·확정 셰이더의 물감 효과 (on=false: 이미 구운 그림이라 다시 적용하지 않음)
  function advFxUniforms(P, on, erase) {
    const gl = ADV.gl, b = ADV.brush, im = on && !erase && advImp(b) && ADV.Hb ? advImp(b) : null, w = on && !erase ? advWet(b) : null;
    const we = on && !erase && b && b.wedge && b.wedge.on ? b.wedge : null;
    gl.uniform1f(P.u.uImp, im ? im.depth : 0); gl.uniform1f(P.u.uShine, im ? (im.shine || 0) : 0);
    gl.uniform1f(P.u.uWet, w ? 1 : 0); gl.uniform1f(P.u.uWob, w ? (w.wobble == null ? 0.3 : w.wobble) : 0); gl.uniform1f(P.u.uGran, w ? (w.gran || 0) : 0); gl.uniform1f(P.u.uSoft, w ? (w.soft || 0) : 0);
    gl.uniform1f(P.u.uNzS, Math.max(24, (b ? b.size : 40) * 2.2));
    gl.uniform3f(P.u.uEdge, we ? Math.max(1, we.radius || 4) : 0, we ? (we.alpha == null ? 0.6 : we.alpha) : 0, we ? (we.value == null ? 0.3 : we.value) : 0);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, im ? ADV.Hb : ADV.blank); gl.uniform1i(P.u.uHb, 5);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, ADV.nz || ADV.blank); gl.uniform1i(P.u.uNz, 6);
    gl.activeTexture(gl.TEXTURE0);
  }
  function advFlushDual(P) {
    const gl = ADV.gl, du = advDual(ADV.brush);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ADV.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ADV.D, 0);
    gl.viewport(0, 0, ADV.W, ADV.H);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.p); gl.bindVertexArray(ADV.vao);
    gl.uniform2f(P.u.uDoc, ADV.W, ADV.H);
    const round = !ADV.dualTex;
    gl.uniform1f(P.u.uRound, round ? 1 : 0); gl.uniform1f(P.u.uHard, du ? du.hardness : 1); gl.uniform1f(P.u.uAA, 1); gl.uniform1f(P.u.uRibbon, 0); gl.uniform1f(P.u.uUseTex, 0);
    gl.uniform1f(P.u.uBN, 0); gl.uniform1f(P.u.uPass, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ADV.blank); gl.uniform1i(P.u.uTex, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, round ? ADV.blank : ADV.dualTex.tex); gl.uniform1i(P.u.uTip, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ADV.ibuf);
    const arr = new Float32Array(ADV.dbatch.length * INST);
    ADV.dbatch.forEach((d, i) => arr.set(d, i * INST));
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, ADV.dbatch.length);
    ADV.dbatch = [];
    gl.bindVertexArray(null);
  }
  function advShow() {
    const gl = ADV.gl, E = getEditor(), canvas = getCanvas(), b = ADV.brush;
    if (!gl || !E || !canvas || !b) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ADV.cv.width, ADV.cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!ADV.stroke && !ADV.cBox) return;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const P = ADV.P.show; gl.useProgram(P.p); gl.bindVertexArray(ADV.vao);
    const r = canvas.getBoundingClientRect(), k = canvas.width / (r.width || canvas.width), m = E.computedView.inverseTransform;
    gl.uniform3f(P.u.uInv0, m[0] / k, m[2] / k, m[4]); gl.uniform3f(P.u.uInv1, m[1] / k, m[3] / k, m[5]);
    gl.uniform1f(P.u.uH, ADV.cv.height); gl.uniform2f(P.u.uDoc, ADV.W, ADV.H); gl.uniform1f(P.u.uMode, 0);
    advTexUniforms(P);
    for (const [tex, op] of [[ADV.C, ADV.cBaked ? 1 : (ADV.cOp || 1)], [ADV.S, advOpacity()]]) {
      if (tex === ADV.C && !ADV.cBox) continue;
      if (tex === ADV.S && !ADV.stroke) continue;
      if (tex === ADV.C && ADV.cBaked) gl.uniform1f(P.u.uUseTex, 0); else advTexUniforms(P);
      advDualUniforms(P, tex === ADV.S && !!(advDual(b) && ADV.stroke));
      advFxUniforms(P, tex === ADV.S || !ADV.cBaked, tex === ADV.S ? ADV.stroke.erase : false);
      advCtxUniforms(P, tex === ADV.S ? ADV.stroke.ctx : ADV.cCtx);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(P.u.uS, 0);
      gl.uniform1f(P.u.uOp, op);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
  }
  // ----- 미리보기 = 결과 그대로 -----
  // 화면용 획은 Magma 그림 맨 위에 겹쳐 보이므로, 실제로 들어갈 모습과 같도록 그 자리의 정보를 타일(256칸)마다 읽어 둔다 (읽기 전용):
  //  · 위에 있는 보이는 레이어가 가리는 만큼 획을 감춘다 (밑 레이어에 그리면 위 그림 아래로 보임)
  //  · 클리핑된 레이어면 아래 레이어 모양 안에만, 선택 영역이 있으면 그 안에만
  //  · 투명색(지우개)은 회색 대신 지운 자리에 드러날 아래 그림(밑 레이어들 + 배경)을 보여 준다
  //  · 곱하기 합성·투명 픽셀 잠금은 지금 레이어 그림을 읽어 확정 때와 같은 계산
  const KT = 256;
  const CSS_BLEND = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
  const cssBlend = (m) => { const k = String(m || '').toLowerCase().replace(/[\s_]+/g, '-').replace(/^colou?r-?(dodge|burn)$/, 'color-$1').replace(/^(hard|soft)-?light$/, '$1-light'); return CSS_BLEND.has(k) ? k : ''; };
  const layerShown = (L) => !!L && (L.visibleLocally != null ? !!L.visibleLocally : L.visible !== false);
  // 그릴 수 없는 레이어면 그 까닭 (획을 시작하기 전에 막는다 — 그려진 뒤에 안 된다고 뜨지 않게)
  function layerDrawBlock(L) {
    if (!L) return null;
    if (!layerShown(L) || L.visible === false) return '숨겨진 레이어에는 그릴 수 없어요 — 레이어의 눈 아이콘을 켜 주세요';
    if (L.locked) return '잠긴 레이어에는 그릴 수 없어요 — 레이어 잠금을 풀어 주세요';
    return null;
  }
  function advCtxStart(s, b) {
    const E = getEditor(), L = E && msActive(E);
    if (!E || !L) return null;
    const Ls = E.drawing.layers, ai = Ls.indexOf(L);
    if (ai < 0) return null;
    const baseOf = (i) => { let j = i; while (j < Ls.length && Ls[j].clippingGroup) j++; return j < Ls.length ? j : -1; };
    const ctx = { E, L, erase: !!s.erase, mul: !s.erase && (b.blend === 'multiply' || b.blend === 'glaze'), km: !s.erase && b.blend === 'glaze', kmVis: !s.erase && b.blend === 'glaze' && !cssBlend(L.mode), lock: !!L.opacityLocked, op: Number.isFinite(L.opacity) ? L.opacity : 1,
      up: [], low: [], clipBase: null, tiles: new Set(), bg: [1, 1, 1] };
    for (let i = 0; i < ai; i++) { // 위 레이어 (보통 합성만 가린다고 본다)
      const U = Ls[i], op = Number.isFinite(U.opacity) ? U.opacity : 1;
      if (!layerShown(U) || op <= 0 || cssBlend(U.mode)) continue;
      let base = null;
      if (U.clippingGroup) { const bi = baseOf(i); if (bi < 0 || !layerShown(Ls[bi])) continue; if (bi !== ai) base = Ls[bi]; }
      ctx.up.push({ L: U, op, base });
    }
    if (L.clippingGroup) { const bi = baseOf(ai); ctx.clipBase = bi >= 0 ? Ls[bi] : null; }
    const prev = ADV.cBox && ADV.cCtx; // 지난 획이 아직 화면에 있으면 그 계산도 함께 (같은 타일을 다시 읽으므로)
    ctx.wantB = ctx.erase || ctx.kmVis || !!(prev && prev.wantB);
    if (ctx.wantB) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(E.drawing.background || ''));
      if (m) { const n = parseInt(m[1], 16); ctx.bg = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
      for (let i = Ls.length - 1; i > ai; i--) {
        const D = Ls[i], op = Number.isFinite(D.opacity) ? D.opacity : 1;
        if (!layerShown(D) || op <= 0) continue;
        let base = null;
        if (D.clippingGroup) { const bi = baseOf(i); if (bi < 0 || !layerShown(Ls[bi])) continue; base = Ls[bi]; }
        ctx.low.push({ L: D, op, base, mode: cssBlend(D.mode) });
      }
    }
    const se = E.model.user.selection;
    ctx.sel = se && se.bounds && se.bounds.w > 0 && se.poly && Array.isArray(se.poly.segments) ? se : null;
    ctx.needK = ctx.wantB || ctx.up.length > 0 || !!ctx.clipBase || !!ctx.sel || !!(prev && prev.needK);
    ctx.needA = ctx.mul || ctx.lock || !!(prev && prev.needA);
    return ctx;
  }
  function advCtxTex(fmtKey) {
    const gl = ADV.gl;
    if (ADV[fmtKey]) return ADV[fmtKey];
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ADV.W, ADV.H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ADV[fmtKey] = t;
    return t;
  }
  function advCtxLoad(ctx, box) {
    if (!ctx || !box || !(ctx.needK || ctx.needA) || !ADV.gl) return;
    const b = rclip(box, ADV.W, ADV.H);
    if (!b) return;
    for (let ty = Math.floor(b.y / KT); ty <= Math.floor((b.y + b.h - 1) / KT); ty++)
      for (let tx = Math.floor(b.x / KT); tx <= Math.floor((b.x + b.w - 1) / KT); tx++) {
        const key = tx + ',' + ty;
        if (ctx.tiles.has(key)) continue;
        ctx.tiles.add(key);
        try { advCtxTile(ctx, { x: tx * KT, y: ty * KT, w: Math.min(KT, ADV.W - tx * KT), h: Math.min(KT, ADV.H - ty * KT) }); }
        catch (e) { console.warn('[MagmaWand] 미리보기 정보 읽기', e); }
      }
  }
  function advCtxTile(ctx, r) {
    const gl = ADV.gl, E = ctx.E, n = r.w * r.h, cache = new Map();
    const get = (L) => { if (!cache.has(L)) { let d = null; try { d = readLayerEff(E, L, r); } catch { } cache.set(L, d); } return cache.get(L); };
    const up = (tex, data) => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, data); };
    if (ctx.needK) {
      const vis = new Float32Array(n).fill(1);
      for (const u of ctx.up) {
        const d = get(u.L), bd = u.base ? get(u.base) : null;
        if (!d) continue;
        for (let i = 0; i < n; i++) { const a = d[i * 4 + 3]; if (!a) continue; let f = a / 255 * u.op; if (bd) f *= bd[i * 4 + 3] / 255; vis[i] *= 1 - f; }
      }
      if (ctx.clipBase) { const d = get(ctx.clipBase); for (let i = 0; i < n; i++) vis[i] *= d ? d[i * 4 + 3] / 255 : 0; }
      if (ctx.sel) {
        const se = ctx.sel, oc = new OffscreenCanvas(r.w, r.h), g = oc.getContext('2d', { willReadFrequently: true }), path = new Path2D();
        for (const sg of se.poly.segments) {
          for (let i = 0; i < sg.size; i++) { const x = se.poly.ox + +sg.items[i * 2] - r.x, y = se.poly.oy + +sg.items[i * 2 + 1] - r.y; i ? path.lineTo(x, y) : path.moveTo(x, y); }
          path.closePath();
        }
        g.fillStyle = '#000'; g.fill(path, 'evenodd');
        const mk = g.getImageData(0, 0, r.w, r.h).data;
        for (let i = 0; i < n; i++) vis[i] *= mk[i * 4 + 3] / 255;
      }
      const K = new Uint8Array(n * 4);
      if (ctx.wantB) { // 지운 자리에 드러날 그림 = 배경 + 아래 레이어들 (물감 겹치기도 이 위에서 섞는다)
        const B = advBelow(ctx, n, get);
        for (let i = 0; i < n; i++) { K[i * 4] = B[i * 3] * 255 + 0.5; K[i * 4 + 1] = B[i * 3 + 1] * 255 + 0.5; K[i * 4 + 2] = B[i * 3 + 2] * 255 + 0.5; }
      }
      for (let i = 0; i < n; i++) K[i * 4 + 3] = vis[i] * 255 + 0.5;
      up(advCtxTex('K'), K);
    }
    if (ctx.needA) { const d = get(ctx.L); up(advCtxTex('A'), d ? new Uint8Array(d.buffer, d.byteOffset, d.length) : new Uint8Array(n * 4)); }
  }
  // 현재 레이어 아래로 보이는 그림 (배경 + 아래 레이어들, 0~1 RGB) — 읽기 전용
  function advBelow(ctx, n, get) {
    const B = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { B[i * 3] = ctx.bg[0]; B[i * 3 + 1] = ctx.bg[1]; B[i * 3 + 2] = ctx.bg[2]; }
    for (const lo of ctx.low) {
      const d = get(lo.L), bd = lo.base ? get(lo.base) : null;
      if (!d) continue;
      for (let i = 0; i < n; i++) {
        let a = d[i * 4 + 3]; if (!a) continue;
        a = a / 255 * lo.op; if (bd) a *= bd[i * 4 + 3] / 255; if (a <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const cs = d[i * 4 + c] / 255, cb = B[i * 3 + c];
          const m = lo.mode === 'multiply' ? cs * cb : lo.mode === 'screen' ? cs + cb - cs * cb : lo.mode === 'darken' ? Math.min(cs, cb) : lo.mode === 'lighten' ? Math.max(cs, cb) : cs;
          B[i * 3 + c] = cb + (m - cb) * a;
        }
      }
    }
    return B;
  }
  function advCtxUniforms(P, ctx) {
    const gl = ADV.gl, on = !!ctx;
    gl.uniform1f(P.u.uCtx, on ? 1 : 0);
    gl.uniform1f(P.u.uUseK, on && ctx.needK && ADV.K ? 1 : 0);
    gl.uniform1f(P.u.uUseA, on && ctx.needA && ADV.A ? 1 : 0);
    gl.uniform1f(P.u.uErase, on && ctx.erase ? 1 : 0);
    gl.uniform1f(P.u.uMul, on && ctx.mul ? (ctx.kmVis ? 3 : ctx.km ? 2 : 1) : 0);
    gl.uniform1f(P.u.uLock, on && ctx.lock ? 1 : 0);
    gl.uniform1f(P.u.uLop, on ? ctx.op : 1);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ADV.K || ADV.blank); gl.uniform1i(P.u.uK, 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ADV.A || ADV.blank); gl.uniform1i(P.u.uA, 4);
    gl.activeTexture(gl.TEXTURE0);
  }
  const advDual = (b) => (b && b.dual && !b.dualOff ? b.dual : null);
  function advDualUniforms(P, on) {
    const gl = ADV.gl;
    gl.uniform1f(P.u.uUseD, on ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, on && ADV.D ? ADV.D : ADV.blank); gl.uniform1i(P.u.uD, 2);
    gl.activeTexture(gl.TEXTURE0);
  }
  function advTexUniforms(P) {
    const gl = ADV.gl, b = ADV.brush, useTex = ADV.texInfo && !b.texPerStamp;
    gl.uniform1f(P.u.uUseTex, useTex ? 1 : 0);
    gl.uniform1f(P.u.uTexMode, useTex && b.texMode === 'height' ? 1 : 0); gl.uniform1f(P.u.uTexFloor, b.texFloor == null ? 0.12 : b.texFloor);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, useTex ? ADV.texInfo.tex : ADV.blank); gl.uniform1i(P.u.uTex, 1);
    if (useTex) { gl.uniform1f(P.u.uTexDen, b.texDensity); gl.uniform2f(P.u.uTexScale, ADV.texInfo.w * b.texScale, ADV.texInfo.h * b.texScale); gl.uniform1f(P.u.uTexInv, b.texInvert ? 1 : 0); gl.uniform1f(P.u.uTexCon, b.texContrast || 0); }
  }
  const advOpacity = () => (ADV.brush ? ADV.brush.opacity : 1) * (S.advOpacity == null ? 1 : S.advOpacity / 100);
  function advFrame() {
    ADV.raf = 0;
    if (ADV.lost) return;
    try {
      advFlush();
      if (ADV.stroke && ADV.stroke.ctx) advCtxLoad(ADV.stroke.ctx, ADV.stroke.box);
      if (ADV.cBox && ADV.cCtx) advCtxLoad(ADV.cCtx, ADV.cBox);
      advShow();
    } catch (e) { console.warn('[MagmaWand] 고급 브러시', e); }
    if (ADV.stroke || ADV.cBox) ADV.raf = requestAnimationFrame(advFrame);
  }
  // 획 끝: 보드 크기 PNG로 만들어 Magma에 한 번 붙여넣는다
  async function advStrokeEnd(cancel) {
    const s = ADV.stroke;
    if (!s) return;
    // 손떨림 보정으로 뒤처진 끝을 펜을 뗀 자리까지 이어 준다 (클립 스튜디오처럼 획이 손 뗀 곳에서 끝남)
    if (!cancel && s.rawLast && s.last && ADV.brush && ADV.brush.smoothing > 0 && Math.hypot(s.rawLast.x - s.last.x, s.rawLast.y - s.last.y) > 0.5) {
      s.straight = true; advAddPoint(advEvAt(s.rawLast, { pointerType: s.ptype, timeStamp: s.rawLast.t + 16 })); s.straight = false;
    }
    if (s.pend) { const p0 = s.pend; s.pend = null; advStamp(p0.x, p0.y, p0.p, 0, 0); } // 한 번 콕 찍기
    s.ending = true;
    const bb = ADV.brush;
    if (bb && bb.taperOut > 0) for (const it of ADV.batch) { const f = Math.max(0.12, Math.min(1, (s.dist - it.dist) / bb.taperOut)); it.d[2] *= f; }
    advFlush();
    ADV.stroke = null;
    if (s.last) ADV.lastEnd = { x: s.last.x, y: s.last.y, p: s.last.p }; // Shift+클릭 직선용
    const gl = ADV.gl;
    const box = rclip(s.box || { x: 0, y: 0, w: 0, h: 0 }, ADV.W, ADV.H);
    if (cancel || !box) { advClear(ADV.S, box); if (ADV.D && box) advClear(ADV.D, box); if (ADV.Hb && box) advClear(ADV.Hb, box); advKick(); return; }
    // 확정용: 획 버퍼 × 불투명도 × 획 단위 텍스처를 box 크기로 잘라 읽는다
    const op = advOpacity();
    const out = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, out); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, box.w, box.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ADV.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.viewport(0, 0, box.w, box.h); gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const P = ADV.P.show; gl.useProgram(P.p); gl.bindVertexArray(ADV.vao);
    gl.uniform1f(P.u.uMode, 1); gl.uniform2f(P.u.uOff, box.x, box.y); gl.uniform2f(P.u.uDoc, ADV.W, ADV.H); gl.uniform1f(P.u.uOp, op);
    advCtxUniforms(P, null);
    advTexUniforms(P);
    advDualUniforms(P, !!advDual(ADV.brush));
    advFxUniforms(P, true, s.erase);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ADV.S); gl.uniform1i(P.u.uS, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(box.w * box.h * 4);
    gl.readPixels(0, 0, box.w, box.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null); gl.deleteTexture(out);
    if (ADV.D) advClear(ADV.D, box);
    if (ADV.Hb) advClear(ADV.Hb, box);
    // 화면에는 확정될 때까지 남겨 둔다 (S ↔ C 바꾸고 새 S는 비움)
    if (ADV.cBox) advClear(ADV.C, ADV.cBox);
    const t = ADV.C; ADV.C = ADV.S; ADV.S = t; ADV.cBox = box; ADV.cOp = op; ADV.cBaked = false; ADV.cCtx = s.ctx || null;
    if (ADV.cCtx) advCtxLoad(ADV.cCtx, box);
    // px = 일반 알파(GPU에서 미리곱셈을 풀어 줌; 수채 경계·두께감은 셰이더에서 이미 들어감) — 선택 밖 잘라내기
    advClipToSelection(px, box, false);
    let any = false;
    for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break; }
    advBake(px, box); // 화면에는 실제로 들어갈 모습 그대로
    advKick();
    const blend = !s.erase && bb && (bb.blend === 'multiply' || bb.blend === 'glaze') ? bb.blend : 'normal';
    // 붙여넣은 그림이 레이어에 실제로 들어간 걸 본 그 다음 프레임에 미리보기를 지운다 (진해졌다 연해지는 깜빡임 없음)
    const clearNow = () => { clearTimeout(ADV.cTimer); if (ADV.cBox === box) { advClear(ADV.C, box); ADV.cBox = null; ADV.cBaked = false; ADV.cCtx = null; if (ADV.cv && !ADV.stroke) ADV.cv.style.mixBlendMode = ''; advShow(); advKick(); } };
    const done = () => requestAnimationFrame(clearNow);
    ADV.cTimer = setTimeout(clearNow, 4000); // 혹시 확인이 안 되면
    if (!any) { done(); return; }
    if (s.erase) { // 투명색: 그 질감 그대로 지우기
      ADV.commitQ = ADV.commitQ.then(() => advEraseCommit(px, box, clearNow)).catch((e) => { console.warn('[MagmaWand] 지우기 실패', e); toast('지우지 못했어요: ' + (e && e.message || e)); }).finally(done);
      return;
    }
    ADV.commitQ = ADV.commitQ.then(async () => {
      try {
        const E = getEditor(), L = E && msActive(E);
        const vis = blend === 'glaze' && s.ctx && s.ctx.kmVis ? advVisBelow(s.ctx, box) : null; // 보이는 그림(현재 레이어 아래)
        if (E && L && L.opacityLocked) { await advLockedCommit(E, L, px, box, blend, clearNow, vis); return; } // 투명 픽셀 잠금
        await advPastePx(E, L, blend !== 'normal' && E && L ? advMultiplyPx(E, L, px, box, blend === 'glaze', vis) : px, box, clearNow);
      } catch (e) {
        console.warn('[MagmaWand] 획 붙이기 실패', e);
        toast('획을 보드에 넣지 못했어요: ' + (e && e.message || e));
      } finally { done(); }
    });
  }

  // ----- 획 확정 도우미: 구운 미리보기 · 수채 경계 · 곱하기 -----
  // 확정할 그림(px, 일반 알파)을 화면용 버퍼 C에 그대로 올려 둔다 → 붙여넣은 그림과 똑같은 모습이라 바뀌는 순간이 안 보인다
  function advBake(px, box) {
    const gl = ADV.gl;
    if (!gl || !ADV.C) return;
    gl.bindTexture(gl.TEXTURE_2D, ADV.C);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (ADV.float) {
      const f = new Float32Array(px.length);
      for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; f[i] = px[i] / 255 * a; f[i + 1] = px[i + 1] / 255 * a; f[i + 2] = px[i + 2] / 255 * a; f[i + 3] = a; }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, box.x, box.y, box.w, box.h, gl.RGBA, gl.FLOAT, f);
    } else {
      const u = new Uint8Array(px.length);
      for (let i = 0; i < px.length; i += 4) { const a = px[i + 3]; u[i] = px[i] * a / 255; u[i + 1] = px[i + 1] * a / 255; u[i + 2] = px[i + 2] * a / 255; u[i + 3] = a; }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, box.x, box.y, box.w, box.h, gl.RGBA, gl.UNSIGNED_BYTE, u);
    }
    ADV.cBaked = true;
  }
  // 곱하기 합성 획: 레이어 그림 × 획 색 (투명한 곳은 그냥 칠함) → 비우기 + 붙여넣기 (되돌리기 2칸, 묶음 되돌리기로 한 번에)
  // 곱하기 합성 획을 붙여넣기 한 번으로: 붙여넣기(보통 겹치기)의 결과가 곱하기와 같아지는 색 X를 픽셀마다 계산해 넣는다.
  //  보통 겹치기: Co = As·X + (1−As)·Ab·Cb,  곱하기(W3C): Co = As(1−Ab)Cs + As·Ab·Cb·Cs + (1−As)Ab·Cb  →  X = (1−Ab)·Cs + Ab·Cb·Cs
  //  물감 겹치기(km): 곱하기 자리에 감산 혼합 kmGlaze(Cb, Cs)를 쓴다 (같은 꼴: X = (1−Ab)·Cs + Ab·mix)
  //  vis(보통 레이어의 물감 겹치기): 화면에 보이는 색 V = Ab·Cb + (1−Ab)·아래 그림. 보통 겹치기로 붙여도 결과가 V와 물감 Cs의
  //  감산 혼합이 되려면 X = km(V, Cs) (Co = As·X + (1−As)·V 이므로 정확). 다른 레이어 위에 칠해도 노랑+파랑 = 초록(회색 아님).
  function advVisBelow(ctx, box) {
    const cache = new Map(), get = (L) => { if (!cache.has(L)) { let d = null; try { d = readLayerEff(ctx.E, L, box); } catch { } cache.set(L, d); } return cache.get(L); };
    return advBelow(ctx, box.w * box.h, get);
  }
  function advMultiplyPx(E, L, px, box, km, vis) {
    const before = readLayerEff(E, L, box), out = new Uint8Array(px.length);
    for (let i = 0; i < px.length; i += 4) {
      const As = px[i + 3]; if (!As) continue;
      const Ab = before[i + 3] / 255;
      if (vis) { const j = (i >> 2) * 3; for (let c = 0; c < 3; c++) { const V = Ab * before[i + c] / 255 + (1 - Ab) * vis[j + c]; out[i + c] = Math.round(kmGlaze(V, px[i + c] / 255) * 255); } out[i + 3] = As; continue; }
      for (let c = 0; c < 3; c++) { const Cs = px[i + c] / 255, Cb = before[i + c] / 255; out[i + c] = Math.round(Math.min(1, (1 - Ab) * Cs + Ab * (km ? kmGlaze(Cb, Cs) : Cb * Cs)) * 255); }
      out[i + 3] = As;
    }
    return out;
  }
  // 투명 픽셀 잠금 레이어: 있는 그림의 투명도는 그대로 두고 색만 바꾼다 (붙여넣기는 잠금을 안 지키므로 비우기+붙여넣기로, 실측)
  async function advLockedCommit(E, L, px, box, blend, onLanded, vis) {
    const before = readLayerEff(E, L, box), after = new Uint8ClampedArray(before);
    let any = false;
    for (let i = 0; i < px.length; i += 4) {
      const As = px[i + 3] / 255, Ab = before[i + 3];
      if (!As || !Ab) continue;
      any = true;
      for (let c = 0; c < 3; c++) {
        const Cs = px[i + c] / 255, Cb = before[i + c] / 255, src = blend === 'multiply' ? Cb * Cs : blend === 'glaze' ? kmGlaze(vis ? Ab / 255 * Cb + (1 - Ab / 255) * vis[(i >> 2) * 3 + c] : Cb, Cs) : Cs;
        after[i + c] = Math.round((Cb + (src - Cb) * As) * 255);
      }
    }
    if (!any) { onLanded?.(); return; }
    await replaceLayerRegion(E, L, box, before, after, '칠하지', onLanded);
  }
  async function advPastePx(E, L, px, box, onLanded) {
    const oc = new OffscreenCanvas(ADV.W, ADV.H);
    oc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, px.length), box.w, box.h), box.x, box.y);
    const blob = await oc.convertToBlob({ type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'brush.png', { type: 'image/png' }));
    const probe = E && L ? landProbe(E, L, px, box) : null;
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    if (probe) await swapWhenLanded(probe.check, onLanded); else onLanded?.();
  }

  // ---------- 고급 브러시 ③ 도구 연결 (입력·커서·브러시 고르기) ----------
  let advSaveTimer = 0;
  function advSaveSoon() { clearTimeout(advSaveTimer); advSaveTimer = setTimeout(() => { if (ADV.brush) advSaveBrush(ADV.brush).catch(() => { }); }, 600); }
  async function advSelect(id) {
    const list = await advListBrushes();
    const b = list.find((x) => x.id === id) || list[0] || null;
    if (!b) { ADV.brush = null; S.advBrushId = null; saveSettings(); return null; }
    S.advBrushId = b.id; saveSettings();
    try { await advPrepare(b); } catch (e) { console.warn('[MagmaWand] 브러시 준비 실패', e); toast('브러시를 준비하지 못했어요: ' + (e && e.message || e)); return null; }
    S.advSize = Math.round(b.size * 10) / 10;
    rowsEl?.__mwSync?.();
    return b;
  }
  function advCursor(cx, cy, show) {
    if (!Q.cursor) { Q.cursor = document.createElement('div'); Q.cursor.className = 'mw-brush mw-el'; document.body.appendChild(Q.cursor); }
    if (!show || !ADV.brush) { Q.cursor.style.display = 'none'; return; }
    const d = Math.max(4, (S.advSize > 0 ? S.advSize : ADV.brush.size) * viewZoom());
    Object.assign(Q.cursor.style, { display: 'block', width: d + 'px', height: d + 'px', left: (cx - d / 2) + 'px', top: (cy - d / 2) + 'px' });
  }
  function advPointerDown(e) {
    if (ADV.stroke || BSZ.on) return;
    if (!ADV.brush) { toast('먼저 오른쪽 설정 칸에서 브러시(.sut)를 가져와 주세요'); return; }
    if (ADV.brush.erase) { toast('이 브러시는 지우개·특수 합성이라 아직 쓸 수 없어요'); return; }
    if (ADV.brush.tips.length && !ADV.tipTex.length && !ADV.proc) { toast('이 브러시는 끝 모양 PNG가 필요해요 — 설정 칸의 "끝 모양 PNG 넣기"를 눌러 주세요'); return; }
    const E = getEditor();
    if (!E) return;
    const L = E.model.user.activeLayers && E.model.user.activeLayers[0];
    if (!L) { toast('그릴 레이어를 먼저 골라 주세요'); return; }
    if (L.textData) { toast('글자 레이어에는 그릴 수 없어요 — 그림 레이어를 골라 주세요'); return; }
    const why = layerDrawBlock(L);
    if (why) { toast(why); return; }
    if (E.model.settings && E.model.settings.pasteNewLayer) toast('주의: Magma 설정 "붙여넣기를 새 레이어로"가 켜져 있어 획마다 새 레이어가 생겨요');
    advEnsureGL(getCanvas(), E.drawing.w, E.drawing.h);
    ADV.pid = e.pointerId;
    // Shift+클릭: 지난 획 끝에서 여기까지 곧은 선 (Magma 브러시·클립 스튜디오와 같음)
    if (e.shiftKey && ADV.lastEnd) { advStrokeStart(advEvAt(ADV.lastEnd, e)); ADV.stroke.straight = true; advAddPoint(e); ADV.stroke.straight = false; return; }
    advStrokeStart(e);
  }
  function advPointerMove(e) {
    if (!ADV.stroke || e.pointerId !== ADV.pid) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ce of (evs.length ? evs : [e])) advAddPoint(ce);
  }
  // ----- 색 혼합 (클립 스튜디오 '색 혼합': 블렌드 / 물감 섞기) -----
  // 도장마다 그 자리 밑그림 색(현재 레이어, 또는 보이는 그림 전체)을 읽어(읽기 전용) 브러시 색과 섞는다.
  //  - 블렌드: 도장 색 = 밑색과 메인 색을 물감량만큼 섞은 색 (따라오는 색 없음)
  //  - 물감 섞기: 붓에 묻은 색(K)을 들고 다닌다. 도장 색 = K와 메인 색을 물감량만큼 섞은 색, 찍은 뒤 K는 밑색을 (1 − 색 늘이기)만큼 묻혀 온다.
  //  - 물감 농도: 낮을수록 묻혀 온 투명함까지 그대로 옮겨 묽게 칠해진다.
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  // ----- 감산 혼합 (쿠벨카-뭉크, 채널마다): 물감은 빛을 흡수(K)·산란(S)한다. 반사율 R ↔ K/S로 바꿔 더하거나 섞은 뒤 되돌린다.
  //  노랑+파랑 = 초록(곱하기는 어두운 탁색, 그냥 평균은 회색). 흰 종이 위 = 그 색 그대로, 검정 위 = 검정 그대로.
  const kmKS = (r) => { r = Math.min(0.996, Math.max(0.004, r)); return (1 - r) * (1 - r) / (2 * r); };
  const kmR = (k) => 1 + k - Math.sqrt(k * k + 2 * k);
  const kmGlaze = (cb, cs) => kmR(kmKS(cb) + kmKS(cs)); // 투명한 물감 막을 겹쳐 칠함(수채 덧칠)
  // 두 색(미리곱셈 RGBA)을 t만큼 섞기: 색은 K/S 공간에서 물감 양(알파)만큼, 알파는 그대로 선형
  function kmLerp4(a, b, t) {
    const wa = (1 - t) * a[3], wb = t * b[3], w = wa + wb, A = a[3] + (b[3] - a[3]) * t;
    if (w <= 1e-6) return lerp4(a, b, t);
    const o = [0, 0, 0, A];
    for (let c = 0; c < 3; c++) {
      const ca = a[3] > 1e-6 ? a[c] / a[3] : 1, cb = b[3] > 1e-6 ? b[c] / b[3] : 1;
      o[c] = kmR((wa * kmKS(ca) + wb * kmKS(cb)) / w) * A;
    }
    return o;
  }
  const lerp4 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  function advMixStart(b) {
    const E = getEditor();
    const m = { E, L: E && msActive(E), ref: b.mix.ref || 'layer', tiles: new Map(), K: null, snap: null, W: E ? E.drawing.w : 0, H: E ? E.drawing.h : 0 };
    if (m.ref === 'all') { try { m.snap = E.renderer.getDrawingSnapshotAsBinary(E.drawing); } catch { m.snap = null; } if (!m.snap) m.ref = 'layer'; }
    return m;
  }
  function advMixPixel(m, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= m.W || y >= m.H) return null;
    let d, i;
    if (m.ref === 'all') { d = m.snap; i = (y * m.W + x) * 4; }
    else {
      if (!m.L) return null;
      const T = 128, tx = Math.floor(x / T), ty = Math.floor(y / T), key = tx + ',' + ty;
      let t = m.tiles.get(key);
      if (!t) {
        const r = { x: tx * T, y: ty * T, w: Math.min(T, m.W - tx * T), h: Math.min(T, m.H - ty * T) };
        let px = null; try { px = readLayerEff(m.E, m.L, r); } catch { }
        t = { r, d: px }; m.tiles.set(key, t);
      }
      if (!t.d) return null;
      d = t.d; i = ((y - t.r.y) * t.r.w + (x - t.r.x)) * 4;
    }
    const a = d[i + 3] / 255;
    return [d[i] / 255 * a, d[i + 1] / 255 * a, d[i + 2] / 255 * a, a];
  }
  // 도장 안쪽 9곳의 평균 (미리곱셈 RGBA, 0~1)
  function advMixSample(m, cx, cy, r) {
    const o = Math.max(0.5, r * 0.4), acc = [0, 0, 0, 0];
    let k = 0;
    for (const dy of [-o, 0, o]) for (const dx of [-o, 0, o]) { const c = advMixPixel(m, cx + dx, cy + dy); if (!c) continue; acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += c[3]; k++; }
    return k ? acc.map((v) => v / k) : [0, 0, 0, 0];
  }
  function advMixColor(s, b, x, y, size, p) {
    const mx = b.mix, m = s.mix;
    const U = advMixSample(m, x, y, size / 2);
    const M = [s.color[0], s.color[1], s.color[2], 1];
    const amt = clamp01(mx.amount * effectorValue(mx.amountEff, p, s.speed, Math.random()));
    const den = clamp01(mx.density * effectorValue(mx.densEff, p, s.speed, Math.random()));
    let B;
    // 색은 물감처럼 감산 혼합(노랑+파랑 = 초록, 회색 탁색이 아님)
    if (mx.mode === 'blend') B = kmLerp4(U, M, amt);
    else {
      if (!m.K) m.K = U; // 처음 닿은 곳의 색을 묻히고 시작
      B = kmLerp4(m.K, M, amt);
      m.K = kmLerp4(B, U, clamp01(1 - mx.stretch) * 0.6);
    }
    const a = B[3];
    const c = a > 0.004 ? [clamp01(B[0] / a), clamp01(B[1] / a), clamp01(B[2] / a)] : s.color;
    return { c, a: a + (Math.max(a, amt) - a) * den }; // 물감 농도: 묻힌 물감이 메인 색만큼은 진하게 (없던 색을 만들지는 않음)
  }
  // 선택 영역이 있으면 획을 그 안으로 잘라낸다 (px = 미리곱셈 RGBA, box 크기, 위에서 아래 줄 순서)
  function advClipToSelection(px, box, premult = true) {
    const E = getEditor();
    const se = E && E.model.user.selection, sb = se && se.bounds;
    if (!sb || !(sb.w > 0) || !(sb.h > 0) || !se.poly || !Array.isArray(se.poly.segments)) return;
    const oc = new OffscreenCanvas(box.w, box.h), g = oc.getContext('2d', { willReadFrequently: true });
    const path = new Path2D();
    for (const sg of se.poly.segments) {
      for (let i = 0; i < sg.size; i++) { const x = se.poly.ox + +sg.items[i * 2] - box.x, y = se.poly.oy + +sg.items[i * 2 + 1] - box.y; i ? path.lineTo(x, y) : path.moveTo(x, y); }
      path.closePath();
    }
    g.fillStyle = '#000'; g.fill(path, 'evenodd');
    const mk = g.getImageData(0, 0, box.w, box.h).data;
    for (let i = 0; i < px.length; i += 4) {
      const k = mk[i + 3];
      if (k === 255) continue;
      if (!k) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; continue; }
      if (premult) { px[i] = px[i] * k / 255; px[i + 1] = px[i + 1] * k / 255; px[i + 2] = px[i + 2] * k / 255; }
      px[i + 3] = px[i + 3] * k / 255;
    }
  }
  // 보드 좌표의 점을 사용자 입력처럼 (Shift+클릭 직선의 시작점)
  function advEvAt(pt, e) {
    const E = getEditor(), c = getCanvas(), r = c.getBoundingClientRect(), m = E.computedView.transform;
    return { clientX: r.left + m[0] * pt.x + m[2] * pt.y + m[4], clientY: r.top + m[1] * pt.x + m[3] * pt.y + m[5],
      pressure: pt.p, pointerType: e.pointerType, timeStamp: (e.timeStamp || performance.now()) - 30 };
  }

  // ----- Alt 스포이트 (고급 브러시·마법봉 '채우기') -----
  // Magma 브러시처럼 Alt를 누른 채 누르면 색을 고른다. 누르는 동안 스포이트 고리가 보이고, 손을 떼는 곳의 색이 지금 색이 된다.
  // 색은 Magma 색 칸(오른쪽 위 16진수 칸)에 넣는다 — 사용자가 직접 입력하는 것과 같다. 투명한 곳을 고르면 투명색이 된다.
  const AEYE = { pid: null, block: false };
  const ownColorTool = () => S.active && (S.tool === 'brush' || (S.tool === 'wand' && S.action === 'fill'));
  function setPrimaryHex(hex) {
    const inp = [...document.querySelectorAll('editor-color input, .container1 input')].find((x) => /^[0-9a-f]{6}$/i.test(x.value));
    if (!inp) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inp.focus(); set.call(inp, hex);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    inp.blur();
    return true;
  }
  function eyePick(cx, cy) {
    const E = getEditor(), canvas = getCanvas();
    if (!E || !EYE.snap) return null;
    const m = E.computedView.inverseTransform, r = canvas.getBoundingClientRect();
    const x = Math.floor(m[0] * (cx - r.left) + m[2] * (cy - r.top) + m[4]), y = Math.floor(m[1] * (cx - r.left) + m[3] * (cy - r.top) + m[5]);
    if (x < 0 || y < 0 || x >= EYE.W || y >= EYE.H) return null;
    const i = (y * EYE.W + x) * 4, d = EYE.snap;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }
  function onOwnEye(e) {
    if (!e.isTrusted) return;
    if (AEYE.pid !== null) {
      e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
      if (e.type === 'pointermove' && e.pointerId === AEYE.pid && EYE.el) eyeRender(e.clientX, e.clientY);
      if ((e.type === 'pointerup' || e.type === 'pointercancel') && e.pointerId === AEYE.pid) {
        const c = e.type === 'pointerup' ? eyePick(e.clientX, e.clientY) : null;
        AEYE.pid = null; AEYE.block = true; eyeEnd();
        setTimeout(() => { AEYE.block = false; }, 400);
        if (c) {
          if (!c[3]) { if (!S.alpha) setAlpha(true); }
          else { if (S.alpha) setAlpha(false); setPrimaryHex(c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')); }
        }
      }
      return;
    }
    if (AEYE.block && (e.type === 'mouseup' || e.type === 'click')) { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); if (e.type === 'click') AEYE.block = false; return; }
    if (e.type !== 'pointerdown' || e.button !== 0 || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!ownColorTool() || S.busy || ADV.stroke || e.target !== getCanvas()) return;
    e.stopImmediatePropagation(); e.preventDefault();
    eyeStart(e);
    AEYE.pid = e.pointerId;
  }
  // 설정 칸: 브러시 목록 + 가져오기 + 끝 모양 PNG 넣기
  let advListRender = null;
  function advBuildRows(tplBtn) {
    const box = document.createElement('div');
    box.className = 'mw-advbox mw-el';
    const mkBtn = (text, cls = 'sm btn secondary') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; return b; };
    const list = document.createElement('div'); list.className = 'mw-advlist';
    const actions = document.createElement('div'); actions.className = 'mw-advacts';
    const info = document.createElement('div'); info.className = 'mw-advinfo';
    const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = '.sut'; fileIn.multiple = true; fileIn.style.display = 'none';
    const imp = mkBtn('＋ 브러시 가져오기 (.sut)');
    const nb = mkBtn('＋ 기본 브러시');
    nb.title = '클립 스튜디오 파일 없이, 기본 끝 모양으로 새 브러시를 만들어요';
    const png = mkBtn('끝 모양 바꾸기');
    const gear = mkBtn('⚙ 브러시 설정');
    gear.title = '크기·잉크·색 혼합(물감 섞기)·끝 모양·획·스프레이·텍스처·색 흔들기를 하나하나 바꿔요';
    const del = mkBtn('지우기');
    actions.append(gear, imp, nb, png, del, fileIn);
    nb.textContent = '＋ 새 브러시 (프리셋)';
    nb.title = '연필·G펜·수채·유화(물감 섞기)·손끝·에어브러시·스프레이 등 프리셋으로 새 브러시를 만들어요';
    nb.addEventListener('click', (e) => { e.preventDefault(); openPresetPicker(render); });
    gear.addEventListener('click', (e) => { e.preventDefault(); openBrushSettings(); });
    box.append(list, actions, info);
    imp.addEventListener('click', (e) => { e.preventDefault(); fileIn.click(); });
    fileIn.addEventListener('change', async () => {
      const files = [...fileIn.files]; fileIn.value = '';
      let last = null, fails = 0;
      for (const f of files) {
        try { last = await advImportSut(f); }
        catch (err) { fails++; console.warn('[MagmaWand] 가져오기 실패', f.name, err); toast(`${f.name}: ${err && err.message || err}`); }
      }
      if (last) { await advSelect(last.id); toast(`브러시 ${files.length - fails}개를 가져왔어요` + (last.tips.some((t) => t.needPng) ? ' — 끝 모양 PNG가 필요한 브러시가 있어요' : '')); }
      render();
    });
    png.addEventListener('click', (e) => { e.preventDefault(); if (ADV.brush) openAdvPngDialog(ADV.brush, render); });
    let armed = false;
    del.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!ADV.brush) return;
      if (!armed) { armed = true; del.textContent = '한 번 더 누르면 지워요'; setTimeout(() => { armed = false; del.textContent = '지우기'; }, 3000); return; }
      armed = false; del.textContent = '지우기';
      await advDeleteBrush(ADV.brush); ADV.brush = null; await advSelect(null); render();
    });
    async function render() {
      const brushes = await advListBrushes().catch(() => []);
      const keepTop = list.scrollTop;
      list.innerHTML = '';
      if (!brushes.length) { list.innerHTML = '<div class="mw-advempty">브러시가 없어요. "＋ 새 브러시 (프리셋)"으로 만들거나 클립 스튜디오 브러시 파일(.sut)을 가져오세요.</div>'; }
      // 분류별로 묶고, 머리를 누르면 접고 편다 (접힌 상태는 기억)
      const groups = new Map();
      for (const b of brushes) { const c = advCatOf(b); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(b); }
      const folded = new Set(S.advFolded || []);
      for (const [c, arr] of [...groups].sort((x, y) => advCatOrder(x[0]) - advCatOrder(y[0]))) {
        const hasCur = ADV.brush && arr.some((b) => b.id === ADV.brush.id);
        const h = document.createElement('button'); h.type = 'button'; h.className = 'mw-advcat';
        h.textContent = (folded.has(c) ? '▸ ' : '▾ ') + c + ` (${arr.length})` + (folded.has(c) && hasCur ? ' ●' : '');
        h.addEventListener('click', (e) => { e.preventDefault(); if (folded.has(c)) folded.delete(c); else folded.add(c); S.advFolded = [...folded]; saveSettings(); render(); });
        list.appendChild(h);
        if (folded.has(c)) continue;
        for (const b of arr) {
          const it = document.createElement('button'); it.type = 'button';
          it.className = 'mw-advrow' + (ADV.brush && ADV.brush.id === b.id ? ' on' : '');
          const cv = document.createElement('canvas'); cv.width = SMP_W; cv.height = SMP_H;
          const nm = document.createElement('span'); nm.textContent = b.name + (b.tips.some((t) => t.needPng) || (b.texture && b.texture.needPng) ? ' ⚠' : '');
          it.append(cv, nm); it.title = b.name;
          smpRequest('b', b, cv);
          it.addEventListener('click', async (e) => { e.preventDefault(); await advSelect(b.id); render(); if (BSET.el) openBrushSettings(); });
          it.addEventListener('dblclick', (e) => { e.preventDefault(); openBrushSettings(); });
          list.appendChild(it);
        }
      }
      list.scrollTop = keepTop;
      const cur = ADV.brush;
      png.style.display = cur ? '' : 'none';
      gear.style.display = cur ? '' : 'none';
      del.style.display = cur ? '' : 'none';
      const need = cur ? cur.tips.filter((t) => t.needPng).length + (cur.texture && cur.texture.needPng ? 1 : 0) + (cur.dual && cur.dual.tip && cur.dual.tip.needPng ? 1 : 0) : 0;
      info.textContent = !cur ? '' : [
        need ? `⚠ 보호된 소재 ${need}개: "끝 모양 바꾸기"에서 기본 모양을 고르거나, CSP에서 PNG로 저장해 넣어 주세요` : '',
        cur.unsupported.length ? `아직 안 되는 기능: ${cur.unsupported.join(', ')} (나머지 설정으로 그려요)` : '',
      ].filter(Boolean).join('\n');
    }
    box.__mwRender = render;
    advListRender = render;
    render();
    return box;
  }
  function openAdvPngDialog(brush, after) {
    document.querySelector('.mw-dialog-wrap')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'mw-dialog-wrap mw-el';
    wrap.innerHTML = `<div class="mw-dialog mw-hist" role="dialog">
      <div class="mw-dialog-title">끝 모양·텍스처 <span class="mw-hist-sub"></span></div>
      <div class="mw-hist-help"><b>기본 모양</b>을 누르면 준비된 모양 중에서 고를 수 있어요. 내 그림을 쓰려면 <b>PNG 고르기</b>로 넣어요(검은 그림 + 투명 배경).
        클립 스튜디오의 보호된 소재는 CSP에서 캔버스에 붙여 PNG로 저장한 뒤 넣으면 똑같이 쓸 수 있어요.</div>
      <div class="mw-hist-list mw-pnglist"></div>
      <div class="mw-dialog-btns"><button type="button" class="md btn primary mw-ok">닫기</button></div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.mw-hist-sub').textContent = brush.name;
    const urls = [];
    const close = () => { urls.forEach((u) => URL.revokeObjectURL(u)); wrap.remove(); after && after(); };
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    wrap.querySelector('.mw-ok').addEventListener('click', close);
    const listEl = wrap.querySelector('.mw-pnglist');
    if (!brush.tips.length) brush.tips.push({ key: null, thumbKey: null, needPng: true });
    const texSlot = brush.texture || { key: null, thumbKey: null, needPng: false, empty: true };
    if (brush.dual && !brush.dual.tip) brush.dual.tip = { key: null, thumbKey: null, needPng: true };
    const slots = [...brush.tips.map((t, i) => ({ t, label: `끝 모양 ${i + 1}`, list: BUILTIN_TIPS })), ...(brush.dual ? [{ t: brush.dual.tip, label: '2중 브러시 끝 모양', list: BUILTIN_TIPS }] : []), { t: texSlot, label: '텍스처', list: BUILTIN_TEX, tex: true }];
    const applyBlob = async (t, blob, isTex, extra) => {
      t.key = await advPutImage(blob); t.needPng = false; delete t.empty; Object.assign(t, extra || {});
      if (isTex && !brush.texture) brush.texture = t;
      await advSaveBrush(brush);
      ADV.tips.clear();
      if (ADV.brush && ADV.brush.id === brush.id) await advPrepare(brush);
    };
    for (const { t, label, list, tex } of slots) {
      const row = document.createElement('div'); row.className = 'mw-hist-row';
      const img = document.createElement('img'); img.className = 'mw-hist-thumb';
      (async () => { const bl = (await advGetImage(t.key)) || (await advGetImage(t.thumbKey)); if (bl) { const u = URL.createObjectURL(bl); urls.push(u); img.src = u; } })();
      const tx = document.createElement('div'); tx.className = 'mw-hist-info';
      tx.innerHTML = `<div class="mw-hist-time"></div><div class="mw-hist-meta"></div>`;
      tx.querySelector('.mw-hist-time').textContent = label;
      tx.querySelector('.mw-hist-meta').textContent = t.empty ? '없음' : t.needPng ? '모양 필요 (미리보기는 소재 썸네일)' : '준비됨';
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/*'; inp.style.display = 'none';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sm btn secondary'; btn.textContent = 'PNG 고르기';
      btn.addEventListener('click', (e) => { e.preventDefault(); inp.click(); });
      const bb = document.createElement('button'); bb.type = 'button'; bb.className = 'sm btn secondary'; bb.textContent = '기본 모양';
      let picker = null;
      bb.addEventListener('click', (e) => {
        e.preventDefault();
        if (picker) { picker.remove(); picker = null; return; }
        picker = builtinPicker(list, async (item) => {
          try {
            await applyBlob(t, await builtinBlob(item), tex, { builtinId: item.id, bver: BUILTIN_VER });
            tx.querySelector('.mw-hist-meta').textContent = '기본 모양: ' + item.name;
            img.src = await builtinThumb(item);
            if (tex) brush.texDensity = brush.texDensity || 0.5;
          } catch (err) { toast('모양을 넣지 못했어요: ' + (err && err.message || err)); }
        });
        if (tex) {
          const none = document.createElement('button'); none.type = 'button'; none.className = 'mw-tipbtn'; none.innerHTML = '<span>없음</span>';
          none.addEventListener('click', async (ev) => {
            ev.preventDefault(); brush.texture = null; Object.assign(t, { key: null, empty: true }); await advSaveBrush(brush);
            ADV.tips.clear(); if (ADV.brush && ADV.brush.id === brush.id) await advPrepare(brush);
            tx.querySelector('.mw-hist-meta').textContent = '없음'; img.removeAttribute('src');
          });
          picker.prepend(none);
        }
        row.after(picker);
      });
      inp.addEventListener('change', async () => {
        const f = inp.files[0]; inp.value = '';
        if (!f) return;
        try {
          await createImageBitmap(f); // 열리는 그림인지 확인
          await applyBlob(t, f, tex, { builtinId: null });
          tx.querySelector('.mw-hist-meta').textContent = '준비됨'; btn.textContent = '바꾸기';
          const u = URL.createObjectURL(f); urls.push(u); img.src = u;
        } catch (err) { toast('그림을 열지 못했어요: ' + (err && err.message || err)); }
      });
      row.append(img, tx, bb, btn, inp);
      listEl.appendChild(row);
      if (t.builtinId) { const it = list.find((x) => x.id === t.builtinId); if (it) { builtinThumb(it).then((u) => { img.src = u; }); tx.querySelector('.mw-hist-meta').textContent = '기본 모양: ' + it.name; } }
    }
  }

  // ---------- 고급 브러시 ④ 브러시 설정 창 (클립 스튜디오 '보조 도구 상세'처럼 항목별) ----------
  // 떠 있는 작은 창이라 열어 둔 채로 그림판에 그어 보며 바꿀 수 있다. 바꾼 값은 바로 그 브러시에 저장된다(이 컴퓨터).
  const BSET = { el: null };
  const EFF_KINDS = [['pressure', '필압', 0.2], ['velocity', '속도', 0.3], ['random', '무작위', 0.5]];
  function openBrushSettings() {
    const b = ADV.brush;
    if (!b) { toast('먼저 브러시를 골라 주세요'); return; }
    BSET.el?.remove();
    const el = document.createElement('div');
    el.className = 'mw-bset mw-el';
    el.innerHTML = '<div class="mw-bset-head"><span class="mw-bset-title"></span><button type="button" class="mw-bset-x" title="닫기">✕</button></div><div class="mw-bset-tabs"></div><div class="mw-bset-body"></div>';
    document.body.appendChild(el);
    BSET.el = el;
    el.querySelector('.mw-bset-title').textContent = '브러시 설정 — ' + b.name;
    el.querySelector('.mw-bset-x').addEventListener('click', () => { el.remove(); BSET.el = null; });
    for (const t of ['keydown', 'keyup']) el.addEventListener(t, (e) => e.stopPropagation()); // 입력 칸의 키가 Magma 단축키로 새지 않게
    // 제목을 끌어 옮기기
    const head = el.querySelector('.mw-bset-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = (ev) => { el.style.left = Math.max(0, ev.clientX - ox) + 'px'; el.style.top = Math.max(0, ev.clientY - oy) + 'px'; el.style.right = 'auto'; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    const save = () => { advSaveSoon(); };
    const body = el.querySelector('.mw-bset-body'), tabs = el.querySelector('.mw-bset-tabs');
    // ---- 줄 만들기 도구 ----
    const rowEl = (label) => { const r = document.createElement('div'); r.className = 'mw-bs-row'; const l = document.createElement('span'); l.className = 'mw-bs-lab'; l.textContent = label; r.appendChild(l); return r; };
    const slider = (label, get, set, min, max, step = 1, unit = '') => {
      const r = rowEl(label);
      const rg = document.createElement('input'); rg.type = 'range'; rg.min = min; rg.max = max; rg.step = step; rg.className = 'mw-bs-range';
      const nb = document.createElement('input'); nb.type = 'number'; nb.min = min; nb.max = max; nb.step = step; nb.className = 'mw-bs-num';
      const u = document.createElement('span'); u.className = 'mw-bs-unit'; u.textContent = unit;
      const show = () => { const v = get(); rg.value = v; nb.value = Math.round(v * 100) / 100; };
      const put = (v) => { v = Math.min(max, Math.max(min, +v)); if (!Number.isFinite(v)) return; set(v); show(); save(); };
      rg.addEventListener('input', () => put(rg.value)); nb.addEventListener('change', () => put(nb.value));
      show(); r.append(rg, nb, u); return r;
    };
    const seg = (label, opts, get, set) => {
      const r = rowEl(label), g = document.createElement('div'); g.className = 'mw-bs-seg';
      const btns = opts.map(([v, t]) => { const x = document.createElement('button'); x.type = 'button'; x.textContent = t; x.addEventListener('click', () => { set(v); paint(); save(); }); g.appendChild(x); return [v, x]; });
      const paint = () => btns.forEach(([v, x]) => x.classList.toggle('on', get() === v));
      paint(); r.appendChild(g); return r;
    };
    const check = (label, get, set) => {
      const r = rowEl(label), c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!get();
      c.addEventListener('change', () => { set(c.checked); save(); }); r.appendChild(c); return r;
    };
    // 효과(필압·속도·무작위): 켜면 최솟값(%) 칸이 보인다
    const effRow = (label, key, holder = b) => {
      const box = document.createElement('div'); box.className = 'mw-bs-eff';
      const r = rowEl(label), g = document.createElement('div'); g.className = 'mw-bs-seg';
      const mins = document.createElement('div'); mins.className = 'mw-bs-effmins';
      const eff = () => holder[key];
      const draw = () => {
        g.innerHTML = ''; mins.innerHTML = '';
        for (const [k, t, def] of EFF_KINDS) {
          const x = document.createElement('button'); x.type = 'button'; x.textContent = t;
          const on = !!(eff() && eff()[k]);
          x.classList.toggle('on', on);
          x.addEventListener('click', () => {
            const e2 = eff() ? { ...eff() } : {};
            if (e2[k]) delete e2[k]; else e2[k] = k === 'random' ? { min: def } : { min: def, curve: null };
            holder[key] = Object.keys(e2).length ? e2 : null; save(); draw();
          });
          g.appendChild(x);
          if (on) mins.appendChild(slider(`  ${t} 최소`, () => Math.round(eff()[k].min * 100), (v) => { eff()[k].min = v / 100; }, 0, 100, 1, '%'));
        }
      };
      draw(); r.appendChild(g); box.append(r, mins); return box;
    };
    const btn = (text, fn) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'sm btn secondary'; x.textContent = text; x.addEventListener('click', (e) => { e.preventDefault(); fn(); }); return x; };
    const pct = (k, o = b) => [() => Math.round(o[k] * 100), (v) => { o[k] = v / 100; }];
    // ---- 항목 ----
    const pages = {
      '크기': () => [
        slider('브러시 크기', () => b.size, (v) => { b.size = v; S.advSize = v; rowsEl?.__mwSync?.(); }, 0.5, 1000, 0.5, 'px'),
        effRow('크기 효과', 'sizeEff'),
        slider('필압 곡선', () => Math.round((b.pressGamma || 1) * 100), (v) => { b.pressGamma = v / 100; }, 30, 300, 5),
        Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: '필압 곡선: 100보다 작으면 살살 눌러도 굵고 진하게, 크면 세게 눌러야 굵어져요(펜에만 적용).' }),
      ],
      '잉크': () => [
        slider('불투명도', ...pct('opacity'), 1, 100, 1, '%'),
        effRow('불투명도 효과', 'opacityEff'),
        slider('흐름(밀도)', ...pct('flow'), 1, 100, 1, '%'),
        effRow('흐름 효과', 'flowEff'),
        check('안티에일리어스', () => b.aa, (v) => { b.aa = v ? 1 : 0; }),
        seg('합성 모드', [['normal', '보통'], ['glaze', '물감 겹치기'], ['multiply', '곱하기'], ['erase', '지우기']], () => b.blend || 'normal', (v) => { b.blend = v; }),
        Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: '물감 겹치기: 투명한 물감을 덧칠한 것처럼 감산 혼합돼요(노랑 위에 파랑 = 초록, 수채). 곱하기: 화면 곱하기라 겹칠수록 어둡고 탁해요(마커). 지우기: 이 브러시 모양 그대로 지우개가 돼요. 같은 레이어 안의 그림과 섞여요.' }),
      ],
      '수채 경계': () => {
        const we = () => b.wedge || (b.wedge = { on: false, radius: 6, alpha: 0.55, value: 0.35 });
        we();
        return [
          check('수채 경계 켜기', () => b.wedge.on, (v) => { b.wedge.on = v; }),
          slider('범위', () => b.wedge.radius, (v) => { b.wedge.radius = v; }, 1, 40, 1, 'px'),
          slider('투명도 영향', () => Math.round(b.wedge.alpha * 100), (v) => { b.wedge.alpha = v / 100; }, 0, 100, 1, '%'),
          slider('명도 영향', () => Math.round(b.wedge.value * 100), (v) => { b.wedge.value = v / 100; }, 0, 100, 1, '%'),
          Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: '물이 마르면서 가장자리에 물감이 고인 것처럼 획 테두리 안쪽을 진하게 해요. 그리는 동안에도 결과와 똑같이 보여요.' }),
        ];
      },
      '물감': () => {
        const br = () => b.bristle || (b.bristle = { on: false, shape: 'round', count: 22, streak: 0.5, var: 0.06 });
        const im = () => b.impasto || (b.impasto = { depth: 0, shine: 0.4 });
        const wt = () => b.wet || (b.wet = { on: false, wobble: 0.4, gran: 0.2, soft: 0 });
        br(); im(); wt();
        const head = (t) => Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: t });
        return [
          check('붓털 켜기', () => b.bristle.on, (v) => { b.bristle.on = v; }),
          seg('붓 모양', [['round', '둥근 붓'], ['flat', '평붓']], () => b.bristle.shape || 'round', (v) => { b.bristle.shape = v; }),
          slider('털 수', () => b.bristle.count, (v) => { b.bristle.count = v; }, 4, 64, 1),
          slider('털 결 세기', () => Math.round(b.bristle.streak * 100), (v) => { b.bristle.streak = v / 100; }, 0, 100, 1, '%'),
          slider('털마다 색 차이', () => Math.round(b.bristle.var * 100), (v) => { b.bristle.var = v / 100; }, 0, 30, 1, '%'),
          head('붓털: 털마다 물감을 따로 묻혀 끊김 없는 결이 남아요. 획 탭의 \'물감 마름\'을 같이 쓰면 길게 그을수록 털이 하나씩 말라 갈라져요. 끝 모양·각도 설정 대신 쓰여요.'),
          slider('두께감', () => Math.round(b.impasto.depth * 100), (v) => { b.impasto.depth = v / 100; }, 0, 100, 1, '%'),
          slider('광택', () => Math.round((b.impasto.shine || 0) * 100), (v) => { b.impasto.shine = v / 100; }, 0, 100, 1, '%'),
          head('두께감: 물감이 두껍게 올라온 것처럼 붓 자국 굴곡에 왼쪽 위 빛과 그림자를 넣어요(0 = 끔). 광택이 높을수록 유화처럼 반짝여요.'),
          check('젖은 물감(수채)', () => b.wet.on, (v) => { b.wet.on = v; }),
          slider('가장자리 흔들림', () => Math.round(b.wet.wobble * 100), (v) => { b.wet.wobble = v / 100; }, 0, 100, 1, '%'),
          slider('가장자리 풀림', () => Math.round((b.wet.soft || 0) * 100), (v) => { b.wet.soft = v / 100; }, 0, 100, 1, '%'),
          slider('안료 알갱이', () => Math.round(b.wet.gran * 100), (v) => { b.wet.gran = v / 100; }, 0, 100, 1, '%'),
          head('젖은 물감: 물이 닿은 경계가 또렷하고 구불구불해져요. 풀림을 올리면 젖은 종이처럼 번지고, 알갱이는 종이 골에 안료가 가라앉은 오돌토돌함이에요. 수채 경계와 함께 쓰면 좋아요.'),
        ];
      },
      '색 혼합': () => {
        const mx = () => b.mix || (b.mix = { mode: 'none', amount: 0.5, density: 0.8, stretch: 0.3, amountEff: null, densEff: null, ref: 'layer' });
        mx();
        return [
          seg('색 혼합', [['none', '없음'], ['blend', '블렌드'], ['paint', '물감 섞기']], () => b.mix.mode, (v) => { b.mix.mode = v; }),
          slider('물감량', () => Math.round(b.mix.amount * 100), (v) => { b.mix.amount = v / 100; }, 0, 100, 1, '%'),
          effRow('물감량 효과', 'amountEff', b.mix),
          slider('물감 농도', () => Math.round(b.mix.density * 100), (v) => { b.mix.density = v / 100; }, 0, 100, 1, '%'),
          effRow('물감 농도 효과', 'densEff', b.mix),
          slider('색 늘이기', () => Math.round(b.mix.stretch * 100), (v) => { b.mix.stretch = v / 100; }, 0, 100, 1, '%'),
          seg('섞을 밑색', [['layer', '현재 레이어'], ['all', '보이는 그림']], () => b.mix.ref || 'layer', (v) => { b.mix.ref = v; }),
          Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: '물감량 100 = 메인 색만 · 0 = 밑색만 끌고 다님(손끝). 물감 농도가 낮을수록 묽게, 색 늘이기가 클수록 끌고 온 색이 길게 남아요.' }),
        ];
      },
      '끝 모양': () => [
        slider('경도(원형일 때)', ...pct('hardness'), 0, 100, 1, '%'),
        slider('두께', ...pct('thickness'), 1, 100, 1, '%'),
        seg('두께 방향', [[false, '가로'], [true, '세로']], () => !!b.vertical, (v) => { b.vertical = v; }),
        effRow('두께 효과', 'thickEff'),
        slider('각도', () => b.rotation, (v) => { b.rotation = v; }, -180, 180, 1, '°'),
        check('각도: 필압', () => b.rotMask & 0x10, (v) => { b.rotMask = v ? b.rotMask | 0x10 : b.rotMask & ~0x10; }),
        check('각도: 진행 방향', () => b.rotMask & 0x40, (v) => { b.rotMask = v ? b.rotMask | 0x40 : b.rotMask & ~0x40; }),
        check('각도: 무작위', () => b.rotMask & 0x80, (v) => { b.rotMask = v ? b.rotMask | 0x80 : b.rotMask & ~0x80; }),
        slider('  무작위 정도', ...pct('rotRandom'), 0, 100, 1, '%'),
        seg('좌우 반전', [[0, '없음'], [1, '반전'], [2, '무작위']], () => b.flipH || 0, (v) => { b.flipH = v; }),
        seg('상하 반전', [[0, '없음'], [1, '반전'], [2, '무작위']], () => b.flipV || 0, (v) => { b.flipV = v; }),
        seg('여러 모양 순서', [[0, '차례'], [1, '왕복'], [2, '무작위']], () => b.tipOrder || 0, (v) => { b.tipOrder = v; }),
      ],
      '획': () => [
        slider('간격', () => Math.round(b.interval * 100), (v) => { b.interval = v / 100; }, 1, 300, 1, '%'),
        effRow('간격 효과', 'intervalEff'),
        slider('손떨림 보정', () => b.smoothing || 0, (v) => { b.smoothing = v; }, 0, 100, 1),
        slider('입(시작 가늘게)', () => b.taperIn || 0, (v) => { b.taperIn = v; }, 0, 500, 1, 'px'),
        slider('출(끝 가늘게)', () => b.taperOut || 0, (v) => { b.taperOut = v; }, 0, 500, 1, 'px'),
        check('리본(끝 모양을 띠처럼 늘이기)', () => b.ribbon, (v) => { b.ribbon = v; }),
        slider('흩어짐', () => Math.round((b.scatter || 0) * 100), (v) => { b.scatter = v / 100; }, 0, 200, 1, '%'),
        slider('물감 마름(길이)', () => (b.dryOut && b.dryOut.len) || 0, (v) => { b.dryOut = Object.assign(b.dryOut || { min: 0 }, { len: v }); }, 0, 3000, 10, 'px'),
        slider('  마른 뒤 남는 양', () => Math.round(((b.dryOut && b.dryOut.min) || 0) * 100), (v) => { b.dryOut = Object.assign(b.dryOut || { len: 0 }, { min: v / 100 }); }, 0, 100, 1, '%'),
        Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: '물감 마름: 그 길이만큼 그으면 붓의 물감이 줄어 획이 갈라져요(갈필). 0이면 꺼짐.' }),
      ],
      '스프레이': () => {
        const sp = () => b.spray;
        const ensure = () => b.spray || (b.spray = { size: 3, sync: false, density: 10, bias: 0, sizeEff: null, densEff: null });
        const rows = [check('스프레이 켜기', () => !!b.spray, (v) => { if (v) ensure(); else b.spray = null; render('스프레이'); })];
        if (sp()) rows.push(
          slider('입자 크기', () => sp().size, (v) => { sp().size = v; }, 0.5, 200, 0.5, 'px'),
          check('입자 크기를 브러시 크기에 맞춤', () => sp().sync, (v) => { sp().sync = v; }),
          effRow('입자 크기 효과', 'sizeEff', sp()),
          slider('입자 수', () => sp().density, (v) => { sp().density = v; }, 1, 200, 1),
          effRow('입자 수 효과', 'densEff', sp()),
          slider('가운데로 모임', () => Math.round(sp().bias * 100), (v) => { sp().bias = v / 100; }, -100, 100, 1, '%'),
        );
        return rows;
      },
      '텍스처': () => [
        Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: b.texture && b.texture.key ? '텍스처를 쓰고 있어요' : '텍스처 없음 — 아래 단추로 고르세요' }),
        slider('농도', ...pct('texDensity'), 0, 100, 1, '%'),
        slider('배율', () => Math.round((b.texScale || 1) * 100), (v) => { b.texScale = v / 100; }, 10, 500, 1, '%'),
        slider('농도 강조', () => Math.round((b.texContrast || 0) * 100), (v) => { b.texContrast = v / 100; }, 0, 100, 1, '%'),
        seg('결 방식', [['mul', '무늬 덮기'], ['height', '깊이']], () => b.texMode || 'mul', (v) => { b.texMode = v; }),
        slider('골에 남는 가루(깊이)', () => Math.round((b.texFloor == null ? 0.12 : b.texFloor) * 100), (v) => { b.texFloor = v / 100; }, 0, 50, 1, '%'),
        Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: '깊이: 종이 결을 높낮이로 써요. 살살 칠하면 높은 곳에만 묻고, 세게·여러 번 칠할수록 골까지 채워져요(연필·목탄·파스텔). 농도 = 골 깊이.' }),
        check('반전', () => b.texInvert, (v) => { b.texInvert = v; }),
        check('도장마다 적용(끄면 획 전체에, 깊이 방식은 늘 획 전체)', () => b.texPerStamp, (v) => { b.texPerStamp = v; }),
      ],
      '2중 브러시': () => {
        if (!b.dual) return [Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: '이 브러시에는 2중 브러시가 없어요. 클립 스튜디오 브러시(.sut)에 2중 브러시가 있으면 여기서 바꿀 수 있어요.' })];
        const d = b.dual;
        return [
          check('2중 브러시 쓰기', () => !b.dualOff, (v) => { b.dualOff = !v; }),
          slider('크기', () => d.size, (v) => { d.size = v; }, 1, 1000, 1, 'px'),
          slider('간격', () => Math.round(d.interval * 100), (v) => { d.interval = v / 100; }, 1, 300, 1, '%'),
          slider('흐름', () => Math.round(d.flow * 100), (v) => { d.flow = v / 100; }, 1, 100, 1, '%'),
          check('흩뿌리기', () => d.spray, (v) => { d.spray = v; }),
          Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: '두 번째 끝 모양으로 찍은 무늬 안쪽만 남겨서 거친 질감을 만들어요.' }),
        ];
      },
      '색 흔들기': () => {
        const j = () => b.jitter || (b.jitter = { h: 0, s: 0, v: 0 });
        j();
        return [
          slider('색상', () => b.jitter.h, (v) => { b.jitter.h = v; }, 0, 100, 1, '%'),
          slider('채도', () => b.jitter.s, (v) => { b.jitter.s = v; }, 0, 100, 1, '%'),
          slider('명도', () => b.jitter.v, (v) => { b.jitter.v = v; }, 0, 100, 1, '%'),
          Object.assign(document.createElement('div'), { className: 'mw-bs-help', textContent: '도장마다 색을 이만큼 흔들어요(반짝이·잎 같은 브러시에 좋아요).' }),
        ];
      },
      '이름·관리': () => {
        const r = rowEl('이름'), inp = document.createElement('input'); inp.type = 'text'; inp.value = b.name; inp.className = 'mw-bs-text';
        inp.addEventListener('change', () => { b.name = inp.value.trim() || b.name; el.querySelector('.mw-bset-title').textContent = '브러시 설정 — ' + b.name; save(); advListRender?.(); });
        r.appendChild(inp);
        const rc = rowEl('분류'), sel = document.createElement('select'); sel.className = 'mw-bs-text';
        for (const c of [...ADV_CATS, CAT_IMPORTED, CAT_MINE]) sel.add(new Option(c, c));
        sel.value = advCatOf(b);
        sel.addEventListener('change', () => { b.cat = sel.value; save(); advListRender?.(); });
        rc.appendChild(sel);
        const acts = document.createElement('div'); acts.className = 'mw-bs-acts';
        acts.append(
          btn('끝 모양·텍스처 바꾸기…', () => openAdvPngDialog(b, () => advListRender?.())),
          btn('이 브러시 복제', async () => {
            const c = JSON.parse(JSON.stringify(b)); c.id = 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); c.added = Date.now(); c.name = b.name + ' 사본';
            await advSaveBrush(c); await advSelect(c.id); advListRender?.(); openBrushSettings();
          }),
        );
        return [r, rc, acts];
      },
    };
    let cur = BSET.page && pages[BSET.page] ? BSET.page : '크기';
    function render(name) {
      cur = name || cur; BSET.page = cur;
      tabs.innerHTML = '';
      for (const k of Object.keys(pages)) { const t = document.createElement('button'); t.type = 'button'; t.textContent = k; t.classList.toggle('on', k === cur); t.addEventListener('click', () => render(k)); tabs.appendChild(t); }
      body.innerHTML = '';
      for (const r of pages[cur]()) body.appendChild(r);
    }
    render();
  }

  // ---------- 고급 브러시 ⑤ 프리셋 (클립 스튜디오 기본 브러시처럼 바로 쓰는 묶음) ----------
  // ----- 프리셋: 종류별로 묶음. 드라이 재료(연필·목탄·파스텔·크레용·분필·갈필)는 '깊이' 결 방식 —
  // 종이 결이 높낮이로 작동해서, 살살 칠하면 돌기 끝에만 묻고 겹치고 누를수록 골까지 채워진다(실제 재료처럼).
  // 흐름(한 도장의 진하기)을 낮게 두고 간격을 촘촘히 해서 '쌓이는 양'이 필압을 따라가게 한 것이 핵심.
  const ADV_CATS = ['연필·스케치', '잉크·펜', '마커', '드라이 (목탄·파스텔)', '수채', '물감 (유화·구아슈)', '섞기·문지르기', '에어브러시', '질감·특수', '장식·자연'];
  const effP = (min) => ({ pressure: { min, curve: null } });
  const effPC = (min, curve) => ({ pressure: { min, curve } }); // 곡선: [[입력,출력]…] 0~1
  const HP = (o) => Object.assign({ texMode: 'height', interval: 0.05 }, o); // 깊이 결 기본
  const BR = (shape, count, streak, v) => ({ on: true, shape, count, streak, var: v }); // 붓털
  const WET = (wobble, gran, soft = 0) => ({ on: true, wobble, gran, soft }); // 젖은 물감(수채)
  const ADV_PRESETS = [
    // 연필·스케치
    { cat: '연필·스케치', name: 'HB 연필', tip: 'graphite', tex: 'tooth', desc: '단단하고 옅은 선. 살살 그으면 종이 이에만 걸려요', o: HP({ texFloor: 0.02, rotMask: 0x80, rotRandom: 1, scatter: 0.03, size: 4, sizeEff: effP(0.7), flow: 0.15, flowEff: effP(0.15), texDensity: 0.95, texScale: 0.55, smoothing: 8 }) },
    { cat: '연필·스케치', name: '4B 연필', tip: 'graphite', tex: 'tooth', desc: '부드럽고 진한 흑연. 눌러 칠하면 결이 메워져요', o: HP({ texFloor: 0.04, rotMask: 0x80, rotRandom: 1, scatter: 0.03, size: 7, sizeEff: effP(0.55), flow: 0.14, flowEff: effP(0.12), texDensity: 0.85, texScale: 0.6, smoothing: 8 }) },
    { cat: '연필·스케치', name: '8B 연필', tip: 'graphite', tex: 'tooth', desc: '아주 무른 연필. 진하고 번들거리는 검정', o: HP({ texFloor: 0.06, rotMask: 0x80, rotRandom: 1, scatter: 0.03, size: 10, sizeEff: effP(0.5), flow: 0.22, flowEff: effP(0.15), texDensity: 0.7, texScale: 0.65, smoothing: 6 }) },
    { cat: '연필·스케치', name: '샤프', tip: 'round-hard', tex: 'tooth', desc: '가늘고 일정한 밑그림 선', o: HP({ size: 2.4, sizeEff: effP(0.85), flow: 0.45, flowEff: effP(0.3), interval: 0.04, texDensity: 0.45, texScale: 0.5, smoothing: 12 }) },
    { cat: '연필·스케치', name: '색연필', tip: 'graphite', tex: 'tooth', pv: '#c0392b', desc: '색이 종이 결에 걸리는 밀랍 질감, 겹쳐 칠해 진하게', o: HP({ texFloor: 0.02, rotMask: 0x80, rotRandom: 1, scatter: 0.02, size: 8, sizeEff: effP(0.6), flow: 0.13, flowEff: effP(0.1), texDensity: 1, texScale: 0.75, texContrast: 0.25, smoothing: 6 }) },
    { cat: '연필·스케치', name: '연필 눕혀 칠하기', tip: 'graphite', tex: 'tooth', desc: '연필을 눕혀 넓게 음영 넣기', o: HP({ texFloor: 0.02, size: 26, thickness: 0.45, rotMask: 0x40, sizeEff: effP(0.6), flow: 0.07, flowEff: effP(0.1), interval: 0.04, texDensity: 1, texScale: 0.6, smoothing: 4 }) },
    { cat: '연필·스케치', name: '목탄 연필', tip: 'charcoaltip', tex: 'laid', desc: '거칠고 깊은 검정, 결이 가로로 비쳐요', o: HP({ texFloor: 0.03, size: 8, sizeEff: effP(0.55), flow: 0.13, flowEff: effP(0.12), rotMask: 0x80, rotRandom: 1, scatter: 0.04, texDensity: 0.8, texScale: 0.7, smoothing: 6 }) },
    // 잉크·펜
    { cat: '잉크·펜', name: 'G펜', tip: 'round-hard', desc: '필압으로 굵기가 바뀌는 매끈한 펜 선', o: { size: 6, sizeEff: effP(0.05), interval: 0.05, smoothing: 25, taperIn: 15, taperOut: 15 } },
    { cat: '잉크·펜', name: '마루펜', tip: 'round-hard', desc: '가늘고 단단한 펜. 세밀한 선', o: { size: 3, sizeEff: effP(0.35), interval: 0.04, smoothing: 25, taperIn: 8, taperOut: 10 } },
    { cat: '잉크·펜', name: '테크니컬 펜', tip: 'round-hard', desc: '굵기가 일정한 제도 펜', o: { size: 4, sizeEff: null, interval: 0.04, smoothing: 30 } },
    { cat: '잉크·펜', name: '붓펜', tip: 'round-hard', desc: '끝이 날렵한 붓펜', o: { size: 14, thickness: 0.8, rotation: 30, sizeEff: effP(0.1), interval: 0.05, smoothing: 20, taperIn: 30, taperOut: 40 } },
    { cat: '잉크·펜', name: '먹 붓', tip: 'round-hard', desc: '누르는 만큼 확 굵어지는 먹선', o: { size: 24, thickness: 0.85, rotation: 30, sizeEff: effPC(0.03, [[0, 0], [0.5, 0.25], [1, 1]]), interval: 0.04, smoothing: 18, taperIn: 30, taperOut: 70 } },
    { cat: '잉크·펜', name: '마른 먹', tip: 'graphite', tex: 'grit', desc: '그을수록 먹이 말라 갈라지는 붓 선', o: HP({ size: 14, sizeEff: effP(0.25), flow: 0.2, flowEff: effP(0.4), interval: 0.03, texDensity: 0.75, texScale: 0.8, dryOut: { len: 500, min: 0.25 }, smoothing: 15, taperIn: 20 }) },
    { cat: '잉크·펜', name: '캘리그래피 펜', tip: 'square', desc: '각도가 고정된 납작 펜촉 (가로획 굵고 세로획 가늘게)', o: { size: 18, thickness: 0.16, rotation: 40, rotMask: 0, sizeEff: effP(0.6), interval: 0.02, smoothing: 20 } },
    { cat: '잉크·펜', name: '펠트펜', tip: 'round-soft', desc: '가장자리가 살짝 번진 사인펜', o: { size: 6, hardness: 0.75, sizeEff: effP(0.8), flow: 1, interval: 0.04, smoothing: 15 } },
    // 마커
    { cat: '마커', name: '사각 마커', tip: 'square', pv: '#3d7bd9', desc: '겹칠수록 진해지는 납작 마커', o: { size: 18, thickness: 0.35, rotation: 45, rotMask: 0, flow: 1, opacity: 0.6, interval: 0.03, sizeEff: null, blend: 'multiply' } },
    { cat: '마커', name: '알코올 마커', tip: 'round-soft', pv: '#d0587a', desc: '부드러운 가장자리, 덧칠하면 한 단계씩 진해짐', o: { size: 16, hardness: 0.8, flow: 1, opacity: 0.5, interval: 0.03, sizeEff: effP(0.6), blend: 'multiply' } },
    { cat: '마커', name: '형광펜', tip: 'square', pv: '#f2d21b', desc: '아래 그림이 비치는 형광 띠', o: { size: 22, thickness: 0.42, rotation: 0, rotMask: 0, flow: 1, opacity: 0.55, interval: 0.03, sizeEff: null, blend: 'multiply' } },
    // 드라이
    { cat: '드라이 (목탄·파스텔)', name: '버드나무 목탄', tip: 'charcoaltip', tex: 'laid', desc: '가볍고 부드러운 목탄. 손에 묻어나듯 결이 많이 남아요', o: HP({ size: 16, sizeEff: effP(0.6), flow: 0.09, flowEff: effP(0.1), rotMask: 0x80, rotRandom: 1, scatter: 0.08, texDensity: 0.95, texScale: 0.8, smoothing: 4 }) },
    { cat: '드라이 (목탄·파스텔)', name: '압축 목탄', tip: 'charcoaltip', tex: 'laid', desc: '진하고 무거운 검정, 세게 누르면 꽉 메워짐', o: HP({ size: 14, sizeEff: effP(0.55), flow: 0.14, flowEff: effP(0.12), rotMask: 0x80, rotRandom: 1, scatter: 0.05, texDensity: 0.75, texScale: 0.8, smoothing: 4 }) },
    { cat: '드라이 (목탄·파스텔)', name: '목탄 옆면', tip: 'charcoal', tex: 'laid', desc: '목탄을 눕혀 넓게 끌기 — 큰 면과 음영', o: HP({ size: 64, rotation: 90, rotMask: 0x40, sizeEff: effP(0.8), flow: 0.09, flowEff: effP(0.1), interval: 0.03, scatter: 0.02, texDensity: 1, texScale: 0.9, smoothing: 4 }) },
    { cat: '드라이 (목탄·파스텔)', name: '콩테', tip: 'pastel', tex: 'tooth', pv: '#7b3b26', desc: '단단한 사각 스틱, 또렷한 결', o: HP({ size: 12, thickness: 0.7, rotMask: 0x80, rotRandom: 0.25, sizeEff: effP(0.6), flow: 0.11, flowEff: effP(0.1), scatter: 0.03, texDensity: 0.9, texScale: 0.7, smoothing: 4 }) },
    { cat: '드라이 (목탄·파스텔)', name: '소프트 파스텔', tip: 'pastel', tex: 'coldpress', pv: '#d9822b', desc: '가루가 날리는 부드러운 파스텔, 큰 종이 결', o: HP({ size: 28, rotMask: 0x80, rotRandom: 1, sizeEff: effP(0.6), flow: 0.13, flowEff: effP(0.08), scatter: 0.06, texDensity: 0.95, texScale: 0.9, jitter: { h: 0, s: 0, v: 4 }, smoothing: 4 }) },
    { cat: '드라이 (목탄·파스텔)', name: '오일 파스텔', tip: 'pastel', tex: 'coldpress', pv: '#2e8b57', desc: '끈적하게 밀리며 밑색과 살짝 섞이는 밀랍 파스텔', o: HP({ size: 20, rotMask: 0x80, rotRandom: 0.4, sizeEff: effP(0.6), flow: 0.3, flowEff: effP(0.15), scatter: 0.03, texDensity: 0.6, texScale: 0.8, texContrast: 0.2,
      mix: { mode: 'paint', amount: 0.85, density: 1, stretch: 0.2, amountEff: null, densEff: null, ref: 'layer' } }) },
    { cat: '드라이 (목탄·파스텔)', name: '크레용', tip: 'pastel', tex: 'grit', pv: '#2b6cb0', desc: '어린이 크레용처럼 오돌토돌하게', o: HP({ size: 12, rotMask: 0x80, rotRandom: 1, sizeEff: effP(0.6), flow: 0.11, flowEff: effP(0.1), texDensity: 0.95, texScale: 0.6, smoothing: 4 }) },
    { cat: '드라이 (목탄·파스텔)', name: '분필', tip: 'chalk', tex: 'grit', desc: '칠판 분필, 가루와 끊김', o: HP({ size: 22, rotMask: 0x80, rotRandom: 1, sizeEff: effP(0.6), flow: 0.1, flowEff: effP(0.08), scatter: 0.05, texDensity: 1, texScale: 0.7, smoothing: 4 }) },
    { cat: '드라이 (목탄·파스텔)', name: '갈필 (마른 붓)', tip: 'drybrush', tex: 'coldpress', desc: '물감이 마르며 털 자국이 갈라지는 붓 — 길게 그어 보세요', o: HP({ size: 40, rotMask: 0x40, sizeEff: effP(0.75), flow: 0.25, flowEff: effP(0.3), interval: 0.025, texDensity: 0.55, texScale: 0.9, dryOut: { len: 650, min: 0.12 }, smoothing: 10 }) },
    { cat: '드라이 (목탄·파스텔)', name: '스펀지', tip: 'sponge', tex: 'grit', desc: '스펀지로 두드린 구멍 숭숭한 자국', o: { size: 50, rotMask: 0x80, rotRandom: 1, interval: 0.3, flow: 0.7, sizeEff: effP(0.7), scatter: 0.1, texDensity: 0.3 } },
    { cat: '드라이 (목탄·파스텔)', name: '점묘', tip: 'stipple', desc: '펜 끝으로 콕콕 찍은 점 음영', o: { size: 40, interval: 0.45, rotMask: 0x80, rotRandom: 1, flow: 1, sizeEff: effP(0.5) } },
    // 수채 — '젖은 물감': 쌓인 물의 등고선이 또렷하고 구불한 가장자리가 되고, 가장자리에 물감이 고이며(수채 경계),
    // 종이 골에 안료 알갱이가 가라앉는다. 그리는 동안에도 확정과 똑같이 보인다. 곱하기라 겹칠수록 투명하게 진해진다.
    { cat: '수채', name: '수채 둥근 붓', tip: 'round-soft', tex: 'wcpaper', pv: '#2f6db5', desc: '가장자리에 물감이 고이는 맑은 수채', o: { size: 50, hardness: 0.1, flow: 0.4, opacity: 0.75, interval: 0.05, texDensity: 0.5, sizeEff: effP(0.5),
      blend: 'glaze', wet: WET(0.5, 0.2), wedge: { on: true, radius: 5, alpha: 0.6, value: 0.5 } } },
    { cat: '수채', name: '수채 세필', tip: 'round-soft', tex: 'wcpaper', pv: '#7a3b6e', desc: '작은 붓으로 그리는 가는 수채 선', o: { size: 9, hardness: 0.2, flow: 0.45, opacity: 0.8, interval: 0.04, texDensity: 0.4, sizeEff: effP(0.2), smoothing: 15, taperIn: 12, taperOut: 18,
      blend: 'glaze', wet: WET(0.25, 0.15), wedge: { on: true, radius: 2, alpha: 0.5, value: 0.45 } } },
    { cat: '수채', name: '수채 번짐', tip: 'round-soft', tex: 'wcpaper', pv: '#3a8f7a', desc: '젖은 종이에 떨어뜨린 듯 가장자리가 풀리는 수채', o: { size: 90, hardness: 0.2, flow: 0.25, opacity: 0.7, interval: 0.08, texDensity: 0.4, sizeEff: effP(0.6),
      blend: 'glaze', wet: WET(0.4, 0.15, 0.6), wedge: { on: true, radius: 8, alpha: 0.3, value: 0.2 } } },
    { cat: '수채', name: '수채 글레이즈', tip: 'round-soft', tex: 'wcpaper', pv: '#c9a227', desc: '넓고 고르게 까는 투명한 막 — 덧칠할수록 한 겹씩 진해져요', o: { size: 80, hardness: 0.2, flow: 0.3, opacity: 0.5, interval: 0.05, texDensity: 0.4, sizeEff: effP(0.7),
      blend: 'glaze', wet: WET(0.3, 0.1), wedge: { on: true, radius: 6, alpha: 0.7, value: 0.55 } } },
    { cat: '수채', name: '수채 알갱이', tip: 'round-soft', tex: 'wcpaper', pv: '#3b4fa8', desc: '울트라마린처럼 안료가 종이 골에 가라앉아 오돌토돌', o: { size: 60, hardness: 0.15, flow: 0.35, opacity: 0.75, interval: 0.05, texDensity: 0.6, texScale: 0.8, sizeEff: effP(0.6),
      blend: 'glaze', wet: WET(0.45, 0.85), wedge: { on: true, radius: 4, alpha: 0.4, value: 0.3 } } },
    { cat: '수채', name: '마른 수채', tip: 'watercolor', tex: 'coldpress', pv: '#b5452f', desc: '물기 적은 붓이 종이 결 위로 스치는 거친 수채', o: HP({ size: 40, sizeEff: effP(0.6), flow: 0.16, flowEff: effP(0.2), opacity: 0.85, interval: 0.04, texDensity: 0.6, texScale: 1, dryOut: { len: 900, min: 0.35 }, blend: 'glaze', wedge: { on: true, radius: 3, alpha: 0.5, value: 0.4 } }) },
    { cat: '수채', name: '수채 평붓', tip: 'flat', tex: 'wcpaper', pv: '#6b4fb3', desc: '넓은 면을 고르게 바르는 납작 수채 붓, 옅은 털 결', o: { size: 44, thickness: 0.3, flow: 0.35, opacity: 0.75, interval: 0.03, texDensity: 0.4, sizeEff: effP(0.7), blend: 'glaze',
      bristle: BR('flat', 20, 0.2, 0.03), wet: WET(0.5, 0.25), wedge: { on: true, radius: 4, alpha: 0.6, value: 0.45 } } },
    { cat: '수채', name: '수채 물 번지기', tip: 'round-soft', tex: 'wcpaper', pv: '#2f6db5', desc: '밑색을 끌어와 물로 풀어 주는 붓', o: { size: 70, hardness: 0.1, flow: 0.18, opacity: 0.6, interval: 0.06, texDensity: 0.2, sizeEff: effP(0.6), blend: 'glaze',
      mix: { mode: 'paint', amount: 0.25, density: 0.5, stretch: 0.6, amountEff: null, densEff: null, ref: 'layer' } } },
    // 물감 — 붓털 하나하나가 물감을 따로 묻히고 따로 마른다(끊김 없는 결 → 마르면 털 자국만). 두께감은 물감 높이에
    // 왼쪽 위 빛을 비춰 붓 자국 굴곡을 살린다. 밑색과 섞이는 물감 섞기를 함께 쓴다.
    { cat: '물감 (유화·구아슈)', name: '유화 둥근 붓', tip: 'bristle', pv: '#a8432f', desc: '털 결이 남고 밑색과 섞이는 유화, 길게 그으면 갈라져요', o: { size: 40, flow: 0.9, thickness: 0.7, interval: 0.04, sizeEff: effP(0.4), dryOut: { len: 1600, min: 0.3 },
      bristle: BR('round', 22, 0.55, 0.1), impasto: { depth: 0.55, shine: 0.45 },
      mix: { mode: 'paint', amount: 0.55, density: 1, stretch: 0.55, amountEff: effP(0.3), densEff: null, ref: 'layer' } } },
    { cat: '물감 (유화·구아슈)', name: '유화 평붓', tip: 'flatbristle', pv: '#3f6e9e', desc: '넓은 평붓으로 물감을 밀어 바르기', o: { size: 44, flow: 0.95, thickness: 0.3, interval: 0.03, sizeEff: effP(0.6), dryOut: { len: 1600, min: 0.3 },
      bristle: BR('flat', 26, 0.5, 0.08), impasto: { depth: 0.5, shine: 0.4 },
      mix: { mode: 'paint', amount: 0.6, density: 1, stretch: 0.5, amountEff: effP(0.3), densEff: null, ref: 'layer' } } },
    { cat: '물감 (유화·구아슈)', name: '유화 임파스토', tip: 'bristle', pv: '#d9a23a', desc: '물감을 두껍게 올려 붓 자국이 도드라지는 유화', o: { size: 50, flow: 1, thickness: 0.6, interval: 0.03, sizeEff: effP(0.5), dryOut: { len: 2600, min: 0.5 },
      bristle: BR('round', 20, 0.45, 0.07), impasto: { depth: 1, shine: 0.6 },
      mix: { mode: 'paint', amount: 0.8, density: 1, stretch: 0.4, amountEff: effP(0.5), densEff: null, ref: 'layer' } } },
    { cat: '물감 (유화·구아슈)', name: '마른 붓 (스컴블)', tip: 'flatbristle', pv: '#5b7f4a', desc: '물감 적은 붓을 문질러 털 자국만 거칠게 남기기', o: { size: 40, flow: 0.9, thickness: 0.3, interval: 0.03, sizeEff: effP(0.7), dryOut: { len: 500, min: 0.05 },
      bristle: BR('flat', 26, 0.8, 0.08), impasto: { depth: 0.3, shine: 0.15 },
      mix: { mode: 'paint', amount: 0.85, density: 1, stretch: 0.3, amountEff: null, densEff: null, ref: 'layer' } } },
    { cat: '물감 (유화·구아슈)', name: '구아슈', tip: 'flat', pv: '#d28a2d', desc: '불투명하고 무광으로 고르게 덮이는 물감', o: { size: 30, flow: 1, thickness: 0.35, interval: 0.04, sizeEff: effP(0.4), dryOut: { len: 1800, min: 0.7 },
      bristle: BR('flat', 18, 0.25, 0.04), impasto: { depth: 0.15, shine: 0 },
      mix: { mode: 'paint', amount: 0.85, density: 0.9, stretch: 0.3, amountEff: null, densEff: null, ref: 'layer' } } },
    { cat: '물감 (유화·구아슈)', name: '구아슈 둥근 붓', tip: 'round-hard', pv: '#c0392b', desc: '작은 면과 디테일을 납작하게 메우는 구아슈', o: { size: 18, flow: 1, thickness: 0.8, interval: 0.04, sizeEff: effP(0.3), smoothing: 12, dryOut: { len: 1500, min: 0.7 },
      bristle: BR('round', 14, 0.2, 0.04), impasto: { depth: 0.12, shine: 0 },
      mix: { mode: 'paint', amount: 0.9, density: 0.9, stretch: 0.25, amountEff: null, densEff: null, ref: 'layer' } } },
    { cat: '물감 (유화·구아슈)', name: '아크릴', tip: 'flatbristle', pv: '#2e7d5b', desc: '빨리 마르는 진한 물감, 끝으로 갈수록 털 자국', o: { size: 34, flow: 1, thickness: 0.32, interval: 0.03, sizeEff: effP(0.6), dryOut: { len: 1400, min: 0.35 },
      bristle: BR('flat', 24, 0.45, 0.06), impasto: { depth: 0.3, shine: 0.25 },
      mix: { mode: 'paint', amount: 0.9, density: 1, stretch: 0.2, amountEff: null, densEff: null, ref: 'layer' } } },
    { cat: '물감 (유화·구아슈)', name: '팔레트 나이프', tip: 'square', pv: '#c9a227', desc: '칼날로 물감을 펴 바르면 가장자리에 물감 둑이 생겨요', o: { size: 40, flow: 1, thickness: 0.2, interval: 0.02, sizeEff: effP(0.7), dryOut: { len: 1200, min: 0.55 },
      bristle: Object.assign(BR('flat', 40, 0.1, 0.03), { knife: true }), impasto: { depth: 0.7, shine: 0.4 },
      mix: { mode: 'paint', amount: 0.7, density: 1, stretch: 0.75, amountEff: effP(0.4), densEff: null, ref: 'layer' } } },
    // 섞기·문지르기
    { cat: '섞기·문지르기', name: '색 섞기 붓', tip: 'round-soft', desc: '밑색을 끌며 부드럽게 섞기', o: { size: 50, hardness: 0.3, flow: 0.8, interval: 0.06, sizeEff: null,
      mix: { mode: 'paint', amount: 0.2, density: 0.85, stretch: 0.4, amountEff: null, densEff: null, ref: 'layer' } } },
    { cat: '섞기·문지르기', name: '유화 블렌더', tip: 'bristle', desc: '마른 붓으로 물감 경계를 털 결 따라 풀어 주기', o: { size: 50, flow: 0.85, thickness: 0.6, interval: 0.04, sizeEff: effP(0.5),
      bristle: BR('round', 22, 0.4, 0.03), impasto: { depth: 0.25, shine: 0.2 },
      mix: { mode: 'paint', amount: 0, density: 1, stretch: 0.7, amountEff: null, densEff: null, ref: 'layer' } } },
    { cat: '섞기·문지르기', name: '손끝 (문지르기)', tip: 'round-soft', desc: '색 없이 손가락으로 문지르기', o: { size: 40, hardness: 0.3, flow: 0.7, interval: 0.05, sizeEff: null,
      mix: { mode: 'paint', amount: 0, density: 1, stretch: 0.85, amountEff: null, densEff: null, ref: 'layer' } } },
    { cat: '섞기·문지르기', name: '거친 문지르기', tip: 'chalk', tex: 'rough', desc: '결이 남게 문질러 펴기 (목탄·파스텔 문지르기)', o: { size: 40, rotMask: 0x80, rotRandom: 1, flow: 0.8, interval: 0.05, texDensity: 0.5, sizeEff: null,
      mix: { mode: 'paint', amount: 0, density: 1, stretch: 0.8, amountEff: null, densEff: null, ref: 'layer' } } },
    { cat: '섞기·문지르기', name: '붓털 문지르기', tip: 'drybrush', desc: '털 결을 따라 색을 끌어 늘이기', o: { size: 40, rotMask: 0x40, flow: 0.9, interval: 0.03, sizeEff: effP(0.6),
      mix: { mode: 'paint', amount: 0, density: 1, stretch: 0.75, amountEff: null, densEff: null, ref: 'layer' } } },
    // 에어브러시
    { cat: '에어브러시', name: '부드러운 에어브러시', tip: 'round-soft', pv: '#5a4fcf', desc: '아주 부드러운 그러데이션', o: { size: 120, hardness: 0, flow: 0.06, flowEff: effP(0.1), interval: 0.08, sizeEff: null } },
    { cat: '에어브러시', name: '단단한 에어브러시', tip: 'round-soft', pv: '#5a4fcf', desc: '가장자리가 조금 더 또렷한 에어브러시', o: { size: 60, hardness: 0.65, flow: 0.12, flowEff: effP(0.1), interval: 0.06, sizeEff: null } },
    { cat: '에어브러시', name: '거친 에어브러시', tip: 'round-soft', tex: 'grit', pv: '#5a4fcf', desc: '알갱이가 보이는 그러데이션 (노이즈 음영)', o: { size: 110, hardness: 0, flow: 0.14, flowEff: effP(0.1), interval: 0.06, sizeEff: null, texMode: 'height', texDensity: 0.45, texScale: 0.7 } },
    { cat: '에어브러시', name: '스프레이', tip: 'round-hard', pv: '#d03b3b', desc: '흩뿌린 물감 입자', o: { size: 60, flow: 0.7, interval: 0.15, sizeEff: null, spray: { size: 2, sync: false, density: 40, bias: 0, sizeEff: null, densEff: effP(0.2) } } },
    // 질감·특수
    { cat: '질감·특수', name: '종이결 칠', tip: 'round-soft', tex: 'tooth', desc: '종이 결이 살아 있는 넓은 음영', o: HP({ size: 80, hardness: 0.3, sizeEff: null, flow: 0.1, flowEff: effP(0.1), interval: 0.05, texDensity: 0.95, texScale: 0.7 }) },
    { cat: '질감·특수', name: '캔버스결 칠', tip: 'round-soft', tex: 'canvas', pv: '#8a5a3c', desc: '캔버스 천 결이 비치는 칠', o: HP({ size: 80, hardness: 0.3, sizeEff: null, flow: 0.07, flowEff: effP(0.1), texDensity: 0.6, texScale: 0.6 }) },
    { cat: '질감·특수', name: '그런지', tip: 'round-soft', tex: 'grunge', pv: '#4a4a4a', desc: '낡고 얼룩진 질감 칠하기', o: HP({ size: 90, hardness: 0.5, sizeEff: null, flow: 0.1, flowEff: effP(0.2), texDensity: 0.8, texScale: 1.3 }) },
    { cat: '질감·특수', name: '물감 튀김', tip: 'splatter', desc: '튀긴 물감 방울', o: { size: 60, interval: 0.6, rotMask: 0x80, rotRandom: 1, sizeEff: { random: { min: 0.5 } } } },
    { cat: '질감·특수', name: '빗금 칠', tip: 'round-hard', tex: 'hatch', desc: '칠한 곳에 빗금 무늬', o: { size: 40, flow: 1, interval: 0.05, texDensity: 1, sizeEff: null } },
    { cat: '질감·특수', name: '망점 (스크린톤)', tip: 'round-hard', tex: 'dots', desc: '칠한 곳에 망점 무늬', o: { size: 60, flow: 1, interval: 0.05, texDensity: 1, sizeEff: null } },
    // 장식·자연
    { cat: '장식·자연', name: '풀', tip: 'grass', pv: '#3f8f3a', desc: '풀잎 무더기를 이어 찍기', o: { size: 50, interval: 0.35, rotMask: 0x80, rotRandom: 0.12, sizeEff: { random: { min: 0.6 } }, jitter: { h: 8, s: 8, v: 15 } } },
    { cat: '장식·자연', name: '털 (레이크)', tip: 'rake', pv: '#6b4a2f', desc: '나란한 털 결을 한 번에', o: { size: 24, rotMask: 0x40, interval: 0.03, flow: 0.9, sizeEff: effP(0.5), taperIn: 20, taperOut: 30 } },
    { cat: '장식·자연', name: '털 가닥', tip: 'fur', pv: '#8a6a4a', desc: '짐승 털·머리카락 뭉치', o: { size: 30, rotation: 90, rotMask: 0xC0, rotRandom: 0.08, interval: 0.3, sizeEff: { random: { min: 0.6 } },
      spray: { size: 30, sync: true, density: 3, bias: 0, sizeEff: { random: { min: 0.5 } }, densEff: null } } },
    { cat: '장식·자연', name: '잎 뿌리기', tip: 'leaf', pv: '#4a9d4a', desc: '흩날리는 잎', o: { size: 90, interval: 0.6, rotMask: 0x80, rotRandom: 1, sizeEff: null, jitter: { h: 12, s: 10, v: 20 },
      spray: { size: 18, sync: false, density: 2, bias: 0, sizeEff: { random: { min: 0.5 } }, densEff: null } } },
    { cat: '장식·자연', name: '구름', tip: 'cloud', pv: '#8aa4c8', desc: '뭉게구름 덩이', o: { size: 120, flow: 0.5, interval: 0.3, rotMask: 0x80, rotRandom: 1, sizeEff: { random: { min: 0.6 } } } },
    { cat: '장식·자연', name: '반짝이', tip: 'sparkle', pv: '#e0a020', desc: '반짝이는 십자 빛', o: { size: 80, interval: 0.5, rotMask: 0x80, rotRandom: 1, sizeEff: null, jitter: { h: 0, s: 0, v: 30 },
      spray: { size: 10, sync: false, density: 3, bias: 0.3, sizeEff: { random: { min: 0.4 } }, densEff: null } } },
    { cat: '장식·자연', name: '별 뿌리기', tip: 'star', pv: '#e0a020', desc: '크기·색이 조금씩 다른 별', o: { size: 90, interval: 0.6, rotMask: 0x80, rotRandom: 1, sizeEff: null, jitter: { h: 40, s: 10, v: 10 },
      spray: { size: 14, sync: false, density: 2, bias: 0, sizeEff: { random: { min: 0.4 } }, densEff: null } } },
    { cat: '장식·자연', name: '눈송이', tip: 'snow', pv: '#6f9fd8', desc: '흩날리는 눈송이', o: { size: 70, interval: 0.7, rotMask: 0x80, rotRandom: 1, sizeEff: null, spray: { size: 10, sync: false, density: 2, bias: 0, sizeEff: { random: { min: 0.4 } }, densEff: null } } },
  ];
  // 예전 프리셋 이름 → 분류 (이미 만든 브러시도 알맞은 묶음에)
  const OLD_PRESET_CAT = { '연필': '연필·스케치', '진한 연필': '연필·스케치', '마커': '마커', '에어브러시': '에어브러시', '수채': '수채', '유화 (물감 섞기)': '물감 (유화·구아슈)',
    '크레용': '드라이 (목탄·파스텔)', '분필': '드라이 (목탄·파스텔)', '수채 번짐 (곱하기)': '수채', '망점(스크린톤)': '질감·특수' };
  const CAT_IMPORTED = '가져온 브러시', CAT_MINE = '내 브러시';
  function advCatOf(b) {
    if (b.cat) return b.cat;
    const pr = b.preset && ADV_PRESETS.find((p) => p.name === b.preset);
    if (pr) return pr.cat;
    if (b.preset && OLD_PRESET_CAT[b.preset]) return OLD_PRESET_CAT[b.preset];
    return b.builtin ? CAT_MINE : CAT_IMPORTED;
  }
  const advCatOrder = (c) => { const i = ADV_CATS.indexOf(c); return i >= 0 ? i : c === CAT_IMPORTED ? 100 : c === CAT_MINE ? 101 : 102; };
  // 프리셋 → 브러시 설정값 (그림 열쇠 없이). 새로 만들 때와 미리보기가 같은 값을 쓴다
  function presetBrushObj(pr) {
    const b = Object.assign(advBrushDefaults(), JSON.parse(JSON.stringify(pr.o)));
    b.name = pr.name; b.baseSize = b.size; b.preset = pr.name; b.cat = pr.cat;
    if (b.rotMask == null) b.rotMask = 3;
    if (PROC_TIPS.has(pr.tip) && pr.tip === 'round-soft' && b.hardness >= 0.99) b.hardness = 0.15;
    b.tips = [{ key: null, builtinId: pr.tip }]; b.texture = pr.tex ? { key: null, builtinId: pr.tex } : null;
    return b;
  }
  async function advNewFromPreset(pr) {
    const b = await advNewBrush(pr.tip);
    const o = presetBrushObj(pr);
    delete o.tips; delete o.texture;
    Object.assign(b, o);
    if (pr.tex) {
      const it = BUILTIN_TEX.find((t) => t.id === pr.tex);
      if (it) b.texture = { key: await advPutImage(await builtinBlob(it)), thumbKey: null, needPng: false, builtinId: it.id, bver: BUILTIN_VER };
    }
    await advSaveBrush(b);
    return b;
  }

  // ----- 획 미리보기: 실제 그리기 엔진으로 작은 S자 획을 그려 본다 (프리셋 고르기·내 브러시 목록) -----
  // 지금 브러시 상태를 잠깐 바꿔 끼우고, 작은 버퍼에 필압 0.1→1→0.1 획을 그린 뒤 원래대로 돌려놓는다(그리는 중에는 하지 않음).
  const SMP = { cache: new Map(), q: [], busy: false, tex: null, dtex: null, htex: null, float: null, bg: null, warned: false };
  const SMP_W = 300, SMP_H = 64;
  const smpHash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const hexRgb = (h) => { const n = parseInt(String(h || '#2b2b30').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  async function advBuiltinMask(id, isTex) {
    const k = 'bi:' + id + ':' + BUILTIN_VER + (isTex ? ':r' : '');
    if (ADV.tips.has(k)) return ADV.tips.get(k);
    const item = (isTex ? BUILTIN_TEX : BUILTIN_TIPS).find((t) => t.id === id);
    if (!item) return null;
    return advMaskFromBlob(k, await builtinBlob(item), isTex);
  }
  async function smpRes(b) {
    // 미리보기만 그릴 땐 편집기를 아직 못 잡았어도 된다 (보드 크기 버퍼는 실제로 그릴 때 다시 맞춘다)
    if (!ADV.gl) { const canvas = getCanvas(), E = getEditor(); if (canvas) advEnsureGL(canvas, E ? E.drawing.w : 64, E ? E.drawing.h : 64); }
    const proc = (b.tips || []).length === 1 && PROC_TIPS.has(b.tips[0].builtinId);
    const tips = [];
    if (!proc) for (const t of b.tips || []) {
      const i = t.key ? await advMaskTexture(t.key, false) : t.builtinId ? await advBuiltinMask(t.builtinId, false) : null;
      if (i) tips.push(i);
    }
    const tx = b.texture;
    const tex = tx ? (tx.key ? await advMaskTexture(tx.key, true) : tx.builtinId ? await advBuiltinMask(tx.builtinId, true) : null) : null;
    const dual = b.dual && b.dual.tip && b.dual.tip.key ? await advMaskTexture(b.dual.tip.key, false) : null;
    return { tips, tex, proc, dual };
  }
  // 섞기 브러시용 바탕: 종이 위에 빨강·파랑 띠 (끌려오는 색이 보이게)
  function smpMixBg() {
    if (SMP.bg) return SMP.bg;
    const W = SMP_W, H = SMP_H, a = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let c = [243, 240, 232];
      if (x < W * 0.58 && Math.abs(y - H * 0.34) < H * 0.2) c = [205, 74, 58];
      if (x > W * 0.42 && Math.abs(y - H * 0.68) < H * 0.18) c = [52, 104, 186];
      a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = 255;
    }
    return (SMP.bg = a);
  }
  function smpRender(brush, res, o) {
    const gl = ADV.gl, W = o.W || SMP_W, H = o.H || SMP_H;
    if (!gl || ADV.stroke || ADV.lost || !ADV.P.show) return null;
    if (!SMP.tex || SMP.float !== ADV.float || !gl.isTexture(SMP.tex) || SMP.tw !== W || SMP.th !== H) {
      SMP.tw = W; SMP.th = H;
      for (const t of [SMP.tex, SMP.dtex, SMP.htex]) if (t && gl.isTexture(t)) gl.deleteTexture(t);
      const mk = (f) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, f, W, H);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
      SMP.tex = mk(ADV.float ? gl.RGBA16F : gl.RGBA8); SMP.dtex = mk(gl.RGBA8); SMP.htex = mk(ADV.float ? gl.RGBA16F : gl.RGBA8); SMP.float = ADV.float;
    }
    const KEYS = ['stroke', 'brush', 'tipTex', 'texInfo', 'proc', 'dualTex', 'batch', 'dbatch', 'S', 'D', 'Hb', 'W', 'H'];
    const keep = {};
    for (const k of KEYS) keep[k] = ADV[k];
    let px = null;
    try {
      const b = JSON.parse(JSON.stringify(brush));
      const sz = Math.max(2.5, Math.min(brush.size, o.maxSize || (brush.spray ? H * 0.95 : H * 0.4))), k = sz / brush.size;
      b.size = sz; b.baseSize = (brush.baseSize || brush.size) * k; b.smoothing = o.pts ? (brush.smoothing || 0) : 0;
      b.taperIn = (b.taperIn || 0) * k; b.taperOut = (b.taperOut || 0) * k;
      if (b.dryOut && b.dryOut.len > 0) b.dryOut.len = Math.min(b.dryOut.len * k, W * 1.1); // 미리보기 획 길이(약 1.3W) 안에서 마르는 모습이 보이게
      if (b.spray && !b.spray.sync) b.spray.size *= Math.max(k, 0.8);
      if (b.dual) b.dual.size *= k;
      if (b.wedge) b.wedge.radius = Math.max(1, b.wedge.radius * k);
      Object.assign(ADV, { S: SMP.tex, D: SMP.dtex, Hb: SMP.htex, W, H, batch: [], dbatch: [], tipTex: res.tips, texInfo: res.tex, proc: res.proc, dualTex: res.dual || null, brush: b });
      advClear(SMP.tex, null); advClear(SMP.dtex, null); advClear(SMP.htex, null);
      const s = { pts: [], acc: 0, dist: 0, last: null, speed: 0, idx: 0, dir: 1, box: null, color: o.color, erase: false, v: 0, n: 0 };
      s.hsv = hsv(...s.color);
      if (o.bg && b.mix && b.mix.mode !== 'none' && W === SMP_W && H === SMP_H) s.mix = { E: null, L: null, ref: 'all', tiles: new Map(), K: null, snap: o.bg, W, H };
      ADV.stroke = s;
      const pad = Math.max(sz * 0.6, 4) + 6, amp = Math.max(0, H / 2 - sz * 0.55 - 3) * 0.85, N = 80;
      if (o.pts) { s.zoom = o.zoom || 1; for (const [x, y, p, t] of o.pts) advAddPoint({ pressure: p, pointerType: 'pen', timeStamp: t }, [x, y]);
        if (s.rawLast && s.last && b.smoothing > 0 && Math.hypot(s.rawLast.x - s.last.x, s.rawLast.y - s.last.y) > 0.5) { s.straight = true; advAddPoint({ pressure: s.rawLast.p, pointerType: 'pen', timeStamp: s.rawLast.t + 16 }, [s.rawLast.x, s.rawLast.y]); s.straight = false; } } // 시험: 기록한 실제 펜 입력 다시 넣기
      else for (let i = 0; i <= N; i++) {
        const f = i / N, p = 0.1 + 0.9 * Math.pow(Math.sin(Math.PI * f), 0.6);
        advAddPoint({ pressure: o.pr == null ? p : o.pr, pointerType: 'pen', timeStamp: i * (o.dt || 14) }, [pad + (W - 2 * pad) * f, H / 2 - Math.sin(f * Math.PI * 2) * amp]);
      }
      s.ending = true;
      if (b.taperOut > 0) for (const it of ADV.batch) { const f = Math.max(0.12, Math.min(1, (s.dist - it.dist) / b.taperOut)); it.d[2] *= f; }
      advFlush();
      const out = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, out); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, ADV.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
      gl.viewport(0, 0, W, H); gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const P = ADV.P.show; gl.useProgram(P.p); gl.bindVertexArray(ADV.vao);
      gl.uniform1f(P.u.uMode, 1); gl.uniform2f(P.u.uOff, 0, 0); gl.uniform2f(P.u.uDoc, W, H); gl.uniform1f(P.u.uOp, b.opacity == null ? 1 : b.opacity);
      advCtxUniforms(P, null); advTexUniforms(P); advDualUniforms(P, !!advDual(b)); advFxUniforms(P, true, false);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, SMP.tex); gl.uniform1i(P.u.uS, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.deleteTexture(out);
    } finally {
      for (const k of KEYS) ADV[k] = keep[k];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null);
    }
    return px;
  }
  function smpCanvas(px, o) {
    const W = o.W || SMP_W, H = o.H || SMP_H, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (o.bg && W === SMP_W && H === SMP_H) g.putImageData(new ImageData(new Uint8ClampedArray(o.bg), W, H), 0, 0);
    else { g.fillStyle = '#f3f0e8'; g.fillRect(0, 0, W, H); }
    if (px) {
      const t = new OffscreenCanvas(W, H);
      t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), W, H), 0, 0);
      g.globalCompositeOperation = o.multiply ? 'multiply' : 'source-over';
      g.drawImage(t, 0, 0);
    }
    return c;
  }
  // kind 'p' = 프리셋, 'b' = 저장된 브러시. cv(캔버스)에 그려 준다 (없으면 순서대로 만들어 둠)
  function smpKey(kind, obj) { return kind + ':' + BUILTIN_VER + ':' + (kind === 'p' ? obj.name : obj.id + ':' + smpHash(JSON.stringify(obj))); }
  function smpDraw(cv, src) { if (!cv || !src) return; const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(src, 0, 0, cv.width, cv.height); }
  function smpRequest(kind, obj, cv) {
    const key = smpKey(kind, obj);
    if (SMP.cache.has(key)) { smpDraw(cv, SMP.cache.get(key)); return; }
    SMP.q.push({ kind, obj, key, cv });
    setTimeout(smpPump, 0); // 카드가 화면에 붙은 뒤에 시작
  }
  async function smpPump() {
    if (SMP.busy) return;
    SMP.busy = true;
    let tries = 0;
    try {
      while (SMP.q.length) {
        if (ADV.stroke || BSZ.on) { await sleep(150); continue; }
        const it = SMP.q.shift();
        if (it.cv && !it.cv.isConnected) { if ((it.miss = (it.miss || 0) + 1) < 5) { SMP.q.push(it); await nextFrame(); } continue; } // 아직 화면에 안 붙었으면 조금 기다림
        if (!SMP.cache.has(it.key)) {
          const canvas = getCanvas(), E = getEditor();
          if (!canvas || !E) { if (++tries > 30) { SMP.q.length = 0; break; } SMP.q.unshift(it); await sleep(200); continue; } // 도구 바꾸는 중이면 잠깐 기다림
          try {
            advEnsureGL(canvas, E.drawing.w, E.drawing.h);
            const brush = it.kind === 'p' ? presetBrushObj(it.obj) : it.obj;
            const res = await smpRes(brush);
            if (ADV.stroke) { SMP.q.unshift(it); continue; }
            const pr = it.kind === 'p' ? it.obj : ADV_PRESETS.find((p) => p.name === brush.preset);
            const mixy = brush.mix && brush.mix.mode !== 'none';
            const o = { color: hexRgb(pr && pr.pv), bg: mixy ? smpMixBg() : null, multiply: brush.blend === 'multiply' || brush.blend === 'glaze' };
            SMP.cache.set(it.key, smpCanvas(smpRender(brush, res, o), o));
          } catch (e) { if (!SMP.warned) { SMP.warned = true; console.warn('[MagmaWand] 획 미리보기', e); } SMP.cache.set(it.key, null); }
        }
        smpDraw(it.cv, SMP.cache.get(it.key));
        await nextFrame();
      }
    } finally { SMP.busy = false; }
  }
  cleanups.push(() => { SMP.q.length = 0; SMP.cache.clear(); });

  // ----- 프리셋 고르기 창: 왼쪽 분류, 오른쪽 실제 획 미리보기 카드 -----
  function openPresetPicker(after) {
    document.querySelector('.mw-dialog-wrap')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'mw-dialog-wrap mw-el';
    wrap.innerHTML = `<div class="mw-dialog mw-pp" role="dialog">
      <div class="mw-dialog-title">새 브러시 — 프리셋 ${ADV_PRESETS.length}종</div>
      <div class="mw-pp-top"><input type="text" class="mw-bs-text mw-pp-q" placeholder="찾기 — 예: 연필, 목탄, 수채, 결"><span class="mw-pp-tip">고르면 지금 색으로 새 브러시가 만들어져요</span></div>
      <div class="mw-pp-body"><div class="mw-pp-cats"></div><div class="mw-pp-grid"></div></div>
      <div class="mw-dialog-btns"><button type="button" class="sm btn secondary mw-pr-blank">빈 브러시 (끝 모양만 고르기)</button><button type="button" class="sm btn secondary mw-pr-close">닫기</button></div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    wrap.querySelector('.mw-pr-close').addEventListener('click', close);
    wrap.querySelector('.mw-pr-blank').addEventListener('click', async () => {
      close();
      try { const b = await advNewBrush(); await advSelect(b.id); after?.(); openAdvPngDialog(ADV.brush || b, after); } catch (err) { toast('브러시를 만들지 못했어요: ' + (err && err.message || err)); }
    });
    const cats = wrap.querySelector('.mw-pp-cats'), grid = wrap.querySelector('.mw-pp-grid'), qIn = wrap.querySelector('.mw-pp-q');
    let cat = ADV_CATS.includes(S.ppCat) ? S.ppCat : '전체';
    const card = (pr) => {
      const x = document.createElement('button'); x.type = 'button'; x.className = 'mw-pp-card'; x.title = pr.desc || pr.name;
      const cv = document.createElement('canvas'); cv.width = SMP_W; cv.height = SMP_H;
      const nm = document.createElement('div'); nm.className = 'mw-pp-name'; nm.textContent = pr.name;
      const ds = document.createElement('div'); ds.className = 'mw-pp-desc'; ds.textContent = pr.desc || '';
      x.append(cv, nm, ds);
      smpRequest('p', pr, cv);
      x.addEventListener('click', async () => {
        close();
        try { const b = await advNewFromPreset(pr); await advSelect(b.id); after?.(); note(`"${pr.name}" 브러시를 만들었어요`); }
        catch (err) { toast('브러시를 만들지 못했어요: ' + (err && err.message || err)); }
      });
      return x;
    };
    function draw() {
      const q = qIn.value.trim().toLowerCase();
      cats.innerHTML = '';
      for (const c of ['전체', ...ADV_CATS]) {
        const n = c === '전체' ? ADV_PRESETS.length : ADV_PRESETS.filter((p) => p.cat === c).length;
        const t = document.createElement('button'); t.type = 'button'; t.className = 'mw-pp-cat' + (c === cat && !q ? ' on' : '');
        t.innerHTML = '<span></span><b></b>'; t.firstChild.textContent = c; t.lastChild.textContent = n;
        t.addEventListener('click', () => { cat = c; S.ppCat = c; saveSettings(); qIn.value = ''; draw(); grid.scrollTop = 0; });
        cats.appendChild(t);
      }
      grid.innerHTML = '';
      SMP.q = SMP.q.filter((it) => it.cv && it.cv.isConnected && !grid.contains(it.cv));
      const list = q ? ADV_PRESETS.filter((p) => { const t = p.name + ' ' + p.cat + ' ' + (p.desc || ''); return (t + ' ' + i18nText(p.name) + ' ' + i18nText(p.cat) + ' ' + i18nText(p.desc || '')).toLowerCase().includes(q); }) : cat === '전체' ? ADV_PRESETS : ADV_PRESETS.filter((p) => p.cat === cat);
      if (!list.length) { grid.innerHTML = '<div class="mw-advempty">찾는 프리셋이 없어요</div>'; return; }
      let last = null;
      for (const pr of list) {
        if ((q || cat === '전체') && pr.cat !== last) { const h = document.createElement('div'); h.className = 'mw-pp-head'; h.textContent = pr.cat; grid.appendChild(h); last = pr.cat; }
        grid.appendChild(card(pr));
      }
    }
    qIn.addEventListener('input', draw);
    draw();
    setTimeout(() => qIn.focus(), 0);
  }

  // ---------- 입력 가로채기 ----------
  // 도구가 켜져 있으면 그림판 위의 실제 클릭·끌기는 Magma에 넘기지 않고 이 도구가 처리한다.
  const BLOCK = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'];
  let pendingDown = false;
  // Space를 누르고 있으면 Magma 화면 이동(손)에 맡긴다 — Magma 도구와 똑같이
  let spaceDown = false;
  on(window, 'keydown', (e) => { if (e.code === 'Space' && e.isTrusted) { const t = e.target; if (!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) spaceDown = true; } }, true);
  on(window, 'keyup', (e) => { if (e.code === 'Space') spaceDown = false; }, true);
  on(window, 'blur', () => { spaceDown = false; LSCR.pid = null; grabHover(null); document.documentElement.classList.remove('mw-lgrab', 'mw-lgrabbing'); });
  // Space+끌기를 그림판 둘레의 세로로 굴러가는 칸(레이어 목록·도구 설정·브러시 설정·메뉴 등) 위에서 하면
  // 그 칸을 위아래로만 쓸어 넘긴다 (손 도구처럼, 관성 없음). 그림판 위에서는 Magma 손 도구 그대로.
  const LSCR = { pid: null, y0: 0, top0: 0, el: null, block: false, hov: null };
  function vScroller(el) {
    for (let n = el; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.tagName === 'CANVAS') return null;
      if (n.scrollHeight > n.clientHeight + 2) { const oy = getComputedStyle(n).overflowY; if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return n; }
    }
    return null;
  }
  function layerScroller() {
    const row = document.querySelector('editor-layers .layer');
    return vScroller(row) || document.querySelector('editor-layers .scroll-scroller');
  }
  function scrollTargetAt(el) {
    if (!el || !el.closest) return null;
    const sc = vScroller(el);
    if (sc) return sc;
    return el.closest('editor-layers layer-list, editor-layers .layers') ? layerScroller() : null;
  }
  function grabHover(el) {
    const sc = el && spaceDown && LSCR.pid === null ? scrollTargetAt(el) : null;
    if (LSCR.hov === sc) return;
    if (LSCR.hov) LSCR.hov.classList.remove('mw-sgrab');
    LSCR.hov = sc;
    if (sc) sc.classList.add('mw-sgrab');
  }
  on(window, 'keydown', (e) => { if (spaceDown && e.code === 'Space' && !e.repeat) { const h = [...document.querySelectorAll(':hover')].pop(); grabHover(h); } }, true);
  on(window, 'keyup', (e) => { if (e.code === 'Space') grabHover(null); }, true);
  on(window, 'pointermove', (e) => { if (spaceDown && LSCR.pid === null) grabHover(e.target); }, { capture: true, passive: true });
  function onLayerScroll(e) {
    if (!e.isTrusted) return;
    if (LSCR.pid !== null) {
      e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
      if (e.type === 'pointermove' && e.pointerId === LSCR.pid && LSCR.el) LSCR.el.scrollTop = LSCR.top0 - (e.clientY - LSCR.y0);
      if ((e.type === 'pointerup' || e.type === 'pointercancel') && e.pointerId === LSCR.pid) {
        LSCR.pid = null; LSCR.block = true; setTimeout(() => { LSCR.block = false; }, 300);
        document.documentElement.classList.remove('mw-lgrabbing');
      }
      return;
    }
    if (LSCR.block && (e.type === 'mouseup' || e.type === 'click')) { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); if (e.type === 'click') LSCR.block = false; return; }
    if (e.type !== 'pointerdown' || e.button !== 0 || !spaceDown) return;
    const sc = scrollTargetAt(e.target);
    if (!sc) return;
    grabHover(null);
    e.stopImmediatePropagation(); e.preventDefault();
    Object.assign(LSCR, { pid: e.pointerId, y0: e.clientY, top0: sc.scrollTop, el: sc });
    document.documentElement.classList.add('mw-lgrabbing');
  }
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dragstart']) on(window, t, (e) => { if (e.type === 'dragstart' && LSCR.pid !== null) { e.preventDefault(); e.stopImmediatePropagation(); return; } onLayerScroll(e); }, true);
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
    if (S.tool === 'brush' && ADV.stroke && (e.type === 'pointerup' || e.type === 'pointercancel' || e.type === 'mouseup')) {
      e.stopImmediatePropagation(); e.preventDefault();
      if (e.type !== 'mouseup' && e.pointerId === ADV.pid) advStrokeEnd(e.type === 'pointercancel');
      return;
    }
    if (S.tool === 'qmask' && QM.st && (e.type === 'pointerup' || e.type === 'pointercancel' || e.type === 'mouseup')) {
      e.stopImmediatePropagation(); e.preventDefault();
      if (e.type !== 'mouseup' && e.pointerId === QM.st.pid) qmEnd();
      return;
    }
    if (S.tool === 'blur' && BLR.st && (e.type === 'pointerup' || e.type === 'pointercancel' || e.type === 'mouseup')) {
      e.stopImmediatePropagation(); e.preventDefault();
      if (e.type !== 'mouseup' && e.pointerId === BLR.st.pid) blurEnd(e.type === 'pointercancel');
      return;
    }
    if (e.target !== canvas) return;
    if (spaceDown && !Q.stroking && !ADV.stroke && !BLR.st && !QM.st) return; // Space+끌기 = 화면 이동
    if (e.type.startsWith('touch')) { e.stopImmediatePropagation(); return; }
    if (e.button !== 0) return; // 가운데/오른쪽 버튼(화면 이동 등)은 그대로 통과
    e.stopImmediatePropagation();
    e.preventDefault();
    if (S.tool === 'quick') {
      if (e.type === 'pointerdown' && !S.busy && !Q.stroking) qStart(e, canvas);
      return;
    }
    if (S.tool === 'brush') {
      if (e.type === 'pointerdown') advPointerDown(e);
      return;
    }
    if (S.tool === 'blur') {
      if (e.type === 'pointerdown') blurPointerDown(e);
      return;
    }
    if (S.tool === 'qmask') {
      if (e.type === 'pointerdown') qmPointerDown(e);
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
    if (S.tool === 'brush' && canvas) {
      const r = canvas.getBoundingClientRect();
      const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      advCursor(e.clientX, e.clientY, (over || ADV.stroke) && !BSZ.on);
      if (ADV.stroke) { e.stopImmediatePropagation(); advPointerMove(e); }
      return;
    }
    if (S.tool === 'qmask' && canvas) {
      const r = canvas.getBoundingClientRect();
      const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      qmCursor(e.clientX, e.clientY, (over || QM.st) && !BSZ.on);
      if (QM.st) { e.stopImmediatePropagation(); qmPointerMove(e); }
      return;
    }
    if (S.tool === 'blur' && canvas) {
      const r = canvas.getBoundingClientRect();
      const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      blurCursor(e.clientX, e.clientY, (over || BLR.st) && !BSZ.on);
      if (BLR.st) { e.stopImmediatePropagation(); blurPointerMove(e); }
      return;
    }
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
  function blurCursor(cx, cy, show) {
    if (!Q.cursor) { Q.cursor = document.createElement('div'); Q.cursor.className = 'mw-brush mw-el'; document.body.appendChild(Q.cursor); }
    if (!show) { Q.cursor.style.display = 'none'; return; }
    const d = Math.max(4, S.blurSize * viewZoom());
    Object.assign(Q.cursor.style, { display: 'block', width: d + 'px', height: d + 'px', left: (cx - d / 2) + 'px', top: (cy - d / 2) + 'px' });
  }
  on(window, 'keydown', (e) => {
    if (!S.active || S.tool !== 'blur' || !e.isTrusted) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.code === 'Escape' && BLR.st) { e.preventDefault(); e.stopImmediatePropagation(); blurEnd(true); return; }
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      const v = S.blurSize, step = v < 10 ? 1 : v < 50 ? 5 : v < 200 ? 10 : 50;
      S.blurSize = Math.min(500, Math.max(1, Math.round(v + (e.code === 'BracketRight' ? step : -step))));
      saveSettings(); rowsEl?.__mwSync?.();
    }
  }, true);
  on(window, 'keydown', (e) => {
    if (!S.active || S.tool !== 'brush' || !e.isTrusted || !ADV.brush) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.code === 'Escape' && ADV.stroke) { e.preventDefault(); e.stopImmediatePropagation(); advStrokeEnd(true); return; }
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      const v = S.advSize || ADV.brush.size, step = v < 10 ? 1 : v < 50 ? 5 : v < 200 ? 10 : 50;
      S.advSize = Math.min(1000, Math.max(1, Math.round(v + (e.code === 'BracketRight' ? step : -step))));
      ADV.brush.size = S.advSize; advSaveSoon(); rowsEl?.__mwSync?.();
      if (Q.cursor && Q.cursor.style.display === 'block') {
        const cx = parseFloat(Q.cursor.style.left) + parseFloat(Q.cursor.style.width) / 2, cy = parseFloat(Q.cursor.style.top) + parseFloat(Q.cursor.style.height) / 2;
        advCursor(cx, cy, true);
      }
    }
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
  const TOOL_LABEL = { wand: '마법봉', quick: '빠른 선택', brush: '고급 브러시', blur: '블러', qmask: '퀵 마스크' };
  const TOOL_KEYS = { wand: 'keys', quick: 'qkeys', brush: 'bkeys' };

  on(window, 'keydown', (e) => {
    if (capturingKey || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!getCanvas() || document.querySelector('.modal-dialog')) return;
    const c = comboOf(e);
    if (!c) return;
    // B: 이미 Magma 브러시면 고급 브러시로, 고급 브러시면 Magma 브러시로 (누를 때마다 번갈아)
    if (c === 'KeyB' && !S.busy) {
      if (S.active && S.tool === 'brush') { e.preventDefault(); e.stopImmediatePropagation(); activateMember('faPaintBrush'); return; }
      if (!S.active && currentTool() === 'faPaintBrush') { e.preventDefault(); e.stopImmediatePropagation(); activateMember('@brush'); return; }
    }
    const tool = S.keys.includes(c) ? 'wand' : S.qkeys.includes(c) ? 'quick' : S.bkeys.includes(c) ? 'brush' : S.lkeys.includes(c) ? 'blur' : S.mkeys.includes(c) ? 'qmask' : null;
    if (!tool) return;
    if (tool === 'qmask' && S.active && S.tool === 'qmask') { e.preventDefault(); e.stopImmediatePropagation(); activateMember('lassoSelectionIcon'); return; } // 퀵 마스크 단축키를 다시 누르면 나가기(선택으로 반영)
    // 사용자가 고른 키이므로 Magma의 같은 키 동작보다 이 도구를 우선한다
    e.preventDefault(); e.stopImmediatePropagation();
    setActive(true, tool);
  }, true);

  // 설정 창의 단축키 표(Tools)에 '마법봉'·'빠른 선택' 줄을 Magma 줄과 같은 모양으로 넣는다.
  // 바꾼 내용은 설정 창의 Save를 눌러야 저장되고, Cancel·닫기면 버려진다 (Magma와 같은 방식)
  const SC_ROWS = [{ key: 'keys', label: '마법봉 (Magic Wand)' }, { key: 'qkeys', label: '빠른 선택 (Quick Selection)' }, { key: 'bkeys', label: '고급 브러시 (CSP Brush)' }, { key: 'lkeys', label: '블러 (Blur)' }, { key: 'mkeys', label: '퀵 마스크 (Quick Mask)' }, { key: 'akeys', label: '투명색 전환 (Transparent Color)' }];
  let scRows = {}, stagedAll = null, capturingKey = false, hookedModal = null;
  function ensureShortcutRow() {
    const modal = [...document.querySelectorAll('.modal-dialog')].find((m) => /Application settings/.test(m.textContent));
    if (!modal) { scRows = {}; stagedAll = null; capturingKey = false; hookedModal = null; return; }
    if (stagedAll === null) stagedAll = { keys: S.keys.slice(), qkeys: S.qkeys.slice(), bkeys: S.bkeys.slice(), akeys: S.akeys.slice(), lkeys: S.lkeys.slice(), mkeys: S.mkeys.slice() };
    if (hookedModal !== modal) {
      hookedModal = modal;
      modal.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('button');
        if (b && b.textContent.trim() === 'Save' && stagedAll) {
          S.keys = stagedAll.keys.slice(); S.qkeys = stagedAll.qkeys.slice(); S.bkeys = stagedAll.bkeys.slice(); S.akeys = stagedAll.akeys.slice(); S.lkeys = stagedAll.lkeys.slice(); S.mkeys = stagedAll.mkeys.slice(); saveSettings(); syncTooltip();
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
    requestAnimationFrame(() => { modalObserver.pending = false; ensureShortcutRow(); ensureMenuItems(); if (LP.on) ensureLayerProps(); ensureKoRow(); ensureFillRow(); });
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
      note(`${label} 중…`);
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
      note(`${label} 완료`);
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
  // 자주 일어나는 성공·상태 안내는 팝업 없이 설정 칸 상태 줄에만 (팝업은 오류·경고·드문 기능 결과만)
  function note(msg) { status(msg); }
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
  const FX_SVG = '<path fill="none" stroke="currentColor" stroke-width="40" d="M150 120h212a40 40 0 0 1 40 40v192a40 40 0 0 1-40 40H150a40 40 0 0 1-40-40V160a40 40 0 0 1 40-40z"/>' +
    '<path fill="currentColor" d="M196 206h120v100H196z"/>';
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
      const f = make('레이어 속성 (내 화면)…', FX_SVG, false, () => lpShow(true));
      inv.after(a, b, h, f);
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

  // ---------- 레이어 스트로크 (클립 스튜디오 '레이어 속성 → 경계 효과', 내 화면에만) ----------
  // 보드에는 평범한 래스터 레이어 그대로 두고, 내 화면에서만 그 레이어 둘레에 테두리를 그려 보여 준다.
  //  - Magma 화면 위에 내 WebGL 캔버스를 한 장 겹치고, 테두리 = 거리장(점프 플러딩)으로 계산한 '그림까지의 거리' 띠.
  //  - 테두리는 그 레이어 그림 밑, 위 레이어들 밑에 있어야 하므로 (1 − 그 레이어 알파) × (1 − 위 레이어들 알파)로 가린다.
  //  - 긋는 도중에도 매 프레임: Magma가 긋는 중인 획(user.surface)의 바뀐 부분만 읽어 그 둘레만 다시 계산한다.
  //  - 읽기는 Magma 내부 읽기 함수만 쓰고 보드로 아무것도 보내지 않는다(트래픽 0). 설정은 보드·레이어별로 저장해
  //    다시 들어와도 이어진다. 화면이 안 바뀌면 다시 그리지 않는다.
  const FX_KEY = 'magmaWand.layerFx';
  const FX_MAXR = 120;          // 두께 + 흐리기 상한(픽셀) — 거리 정보를 1바이트 오프셋에 담기 위함
  const FX = { gl: null, cv: null, prog: {}, raf: 0, board: null, layers: new Map(), upper: null, lastXf: '', lastCheck: 0,
    stroke: null, lost: false, W: 0, H: 0 };
  function fxAll() { try { return JSON.parse(localStorage.getItem(FX_KEY) || '{}') || {}; } catch { return {}; } }
  function fxGet(board, uid) { const a = fxAll(); return (a[board] && a[board][uid]) || null; }
  function fxSet(board, uid, cfg) {
    const a = fxAll();
    a[board] = a[board] || {};
    if (cfg) a[board][uid] = cfg; else delete a[board][uid];
    try { localStorage.setItem(FX_KEY, JSON.stringify(a)); } catch { }
    fxKick();
  }
  const FX_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;
  const FX_SEED = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uA; uniform float uThr;
out ivec4 o;
void main(){ ivec2 p = ivec2(gl_FragCoord.xy); float a = texelFetch(uA, p, 0).r; o = a >= uThr ? ivec4(0) : ivec4(-128); }`;
  const FX_JFA = `#version 300 es
precision highp float; precision highp int;
uniform highp isampler2D uS; uniform int uK; uniform ivec2 uSize;
out ivec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); ivec2 best = ivec2(-128); float bd = 1e20;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 q = p + ivec2(i, j) * uK;
    if (q.x < 0 || q.y < 0 || q.x >= uSize.x || q.y >= uSize.y) continue;
    ivec2 s = texelFetch(uS, q, 0).xy;
    if (s.x == -128) continue;
    ivec2 c = q + s; vec2 dv = vec2(c - p); float d = dot(dv, dv);
    if (d < bd) { bd = d; best = c - p; }
  }
  if (best.x != -128 && (abs(best.x) > 127 || abs(best.y) > 127)) best = ivec2(-128);
  o = ivec4(best, 0, 0);
}`;
  const FX_DRAW = `#version 300 es
precision highp float; precision highp int;
uniform highp isampler2D uS; uniform sampler2D uA; uniform sampler2D uU;
uniform vec3 uInv0; uniform vec3 uInv1; uniform float uH; uniform vec2 uDoc;
uniform vec4 uColor; uniform float uW; uniform float uB; uniform float uAA; uniform float uOp; uniform float uUseU;
out vec4 o;
void main(){
  vec2 sp = vec2(gl_FragCoord.x, uH - gl_FragCoord.y);
  vec2 p = vec2(dot(uInv0, vec3(sp, 1.0)), dot(uInv1, vec3(sp, 1.0)));
  if (p.x < 0.0 || p.y < 0.0 || p.x >= uDoc.x || p.y >= uDoc.y) discard;
  ivec2 ip = ivec2(floor(p));
  ivec2 s = texelFetch(uS, ip, 0).xy;
  if (s.x == -128) discard;
  vec2 c = vec2(ip + s) + 0.5;
  float d = length((uAA > 0.5 ? p : vec2(ip) + 0.5) - c);
  float cov;
  if (uB > 0.0) cov = 1.0 - smoothstep(uW + 0.5 - uB, uW + 0.5 + uB, d);
  else if (uAA > 0.5) cov = clamp(uW + 1.0 - d, 0.0, 1.0);
  else cov = d <= uW + 0.5 ? 1.0 : 0.0;
  vec2 uv = p / uDoc;
  cov *= 1.0 - texture(uA, uv).r;
  cov *= 1.0 - texture(uU, uv).r * uUseU;
  cov *= uOp * uColor.a;
  if (cov <= 0.002) discard;
  o = vec4(uColor.rgb * cov, cov);
}`;
  function fxCompile(gl, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('셰이더: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, FX_VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('셰이더 연결: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  function fxEnsureGL(canvas) {
    const host = canvas.parentElement;
    if (!FX.cv || !FX.cv.isConnected || FX.cv.parentElement !== host) {
      FX.cv?.remove();
      FX.cv = document.createElement('canvas');
      FX.cv.className = 'mw-fx mw-el';
      FX.gl = FX.cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
      if (!FX.gl) throw new Error('WebGL2를 쓸 수 없어요');
      FX.cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); FX.lost = true; });
      FX.cv.addEventListener('webglcontextrestored', () => { FX.lost = false; FX.prog = {}; FX.layers.clear(); FX.upper = null; fxKick(); });
      FX.prog = {}; FX.layers.clear(); FX.upper = null;
      canvas.after(FX.cv);
    }
    // Magma 캔버스와 같은 자리·크기
    const cs = canvas.style;
    Object.assign(FX.cv.style, { position: 'absolute', left: canvas.offsetLeft + 'px', top: canvas.offsetTop + 'px',
      width: canvas.offsetWidth + 'px', height: canvas.offsetHeight + 'px', pointerEvents: 'none', zIndex: cs.zIndex || '' });
    if (FX.cv.width !== canvas.width || FX.cv.height !== canvas.height) { FX.cv.width = canvas.width; FX.cv.height = canvas.height; FX.lastXf = ''; }
    const gl = FX.gl;
    if (!FX.prog.seed) {
      FX.prog.seed = fxCompile(gl, FX_SEED); FX.prog.jfa = fxCompile(gl, FX_JFA); FX.prog.draw = fxCompile(gl, FX_DRAW);
      FX.vao = gl.createVertexArray();
      FX.fb = gl.createFramebuffer();
    }
    return gl;
  }
  function fxTex(gl, internal, w, h, format, type, filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  // 레이어 하나의 GPU 상태: 알파(A), 거리 시드 두 장(핑퐁)
  function fxLayerState(gl, uid, W, H) {
    let st = FX.layers.get(uid);
    if (st && st.W === W && st.H === H) return st;
    if (st) { gl.deleteTexture(st.A); gl.deleteTexture(st.S0); gl.deleteTexture(st.S1); }
    st = { uid, W, H, base: new Uint8Array(W * H), A: fxTex(gl, gl.R8, W, H, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR),
      S0: fxTex(gl, gl.RG8I, W, H, gl.RG_INTEGER, gl.BYTE, gl.NEAREST), S1: fxTex(gl, gl.RG8I, W, H, gl.RG_INTEGER, gl.BYTE, gl.NEAREST),
      sig: null, ready: false, R: 0, cur: 0 };
    FX.layers.set(uid, st);
    return st;
  }
  // 레이어 RGBA → 알파만, 보드 좌표의 rect 자리에
  function fxPutAlpha(dst, W, rect, rgba, rw) {
    for (let y = 0; y < rect.h; y++) {
      let s = (y * rw) * 4 + 3, d = (rect.y + y) * W + rect.x;
      for (let x = 0; x < rect.w; x++, s += 4, d++) dst[d] = rgba[s];
    }
  }
  // src: 가로 W짜리 배열에서 rect 부분을, 텍스처의 (dx, dy) 자리(기본은 rect 자리)에 올린다
  function fxUpload(gl, tex, W, rect, src, dx = rect.x, dy = rect.y) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, W);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rect.x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rect.y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, dx, dy, rect.w, rect.h, gl.RED, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }
  const rclip = (r, W, H) => {
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  };
  const rgrow = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
  const runion = (a, b) => !a ? b : !b ? a : (() => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; })();

  // 레이어 전체(또는 rect 부분)의 알파를 Magma에서 읽어 base에 넣는다
  function fxReadLayer(E, L, st, rect) {
    const lr = L.rect;
    const W = st.W, H = st.H;
    if (!rect) { st.base.fill(0); rect = { x: 0, y: 0, w: W, h: H }; }
    else for (let y = rect.y; y < rect.y + rect.h; y++) st.base.fill(0, y * W + rect.x, y * W + rect.x + rect.w);
    if (!lr || !(lr.w > 0 && lr.h > 0) || !L.texture) return rect;
    const ir = rclip({ x: Math.max(rect.x, lr.x), y: Math.max(rect.y, lr.y),
      w: Math.min(rect.x + rect.w, lr.x + lr.w) - Math.max(rect.x, lr.x), h: Math.min(rect.y + rect.h, lr.y + lr.h) - Math.max(rect.y, lr.y) }, W, H);
    if (!ir) return rect;
    if (ir.x === lr.x && ir.y === lr.y && ir.w === lr.w && ir.h === lr.h) {
      const raw = E.renderer.getLayerRawData(L); // 읽기 전용
      fxPutAlpha(st.base, W, ir, raw.data, raw.width);
    } else {
      const img = E.renderer.getLayerImageData(L, ir); // 읽기 전용 (레이어 안쪽 rect)
      fxPutAlpha(st.base, W, ir, img.data, img.width);
    }
    return rect;
  }
  // 거리장 다시 계산 (rect 둘레만)
  function fxJfa(gl, st, rect, R) {
    const W = st.W, H = st.H;
    const area = rclip(rgrow(rect, 2 * R + 2), W, H);
    if (!area) return;
    gl.bindVertexArray(FX.vao);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(area.x, area.y, area.w, area.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, FX.fb);
    // 시드
    let src = st.S0, dst = st.S1;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0);
    gl.useProgram(FX.prog.seed.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.A);
    gl.uniform1i(FX.prog.seed.u.uA, 0); gl.uniform1f(FX.prog.seed.u.uThr, 0.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 점프 플러딩
    gl.useProgram(FX.prog.jfa.p);
    gl.uniform2i(FX.prog.jfa.u.uSize, W, H);
    gl.uniform1i(FX.prog.jfa.u.uS, 0);
    let k = 1; while (k * 2 <= R + 2) k *= 2;
    const steps = [];
    for (; k >= 1; k = k >> 1) steps.push(k);
    steps.push(1); // 마지막 한 번 더 (정확도)
    for (const kk of steps) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform1i(FX.prog.jfa.u.uK, kk);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const t = src; src = dst; dst = t;
    }
    // 결과가 S0에 오도록 맞춘다
    if (src !== st.S0) { st.S1 = st.S0; st.S0 = src; }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function fxUpperState(gl, W, H) {
    if (FX.upper && FX.upper.W === W && FX.upper.H === H) return FX.upper;
    if (FX.upper) gl.deleteTexture(FX.upper.U);
    FX.upper = { W, H, U: fxTex(gl, gl.R8, W, H, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR), sig: null, buf: new Uint8Array(W * H) };
    return FX.upper;
  }
  // 위 레이어들(보이는 것)의 알파를 합친 것 — 테두리를 그 밑에 숨기기 위함
  function fxUpdateUpper(E, gl, W, H, belowIndex, force) {
    const up = fxUpperState(gl, W, H);
    const layers = E.drawing.layers.slice(0, belowIndex).filter((l) => l.visible !== false && l.rect && l.rect.w > 0 && l.texture);
    const sig = layers.map((l) => (l.uid || l.id) + ':' + l.opacity + ':' + (l.rect ? `${l.rect.x},${l.rect.y},${l.rect.w},${l.rect.h}` : '') + ':' +
      (l.thumbData && l.thumbData.data ? hash32(l.thumbData.data) : '')).join('|') + '#' + belowIndex;
    if (!force && sig === up.sig) return up;
    up.sig = sig;
    const u = up.buf; u.fill(0);
    for (const l of layers) {
      const lr = rclip(l.rect, W, H); if (!lr) continue;
      let raw; try { raw = E.renderer.getLayerRawData(l); } catch { continue; }
      const op = Math.max(0, Math.min(1, l.opacity == null ? 1 : l.opacity));
      for (let y = 0; y < lr.h; y++) {
        let s = ((lr.y - l.rect.y + y) * raw.width + (lr.x - l.rect.x)) * 4 + 3, d = (lr.y + y) * W + lr.x;
        for (let x = 0; x < lr.w; x++, s += 4, d++) {
          const a = raw.data[s] * op;
          if (a) u[d] = 255 - (((255 - u[d]) * (255 - a)) / 255) | 0;
        }
      }
    }
    fxUpload(gl, up.U, W, { x: 0, y: 0, w: W, h: H }, u);
    return up;
  }
  // 긋는 중인 획: Magma의 user.surface에서 바뀐 부분을 읽어 base와 합친다
  function fxApplySurface(E, gl, st, L, region) {
    const s = E.model.user.surface;
    const rect = rclip(region, st.W, st.H);
    if (!rect) return null;
    const rgba = new Uint8Array(rect.w * rect.h * 4);
    try {
      const raw = E.renderer.getLayerRawData({ texture: s.texture, rect, textureX: s.textureX || 0, textureY: s.textureY || 0 }); // 읽기 전용
      rgba.set(raw.data.subarray(0, rgba.length));
    } catch { return null; }
    const tool = E.model.user.activeTool;
    const erase = (tool && tool.id === 3) || s.mode === 2;
    const replace = !!(tool && tool.moveLayerToSurface);
    const op = s.opacity == null ? 1 : s.opacity;
    const out = new Uint8Array(rect.w * rect.h);
    const W = st.W;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const i = y * rect.w + x, a = rgba[i * 4 + 3] * op, b = st.base[(rect.y + y) * W + rect.x + x];
        out[i] = replace ? a : erase ? (b * (255 - a)) / 255 : Math.max(b, a);
      }
    }
    fxUpload(gl, st.A, rect.w, { x: 0, y: 0, w: rect.w, h: rect.h }, out, rect.x, rect.y);
    return rect;
  }
  function fxKick() { if (!FX.raf) FX.raf = requestAnimationFrame(fxFrame); FX.lastXf = ''; }
  function fxStop() {
    cancelAnimationFrame(FX.raf); FX.raf = 0;
    if (FX.cv) { const gl = FX.gl; if (gl && !FX.lost) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } FX.cv.style.display = 'none'; }
  }
  function fxFrame() {
    FX.raf = 0;
    try { fxStep(); } catch (e) { console.warn('[MagmaWand] 레이어 스트로크', e); FX.lastErr = String(e); }
  }
  function fxStep() {
    const board = boardId();
    const cfgs = board ? (fxAll()[board] || {}) : {};
    const on = Object.entries(cfgs).filter(([, c]) => c && c.on);
    if (!on.length) { fxStop(); return; }
    const E = getEditor(), canvas = getCanvas();
    if (!E || !canvas || FX.lost) { FX.raf = requestAnimationFrame(fxFrame); return; }
    const d = E.drawing, cv = E.computedView;
    if (!d || !cv || !cv.inverseTransform || !(d.w > 0)) { FX.raf = requestAnimationFrame(fxFrame); return; }
    const W = d.w, H = d.h;
    if (W * H > 36e6) { fxStop(); toast('보드가 너무 커서 레이어 스트로크를 쓸 수 없어요'); return; }
    if (FX.board !== board) { FX.board = board; for (const st of FX.layers.values()) st.ready = false; if (FX.upper) FX.upper.sig = null; }
    const gl = fxEnsureGL(canvas);
    FX.cv.style.display = '';
    const now = performance.now();
    const doCheck = now - FX.lastCheck > 500;
    if (doCheck) FX.lastCheck = now;
    let changed = false;
    const surf = E.model.user.surface;
    const drawing = !!(E.drawingInProgress && surf && surf.texture && surf.layer);
    const targets = [];
    for (const [uid, cfg] of on) {
      const idx = d.layers.findIndex((l) => (l.uid || 'id' + l.id) === uid);
      if (idx < 0) continue;
      const L = d.layers[idx];
      const st = fxLayerState(gl, uid, W, H);
      const R = Math.min(FX_MAXR, Math.ceil(cfg.width + (cfg.blur || 0) + 2));
      const sig = (L.rect ? `${L.rect.x},${L.rect.y},${L.rect.w},${L.rect.h}` : '0') + ':' + (L.thumbData && L.thumbData.data ? hash32(L.thumbData.data) : '');
      const live = drawing && surf.layer === L;
      if (!st.ready || st.R < R) {
        fxReadLayer(E, L, st, null);
        fxUpload(gl, st.A, W, { x: 0, y: 0, w: W, h: H }, st.base);
        fxJfa(gl, st, { x: 0, y: 0, w: W, h: H }, R);
        st.ready = true; st.R = R; st.sig = sig; changed = true;
      } else if (live) {
        // 긋는 중: 지금까지 그은 범위(surface.rect)를 읽는다. 아주 크면(200만 픽셀 넘음) 두 프레임에 한 번
        const region = surf.rect;
        st.liveTick = (st.liveTick || 0) + 1;
        if (region && region.w * region.h > 2e6 && st.liveTick % 2) { targets.push({ L, idx, st, cfg }); continue; }
        st.liveStarted = true;
        st.liveRect = runion(st.liveRect, rclip(surf.rect, W, H));
        const r = fxApplySurface(E, gl, st, L, region);
        if (r) { fxJfa(gl, st, r, R); changed = true; }
      } else if (st.liveRect) {
        // 획이 끝남: 레이어에 들어간 결과로 그 부분만 다시 읽는다
        const r = rclip(rgrow(st.liveRect, 2), W, H);
        st.liveRect = null; st.liveStarted = false; st.lastPt = null;
        if (r) { fxReadLayer(E, L, st, r); fxUpload(gl, st.A, W, r, st.base); fxJfa(gl, st, r, R); changed = true; }
        st.sig = null; // 다음 확인 때 썸네일 기준을 새로 잡음
      } else if (doCheck && sig !== st.sig) {
        if (st.sig !== null) { // 다른 사람이 그렸거나 되돌리기 등 → 전체 다시
          fxReadLayer(E, L, st, null);
          fxUpload(gl, st.A, W, { x: 0, y: 0, w: W, h: H }, st.base);
          fxJfa(gl, st, { x: 0, y: 0, w: W, h: H }, R);
          changed = true;
        }
        st.sig = sig;
      }
      targets.push({ L, idx, st, cfg });
    }
    if (!targets.length) { fxStop(); return; }
    targets.sort((a, b) => b.idx - a.idx); // 아래 레이어부터
    // 위 레이어 가림 (가장 아래 대상 기준 한 장 — 여러 레이어면 각자 다시 계산)
    const xf = cv.inverseTransform.join(',') + '|' + FX.cv.width + 'x' + FX.cv.height;
    if (doCheck || changed || xf !== FX.lastXf || targets.length > 1) {
      FX.lastXf = xf;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, FX.cv.width, FX.cv.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const rect = canvas.getBoundingClientRect();
      const k = canvas.width / (rect.width || canvas.width);
      const m = cv.inverseTransform; // 화면(CSS px) → 보드
      // 버퍼 px → CSS px(÷k) → 보드
      const i0 = [m[0] / k, m[2] / k, m[4]], i1 = [m[1] / k, m[3] / k, m[5]];
      const P = FX.prog.draw;
      gl.useProgram(P.p); gl.bindVertexArray(FX.vao);
      for (const t of targets) {
        const L = t.L, cfg = t.cfg;
        if (L.visible === false) continue;
        const up = fxUpdateUpper(E, gl, W, H, t.idx, false);
        const cm = /^#?([0-9a-f]{6})$/i.exec(cfg.color || ''), col = cm ? parseInt(cm[1], 16) : 0xffffff;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.st.S0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t.st.A);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, up.U);
        gl.uniform1i(P.u.uS, 0); gl.uniform1i(P.u.uA, 1); gl.uniform1i(P.u.uU, 2);
        gl.uniform3f(P.u.uInv0, i0[0], i0[1], i0[2]); gl.uniform3f(P.u.uInv1, i1[0], i1[1], i1[2]);
        gl.uniform1f(P.u.uH, FX.cv.height); gl.uniform2f(P.u.uDoc, W, H);
        gl.uniform4f(P.u.uColor, ((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255, 1);
        gl.uniform1f(P.u.uW, Math.max(0, cfg.width)); gl.uniform1f(P.u.uB, Math.max(0, cfg.blur || 0));
        gl.uniform1f(P.u.uAA, cfg.aa === false ? 0 : 1);
        gl.uniform1f(P.u.uOp, L.opacity == null ? 1 : L.opacity); gl.uniform1f(P.u.uUseU, t.idx > 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.activeTexture(gl.TEXTURE0);
    }
    FX.raf = requestAnimationFrame(fxFrame);
  }
  cleanups.push(() => { cancelAnimationFrame(FX.raf); FX.raf = 0; FX.cv?.remove(); FX.cv = null; });

  // 설정 창 (Edit → 레이어 스트로크)
  function openStrokeDialog() {
    document.querySelector('.mw-dialog-wrap')?.remove();
    const E = getEditor(), board = boardId();
    const L = E && E.model.user.activeLayers && E.model.user.activeLayers[0];
    if (!E || !board || !L) { toast('레이어를 고른 뒤 다시 열어 주세요'); return; }
    const uid = L.uid || 'id' + L.id;
    const cfg = Object.assign({ on: true, color: '#ffffff', width: 4, aa: true, blur: 0 }, fxGet(board, uid) || {});
    const wrap = document.createElement('div');
    wrap.className = 'mw-dialog-wrap mw-el';
    wrap.innerHTML = `
      <div class="mw-dialog mw-fxdlg" role="dialog">
        <div class="mw-dialog-title">레이어 스트로크 <span class="mw-hist-sub">내 화면에만 보여요</span></div>
        <div class="mw-hist-help"><b class="mw-fx-name"></b> 레이어 둘레에 테두리를 그려요(클립 스튜디오의 경계 효과).
          보드에는 평범한 레이어 그대로라 다른 사람에게는 안 보이고, 그리는 동안에도 바로 따라와요.</div>
        <label class="mw-dialog-row"><span>켜기</span><input type="checkbox" class="mw-fx-on"></label>
        <label class="mw-dialog-row"><span>색</span><input type="color" class="mw-fx-color"></label>
        <label class="mw-dialog-row"><span>두께 (px)</span><span><input type="range" min="1" max="100" class="mw-fx-w"> <input type="number" min="1" max="100" class="mw-dialog-input mw-fx-wn"></span></label>
        <label class="mw-dialog-row"><span>안티에일리어싱</span><input type="checkbox" class="mw-fx-aa"></label>
        <label class="mw-dialog-row"><span>흐리기 (px)</span><span><input type="range" min="0" max="20" step="0.5" class="mw-fx-b"> <input type="number" min="0" max="20" step="0.5" class="mw-dialog-input mw-fx-bn"></span></label>
        <div class="mw-dialog-btns"><button type="button" class="md btn secondary mw-fx-del">지우기</button><button type="button" class="ml-2 md btn primary mw-ok">닫기</button></div>
      </div>`;
    document.body.appendChild(wrap);
    const q = (s) => wrap.querySelector(s);
    q('.mw-fx-name').textContent = L.name || '';
    q('.mw-fx-on').checked = cfg.on; q('.mw-fx-color').value = cfg.color; q('.mw-fx-aa').checked = cfg.aa !== false;
    q('.mw-fx-w').value = q('.mw-fx-wn').value = cfg.width; q('.mw-fx-b').value = q('.mw-fx-bn').value = cfg.blur;
    const save = () => {
      const w = Math.min(100, Math.max(1, +q('.mw-fx-wn').value || 1)), b = Math.min(20, Math.max(0, +q('.mw-fx-bn').value || 0));
      Object.assign(cfg, { on: q('.mw-fx-on').checked, color: q('.mw-fx-color').value, width: w, aa: q('.mw-fx-aa').checked, blur: b });
      fxSet(board, uid, cfg);
    };
    const pair = (a, b) => {
      q(a).addEventListener('input', () => { q(b).value = q(a).value; save(); });
      q(b).addEventListener('input', () => { q(a).value = q(b).value; save(); });
    };
    pair('.mw-fx-w', '.mw-fx-wn'); pair('.mw-fx-b', '.mw-fx-bn');
    for (const s of ['.mw-fx-on', '.mw-fx-color', '.mw-fx-aa']) q(s).addEventListener('input', save);
    const close = () => wrap.remove();
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || e.key === 'Enter') close(); });
    q('.mw-ok').addEventListener('click', close);
    q('.mw-fx-del').addEventListener('click', () => { fxSet(board, uid, null); close(); toast(`"${L.name}" 레이어 스트로크를 지웠어요`); });
    save();
  }
  // 보드를 열면(다시 들어와도) 저장된 스트로크를 이어서 보여 준다
  setTimeout(fxKick, 1500);

  // ---------- 투명색 (클립 스튜디오의 '투명색') ----------
  // 색 견본 옆에 투명색 견본을 하나 두고, C 키(설정에서 바꿀 수 있음)로 '지금 색 ↔ 투명색'을 바꾼다.
  //  - 투명색일 때 Magma 브러시·연필 → Magma 지우개로 자동 전환(끄면 원래 도구로). 내 쪽만 지우기 모드로 바꾸면
  //    다른 사람 화면에서는 그리기로 보여 보드가 어긋나므로, Magma 자체 지우개 도구를 쓴다.
  //  - 고급 브러시 → 그 질감 그대로 지운다: 손을 떼면 (1) 지운 부분이 든 사각형을 올가미 채우기 '지우기'로 비우고
  //    (2) 미리 계산한 결과(원래 그림 × (1 − 획))를 붙여넣는다. Magma 동작 2번(되돌리기 2칸).
  const ALPHA = { el: null, prevTool: null, switching: false };
  function ensureAlphaSwatch() {
    if (destroyed) return;
    const sw = document.querySelector('svg.icon-switchColorsIcon');
    // 색상환이 접혀 있거나 탭 뒤에 숨어 있으면 견본도 숨긴다 (다른 곳의 작은 네모를 잘못 잡지 않게)
    const ec = sw && sw.closest('editor-color');
    if (ec && !(ec.getBoundingClientRect().width > 0)) { if (ALPHA.el) ALPHA.el.style.display = 'none'; return; }
    if (ALPHA.el) ALPHA.el.style.display = '';
    const area = sw && sw.closest('div');
    let prim = null;
    if (area) for (let p = area; p && !prim; p = p.parentElement) {
      prim = [...p.querySelectorAll('div')].filter((d) => { const r = d.getBoundingClientRect(); return r.width >= 14 && r.width <= 30 && Math.abs(r.width - r.height) < 2 && !d.querySelector('*') && !d.classList.contains('mw-alpha'); })
        .sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left || x.getBoundingClientRect().top - y.getBoundingClientRect().top)[0] || null; // 맨 왼쪽 위 = 주 색
      if (p.tagName === 'EDITOR-SLIDERS' || p.tagName === 'EDITOR-COLOR' || p === document.body) break;
    }
    if (!prim) { ALPHA.el?.remove(); ALPHA.el = null; return; }
    if (!ALPHA.el || !ALPHA.el.isConnected) {
      ALPHA.el = document.createElement('div');
      ALPHA.el.className = 'mw-alpha mw-el';
      ALPHA.el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); setAlpha(!S.alpha); });
    }
    // 색상환 안에 넣는다 → 색상환 패널을 옮기거나 넘겨도 한 몸으로 움직임 (예전: 화면 좌표를 따라 다시 놓아 늦게 따라옴)
    const host = prim.closest('editor-color') || document.body;
    if (ALPHA.el.parentNode !== host) host.appendChild(ALPHA.el);
    const r = prim.getBoundingClientRect();
    if (host === document.body) Object.assign(ALPHA.el.style, { position: 'fixed', left: r.left + 'px', top: (r.top + 44) + 'px' });
    else { const h = host.getBoundingClientRect(); if (h.width > 0 && r.width > 0) Object.assign(ALPHA.el.style, { position: 'absolute', left: Math.round(r.left - h.left) + 'px', top: Math.round(r.top - h.top + 44) + 'px' }); }
    ALPHA.el.classList.toggle('on', !!S.alpha);
    ALPHA.el.title = (S.alpha ? '투명색 사용 중' : '투명색') + ` (${(S.akeys || []).map(comboText).join(', ') || '단축키 없음'}) — 누르면 지금 색과 바꿔요`;
    document.documentElement.classList.toggle('mw-alpha-on', !!S.alpha);
  }
  const ERASE_FROM = new Set(['faPaintBrush', 'faPencil']);
  async function setAlpha(on) {
    S.alpha = !!on;
    { const E = getEditor(); ALPHA.color = S.alpha && E ? E.primaryColor : undefined; }
    ensureAlphaSwatch();
    if (S.alpha) { status('투명색: 그리면 지워져요'); await alphaSyncTool(); }
    else if (ALPHA.prevTool && currentTool() === 'faEraser' && !S.active) {
      const t = ALPHA.prevTool; ALPHA.prevTool = null;
      ALPHA.switching = true; try { await selectTool(t); } finally { ALPHA.switching = false; }
    } else ALPHA.prevTool = null;
    note(S.alpha ? '투명색 — 브러시가 지우개가 돼요' : '원래 색으로 돌아왔어요');
  }
  // 투명색일 때 Magma 브러시·연필을 고르면 지우개로 바꿔 둔다
  async function alphaSyncTool() {
    if (!S.alpha || S.active || ALPHA.switching || S.busy) return;
    const t = currentTool();
    if (ERASE_FROM.has(t)) {
      ALPHA.prevTool = t;
      ALPHA.switching = true; try { await selectTool('faEraser'); } finally { ALPHA.switching = false; }
    }
  }
  // ---------- 레이어 그림 바꿔 넣기 (투명색 지우기·블러가 함께 씀) ----------
  // 읽기 전용: 레이어 + 그 위에 아직 '떠 있는' 붙여넣기(Magma가 다음 동작 때 레이어에 넣음, 실측)를 겹쳐 rect 범위를 읽는다
  function layerSources(E, L) {
    const s = E.model.user.surface;
    const floating = s && s.toolId === 4 && s.layer === L && s.texture && s.rect && s.rect.w > 0 && !s.transforming &&
      !s.translateX && !s.translateY && !s.rotate && s.scaleX === 1 && s.scaleY === 1 ? s : null;
    const srcs = [];
    if (L.texture && L.rect && L.rect.w > 0) srcs.push({ obj: L, r: L.rect });
    if (floating) srcs.push({ obj: { texture: floating.texture, rect: floating.rect, textureX: floating.textureX, textureY: floating.textureY }, r: floating.rect });
    return srcs;
  }
  const risect = (p, q, W, H) => rclip({ x: Math.max(p.x, q.x), y: Math.max(p.y, q.y), w: Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x), h: Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) }, W, H);
  function readLayerEff(E, L, ir) {
    const out = new Uint8ClampedArray(ir.w * ir.h * 4);
    for (const src of layerSources(E, L)) {
      const sr = risect(ir, src.r, E.drawing.w, E.drawing.h);
      if (!sr) continue;
      const d = E.renderer.getLayerImageData(src.obj, sr).data;
      for (let y = 0; y < sr.h; y++) for (let x = 0; x < sr.w; x++) {
        const j = (y * sr.w + x) * 4, sa = d[j + 3];
        if (!sa) continue;
        const i = ((sr.y - ir.y + y) * ir.w + (sr.x - ir.x + x)) * 4, da = out[i + 3];
        if (sa === 255 || !da) { out[i] = d[j]; out[i + 1] = d[j + 1]; out[i + 2] = d[j + 2]; out[i + 3] = sa; continue; }
        const A = sa + da * (255 - sa) / 255;
        for (let c = 0; c < 3; c++) out[i + c] = Math.round((d[j + c] * sa + out[i + c] * da * (255 - sa) / 255) / A);
        out[i + 3] = Math.round(A);
      }
    }
    return out;
  }
  // before → after 로 바뀐 곳만: ① 그 사각형을 올가미 채우기 '지우기'로 비우고 ② after를 붙여넣는다 (Magma 동작 2번)
  async function replaceLayerRegion(E, L, ir, before, after, what, onLanded) {
    const canvas = getCanvas();
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < ir.h; y++) for (let x = 0; x < ir.w; x++) {
      const i = (y * ir.w + x) * 4;
      if (before[i + 3] === after[i + 3] && (!after[i + 3] || (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2]))) continue;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    if (x1 < 0) return false; // 바뀐 곳 없음
    // 지울 사각형: 바뀐 곳 + 1픽셀 여유 (너무 작으면 Magma 올가미가 점을 버리므로)
    const er = rclip({ x: ir.x + x0 - 1, y: ir.y + y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 }, E.drawing.w, E.drawing.h);
    const ex = Math.max(er.x, ir.x), ey = Math.max(er.y, ir.y), ew = Math.min(er.x + er.w, ir.x + ir.w) - ex, eh = Math.min(er.y + er.h, ir.y + ir.h) - ey;
    // 붙일 그림(보드 크기 PNG)을 먼저 다 만든다 — 지운 뒤에 실패하는 일이 없게
    const sub = new Uint8ClampedArray(ew * eh * 4);
    for (let y = 0; y < eh; y++) { const o = ((ey - ir.y + y) * ir.w + (ex - ir.x)) * 4; sub.set(after.subarray(o, o + ew * 4), y * ew * 4); }
    let keep = false; for (let i = 3; i < sub.length; i += 4) if (sub[i]) { keep = true; break; }
    let blob = null;
    if (keep) {
      const oc = new OffscreenCanvas(E.drawing.w, E.drawing.h);
      oc.getContext('2d').putImageData(new ImageData(sub, ew, eh), ex, ey);
      blob = await oc.convertToBlob({ type: 'image/png' });
    }
    const gref0 = guRef();
    const cover = showCover(E, er); // 비우는 동안 그 자리를 '바뀌기 전 화면'으로 덮어 둔다
    S.busy = true;
    document.documentElement.classList.add('mw-busy');
    const back = currentTool();
    let prevMode = null, prevAuto = null, prevStab = null, prevOp = null, opRow = null, ok = false;
    try {
      const oldRow = stabilizerRow();
      if (!(await selectTool('lassoBrushIcon'))) throw new Error('올가미 채우기 도구로 바꾸지 못했어요');
      await waitPanelChange(oldRow);
      opRow = magmaRows().find((r) => r.querySelector('.slider-label')?.textContent.trim() === 'Opacity');
      prevOp = opRow ? parseFloat(opRow.querySelector('editable-number')?.textContent) : null;
      if (prevOp !== null && prevOp !== 100) await setRowNumber(opRow, 100);
      prevMode = getBrushMode(); prevAuto = getAutoErase();
      await setBrushMode('erase');
      if (prevAuto) await setAutoErase(false);
      if (getBrushMode() !== 'erase') throw new Error('올가미 채우기를 지우기 모드로 바꾸지 못했어요');
      prevStab = getStabilizer(); if (prevStab) await setStabilizer(0);
      const rect = canvas.getBoundingClientRect(), k = canvas.width / rect.width, m = E.computedView.transform;
      const toBuf = ([x, y]) => [(m[0] * x + m[2] * y + m[4]) * k, (m[1] * x + m[3] * y + m[5]) * k];
      await drawLasso(canvas, [[ex, ey], [ex + ew, ey], [ex + ew, ey + eh], [ex, ey + eh]].map(toBuf), {});
      ok = true;
    } catch (err) {
      console.warn('[MagmaWand] ' + what, err);
      toast(what + ' 못 했어요: ' + (err && err.message || err));
    } finally {
      try {
        if (prevStab) await setStabilizer(prevStab);
        if (prevAuto) await setAutoErase(true);
        if (prevMode && prevMode !== getBrushMode()) await setBrushMode(prevMode);
        if (opRow && opRow.isConnected && prevOp !== null && prevOp !== 100) await setRowNumber(opRow, prevOp);
        if (back && currentTool() !== back) await selectTool(back);
      } catch (e) { console.warn('[MagmaWand] 복구 실패', e); }
      S.busy = false;
      document.documentElement.classList.remove('mw-busy');
    }
    if (!ok) { cover.remove(); onLanded?.(); return false; }
    if (blob) {
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'layer.png', { type: 'image/png' }));
      const t1 = guRef();
      const probe = landProbe(E, L, after, ir, true);
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await swapWhenLanded(probe.check, () => { cover.remove(); onLanded?.(); });
      await waitFor(() => guRef() !== t1, 3000); // 붙여넣기가 기록에 들어간 뒤 (묶음 되돌리기용)
    } else { await swapWhenLanded(() => true, () => { cover.remove(); onLanded?.(); }); }
    guAdd(gref0, what === '지우지' ? '투명색 지우기' : what === '흐리게 하지' ? '블러' : what === '칠하지' ? '잠긴 레이어 획' : what);
    return true;
  }
  // 그 자리를 '지금 보이는 화면'으로 덮는 그림 (Magma 그림판 바로 위, 마법봉 미리보기 아래)
  function showCover(E, box) {
    const canvas = getCanvas();
    let snap = null;
    try { snap = E.renderer.getDrawingSnapshotAsBinary(E.drawing); } catch { }
    if (!canvas || !snap || !box) return { remove() { } };
    const W = E.drawing.w, c = document.createElement('canvas');
    c.width = box.w; c.height = box.h; c.className = 'mw-cover mw-el';
    const im = new ImageData(box.w, box.h);
    for (let y = 0; y < box.h; y++) im.data.set(snap.subarray(((box.y + y) * W + box.x) * 4, ((box.y + y) * W + box.x + box.w) * 4), y * box.w * 4);
    c.getContext('2d').putImageData(im, 0, 0);
    const m = E.computedView.transform;
    Object.assign(c.style, { position: 'absolute', left: canvas.offsetLeft + 'px', top: canvas.offsetTop + 'px', pointerEvents: 'none', transformOrigin: '0 0',
      transform: `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4] + m[0] * box.x + m[2] * box.y},${m[5] + m[1] * box.x + m[3] * box.y})` });
    canvas.after(c);
    return { remove() { c.remove(); } };
  }
  // 붙여넣은 그림이 레이어에 실제로 들어갔는지: 바뀔 픽셀 몇 개를 골라 값이 바뀌는지(exact = 기대값과 같아지는지) 본다
  function landProbe(E, L, px, box, exact = false) {
    const rd = (k) => { const x = box.x + (k % box.w), y = box.y + Math.floor(k / box.w); try { return readLayerEff(E, L, { x, y, w: 1, h: 1 }); } catch { return null; } };
    const same = (v, k) => Math.abs(v[3] - px[k * 4 + 3]) <= 3 && (px[k * 4 + 3] < 8 || (Math.abs(v[0] - px[k * 4]) <= 4 && Math.abs(v[1] - px[k * 4 + 1]) <= 4 && Math.abs(v[2] - px[k * 4 + 2]) <= 4));
    // 후보: 칠해지는(알파 큰) 픽셀 고르게 30개
    const cand = [];
    const n = px.length / 4, step = Math.max(1, Math.floor(n / 600));
    for (let k = 0; k < n && cand.length < 30; k += step) if (px[k * 4 + 3] > 40) cand.push(k);
    const pts = [], before = [];
    for (const k of cand) {
      const v = rd(k); if (!v) continue;
      if (exact && same(v, k)) continue; // 이미 같은 값인 곳은 판단에 못 씀
      pts.push(k); before.push(v);
      if (pts.length >= 6) break;
    }
    const check = () => !pts.length || pts.some((k, j) => { const v = rd(k); if (!v) return false; if (exact) return same(v, k); const b = before[j]; return v[0] !== b[0] || v[1] !== b[1] || v[2] !== b[2] || v[3] !== b[3]; });
    return { check };
  }
  // 화면 갱신(프레임)마다 확인하다가, 들어간 게 보이는 바로 그 프레임 안에서 fn을 부른다 → 미리보기와 실제 그림이 한 프레임에 바뀜
  function swapWhenLanded(check, fn, ms = 3000) {
    const end = performance.now() + ms;
    return new Promise((res) => {
      const f = () => { let ok = false; try { ok = check(); } catch { ok = true; } if (ok || performance.now() > end) { try { fn(); } finally { res(); } return; } requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
  }

  // 투명색 고급 브러시 확정: maskPx = 획 알파(box 크기 RGBA), 결과 = 원래 그림 × (1 − 획 알파)
  async function advEraseCommit(maskPx, box, onLanded) {
    const E = getEditor();
    const L = E && E.model.user.activeLayers && E.model.user.activeLayers[0];
    if (!E || !getCanvas() || !L) return;
    if (L.opacityLocked) { toast('투명 부분 잠금이 켜진 레이어라 지울 수 없어요'); return; }
    if (selectionExists()) { toast('선택 영역이 있으면 고급 브러시로 지울 수 없어요 — 선택을 풀고 다시 해 주세요'); return; }
    const srcs = layerSources(E, L);
    if (!srcs.length) return; // 지울 그림이 없음
    const ir = risect(rgrow(box, 2), srcs.map((x) => x.r).reduce((p, q) => runion(p, q)), E.drawing.w, E.drawing.h);
    if (!ir) return;
    const before = readLayerEff(E, L, ir), after = new Uint8ClampedArray(before);
    for (let y = 0; y < ir.h; y++) for (let x = 0; x < ir.w; x++) {
      const i = (y * ir.w + x) * 4;
      if (!after[i + 3]) continue;
      const bx = ir.x - box.x + x, by = ir.y - box.y + y;
      const m = bx >= 0 && by >= 0 && bx < box.w && by < box.h ? maskPx[(by * box.w + bx) * 4 + 3] / 255 : 0;
      if (m > 0.002) after[i + 3] = Math.round(after[i + 3] * (1 - m));
    }
    await replaceLayerRegion(E, L, ir, before, after, '지우지', onLanded);
  }

  // ---------- 블러 브러시 (블렌드 폴더) ----------
  // 문지른 곳을 흐리게 한다. 강도 = 흐림 반경(px), 밀도 = 한 번 찍을 때 섞는 양(%).
  // 긋는 동안: 보이는 화면(보드 합성 그림)을 흐린 미리보기를 내 화면에만 덮어 보여 준다(트래픽 0).
  // 손을 떼면: 현재 레이어에 같은 흐림을 계산해 ① 바뀐 사각형 비우기 ② 결과 붙여넣기 (되돌리기 2칸).
  const BLR = { st: null, wrap: null, cv: null, g: null };
  function blurOverlay(W, H) {
    if (!BLR.wrap) {
      BLR.wrap = document.createElement('div'); BLR.wrap.className = 'mw-blurwrap mw-el';
      BLR.cv = document.createElement('canvas'); BLR.cv.className = 'mw-blurcv';
      BLR.wrap.appendChild(BLR.cv);
    }
    if (BLR.cv.width !== W || BLR.cv.height !== H) { BLR.cv.width = W; BLR.cv.height = H; BLR.g = BLR.cv.getContext('2d'); }
    if (!BLR.wrap.isConnected) document.body.appendChild(BLR.wrap);
    blurPlace();
  }
  function blurPlace() {
    const E = getEditor(), c = getCanvas();
    if (!E || !c || !BLR.wrap) return;
    const r = c.getBoundingClientRect(), m = E.computedView.transform;
    Object.assign(BLR.wrap.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    BLR.cv.style.transform = `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4]},${m[5]})`;
  }
  // 상자 흐림(가로·세로 두 번) 결과를 dab 원 안에만 섞는다. buf = 미리곱셈 RGBA(Float32 또는 Uint8)
  function blurDab(buf, W, H, cx, cy, R, k, dens) {
    const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
    const x1 = Math.min(W - 1, Math.ceil(cx + R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
    if (x1 < x0 || y1 < y0 || k < 1) return;
    const sy0 = Math.max(0, y0 - k), sy1 = Math.min(H - 1, y1 + k);
    const bw = x1 - x0 + 1, sh = sy1 - sy0 + 1;
    const hb = new Float32Array(bw * sh * 4);
    // 가로: 각 줄에서 [x-k, x+k] 평균 (가장자리는 있는 만큼만)
    for (let y = sy0; y <= sy1; y++) {
      const row = y * W;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, n = 0;
      const a = Math.max(0, x0 - k), b = Math.min(W - 1, x0 + k);
      for (let x = a; x <= b; x++) { const i = (row + x) * 4; s0 += buf[i]; s1 += buf[i + 1]; s2 += buf[i + 2]; s3 += buf[i + 3]; n++; }
      for (let x = x0; x <= x1; x++) {
        const o = ((y - sy0) * bw + (x - x0)) * 4;
        hb[o] = s0 / n; hb[o + 1] = s1 / n; hb[o + 2] = s2 / n; hb[o + 3] = s3 / n;
        const out = x - k, inn = x + k + 1;
        if (out >= 0) { const i = (row + out) * 4; s0 -= buf[i]; s1 -= buf[i + 1]; s2 -= buf[i + 2]; s3 -= buf[i + 3]; n--; }
        if (inn < W) { const i = (row + inn) * 4; s0 += buf[i]; s1 += buf[i + 1]; s2 += buf[i + 2]; s3 += buf[i + 3]; n++; }
      }
    }
    // 세로 + 섞기
    const R2 = R * R, soft = Math.max(1, R * 0.35);
    for (let x = x0; x <= x1; x++) {
      const c = x - x0;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, n = 0;
      const a = Math.max(sy0, y0 - k), b = Math.min(sy1, y0 + k);
      for (let y = a; y <= b; y++) { const o = ((y - sy0) * bw + c) * 4; s0 += hb[o]; s1 += hb[o + 1]; s2 += hb[o + 2]; s3 += hb[o + 3]; n++; }
      for (let y = y0; y <= y1; y++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2), w = dens * Math.min(1, (R - d) / soft);
          const i = (y * W + x) * 4;
          buf[i] += (s0 / n - buf[i]) * w; buf[i + 1] += (s1 / n - buf[i + 1]) * w;
          buf[i + 2] += (s2 / n - buf[i + 2]) * w; buf[i + 3] += (s3 / n - buf[i + 3]) * w;
        }
        const out = y - k, inn = y + k + 1;
        if (out >= sy0) { const o = ((out - sy0) * bw + c) * 4; s0 -= hb[o]; s1 -= hb[o + 1]; s2 -= hb[o + 2]; s3 -= hb[o + 3]; n--; }
        if (inn <= sy1) { const o = ((inn - sy0) * bw + c) * 4; s0 += hb[o]; s1 += hb[o + 1]; s2 += hb[o + 2]; s3 += hb[o + 3]; n++; }
      }
    }
  }
  function blurDocPoint(e) {
    const E = getEditor(), c = getCanvas(), m = E.computedView.inverseTransform, r = c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  async function blurPointerDown(e) {
    if (BLR.st || BSZ.on || S.busy) return;
    const E = getEditor() || await editorKeepTool();
    const L = E && E.model.user.activeLayers && E.model.user.activeLayers[0];
    if (!E) return;
    if (!L) { toast('흐리게 할 레이어를 먼저 골라 주세요'); return; }
    if (L.textData) { toast('글자 레이어는 흐리게 할 수 없어요'); return; }
    const why = layerDrawBlock(L);
    if (why) { toast(why); return; }
    if (selectionExists()) { toast('선택 영역이 있으면 블러를 쓸 수 없어요 — 선택을 풀고 다시 해 주세요'); return; }
    const W = E.drawing.w, H = E.drawing.h;
    let snap;
    try { snap = E.renderer.getDrawingSnapshotAsBinary(E.drawing); } catch { snap = null; }
    if (!snap) return;
    blurOverlay(W, H);
    BLR.g.clearRect(0, 0, W, H);
    BLR.wrap.style.display = 'block';
    BLR.st = { L, W, H, comp: new Uint8ClampedArray(snap), dabs: [], last: null, acc: 0, box: null, pid: e.pointerId };
    blurAdd(e);
  }
  function blurAdd(e) {
    const st = BLR.st;
    if (!st) return;
    const [x, y] = blurDocPoint(e);
    const R = Math.max(1, S.blurSize / 2), k = Math.max(1, Math.round(S.blurStrength)), dens = Math.min(1, Math.max(0.01, S.blurDensity / 100));
    const step = Math.max(1, R * 0.25);
    const dabAt = (px, py) => {
      st.dabs.push([px, py, R, k, dens]);
      blurDab(st.comp, st.W, st.H, px, py, R, k, dens);
      const b = rclip({ x: px - R - 1, y: py - R - 1, w: 2 * R + 2, h: 2 * R + 2 }, st.W, st.H);
      if (!b) return;
      st.box = runion(st.box, b);
      const img = new ImageData(b.w, b.h);
      for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) {
        const i = ((b.y + yy) * st.W + b.x + xx) * 4, o = (yy * b.w + xx) * 4, a = st.comp[i + 3];
        img.data[o + 3] = 255; // 미리보기는 보이는 화면 그대로(불투명)
        if (a > 0) { img.data[o] = st.comp[i] * 255 / a; img.data[o + 1] = st.comp[i + 1] * 255 / a; img.data[o + 2] = st.comp[i + 2] * 255 / a; }
      }
      BLR.g.putImageData(img, b.x, b.y);
    };
    if (!st.last) { dabAt(x, y); st.last = [x, y]; return; }
    const [lx, ly] = st.last, d = Math.hypot(x - lx, y - ly);
    let t = step - st.acc;
    while (t <= d) { dabAt(lx + (x - lx) * t / d, ly + (y - ly) * t / d); t += step; }
    st.acc = d - (t - step);
    st.last = [x, y];
  }
  function blurPointerMove(e) {
    if (!BLR.st || e.pointerId !== BLR.st.pid) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ce of (evs.length ? evs : [e])) blurAdd(ce);
  }
  // 보이는 화면(보드 합성)을 미리곱셈으로 바꿔 둔다 — 합성 그림은 대부분 불투명이라 그대로 써도 되지만 일관되게
  async function blurEnd(cancel) {
    const st = BLR.st;
    if (!st) return;
    BLR.st = null;
    const hide = () => { if (BLR.wrap) BLR.wrap.style.display = 'none'; BLR.g && BLR.g.clearRect(0, 0, st.W, st.H); };
    if (cancel || !st.dabs.length || !st.box) { hide(); return; }
    const E = getEditor(), L = st.L;
    try {
      const kmax = Math.max(...st.dabs.map((d) => d[3]));
      const srcs = layerSources(E, L);
      if (!srcs.length) { hide(); return; }
      const ir = risect(rgrow(st.box, kmax + 2), srcs.map((x) => x.r).reduce((p, q) => runion(p, q)), st.W, st.H) ;
      if (!ir) { hide(); return; }
      const before = readLayerEff(E, L, ir);
      // 미리곱셈 Float32 작업본
      const buf = new Float32Array(before.length);
      for (let i = 0; i < before.length; i += 4) { const a = before[i + 3] / 255; buf[i] = before[i] * a; buf[i + 1] = before[i + 1] * a; buf[i + 2] = before[i + 2] * a; buf[i + 3] = before[i + 3]; }
      for (const [x, y, R, k, dens] of st.dabs) blurDab(buf, ir.w, ir.h, x - ir.x, y - ir.y, R, k, dens);
      const after = new Uint8ClampedArray(before.length);
      for (let i = 0; i < buf.length; i += 4) {
        const a = buf[i + 3];
        if (a < 0.5) continue;
        after[i] = buf[i] * 255 / a; after[i + 1] = buf[i + 1] * 255 / a; after[i + 2] = buf[i + 2] * 255 / a; after[i + 3] = a;
      }
      if (L.opacityLocked) for (let i = 0; i < after.length; i += 4) { // 투명 픽셀 잠금: 투명도는 그대로, 색만 흐리게
        if (!before[i + 3]) { after[i] = after[i + 1] = after[i + 2] = after[i + 3] = 0; continue; }
        if (!after[i + 3]) { after[i] = before[i]; after[i + 1] = before[i + 1]; after[i + 2] = before[i + 2]; }
        after[i + 3] = before[i + 3];
      }
      await replaceLayerRegion(E, L, ir, before, after, '흐리게 하지', hide);
    } catch (err) {
      console.warn('[MagmaWand] 블러', err);
      toast('흐리게 하지 못했어요: ' + (err && err.message || err));
    } finally { requestAnimationFrame(hide); }
  }
  cleanups.push(() => { BLR.wrap?.remove(); BLR.wrap = null; BLR.st = null; });

  // ---------- 도구 폴더 (클립 스튜디오처럼 비슷한 도구를 한 칸에 묶기) ----------
  // Magma 도구 버튼은 지우지 않고 숨기기만 한다(단축키·내부 동작 그대로). 폴더 칸을 누르면 마지막에 쓴 도구가 골라지고
  // 오른쪽에 같은 폴더 도구들이 펼쳐진다. '@'로 시작하는 것은 마법봉 쪽 도구.
  const GROUPS = [
    { id: 'select', members: ['selectRectIcon', 'selectEllipseIcon', 'lassoSelectionIcon', '@qmask'] },
    { id: 'wand', members: ['@wand', '@quick'] },
    { id: 'brush', members: ['faPaintBrush', '@brush'] },
    { id: 'blend', members: ['blendIcon', '@blur', 'liquifyIcon'] },
    { id: 'shape', members: ['faSquare', 'faCircle', 'faSplotch'] },
    { id: 'view', members: ['faHandPaper', 'faUndoAlt', 'faSearch'] },
  ];
  const NATIVE_LABEL = { selectRectIcon: '사각형 선택', selectEllipseIcon: '타원 선택', lassoSelectionIcon: '올가미 선택',
    faPaintBrush: '브러시', blendIcon: '블렌드', liquifyIcon: '리퀴파이', faSquare: '사각형', faCircle: '타원', faSplotch: '도형',
    faHandPaper: '손 (화면 이동)', faUndoAlt: '화면 회전', faSearch: '확대·축소' };
  const GRP = { slots: {}, last: Object.assign({}, S.groupLast || {}) };
  const nativeBtn = (name) => toolButtons().find((b) => toolName(b) === name);
  const memberExists = (m) => m[0] === '@' || !!nativeBtn(m);
  function memberLabel(m) {
    if (m[0] !== '@') return NATIVE_LABEL[m] || m;
    const t = m.slice(1), k = TOOL_KEYS[t] && S[TOOL_KEYS[t]];
    return TOOL_LABEL[t] + (k && k.length ? ` (${k.map(comboText).join(', ')})` : '');
  }
  const activeMember = () => (S.active ? '@' + S.tool : currentTool());
  function groupRep(g) {
    const a = activeMember();
    if (g.members.includes(a)) return a;
    const l = GRP.last[g.id];
    return l && g.members.includes(l) && memberExists(l) ? l : g.members.find(memberExists);
  }
  function setMemberIcon(btn, m) {
    if (m[0] === '@') { setIcon(btn, m.slice(1)); return; }
    const nb = nativeBtn(m), src = nb && nb.querySelector('svg'), dst = btn.querySelector('svg');
    if (src && dst) dst.replaceWith(src.cloneNode(true));
  }
  let grpSaveT = 0;
  function ensureGroups() {
    if (destroyed) return;
    const bar = document.querySelector('editor-tools');
    if (!bar) return;
    const a = activeMember();
    let changed = false;
    for (const g of GROUPS) {
      const natives = g.members.filter((m) => m[0] !== '@').map(nativeBtn).filter(Boolean);
      const tpl = natives[0] || nativeBtn('lassoSelectionIcon');
      if (!tpl) continue;
      let slot = GRP.slots[g.id];
      if (!slot) {
        slot = tpl.cloneNode(true);
        slot.removeAttribute('id');
        slot.style.display = ''; delete slot.dataset.mwHid; // 숨겨 둔 Magma 버튼을 본떠도 보이게
        slot.classList.add('mw-tool');
        slot.dataset.group = g.id; slot.dataset.member = '';
        slot.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onSlotClick(g); });
        GRP.slots[g.id] = slot;
        if (g.id === 'wand') toolBtn = slot;
      }
      const anchor = g.id === 'wand' ? GRP.slots.select : natives[0];
      if (anchor && anchor.isConnected && anchor !== slot && anchor.nextElementSibling !== slot) anchor.after(slot);
      else if (!slot.isConnected) bar.appendChild(slot);
      for (const b of natives) if (b.style.display !== 'none') { b.style.display = 'none'; b.dataset.mwHid = '1'; }
      const rep = groupRep(g);
      if (rep && slot.dataset.member !== rep) { setMemberIcon(slot, rep); slot.dataset.member = rep; }
      if (rep) slot.title = memberLabel(rep) + ' — 누르면 같은 폴더 도구가 펼쳐져요';
      const onNow = g.members.includes(a);
      if (onNow && GRP.last[g.id] !== a) { GRP.last[g.id] = a; changed = true; }
      slot.classList.toggle('on', onNow); slot.classList.toggle('active', onNow); slot.classList.toggle('off', !onNow);
    }
    if (changed) { clearTimeout(grpSaveT); grpSaveT = setTimeout(() => { S.groupLast = Object.assign({}, GRP.last); saveSettings(); }, 500); }
    if (flyEl && flyEl.isConnected) for (const b of flyEl.querySelectorAll('button')) {
      const onNow = b.dataset.member === a;
      b.classList.toggle('on', onNow); b.classList.toggle('active', onNow); b.classList.toggle('off', !onNow);
    }
  }
  function syncToolButton() { ensureGroups(); }
  function syncTooltip() { ensureGroups(); }
  function onSlotClick(g) {
    const wasOpen = !!(flyEl && flyEl.isConnected && flyEl.dataset.group === g.id);
    activateMember(groupRep(g));
    if (wasOpen) closeFlyout(); else openFlyout(g);
  }
  async function activateMember(m) {
    if (!m) return;
    if (m[0] === '@') { await setActive(true, m.slice(1)); ensureGroups(); return; }
    if (S.active) {
      if (pendingLasso() && currentTool() === 'lassoSelectionIcon') {
        clearTimeout(stabTimer);
        while (S.busy) await sleep(30);
        await restoreLassoStab();
      }
      await setActive(false);
    }
    const b = nativeBtn(m);
    if (b) { press(b); await waitFor(() => currentTool() === m, 400); }
    ensureGroups();
  }
  // 펼침 상자: 도구 막대 오른쪽에 뜨는 작은 가로 상자 (도구 막대와 같은 버튼 모양)
  let flyEl = null;
  function openFlyout(g) {
    closeFlyout();
    const slot = GRP.slots[g.id];
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    const bar = document.querySelector('editor-tools');
    let bg = '';
    for (let el = bar; el && !bg; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) bg = c; }
    flyEl = document.createElement('div');
    flyEl.className = 'mw-flyout mw-el';
    flyEl.dataset.group = g.id;
    flyEl.style.background = bg || '#2a2a2a';
    for (const m of g.members.filter(memberExists)) {
      const b = slot.cloneNode(true);
      b.classList.remove('mw-tool');
      b.classList.add('mw-fly-btn');
      b.dataset.member = m;
      setMemberIcon(b, m);
      b.title = memberLabel(m);
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeFlyout(); activateMember(m); });
      flyEl.appendChild(b);
    }
    document.body.appendChild(flyEl);
    const barR = (bar || slot).getBoundingClientRect();
    flyEl.style.left = (Math.max(r.right, barR.right) + 4) + 'px';
    flyEl.style.top = (r.top - 3) + 'px';
    ensureGroups();
  }
  function closeFlyout() { flyEl?.remove(); flyEl = null; }
  on(window, 'pointerdown', (e) => {
    if (!flyEl || !e.isTrusted) return;
    if (e.target.closest && (e.target.closest('.mw-flyout') || e.target.closest('.mw-tool'))) return;
    closeFlyout();
  }, true);
  on(window, 'keydown', (e) => { if (flyEl && e.code === 'Escape') closeFlyout(); }, true);
  // 단축키로 숨은 도구를 골랐을 때도 폴더 칸 그림을 바로 바꾼다
  on(window, 'keyup', () => setTimeout(ensureGroups, 30), true);
  cleanups.push(() => {
    for (const s of Object.values(GRP.slots)) s.remove();
    GRP.slots = {};
    document.querySelectorAll('[data-mw-hid]').forEach((b) => { b.style.display = ''; delete b.dataset.mwHid; });
  });

  // ---------- 자유 변형: Ctrl을 누른 채 점을 잡으면 그 점만 움직이기 (클립 스튜디오 방식) ----------
  // Magma 변형 도구(Ctrl+T)에는 이미 'distort'(자유 왜곡) 모드가 있다. Ctrl을 누르고 손잡이를 잡는 동안만 그 모드로
  // 바꿨다가, 손을 떼면 원래 모드로 돌려 놓는다. 변형 결과는 Magma가 평소처럼 보낸다.
  // Magma 변형 도구는 Ctrl을 다른 용도로 쓴다(Ctrl을 누른 채 끌면 점이 엉뚱한 쪽으로 감, 실측) → 끄는 동안은 Magma에
  // Ctrl이 안 눌린 것처럼 보이게 한다(이벤트의 ctrlKey만 가림).
  const TRF = { prev: null, pid: null, t: 0 };
  const tipOf = (b) => b.getAttribute('tooltip') || b.getAttribute('ng-reflect-tooltip') || b.title || '';
  function trfModeButtons() { return [...document.querySelectorAll('editor-sliders button')].filter((b) => /^Use (scale|skew|perspective|distort) mode$/.test(tipOf(b))); }
  const trfIsOn = (b) => b.classList.contains('on') || b.classList.contains('active');
  const unCtrl = (e) => { try { Object.defineProperty(e, 'ctrlKey', { value: false }); Object.defineProperty(e, 'metaKey', { value: false }); } catch { } };
  on(window, 'pointerdown', (e) => {
    if (!e.isTrusted || e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || S.active) return;
    if (currentTool() !== 'faVectorSquare' || e.target !== getCanvas()) return;
    const btns = trfModeButtons();
    const dist = btns.find((b) => /distort/.test(tipOf(b)));
    if (!dist) return;
    const cur = btns.find(trfIsOn);
    if (cur !== dist) { TRF.prev = cur || null; press(dist); }
    clearTimeout(TRF.t); TRF.pid = e.pointerId;
    unCtrl(e);
  }, true);
  for (const t of ['pointermove', 'mousedown', 'mousemove', 'mouseup', 'click', 'pointerup', 'pointercancel']) on(window, t, (e) => {
    if (TRF.pid === null || !e.isTrusted) return; // 마법봉이 누르는 가짜 클릭(press)은 끌기와 상관없음
    unCtrl(e);
    if (t !== 'pointerup' && t !== 'pointercancel') return;
    const p = TRF.prev; TRF.prev = null;
    TRF.t = setTimeout(() => { TRF.pid = null; if (p && p.isConnected && !trfIsOn(p)) press(p); }, 0);
  }, true);

  // ---------- Ctrl+레이어 썸네일 클릭 = 레이어 내용 선택 (Magma 'Select layer content') ----------
  const THUMB = { block: false, t: 0 };
  function onThumb(e) {
    if (!e.isTrusted) return;
    if (THUMB.block) {
      e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
      if (e.type === 'click') THUMB.block = false;
      return;
    }
    if (e.type !== 'pointerdown' || e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    const th = e.target.closest && e.target.closest('.layer-thumb, .layer-thumb-border');
    const row = th && th.closest('.layer');
    if (!row) return;
    e.stopImmediatePropagation(); e.preventDefault();
    THUMB.block = true; clearTimeout(THUMB.t); THUMB.t = setTimeout(() => { THUMB.block = false; }, 800);
    selectLayerContent(row).catch((err) => console.warn('[MagmaWand] 레이어 내용 선택', err));
  }
  async function selectLayerContent(row) {
    const more = row.querySelector('.btn-layer-more');
    if (!more) return;
    document.documentElement.classList.add('mw-ctxhide');
    try {
      press(more);
      const find = () => document.querySelector('.context-menu command-menu-item[name="select-layer-content"] button');
      await waitFor(find, 1500);
      const it = find();
      if (!it) { toast('레이어 내용 선택 메뉴를 찾지 못했어요'); return; }
      it.click();
      await waitFor(() => !document.querySelector('.context-menu'), 400);
      if (document.querySelector('.context-menu')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    } finally { setTimeout(() => document.documentElement.classList.remove('mw-ctxhide'), 60); }
  }

  // ---------- 여러 레이어 함께 고르기·변형 (클립 스튜디오 방식) ----------
  // Magma에도 레이어 여러 개 선택이 있지만 '캔버스'에서는 잠겨 있다(기능 스위치 canvas-layer-multi-select, 실측).
  // 그 스위치는 건드리지 않고, 마법봉이 '함께 고른 레이어' 목록을 따로 들고 있다가
  // 지금 레이어를 변형(Ctrl+T)·이동(V)한 결과를 사용자와 같은 화면 조작(변형 도구)으로 나머지 레이어에 똑같이 다시 한다.
  // 변형 결과는 Magma 안의 3×3 행렬(user.surface.transform, 보드 좌표, 행 우선)로 읽는다(읽기만). 레이어마다 변형 한 번 = 되돌리기 한 칸.
  //  - 크기·회전·이동만 있으면 변형 칸의 X·Y·W·H·R 숫자로 정확히 넣고,
  //  - 원근·왜곡·뒤집기가 섞이면 'distort' 모드에서 네 모서리를 목표 자리로 끌어서 같은 모양을 만든다.
  const MS = { set: new Set(), anchor: null, sess: null, busy: false, block: false, skip: null, arm: false, wrap: null, guard: null };
  const MS_MAX = 12; // 되돌리기 15칸 중 함께 바꿀 레이어 수 (지금 레이어 + 12)
  const msMine = (E, L) => { const u = E.model.user; return !!L && (L.owner === u || (Array.isArray(u.ownedLayers) && u.ownedLayers.includes(L.id))); };
  const msActive = (E) => { const a = E.model.user.activeLayers; return a && a.length === 1 ? a[0] : null; };
  // 레이어 목록의 한 줄이 어느 레이어인지: Angular가 줄에 붙여 둔 정보(LView)에서 레이어 객체를 찾는다(읽기만)
  function rowLayer(row) {
    const E = getEditor();
    if (!E || !row) return null;
    const set = new Set(E.drawing.layers);
    const look = (o) => { if (!o || typeof o !== 'object') return null; if (set.has(o)) return o; try { if (set.has(o.layer)) return o.layer; } catch { } return null; };
    for (const el of [row, row.querySelector('.layer-content')]) {
      const c = el && el.__ngContext__;
      if (lviewMap && typeof c === 'number') {
        const lv = lviewMap.get(c);
        if (Array.isArray(lv)) for (let i = 0; i < lv.length && i < 200; i++) { const L = look(lv[i]); if (L) return L; }
      }
    }
    // 예비: 이름이 하나뿐이면 이름으로
    const name = (row.querySelector('.layer-name')?.textContent || '').replace(/ /g, ' ').trim();
    const same = E.drawing.layers.filter((L) => (L.name || '').trim() === name);
    return same.length === 1 ? same[0] : null;
  }
  function msRowOf(L) { return [...document.querySelectorAll('.layer')].find((r) => rowLayer(r) === L) || null; }
  async function msRevealRow(L) {
    const E = getEditor();
    let row = msRowOf(L);
    if (row) return row;
    await revealLayer({ L, index: E.drawing.layers.indexOf(L) });
    await nextFrame();
    return msRowOf(L);
  }
  function msOthers(E) {
    const act = msActive(E);
    return [...MS.set].filter((L) => E.drawing.layers.includes(L) && L !== act && msMine(E, L));
  }
  function msPaint() {
    const E = getEditor();
    const act = E && msActive(E);
    for (const row of document.querySelectorAll('.layer')) {
      const L = MS.set.size ? rowLayer(row) : null;
      row.classList.toggle('mw-msel', !!L && L !== act && MS.set.has(L));
    }
  }
  function msClear() { if (!MS.set.size) return; MS.set.clear(); MS.anchor = null; msPaint(); }

  // 레이어 줄 Ctrl+클릭 = 함께 고르기 넣기/빼기 · Shift+클릭 = 지금 레이어부터 거기까지 · 그냥 클릭 = 함께 고르기 풀기
  function onMsRow(e) {
    if (!e.isTrusted) return;
    if (MS.block) {
      e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
      if (e.type === 'click') MS.block = false;
      return;
    }
    if (e.type !== 'pointerdown' || e.button !== 0 || e.altKey || spaceDown) return; // Space+끌기는 목록 넘기기
    const row = e.target.closest && e.target.closest('.layer');
    if (!row || !row.querySelector('.layer-left-top')) return;
    const mod = e.ctrlKey || e.metaKey, sh = e.shiftKey;
    // 눈 버튼: 함께 고른 레이어의 눈을 같이 켜고 끈다
    if (e.target.closest('.layer-left-top')) { if (!mod && !sh && MS.set.size) msEyeSoon(row); return; }
    if (e.target.closest('button, input, .layer-left-bottom, .btn-layer-more, .layer-thumb, .layer-thumb-border, .editable-text input')) return;
    if (MS.busy) { e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (!mod && !sh) { msClear(); return; }   // 보통 클릭: Magma가 평소처럼 레이어를 고른다
    if (mod && sh) return;
    e.stopImmediatePropagation(); e.preventDefault();
    MS.block = true; setTimeout(() => { MS.block = false; }, 800);
    msPick(row, sh).catch((err) => console.warn('[MagmaWand] 레이어 함께 고르기', err));
  }
  async function msPick(row, range) {
    const E = getEditor() || await editorKeepTool();
    if (!E) { toast('Magma 편집기를 찾지 못했어요'); return; }
    const L = rowLayer(row), act = msActive(E);
    if (!L) { toast('이 레이어를 알아보지 못했어요'); return; }
    if (!act) { toast('먼저 레이어 하나를 골라 주세요'); return; }
    if (!msMine(E, L)) { toast('다른 사람 레이어는 함께 고를 수 없어요'); return; }
    if (range) {
      const Ls = E.drawing.layers;
      const a = Ls.indexOf(act), b = Ls.indexOf(L);
      MS.set.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (Ls[i] !== act && msMine(E, Ls[i])) MS.set.add(Ls[i]);
    } else {
      if (L === act) { toast('지금 레이어는 늘 함께 바뀌어요'); return; }
      if (MS.set.has(L)) MS.set.delete(L); else MS.set.add(L);
      MS.anchor = L;
    }
    if (MS.set.size > MS_MAX) {
      const keep = [...MS.set].slice(0, MS_MAX); MS.set = new Set(keep);
      toast(`한 번에 함께 바꿀 수 있는 레이어는 ${MS_MAX + 1}개까지예요 (되돌리기가 15칸이라서)`);
    }
    msPaint();
    const n = msOthers(E).length;
    note(n ? `레이어 ${n + 1}개를 함께 골랐어요 — 변형(Ctrl+T)·이동(V)·눈·속성을 함께 바꿔요` : '함께 고르기를 풀었어요');
  }

  // 눈(보이기) 같이 바꾸기: Magma가 지금 줄의 눈을 바꾼 뒤, 함께 고른 다른 레이어도 같은 상태로 맞춘다
  function msEyeSoon(row) {
    const E = getEditor();
    const L = rowLayer(row);
    if (!E || !L) return;
    const act = msActive(E);
    const group = [act, ...msOthers(E)].filter(Boolean);
    if (!group.includes(L)) return;
    const before = L.visible;
    setTimeout(async () => {
      if (L.visible === before) return; // 바뀌지 않았음
      for (const M of group) {
        if (M === L || M.visible === L.visible) continue;
        const r = await msRevealRow(M);
        const eye = r && r.querySelector('.layer-left-top');
        if (eye) { press(eye); await sleep(40); }
      }
    }, 120);
  }

  // ----- 변형·이동 따라 하기 -----
  const msMat = (s) => { const t = s.transform; return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => +t[i]); };
  const msApply = (H, [x, y]) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
  const msIdentity = (H) => [1, 0, 0, 0, 1, 0, 0, 0, 1].every((v, i) => Math.abs(H[i] / H[8] - v) < 1e-6);
  // 크기·회전·이동만으로 된 변형인지 (뒤집기·기울이기·원근이 없으면 {각도, 가로 배율, 세로 배율})
  function msDecompose(H) {
    if (Math.abs(H[6]) > 1e-9 || Math.abs(H[7]) > 1e-9) return null;
    const k = H[8], a = H[0] / k, b = H[1] / k, c = H[3] / k, d = H[4] / k;
    if (a * d - b * c <= 1e-9) return null;
    const sx = Math.hypot(a, c), sy = Math.hypot(b, d);
    if (Math.abs(a * b + c * d) > 1e-6 * sx * sy) return null;
    return { deg: Math.atan2(c, a) * 180 / Math.PI, sx, sy };
  }
  const msCorners = (B) => [[B.x, B.y], [B.x + B.w, B.y], [B.x + B.w, B.y + B.h], [B.x, B.y + B.h]];
  function msErr(s, B, H) {
    const G = msMat(s);
    return Math.max(...msCorners(B).map((p) => { const [x1, y1] = msApply(G, p), [x2, y2] = msApply(H, p); return Math.hypot(x1 - x2, y1 - y2); }));
  }
  function msScreen([x, y]) {
    const E = getEditor(), c = getCanvas(), r = c.getBoundingClientRect(), m = E.computedView.transform;
    return [r.left + m[0] * x + m[2] * y + m[4], r.top + m[1] * x + m[3] * y + m[5]];
  }
  const trfBtn = (re) => [...document.querySelectorAll('editor-sliders button')].find((b) => re.test(tipOf(b)));
  const trfReset = () => [...document.querySelectorAll('editor-sliders button')].find((b) => b.textContent.trim() === 'Reset');
  function trfInputs() { return [...document.querySelectorAll('editor-sliders input[type=number]')].slice(0, 5); }
  function setNum(inp, v) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inp.focus();
    set.call(inp, String(Math.round(v * 100) / 100));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.blur();
  }
  // 보드 위 점 from → to 로 손잡이 끌기 (사용자 끌기와 같은 포인터 이벤트)
  async function msDrag(from, to) {
    const canvas = getCanvas();
    const [ax, ay] = msScreen(from), [bx, by] = msScreen(to);
    const base = { bubbles: true, cancelable: true, composed: true, view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 };
    const fire = (type, x, y, down) => {
      const ev = new PointerEvent(type, { ...base, clientX: x, clientY: y, screenX: x, screenY: y, button: type === 'pointermove' ? -1 : 0, buttons: down ? 1 : 0, pressure: down ? 0.5 : 0 });
      ev.__magmaWand = true; canvas.dispatchEvent(ev);
    };
    fire('pointermove', ax, ay, false); await nextFrame();
    fire('pointerdown', ax, ay, true); await nextFrame();
    const n = Math.max(2, Math.min(12, Math.ceil(Math.hypot(bx - ax, by - ay) / 30)));
    for (let i = 1; i <= n; i++) { fire('pointermove', ax + (bx - ax) * i / n, ay + (by - ay) * i / n, true); await nextFrame(); }
    fire('pointerup', bx, by, false); await nextFrame();
  }
  async function msSelectLayer(L) {
    const E = getEditor();
    if (msActive(E) === L) return true;
    const row = await msRevealRow(L);
    if (!row) return false;
    press(row.querySelector('.layer-content') || row);
    return waitFor(() => msActive(E) === L, 1200);
  }
  // ----- 선택 영역이 있을 때 -----
  // Magma는 변형을 확정하는 순간 선택도 같이 변형한다(실측). 그래서 다음 레이어는 ① 선택 해제(앞 변형 확정) ② 원래 선택을
  // 올가미로 다시 긋기 ③ 같은 변형 — 레이어마다 되돌리기 3칸. 선택 모양은 user.selection.poly(보드 좌표 외곽선, 읽기만)에서 얻는다.
  const MS_MAX_SEL = 4;
  function msSelOf(u) {
    const se = u.selection, b = se && se.bounds;
    if (!b || !(b.w > 0) || !(b.h > 0)) return null;
    const segs = se.poly && se.poly.segments;
    if (!Array.isArray(segs) || segs.length !== 1 || !(segs[0].size >= 3)) return { bad: true };
    const it = segs[0].items, pts = [];
    for (let i = 0; i < segs[0].size; i++) pts.push([se.poly.ox + +it[i * 2], se.poly.oy + +it[i * 2 + 1]]);
    return { pts, soft: !!se.isSoft, b: { x: b.x, y: b.y, w: b.w, h: b.h } }; // soft = 가장자리가 부드러운 선택(타원 등)
  }
  async function msRestoreSel(sel) {
    const E = getEditor(), u = E.model.user, canvas = getCanvas();
    // ① 선택 해제 = 앞 레이어의 변형도 이때 확정된다
    const des = document.querySelector('.selection-tool button[command=deselect]');
    if (des && !des.disabled && !des.classList.contains('disabled')) {
      press(des);
      if (!await waitFor(() => !(u.selection.bounds.w > 0), 1500)) return '선택을 풀지 못함';
    }
    // ② 원래 선택을 올가미 선택(새 선택 모드, 손떨림 보정 0)으로 한 번에 긋기
    if (!await selectTool('lassoSelectionIcon')) return '올가미 선택으로 바꾸지 못함';
    await nextFrame();
    const prevMode = getSelectionMode(), prevStab = getStabilizer(), prevAA = getAA();
    try {
      if (prevMode !== 'select' && !await setSelectionMode('select')) return '선택 모드를 바꾸지 못함';
      if (prevStab) await setStabilizer(0);
      if (prevAA !== null && prevAA !== sel.soft) await setAA(sel.soft); // 원래 선택처럼: 부드러운 선택이면 안티에일리어스 켜기
      const r = canvas.getBoundingClientRect(), kx = canvas.width / r.width, ky = canvas.height / r.height;
      const buf = sel.pts.map((p) => { const [x, y] = msScreen(p); return [(x - r.left) * kx, (y - r.top) * ky]; });
      await drawLasso(canvas, buf, {});
      const ok = await waitFor(() => { const b = u.selection.bounds; return Math.abs(b.x - sel.b.x) <= 1 && Math.abs(b.y - sel.b.y) <= 1 && Math.abs(b.w - sel.b.w) <= 1 && Math.abs(b.h - sel.b.h) <= 1; }, 1500);
      if (!ok) return '원래 선택을 다시 긋지 못함';
    } finally {
      if (prevStab) await setStabilizer(prevStab);
      if (prevAA !== null && getAA() !== prevAA) await setAA(prevAA);
      if (prevMode && prevMode !== 'select') await setSelectionMode(prevMode);
    }
    return null;
  }

  // 레이어 하나에 같은 변형 H를 다시 한다 (sel: 선택 영역이 있었으면 그 모양)
  async function msReplay(L, H, sel) {
    const E = getEditor(), u = E.model.user;
    if (!await msSelectLayer(L)) return '레이어를 고르지 못함';
    if (sel) { const e = await msRestoreSel(sel); if (e) return e; }
    if (currentTool() === 'faVectorSquare') await selectTool('moveIcon');
    await selectTool('faVectorSquare');
    // 변형 상자 = 레이어 그림 사각형(L.rect, 실측), 선택이 있으면 선택 사각형. Magma는 손잡이를 처음 건드릴 때 이 레이어의
    // 변형을 시작하고, 그때 앞 레이어의 변형을 확정한다. 그래서 여기서는 변형 칸 숫자가 이 상자로 바뀌기를 기다린다.
    if (!sel && (!L.rect || !(L.rect.w > 0) || !(L.rect.h > 0))) return '빈 레이어';
    let B = sel ? { ...sel.b } : { x: L.rect.x, y: L.rect.y, w: L.rect.w, h: L.rect.h };
    const shown = () => { const v = trfInputs().map((i) => +i.value); return v.length === 5 && Math.abs(v[2] - B.w) < 1.5 && Math.abs(v[3] - B.h) < 1.5 && Math.abs(v[0] - (B.x + B.w / 2)) < 1.5; };
    if (!await waitFor(shown, 1500)) return '변형을 시작하지 못함';
    if (MS.mode0 === null) { const b = trfModeButtons().find(trfIsOn); MS.mode0 = b ? tipOf(b) : ''; } // 사용자가 쓰던 변형 모드 (끝나면 되돌림)
    await nextFrame();
    const mine = () => { const s = u.surface; return s && s.toolId === 20 && s.layer === L; };
    const baseOk = () => { const d = mine() && u.surface.distortionBaseRect; return d && Math.abs(d.x - B.x) < 0.5 && Math.abs(d.y - B.y) < 0.5 && Math.abs(d.w - B.w) < 0.5 && Math.abs(d.h - B.h) < 0.5; };
    const aff = msDecompose(H);
    if (aff) {
      const [X, Y, W, Hh, R] = trfInputs();
      if (X && Y && W && Hh && R) {
        const lock = trfBtn(/^Keep proportions/);
        const locked = lock && trfIsOn(lock);
        if (locked) press(lock);
        const [cx, cy] = msApply(H, [B.x + B.w / 2, B.y + B.h / 2]);
        let deg = aff.deg; if (deg > 180) deg -= 360; if (deg <= -180) deg += 360;
        setNum(R, deg); await nextFrame();
        setNum(W, B.w * aff.sx); await nextFrame();
        setNum(Hh, B.h * aff.sy); await nextFrame();
        // X·Y 칸은 '보이는 정수 값에서 얼마나 바뀌었나'만큼 옮긴다(실측: 중심 500.5가 501로 보이고, 521을 넣으면 520.5) → 차이로 넣는다
        setNum(X, Math.round(+X.value + (cx - (B.x + B.w / 2)))); await nextFrame();
        setNum(Y, Math.round(+Y.value + (cy - (B.y + B.h / 2)))); await nextFrame(); await nextFrame();
        if (locked && !trfIsOn(lock)) press(lock);
        await waitFor(mine, 500);
        if (mine() && baseOk() && msErr(u.surface, B, H) < 1.0) return null;
        if (mine()) { trfReset()?.click(); await nextFrame(); await nextFrame(); }
      }
    }
    // 원근·왜곡·뒤집기(또는 숫자로 안 맞을 때): 'distort' 모드에서 네 모서리를 하나씩 목표 자리로
    const dist = trfBtn(/^Use distort mode$/);
    if (!dist) return '왜곡 모드 단추를 찾지 못함';
    if (!trfIsOn(dist)) { press(dist); await nextFrame(); }
    for (let pass = 0; pass < 2; pass++) {
      const C = msCorners(B);
      let moved = true;
      for (let i = 0; i < 4; i++) {
        const G = mine() ? msMat(u.surface) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
        await msDrag(msApply(G, C[i]), msApply(H, C[i]));
        await waitFor(mine, 400);
        if (!mine()) return '변형이 시작되지 않음';
        if (!baseOk()) { // 상자가 예상과 다르면 실제 상자로 처음부터 다시
          const d = u.surface.distortionBaseRect;
          B = { x: d.x, y: d.y, w: d.w, h: d.h };
          trfReset()?.click(); await nextFrame(); await nextFrame();
          moved = false; break;
        }
      }
      if (moved) break;
    }
    await nextFrame();
    if (!mine() || msErr(u.surface, B, H) > 1.5) {
      if (!mine()) return '모양이 맞지 않음';
      trfReset()?.click(); await nextFrame(); await nextFrame();
      return mine() && !msIdentity(msMat(u.surface)) ? '모양이 맞지 않음 — Ctrl+Z로 되돌려 주세요' : '모양이 맞지 않아 그대로 둠';
    }
    return null;
  }

  // 미리보기: 함께 고른 레이어를 내 화면에서만 잠깐 숨기고(개인 보이기), 같은 변형을 씌운 그림을 덧그린다
  async function msSetPersonal(L, want) {
    const r0 = await msRevealRow(L);
    if (!r0) return null;
    const was = personalState(r0);
    for (let i = 0; i < 4; i++) {
      const r = msRowOf(L) || await msRevealRow(L);
      if (!r) break;
      const st = personalState(r);
      if (st === want) break;
      press(r.querySelector('.layer-left-bottom'));
      // 아이콘이 실제로 바뀐 걸 본 뒤에 다음 번 누르기 (빨리 연달아 누르면 지나쳐 버림)
      await waitFor(() => { const q = msRowOf(L); return !q || personalState(q) !== st; }, 600);
    }
    return was;
  }
  async function msPreviewStart(ss) {
    const E = getEditor();
    const wrap = document.createElement('div'); wrap.className = 'mw-mswrap mw-el';
    document.body.appendChild(wrap);
    ss.wrap = wrap; ss.items = [];
    for (const L of ss.others) {
      const r = L.rect && risect(L.rect, { x: 0, y: 0, w: E.drawing.w, h: E.drawing.h }, E.drawing.w, E.drawing.h);
      if (!r) continue;
      let img = null;
      try { img = E.renderer.getLayerImageData(L, r); } catch { }
      if (!img) continue;
      const mk = () => { const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; c.className = 'mw-mscv';
        c.style.opacity = String(Math.max(0, Math.min(1, L.opacity == null ? 1 : L.opacity))); if (L.visible === false) c.style.display = 'none'; return c; };
      const cv = mk();
      cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), r.w, r.h), 0, 0);
      let rest = null;
      if (ss.sel) { // 선택 안쪽(cv)만 변형되고 바깥(rest)은 제자리
        const path = new Path2D();
        ss.sel.pts.forEach(([x, y], i) => (i ? path.lineTo(x - r.x, y - r.y) : path.moveTo(x - r.x, y - r.y)));
        path.closePath();
        rest = mk(); const gr = rest.getContext('2d'); gr.drawImage(cv, 0, 0);
        gr.globalCompositeOperation = 'destination-out'; gr.fill(path);
        const gc = cv.getContext('2d'); gc.globalCompositeOperation = 'destination-in'; gc.fill(path);
        wrap.appendChild(rest);
      }
      wrap.appendChild(cv);
      ss.items.push({ L, r, cv, rest });
    }
    const loop = () => {
      if (MS.sess !== ss) return;
      const s = getEditor()?.model.user.surface;
      if (s && s.layer === ss.L && s.toolId === (ss.kind === 'move' ? 4 : 20)) ss.H = msMat(s);
      msPreviewDraw(ss);
      requestAnimationFrame(loop);
    };
    loop();
    // 사용자가 손잡이를 끄는 중에 레이어 줄 단추를 누르면 Magma 끌기가 엉킨다(실측) → 손을 뗀 뒤에 숨긴다
    await waitFor(() => !MS.down || MS.sess !== ss, 600000);
    for (const it of ss.items) {
      if (MS.sess !== ss) break;
      if (MS.down) await waitFor(() => !MS.down || MS.sess !== ss, 600000);
      if (MS.sess !== ss) break;
      it.was = await msSetPersonal(it.L, 'hidden');
    }
  }
  function msPreviewDraw(ss) {
    const E = getEditor(), c = getCanvas();
    if (!E || !c || !ss.wrap) return;
    const r = c.getBoundingClientRect(), V = E.computedView.transform, H = ss.H;
    Object.assign(ss.wrap.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    // 화면 = V(보드→화면, 2D) · H(변형) · T(레이어 위치)
    const V3 = [V[0], V[2], V[4], V[1], V[3], V[5], 0, 0, 1];
    const mul = (A, B) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));
    const VH = mul(V3, H);
    for (const it of ss.items) {
      const css = (M) => `matrix3d(${M[0]},${M[3]},0,${M[6]},${M[1]},${M[4]},0,${M[7]},0,0,1,0,${M[2]},${M[5]},0,${M[8]})`;
      const T = [1, 0, it.r.x, 0, 1, it.r.y, 0, 0, 1];
      it.cv.style.transform = css(mul(VH, T));
      if (it.rest) it.rest.style.transform = css(mul(V3, T));
    }
  }
  function msGuard(on, msg) {
    if (on) {
      if (!MS.guard) { MS.guard = document.createElement('div'); MS.guard.className = 'mw-msguard mw-el'; }
      MS.guard.textContent = msg || '';
      if (!MS.guard.isConnected) document.body.appendChild(MS.guard);
    } else MS.guard?.remove();
  }
  // 함께 바꾸는 동안 사용자의 키 입력은 잠깐 막는다 (중간에 다른 도구가 끼어들지 않게)
  on(window, 'keydown', (e) => { if (MS.busy && e.isTrusted) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  on(window, 'pointerdown', (e) => { if (e.isTrusted) MS.down = true; }, true);
  for (const t of ['pointerup', 'pointercancel']) on(window, t, (e) => { if (e.isTrusted) MS.down = false; }, true);
  // 이동 도구로 끌기 시작: 이미 떠 있는 붙여넣기 그림을 옮기는 게 아니면 '이동'으로 본다
  on(window, 'pointerdown', (e) => {
    if (!e.isTrusted || e.button !== 0 || !MS.set.size || e.target !== getCanvas() || currentTool() !== 'moveIcon') return;
    const E = getEditor(); if (!E) return;
    const s = E.model.user.surface, act = msActive(E);
    MS.arm = !!MS.sess || !(s && s.toolId === 4 && s.layer === act);
  }, true);

  function msTick() {
    if (MS.busy || (!MS.set.size && !MS.sess)) return;
    const E = getEditor();
    if (!E) return;
    const u = E.model.user, act = msActive(E), s = u.surface, tool = currentTool();
    for (const L of [...MS.set]) if (!E.drawing.layers.includes(L) || L === act) MS.set.delete(L);
    if (!MS.sess && MS.set.size) { msPropTick(E, act); if (MS.busy) return; }
    const ss = MS.sess;
    if (ss) {
      const live = s && s.layer === ss.L && s.toolId === (ss.kind === 'move' ? 4 : 20);
      if (live) { ss.H = msMat(s); msPreviewDraw(ss); }
      if (live && tool === ss.tool && act === ss.L) return;
      MS.sess = null;
      msFinish(ss).catch((err) => { console.warn('[MagmaWand] 함께 변형', err); toast('함께 변형하다 멈췄어요: ' + (err && err.message || err)); });
      return;
    }
    if (!MS.set.size || !act || !s || s.layer !== act || !s.transforming) { MS.skip = null; return; }
    let kind = null;
    if (tool === 'faVectorSquare' && s.toolId === 20) kind = 'transform';
    else if (tool === 'moveIcon' && s.toolId === 4 && MS.arm) kind = 'move';
    if (!kind || MS.skip === act) return;
    const others = msOthers(E);
    if (!others.length) return;
    const sel = msSelOf(u);
    if (sel && sel.bad) { MS.skip = act; toast('여러 조각(또는 구멍)으로 된 선택은 지금 레이어만 바뀌어요'); return; }
    if (sel && others.length > MS_MAX_SEL) { MS.skip = act; toast(`선택 영역이 있을 때는 함께 고른 레이어 ${MS_MAX_SEL}개까지만 같이 바뀌어요(레이어마다 되돌리기 3칸) — 지금 레이어만 바뀌어요`); return; }
    const locked = others.filter((L) => L.locked);
    if (locked.length) { MS.skip = act; toast(`잠긴 레이어(${locked.map((L) => L.name).join(', ')})가 있어 지금 레이어만 바뀌어요`); return; }
    MS.arm = false;
    const nss = { kind, tool, L: act, H: msMat(s), others, sel, ref0: MS.ref };
    MS.sess = nss;
    nss.hiding = msPreviewStart(nss).catch((err) => console.warn('[MagmaWand] 함께 변형 미리보기', err));
  }
  async function msFinish(ss) {
    MS.busy = true;
    const results = [];
    let userTool = currentTool();
    const E = getEditor();
    const userAct = msActive(E);
    try {
      const H = ss.H;
      // 미리보기 숨김을 먼저 원래대로 (숨긴 레이어는 변형되지 않을 수 있음)
      await ss.hiding; // 숨기는 중이었다면 끝날 때까지 (MS.sess가 비었으니 곧 멈춤)
      for (const it of ss.items || []) if (it.was && it.was !== 'hidden') await msSetPersonal(it.L, it.was);
      if (msIdentity(H)) return;
      MS.mode0 = null;
      const todo = ss.others.filter((L) => E.drawing.layers.includes(L) && msMine(E, L) && !L.locked);
      msGuard(true, `레이어 ${todo.length}개에 같은 ${ss.kind === 'move' ? '이동' : '변형'}을 하는 중…`);
      for (const L of todo) {
        const err = await msReplay(L, H, ss.sel);
        results.push([L, err]);
        if (err && ss.sel) { // 선택을 되살리지 못했으면 다음 레이어도 틀릴 수 있으니 멈춘다
          for (const M of todo.slice(todo.indexOf(L) + 1)) results.push([M, '앞 레이어에서 멈춤']);
          break;
        }
        const it = (ss.items || []).find((x) => x.L === L);
        if (it) { it.cv.remove(); it.rest?.remove(); }
      }
      // 마지막 레이어 변형을 끝내고 원래 모드·레이어·도구로
      if (MS.mode0) { const b = trfModeButtons().find((x) => tipOf(x) === MS.mode0); if (b && !trfIsOn(b)) { press(b); await nextFrame(); } }
      if (results.length) {
        await selectTool('moveIcon');
        const back = userAct && userAct !== ss.L && E.drawing.layers.includes(userAct) ? userAct : ss.L;
        if (E.drawing.layers.includes(back)) await msSelectLayer(back);
        if (userTool && currentTool() !== userTool) await selectTool(userTool);
      }
    } finally {
      ss.wrap?.remove();
      msGuard(false);
      MS.busy = false;
      msPaint();
    }
    const bad = results.filter(([, e]) => e);
    if (!results.length) return;
    guAdd(ss.ref0, ss.kind === 'move' ? '함께 옮기기' : '함께 변형');
    (bad.length ? toast : note)(bad.length ? `${results.length - bad.length}개는 함께 바꿨지만 ${bad.map(([L, e]) => `"${L.name}"(${e})`).join(', ')}은 못 바꿨어요`
      : `레이어 ${results.length + 1}개를 함께 ${ss.kind === 'move' ? '옮겼어요' : '변형했어요'} (되돌리기는 레이어마다 ${ss.sel ? '3칸: 선택 해제·선택·변형' : '한 칸'})`);
  }
  // MS.ref = 지난번(동작 직전) 맨 위 되돌리기 기록 — 묶음 되돌리기의 시작점
  const msTimer = setInterval(() => { try { msTick(); if (!MS.busy && !MS.sess) MS.ref = guRef(); } catch (err) { console.warn('[MagmaWand] 함께 고르기', err); } }, 60);
  cleanups.push(() => { QM.wrap?.remove(); FG.row?.remove(); BSET.el?.remove(); CLIP.line?.remove();
  });
  cleanups.push(() => { clearInterval(msTimer); MS.sess?.wrap?.remove(); MS.guard?.remove(); document.querySelectorAll('.mw-msel').forEach((r) => r.classList.remove('mw-msel')); });
  on(window, 'scroll', () => { if (MS.set.size) requestAnimationFrame(msPaint); }, true);

  // ----- 함께 고른 레이어의 속성(불투명도·합성 모드·투명 픽셀 잠금·잠금·클리핑) 같이 바꾸기 -----
  // 레이어 칸 머리(Lock·합성 모드·Opacity)에서 지금 레이어 속성을 바꾸면, 손을 뗀 뒤 함께 고른 레이어에도
  // 같은 화면 조작(그 레이어를 고르고 같은 단추·칸)으로 맞춘다. 레이어 하나·속성 하나 = Magma 동작 한 번.
  const MSP_KEYS = ['opacity', 'mode', 'opacityLocked', 'locked', 'clippingGroup'];
  const msProps = (L) => { const o = {}; for (const k of MSP_KEYS) o[k] = L[k]; return o; };
  Object.assign(MS, { ptouch: 0, pL: null, pv: null, pchg: null, pt: 0 });
  const msHdr = () => document.querySelector('editor-layers .layers-options');
  on(window, 'pointerdown', (e) => { if (e.isTrusted && e.target.closest && e.target.closest('editor-layers .layers-options, #layer-modes')) MS.ptouch = performance.now(); }, true);
  on(window, 'keydown', (e) => { if (e.isTrusted && e.target.closest && e.target.closest('editor-layers .layers-options')) MS.ptouch = performance.now(); }, true);
  function msPropTick(E, act) {
    if (!act) return;
    if (MS.pL !== act) { MS.pL = act; MS.pv = msProps(act); MS.pchg = null; return; }
    const cur = msProps(act), now = performance.now();
    for (const k of MSP_KEYS) {
      if (cur[k] === MS.pv[k]) continue;
      if (now - MS.ptouch < 4000) { if (!MS.pchg) MS.pref0 = MS.ref; MS.pchg = MS.pchg || {}; MS.pchg[k] = cur[k]; MS.pt = now; }
    }
    MS.pv = cur;
    if (MS.pchg && !MS.down && now - MS.pt > 500 && !document.querySelector('editor-layers .layers-options editable-number input:not([hidden])')) {
      const ch = MS.pchg; MS.pchg = null;
      msPropsApply(ch).catch((err) => { console.warn('[MagmaWand] 속성 함께 바꾸기', err); toast('속성을 함께 바꾸다 멈췄어요: ' + (err && err.message || err)); });
    }
  }
  async function msSetProp(L, k, v) {
    const hdr = msHdr();
    if (!hdr) return '레이어 칸을 찾지 못함';
    if (L[k] === v) return null;
    if (k === 'opacity') {
      const en = hdr.querySelector('editable-number');
      en?.querySelector('button')?.click();
      await nextFrame();
      const inp = en && en.querySelector('input');
      if (!inp) return '불투명도 칸을 찾지 못함';
      inp.focus(); inp.value = String(Math.round(v * 1000) / 10); // 칸에는 % 로 넣는다(실측: 0.5를 넣으면 0.5%)
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.blur();
      return await waitFor(() => Math.abs(L.opacity - v) < 0.006, 1000) ? null : '불투명도가 바뀌지 않음';
    }
    if (k === 'mode') {
      hdr.querySelector('layer-mode-select button')?.click();
      await waitFor(() => document.querySelector('#layer-modes'), 800);
      const it = [...document.querySelectorAll('#layer-modes .dropdown-item')].find((b) => b.textContent.trim() === String(v));
      if (!it) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); return '합성 모드를 찾지 못함'; }
      it.click();
      return await waitFor(() => L.mode === v, 1000) ? null : '합성 모드가 바뀌지 않음';
    }
    const btn = k === 'opacityLocked' ? hdr.querySelectorAll('selector')[0]?.querySelector('button')
      : k === 'locked' ? hdr.querySelector('selector[command=lock-layer] button')
      : hdr.querySelector('button[command=toggle-layer-clipping-group]');
    if (!btn) return '단추를 찾지 못함';
    btn.click();
    return await waitFor(() => L[k] === v, 1000) ? null : '바뀌지 않음';
  }
  async function msPropsApply(ch) {
    const E = getEditor();
    if (!E || MS.busy || MS.sess) return;
    const act = msActive(E);
    const todo = msOthers(E);
    if (!act || !todo.length) return;
    MS.busy = true;
    const bad = [];
    msGuard(true, `레이어 ${todo.length}개에 같은 속성을 맞추는 중…`);
    try {
      // 잠금은 맨 나중에 (잠긴 레이어는 다른 속성을 못 바꿀 수 있음)
      const keys = Object.keys(ch).sort((a, b) => (a === 'locked') - (b === 'locked'));
      for (const L of todo) {
        if (!await msSelectLayer(L)) { bad.push(`"${L.name}"(고르지 못함)`); continue; }
        await nextFrame();
        for (const k of keys) {
          const err = await msSetProp(L, k, ch[k]);
          if (err) { bad.push(`"${L.name}"(${err})`); break; }
        }
      }
      await msSelectLayer(act);
    } finally {
      msGuard(false);
      MS.busy = false;
      MS.pL = msActive(E); MS.pv = MS.pL ? msProps(MS.pL) : null; MS.pchg = null;
      msPaint();
    }
    guAdd(MS.pref0, '속성 함께 바꾸기');
    const names = { opacity: '불투명도', mode: '합성 모드', opacityLocked: '투명 픽셀 잠금', locked: '잠금', clippingGroup: '클리핑' };
    (bad.length ? toast : note)(bad.length ? `일부는 못 바꿨어요: ${bad.join(', ')}` : `레이어 ${todo.length + 1}개에 ${Object.keys(ch).map((k) => names[k]).join('·')} 함께 맞췄어요`);
  }

  // ---------- 빈틈 닫기 (클립 스튜디오 '틈 닫기') ----------
  // 선(시작 색과 다른 픽셀)을 가늘게 뼈대만 남긴 뒤(Zhang-Suen), 선의 '끝점'마다 G픽셀 안에 있는 다른 선(같은 선의 바로 옆은 제외)을
  // 찾아 끝점에서 그곳까지 **직선**을 그어 틈을 막는다. 그 다음 막힌 선 안쪽을 그대로 채운다.
  // → 틈 자리는 곧은 선으로 끊기고, 나머지 모서리·구석은 원래 선을 그대로 따라간다(예전처럼 둥글게 뭉개지지 않음).
  // 반환 null = 누른 곳이 선 위라 쓸 수 없음.
  function skeletonize(B, w, h, maxIter = 80) {
    const sk = B.slice();
    let list = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x; if (sk[p]) list.push(p); }
    for (let it = 0; it < maxIter; it++) {
      let changed = false;
      for (let step = 0; step < 2; step++) {
        const del = [];
        for (const p of list) {
          if (!sk[p]) continue;
          const n = sk[p - w], ne = sk[p - w + 1], e = sk[p + 1], se = sk[p + w + 1], s = sk[p + w], sw = sk[p + w - 1], wv = sk[p - 1], nw = sk[p - w - 1];
          const cnt = n + ne + e + se + s + sw + wv + nw;
          if (cnt < 2 || cnt > 6) continue;
          const seq = [n, ne, e, se, s, sw, wv, nw, n];
          let A = 0; for (let i = 0; i < 8; i++) if (!seq[i] && seq[i + 1]) A++;
          if (A !== 1) continue;
          if (step === 0 ? (n && e && s) || (e && s && wv) : (n && e && wv) || (n && s && wv)) continue;
          del.push(p);
        }
        for (const p of del) sk[p] = 0;
        if (del.length) changed = true;
      }
      list = list.filter((p) => sk[p]);
      if (!changed) break;
    }
    return { sk, list };
  }
  function gapBridgeFill(img, sx, sy, tolPct, G) {
    const { w, h } = img, n = w * h;
    const A = floodFill(img, sx, sy, tolPct, null, true, false).mask; // 시작 색과 비슷한 모든 픽셀
    const seed = sy * w + sx;
    if (!A[seed]) return null;
    const B = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (!A[i]) B[i] = 1;
    const { sk, list } = skeletonize(B, w, h);
    const nb8 = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
    const R = Math.max(1, G), D = Math.ceil(2.5 * R) + 6;
    const bridges = [];
    for (const p of list) {
      if (!sk[p]) continue;
      let c = 0; for (const o of nb8) c += sk[p + o] || 0;
      if (c !== 1) continue; // 끝점만
      // 같은 선을 따라 가까운 곳(뼈대 거리)은 '같은 선'으로 보고 제외
      const dist = new Map([[p, 0]]);
      let fr = [p];
      for (let d = 1; d <= D && fr.length; d++) {
        const nx = [];
        for (const q of fr) for (const o of nb8) { const r = q + o; if (r >= 0 && r < n && sk[r] && !dist.has(r)) { dist.set(r, d); nx.push(r); } }
        fr = nx;
      }
      const px = p % w, py = (p - px) / w;
      let best = -1, bd = Infinity;
      const r0 = Math.ceil(R);
      for (let y = Math.max(0, py - r0); y <= Math.min(h - 1, py + r0); y++) for (let x = Math.max(0, px - r0); x <= Math.min(w - 1, px + r0); x++) {
        const q = y * w + x;
        if (!sk[q]) continue;
        const dd = Math.hypot(x - px, y - py);
        if (dd > R || dd < 1.5 || dd >= bd) continue;
        const sd = dist.get(q);
        if (sd !== undefined && sd <= 2 * dd + 3) continue;
        bd = dd; best = q;
      }
      if (best >= 0) bridges.push([px, py, best % w, (best - best % w) / w]);
    }
    // 다리(곧은 선)를 2픽셀 굵기로 막기
    for (const [x0, y0, x1, y1] of bridges) {
      const L = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
      for (let i = 0; i <= L; i++) {
        const x = Math.round(x0 + (x1 - x0) * i / L), y = Math.round(y0 + (y1 - y0) * i / L);
        for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < w && yy < h) B[yy * w + xx] = 1; }
      }
    }
    if (B[seed]) return null;
    const mask = new Uint8Array(n), q = new Int32Array(n);
    let qh = 0, qt = 0, count = 0;
    mask[seed] = 1; q[qt++] = seed;
    while (qh < qt) {
      const p = q[qh++], x = p % w; count++;
      if (x > 0 && !B[p - 1] && !mask[p - 1]) { mask[p - 1] = 1; q[qt++] = p - 1; }
      if (x < w - 1 && !B[p + 1] && !mask[p + 1]) { mask[p + 1] = 1; q[qt++] = p + 1; }
      if (p >= w && !B[p - w] && !mask[p - w]) { mask[p - w] = 1; q[qt++] = p - w; }
      if (p < n - w && !B[p + w] && !mask[p + w]) { mask[p + w] = 1; q[qt++] = p + w; }
    }
    return { mask, count, bridges: bridges.length };
  }

  // ---------- 퀵 마스크 (선택 폴더, 클립 스튜디오 '퀵 마스크') ----------
  // 지금 선택을 빨간 덮개로 보여 주고(내 화면에만), 브러시로 칠해(넣기)·지워(빼기) 다듬는다. Enter나 다른 도구로 가면
  // 다듬은 모양을 Magma 선택으로 한 번에 긋는다(마법봉과 같은 정밀 올가미, 되돌리기 한 칸). 칠하는 동안은 트래픽 0.
  const QM = { mask: null, prev: null, W: 0, H: 0, wrap: null, cv: null, g: null, st: null, dirty: false, undo: [], applying: false, key: null };
  function qmOverlay() {
    if (!QM.wrap) {
      QM.wrap = document.createElement('div'); QM.wrap.className = 'mw-blurwrap mw-el mw-qmwrap';
      QM.cv = document.createElement('canvas'); QM.cv.className = 'mw-blurcv';
      QM.wrap.appendChild(QM.cv);
    }
    if (QM.cv.width !== QM.W || QM.cv.height !== QM.H) { QM.cv.width = QM.W; QM.cv.height = QM.H; QM.g = QM.cv.getContext('2d'); }
    if (!QM.wrap.isConnected) document.body.appendChild(QM.wrap);
    QM.wrap.style.display = 'block';
    qmPlace();
    // 화면을 옮기거나 확대해도 덮개가 따라가게
    if (!QM.raf) {
      const f = () => { if (!QM.wrap || QM.wrap.style.display === 'none') { QM.raf = 0; return; } qmPlace(); QM.raf = requestAnimationFrame(f); };
      QM.raf = requestAnimationFrame(f);
    }
  }
  function qmPlace() {
    const E = getEditor(), c = getCanvas();
    if (!E || !c || !QM.wrap || QM.wrap.style.display === 'none') return;
    const r = c.getBoundingClientRect(), m = E.computedView.transform;
    Object.assign(QM.wrap.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    QM.cv.style.transform = `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4]},${m[5]})`;
  }
  function qmDraw(b) {
    if (!QM.g || !b) return;
    const img = new ImageData(b.w, b.h);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const v = QM.mask[(b.y + y) * QM.W + b.x + x];
      if (!v) continue;
      const o = (y * b.w + x) * 4;
      img.data[o] = 255; img.data[o + 1] = 40; img.data[o + 2] = 60; img.data[o + 3] = Math.round(v * 0.5);
    }
    QM.g.putImageData(img, b.x, b.y);
  }
  // 지금 Magma 선택(외곽선, 보드 좌표) → 마스크
  function qmFromSelection() {
    const E = getEditor();
    if (!E) return false;
    const W = E.drawing.w, H = E.drawing.h;
    if (!(W > 0) || W * H > MAX_DOC_PX) { toast('보드가 너무 커서 퀵 마스크를 쓸 수 없어요'); return false; }
    QM.W = W; QM.H = H; QM.mask = new Uint8Array(W * H); QM.undo = []; QM.dirty = false;
    const se = E.model.user.selection, b = se && se.bounds;
    if (b && b.w > 0 && b.h > 0 && se.poly && Array.isArray(se.poly.segments)) {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const path = new Path2D();
      for (const sg of se.poly.segments) {
        for (let i = 0; i < sg.size; i++) {
          const x = se.poly.ox + +sg.items[i * 2], y = se.poly.oy + +sg.items[i * 2 + 1];
          i ? path.lineTo(x, y) : path.moveTo(x, y);
        }
        path.closePath();
      }
      g.fillStyle = '#000'; g.fill(path, 'evenodd');
      const d = g.getImageData(0, 0, W, H).data;
      for (let i = 0; i < W * H; i++) QM.mask[i] = d[i * 4 + 3];
    }
    QM.prev = QM.mask.slice();
    qmOverlay();
    QM.g.clearRect(0, 0, W, H);
    qmDraw({ x: 0, y: 0, w: W, h: H });
    return true;
  }
  function qmEnter() {
    if (QM.mask && QM.dirty) { qmOverlay(); return; }
    qmFromSelection();
    status(hint());
  }
  function qmHide() { if (QM.wrap) QM.wrap.style.display = 'none'; }
  function qmDab(cx, cy, R, add) {
    const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
    const x1 = Math.min(QM.W - 1, Math.ceil(cx + R)), y1 = Math.min(QM.H - 1, Math.ceil(cy + R));
    if (x1 < x0 || y1 < y0) return null;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.max(0, Math.min(1, R - d + 0.5)); // 가장자리 1픽셀만 부드럽게
      if (!a) continue;
      const p = y * QM.W + x, v = QM.mask[p];
      QM.mask[p] = add ? Math.max(v, Math.round(255 * a)) : Math.min(v, Math.round(255 * (1 - a)));
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function qmAdd(e) {
    const st = QM.st;
    if (!st) return;
    const [x, y] = blurDocPoint(e);
    const R = Math.max(0.5, S.qmSize / 2), step = Math.max(0.5, R * 0.3);
    const at = (px, py) => { const b = qmDab(px, py, R, st.add); if (b) { st.box = runion(st.box, b); qmDraw(b); } };
    if (!st.last) { at(x, y); st.last = [x, y]; return; }
    const [lx, ly] = st.last, d = Math.hypot(x - lx, y - ly);
    for (let t = step; t <= d; t += step) at(lx + (x - lx) * t / d, ly + (y - ly) * t / d);
    if (d >= step || !d) st.last = [x, y];
  }
  function qmPointerDown(e) {
    if (QM.st || QM.applying || S.busy || BSZ.on) return;
    if (!QM.mask && !qmFromSelection()) return;
    qmOverlay();
    // 투명색(C)을 고른 상태면 브러시가 지우개가 된다 (Magma 브러시와 같은 규칙)
    const add = (S.qmMode === 'sub' ? e.altKey : !e.altKey) !== !!S.alpha;
    QM.st = { pid: e.pointerId, add, last: null, box: null };
    qmAdd(e);
  }
  function qmPointerMove(e) {
    if (!QM.st || e.pointerId !== QM.st.pid) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ce of (evs.length ? evs : [e])) qmAdd(ce);
  }
  function qmEnd() {
    const st = QM.st;
    if (!st) return;
    QM.st = null;
    if (!st.box) return;
    // 되돌리기용: 이 획이 바꾼 사각형의 '전' 모습만 보관 (최대 30획)
    const b = st.box, before = new Uint8Array(b.w * b.h);
    for (let y = 0; y < b.h; y++) before.set(QM.prev.subarray((b.y + y) * QM.W + b.x, (b.y + y) * QM.W + b.x + b.w), y * b.w);
    QM.undo.push({ b, before });
    if (QM.undo.length > 30) QM.undo.shift();
    for (let y = 0; y < b.h; y++) QM.prev.set(QM.mask.subarray((b.y + y) * QM.W + b.x, (b.y + y) * QM.W + b.x + b.w), (b.y + y) * QM.W + b.x);
    QM.dirty = true;
    status('칠한 모양: Enter = 선택으로 만들기 · Esc = 처음 선택으로 · Ctrl+Z = 한 획 되돌리기');
  }
  function qmUndo() {
    const u = QM.undo.pop();
    if (!u) return false;
    const { b, before } = u;
    for (let y = 0; y < b.h; y++) {
      QM.mask.set(before.subarray(y * b.w, (y + 1) * b.w), (b.y + y) * QM.W + b.x);
      QM.prev.set(before.subarray(y * b.w, (y + 1) * b.w), (b.y + y) * QM.W + b.x);
    }
    QM.g.clearRect(b.x, b.y, b.w, b.h); qmDraw(b);
    QM.dirty = QM.undo.length > 0;
    return true;
  }
  function qmReset() { QM.mask = null; QM.dirty = false; QM.undo = []; if (QM.g) QM.g.clearRect(0, 0, QM.W, QM.H); }
  // 다듬은 마스크 → Magma 선택 (올가미 한 번). 지금 도구가 올가미 선택이어야 한다.
  async function qmApply() {
    if (!QM.mask || QM.applying) return;
    if (!QM.dirty) { qmReset(); return; }
    const canvas = getCanvas();
    const D = canvas && docContext(canvas);
    if (!D) { toast('화면을 회전·뒤집기 한 상태에서는 퀵 마스크를 선택으로 만들 수 없어요 — 화면을 원래대로 돌리고 Enter'); return; }
    QM.applying = true; S.busy = true;
    const prevMode = getSelectionMode();
    let wantMode = null;
    try {
      const bin = new Uint8Array(QM.W * QM.H);
      let cnt = 0;
      for (let i = 0; i < bin.length; i++) if (QM.mask[i] >= 128) { bin[i] = 1; cnt++; }
      if (!cnt) {
        const des = document.querySelector('.selection-tool button[command=deselect]');
        if (des && !des.disabled) press(des);
        qmReset(); note('선택을 모두 지웠어요'); return;
      }
      const P = exactPath(bin, QM.W, QM.H, D.spike, { pixelOnly: false });
      if (!P) { toast('선택 모양을 만들지 못했어요'); return; }
      const poly = P.pts.map(D.toBuf);
      await lassoStabZero();
      const plan = await planSelectionLasso(canvas, poly, 'select', sampleMask(bin, QM.W, QM.H, 1500, D.toBuf), D.spike * D.scale * D.kx);
      if (plan.mode !== prevMode) wantMode = plan.mode;
      const gref0 = guRef();
      await drawSelectionPlan(canvas, plan);
      if (plan.deselectFirst) { await nextFrame(); guAdd(gref0, '퀵 마스크 선택'); }
      qmReset();
      note(`퀵 마스크를 선택으로 만들었어요 (${cnt.toLocaleString()}픽셀)` + (P.dropped ? ` · 작은 조각 ${P.dropped}개는 뺐어요` : ''));
    } catch (err) {
      console.warn('[MagmaWand] 퀵 마스크', err);
      toast('선택으로 만들지 못했어요: ' + (err && err.message || err));
    } finally {
      try { if (wantMode && prevMode) await setSelectionMode(prevMode); } catch { }
      scheduleStabRestore();
      QM.applying = false; S.busy = false;
    }
  }
  // 퀵 마스크에서 나갈 때: 칠한 게 있으면 선택으로 만들고(올가미 선택으로 잠깐 바꿨다가 사용자가 고른 도구로), 덮개를 치운다
  async function qmLeave() {
    if (QM.st) qmEnd();
    if (!QM.mask) { qmHide(); return; }
    if (!QM.dirty) { qmReset(); qmHide(); return; }
    const want = currentTool();
    const sw = S.switching; S.switching = true;
    try {
      if (want !== 'lassoSelectionIcon') await selectTool('lassoSelectionIcon');
      await qmApply();
      if (want && want !== 'lassoSelectionIcon') await selectTool(want);
    } finally { S.switching = sw; qmHide(); }
  }
  on(window, 'keydown', (e) => {
    if (!S.active || S.tool !== 'qmask' || !e.isTrusted) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { stop(); if (QM.dirty) qmApply(); return; }
    if (e.code === 'Escape') { stop(); qmReset(); qmFromSelection(); status('처음 선택으로 돌렸어요'); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
      stop(); // 퀵 마스크 안에서는 Magma 되돌리기 대신 칠한 획을 되돌린다
      if (!qmUndo()) status('되돌릴 획이 없어요 (Magma 되돌리기는 퀵 마스크에서 나간 뒤에)');
      return;
    }
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      stop();
      const v = S.qmSize, step = v < 10 ? 1 : v < 50 ? 5 : v < 200 ? 10 : 50;
      S.qmSize = Math.min(1000, Math.max(1, Math.round(v + (e.code === 'BracketRight' ? step : -step))));
      saveSettings(); rowsEl?.__mwSync?.();
    }
  }, true);
  function qmCursor(cx, cy, show) {
    if (!Q.cursor) { Q.cursor = document.createElement('div'); Q.cursor.className = 'mw-brush mw-el'; document.body.appendChild(Q.cursor); }
    if (!show) { Q.cursor.style.display = 'none'; return; }
    const d = Math.max(4, S.qmSize * viewZoom());
    Object.assign(Q.cursor.style, { display: 'block', width: d + 'px', height: d + 'px', left: (cx - d / 2) + 'px', top: (cy - d / 2) + 'px' });
  }
  const QM_SVG = '<rect x="40" y="40" width="432" height="432" rx="60" fill="none" stroke="currentColor" stroke-width="40"/>' +
    '<circle cx="256" cy="256" r="120" fill="currentColor" opacity=".55"/><circle cx="256" cy="256" r="120" fill="none" stroke="currentColor" stroke-width="28" stroke-dasharray="40 30"/>';

  // ---------- Alt+레이어 사이 클릭 = 클리핑 마스크 켜고 끄기 (포토샵 방식) ----------
  // 레이어 목록에서 Alt를 누른 채 두 레이어 줄 사이(경계)에 마우스를 대면 파란 선이 보이고, 누르면 위 레이어의 클리핑을 켜고 끈다.
  // Magma의 클리핑 단추(지금 레이어에 적용)를 쓰므로 잠깐 위 레이어를 골랐다가 원래 레이어로 돌아온다.
  const CLIP = { line: null, hit: null, block: false };
  function clipHitAt(cx, cy) {
    const rows = [...document.querySelectorAll('.layer')].filter((r) => r.querySelector('.layer-left-top')).map((r) => ({ r, b: r.getBoundingClientRect() })).filter((x) => x.b.height > 0).sort((a, b) => a.b.top - b.b.top);
    for (let i = 0; i + 1 < rows.length; i++) {
      const up = rows[i], lo = rows[i + 1], y = (up.b.bottom + lo.b.top) / 2;
      if (Math.abs(cy - y) <= 7 && cx >= up.b.left && cx <= up.b.right && lo.b.top - up.b.bottom < 4) return { upper: up.r, lower: lo.r, y, left: up.b.left, width: up.b.width };
    }
    return null;
  }
  function clipShow(hit) {
    if (!hit) { if (CLIP.line) CLIP.line.style.display = 'none'; document.documentElement.classList.remove('mw-clipcur'); return; }
    if (!CLIP.line) { CLIP.line = document.createElement('div'); CLIP.line.className = 'mw-clipline mw-el'; document.body.appendChild(CLIP.line); }
    if (!CLIP.line.isConnected) document.body.appendChild(CLIP.line);
    Object.assign(CLIP.line.style, { display: 'block', left: hit.left + 'px', top: (hit.y - 1.5) + 'px', width: hit.width + 'px' });
    document.documentElement.classList.add('mw-clipcur');
  }
  on(window, 'pointermove', (e) => {
    if (!e.isTrusted) return;
    if (!e.altKey) { if (CLIP.hit) { CLIP.hit = null; clipShow(null); } return; }
    const h = e.target.closest && e.target.closest('editor-layers') ? clipHitAt(e.clientX, e.clientY) : null;
    CLIP.hit = h; clipShow(h);
  }, { capture: true, passive: true });
  on(window, 'keyup', (e) => { if (e.key === 'Alt' && CLIP.hit) { CLIP.hit = null; clipShow(null); } }, true);
  on(window, 'blur', () => { CLIP.hit = null; clipShow(null); });
  function onClipClick(e) {
    if (!e.isTrusted) return;
    if (CLIP.block) { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); if (e.type === 'click') CLIP.block = false; return; }
    if (e.type !== 'pointerdown' || e.button !== 0 || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!(e.target.closest && e.target.closest('editor-layers'))) return;
    const hit = clipHitAt(e.clientX, e.clientY);
    if (!hit) return;
    e.stopImmediatePropagation(); e.preventDefault();
    CLIP.block = true; setTimeout(() => { CLIP.block = false; }, 800);
    clipToggle(hit.upper).catch((err) => { console.warn('[MagmaWand] 클리핑', err); toast('클리핑을 바꾸지 못했어요: ' + (err && err.message || err)); });
  }
  async function clipToggle(upperRow) {
    const E = getEditor() || await editorKeepTool();
    if (!E || MS.busy) return;
    const L = rowLayer(upperRow);
    if (!L) { toast('이 레이어를 알아보지 못했어요'); return; }
    if (!msMine(E, L)) { toast('다른 사람 레이어는 클리핑할 수 없어요'); return; }
    const act = msActive(E), before = !!L.clippingGroup;
    MS.busy = true;
    try {
      if (act !== L && !await msSelectLayer(L)) { toast('레이어를 고르지 못했어요'); return; }
      await nextFrame();
      const b = msHdr()?.querySelector('button[command=toggle-layer-clipping-group]');
      if (!b) { toast('클리핑 단추를 찾지 못했어요'); return; }
      b.click();
      const ok = await waitFor(() => !!L.clippingGroup !== before, 1200);
      if (act && act !== L && E.drawing.layers.includes(act)) await msSelectLayer(act);
      if (ok) note(`"${L.name}" 클리핑 ${L.clippingGroup ? '켬 (아래 레이어 모양 안에만 보여요)' : '끔'}`);
      else toast('클리핑이 바뀌지 않았어요');
    } finally { MS.busy = false; msPaint(); MS.pL = msActive(E); MS.pv = MS.pL ? msProps(MS.pL) : null; MS.pchg = null; }
  }

  // ---------- 묶음 되돌리기 (마법봉 동작 하나 = Ctrl+Z 한 번) ----------
  // 여러 레이어 함께 변형·속성, 블러·투명색 지우기처럼 마법봉 동작 하나가 Magma 되돌리기 여러 칸을 쓰면, 그 칸들을 기억해 둔다.
  // 바로 다음에 Ctrl+Z(또는 위쪽 되돌리기 단추)를 누르면 Magma 되돌리기 단추를 그 칸 수만큼 대신 눌러 한 번에 되돌린다.
  // Magma 자신의 되돌리기를 쓰므로 결과는 손으로 여러 번 누른 것과 똑같다. 다시 하기(Ctrl+Shift+Z·Ctrl+Y)도 같은 묶음으로.
  // 기록은 user.history.undos/redos를 읽기만 한다(항목이 같은 객체인지로 '그 뒤로 다른 일이 없었는지' 확인).
  const GU = { list: [], redo: [], busy: false };
  const guHist = () => { const E = getEditor(); return E && E.model && E.model.user && E.model.user.history; };
  const guTop = (a) => (a && a.length ? a[a.length - 1] : null);
  function guRef() { const h = guHist(); return h ? guTop(h.undos) : null; }
  // ref0 = 동작 직전 맨 위 기록. 지금까지 쌓인 칸 수가 2칸 이상이면 묶음으로 기억
  function guAdd(ref0, what) {
    const h = guHist();
    if (!h) return;
    const a = h.undos, top = guTop(a);
    if (!top || top === ref0) return;
    const i = ref0 ? a.lastIndexOf(ref0) : -1;
    const n = i >= 0 ? a.length - 1 - i : a.length;
    if (n < 2) return;
    GU.list.push({ ref0, top, n, what, lost: i < 0 && !!ref0 });
    if (GU.list.length > 20) GU.list.shift();
    GU.redo = [];
  }
  async function guPress(cmd, n, h) {
    let done = 0;
    for (let k = 0; k < n; k++) {
      const b = document.querySelector(`button[command=${cmd}]`);
      if (!b || b.disabled || b.classList.contains('disabled')) break;
      const u0 = guTop(h.undos), r0 = guTop(h.redos), ul = h.undos.length, rl = h.redos.length;
      const moved = () => guTop(h.undos) !== u0 || guTop(h.redos) !== r0 || h.undos.length !== ul || h.redos.length !== rl;
      // 바로 이어 누르면 Magma가 앞 칸을 처리하는 중이라 무시할 때가 있다(실측) → 칸마다 잠깐 쉬고 누른다.
      // 다시 누르기는 하지 않는다(늦게 처리된 거라면 한 칸 더 되돌려 버릴 수 있음)
      if (k) await sleep(250);
      b.click();
      if (!await waitFor(moved, 2000)) break;
      done++;
    }
    return done;
  }
  async function guUndo(g) {
    const h = guHist();
    GU.busy = true;
    msGuard(true, '');
    let done = 0;
    try { done = await guPress('undo', g.n, h); } finally { msGuard(false); GU.busy = false; }
    GU.list.pop();
    if (done) GU.redo.push({ n: done, redoTop: guTop(h.redos), what: g.what, ref0: g.ref0 });
    (done === g.n && !g.lost ? note : toast)(done === g.n ? `${g.what} 되돌렸어요 (Magma 되돌리기 ${done}칸을 한 번에)` + (g.lost ? ' · 더 앞의 칸은 15칸 한도로 지워져 있었어요' : '')
      : `${g.what} — ${g.n}칸 중 ${done}칸만 되돌렸어요`);
  }
  async function guRedo(r) {
    const h = guHist();
    GU.busy = true;
    msGuard(true, '');
    let done = 0;
    try { done = await guPress('redo', r.n, h); } finally { msGuard(false); GU.busy = false; }
    GU.redo.pop();
    if (done === r.n && r.ref0 !== undefined) {
      const a = h.undos;
      if (!r.ref0 || a.lastIndexOf(r.ref0) === a.length - 1 - done) GU.list.push({ ref0: r.ref0, top: guTop(a), n: done, what: r.what, lost: false });
    }
    (done === r.n ? note : toast)(done === r.n ? `${r.what} 다시 했어요 (${done}칸을 한 번에)` : `${r.what} — ${r.n}칸 중 ${done}칸만 다시 했어요`);
  }
  // 지금 누르면 묶음으로 처리할 게 있는지
  function guUndoTarget() { const g = GU.list[GU.list.length - 1]; return g && !GU.busy && guRef() === g.top ? g : null; }
  function guRedoTarget() { const r = GU.redo[GU.redo.length - 1]; const h = guHist(); return r && !GU.busy && h && guTop(h.redos) === r.redoTop ? r : null; }
  on(window, 'keydown', (e) => {
    if (!e.isTrusted || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!getCanvas() || document.querySelector('.modal-dialog')) return;
    const redo = (e.code === 'KeyZ' && e.shiftKey) || (e.code === 'KeyY' && !e.shiftKey);
    const undo = e.code === 'KeyZ' && !e.shiftKey;
    if (GU.busy && (undo || redo)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const g = undo ? guUndoTarget() : null, r = redo ? guRedoTarget() : null;
    if (!g && !r) return;
    e.preventDefault(); e.stopImmediatePropagation();
    (g ? guUndo(g) : guRedo(r)).catch((err) => console.warn('[MagmaWand] 묶음 되돌리기', err));
  }, true);
  // 위쪽 되돌리기·다시 하기 단추도 같은 묶음으로
  const GU_BLOCK = { on: false };
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) on(window, t, (e) => {
    if (!e.isTrusted) return;
    const b = e.target.closest && e.target.closest('button[command=undo], button[command=redo]');
    if (!b) return;
    if (GU_BLOCK.on || GU.busy) { e.stopImmediatePropagation(); e.preventDefault(); if (t === 'click') GU_BLOCK.on = false; return; }
    if (t !== 'pointerdown' && t !== 'mousedown') return;
    const isUndo = b.getAttribute('command') === 'undo';
    const g = isUndo ? guUndoTarget() : null, r = isUndo ? null : guRedoTarget();
    if (!g && !r) return;
    e.stopImmediatePropagation(); e.preventDefault();
    GU_BLOCK.on = true; setTimeout(() => { GU_BLOCK.on = false; }, 800);
    (g ? guUndo(g) : guRedo(r)).catch((err) => console.warn('[MagmaWand] 묶음 되돌리기', err));
  }, true);

  // ---------- 페인트통 영역 확장·축소 (클립 스튜디오 '영역 확대/축소') ----------
  // Magma 페인트통(faFillDrip) 설정 칸에 '영역 확장/축소' 줄을 붙인다. 0이면 Magma가 평소처럼 칠한다.
  // 0이 아니면: 클릭을 마법봉이 받아 Magma 페인트통 설정(대상 레이어·허용 오차·이어진 곳만·빈틈 닫기·반전·채우기/지우기·
  // 불투명도)을 그대로 읽어 영역을 계산하고, n픽셀 넓히거나(+) 좁힌(−) 뒤 올가미 채우기 한 번으로 칠한다(되돌리기 한 칸).
  const FG = { row: null, block: false, warned: {} };
  const fgRow = (label) => magmaRows().find((r) => r.querySelector('.slider-label')?.textContent.trim() === label);
  const fgRadio = (label) => fgRow(label)?.querySelector('button.on, button.active')?.getAttribute('radiovalue') || null;
  const fgCheck = (label) => {
    const lab = [...document.querySelectorAll('editor-sliders .tool-sliders .custom-control-label')].find((x) => x.textContent.trim() === label);
    const b = lab && lab.closest('label')?.querySelector('button[role=checkbox]');
    return b ? b.getAttribute('aria-checked') === 'true' : null;
  };
  const fgNum = (label) => { const v = parseFloat(fgRow(label)?.querySelector('editable-number')?.textContent); return Number.isFinite(v) ? v : null; };
  function fgConfig() {
    const fillBtn = fgRow('Fill mode')?.querySelector('button.on');
    return {
      target: fgRadio('Target layer'), mode: fgRadio('Mode'),
      clear: fillBtn ? fillBtn.textContent.trim() === 'clear' : false,
      invert: !!fgCheck('Invert'), contig: fgCheck('Contiguous') !== false,
      tol: fgNum('Tolerance') ?? 0, gap: fgNum('Close gap') ?? 0, opacity: fgNum('Opacity') ?? 100, aa: !!fgCheck('Anti-alias'),
    };
  }
  function ensureFillRow() {
    // 다른 도구 설정 칸으로 바뀌면(Magma가 칸을 다시 쓰는 경우) 붙여 둔 줄을 치운다
    if (S.active || currentTool() !== 'faFillDrip') { if (FG.row) { FG.row.remove(); FG.row = null; } return; }
    const gapRow = fgRow('Close gap') || fgRow('Tolerance');
    if (!gapRow) return;
    if (FG.row && FG.row.isConnected && FG.row.previousElementSibling === gapRow) return;
    FG.row?.remove();
    const min = -20, max = 20;
    const row = gapRow.cloneNode(true);
    row.removeAttribute('tooltip');
    row.title = '칠할 영역을 이 픽셀만큼 넓히거나(+) 좁혀요(−). 0이면 Magma 그대로';
    row.classList.add('mw-el', 'mw-fgrow');
    row.querySelector('.slider-label').textContent = '확장/축소';
    const slider = row.querySelector('.slider'), thumb = row.querySelector('.slider-thumb'), circ = row.querySelector('.slider-circle-outer');
    const numBtn = row.querySelector('editable-number button'), inp = row.querySelector('editable-number input');
    if (inp) inp.style.display = 'none';
    const clamp = (v) => Math.min(max, Math.max(min, Math.round(v)));
    const render = () => {
      const p = (S.fillGrow - min) / (max - min) * 100;
      if (thumb) { thumb.style.width = p + '%'; thumb.style.left = '0%'; }
      if (circ) circ.style.left = `calc(${p}% - var(--slider_circle_outer-size-default) / 2)`;
      if (numBtn) numBtn.textContent = (S.fillGrow > 0 ? '+' : '') + S.fillGrow;
    };
    const setV = (v) => { S.fillGrow = clamp(v); render(); saveSettings(); };
    const fromX = (x) => { const r = slider.getBoundingClientRect(); setV(min + (x - r.left) / r.width * (max - min)); };
    slider?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { slider.setPointerCapture(e.pointerId); } catch { }
      fromX(e.clientX);
      const mv = (ev) => fromX(ev.clientX);
      const up = () => { slider.removeEventListener('pointermove', mv); slider.removeEventListener('pointerup', up); };
      slider.addEventListener('pointermove', mv); slider.addEventListener('pointerup', up);
    });
    row.addEventListener('wheel', (e) => { e.preventDefault(); setV(S.fillGrow + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    if (numBtn && inp) {
      numBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        numBtn.style.display = 'none'; inp.style.display = 'block';
        inp.removeAttribute('hidden'); inp.min = String(min); inp.max = String(max);
        inp.value = String(S.fillGrow); inp.focus(); inp.select();
      });
      const finish = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) setV(v); inp.style.display = 'none'; numBtn.style.display = ''; };
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); });
      inp.addEventListener('blur', finish);
    }
    render();
    gapRow.after(row);
    FG.row = row;
  }
  // 마스크를 n픽셀 넓히기(+)·좁히기(−) — 거리 변환(원형)
  function growMaskBy(mask, w, h, n) {
    const out = new Uint8Array(w * h), r2 = n * n;
    if (n > 0) { const d2 = edtSq(mask, w, h); for (let i = 0; i < out.length; i++) out[i] = d2[i] <= r2 ? 1 : 0; }
    else {
      const inv = new Uint8Array(w * h); for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
      const d2 = edtSq(inv, w, h); for (let i = 0; i < out.length; i++) out[i] = mask[i] && d2[i] > r2 ? 1 : 0;
    }
    return out;
  }
  function fgWarnOnce(k, msg) { if (FG.warned[k]) return; FG.warned[k] = true; toast(msg); }
  // 투명색 + Magma가 칠하는 경우: Fill mode를 이번 한 번만 clear로 (손을 떼고 나면 fill로 되돌림)
  function fgNativeClear() {
    const btns = [...(fgRow('Fill mode')?.querySelectorAll('button') || [])];
    const fillB = btns.find((b) => b.textContent.trim() === 'fill'), clearB = btns.find((b) => b.textContent.trim() === 'clear');
    if (!fillB || !clearB || clearB.classList.contains('on')) return;
    clearB.click();
    const back = () => { window.removeEventListener('pointerup', back, true); setTimeout(() => { const f = [...(fgRow('Fill mode')?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === 'fill'); if (f && !f.classList.contains('on')) f.click(); }, 300); };
    window.addEventListener('pointerup', back, true);
  }
  function onFillClick(e) {
    if (!e.isTrusted) return;
    if (FG.block) {
      e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
      if (e.type === 'click') FG.block = false;
      return;
    }
    if (e.type !== 'pointerdown' || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (S.active || S.busy || currentTool() !== 'faFillDrip') return;
    const canvas = getCanvas();
    if (e.target !== canvas) return;
    const cfg = fgConfig();
    const gap = cfg.gap > 0 && cfg.contig;
    if (!S.fillGrow && !gap && !S.alpha) return; // 마법봉이 손댈 게 없으면 Magma 그대로
    const ours = cfg.mode === 'color' && (cfg.target === 'active' || cfg.target === 'all') && fgDoc(canvas);
    if (!ours) {
      // 마법봉이 대신 못 칠하는 설정: 투명색이면 Magma의 clear로 잠깐 바꿔 지우게 하고, 나머지는 Magma 그대로
      if (S.alpha) fgNativeClear();
      if (S.fillGrow || gap) fgWarnOnce('mode', 'Mode가 opacity·smart이거나 Target layer가 above·below면 확장/축소·빈틈 닫기 없이 Magma 그대로 칠해요');
      return;
    }
    e.stopImmediatePropagation(); e.preventDefault();
    FG.block = true; setTimeout(() => { FG.block = false; }, 1500);
    fillGrowRun(e.clientX, e.clientY, cfg).catch((err) => { console.warn('[MagmaWand] 페인트통 확장/축소', err); toast('칠하지 못했어요: ' + (err && err.message || err)); });
  }
  function fgDoc(canvas) {
    const E = getEditor();
    if (!E || !canvas) return null;
    const d = E.drawing, cv = E.computedView;
    if (!d || !(d.w > 0) || !(d.h > 0) || d.w * d.h > MAX_DOC_PX || !cv || !cv.transform || !cv.inverseTransform) return null;
    const r = canvas.getBoundingClientRect(), k = canvas.width / (r.width || canvas.width), m = cv.transform, mi = cv.inverseTransform;
    return { E, W: d.w, H: d.h, spike: SPIKE, scale: Math.hypot(m[0], m[1]), kx: k,
      toDoc: (cx, cy) => { const x = cx - r.left, y = cy - r.top; return [mi[0] * x + mi[2] * y + mi[4], mi[1] * x + mi[3] * y + mi[5]]; },
      toBuf: ([x, y]) => [(m[0] * x + m[2] * y + m[4]) * k, (m[1] * x + m[3] * y + m[5]) * k] };
  }
  async function fillGrowRun(cx, cy, cfg) {
    const canvas = getCanvas();
    const D = fgDoc(canvas);
    if (!D) return;
    const E = D.E, L = msActive(E);
    if (!L) { toast('칠할 레이어를 먼저 골라 주세요'); return; }
    const why = layerDrawBlock(L);
    if (why) { toast(why); return; }
    const img = docImage(D, cfg.target === 'active' ? 'layer' : 'all');
    if (img.fallback || img.error) { toast(img.error || '그림을 읽지 못했어요'); return; }
    const [fx, fy] = D.toDoc(cx, cy);
    const dx = Math.floor(fx), dy = Math.floor(fy);
    if (dx < 0 || dy < 0 || dx >= img.w || dy >= img.h) return;
    const pct = Math.max(0, Math.min(100, cfg.tol / 2.55));
    const ff = cfg.gap > 0 && cfg.contig ? gapBridgeFill(img, dx, dy, pct, cfg.gap) : null;
    let mask = (ff || floodFill(img, dx, dy, pct, null, true, cfg.contig)).mask;
    if (cfg.invert) for (let i = 0; i < mask.length; i++) mask[i] = mask[i] ? 0 : 1;
    mask = growMaskBy(mask, img.w, img.h, S.fillGrow);
    let cnt = 0; for (let i = 0; i < mask.length; i++) cnt += mask[i];
    if (!cnt) { note('칠할 곳이 없어요 (너무 많이 좁혔어요)'); return; }
    const erase0 = cfg.clear || !!S.alpha;
    // Anti-alias가 켜져 있으면: 가장자리를 부드럽게 만든 그림을 붙여넣기 한 번으로(지우기는 비우기+붙여넣기)
    if (cfg.aa) { await fgPaintAA(E, L, mask, img.w, img.h, cfg, erase0, ff); return; }
    const P = exactPath(mask, img.w, img.h, D.spike, { pixelOnly: true });
    if (!P) { toast('칠할 영역을 만들지 못했어요'); return; }
    const poly = P.pts.map(D.toBuf);
    const erase = cfg.clear || !!S.alpha;
    S.busy = true;
    document.documentElement.classList.add('mw-busy');
    let prevMode = null, prevAuto = null, prevStab = null, prevOp = null, opRow = null;
    try {
      const oldRow = stabilizerRow();
      if (!(await selectTool('lassoBrushIcon'))) throw new Error('올가미 채우기 도구로 바꾸지 못했어요');
      await waitPanelChange(oldRow);
      prevMode = getBrushMode(); prevAuto = getAutoErase();
      await setBrushMode(erase ? 'erase' : 'draw');
      if (prevAuto) await setAutoErase(false);
      // 안전: 원하는 모드인지 확인되지 않으면 긋지 않는다
      if (getBrushMode() !== (erase ? 'erase' : 'draw') || getAutoErase() === true) throw new Error('올가미 채우기 모드를 맞추지 못해 안전을 위해 멈췄어요');
      opRow = magmaRows().find((r) => r.querySelector('.slider-label')?.textContent.trim() === 'Opacity');
      prevOp = opRow ? parseFloat(opRow.querySelector('editable-number')?.textContent) : null;
      if (prevOp !== null && prevOp !== cfg.opacity) await setRowNumber(opRow, cfg.opacity);
      prevStab = getStabilizer(); if (prevStab) await setStabilizer(0);
      await drawLasso(canvas, poly, {});
      note(`${erase ? '지움' : '칠함'}: ${cnt.toLocaleString()}픽셀` + (S.fillGrow ? ` (영역 ${S.fillGrow > 0 ? '+' : ''}${S.fillGrow}px)` : '') + (ff ? ` · 틈 ${ff.bridges}곳 이음` : ''));
    } finally {
      try {
        if (prevStab) await setStabilizer(prevStab);
        if (opRow && opRow.isConnected && prevOp !== null && prevOp !== cfg.opacity) await setRowNumber(opRow, prevOp);
        if (prevAuto) await setAutoErase(true);
        if (prevMode && prevMode !== getBrushMode()) await setBrushMode(prevMode);
        if (currentTool() !== 'faFillDrip') await selectTool('faFillDrip');
      } catch (e) { console.warn('[MagmaWand] 복구 실패', e); }
      S.busy = false;
      document.documentElement.classList.remove('mw-busy');
    }
  }
  // 안티에일리어스: 영역 마스크 가장자리 1픽셀을 둘레 평균(3×3)으로 부드럽게
  function aaMask(mask, w, h, box) {
    const out = new Uint8Array(box.w * box.h);
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
      const gx = box.x + x, gy = box.y + y;
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = gy + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = gx + dx; if (xx >= 0 && xx < w && mask[yy * w + xx]) s++; } }
      out[y * box.w + x] = Math.round(s * 255 / 9);
    }
    return out;
  }
  async function fgPaintAA(E, L, mask, W, H, cfg, erase, ff) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return;
    const box = rclip({ x: x0 - 1, y: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 }, W, H);
    const a = aaMask(mask, W, H, box), op = Math.max(0, Math.min(1, cfg.opacity / 100));
    S.busy = true; document.documentElement.classList.add('mw-busy');
    try {
      if (erase) {
        const before = readLayerEff(E, L, box), after = new Uint8ClampedArray(before);
        for (let i = 0; i < a.length; i++) after[i * 4 + 3] = Math.round(before[i * 4 + 3] * (1 - (a[i] / 255) * op));
        S.busy = false;
        await replaceLayerRegion(E, L, box, before, after, '지우지');
      } else {
        const n = Number.isFinite(E.primaryColor) ? E.primaryColor >>> 8 : 0, r = (n >> 16) & 255, g = (n >> 8) & 255, bl = n & 255;
        const px = new Uint8Array(box.w * box.h * 4);
        for (let i = 0; i < a.length; i++) { const k = (a[i] / 255) * op, A = Math.round(255 * k); px[i * 4] = Math.round(r * k); px[i * 4 + 1] = Math.round(g * k); px[i * 4 + 2] = Math.round(bl * k); px[i * 4 + 3] = A; }
        advClipToSelection(px, box); // 선택 영역 밖은 칠하지 않음 (Magma 페인트통과 같게)
        const out = new Uint8ClampedArray(px.length);
        for (let i = 0; i < px.length; i += 4) { const A = px[i + 3]; if (!A) continue; out[i] = Math.min(255, px[i] * 255 / A); out[i + 1] = Math.min(255, px[i + 1] * 255 / A); out[i + 2] = Math.min(255, px[i + 2] * 255 / A); out[i + 3] = A; }
        const oc = new OffscreenCanvas(W, H);
        oc.getContext('2d').putImageData(new ImageData(out, box.w, box.h), box.x, box.y);
        const blob = await oc.convertToBlob({ type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'fill.png', { type: 'image/png' }));
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }
      let cnt = 0; for (const v of mask) cnt += v;
      note(`${erase ? '지움' : '칠함'}: ${cnt.toLocaleString()}픽셀 · 안티에일리어스` + (S.fillGrow ? ` (영역 ${S.fillGrow > 0 ? '+' : ''}${S.fillGrow}px)` : '') + (ff ? ` · 틈 ${ff.bridges}곳 이음` : ''));
    } finally { S.busy = false; document.documentElement.classList.remove('mw-busy'); }
  }
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) on(window, t, (e) => onFillClick(e), true);

  // ---------- 고급 브러시: 기본 끝 모양·텍스처 (PNG 없이 고르기) ----------
  // 검은 그림 + 투명 배경 = 끝 모양(알파를 씀), 회색조 불투명 그림 = 텍스처(어두울수록 진하게)
  const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
  const star = (g, n, pts, ro, ri, rot = -Math.PI / 2) => { g.beginPath(); for (let i = 0; i < pts * 2; i++) { const r = i % 2 ? ri : ro, a = rot + i * Math.PI / pts; g.lineTo(n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r); } g.closePath(); g.fill(); };
  // ----- 이음매 없는 노이즈 (텍스처가 바둑판처럼 보이지 않게) -----
  // 주기 P칸으로 감싸는 Perlin 노이즈를 여러 겹(fBm) 쌓는다. 그림 크기 n이 주기의 배수라 가장자리가 그대로 이어진다.
  function tileNoise(n, P, seed) {
    const r = rnd(seed), gx = new Float32Array(P * P), gy = new Float32Array(P * P);
    for (let i = 0; i < P * P; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    const out = new Float32Array(n * n), sc = P / n, fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const dot = (ix, iy, dx, dy) => { const i = ((iy % P + P) % P) * P + ((ix % P + P) % P); return gx[i] * dx + gy[i] * dy; };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x * sc, fy = y * sc, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, u = fade(tx), v = fade(ty);
      const a = dot(x0, y0, tx, ty) + (dot(x0 + 1, y0, tx - 1, ty) - dot(x0, y0, tx, ty)) * u;
      const b = dot(x0, y0 + 1, tx, ty - 1) + (dot(x0 + 1, y0 + 1, tx - 1, ty - 1) - dot(x0, y0 + 1, tx, ty - 1)) * u;
      out[y * n + x] = a + (b - a) * v;
    }
    return out;
  }
  function fbm(n, P0, oct, seed, gain = 0.5) {
    const out = new Float32Array(n * n);
    let amp = 1, P = P0;
    for (let o = 0; o < oct && P <= n; o++, amp *= gain, P *= 2) { const t = tileNoise(n, P, seed + o * 101); for (let i = 0; i < out.length; i++) out[i] += t[i] * amp; }
    let mn = Infinity, mx = -Infinity;
    for (const v of out) { if (v < mn) mn = v; if (v > mx) mx = v; }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn || 1);
    return out;
  }
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // 픽셀마다 값 정하기: 끝 모양 = 검정 + 알파 f(0~1), 텍스처 = 불투명 회색(어두울수록 물감이 잘 묻음) f(0~1 = 묻는 정도)
  function pixTip(g, n, f) { const im = g.createImageData(n, n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = f(x, y); im.data[(y * n + x) * 4 + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255); } g.putImageData(im, 0, 0); }
  function pixTex(g, n, f) { const im = g.createImageData(n, n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = Math.round(255 * (1 - Math.max(0, Math.min(1, f(x, y))))), i = (y * n + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); }
  const radial = (n, x, y) => Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
  // 이음매 없는 세포 노이즈: m×m 칸마다 점 하나, 가장 가까운 점까지 거리(칸 크기 기준, 0~약 1)
  function tileWorley(n, m, seed) {
    const r = rnd(seed), px = new Float32Array(m * m), py = new Float32Array(m * m);
    for (let i = 0; i < m * m; i++) { px[i] = r(); py[i] = r(); }
    const out = new Float32Array(n * n), c = n / m;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x / c, fy = y / c, cx = Math.floor(fx), cy = Math.floor(fy);
      let best = 9;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, gy = cy + dy, i = ((gy % m + m) % m) * m + ((gx % m + m) % m);
        const ex = gx + px[i] - fx, ey = gy + py[i] - fy, d = ex * ex + ey * ey;
        if (d < best) best = d;
      }
      out[y * n + x] = Math.sqrt(best);
    }
    return out;
  }
  // 값 고르게 펴기(히스토그램 평활화): 결 깊이 슬라이더가 고르게 먹히도록 0~1에 골고루
  function equalize(a) {
    const B = 2048, h = new Uint32Array(B);
    let mn = Infinity, mx = -Infinity;
    for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const k = (B - 1) / (mx - mn || 1);
    for (const v of a) h[Math.floor((v - mn) * k)]++;
    const cdf = new Float32Array(B); let acc = 0;
    for (let i = 0; i < B; i++) { acc += h[i]; cdf[i] = acc / a.length; }
    for (let i = 0; i < a.length; i++) a[i] = cdf[Math.floor((a[i] - mn) * k)];
    return a;
  }
  const bump = (d, r = 0.85) => 1 - sstep(0, r, d); // 세포 노이즈 → 둥근 돌기
  const BUILTIN_VER = 7; // 기본 모양·텍스처 그리는 법이 바뀌면 올린다 (예전 브러시도 새 그림으로 갱신)
  const PROC_TIPS = new Set(['round-hard', 'round-soft']);
  const BUILTIN_TIPS = [
    { id: 'round-hard', name: '원 (딱딱)', draw: (g, n) => { g.beginPath(); g.arc(n / 2, n / 2, n / 2 - 1, 0, 7); g.fill(); } },
    { id: 'round-soft', name: '원 (부드러움)', draw: (g, n) => { const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.35, 'rgba(0,0,0,.8)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, n, n); } },
    { id: 'square', name: '사각형', draw: (g, n) => g.fillRect(n * 0.08, n * 0.08, n * 0.84, n * 0.84) },
    { id: 'flat', name: '납작붓', draw: (g, n) => { g.beginPath(); g.ellipse(n / 2, n / 2, n * 0.48, n * 0.14, 0, 0, 7); g.fill(); } },
    // 연필: 가장자리가 고르지 않고 안쪽에도 흑연 알갱이가 보이는 원
    { id: 'pencil', name: '연필 (거친)', draw: (g, n) => { const gr = fbm(n, 16, 4, 7), fine = fbm(n, 64, 2, 8); const edge = fbm(n, 4, 3, 9);
      pixTip(g, n, (x, y) => { const i = y * n + x, r = radial(n, x, y) * (0.86 + edge[i] * 0.3); const d = 1 - sstep(0.8, 0.98, r); return d * sstep(0.32, 0.62, gr[i] * 0.5 + fine[i] * 0.5 + (1 - r) * 0.12); }); } },
    // 분필: 울퉁불퉁한 테두리 + 구멍 많은 알갱이
    { id: 'chalk', name: '분필', draw: (g, n) => { const edge = fbm(n, 4, 3, 11), gr = fbm(n, 32, 3, 12);
      pixTip(g, n, (x, y) => { const i = y * n + x, r = radial(n, x, y) * (0.82 + edge[i] * 0.35); return (1 - sstep(0.7, 0.95, r)) * sstep(0.35, 0.62, gr[i]); }); } },
    { id: 'spray', name: '스프레이 점', draw: (g, n) => { const r = rnd(3); for (let i = 0; i < 160; i++) { const a = r() * 7, d = Math.abs((r() + r() + r()) / 3 - 0.5) * 2 * n * 0.48; g.beginPath(); g.arc(n / 2 + Math.cos(a) * d, n / 2 + Math.sin(a) * d, 0.8 + r() * 1.6, 0, 7); g.fill(); } } },
    // 붓털: 세로로 늘어선 털 수십 가닥(진행 방향으로 끌면 결이 생김), 털마다 굵기·진하기 다르게
    { id: 'bristle', name: '붓털', draw: (g, n) => { const r = rnd(5), hairs = []; for (let i = 0; i < 46; i++) hairs.push({ y: n * (0.1 + 0.8 * r()), w: 0.6 + r() * 2.2, a: 0.35 + r() * 0.65, len: 0.25 + r() * 0.2, cx: (r() - 0.5) * 0.12 });
      const gr = fbm(n, 32, 2, 6);
      pixTip(g, n, (x, y) => { let a = 0; const fx = x / n - 0.5; for (const h of hairs) { const dy = Math.abs(y - h.y); if (dy > h.w * 2.5) continue; const lx = Math.abs(fx - h.cx) / h.len; if (lx > 1) continue; a = Math.max(a, h.a * Math.exp(-(dy * dy) / (h.w * h.w)) * (1 - lx * lx)); } return a * (0.75 + gr[y * n + x] * 0.35); }); } },
    // 수채: 가장자리가 물 번진 듯 울퉁불퉁하고 속은 고르지 않은 옅은 얼룩
    { id: 'watercolor', name: '수채 얼룩', draw: (g, n) => { const edge = fbm(n, 4, 4, 9), body = fbm(n, 8, 4, 10);
      pixTip(g, n, (x, y) => { const i = y * n + x, r = radial(n, x, y) * (0.8 + edge[i] * 0.32); return (1 - sstep(0.84, 0.97, r)) * (0.58 + body[i] * 0.14); }); } },
    // 흑연: 가장자리가 살짝 고르지 않고 바깥으로 갈수록 옅어지는 원 (결은 종이가 만든다)
    { id: 'graphite', name: '흑연', draw: (g, n) => { const edge = fbm(n, 6, 4, 61, 0.6), chip = fbm(n, 24, 3, 60), dust = fbm(n, 96, 2, 62);
      // 깎인 심: 살짝 납작한 타원, 윤곽은 종이에 걸려 부서진 듯 들쭉날쭉(경계가 또렷), 안쪽은 흑연 알갱이로 고르지 않게
      pixTip(g, n, (x, y) => { const i = y * n + x, u = (x + 0.5) / n * 2 - 1, v = ((y + 0.5) / n * 2 - 1) / 0.82;
        const r = Math.hypot(u, v) * (0.82 + edge[i] * 0.34) + (chip[i] - 0.5) * 0.12;
        return (1 - sstep(0.7, 0.86, r)) * (0.5 + 0.5 * sstep(0.25, 0.65, dust[i])); }); } },
    // 목탄 덩이(옆면): 길쭉하고 모서리가 부서진 덩어리 + 길이 방향 결
    { id: 'charcoal', name: '목탄 옆면', draw: (g, n) => { const edge = fbm(n, 8, 4, 63), crumb = fbm(n, 32, 3, 64), r2 = rnd(65), rows = new Float32Array(n);
      for (let y = 0; y < n; y++) rows[y] = r2(); for (let k = 0; k < 3; k++) for (let y = 1; y < n - 1; y++) rows[y] = (rows[y - 1] + rows[y] * 2 + rows[y + 1]) / 4;
      pixTip(g, n, (x, y) => { const i = y * n + x, u = (x + 0.5) / n * 2 - 1, v = ((y + 0.5) / n * 2 - 1) / 0.42;
        const r = Math.pow(Math.pow(Math.abs(u), 3) + Math.pow(Math.abs(v), 3), 1 / 3) * (0.82 + edge[i] * 0.36);
        const streak = sstep(0.25, 0.75, rows[y] * 0.6 + crumb[i] * 0.4);
        return (1 - sstep(0.78, 0.96, r)) * (0.45 + 0.55 * streak); }); } },
    // 목탄 끝: 작고 울퉁불퉁한 덩이, 속에 부스러기
    { id: 'charcoaltip', name: '목탄 끝', draw: (g, n) => { const edge = fbm(n, 4, 4, 66), crumb = fbm(n, 64, 2, 67);
      pixTip(g, n, (x, y) => { const i = y * n + x, r = radial(n, x, y) * (0.78 + edge[i] * 0.45); return (1 - sstep(0.62, 0.92, r)) * (0.55 + 0.45 * sstep(0.2, 0.7, crumb[i])); }); } },
    // 파스텔·콩테: 둥근 모서리 사각 덩이, 귀퉁이가 깨짐
    { id: 'pastel', name: '파스텔 덩이', draw: (g, n) => { const edge = fbm(n, 8, 4, 68), body = fbm(n, 32, 2, 69);
      pixTip(g, n, (x, y) => { const i = y * n + x, u = Math.abs((x + 0.5) / n * 2 - 1), v = Math.abs(((y + 0.5) / n * 2 - 1) / 0.7);
        const r = Math.pow(Math.pow(u, 5) + Math.pow(v, 5), 1 / 5) * (0.84 + edge[i] * 0.3); return (1 - sstep(0.8, 0.93, r)) * (0.82 + body[i] * 0.18); }); } },
    // 마른 붓(갈필): 털 뭉치 사이가 벌어지고 털마다 묻은 양이 다름 (진행 방향으로 끌면 결이 갈라짐)
    { id: 'drybrush', name: '마른 붓털', draw: (g, n) => { const r = rnd(71), hairs = []; let y = n * 0.08;
      while (y < n * 0.92) { const clump = 2 + Math.floor(r() * 5), ca = 0.25 + r() * 0.75; for (let k = 0; k < clump && y < n * 0.92; k++) { hairs.push({ y, w: 0.7 + r() * 1.6, a: ca * (0.6 + r() * 0.4), len: 0.32 + r() * 0.16, cx: (r() - 0.5) * 0.1 }); y += 1.6 + r() * 2.2; } y += 2 + r() * n * 0.05; }
      pixTip(g, n, (x, yy) => { let a = 0; const fx = x / n - 0.5; for (const h of hairs) { const dy = Math.abs(yy - h.y); if (dy > h.w * 2.5) continue; const lx = Math.abs(fx - h.cx) / h.len; if (lx > 1) continue; a = Math.max(a, h.a * Math.exp(-(dy * dy) / (h.w * h.w)) * (1 - Math.pow(lx, 4))); } return a; }); } },
    // 납작 붓털(아크릴·유화 평붓): 촘촘한 털 + 털 끝 들쭉날쭉
    { id: 'flatbristle', name: '납작 붓털', draw: (g, n) => { const r = rnd(73), hairs = [];
      for (let i = 0; i < 90; i++) hairs.push({ y: n * (0.04 + 0.92 * r()), w: 0.8 + r() * 1.8, a: 0.5 + r() * 0.5, len: 0.12 + r() * 0.1, cx: (r() - 0.5) * 0.08 });
      pixTip(g, n, (x, yy) => { let a = 0; const fx = x / n - 0.5; for (const h of hairs) { const dy = Math.abs(yy - h.y); if (dy > h.w * 2.5) continue; const lx = Math.abs(fx - h.cx) / h.len; if (lx > 1) continue; a = Math.max(a, h.a * Math.exp(-(dy * dy) / (h.w * h.w)) * (1 - lx * lx)); } return a; }); } },
    // 레이크(갈퀴 붓): 몇 가닥 떨어진 털 → 나란한 선 (털·풀결)
    { id: 'rake', name: '레이크', draw: (g, n) => { const r = rnd(75); for (let i = 0; i < 7; i++) { const y = n * (0.1 + 0.8 * i / 6) + (r() - 0.5) * n * 0.04, rr = n * (0.035 + r() * 0.02); g.beginPath(); g.arc(n / 2 + (r() - 0.5) * n * 0.06, y, rr, 0, 7); g.fill(); } } },
    // 스펀지: 구멍 숭숭한 덩이
    { id: 'sponge', name: '스펀지', draw: (g, n) => { const w = tileWorley(n, 14, 77), w2 = tileWorley(n, 30, 78), edge = fbm(n, 4, 3, 79);
      pixTip(g, n, (x, y) => { const i = y * n + x, r = radial(n, x, y) * (0.8 + edge[i] * 0.4); return (1 - sstep(0.75, 0.95, r)) * sstep(0.32, 0.5, w[i] * 0.7 + w2[i] * 0.3); }); } },
    // 점묘: 크기 다른 점 무리
    { id: 'stipple', name: '점묘', draw: (g, n) => { const r = rnd(81); for (let i = 0; i < 46; i++) { const a = r() * 7, d = Math.sqrt(r()) * n * 0.42; g.beginPath(); g.arc(n / 2 + Math.cos(a) * d, n / 2 + Math.sin(a) * d, n * (0.012 + r() * r() * 0.04), 0, 7); g.fill(); } } },
    // 풀잎: 아래에서 솟은 가는 잎 몇 장
    { id: 'grass', name: '풀', draw: (g, n) => { const r = rnd(83); for (let i = 0; i < 9; i++) { const bx = n * (0.2 + 0.6 * r()), h = n * (0.45 + r() * 0.45), lean = (r() - 0.5) * n * 0.5, w = n * (0.015 + r() * 0.02);
      g.beginPath(); g.moveTo(bx - w, n * 0.98); g.quadraticCurveTo(bx + lean * 0.3, n * 0.98 - h * 0.6, bx + lean, n * 0.98 - h); g.quadraticCurveTo(bx + lean * 0.3 + w, n * 0.98 - h * 0.55, bx + w, n * 0.98); g.closePath(); g.fill(); } } },
    // 털 한 가닥: 가늘고 길게 끝이 뾰족
    { id: 'fur', name: '털 가닥', draw: (g, n) => { g.beginPath(); g.moveTo(n * 0.5, n * 0.02); g.quadraticCurveTo(n * 0.56, n * 0.5, n * 0.5, n * 0.98); g.quadraticCurveTo(n * 0.44, n * 0.5, n * 0.5, n * 0.02); g.fill(); } },
    { id: 'cloud', name: '구름', draw: (g, n) => { const r = rnd(13); for (let i = 0; i < 9; i++) { const x = n / 2 + (r() - 0.5) * n * 0.45, y = n / 2 + (r() - 0.5) * n * 0.25, rr = n * (0.14 + r() * 0.12); const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(0,0,0,.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); } } },
    { id: 'splatter', name: '물감 튀김', draw: (g, n) => { const r = rnd(17); g.beginPath(); g.arc(n / 2, n / 2, n * 0.2, 0, 7); g.fill(); for (let i = 0; i < 22; i++) { const a = r() * 7, d = n * (0.22 + r() * 0.25); g.beginPath(); g.arc(n / 2 + Math.cos(a) * d, n / 2 + Math.sin(a) * d, 1 + r() * n * 0.05, 0, 7); g.fill(); } } },
    { id: 'star', name: '별', draw: (g, n) => star(g, n, 5, n * 0.48, n * 0.2) },
    { id: 'sparkle', name: '반짝이', draw: (g, n) => star(g, n, 4, n * 0.48, n * 0.08) },
    { id: 'heart', name: '하트', draw: (g, n) => { g.beginPath(); g.moveTo(n / 2, n * 0.88); g.bezierCurveTo(n * 0.02, n * 0.55, n * 0.12, n * 0.08, n / 2, n * 0.3); g.bezierCurveTo(n * 0.88, n * 0.08, n * 0.98, n * 0.55, n / 2, n * 0.88); g.fill(); } },
    { id: 'leaf', name: '잎', draw: (g, n) => { g.beginPath(); g.moveTo(n * 0.06, n / 2); g.quadraticCurveTo(n / 2, n * 0.08, n * 0.94, n / 2); g.quadraticCurveTo(n / 2, n * 0.92, n * 0.06, n / 2); g.fill(); } },
    { id: 'triangle', name: '삼각형', draw: (g, n) => { g.beginPath(); g.moveTo(n / 2, n * 0.06); g.lineTo(n * 0.95, n * 0.9); g.lineTo(n * 0.05, n * 0.9); g.closePath(); g.fill(); } },
    { id: 'snow', name: '눈송이', draw: (g, n) => { g.strokeStyle = '#000'; g.lineWidth = n * 0.06; g.lineCap = 'round'; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(n / 2, n / 2); g.lineTo(n / 2 + Math.cos(a) * n * 0.45, n / 2 + Math.sin(a) * n * 0.45); g.stroke(); for (const s of [-1, 1]) { g.beginPath(); g.moveTo(n / 2 + Math.cos(a) * n * 0.28, n / 2 + Math.sin(a) * n * 0.28); g.lineTo(n / 2 + Math.cos(a) * n * 0.28 + Math.cos(a + s * 0.8) * n * 0.12, n / 2 + Math.sin(a) * n * 0.28 + Math.sin(a + s * 0.8) * n * 0.12); g.stroke(); } } } },
  ];
  const BUILTIN_TEX = [
    // 종이: 결(중간 크기 굴곡) + 이(작은 요철). 높은 곳에만 물감이 묻는 것처럼
    { id: 'paper', name: '종이', size: 512, draw: (g, n) => { const mid = fbm(n, 16, 4, 21), tooth = fbm(n, 128, 2, 22), fib = fbm(n, 64, 3, 23);
      pixTex(g, n, (x, y) => { const i = y * n + x; return sstep(0.22, 0.72, mid[i] * 0.45 + tooth[i] * 0.4 + fib[i] * 0.15); }); } },
    // 수채 종이(황목): 큼직한 굴곡 + 잔 요철
    { id: 'wcpaper', name: '수채 종이', size: 512, draw: (g, n) => { const big = fbm(n, 8, 4, 31), fine = fbm(n, 64, 3, 32);
      pixTex(g, n, (x, y) => { const i = y * n + x; return sstep(0.18, 0.8, big[i] * 0.6 + fine[i] * 0.4); }); } },
    // 캔버스 천: 씨실·날실이 엇갈려 짜인 결 + 실 굵기 흔들림
    { id: 'canvas', name: '캔버스 천', size: 480, draw: (g, n) => {
      const p = 6, T = n / p, wx = fbm(n, 6, 3, 43), wy = fbm(n, 6, 3, 44), slub = fbm(n, 48, 3, 45), grain = fbm(n, 160, 2, 42), mot = fbm(n, 8, 3, 46), f = new Float32Array(n * n);
      const r = rnd(47), thW = new Float32Array(T), thH = new Float32Array(T), ofW = new Float32Array(T), ofH = new Float32Array(T);
      for (let k = 0; k < T; k++) { thW[k] = 0.55 + r() * 0.4; thH[k] = 0.55 + r() * 0.4; ofW[k] = (r() - 0.5) * 0.25; ofH[k] = (r() - 0.5) * 0.25; }
      const prof = (fr, th, of) => { const d = Math.abs(fr - 0.5 - of) / (0.5 * th); return d >= 1 ? 0 : Math.sqrt(1 - d * d); };
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = y * n + x, xx = x + (wx[i] - 0.5) * p * 1.1, yy = y + (wy[i] - 0.5) * p * 1.1;
        const ux = xx / p, uy = yy / p, ix = ((Math.floor(ux) % T) + T) % T, iy = ((Math.floor(uy) % T) + T) % T;
        const warp = prof(ux - Math.floor(ux), thW[ix], ofW[ix]), weft = prof(uy - Math.floor(uy), thH[iy], ofH[iy]);
        const over = (ix + iy) & 1; // 평직: 번갈아 위·아래 — 교차점마다 짧은 돌기
        const sl = slub[i]; // 실 마디(굵어졌다 가늘어짐)
        const h = Math.max(warp * (over ? 1 : 0.6), weft * (over ? 0.6 : 1)) * (0.75 + 0.25 * sl);
        f[i] = h * 0.72 + grain[i] * 0.16 + mot[i] * 0.12;
      }
      equalize(f); pixTex(g, n, (x, y) => f[y * n + x]); } },
    { id: 'noise', name: '노이즈', size: 512, draw: (g, n) => { const a = fbm(n, 32, 4, 23), b = fbm(n, 256, 1, 24); pixTex(g, n, (x, y) => { const i = y * n + x; return a[i] * 0.6 + b[i] * 0.4; }); } },
    // 거친 결: 분필·크레용용 (작은 요철이 뚜렷)
    { id: 'rough', name: '거친 결', size: 512, draw: (g, n) => { const a = fbm(n, 64, 3, 51), b = fbm(n, 16, 3, 52); pixTex(g, n, (x, y) => { const i = y * n + x; return sstep(0.3, 0.62, a[i] * 0.7 + b[i] * 0.3); }); } },
    // 드로잉지: 3~4px 돌기(종이 이) + 조금 큰 굴곡 — 연필·색연필이 살살 지나가면 이 돌기 끝에만 묻는다
    { id: 'tooth', name: '드로잉지 결', size: 512, draw: (g, n) => { const a = tileWorley(n, 256, 91), b = tileWorley(n, 96, 92), c = fbm(n, 32, 3, 93), d = fbm(n, 128, 2, 90), f = new Float32Array(n * n);
      for (let i = 0; i < f.length; i++) f[i] = bump(a[i]) * 0.42 + bump(b[i]) * 0.2 + c[i] * 0.2 + d[i] * 0.18;
      equalize(f); pixTex(g, n, (x, y) => f[y * n + x]); } },
    // 목탄지(앵그르지): 가로로 촘촘한 발 무늬 + 세로 줄 + 종이 이
    { id: 'laid', name: '목탄지', size: 512, draw: (g, n) => { const a = tileWorley(n, 128, 94), w = fbm(n, 16, 3, 95), c = fbm(n, 32, 3, 96), d = fbm(n, 128, 2, 107), f = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = y * n + x, laid = 0.5 + 0.5 * Math.sin(2 * Math.PI * (y / 4 + w[i] * 2));
        f[i] = laid * 0.16 + bump(a[i]) * 0.42 + c[i] * 0.27 + d[i] * 0.15; }
      equalize(f); pixTex(g, n, (x, y) => f[y * n + x]); } },
    // 중목 종이(파스텔·수채): 큼직한 돌기
    { id: 'coldpress', name: '중목 종이', size: 512, draw: (g, n) => { const a = fbm(n, 32, 3, 97, 0.6), b = tileWorley(n, 192, 98), c = fbm(n, 128, 2, 99), f = new Float32Array(n * n);
      for (let i = 0; i < f.length; i++) f[i] = a[i] * 0.5 + bump(b[i]) * 0.2 + c[i] * 0.3;
      equalize(f); pixTex(g, n, (x, y) => f[y * n + x]); } },
    // 사포·거친 벽: 날카로운 알갱이
    { id: 'grit', name: '사포', size: 512, draw: (g, n) => { const a = tileWorley(n, 170, 101), b = fbm(n, 128, 2, 102), c = fbm(n, 16, 3, 103), f = new Float32Array(n * n);
      for (let i = 0; i < f.length; i++) f[i] = Math.pow(bump(a[i], 0.6), 2) * 0.55 + b[i] * 0.3 + c[i] * 0.15;
      equalize(f); pixTex(g, n, (x, y) => f[y * n + x]); } },
    // 그런지: 크고 작은 얼룩·갈라짐 (낡은 질감 칠하기)
    { id: 'grunge', name: '그런지', size: 512, draw: (g, n) => { const a = fbm(n, 4, 5, 104, 0.6), m = fbm(n, 16, 3, 105), b = fbm(n, 64, 2, 106), f = new Float32Array(n * n);
      for (let i = 0; i < f.length; i++) f[i] = a[i] * 0.55 + m[i] * 0.27 + b[i] * 0.18;
      equalize(f); pixTex(g, n, (x, y) => f[y * n + x]); } },
    { id: 'hatch', name: '빗금', draw: (g, n) => { g.fillStyle = '#fff'; g.fillRect(0, 0, n, n); g.strokeStyle = '#444'; g.lineWidth = 2; for (let i = -n; i < n * 2; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + n, n); g.stroke(); } } },
    { id: 'dots', name: '망점', draw: (g, n) => { g.fillStyle = '#fff'; g.fillRect(0, 0, n, n); g.fillStyle = '#222'; for (let y = 4; y < n; y += 8) for (let x = 4; x < n; x += 8) { g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); } } },
  ];
  const BLOBC = new Map();
  function builtinBlob(item, size = item.size || 256) {
    const k = item.id + ':' + size;
    if (!BLOBC.has(k)) BLOBC.set(k, (async () => {
      const oc = new OffscreenCanvas(size, size), g = oc.getContext('2d');
      g.fillStyle = '#000';
      item.draw(g, size);
      return oc.convertToBlob({ type: 'image/png' });
    })());
    return BLOBC.get(k);
  }
  const builtinThumbs = new Map();
  async function builtinThumb(item) {
    if (!builtinThumbs.has(item.id)) builtinThumbs.set(item.id, URL.createObjectURL(await builtinBlob(item, 64)));
    return builtinThumbs.get(item.id);
  }
  cleanups.push(() => { for (const u of builtinThumbs.values()) URL.revokeObjectURL(u); builtinThumbs.clear(); });
  // 기본 모양으로 시작하는 새 브러시 (필압으로 크기 변화)
  async function advNewBrush(tipId = 'round-hard') {
    const item = BUILTIN_TIPS.find((t) => t.id === tipId) || BUILTIN_TIPS[0];
    const n = (await advListBrushes()).filter((b) => /^기본 브러시/.test(b.name)).length + 1;
    const brush = Object.assign(advBrushDefaults(), { name: '기본 브러시 ' + n });
    brush.baseSize = brush.size;
    brush.id = 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    brush.added = Date.now();
    brush.builtin = true;
    brush.tips = [{ key: await advPutImage(await builtinBlob(item)), thumbKey: null, needPng: false, builtinId: item.id, bver: BUILTIN_VER }];
    brush.texture = null;
    await advSaveBrush(brush);
    return brush;
  }
  function advBrushDefaults() {
    return { name: '', size: 20, sizeEff: { pressure: { min: 0.2, curve: null } }, opacity: 1, opacityEff: null,
      flow: 1, flowEff: null, hardness: 1, interval: 0.08, intervalEff: null, thickness: 1, thickEff: null, vertical: false,
      rotation: 0, rotMask: 3, rotRandom: 1, aa: 1, smoothing: 10, tipOrder: 0, flipH: 0, flipV: 0, ribbon: false,
      texDensity: 0.5, texDensEff: null, texScale: 1, texRotate: 0, texInvert: false, texPerStamp: false,
      spray: null, jitter: null, taperIn: 0, taperOut: 0, erase: false, unsupported: [], texMode: 'mul', scatter: 0, dryOut: null, bristle: null, impasto: null, wet: null };
  }
  // 끝 모양 창 안의 '기본 모양' 고르기 판
  function builtinPicker(list, onPick) {
    const box = document.createElement('div');
    box.className = 'mw-tipgrid';
    for (const item of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mw-tipbtn'; b.title = item.name;
      const im = document.createElement('img'); builtinThumb(item).then((u) => { im.src = u; });
      const t = document.createElement('span'); t.textContent = item.name;
      b.append(im, t);
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onPick(item); });
      box.appendChild(b);
    }
    return box;
  }

  // ---------- 텍스트: 한글 글꼴 ----------
  // Magma 글꼴 중 한글이 들어 있는 것은 Paperlogy·Syongsyong(글꼴 목록에 '(한국인)' 표시). 기본 글꼴(Montserrat 등)에는
  // 한글 글자가 없어 네모(□)로 나온다(실측) → 텍스트 칸에 한글 글꼴 단추를 두고, 한글을 치면 자동으로 한글 글꼴로 바꾼다.
  // 컴퓨터에 설치된 글꼴은 Magma 글자 레이어에 쓸 수 없어서(다른 사람 화면엔 그 글꼴이 없음) '글자 그림'으로 붙여 넣는다.
  const KO_FONTS = ['Paperlogy', 'Syongsyong'];
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
  function textFontRow() { return magmaRows().find((r) => r.querySelector('.slider-label')?.textContent.trim() === 'Font') || [...document.querySelectorAll('editor-sliders .tool-slider')].find((r) => /^Font/.test(r.textContent.trim())); }
  function currentFontName() { const r = textFontRow(); const i = r && r.querySelector('font-selector input, input'); return i ? i.value.trim() : ''; }
  async function setMagmaFont(name) {
    const row = textFontRow();
    const btn = row && (row.querySelector('.dropdown-toggle') || row.querySelector('button'));
    if (!btn) return false;
    if (currentFontName() === name) return true;
    const ta = document.activeElement && document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : null;
    const sel = ta ? [ta.selectionStart, ta.selectionEnd] : null;
    document.documentElement.classList.add('mw-ddhide');
    try {
      press(btn);
      const find = () => [...document.querySelectorAll('.dropdown-menu.show button.dropdown-item')].find((o) => o.textContent.trim().replace(/\s+/g, ' ').startsWith(name));
      await waitFor(find, 800);
      const opt = find();
      if (!opt) { press(btn); return false; }
      opt.click();
      await waitFor(() => currentFontName() === name, 600);
    } finally {
      document.documentElement.classList.remove('mw-ddhide');
      if (ta && ta.isConnected) { ta.focus(); try { ta.setSelectionRange(sel[0], sel[1]); } catch { } }
    }
    return currentFontName() === name;
  }
  // 자동: 텍스트 도구를 처음 고를 때(글상자를 열기 전) 기본 글꼴을 한글 글꼴로 맞춘다 → 새 글상자가 처음부터 한글 글꼴(실측).
  // 이미 쓴 글자에는 손대지 않고, 치는 도중에도 바꾸지 않는다(글꼴 목록이 입력을 가로챔, 실측). 한 번 맞춘 뒤
  // 사용자가 다른 글꼴로 바꾸면 그대로 둔다(이 창에서 한 번만).
  const KO = { last: null, done: false };
  async function koToolTick() {
    const cur = S.active ? null : currentTool();
    const entered = cur === 'faText' && KO.last !== 'faText';
    KO.last = cur;
    if (!entered || !S.koAuto || KO.done) return;
    await sleep(150);
    const t = document.activeElement;
    if (currentTool() !== 'faText' || (t && t.tagName === 'TEXTAREA' && !t.closest('.mw-el') && t.value && t.value !== 'Lorem ipsum')) return;
    const f = currentFontName(), font = S.koFont || 'Paperlogy';
    if (!f || KO_FONTS.includes(f)) { KO.done = true; return; }
    if (await setMagmaFont(font)) { KO.done = true; toast(`한글이 보이도록 기본 글꼴을 "${font}"로 맞췄어요 (끄려면 오른쪽 '자동' 해제)`); }
  }
  // 자동을 껐는데 한글 없는 글꼴로 한글을 치면 알려만 준다
  on(window, 'compositionend', (e) => {
    if (S.koAuto || S.active || currentTool() !== 'faText' || !HANGUL.test(e.data || '')) return;
    const f = currentFontName();
    if (f && !KO_FONTS.includes(f)) toast(`"${f}" 글꼴에는 한글이 없어 네모로 보여요 — 글자를 고르고 오른쪽 '한글' 글꼴 단추를 눌러 주세요`);
  }, true);
  // 텍스트 도구 칸에 '한글 글꼴' 줄
  let koRow = null;
  function ensureKoRow() {
    if (destroyed) return;
    const fontRow = !S.active && currentTool() === 'faText' ? textFontRow() : null;
    if (!fontRow) { koRow?.remove(); koRow = null; return; }
    if (!koRow) {
      koRow = document.createElement('div');
      koRow.className = 'mw-ko-row mw-el';
      const lab = document.createElement('span'); lab.className = 'mw-ko-lab'; lab.textContent = '한글';
      koRow.appendChild(lab);
      for (const f of KO_FONTS) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'sm btn secondary'; b.textContent = f;
        b.title = `글꼴을 ${f}로 (한글이 보이는 Magma 글꼴)`;
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); S.koFont = f; saveSettings(); setMagmaFont(f); });
        koRow.appendChild(b);
      }
      const auto = document.createElement('label'); auto.className = 'mw-ko-auto'; auto.title = '한글을 치면 자동으로 한글 글꼴로 바꿔요';
      auto.innerHTML = '<input type="checkbox"> 자동';
      const cb = auto.querySelector('input'); cb.checked = !!S.koAuto;
      cb.addEventListener('change', () => { S.koAuto = cb.checked; saveSettings(); });
      const pic = document.createElement('button'); pic.type = 'button'; pic.className = 'sm btn secondary mw-ko-pic'; pic.textContent = '내 컴퓨터 글꼴…';
      pic.title = '컴퓨터에 설치된 글꼴로 글자를 그림으로 넣어요';
      pic.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openTextImageDialog(); });
      koRow.append(auto, pic);
      for (const t of ['keydown', 'keyup', 'pointerdown']) koRow.addEventListener(t, (e) => e.stopPropagation());
    }
    if (fontRow.nextElementSibling !== koRow) fontRow.after(koRow);
  }
  cleanups.push(() => { koRow?.remove(); koRow = null; });

  // 내 컴퓨터 글꼴 목록: 글꼴 접근 기능(queryLocalFonts)이 되면 전부, 안 되면 흔한 글꼴 중 설치된 것만(글자 폭 비교)
  let sysFontsP = null;
  function systemFonts() {
    if (sysFontsP) return sysFontsP;
    sysFontsP = (async () => {
      try {
        if (window.queryLocalFonts) {
          const all = await window.queryLocalFonts();
          const names = [...new Set(all.map((f) => f.family))].filter(Boolean).sort((a, b) => (HANGUL.test(b) - HANGUL.test(a)) || a.localeCompare(b, 'ko'));
          if (names.length) return names;
        }
      } catch { /* 권한 없음 → 아래 방식 */ }
      const cands = ['맑은 고딕', '굴림', '돋움', '바탕', '궁서', '나눔고딕', '나눔명조', '나눔바른고딕', '나눔스퀘어', '나눔손글씨 펜', '나눔손글씨 붓',
        'Noto Sans KR', 'Noto Serif KR', 'Pretendard', '배달의민족 주아', '배달의민족 도현', '배달의민족 한나체 Pro', '여기어때 잘난체', 'KoPub돋움체', 'KoPub바탕체',
        '마루 부리', '카페24 써라운드', 'Gmarket Sans', '에스코어 드림', 'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Georgia',
        'Impact', 'Segoe UI', 'Segoe Print', 'Segoe Script', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Yu Gothic', 'MS Gothic', 'SimSun'];
      const c = document.createElement('canvas').getContext('2d');
      const probe = 'mmmmmmmmmlli 가나다라WQ@';
      const w = (f) => { c.font = `40px ${f}`; return c.measureText(probe).width; };
      const base = ['monospace', 'serif', 'sans-serif'].map((b) => w(b));
      return cands.filter((f) => ['monospace', 'serif', 'sans-serif'].some((b, i) => Math.abs(w(`"${f}", ${b}`) - base[i]) > 0.5));
    })();
    return sysFontsP;
  }
  // 글자 그림 넣기 창: 글자·글꼴·크기·굵게·기울임 → 지금 색으로 그려 화면 가운데에 붙여넣기(Magma 이동 도구로 옮길 수 있음)
  async function openTextImageDialog() {
    document.querySelector('.mw-dialog-wrap')?.remove();
    const E = getEditor() || await editorKeepTool();
    if (!E) return;
    const wrap = document.createElement('div');
    wrap.className = 'mw-dialog-wrap mw-el';
    wrap.innerHTML = `<div class="mw-dialog mw-txtdlg" role="dialog">
      <div class="mw-dialog-title">글자 그림 넣기 <span class="mw-hist-sub">내 컴퓨터 글꼴</span></div>
      <div class="mw-hist-help">컴퓨터에 설치된 글꼴로 글자를 <b>그림으로</b> 만들어 지금 레이어에 붙여요(되돌리기 한 칸). 다른 사람에게도 같은 모양으로 보이지만, 붙인 뒤에는 글자를 고칠 수 없어요. 붙인 직후 Magma 이동 도구로 옮길 수 있어요.</div>
      <textarea class="mw-txt-in" rows="3" placeholder="여기에 글자를 쓰세요"></textarea>
      <label class="mw-dialog-row"><span>글꼴</span><select class="mw-txt-font"><option>불러오는 중…</option></select></label>
      <label class="mw-dialog-row"><span>크기 (px)</span><input type="number" min="4" max="1000" value="48" class="mw-dialog-input mw-txt-size"></label>
      <label class="mw-dialog-row"><span>굵게 / 기울임</span><span><input type="checkbox" class="mw-txt-b"> <input type="checkbox" class="mw-txt-i"></span></label>
      <div class="mw-txt-prev"><canvas></canvas></div>
      <div class="mw-dialog-btns"><button type="button" class="md btn secondary mw-no">취소</button><button type="button" class="ml-2 md btn primary mw-ok">넣기</button></div></div>`;
    document.body.appendChild(wrap);
    const q = (s) => wrap.querySelector(s);
    const close = () => wrap.remove();
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    wrap.addEventListener('keyup', (e) => e.stopPropagation());
    q('.mw-no').addEventListener('click', close);
    const n = Number.isFinite(E.primaryColor) ? E.primaryColor >>> 8 : 0;
    const color = '#' + n.toString(16).padStart(6, '0');
    const fonts = await systemFonts();
    const sel = q('.mw-txt-font');
    sel.innerHTML = '';
    for (const f of fonts) { const o = document.createElement('option'); o.value = f; o.textContent = f; o.style.fontFamily = `"${f}"`; sel.appendChild(o); }
    if (S.txtFont && fonts.includes(S.txtFont)) sel.value = S.txtFont;
    if (S.txtSize) q('.mw-txt-size').value = S.txtSize;
    const render = (scale = 1) => {
      const text = q('.mw-txt-in').value || '', size = Math.max(4, Math.min(1000, +q('.mw-txt-size').value || 48));
      const font = `${q('.mw-txt-i').checked ? 'italic ' : ''}${q('.mw-txt-b').checked ? 'bold ' : ''}${size}px "${sel.value}", sans-serif`;
      const lines = text.split('\n'), lh = Math.ceil(size * 1.3);
      const mc = new OffscreenCanvas(1, 1).getContext('2d'); mc.font = font;
      const w = Math.ceil(Math.max(1, ...lines.map((l) => mc.measureText(l).width)) + size * 0.4), h = lh * lines.length + Math.ceil(size * 0.3);
      return { text, font, lines, lh, w, h, size, scale };
    };
    const drawTo = (cv, R) => {
      cv.width = R.w; cv.height = R.h;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, R.w, R.h); g.font = R.font; g.fillStyle = color; g.textBaseline = 'top';
      R.lines.forEach((l, i) => g.fillText(l, R.size * 0.2, i * R.lh + R.size * 0.1));
    };
    const pv = q('.mw-txt-prev canvas');
    const upd = () => { const R = render(); drawTo(pv, R); pv.style.maxWidth = '100%'; };
    for (const s of ['.mw-txt-in', '.mw-txt-size', '.mw-txt-b', '.mw-txt-i', '.mw-txt-font']) q(s).addEventListener('input', upd);
    upd();
    q('.mw-txt-in').focus();
    q('.mw-ok').addEventListener('click', async () => {
      const R = render();
      if (!R.text.trim()) { toast('글자를 써 주세요'); return; }
      const L = E.model.user.activeLayers && E.model.user.activeLayers[0];
      if (!L) { toast('붙일 레이어를 먼저 골라 주세요'); return; }
      if (L.textData) { toast('글자 레이어 말고 그림 레이어를 골라 주세요'); return; }
      { const why = layerDrawBlock(L); if (why) { toast(why); return; } }
      S.txtFont = sel.value; S.txtSize = R.size; saveSettings();
      // 화면 가운데(보드 좌표)
      const c = getCanvas(), r = c.getBoundingClientRect(), m = E.computedView.inverseTransform;
      const cx = m[0] * r.width / 2 + m[2] * r.height / 2 + m[4], cy = m[1] * r.width / 2 + m[3] * r.height / 2 + m[5];
      const W = E.drawing.w, H = E.drawing.h;
      const tc = document.createElement('canvas'); drawTo(tc, R);
      const oc = new OffscreenCanvas(W, H);
      oc.getContext('2d').drawImage(tc, Math.round(Math.min(Math.max(0, cx - R.w / 2), Math.max(0, W - R.w))), Math.round(Math.min(Math.max(0, cy - R.h / 2), Math.max(0, H - R.h))));
      const blob = await oc.convertToBlob({ type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'text.png', { type: 'image/png' }));
      close();
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      toast('글자를 붙였어요 — 이동 도구로 옮길 수 있어요');
    });
  }

  // ---------- 스포이트 미리보기 고리 (클립 스튜디오 방식) ----------
  // 스포이트로 누르고 있는 동안 커서 둘레에 고리를 띄운다: 아래 반쪽 = 원래 색, 위 반쪽 = 지금 고르는 색(실시간).
  // 색은 누른 순간 보드 전체 그림을 한 번 읽어 두고(읽기 전용) 그 안에서 찾는다. 색을 실제로 고르는 건 Magma가 한다.
  const EYE = { el: null, snap: null, W: 0, H: 0, old: '#000', pid: null };
  function eyeColorAt(cx, cy) {
    const E = getEditor(), canvas = getCanvas();
    if (!E || !EYE.snap) return null;
    const m = E.computedView.inverseTransform, r = canvas.getBoundingClientRect();
    const x = Math.floor(m[0] * (cx - r.left) + m[2] * (cy - r.top) + m[4]), y = Math.floor(m[1] * (cx - r.left) + m[3] * (cy - r.top) + m[5]);
    if (x < 0 || y < 0 || x >= EYE.W || y >= EYE.H) return null;
    const i = (y * EYE.W + x) * 4, d = EYE.snap;
    return `rgba(${d[i]},${d[i + 1]},${d[i + 2]},${(d[i + 3] / 255).toFixed(3)})`;
  }
  function eyeRender(cx, cy) {
    const now = eyeColorAt(cx, cy) || 'rgba(0,0,0,0)';
    EYE.el.style.left = cx + 'px'; EYE.el.style.top = cy + 'px';
    EYE.el.style.setProperty('--mw-now', now);
  }
  function eyeStart(e) {
    const E = getEditor();
    if (!E) return;
    try { EYE.snap = E.renderer.getDrawingSnapshotAsBinary(E.drawing); EYE.W = E.drawing.w; EYE.H = E.drawing.h; } catch { EYE.snap = null; }
    if (!EYE.snap) return;
    const n = Number.isFinite(E.primaryColor) ? E.primaryColor >>> 8 : 0;
    EYE.old = '#' + n.toString(16).padStart(6, '0');
    if (!EYE.el) { EYE.el = document.createElement('div'); EYE.el.className = 'mw-eye mw-el'; }
    document.body.appendChild(EYE.el);
    EYE.el.style.setProperty('--mw-old', EYE.old);
    EYE.pid = e.pointerId;
    eyeRender(e.clientX, e.clientY);
  }
  function eyeEnd() { EYE.el?.remove(); EYE.snap = null; EYE.pid = null; }
  on(window, 'pointerdown', (e) => {
    if (!e.isTrusted || e.button !== 0 || S.active || e.target !== getCanvas()) return;
    const E = getEditor();
    const tool = currentTool();
    // Alt 스포이트는 Magma가 도구마다 정해 둔 것(altTool: 브러시·연필·지우개·페인트통)에서만 진짜로 동작한다(Magma 소스:
    // activeTool = 고른 도구.altTool && Alt ? 스포이트 : 고른 도구). 올가미·선택·이동 등에서는 고리를 띄우지 않는다.
    let altEye = false;
    try { const T = E && (E.holdingTool || E.selectedTool); altEye = !!(T && T.altTool) && !E.model.user.activeTool; } catch { altEye = false; }
    const holdAlt = e.altKey && !e.ctrlKey && E && E.isAltPressed && altEye;
    if (tool === 'fa6Eyedropper' || holdAlt) eyeStart(e);
  }, { capture: true, passive: true });
  on(window, 'pointermove', (e) => { if (EYE.pid !== null && e.pointerId === EYE.pid && EYE.el) eyeRender(e.clientX, e.clientY); }, { capture: true, passive: true });
  for (const t of ['pointerup', 'pointercancel']) on(window, t, (e) => { if (EYE.pid !== null && e.pointerId === EYE.pid) eyeEnd(); }, { capture: true, passive: true });
  on(window, 'blur', eyeEnd);

  // ---------- Ctrl+Shift 클릭: 누른 곳의 그림이 있는 레이어 찾기 (클립 스튜디오 방식) ----------
  // 맨 위 레이어부터 그 점에 그림(투명하지 않은 픽셀)이 있는 첫 레이어를 찾는다. 내 레이어면 바로 고르고,
  // 다른 사람 레이어면 레이어 목록을 그 줄까지 굴려 반짝 표시만 한다.
  const PICK = { block: false };
  // 용지 레이어(클립 스튜디오처럼): 맨 아래 3개 안에서 보드 전체를 투명한 곳 없이 꽉 채운 레이어는 배경 종이로 보고
  // Ctrl+Shift 클릭으로 잡지 않는다 (배경에 실수로 그리지 않게). 화면에 따로 표시하지는 않는다. 읽기 전용, 짧게 기억.
  const PAPER = new Map();
  function isPaperLayer(E, L, i) {
    const layers = E.drawing.layers;
    if (i < layers.length - 3) return false;
    const W = E.drawing.w, H = E.drawing.h, lr = L.rect;
    if (!lr || lr.x > 0 || lr.y > 0 || lr.x + lr.w < W || lr.y + lr.h < H) return false;
    const c = PAPER.get(L.id);
    if (c && performance.now() - c.t < 3000) return c.v;
    let v = true;
    try {
      for (let y = 0; y < H && v; y += 256) { // 띠로 나눠 읽고 투명한 픽셀을 찾으면 바로 멈춘다
        const d = E.renderer.getLayerImageData(L, { x: 0, y, w: W, h: Math.min(256, H - y) }).data;
        for (let k = 3; k < d.length; k += 4) if (d[k] < 255) { v = false; break; }
      }
    } catch { v = false; }
    PAPER.set(L.id, { t: performance.now(), v });
    return v;
  }
  function pickLayerAt(cx, cy) {
    const E = getEditor(), canvas = getCanvas();
    if (!E || !canvas) return null;
    const m = E.computedView.inverseTransform, r = canvas.getBoundingClientRect();
    const x = Math.floor(m[0] * (cx - r.left) + m[2] * (cy - r.top) + m[4]), y = Math.floor(m[1] * (cx - r.left) + m[3] * (cy - r.top) + m[5]);
    const layers = E.drawing.layers;
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i], lr = L.rect;
      if (L.visible === false || L.visibleLocally === false || !L.texture || !lr || !(lr.w > 0)) continue;
      if (L.opacity === 0) continue;
      if (x < lr.x || y < lr.y || x >= lr.x + lr.w || y >= lr.y + lr.h) continue;
      try { const d = E.renderer.getLayerImageData(L, { x, y, w: 1, h: 1 }).data; if (d[3] > 0 && !isPaperLayer(E, L, i)) return { L, index: i }; } catch { }
    }
    return null;
  }
  async function revealLayer(hit) {
    const E = getEditor();
    const rows = () => [...document.querySelectorAll('.layer')];
    const any = rows()[0];
    if (!any) return null;
    let sc = any; while (sc && !(sc.scrollHeight > sc.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const rowH = any.getBoundingClientRect().height || 45;
    if (sc) { sc.scrollTop = Math.max(0, hit.index * rowH - (sc.clientHeight - rowH) / 2); await nextFrame(); await nextFrame(); }
    const name = (hit.L.name || '').trim();
    const cand = rows().filter((r) => (r.textContent || '').includes(name));
    if (!cand.length) return null;
    // 같은 이름이 여럿이면 기대 위치에 가장 가까운 줄
    const scTop = sc ? sc.getBoundingClientRect().top - sc.scrollTop : 0;
    cand.sort((a, b) => Math.abs(a.getBoundingClientRect().top - scTop - hit.index * rowH) - Math.abs(b.getBoundingClientRect().top - scTop - hit.index * rowH));
    return cand[0];
  }
  // 레이어 줄 위에 반짝이는 테두리를 따로 띄운다 (Magma가 줄을 다시 그려도 지워지지 않게, 이름으로 줄을 다시 찾음)
  function flashRow(row, L) {
    document.querySelector('.mw-flashbox')?.remove();
    const box = document.createElement('div');
    box.className = 'mw-flashbox mw-el';
    document.body.appendChild(box);
    const t0 = performance.now();
    const step = () => {
      if (!box.isConnected) return;
      if (!row.isConnected) row = [...document.querySelectorAll('.layer')].find((r) => (r.textContent || '').includes((L.name || '').trim())) || row;
      const r = row.getBoundingClientRect();
      Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', display: r.height ? 'block' : 'none' });
      if (performance.now() - t0 < 1600) requestAnimationFrame(step); else box.remove();
    };
    step();
  }
  async function pickLayer(cx, cy) {
    if (!getEditor()) await editorKeepTool();
    const hit = pickLayerAt(cx, cy);
    if (!hit) { toast('여기에는 그림이 있는 레이어가 없어요'); return; }
    const E = getEditor(), u = E.model.user, L = hit.L;
    const mine = L.owner === u || (Array.isArray(u.ownedLayers) && u.ownedLayers.includes(L.id));
    const row = await revealLayer(hit);
    if (row) {
      if (mine && !row.classList.contains('on')) press(row.querySelector('.layer-content') || row);
      await nextFrame();
      flashRow(row, hit.L);
    }
    (mine ? note : toast)(`"${L.name}" 레이어` + (mine ? '를 골랐어요' : ' — 다른 사람 레이어예요'));
  }
  // 마법봉 입력 처리·Magma보다 먼저 (window 캡처, 앞쪽에 등록)
  const PICK_EVENTS = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click'];
  function onPick(e) {
    if (!e.isTrusted) return;
    if (PICK.block) {
      e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
      if (e.type === 'click' || e.type === 'pointerup' || e.type === 'pointercancel') { if (e.type !== 'pointerup') PICK.block = false; else setTimeout(() => { PICK.block = false; }, 300); }
      return;
    }
    if (e.type !== 'pointerdown' || !e.ctrlKey || !e.shiftKey || e.altKey || e.button !== 0 || e.target !== getCanvas() || S.busy) return;
    e.stopImmediatePropagation(); e.preventDefault();
    PICK.block = true;
    pickLayer(e.clientX, e.clientY).catch((err) => console.warn('[MagmaWand] 레이어 찾기', err));
  }

  // 투명색 단축키 (기본 C — Magma의 '댓글' 키를 대신함) · 색이 바뀌면 투명색 끄기 · 도구 맞추기
  on(window, 'keydown', (e) => {
    if (capturingKey || e.repeat || !e.isTrusted) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!getCanvas() || document.querySelector('.modal-dialog')) return;
    const c = comboOf(e);
    if (!c || !(S.akeys || []).includes(c)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    setAlpha(!S.alpha);
  }, true);
  function alphaTick() {
    ensureAlphaSwatch();
    if (!S.alpha) return;
    const E = getEditor();
    if (E && ALPHA.color !== undefined && E.primaryColor !== ALPHA.color) { setAlpha(false); return; } // 다른 색을 골랐음
    alphaSyncTool();
  }

  // ---------- Alt+Delete: 선택 영역(없으면 보드 전체)을 지금 색으로 채우기 ----------
  // Magma에는 같은 명령이 없어 새로 만든다. Magma 올가미 채우기는 선택 영역 밖으로 칠하지 않으므로(실측),
  // 선택을 감싸는 사각형 하나를 긋는다 = Magma 동작 1번(되돌리기 1칸). 투명색이면 지운다.
  // Alt를 누르고 있는 동안 Magma는 도구를 스포이트로 바꿔 두므로, Alt를 뗀 뒤에 실행한다.
  let fillPending = false;
  async function fillSelection() {
    if (S.busy || fillPending) return;
    const E = getEditor() || await editorKeepTool(), canvas = getCanvas();
    const L = E && E.model.user.activeLayers && E.model.user.activeLayers[0];
    if (!E || !canvas) return;
    if (!L) { toast('채울 레이어를 먼저 골라 주세요'); return; }
    fillPending = true;
    try { await waitFor(() => !E.isAltPressed, 4000); } finally { fillPending = false; }
    if (E.isAltPressed) { toast('Alt를 떼면 채워요 — 다시 눌러 주세요'); return; }
    const erase = !!S.alpha;
    const W = E.drawing.w, H = E.drawing.h;
    const b = selectionExists() && E.model.user.selection && E.model.user.selection.bounds;
    const r = b && b.w > 0 ? rclip(rgrow(b, 2), W, H) : { x: 0, y: 0, w: W, h: H };
    const R = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }; // 테두리 픽셀까지 확실히 덮게 1픽셀 바깥
    S.busy = true;
    document.documentElement.classList.add('mw-busy');
    const back = S.active ? 'lassoSelectionIcon' : (currentTool() === 'fa6Eyedropper' && plainTool ? plainTool : currentTool());
    let prevMode = null, prevAuto = null, prevStab = null, prevOp = null, opRow = null;
    try {
      const oldRow = stabilizerRow();
      if (!(await selectTool('lassoBrushIcon'))) throw new Error('올가미 채우기 도구로 바꾸지 못했어요');
      await waitPanelChange(oldRow);
      opRow = magmaRows().find((x) => x.querySelector('.slider-label')?.textContent.trim() === 'Opacity');
      prevOp = opRow ? parseFloat(opRow.querySelector('editable-number')?.textContent) : null;
      if (prevOp !== null && prevOp !== 100) await setRowNumber(opRow, 100);
      prevMode = getBrushMode(); prevAuto = getAutoErase();
      const want = erase ? 'erase' : 'draw';
      await setBrushMode(want);
      if (prevAuto) await setAutoErase(false);
      if (getBrushMode() !== want || getAutoErase() === true) throw new Error('올가미 채우기 설정을 바꾸지 못했어요');
      prevStab = getStabilizer(); if (prevStab) await setStabilizer(0);
      const rect = canvas.getBoundingClientRect(), k = canvas.width / rect.width, m = E.computedView.transform;
      const toBuf = ([x, y]) => [(m[0] * x + m[2] * y + m[4]) * k, (m[1] * x + m[3] * y + m[5]) * k];
      await drawLasso(canvas, [[R.x, R.y], [R.x + R.w, R.y], [R.x + R.w, R.y + R.h], [R.x, R.y + R.h]].map(toBuf), {});
      layerDirty = true;
      note(erase ? (b ? '선택 영역을 지웠어요' : '레이어 전체를 지웠어요') : (b ? '선택 영역을 채웠어요' : '보드 전체를 채웠어요'));
    } catch (err) {
      console.warn('[MagmaWand] 채우기', err);
      toast('채우지 못했어요: ' + (err && err.message || err));
    } finally {
      try {
        if (prevStab) await setStabilizer(prevStab);
        if (prevAuto) await setAutoErase(true);
        if (prevMode && prevMode !== getBrushMode()) await setBrushMode(prevMode);
        if (opRow && opRow.isConnected && prevOp !== null && prevOp !== 100) await setRowNumber(opRow, prevOp);
        if (back && currentTool() !== back) await selectTool(back);
      } catch (e) { console.warn('[MagmaWand] 복구 실패', e); }
      S.busy = false;
      document.documentElement.classList.remove('mw-busy');
    }
  }
  on(window, 'keydown', (e) => {
    if (!e.isTrusted || e.repeat || capturingKey) return;
    if (!(e.code === 'Delete' || e.code === 'Backspace') || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!getCanvas() || document.querySelector('.modal-dialog')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    fillSelection();
  }, true);

  // ---------- 레이어 속성 칸 (클립 스튜디오의 레이어 속성 팔레트) ----------
  // 브러시 목록(1~6번 칸) 끝의 작은 버튼으로, 그 아래 설정 칸 자리에 브러시 설정 대신 레이어 속성을 띄운다.
  // 지금 들어 있는 속성: 경계 효과(테두리) — 내 화면에만 보이는 레이어 스트로크.
  const LP = { on: false, btn: null, bar: null, panel: null, uid: null, tpl: null };
  const LP_SVG = '<path fill="currentColor" d="M256 40 24 160l232 120 232-120zM68 248l-44 24 232 120 232-120-44-24-188 98zm0 112-44 24 232 120 232-120-44-24-188 98z"/>';
  function lpShow(onNow) {
    LP.on = !!onNow;
    document.documentElement.classList.toggle('mw-lp', LP.on);
    if (!LP.on) { LP.panel?.remove(); LP.panel = null; LP.uid = null; }
    ensureLayerProps();
  }
  function ensureLayerProps() {
    if (destroyed) return;
    const sliders = document.querySelector('editor-sliders');
    if (!sliders) { LP.btn?.remove(); LP.bar?.remove(); return; }
    const tplSlider = sliders.querySelector('.tool-slider:not(.mw-el) .slider') && sliders.querySelector('.tool-slider:not(.mw-el) .slider').closest('.tool-slider');
    if (tplSlider && !tplSlider.querySelector('.shape-wrapper') && tplSlider.querySelector('editable-number')) LP.tpl = tplSlider.cloneNode(true);
    // 버튼: 브러시 목록이 있으면 그 끝에, 없으면 설정 칸 위 작은 줄에
    const slots = sliders.previousElementSibling && sliders.previousElementSibling.tagName === 'EDITOR-SLOTS' ? sliders.previousElementSibling : null;
    if (!LP.btn) {
      LP.btn = document.createElement('button');
      LP.btn.type = 'button';
      LP.btn.className = 'btn-slot custom btn component-loud tgl mw-lp-btn';
      LP.btn.innerHTML = `<svg class="svg-icon" viewBox="0 0 512 512" width="14" height="14">${LP_SVG}</svg>`;
      LP.btn.title = '레이어 속성 — 브러시 설정 자리에 레이어 속성을 띄워요';
      LP.btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      LP.btn.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); if (!LP.on && !getEditor()) await editorKeepTool(); lpShow(!LP.on); });
    }
    if (slots) {
      const sib = slots.querySelector('button.btn-slot:not(.mw-lp-btn)');
      if (sib) for (const a of sib.getAttributeNames()) if (a.startsWith('_ngcontent') && !LP.btn.hasAttribute(a)) LP.btn.setAttribute(a, '');
      if (LP.btn.parentElement !== slots || slots.lastElementChild !== LP.btn) slots.appendChild(LP.btn);
      LP.bar?.remove(); LP.bar = null;
      if (!slots.__mwLp) { // 브러시 칸을 누르면 브러시 설정으로 돌아간다
        slots.__mwLp = true;
        slots.addEventListener('pointerdown', (e) => { if (LP.on && e.target.closest('button.btn-slot:not(.mw-lp-btn)')) lpShow(false); }, true);
      }
    } else {
      if (!LP.bar) { LP.bar = document.createElement('div'); LP.bar.className = 'mw-lp-bar mw-el'; }
      if (LP.bar.nextElementSibling !== sliders) sliders.before(LP.bar);
      if (LP.btn.parentElement !== LP.bar) LP.bar.appendChild(LP.btn);
    }
    LP.btn.classList.toggle('on', LP.on); LP.btn.classList.toggle('off', !LP.on);
    if (!LP.on) return;
    const E = getEditor(), L = E && E.model.user.activeLayers && E.model.user.activeLayers[0];
    const uid = L ? (L.uid || 'id' + L.id) : null;
    if (!LP.panel || !LP.panel.isConnected || LP.uid !== uid || LP.panel.parentElement !== sliders) {
      LP.panel?.remove();
      LP.panel = lpBuild(L, uid);
      LP.uid = uid;
      sliders.appendChild(LP.panel);
    } else if (LP.panel.__name && L) LP.panel.__name.textContent = L.name || '';
  }
  function lpSlider(label, min, max, step, get, set) {
    let row;
    if (LP.tpl) {
      row = LP.tpl.cloneNode(true);
      row.classList.add('mw-el', 'mw-slider');
      row.classList.remove('mw-hide');
      const lab = row.querySelector('.slider-label'); lab.innerHTML = ''; lab.textContent = label;
    } else {
      row = document.createElement('div'); row.className = 'tool-slider mw-el mw-lp-row';
      row.innerHTML = '<div class="slider-label"></div><input type="range" class="mw-lp-range"><span class="mw-lp-num"></span>';
      row.querySelector('.slider-label').textContent = label;
    }
    const slider = row.querySelector('.slider'), thumb = row.querySelector('.slider-thumb');
    const numBtn = row.querySelector('editable-number button') || row.querySelector('.mw-lp-num');
    const inp = row.querySelector('editable-number input');
    const range = row.querySelector('.mw-lp-range');
    if (inp) inp.style.display = 'none';
    const q = (v) => Math.min(max, Math.max(min, Math.round(v / step) * step));
    const render = () => {
      const v = get();
      if (thumb) { thumb.style.width = ((v - min) / (max - min) * 100) + '%'; thumb.style.left = '0%'; }
      if (numBtn) numBtn.textContent = String(+v.toFixed(2));
      if (range) { range.min = min; range.max = max; range.step = step; range.value = v; }
    };
    const setV = (v) => { set(q(v)); render(); };
    if (slider) {
      const fromX = (x) => { const r = slider.getBoundingClientRect(); setV(min + (x - r.left) / r.width * (max - min)); };
      slider.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        try { slider.setPointerCapture(e.pointerId); } catch { }
        fromX(e.clientX);
        const mv = (ev) => fromX(ev.clientX);
        const up = () => { slider.removeEventListener('pointermove', mv); slider.removeEventListener('pointerup', up); };
        slider.addEventListener('pointermove', mv); slider.addEventListener('pointerup', up);
      });
    }
    if (range) range.addEventListener('input', () => setV(+range.value));
    row.addEventListener('wheel', (e) => { e.preventDefault(); setV(get() + (e.deltaY < 0 ? step : -step)); }, { passive: false });
    if (numBtn && inp) {
      numBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        numBtn.style.display = 'none'; inp.style.display = 'block'; inp.value = String(get()); inp.focus(); inp.select();
      });
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); });
      inp.addEventListener('blur', () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) setV(v); inp.style.display = 'none'; numBtn.style.display = ''; });
    }
    render();
    return row;
  }
  function lpBuild(L, uid) {
    const p = document.createElement('div');
    p.className = 'mw-lp-panel mw-el';
    for (const t of ['keydown', 'keyup']) p.addEventListener(t, (e) => e.stopPropagation());
    const head = document.createElement('div'); head.className = 'mw-lp-head';
    head.innerHTML = '<span class="mw-lp-title">레이어 속성</span><span class="mw-lp-name"></span>';
    p.appendChild(head);
    p.__name = head.querySelector('.mw-lp-name');
    const board = boardId();
    if (!L || !board) { const n = document.createElement('div'); n.className = 'mw-status'; n.textContent = '레이어를 고르면 속성이 보여요'; p.appendChild(n); return p; }
    p.__name.textContent = L.name || '';
    const saved = fxGet(board, uid);
    const cfg = Object.assign({ on: false, color: '#ffffff', width: 4, aa: true, blur: 0 }, saved || {});
    let stored = !!saved;
    const save = () => { if (cfg.on) stored = true; fxSet(board, uid, stored ? Object.assign({}, cfg) : null); sync(); };
    const sec = (t) => { const d = document.createElement('div'); d.className = 'mw-lp-sec'; d.textContent = t; return d; };
    // 효과: 경계 효과 켜기/끄기
    const fxRow = document.createElement('div'); fxRow.className = 'mw-lp-line';
    fxRow.innerHTML = '<span>경계 효과 (테두리)</span>';
    const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'sm btn mw-lp-tog';
    tog.addEventListener('click', (e) => { e.preventDefault(); cfg.on = !cfg.on; save(); });
    fxRow.appendChild(tog);
    const body = document.createElement('div'); body.className = 'mw-lp-body';
    const wRow = lpSlider('테두리 두께', 1, 100, 1, () => cfg.width, (v) => { cfg.width = v; save(); });
    const bRow = lpSlider('흐리기', 0, 20, 0.5, () => cfg.blur || 0, (v) => { cfg.blur = v; save(); });
    const cRow = document.createElement('label'); cRow.className = 'mw-lp-line';
    cRow.innerHTML = '<span>테두리 색</span><input type="color" class="mw-lp-color">';
    const col = cRow.querySelector('input'); col.value = cfg.color;
    col.addEventListener('input', () => { cfg.color = col.value; save(); });
    const aRow = document.createElement('label'); aRow.className = 'mw-lp-line';
    aRow.innerHTML = '<span>테두리 안티에일리어싱</span><input type="checkbox" class="mw-lp-check">';
    const aa = aRow.querySelector('input'); aa.checked = cfg.aa !== false;
    aa.addEventListener('input', () => { cfg.aa = aa.checked; save(); });
    body.append(wRow, cRow, aRow, bRow);
    const note = document.createElement('div'); note.className = 'mw-status';
    note.textContent = '내 화면에만 보여요 (보드에는 평범한 레이어)';
    p.append(sec('효과'), fxRow, body, note);
    function sync() {
      tog.textContent = cfg.on ? '켜짐' : '꺼짐';
      tog.classList.toggle('primary', cfg.on); tog.classList.toggle('secondary', !cfg.on);
      body.classList.toggle('mw-lp-off', !cfg.on);
    }
    sync();
    return p;
  }
  cleanups.push(() => { LP.btn?.remove(); LP.bar?.remove(); LP.panel?.remove(); document.documentElement.classList.remove('mw-lp'); });

  // ---------- 화면: 도구 막대 버튼 + 오른쪽 설정 칸 ----------
  const WAND_SVG = '<path fill="currentColor" d="M40 420 300 160l52 52L92 472z"/>' +
    '<path fill="currentColor" d="M400 20l28 64 64 28-64 28-28 64-28-64-64-28 64-28z"/>' +
    '<path fill="currentColor" d="M210 40l13 30 30 13-30 13-13 30-13-30-30-13 30-13zM470 250l10 23 23 10-23 10-10 23-10-23-23-10 23-10z"/>';
  // 빠른 선택: 점선 원(선택) + 붓
  const QUICK_SVG = '<path fill="none" stroke="currentColor" stroke-width="34" stroke-dasharray="58 40" d="M256 60a196 196 0 1 0 0.1 0"/>' +
    '<path fill="currentColor" d="M330 120l62 62-150 150-62-62z"/><path fill="currentColor" d="M168 300c40 0 70 30 64 66-8 46-74 76-132 64 34-20 22-56 30-84 6-28 18-46 38-46z"/>';
  // 고급 브러시: 붓 + 별
  const BRUSH_SVG = '<path fill="currentColor" d="M420 40c24-8 52 20 44 44L300 300l-56-56z"/>' +
    '<path fill="currentColor" d="M222 266l56 56c-6 60-50 110-130 118-34 4-70-2-100-16 40-8 52-40 56-76 8-52 52-86 118-82z"/>' +
    '<path fill="currentColor" d="M110 70l12 28 28 12-28 12-12 28-12-28-28-12 28-12z"/>';
  // 블러: 물방울 + 번지는 물결
  const BLUR_SVG = '<path fill="currentColor" d="M256 30C200 120 120 210 120 300a136 136 0 0 0 272 0c0-90-80-180-136-270z" opacity=".9"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="26" stroke-linecap="round" opacity=".55" d="M40 470c40-24 80-24 120 0s80 24 120 0 80-24 120 0 60 16 72 8"/>';
  const TOOL_SVG = { wand: WAND_SVG, quick: QUICK_SVG, brush: BRUSH_SVG, blur: BLUR_SVG, qmask: QM_SVG };
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
    .mw-fxdlg { width: min(400px, 94vw); }
    html.mw-on.mw-advmode editor-sliders .selection-tool > :not(.mw-el) { display: none !important; }
    .mw-advbox { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; }
    .mw-advlist { display: flex; flex-direction: column; gap: 1px; max-height: 280px; overflow-y: auto; padding-right: 2px; }
    .mw-advcat { background: none; border: 0; color: #9a9ca5; font-size: 11px; text-align: left; padding: 5px 2px 2px; cursor: pointer; }
    .mw-advcat:hover { color: #d6d7dc; }
    .mw-advrow { display: flex; align-items: center; gap: 7px; padding: 2px 4px; border: 1px solid transparent; border-radius: 4px; background: none; color: #e6e6e9; font-size: 12px; text-align: left; cursor: pointer; }
    .mw-advrow:hover { background: rgba(255,255,255,.06); }
    .mw-advrow.on { background: rgba(47,128,237,.22); border-color: #2f80ed; }
    .mw-advrow canvas { width: 92px; height: 20px; flex: none; border-radius: 3px; }
    .mw-advrow span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mw-dialog.mw-pp { width: min(760px, 94vw); }
    .mw-pp-top { display: flex; align-items: center; gap: 10px; margin: -4px 0 10px; }
    .mw-pp-top .mw-bs-text { flex: 0 0 240px; padding: 5px 8px; }
    .mw-pp-tip { font-size: 12px; color: #9a9a9a; }
    .mw-pp-body { display: flex; gap: 12px; height: min(62vh, 560px); }
    .mw-pp-cats { flex: 0 0 168px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
    .mw-pp-cat { display: flex; justify-content: space-between; gap: 6px; background: none; border: 0; border-radius: 4px; color: #d6d7dc; font-size: 12.5px; text-align: left; padding: 6px 8px; cursor: pointer; }
    .mw-pp-cat b { color: #8a8c94; font-weight: 400; }
    .mw-pp-cat:hover { background: rgba(255,255,255,.06); }
    .mw-pp-cat.on { background: #2f80ed; color: #fff; } .mw-pp-cat.on b { color: #dbe8ff; }
    .mw-pp-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; align-content: start; padding-right: 4px; }
    .mw-pp-head { grid-column: 1 / -1; font-size: 12px; color: #9a9ca5; margin: 6px 0 -2px; }
    .mw-pp-card { display: flex; flex-direction: column; gap: 3px; background: #2b2c31; border: 1px solid #3a3b42; border-radius: 6px; padding: 6px; color: #eee; text-align: left; cursor: pointer; }
    .mw-pp-card:hover { border-color: #2f80ed; background: #30323a; }
    .mw-pp-card canvas { width: 100%; height: auto; aspect-ratio: 300 / 64; border-radius: 4px; }
    .mw-pp-name { font-size: 12.5px; font-weight: 600; }
    .mw-pp-desc { font-size: 11px; color: #a3a5ad; line-height: 1.35; }
    .mw-advacts { display: flex; flex-wrap: wrap; gap: 4px; }
    .mw-advinfo { font-size: 11.5px; color: #c9a227; white-space: pre-line; }
    .mw-advempty { font-size: 12px; color: #9a9a9a; }
    .mw-fxdlg input[type=range] { width: 130px; vertical-align: middle; }
    .mw-fxdlg .mw-dialog-row { margin-bottom: 10px; }
    .mw-fxdlg .mw-dialog-input { width: 64px; }
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
    .mw-alpha { position: fixed; z-index: 900; width: 16px; height: 16px; box-sizing: border-box; cursor: pointer;
      border: 1px solid #9a9ca5; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0,0,0,.55);
      background: conic-gradient(#c8c8c8 25%, #fff 0 50%, #c8c8c8 0 75%, #fff 0) 0 0 / 8px 8px; }
    .mw-alpha.on { outline: 2px solid #2f80ed; outline-offset: 1px; }
    .mw-eye { position: fixed; z-index: 2147482000; pointer-events: none; width: 120px; height: 120px; margin: -60px 0 0 -60px;
      border-radius: 50%; box-sizing: border-box; border: 4px solid #8a8a8a;
      background: radial-gradient(circle, transparent 36px, #8a8a8a 37px, #8a8a8a 39px, transparent 40px),
        linear-gradient(to bottom, var(--mw-now, transparent) 50%, var(--mw-old, #000) 50%);
      -webkit-mask: radial-gradient(circle, transparent 36px, #000 37px); mask: radial-gradient(circle, transparent 36px, #000 37px); }
    @keyframes mwFlash { 0%, 40%, 80% { box-shadow: inset 0 0 0 2px #ffd23f; background-color: rgba(255,210,63,.28); }
      20%, 60%, 100% { box-shadow: inset 0 0 0 2px transparent; background-color: transparent; } }
    .mw-flashbox { position: fixed; z-index: 2147480500; pointer-events: none; border-radius: 3px; animation: mwFlash 1.5s ease-in-out; }
    html.mw-lp editor-sliders > :not(.mw-lp-panel) { display: none !important; }
    .mw-lp-panel { padding: 4px 6px 6px; box-sizing: border-box; width: 100%; font-size: 12px; }
    .mw-lp-head { display: flex; gap: 8px; align-items: baseline; margin: 2px 0 6px; }
    .mw-lp-title { font-weight: 600; white-space: nowrap; }
    .mw-lp-name { color: #9a9ca5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mw-lp-sec { font-size: 11px; color: #9a9ca5; border-bottom: 1px solid rgba(255,255,255,.1); margin: 4px 0 6px; padding-bottom: 2px; }
    .mw-lp-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; margin-bottom: 4px; }
    .mw-lp-color { width: 64px; height: 20px; border: 1px solid #555; background: none; padding: 0; cursor: pointer; }
    .mw-lp-check { width: 15px; height: 15px; cursor: pointer; }
    .mw-lp-tog { min-width: 52px; }
    .mw-lp-off { opacity: .45; }
    .mw-lp-btn svg { display: block; margin: auto; }
    .mw-lp-bar { display: flex; justify-content: flex-end; margin: 2px 0; }
    .mw-lp-bar .mw-lp-btn { width: 30px; height: 26px; }
    .mw-lp-row { display: flex; align-items: center; gap: 8px; } .mw-lp-row .mw-lp-range { flex: 1; }
    .mw-blurwrap { position: fixed; z-index: 2147480400; pointer-events: none; overflow: hidden; display: none; }
    .mw-blurcv { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    html.mw-ctxhide .context-menu, html.mw-ddhide .dropdown-menu { opacity: 0 !important; }
    .mw-sgrab, .mw-sgrab * { cursor: grab !important; }
    html.mw-lgrabbing, html.mw-lgrabbing * { cursor: grabbing !important; }
    .mw-clipline { position: fixed; z-index: 2147482500; height: 3px; background: #2f80ed; border-radius: 2px; pointer-events: none; box-shadow: 0 0 4px #2f80ed; }
    html.mw-clipcur editor-layers, html.mw-clipcur editor-layers * { cursor: alias !important; }
    .mw-qm-row { display: flex; gap: 4px; flex-wrap: wrap; margin: 4px 0; }
    .mw-bset { position: fixed; z-index: 2147482000; top: 70px; right: 280px; width: 340px; max-height: 78vh; display: flex; flex-direction: column;
      background: #2b2c31; color: #e6e6ea; border: 1px solid #45464d; border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.45); font-size: 12px; }
    .mw-bset-head { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; cursor: move; border-bottom: 1px solid #3d3e45; font-weight: 600; }
    .mw-bset-x { background: none; border: 0; color: #bbb; cursor: pointer; font-size: 13px; }
    .mw-bset-tabs { display: flex; flex-wrap: wrap; gap: 3px; padding: 6px 8px; border-bottom: 1px solid #3d3e45; }
    .mw-bset-tabs button, .mw-bs-seg button { background: #3a3b42; color: #d8d8de; border: 1px solid transparent; border-radius: 4px; padding: 2px 7px; font-size: 11px; cursor: pointer; }
    .mw-bset-tabs button.on, .mw-bs-seg button.on { background: #2f80ed; color: #fff; }
    .mw-bset-body { overflow: auto; padding: 8px 10px 10px; }
    .mw-bs-row { display: flex; align-items: center; gap: 6px; min-height: 26px; }
    .mw-bs-lab { flex: 0 0 104px; color: #b9bac2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mw-bs-range { flex: 1; min-width: 60px; accent-color: #2f80ed; }
    .mw-bs-num { width: 54px; background: #1e1f23; color: #eee; border: 1px solid #45464d; border-radius: 4px; padding: 1px 4px; }
    .mw-bs-unit { width: 18px; color: #8e8f97; }
    .mw-bs-seg { display: flex; flex-wrap: wrap; gap: 3px; }
    .mw-bs-eff { margin: 2px 0 4px; }
    .mw-bs-effmins .mw-bs-lab { color: #8e8f97; }
    .mw-bs-help { color: #9a9ca5; margin: 6px 0; line-height: 1.4; }
    .mw-bs-text { flex: 1; background: #1e1f23; color: #eee; border: 1px solid #45464d; border-radius: 4px; padding: 2px 6px; }
    .mw-bs-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .mw-preset { width: 520px; } .mw-presetgrid { grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); max-height: 56vh; overflow: auto; }
    .layer.mw-msel { background: rgba(47,128,237,.22) !important; box-shadow: inset 3px 0 0 #2f80ed; }
    .mw-mswrap { position: fixed; z-index: 2147480300; pointer-events: none; overflow: hidden; }
    .mw-mscv { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    .mw-msguard { position: fixed; inset: 0; z-index: 2147483000; cursor: progress; display: flex; align-items: flex-end; justify-content: center; }
    .mw-msguard { color: #fff; font-size: 13px; padding-bottom: 72px; text-shadow: 0 1px 3px #000; }
    .mw-tipgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 4px; padding: 6px; margin: 0 0 6px;
      background: rgba(255,255,255,.04); border-radius: 6px; }
    .mw-tipbtn { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 2px; background: #f4f4f4; color: #222;
      border: 1px solid transparent; border-radius: 4px; cursor: pointer; font-size: 10px; line-height: 1.2; min-height: 40px; justify-content: center; }
    .mw-tipbtn:hover { border-color: #2f80ed; }
    .mw-pnglist .mw-hist-thumb { background: #f4f4f4; object-fit: contain; }
    .mw-tipbtn img { width: 36px; height: 36px; object-fit: contain; }
    .mw-ko-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 2px 0 6px; font-size: 12px; }
    .mw-ko-lab { color: #9a9ca5; margin-right: 2px; }
    .mw-ko-auto { display: flex; align-items: center; gap: 3px; color: #c8c9ce; cursor: pointer; margin: 0 2px; }
    .mw-txtdlg { width: 440px; }
    .mw-txt-in { width: 100%; box-sizing: border-box; min-height: 64px; margin: 6px 0; background: #1c1d21; color: #eee; border: 1px solid #44464f; border-radius: 4px; padding: 6px; font-size: 14px; }
    .mw-txt-font { max-width: 240px; background: #1c1d21; color: #eee; border: 1px solid #44464f; border-radius: 4px; }
    .mw-txt-prev { background: conic-gradient(#ddd 25%, #fff 0 50%, #ddd 0 75%, #fff 0) 0 0 / 16px 16px; border-radius: 4px; padding: 6px; margin: 6px 0; max-height: 200px; overflow: auto; }
    /* 사용자 지정 UI (도킹 패널) */
    html.mx-dock-on .editor-right, html.mx-dock-on .editor-left { visibility: hidden !important; pointer-events: none !important; }
    html.mx-dock-on:not(.mx-uihidden) .editor { inset: var(--mx-t, 43px) var(--mx-r, 261px) var(--mx-b, 0px) var(--mx-l, 40px) !important; }
    html.mx-uihidden .mx-dock { display: none !important; }
    html.mx-dock-on editor-color button[tooltip="Layout options"], html.mx-dock-on [command="toggle-hide-column"] { display: none !important; }
    .mx-dock { position: absolute; left: 0; right: 0; bottom: 0; top: 43px; pointer-events: none; z-index: 4; }
    .mx-hold { display: none !important; }
    .mx-frame { position: absolute; pointer-events: auto; display: flex; flex-direction: column; box-sizing: border-box; isolation: isolate;
      background: var(--mx-bg, rgb(35,35,35)); }
    .mx-frame.mx-float { box-shadow: 0 6px 22px rgba(0,0,0,.55); outline: 1px solid rgba(255,255,255,.1); outline-offset: -1px; }
    .mx-rs { position: absolute; z-index: 4; display: none; background: transparent; transition: background .12s; }
    .mx-rs:hover { background: rgba(77,140,255,.6); }
    .mx-float > .mx-rs { display: block; }
    .mx-rs-n, .mx-rs-s { left: 6px; right: 6px; height: 5px; cursor: ns-resize; } .mx-rs-n { top: -2px; } .mx-rs-s { bottom: -2px; }
    .mx-rs-e, .mx-rs-w { top: 6px; bottom: 6px; width: 5px; cursor: ew-resize; } .mx-rs-e { right: -2px; } .mx-rs-w { left: -2px; }
    .mx-rs-ne, .mx-rs-nw, .mx-rs-se, .mx-rs-sw { width: 10px; height: 10px; }
    .mx-rs-ne { top: -2px; right: -2px; cursor: nesw-resize; } .mx-rs-sw { bottom: -2px; left: -2px; cursor: nesw-resize; }
    .mx-rs-nw { top: -2px; left: -2px; cursor: nwse-resize; } .mx-rs-se { bottom: -2px; right: -2px; cursor: nwse-resize; }
    .mx-head { position: relative; z-index: 2; flex: 0 0 14px; height: 14px; display: flex; align-items: stretch; overflow: hidden; cursor: grab; user-select: none;
      font: 600 9.5px/14px system-ui, sans-serif; color: rgba(255,255,255,.5); background: rgba(255,255,255,.035); border-bottom: 1px solid rgba(255,255,255,.05); }
    .mx-btns { margin-left: auto; display: flex; flex: 0 0 auto; }
    .mx-hb { width: 16px; height: 14px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: rgba(255,255,255,.45); }
    .mx-hb svg { width: 9px; height: 9px; }
    .mx-hb:hover { color: #fff; background: rgba(255,255,255,.1); }
    .mx-hclose:hover { background: rgba(232,72,72,.75); }
    .mx-frame.mx-min .mx-fbody { display: none; }
    .mx-head:active { cursor: grabbing; }
    .mx-tab { padding: 0 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .mx-tab.on { color: rgba(255,255,255,.88); background: rgba(255,255,255,.06); }
    .mx-head .mx-tab:only-child { background: transparent; }
    .mx-tab.mx-empty { opacity: .45; }
    .mx-fbody { position: relative; z-index: 1; flex: 1 1 auto; min-height: 0; }
    .mx-pbody { position: absolute; inset: 0; }
    .mx-pbody.mx-flow { overflow: hidden auto; }
    .mx-pbody.mx-flow.mx-fits { overflow: visible; }
    .mx-pbody > editor-layers, .mx-pbody > editor-properties-presets-list { position: absolute !important; inset: 0 !important; height: auto !important; width: auto !important; }
    .mx-pbody.mx-tools { display: flex; flex-direction: column; align-items: stretch; overflow: hidden; }
    .mx-pbody.mx-tools > .editor-left-scroll { flex: 1 1 auto; min-height: 0; width: auto !important; overflow: hidden auto !important; }
    .mx-pbody.mx-tools > .btn-sequence-wrapper { flex: 0 0 auto; align-self: center; }
    /* 도구 막대를 넓히면 열이 늘고(격자), 위·아래에 얇게 붙이면 가로로 늘어선다 */
    .mx-pbody.mx-tools editor-tools { display: grid !important; grid-template-columns: repeat(auto-fill, 32px); grid-auto-rows: 32px; gap: 2px; justify-content: center; align-content: start; width: 100% !important; height: auto !important; }
    .mx-pbody.mx-tools.mx-wide { flex-direction: row; align-items: stretch; }
    .mx-pbody.mx-tools.mx-wide > .editor-left-scroll { overflow: auto hidden !important; height: 100%; }
    .mx-pbody.mx-tools.mx-wide editor-tools { grid-template-columns: none; grid-auto-flow: column; grid-template-rows: repeat(auto-fill, 32px); grid-auto-columns: 32px; height: 100% !important; width: max-content !important; align-content: center; }
    /* 경계선: 평소엔 1px 가는 선, 잡는 자리는 양쪽 3px씩 넓게(보이지 않음), 마우스를 대면 파랗게 굵어짐 */
    .mx-split { position: absolute; pointer-events: auto; z-index: 3; background: var(--mx-bd, rgb(53,53,53)); }
    .mx-split::after { content: ''; position: absolute; background: transparent; transition: background .12s; }
    .mx-split.mx-h::after { top: 0; bottom: 0; left: -3px; right: -3px; } .mx-split.mx-v::after { left: 0; right: 0; top: -3px; bottom: -3px; }
    .mx-split.mx-h { cursor: col-resize; } .mx-split.mx-v { cursor: row-resize; }
    .mx-split:hover::after, .mx-split.mx-act::after { background: rgba(77,140,255,.75); }
    .mx-split.mx-h:hover::after, .mx-split.mx-h.mx-act::after { left: -1px; right: -1px; }
    .mx-split.mx-v:hover::after, .mx-split.mx-v.mx-act::after { top: -1px; bottom: -1px; }
    .mx-hl { position: absolute; pointer-events: none; z-index: 60; background: rgba(77,140,255,.22); border: 2px solid rgba(77,140,255,.9); box-sizing: border-box; border-radius: 3px; transition: left .06s, top .06s, width .06s, height .06s; }
    .mx-hl.mx-tabhl { background: rgba(77,140,255,.12); border-style: dashed; }
    .mx-ghost { position: absolute; pointer-events: none; z-index: 61; height: 18px; padding: 0 8px; box-sizing: border-box; overflow: hidden; white-space: nowrap;
      font: 600 10.5px/18px system-ui, sans-serif; color: #fff; background: rgba(77,140,255,.85); border-radius: 3px; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
    .mx-winmenu { min-width: 210px; }
    .mx-winmenu .mx-wi { display: flex; align-items: center; gap: 6px; }
    .mx-winmenu .mx-chk { display: inline-block; width: 14px; text-align: center; opacity: .9; }
  `;
  let styleEl = null, toolBtn = null, titleEl = null, rowsEl = null, statusEl = null;
  let lastStatus = '';

  function status(msg) {
    lastStatus = msg;
    if (statusEl) statusEl.textContent = msg;
    console.log('[MagmaWand]', msg);
  }
  const hint = () => S.tool === 'brush' ? '그리기: 손을 떼면 보드에 들어가요 · Alt: 스포이트 · Shift+클릭: 직선 · Ctrl+Alt 끌기·[ ]: 크기'
    : S.tool === 'blur' ? '문지르기: 흐리게(손을 떼면 보드에 들어가요, 되돌리기 2칸) · [ ]: 크기'
    : S.tool === 'qmask' ? '빨간 곳 = 선택 · 칠하기: 넣기 · Alt: 반대로 · Enter: 선택으로 · Esc: 처음으로 · [ ]: 크기'
    : S.tool === 'quick'
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
    if (S.tool === 'brush') {
      const adv = advBuildRows();
      const sizeRow2 = sliderRow('브러시 크기', 'advSize', 1, 1000);
      const opRow = sliderRow('불투명도 (%)', 'advOpacity', 1, 100);
      rowsEl.append(adv, sizeRow2, opRow, statusEl);
      rowsEl.__advRender = adv.__mwRender;
    } else if (S.tool === 'blur') {
      rowsEl.append(
        sliderRow('브러시 크기', 'blurSize', 1, 500),
        sliderRow('강도 (흐림 반경 px)', 'blurStrength', 1, 50),
        sliderRow('밀도 (%)', 'blurDensity', 1, 100),
        statusEl,
      );
    } else if (S.tool === 'qmask') {
      const br = document.createElement('div'); br.className = 'mw-el mw-qm-row';
      const mk = (t, fn, tip) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sm btn secondary'; b.textContent = t; b.title = tip; b.addEventListener('click', (e) => { e.preventDefault(); fn(); }); return b; };
      br.append(mk('선택으로 만들기', () => { if (QM.dirty) qmApply(); else toast('아직 칠한 게 없어요'); }, 'Enter'),
        mk('처음으로', () => { qmReset(); qmFromSelection(); status('처음 선택으로 돌렸어요'); }, 'Esc'),
        mk('모두 지우기', () => { if (!QM.mask && !qmFromSelection()) return; QM.mask.fill(0); QM.prev.fill(0); QM.undo = []; QM.dirty = true; QM.g.clearRect(0, 0, QM.W, QM.H); }, '선택을 비우고 새로 칠하기'));
      rowsEl.append(
        sliderRow('브러시 크기', 'qmSize', 1, 1000),
        segRow('칠하기', 'qmMode', [['add', '선택 넣기'], ['sub', '선택 빼기']]),
        br,
        statusEl,
      );
    } else if (S.tool === 'quick') {
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
        sliderRow('빈틈 닫기', 'gap', 0, 20),
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
    document.documentElement.classList.toggle('mw-advmode', S.tool === 'brush' || S.tool === 'blur' || S.tool === 'qmask');
    if (S.tool !== 'blur' && BLR.st) blurEnd(false);
    if ((S.tool !== 'qmask' || !onNow) && QM.mask) await qmLeave();
    if (S.tool !== 'quick' && S.tool !== 'brush' && S.tool !== 'blur' && S.tool !== 'qmask') qCursor(0, 0, false);
    if (S.tool !== 'brush' && ADV.stroke) advStrokeEnd(false);
    if (onNow && S.tool === 'brush' && !ADV.brush) advSelect(S.advBrushId).then(() => advListRender?.());
    if (onNow === S.active) { syncToolButton(); if (onNow) { ensureSettings(); if (S.tool === 'qmask' && !QM.mask) qmEnter(); } return; }
    S.active = onNow;
    document.documentElement.classList.toggle('mw-on', onNow);
    syncToolButton();
    if (!onNow) { closeFlyout(); qCursor(0, 0, false); if (Q.stroking) qFinish(getCanvas(), true); if (ADV.stroke) advStrokeEnd(false); if (BLR.st) blurEnd(false); }
    if (onNow) {
      S.switching = true;
      try { await selectTool('lassoSelectionIcon'); } finally { S.switching = false; }
      lastStatus = upgradedFrom && !lastStatus ? `v${VERSION}으로 업데이트됐어요` : hint();
      ensureSettings();
      if (S.tool === 'qmask') qmEnter();
    } else {
      pendingDown = false;
      removeSettings();
    }
  }

  // ---------- 사용자 지정 UI: 패널 떼기·붙이기·탭 묶기 (클립 스튜디오처럼) ----------
  // Magma 화면 조각(도구 막대·색상환·브러시·브러시 목록·레이어)을 '패널'로 감싸 원래 자리에서 꺼내 옮긴다.
  //  - Magma 요소 자체를 옮기므로 기능은 그대로다(Angular 화면 조각은 옮겨도 계속 동작, 실측).
  //  - 배치 = 나무: 나누기(s, d: 'h' 가로로 나란히 | 'v' 세로로 쌓기, f: 남는 공간을 받는 칸) · 탭 묶음(g) · 그림판(c).
  //    떠 있는 묶음은 따로(f 목록). 그림판 칸의 위치를 Magma 그림판(.editor)에 넘기면 Magma가 알아서 크기를 맞춘다(실측).
  //  - 처음 배치 = 그 화면 모드에서 Magma가 놓은 자리를 재서 만든다 → 어느 모드든 처음 모습이 원래와 같다.
  //  - 끄기(Window 메뉴) = 옮긴 요소를 원래 자리로 되돌리고 덧붙인 것을 모두 걷어낸다. 문제가 생기면 저절로 꺼진다.
  // 새 패널을 더할 때: DOCK_PANELS에 한 줄(id·제목·Magma 요소 선택자·원래 칸) 넣으면 같은 방식으로 붙이고 묶을 수 있다.
  const DOCK_KEY = 'magmaWand.dock';
  const DOCK_HEAD = 14, DOCK_SPL = 1, DOCK_MIN = 48; // 경계선은 1px (잡는 폭은 CSS로 넓게)
  const DOCK_PANELS = [
    { id: 'tools', title: '도구', en: 'Tools', sel: ['.editor-left > .editor-left-scroll', '.editor-left > .btn-sequence-wrapper'], kind: 'tools', origin: '.editor-left' },
    { id: 'color', title: '색상환', en: 'Color', sel: ['.editor-right editor-color'], kind: 'flow', origin: '.container1' },
    { id: 'brush', title: '브러시', en: 'Brush', sel: ['.editor-right editor-slots', '.editor-right editor-sliders'], kind: 'flow', origin: '.container2' },
    { id: 'presets', title: '브러시 목록', en: 'Brush list', sel: ['.editor-right editor-properties-presets-list'], kind: 'fill', origin: '.container2b' },
    { id: 'layers', title: '레이어', en: 'Layers', sel: ['.editor-right editor-layers'], kind: 'fill', origin: '.container3' },
  ];
  const dkTitle = (p) => (p ? (LANG_EN() ? p.en || p.title : p.title) : '');
  const DK = { on: false, root: null, hold: null, pb: {}, adopted: [], frames: new Map(), splits: [], cfg: null, mode: '', lay: null,
    drag: null, hl: null, menuBtn: null, menu: null, failed: false, saveT: 0, sig: '', pendingMode: 0 };
  const dkUid = () => 'g' + Math.random().toString(36).slice(2, 9);
  function dkLoadCfg() {
    if (DK.cfg) return DK.cfg;
    let c = null; try { c = JSON.parse(localStorage.getItem(DOCK_KEY) || 'null'); } catch { c = null; }
    DK.cfg = c && typeof c === 'object' ? c : { on: true, L: {}, D: {} };
    DK.cfg.L = DK.cfg.L || {}; DK.cfg.D = DK.cfg.D || {};
    if (DK.cfg.v !== 2) { DK.cfg.L = {}; DK.cfg.D = {}; DK.cfg.v = 2; } // v2: 브러시+브러시 목록 탭 기본 배치
    return DK.cfg;
  }
  function dkSave(now) {
    clearTimeout(DK.saveT);
    const go = () => { try { if (DK.lay && DK.mode && !DK.failed) DK.cfg.L[DK.mode] = DK.lay; localStorage.setItem(DOCK_KEY, JSON.stringify(DK.cfg)); } catch { /* 무시 */ } };
    if (now) go(); else DK.saveT = setTimeout(go, 300);
  }
  // 화면 모드: Magma 설정(settings-sliders, 읽기만) + 오른쪽 칸 모양(브러시 목록·두 줄)
  function dkModeKey() {
    const er = document.querySelector('.editor-right');
    return (localStorage.getItem('settings-sliders') || 'full') + (er && er.classList.contains('has-brush-list') ? '|bl' : '') + (document.querySelector('.has-two-columns') ? '|2c' : '');
  }
  // ---- 패널 몸통(옮긴 Magma 요소가 들어가는 상자) ----
  function dkPBody(p) {
    let b = DK.pb[p.id];
    if (!b) { b = document.createElement('div'); b.className = 'mx-pbody mx-' + p.kind + ' thin-dark-scrollbar'; b.dataset.p = p.id; DK.pb[p.id] = b; } // 스크롤바 = Magma 레이어 목록과 같은 얇은 어두운 모양
    return b;
  }
  // Magma가 새로 만든(또는 아직 안 옮긴) 요소를 패널로 옮긴다. 원래 자리는 기록해 두었다가 끌 때 되돌린다.
  function dkAdopt() {
    for (const p of DOCK_PANELS) {
      const body = dkPBody(p);
      for (const s of p.sel) {
        for (const el of document.querySelectorAll(s)) {
          if (body.contains(el)) continue;
          DK.adopted.push({ node: el, parent: el.parentNode, next: el.nextSibling, p });
          // 정해진 순서대로 (브러시: 칸 줄 → 설정)
          const order = p.sel.indexOf(s);
          el.__mxOrder = order;
          const after = [...body.children].find((c) => (c.__mxOrder ?? 99) > order);
          body.insertBefore(el, after || null);
        }
      }
    }
  }
  function dkHasContent(id) { const b = DK.pb[id]; return !!(b && b.childElementCount); }
  // 옮긴 요소를 원래 자리로 (뒤에서부터 → 같은 칸 안의 순서도 그대로)
  function dkRestoreNodes() {
    for (const r of DK.adopted.splice(0).reverse()) {
      const n = r.node;
      if (!n.isConnected && !(n.parentNode && n.parentNode.classList && n.parentNode.classList.contains('mx-pbody'))) continue; // Magma가 없앤 요소
      let parent = r.parent && r.parent.isConnected ? r.parent : document.querySelector(r.p.origin);
      if (!parent) continue;
      parent.insertBefore(n, r.next && r.next.parentNode === parent ? r.next : null);
    }
  }
  // ---- 기본 배치: Magma가 놓은 자리를 잰다 (요소가 원래 칸에 있을 때만 정확) ----
  function dkMeasureDefault() {
    const box = document.querySelector('editor-box'), er = document.querySelector('.editor-right'), el = document.querySelector('.editor-left');
    if (!box) return null;
    const right = [];
    for (const p of DOCK_PANELS) {
      if (p.id === 'tools') continue;
      const c = er && er.querySelector(p.origin), host = er && er.querySelector(p.sel[0]);
      if (!c || !host) continue;
      const r = c.getBoundingClientRect(), hr = host.getBoundingClientRect();
      if (!(r.width > 0)) continue;
      right.push({ p, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(Math.max(r.height, hr.height)) });
    }
    const g = (id) => ({ k: 'g', id: dkUid(), t: [id], a: id });
    const cols = [];
    for (const it of right.sort((a, b) => a.x - b.x || a.y - b.y)) {
      let col = cols.find((c) => Math.abs(c.x - it.x) < 12);
      if (!col) { col = { x: it.x, w: it.w, items: [] }; cols.push(col); }
      col.items.push(it); col.w = Math.max(col.w, it.w);
    }
    const colNode = (col) => {
      let items = col.items.sort((a, b) => a.y - b.y);
      // 브러시와 브러시 목록은 같은 탭 묶음으로 (브러시 칸 크기 그대로, 목록은 탭을 눌러 같은 자리에서)
      const bi = items.findIndex((i) => i.p.id === 'brush'), pi = items.findIndex((i) => i.p.id === 'presets');
      if (bi >= 0 && pi >= 0) { items[bi] = { ...items[bi], tabs: ['brush', 'presets'] }; items = items.filter((_, k) => k !== pi); }
      const grp = (i) => (i.tabs ? { k: 'g', id: dkUid(), t: i.tabs, a: i.tabs[0] } : g(i.p.id));
      if (items.length === 1) return grp(items[0]);
      const fi = items.findIndex((i) => i.p.id === 'layers');
      return { k: 's', d: 'v', c: items.map(grp), z: items.map((i) => i.h + DOCK_HEAD), f: fi >= 0 ? fi : items.length - 1 };
    };
    const kids = [], z = [];
    const ew = el ? Math.round(el.getBoundingClientRect().width) : 0;
    if (ew > 0 && el.querySelector('editor-tools')) { kids.push(g('tools')); z.push(ew); }
    kids.push({ k: 'c' }); z.push(0);
    if (cols.length === 1) { kids.push(colNode(cols[0])); z.push(cols[0].w); }
    else if (cols.length > 1) { kids.push({ k: 's', d: 'h', c: cols.map(colNode), z: cols.map((c) => c.w), f: cols.length - 1 }); z.push(cols.reduce((s, c) => s + c.w, 0)); }
    const root = { k: 's', d: 'h', c: kids, z, f: kids.findIndex((k) => k.k === 'c') };
    // Magma가 이 모드에서 숨긴 조각(요소는 있지만 칸이 안 보임)은 숨김 목록으로
    const placed = new Set(dkGroups(root).flatMap((x) => x.t));
    const h = DOCK_PANELS.map((p) => p.id).filter((id) => !placed.has(id));
    return { root, fl: [], h };
  }
  function dkFallbackDefault() {
    const g = (id) => ({ k: 'g', id: dkUid(), t: [id], a: id });
    return { root: { k: 's', d: 'h', f: 1, z: [40, 0, 261], c: [g('tools'), { k: 'c' }, { k: 's', d: 'v', f: 2, z: [241, 261, 200], c: [g('color'), { k: 'g', id: dkUid(), t: ['brush', 'presets'], a: 'brush' }, g('layers')] }] }, fl: [], h: [] };
  }
  // ---- 나무 다루기 ----
  const dkHasCanvas = (n) => n.k === 'c' || (n.k === 's' && n.c.some(dkHasCanvas));
  function dkGroups(n, out = []) { if (n.k === 'g') out.push(n); else if (n.k === 's') n.c.forEach((c) => dkGroups(c, out)); return out; }
  function dkAllGroups() { return [...dkGroups(DK.lay.root), ...DK.lay.fl.map((f) => f.g)]; }
  function dkParentOf(target, n = DK.lay.root, parent = null) {
    if (n === target) return { parent, index: parent ? parent.c.indexOf(n) : -1 };
    if (n.k === 's') for (const c of n.c) { const r = dkParentOf(target, c, n); if (r) return r; }
    return null;
  }
  // 빈 묶음·빈 나누기를 걷어내고, 칸이 하나뿐인 나누기는 그 칸으로 바꾼다
  function dkNorm(n) {
    if (n.k === 'g') return n.t.length ? n : null;
    if (n.k === 'c') return n;
    const c = [], z = []; let f = -1;
    n.c.forEach((ch, i) => { const r = dkNorm(ch); if (r) { if (i === n.f) f = c.length; c.push(r); z.push(n.z[i]); } });
    if (!c.length) return null;
    if (c.length === 1) return c[0];
    n.c = c; n.z = z;
    const ci = c.findIndex(dkHasCanvas);
    n.f = ci >= 0 ? ci : (f >= 0 ? f : c.length - 1);
    return n;
  }
  function dkValid(lay) {
    try {
      if (!lay || !lay.root || !Array.isArray(lay.fl)) return false;
      let canv = 0; const seen = new Set();
      const walk = (n) => {
        if (!n || typeof n !== 'object') throw 0;
        if (n.k === 'c') { canv++; return; }
        if (n.k === 'g') { if (!Array.isArray(n.t)) throw 0; for (const t of n.t) { if (seen.has(t)) throw 0; seen.add(t); } return; }
        if (n.k === 's') { if (!Array.isArray(n.c) || !Array.isArray(n.z) || n.c.length !== n.z.length) throw 0; n.c.forEach(walk); return; }
        throw 0;
      };
      walk(lay.root); lay.fl.forEach((f) => walk(f.g));
      return canv === 1;
    } catch { return false; }
  }
  // 배치에 없는 패널(새로 생긴 패널 등)은 떠 있는 창으로 더한다
  function dkEnsureAll() {
    const have = new Set([...dkAllGroups().flatMap((g) => g.t), ...(DK.lay.h || [])]);
    let k = 0;
    for (const p of DOCK_PANELS) if (!have.has(p.id) && dkHasContent(p.id)) { DK.lay.fl.push({ g: { k: 'g', id: dkUid(), t: [p.id], a: p.id }, x: 120 + 30 * k, y: 80 + 30 * k, w: 260, h: 260 }); k++; }
  }
  // ---- 그리기 ----
  function dkGroupVisible(g) { return g.t.some(dkHasContent); }
  function dkVisible(n) { return n.k === 'c' || (n.k === 'g' ? dkGroupVisible(n) : n.c.some(dkVisible)); }
  const dkMinOf = (c) => (dkHasCanvas(c) ? 120 : c.k === 'g' && c.t.length === 1 && c.t[0] === 'tools' ? 32 : DOCK_MIN);
  function dkLayoutNode(n, x, y, w, h, out) {
    if (n.k === 'c') { out.canvas = { x, y, w, h }; return; }
    if (n.k === 'g') { out.groups.push({ g: n, x, y, w, h: n.m ? DOCK_HEAD : h }); return; }
    const H = n.d === 'h', vis = n.c.map((c, i) => (dkVisible(c) ? i : -1)).filter((i) => i >= 0);
    if (!vis.length) return;
    const total = (H ? w : h) - DOCK_SPL * (vis.length - 1);
    // 세로로 쌓인 칸에서 접은(최소화) 묶음은 상단바 높이만 차지한다
    const isMin = (i) => !H && n.c[i].k === 'g' && !!n.c[i].m;
    const open = vis.filter((i) => !isMin(i));
    const flex = open.includes(n.f) ? n.f : (open.length ? open[open.length - 1] : -1);
    const size = {};
    let fixed = 0;
    for (const i of vis) if (i !== flex) { size[i] = isMin(i) ? DOCK_HEAD : Math.max(dkMinOf(n.c[i]), n.z[i] || DOCK_MIN); fixed += size[i]; }
    const minFlex = flex < 0 ? 0 : dkHasCanvas(n.c[flex]) ? 120 : DOCK_MIN;
    if (total - fixed < minFlex && fixed > 0) { const k = Math.max(0, total - minFlex) / fixed; for (const i of vis) if (i !== flex && !isMin(i)) size[i] = Math.floor(size[i] * k); fixed = vis.reduce((s, i) => s + (i === flex ? 0 : size[i]), 0); }
    if (flex >= 0) size[flex] = Math.max(0, total - fixed);
    let pos = H ? x : y;
    vis.forEach((i, j) => {
      const sz = size[i];
      if (H) dkLayoutNode(n.c[i], pos, y, sz, h, out); else dkLayoutNode(n.c[i], x, pos, w, sz, out);
      pos += sz;
      if (j < vis.length - 1) {
        if (!isMin(i) && !isMin(vis[j + 1])) out.splits.push({ n, a: i, b: vis[j + 1], H, flex, x: H ? pos : x, y: H ? y : pos, w: H ? DOCK_SPL : w, h: H ? h : DOCK_SPL, sizes: size });
        pos += DOCK_SPL;
      }
    });
  }
  function dkFrame(g) {
    let fr = DK.frames.get(g.id);
    if (!fr) {
      fr = document.createElement('div'); fr.className = 'mx-frame mw-el'; fr.dataset.g = g.id;
      const head = document.createElement('div'); head.className = 'mx-head';
      const body = document.createElement('div'); body.className = 'mx-fbody';
      fr.append(head, body); fr.__body = body;
      // 떠 있는 창의 가장자리·꼭짓점 손잡이 (Magma 내용 위에 얹어서, 안쪽 요소의 끌기와 섞이지 않게)
      for (const s of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) { const h = document.createElement('div'); h.className = 'mx-rs mx-rs-' + s; h.dataset.s = s; h.addEventListener('pointerdown', (e) => dkResizeDown(e, fr, s)); fr.appendChild(h); }
      head.addEventListener('pointerdown', (e) => dkHeadDown(e, fr));
      fr.addEventListener('pointerdown', () => dkFront(fr), true);
      DK.root.appendChild(fr); DK.frames.set(g.id, fr);
    }
    return fr;
  }
  function dkRenderHead(fr, g) {
    const head = fr.firstChild, sig = g.t.join(',') + '|' + g.a + '|' + (g.m ? 1 : 0) + '|' + (LANG_EN() ? 'en' : 'ko');
    if (head.dataset.sig === sig) return;
    head.dataset.sig = sig; head.innerHTML = '';
    for (const id of g.t) {
      const p = DOCK_PANELS.find((q) => q.id === id);
      const t = document.createElement('span'); t.className = 'mx-tab' + (id === g.a ? ' on' : ''); t.textContent = p ? dkTitle(p) : id; t.dataset.p = id;
      if (!dkHasContent(id)) t.classList.add('mx-empty');
      head.appendChild(t);
    }
    // 오른쪽 끝: 접기(최소화) · 닫기
    const btns = document.createElement('span'); btns.className = 'mx-btns';
    const mk = (cls, title, svg, fn) => {
      const b = document.createElement('span'); b.className = 'mx-hb ' + cls; b.title = title; b.innerHTML = svg;
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
      b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); fn(); });
      return b;
    };
    btns.append(
      mk('mx-hmin', g.m ? L('펼치기', 'Expand') : L('접기', 'Minimize'),
        g.m ? '<svg viewBox="0 0 10 10"><path d="M2 2.5h6v5H2z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' : '<svg viewBox="0 0 10 10"><path d="M2 6.5h6" stroke="currentColor" stroke-width="1.4"/></svg>',
        () => { g.m = !g.m; dkRender(); dkSave(); }),
      mk('mx-hclose', L('닫기 (Window 메뉴에서 다시 열기)', 'Close (reopen from the Window menu)'),
        '<svg viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.3"/></svg>', () => dkTogglePanel(g.a)));
    head.appendChild(btns);
  }
  function dkRender() { try { dkRenderInner(); } catch (e) { dkFail(e); } }
  function dkRenderInner() {
    if (!DK.on || !DK.root) return;
    // Magma가 UI를 숨겼으면(Tab 등) 패널도 숨기고 그림판은 Magma에 맡긴다
    const er = document.querySelector('.editor-right'), top = document.querySelector('.editor-top');
    const uiHidden = !er || getComputedStyle(er).display === 'none';
    if (document.documentElement.classList.contains('mx-uihidden') !== uiHidden) { document.documentElement.classList.toggle('mx-uihidden', uiHidden); DK.sig = ''; }
    if (uiHidden) return;
    { const tb = top ? Math.round(top.getBoundingClientRect().bottom - (document.querySelector('editor-box')?.getBoundingClientRect().top || 0)) : 43; const want = Math.max(0, tb) + 'px'; if (DK.root.style.top !== want) DK.root.style.top = want; }
    const R = DK.root.getBoundingClientRect();
    if (!(R.width > 0)) return;
    const out = { canvas: null, groups: [], splits: [] };
    dkLayoutNode(DK.lay.root, 0, 0, Math.round(R.width), Math.round(R.height), out);
    DK.splits = out.splits;
    const live = new Set();
    const place = (g, x, y, w, h, float, z) => {
      const fr = dkFrame(g); live.add(g.id);
      dkRenderHead(fr, g);
      fr.classList.toggle('mx-float', !!float);
      if (g.m) h = DOCK_HEAD;
      fr.classList.toggle('mx-min', !!g.m);
      Object.assign(fr.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', display: dkGroupVisible(g) ? '' : 'none', zIndex: float ? String(20 + z) : '' });
      // 도구 막대: 위·아래로 얇게(가로로 길게) 붙이면 가로로 늘어놓는다
      if (g.a === 'tools' && DK.pb.tools) DK.pb.tools.classList.toggle('mx-wide', w > (h - DOCK_HEAD) * 1.4);
      const body = fr.__body;
      for (const id of g.t) {
        const pb = DK.pb[id]; if (!pb) continue;
        if (pb.parentNode !== body) body.appendChild(pb);
        pb.style.display = id === g.a ? '' : 'none';
        if (id === g.a && pb.classList.contains('mx-flow')) pb.classList.toggle('mx-fits', pb.scrollHeight <= pb.clientHeight + 1);
      }
    };
    for (const it of out.groups) place(it.g, it.x, it.y, it.w, it.h, false, 0);
    DK.lay.fl.forEach((f, i) => {
      f.x = Math.max(-f.w + 60, Math.min(R.width - 60, f.x)); f.y = Math.max(0, Math.min(R.height - DOCK_HEAD, f.y));
      place(f.g, f.x, f.y, f.w, f.h, true, i);
    });
    // 사라진 묶음의 틀은 걷되, 그 안의 패널 몸통(Magma 요소)은 보관함으로
    for (const [id, fr] of DK.frames) if (!live.has(id)) { for (const pb of [...fr.__body.children]) DK.hold.appendChild(pb); fr.remove(); DK.frames.delete(id); }
    // 숨긴 패널·어느 묶음에도 없는 패널 몸통은 보관함으로
    const shown = new Set(dkAllGroups().flatMap((g) => g.t));
    for (const p of DOCK_PANELS) { const pb = DK.pb[p.id]; if (pb && !shown.has(p.id) && pb.parentNode !== DK.hold) DK.hold.appendChild(pb); }
    // 경계선
    DK.root.querySelectorAll(':scope > .mx-split').forEach((s, i) => { if (i >= out.splits.length) s.remove(); });
    let ss = [...DK.root.querySelectorAll(':scope > .mx-split')];
    out.splits.forEach((sp, i) => {
      let el = ss[i];
      if (!el) { el = document.createElement('div'); el.className = 'mx-split mw-el'; el.addEventListener('pointerdown', (e) => dkSplitDown(e, el)); DK.root.appendChild(el); }
      el.classList.toggle('mx-h', sp.H); el.classList.toggle('mx-v', !sp.H); el.__sp = sp;
      Object.assign(el.style, { left: sp.x + 'px', top: sp.y + 'px', width: sp.w + 'px', height: sp.h + 'px' });
    });
    // 그림판 자리 → Magma 그림판(.editor)
    const c = out.canvas || { x: 0, y: 0, w: R.width, h: R.height };
    const box = document.querySelector('editor-box'), B = box ? box.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const t = Math.round(R.top - B.top + c.y), l = Math.round(R.left - B.left + c.x), r = Math.round(B.width - (R.left - B.left + c.x + c.w)), b = Math.round(B.height - (R.top - B.top + c.y + c.h));
    const sig = [t, r, b, l].join(',');
    if (sig !== DK.sig) { DK.sig = sig; const st = document.documentElement.style; st.setProperty('--mx-t', t + 'px'); st.setProperty('--mx-r', r + 'px'); st.setProperty('--mx-b', b + 'px'); st.setProperty('--mx-l', l + 'px'); }
  }
  // ---- 경계선 끌기 (창 크기는 그대로, 두 칸의 비율만) ----
  function dkSplitDown(e, el) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const sp = el.__sp, n = sp.n;
    // 지금 보이는 크기를 그대로 기준값으로
    for (const k of Object.keys(sp.sizes)) n.z[k] = sp.sizes[k];
    const start = sp.H ? e.clientX : e.clientY, A = sp.sizes[sp.a], B = sp.sizes[sp.b];
    const minA = dkMinOf(n.c[sp.a]), minB = dkMinOf(n.c[sp.b]);
    el.setPointerCapture(e.pointerId); el.classList.add('mx-act');
    const mv = (ev) => {
      // 경계선이 d만큼 움직이면 앞 칸 A+d, 뒤 칸 B−d (남는 공간을 받는 칸도 같은 규칙) — 각 칸의 최소 크기까지만
      const d = Math.max(-(A - minA), Math.min((sp.H ? ev.clientX : ev.clientY) - start, B - minB));
      if (sp.a === sp.flex) n.z[sp.b] = B - d;
      else if (sp.b === sp.flex) n.z[sp.a] = A + d;
      else { n.z[sp.a] = A + d; n.z[sp.b] = B - d; }
      dkRender();
    };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.classList.remove('mx-act'); dkSave(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  // ---- 떠 있는 창: 가장자리·꼭짓점 끌어 크기 조절 ----
  const dkFloatOf = (g) => DK.lay.fl.find((f) => f.g === g);
  const dkGroupById = (id) => dkAllGroups().find((g) => g.id === id);
  // 누른 떠 있는 창을 맨 앞으로
  function dkFront(fr) {
    const g = dkGroupById(fr.dataset.g), f = g && dkFloatOf(g);
    if (f && DK.lay.fl[DK.lay.fl.length - 1] !== f) { DK.lay.fl.splice(DK.lay.fl.indexOf(f), 1); DK.lay.fl.push(f); dkRender(); }
  }
  function dkResizeDown(e, fr, s) {
    const g = dkGroupById(fr.dataset.g), f = g && dkFloatOf(g);
    if (!f || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const h = e.currentTarget, sx = e.clientX, sy = e.clientY, o = { x: f.x, y: f.y, w: f.w, h: f.h };
    h.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (s.includes('e')) f.w = Math.max(80, o.w + dx);
      if (s.includes('s')) f.h = Math.max(DOCK_HEAD + 40, o.h + dy);
      if (s.includes('w')) { f.w = Math.max(80, o.w - dx); f.x = o.x + o.w - f.w; }
      if (s.includes('n')) { f.h = Math.max(DOCK_HEAD + 40, o.h - dy); f.y = o.y + o.h - f.h; }
      dkRender();
    };
    const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); dkSave(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }
  // ---- 상단바 끌기: 탭 누르기(전환) / 끌어서 옮기기·붙이기·탭으로 합치기 ----
  function dkHeadDown(e, fr) {
    if (e.button !== 0 || DK.drag) return;
    const g = dkGroupById(fr.dataset.g); if (!g) return;
    e.preventDefault(); e.stopPropagation();
    const tab = e.target.closest('.mx-tab'), pid = tab ? tab.dataset.p : null;
    const R = DK.root.getBoundingClientRect(), fr0 = fr.getBoundingClientRect();
    const d = { g, pid, fr, sx: e.clientX, sy: e.clientY, moved: false, ox: e.clientX - fr0.left, oy: e.clientY - fr0.top, w: fr0.width, h: fr0.height, R, target: null };
    // 탭이 여럿인 묶음에서 탭을 잡으면 그 패널만, 아니면 묶음 통째로
    d.single = !!(pid && g.t.length > 1);
    fr.firstChild.setPointerCapture(e.pointerId);
    DK.drag = d;
    const head = fr.firstChild;
    const mv = (ev) => {
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 5) return;
      if (!d.moved) { d.moved = true; dkGhost(d); }
      d.target = dkDropTarget(ev, d);
      dkShowTarget(d, ev);
    };
    const up = (ev) => {
      head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
      DK.drag = null; DK.hl?.remove(); DK.hl = null; d.ghost?.remove();
      if (!d.moved) { if (pid && g.a !== pid) { g.a = pid; dkRender(); dkSave(); } return; } // 탭 전환
      if (ev.type === 'pointercancel' || !d.target) return;
      try { dkDrop(d, d.target, ev); } catch (err) { console.warn('[MagmaWand] 패널 옮기기', err); }
      DK.lay.root = dkNorm(DK.lay.root) || { k: 'c' };
      DK.lay.fl = DK.lay.fl.filter((f) => f.g.t.length);
      dkRender(); dkSave();
    };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  }
  function dkGhost(d) {
    const gh = document.createElement('div'); gh.className = 'mx-ghost mw-el';
    gh.textContent = d.single ? dkTitle(DOCK_PANELS.find((p) => p.id === d.pid)) : d.g.t.map((t) => dkTitle(DOCK_PANELS.find((p) => p.id === t))).join(' · ');
    DK.root.appendChild(gh); d.ghost = gh;
  }
  // 놓을 곳: 화면 가장자리(전체 기준 상하좌우) / 다른 묶음의 가운데(탭으로 합치기)·가장자리(그 옆에 붙이기) / 그 밖 = 띄우기
  function dkDropTarget(e, d) {
    const R = d.R, x = e.clientX - R.left, y = e.clientY - R.top, E = 24;
    if (x >= 0 && y >= 0 && x <= R.width && y <= R.height) {
      if (x < E) return { type: 'root', side: 'w' };
      if (x > R.width - E) return { type: 'root', side: 'e' };
      if (y > R.height - E) return { type: 'root', side: 's' };
      if (y < E) return { type: 'root', side: 'n' };
    }
    // 위에 떠 있는 창부터
    const frames = [...DK.frames.values()].filter((f) => f.style.display !== 'none' && f !== d.fr).sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0));
    for (const fr of frames) {
      const r = fr.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
      const g = dkGroupById(fr.dataset.g); if (!g) continue;
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      if (e.clientY < r.top + DOCK_HEAD + 6 || fr.classList.contains('mx-float')) return { type: 'tab', g, rect: r };
      const dl = fx, dr = 1 - fx, dt = fy, db = 1 - fy, m = Math.min(dl, dr, dt, db);
      if (m > 0.28) return { type: 'tab', g, rect: r };
      const side = m === dl ? 'w' : m === dr ? 'e' : m === dt ? 'n' : 's';
      return { type: 'side', g, side, rect: r };
    }
    return { type: 'float' };
  }
  function dkShowTarget(d, e) {
    const R = d.R, t = d.target;
    if (d.ghost) Object.assign(d.ghost.style, { left: (e.clientX - R.left - Math.min(d.ox, 120)) + 'px', top: (e.clientY - R.top - d.oy) + 'px', width: Math.min(d.w, 240) + 'px' });
    if (!DK.hl) { DK.hl = document.createElement('div'); DK.hl.className = 'mx-hl mw-el'; DK.root.appendChild(DK.hl); }
    let r = null;
    if (t.type === 'root') { const W = 240, H = 200; r = t.side === 'w' ? [0, 0, W, R.height] : t.side === 'e' ? [R.width - W, 0, W, R.height] : t.side === 'n' ? [0, 0, R.width, H] : [0, R.height - H, R.width, H]; }
    else if (t.type === 'tab') r = [t.rect.left - R.left, t.rect.top - R.top, t.rect.width, t.rect.height];
    else if (t.type === 'side') { const q = t.rect, x = q.left - R.left, y = q.top - R.top; r = t.side === 'w' ? [x, y, q.width / 2, q.height] : t.side === 'e' ? [x + q.width / 2, y, q.width / 2, q.height] : t.side === 'n' ? [x, y, q.width, q.height / 2] : [x, y + q.height / 2, q.width, q.height / 2]; }
    DK.hl.style.display = r ? '' : 'none';
    DK.hl.classList.toggle('mx-tabhl', t.type === 'tab');
    if (r) Object.assign(DK.hl.style, { left: r[0] + 'px', top: r[1] + 'px', width: r[2] + 'px', height: r[3] + 'px' });
  }
  // 끌던 것을 원래 자리에서 빼서 새 묶음(또는 그 묶음 그대로)으로
  function dkTake(d) {
    if (d.single) { d.g.t = d.g.t.filter((t) => t !== d.pid); if (d.g.a === d.pid) d.g.a = d.g.t[0]; return { k: 'g', id: dkUid(), t: [d.pid], a: d.pid }; }
    const f = dkFloatOf(d.g);
    if (f) DK.lay.fl.splice(DK.lay.fl.indexOf(f), 1);
    else { const pi = dkParentOf(d.g); if (pi && pi.parent) { const keep = { k: 'g', id: 'x', t: [], a: null }; pi.parent.c[pi.index] = keep; } }
    return d.g;
  }
  function dkDrop(d, t, e) {
    if ((t.type === 'tab' || t.type === 'side') && t.g === d.g && !d.single) return; // 자기 자신 위
    const R = d.R;
    const size = (H) => Math.round(Math.min(H ? 300 : 260, Math.max(DOCK_MIN + 40, H ? d.w : d.h)));
    if (t.type === 'float') {
      const f = dkFloatOf(d.g);
      if (f && !d.single) { f.x = e.clientX - R.left - d.ox; f.y = e.clientY - R.top - d.oy; return; }
      const g = dkTake(d);
      DK.lay.fl.push({ g, x: e.clientX - R.left - Math.min(d.ox, 120), y: e.clientY - R.top - d.oy, w: Math.max(160, Math.round(d.w)), h: Math.max(120, Math.round(d.h)) });
      return;
    }
    if (t.type === 'tab') {
      if (t.g === d.g) return;
      const g = dkTake(d);
      t.g.t.push(...g.t); t.g.a = d.single ? d.pid : g.a;
      return;
    }
    if (t.type === 'side') {
      if (t.g === d.g) return;
      const tf = dkFloatOf(t.g);
      const g = dkTake(d);
      if (tf) { t.g.t.push(...g.t); t.g.a = g.a; return; } // 떠 있는 창 옆 붙이기 → 탭으로
      const dir = t.side === 'w' || t.side === 'e' ? 'h' : 'v', first = t.side === 'w' || t.side === 'n';
      const pi = dkParentOf(t.g);
      const sz = Math.round((dir === 'h' ? t.rect.width : t.rect.height) / 2);
      if (pi && pi.parent && pi.parent.d === dir) {
        const P = pi.parent, i = P.c.indexOf(t.g), at = first ? i : i + 1;
        P.c.splice(at, 0, g); P.z.splice(at, 0, sz);
        if (P.f >= at) P.f++;
        const ti = P.c.indexOf(t.g); if (ti !== P.f) P.z[ti] = Math.max(DOCK_MIN, P.z[ti] - sz);
      } else {
        const node = { k: 's', d: dir, c: first ? [g, t.g] : [t.g, g], z: first ? [sz, sz] : [sz, sz], f: first ? 1 : 0 };
        if (pi && pi.parent) pi.parent.c[pi.index] = node; else DK.lay.root = node;
      }
      return;
    }
    if (t.type === 'root') {
      const g = dkTake(d);
      const dir = t.side === 'w' || t.side === 'e' ? 'h' : 'v', first = t.side === 'w' || t.side === 'n';
      const root = DK.lay.root, sz = size(dir === 'h');
      if (root.k === 's' && root.d === dir) {
        if (first) { root.c.unshift(g); root.z.unshift(sz); root.f++; } else { root.c.push(g); root.z.push(sz); }
      } else DK.lay.root = { k: 's', d: dir, c: first ? [g, root] : [root, g], z: [sz, sz], f: first ? 1 : 0 };
    }
  }
  // ---- Window 메뉴 (위쪽 막대) ----
  const WIN_SVG = '<path fill="currentColor" d="M64 64h384a32 32 0 0 1 32 32v320a32 32 0 0 1-32 32H64a32 32 0 0 1-32-32V96a32 32 0 0 1 32-32zm0 96v256h112V160zm144 0v256h240V160zM64 96v32h384V96z"/>';
  function dkEnsureMenuBtn() {
    const host = document.querySelector('editor-menu .menu-items');
    if (!host) return;
    if (DK.menuBtn && DK.menuBtn.isConnected && DK.menuBtn.parentNode === host) return;
    DK.menuBtn?.remove();
    const tpl = host.querySelector('button.dropdown-toggle');
    const wrap = document.createElement('div'); wrap.className = 'dropdown mx-winbtn mw-el';
    const b = document.createElement('button'); b.type = 'button';
    b.className = tpl ? tpl.className.replace(/\b(active|show)\b/g, '') : 'dropdown-toggle no-arrow menu-dropdown md';
    b.title = L('Window — 패널·화면 배치', 'Window — panels & layout');
    b.innerHTML = `<svg viewBox="0 0 512 512" width="19" height="19" class="svg-icon">${WIN_SVG}</svg>`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dkToggleMenu(b); });
    wrap.appendChild(b); host.appendChild(wrap); DK.menuBtn = wrap;
  }
  function dkCloseMenu() { DK.menu?.remove(); DK.menu = null; if (DK.menuClose) { window.removeEventListener('pointerdown', DK.menuClose, true); DK.menuClose = null; } }
  function dkToggleMenu(btn) {
    if (DK.menu) { dkCloseMenu(); return; }
    const m = document.createElement('div'); m.className = 'dropdown-menu show mx-winmenu mw-el';
    const r = btn.getBoundingClientRect();
    Object.assign(m.style, { position: 'fixed', left: r.left + 'px', top: (r.bottom + 4) + 'px', right: 'auto', zIndex: 100000 });
    const head = (t) => { const h = document.createElement('div'); h.className = 'dropdown-header'; h.textContent = t; m.appendChild(h); };
    const div = () => { const h = document.createElement('div'); h.className = 'dropdown-divider'; m.appendChild(h); };
    const item = (text, on, fn, disabled) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'dropdown-item mx-wi';
      b.innerHTML = `<span class="mx-chk">${on ? '✓' : ''}</span><span></span>`; b.lastChild.textContent = text;
      if (disabled) { b.disabled = true; b.classList.add('disabled'); }
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dkCloseMenu(); setTimeout(fn, 60); }); // 이 클릭이 다 끝난 뒤에 (Magma 설정 창이 '바깥 클릭'으로 바로 닫히지 않게)
      m.appendChild(b);
    };
    const cfg = dkLoadCfg();
    if (DK.on) {
      head(L('패널', 'Panels'));
      const shown = new Set(dkAllGroups().flatMap((g) => g.t));
      for (const p of DOCK_PANELS) item(dkTitle(p), shown.has(p.id), () => dkTogglePanel(p.id), !dkHasContent(p.id) && !shown.has(p.id));
      div();
    }
    head(L('화면 모드', 'Screen mode'));
    const cur = localStorage.getItem('settings-sliders') || 'full';
    for (const [v, t] of [['super-simple', 'Super Simple'], ['simple', 'Simple'], ['full', 'Full']]) item(t, cur === v, () => dkLayoutOption(t + ' mode'));
    const er = document.querySelector('.editor-right');
    item(L('브러시 목록', 'Brush list'), !!(er && er.classList.contains('has-brush-list')), () => dkLayoutOption('Brush list'));
    item(L('두 줄', 'Two columns'), !!document.querySelector('.has-two-columns'), () => dkLayoutOption('Two columns'));
    head(L('색상환', 'Color wheel'));
    let wheel = 'square'; try { wheel = (JSON.parse(localStorage.getItem('settings') || '{}').colorWheelMode) || 'square'; } catch { /* 무시 */ }
    for (const t of ['Square', 'Triangle']) item(t === 'Square' ? L('사각형', 'Square') : L('삼각형', 'Triangle'), wheel === t.toLowerCase(), () => dkLayoutOption(t));
    head(L('확장 언어', 'Extension language'));
    let lv = 'auto'; try { lv = JSON.parse(localStorage.getItem('magmaWand.settings') || '{}').lang || 'auto'; } catch { /* 무시 */ }
    item(L('자동 (Magma 계정 언어)', 'Auto (Magma account language)'), lv === 'auto', () => setExtLang('auto'));
    item('한국어', lv === 'ko', () => setExtLang('ko'));
    item('English', lv === 'en', () => setExtLang('en'));
    div();
    if (DK.on) item(L('배치 처음으로 (이 모드)', 'Reset layout (this mode)'), false, () => dkResetLayout());
    item(DK.on ? L('사용자 지정 UI 끄기 (원래 화면)', 'Turn off custom UI (original layout)') : L('사용자 지정 UI 켜기', 'Turn on custom UI'), false, () => { cfg.on = !DK.on; if (cfg.on) DK.failed = false; dkSave(true); if (cfg.on) dkStart(); else dkStop(); });
    document.body.appendChild(m); DK.menu = m;
    const close = (e) => { if (DK.menu === m && !m.contains(e.target) && !btn.contains(e.target)) dkCloseMenu(); };
    DK.menuClose = close;
    setTimeout(() => { if (DK.menuClose === close) window.addEventListener('pointerdown', close, true); }, 0);
  }
  // Magma 레이아웃 설정 창(숨긴 ⚙ 버튼)의 항목을 사용자가 누르는 것처럼 대신 누른다
  async function dkLayoutOption(label) {
    const cog = document.querySelector('button[tooltip="Layout options"]'); // 모드마다 자리가 다름 (Super Simple은 오른쪽 위 아이콘 막대)
    if (!cog) { toast('레이아웃 설정 단추를 찾지 못했어요'); return; }
    cog.click();
    let it = null;
    for (let i = 0; i < 20 && !it; i++) { await sleep(30); it = [...document.querySelectorAll('.dropdown-menu.show .dropdown-item')].find((b) => b.textContent.replace(/\s+/g, ' ').trim().startsWith(label)); }
    if (it) it.click();
    await sleep(60);
    if (document.querySelector('.dropdown-menu.show') && cog.getAttribute('aria-expanded') === 'true') cog.click();
  }
  function dkTogglePanel(id) {
    const groups = dkAllGroups(), g = groups.find((x) => x.t.includes(id));
    DK.lay.h = DK.lay.h || [];
    if (g) { g.t = g.t.filter((t) => t !== id); if (g.a === id) g.a = g.t[0]; DK.lay.h.push(id); DK.lay.root = dkNorm(DK.lay.root) || { k: 'c' }; DK.lay.fl = DK.lay.fl.filter((f) => f.g.t.length); }
    else {
      DK.lay.h = DK.lay.h.filter((t) => t !== id);
      const R = DK.root.getBoundingClientRect();
      DK.lay.fl.push({ g: { k: 'g', id: dkUid(), t: [id], a: id }, x: Math.round(R.width / 2 - 130), y: 60, w: 260, h: 300 });
    }
    dkRender(); dkSave();
  }
  // 이 모드의 처음 배치: 잠깐 원래 자리로 돌려 Magma가 놓은 자리를 다시 잰다
  async function dkResetLayout() {
    dkRestoreNodes();
    await nextFrame(); await nextFrame();
    const lay = dkMeasureDefault() || dkFallbackDefault();
    DK.cfg.D[DK.mode] = lay;
    DK.lay = JSON.parse(JSON.stringify(lay));
    dkAdopt(); dkEnsureAll(); dkRender(); dkSave(true);
  }
  // ---- 켜기·끄기 ----
  function dkStart() {
    if (DK.on || DK.failed) return;
    const box = document.querySelector('editor-box'), top = document.querySelector('.editor-top');
    if (!box || !document.querySelector('.editor-right') || !document.querySelector('.editor-left')) return;
    try {
      dkLoadCfg();
      DK.mode = dkModeKey();
      // 처음 켤 때(이 모드의 기본값이 없으면) 요소가 원래 칸에 있을 때 잰다
      if (!DK.cfg.D[DK.mode]) DK.cfg.D[DK.mode] = dkMeasureDefault() || dkFallbackDefault();
      const saved = DK.cfg.L[DK.mode];
      DK.lay = JSON.parse(JSON.stringify(dkValid(saved) ? saved : DK.cfg.D[DK.mode]));
      DK.lay.fl = DK.lay.fl || []; DK.lay.h = DK.lay.h || [];
      DK.root = document.createElement('div'); DK.root.className = 'mx-dock mw-el';
      { const er = document.querySelector('.editor-right'), cs = er && getComputedStyle(er); if (cs) { DK.root.style.setProperty('--mx-bg', cs.backgroundColor); DK.root.style.setProperty('--mx-bd', cs.borderLeftColor); } }
      DK.root.style.top = (top ? Math.round(top.getBoundingClientRect().height) : 43) + 'px';
      DK.hold = document.createElement('div'); DK.hold.className = 'mx-hold'; DK.root.appendChild(DK.hold);
      box.appendChild(DK.root);
      DK.on = true;
      dkAdopt();
      if (!dkHasContent('color') || !dkHasContent('layers') || !dkHasContent('tools')) throw new Error('Magma 화면 조각을 찾지 못함');
      dkEnsureAll();
      dkRender();
      document.documentElement.classList.add('mx-dock-on');
      window.dispatchEvent(new Event('resize'));
      dkSave();
    } catch (e) { dkFail(e); }
  }
  function dkStop() {
    if (!DK.on) return;
    try { dkSave(true); } catch { /* 무시 */ }
    DK.on = false;
    try { dkRestoreNodes(); } catch (e) { console.warn('[MagmaWand] 패널 되돌리기', e); }
    document.documentElement.classList.remove('mx-dock-on', 'mx-uihidden');
    for (const k of ['--mx-t', '--mx-r', '--mx-b', '--mx-l']) document.documentElement.style.removeProperty(k);
    DK.root?.remove(); DK.root = null; DK.hold = null; DK.frames.clear(); DK.sig = ''; DK.pb = {};
    DK.hl?.remove(); DK.hl = null;
    window.dispatchEvent(new Event('resize'));
  }
  // 오류(Magma 업데이트·드물게 쓰는 화면과 충돌 등) → 화면 배치만 원래 Magma로 되돌린다. 확장의 다른 기능은 그대로 쓴다.
  // 이 모드의 저장된 배치가 원인일 수 있으니 기본 배치로 비워 두고, 이번 화면에서는 다시 켜지 않는다(Window 메뉴로 다시 켤 수 있음).
  function dkFail(e) {
    if (DK.failed) return;
    console.warn('[MagmaWand] 사용자 지정 UI 오류 → 원래 화면으로', e);
    DK.failed = true;
    try { if (DK.cfg && DK.mode) { delete DK.cfg.L[DK.mode]; delete DK.cfg.D[DK.mode]; } } catch { /* 무시 */ }
    const lay = DK.lay; DK.lay = null;
    try { dkStop(); } catch { /* 무시 */ }
    try { localStorage.setItem(DOCK_KEY, JSON.stringify(DK.cfg)); } catch { /* 무시 */ }
    DK.lay = lay && null;
    toast(L('화면 배치에 문제가 생겨 원래 Magma 화면으로 돌렸어요. 다른 기능은 그대로 쓸 수 있어요 (Window 메뉴에서 다시 켜기)', 'The custom layout hit a problem, so the original Magma layout is back. Everything else still works (turn it on again from the Window menu).'));
  }
  // 400ms마다: 새로 생긴 Magma 요소 옮기기 · 모드가 바뀌면 그 모드의 배치로 · 다시 그리기
  function dkTick() {
    if (!document.querySelector('editor-box')) { if (DK.on) dkStop(); return; }
    dkEnsureMenuBtn();
    const cfg = dkLoadCfg();
    // 오른쪽 기둥·왼쪽 도구 막대가 있는 보통 배치에서만 패널로 다룬다. Super Simple 모드·Tab으로 UI를 숨긴 동안은
    // 옮긴 조각을 원래 자리로 돌려 Magma 화면을 그대로 쓰고(배치는 저장), 보통 배치로 돌아오면 다시 씌운다.
    const er = document.querySelector('.editor-right'), el = document.querySelector('.editor-left');
    const std = !!(er && el && getComputedStyle(er).display !== 'none' && getComputedStyle(el).display !== 'none');
    if (!DK.on) { if (cfg.on && !DK.failed && std) dkStart(); return; }
    if (!std) { dkStop(); return; }
    try {
      if (!DK.root.isConnected) { const box = document.querySelector('editor-box'); if (box) box.appendChild(DK.root); }
      const mode = dkModeKey();
      if (mode !== DK.mode) {
        // Magma가 화면 모드를 바꿈: 지금 배치는 이전 모드에 저장, 새 모드는 저장된 배치(없으면 다시 재서)로
        DK.cfg.L[DK.mode] = DK.lay; dkSave(true);
        DK.mode = mode;
        if (!DK.cfg.D[mode] || !dkValid(DK.cfg.L[mode])) { dkResetLayout(); return; }
        DK.lay = JSON.parse(JSON.stringify(DK.cfg.L[mode])); DK.lay.fl = DK.lay.fl || []; DK.lay.h = DK.lay.h || [];
      }
      dkAdopt(); dkEnsureAll(); dkRender();
      // 안전장치: 숨긴 원래 칸에 처음 보는 Magma 조각이 남아 있으면(Magma 업데이트 등) 안 보이게 갇히지 않도록 원래 화면으로
      const left = [...document.querySelectorAll('.editor-right *, .editor-left *')].filter((el) => el.tagName.includes('-') && !el.closest('.mx-pbody') && !el.closest('.mw-el') && el.getBoundingClientRect().width > 0);
      if (left.length) dkFail(new Error('처음 보는 화면 조각: ' + left.slice(0, 3).map((x) => x.tagName.toLowerCase()).join(', ')));
    } catch (e) { dkFail(e); }
  }
  on(window, 'resize', () => { if (DK.on) dkRender(); });
  cleanups.push(() => { dkCloseMenu(); DK.menuBtn?.remove(); dkStop(); });


  // ---------- 영어 화면: 확장이 만든 화면의 한국어 글자를 영어로 바꿔 끼운다 ----------
  // 확장이 만든 요소(.mw-…, .mx-…) 안의 글자·title·placeholder만 바꾸고, 원문은 기억해 두었다가 한국어로 돌아가면 되돌린다.
  // 저장되는 값(브러시 분류·프리셋 이름 등)은 그대로 한국어라서 기능에는 영향이 없다.
  const I18N_EN = /*I18N_EN*/{"현재 레이어를 찾지 못했어요":"Couldn't find the current layer","화면을 읽지 못했어요 (Magma 창이 가려져 있지 않은지 확인해 주세요)":"Couldn't read the screen (make sure the Magma window isn't covered)","그림판 밖을 눌렀어요":"You clicked outside the canvas","보드 바깥을 눌렀어요":"You clicked outside the board","영역을 만들지 못했어요":"Couldn't create the area","클립보드 기능을 쓸 수 없어요":"Clipboard isn't available","현재 레이어 참조: 선택이 있는 상태에서는 레이어를 새로 읽을 수 없어요. 선택을 해제하고 한 번 클릭한 뒤 이어서 쓰세요":"Current layer reference: the layer can't be re-read while there's a selection. Deselect, click once, then continue","현재 레이어를 읽지 못했어요":"Couldn't read the current layer","현재 레이어가 비어 있어요":"The current layer is empty","현재 레이어 위치를 읽지 못했어요":"Couldn't read the current layer's position","현재 레이어 크기가 맞지 않아요":"The current layer's size doesn't match","화면 위치 정보를 읽지 못했어요":"Couldn't read the screen position info","화면을 회전하거나 뒤집은 상태에서는 현재 레이어 참조를 쓸 수 없어요":"Current layer reference doesn't work while the view is rotated or flipped"," · 작은 조각 ${P.dropped}개는 점이 너무 많아 뺐어요":" · Left out ${P.dropped} small pieces that had too many points"," · 테두리가 복잡해 조금 매끈하게 그었어요":" · The outline was complex, so it was smoothed a little"," · 선 위를 눌러 빈틈 닫기 없이 했어요":" · You clicked on a line, so gap closing was skipped","그림판 화면을 찾지 못했어요":"Couldn't find the canvas view","영역 계산 중…":"Calculating area…","올가미 채우기 도구로 바꾸지 못했어요":"Couldn't switch to the Lasso fill tool","안전을 위해 멈췄어요: 올가미 채우기를 그리기 모드로 바꾸지 못했어요":"Stopped for safety: couldn't switch Lasso fill to draw mode","마법봉 선택":"Magic Wand selection",", 테두리 ${R.pieces}개":", ${R.pieces} outlines",", 구멍 ${holes}개":", ${holes} holes","${fill ? '채움' : '선택'}: ${count.toLocaleString()}픽셀${parts} (${(ms / 1000).toFixed(1)}초)":"${fill ? '채움' : '선택'}: ${count.toLocaleString()} px${parts} (${(ms / 1000).toFixed(1)}s)"," · 화면 기준":" · based on screen","오류: ":"Error: ","화면을 회전·뒤집은 상태에서는 현재 레이어 참조를 쓸 수 없어요":"Current layer reference doesn't work while the view is rotated/flipped","빼는 중… (손을 떼면 확정)":"Subtracting… (release to confirm)","선택 중… (손을 떼면 확정)":"Selecting… (release to confirm)","취소했어요":"Canceled","${Q.subtract ? '뺌' : '선택'}: ${count.toLocaleString()}픽셀":"${Q.subtract ? '뺌' : '선택'}: ${count.toLocaleString()} px","브러시 크기 ${BSZ.size}":"Brush size ${BSZ.size}","클립 스튜디오 브러시(.sut) 파일이 아니에요":"This isn't a Clip Studio brush (.sut) file","브러시 설정을 찾지 못했어요":"Couldn't find the brush settings","브러시":"Brush","합성 모드(${num(v.CompositeMode, 0)}번)는 '보통'으로 그려요 — 지우개 브러시면 ⚙ 설정 → 잉크 → 합성 모드에서 '지우기'":"Blend mode #${num(v.CompositeMode, 0)} draws as 'Normal' — for an eraser brush, set ⚙ Settings → Ink → Blend mode to 'Erase'","셰이더: ":"Shader: ","셰이더 연결: ":"Shader link: ","WebGL2를 쓸 수 없어요":"WebGL2 isn't available","'${brush.name}'의 필압·속도 곡선을 예전 버전이 잘못 읽었어요 — 지금은 곧은 곡선으로 그려요. .sut를 다시 가져오면 원래 곡선대로 돼요":"An older version misread the pressure/speed curves of '${brush.name}' — it now draws with straight curves. Re-import the .sut to get the original curves","수채":"Watercolor","숨겨진 레이어에는 그릴 수 없어요 — 레이어의 눈 아이콘을 켜 주세요":"You can't draw on a hidden layer — turn on the layer's eye icon","잠긴 레이어에는 그릴 수 없어요 — 레이어 잠금을 풀어 주세요":"You can't draw on a locked layer — unlock the layer","지우지 못했어요: ":"Couldn't erase: ","획을 보드에 넣지 못했어요: ":"Couldn't add the stroke to the board: ","칠하지":"Paint","브러시를 준비하지 못했어요: ":"Couldn't prepare the brush: ","먼저 오른쪽 설정 칸에서 브러시(.sut)를 가져와 주세요":"First import a brush (.sut) in the settings panel on the right","이 브러시는 지우개·특수 합성이라 아직 쓸 수 없어요":"This brush is an eraser/special blend, so it can't be used yet","이 브러시는 끝 모양 PNG가 필요해요 — 설정 칸의 \"끝 모양 PNG 넣기\"를 눌러 주세요":"This brush needs a tip shape PNG — click \"Add tip shape PNG\" in the settings panel","그릴 레이어를 먼저 골라 주세요":"Pick a layer to draw on first","글자 레이어에는 그릴 수 없어요 — 그림 레이어를 골라 주세요":"You can't draw on a text layer — pick a drawing layer","주의: Magma 설정 \"붙여넣기를 새 레이어로\"가 켜져 있어 획마다 새 레이어가 생겨요":"Note: Magma's \"Paste as new layer\" setting is on, so every stroke creates a new layer","＋ 브러시 가져오기 (.sut)":"＋ Import Brush (.sut)","＋ 기본 브러시":"＋ Basic Brush","클립 스튜디오 파일 없이, 기본 끝 모양으로 새 브러시를 만들어요":"Create a new brush with a basic tip shape — no Clip Studio file needed","끝 모양 바꾸기":"Change Tip Shape","⚙ 브러시 설정":"⚙ Brush Settings","크기·잉크·색 혼합(물감 섞기)·끝 모양·획·스프레이·텍스처·색 흔들기를 하나하나 바꿔요":"Adjust size, ink, color mixing (paint mixing), tip shape, stroke, spray, texture and color jitter one by one","지우기":"Delete","＋ 새 브러시 (프리셋)":"＋ New Brush (Preset)","연필·G펜·수채·유화(물감 섞기)·손끝·에어브러시·스프레이 등 프리셋으로 새 브러시를 만들어요":"Create a new brush from presets like pencil, G-Pen, watercolor, oil (paint mixing), finger blend, airbrush, spray and more","브러시 ${files.length - fails}개를 가져왔어요":"Imported ${files.length - fails} brushes"," — 끝 모양 PNG가 필요한 브러시가 있어요":" — some brushes need a tip shape PNG","한 번 더 누르면 지워요":"Click again to delete","브러시가 없어요. \"＋ 새 브러시 (프리셋)\"으로 만들거나 클립 스튜디오 브러시 파일(.sut)을 가져오세요.":"No brushes yet. Make one with \"＋ New Brush (Preset)\" or import a Clip Studio brush file (.sut).","⚠ 보호된 소재 ${need}개: \"끝 모양 바꾸기\"에서 기본 모양을 고르거나, CSP에서 PNG로 저장해 넣어 주세요":"⚠ ${need} protected materials: pick a basic shape in \"Change Tip Shape\", or save them as PNG in CSP and add them","아직 안 되는 기능: ${cur.unsupported.join(', ')} (나머지 설정으로 그려요)":"Not supported yet: ${cur.unsupported.join(', ')} (drawing with the other settings)","끝 모양·텍스처":"Tip Shape & Texture","기본 모양":"Basic shapes","을 누르면 준비된 모양 중에서 고를 수 있어요. 내 그림을 쓰려면":"lets you pick from ready-made shapes. To use your own image, add it with","PNG 고르기":"Choose PNG","로 넣어요(검은 그림 + 투명 배경).\n        클립 스튜디오의 보호된 소재는 CSP에서 캔버스에 붙여 PNG로 저장한 뒤 넣으면 똑같이 쓸 수 있어요.":"(black drawing + transparent background).\n        Protected Clip Studio materials work the same way: paste them onto a canvas in CSP, save as PNG, then add them.","닫기":"Close","끝 모양 ${i + 1}":"Tip shape ${i + 1}","2중 브러시 끝 모양":"Dual brush tip shape","텍스처":"Texture","없음":"None","모양 필요 (미리보기는 소재 썸네일)":"Shape needed (preview is the material thumbnail)","준비됨":"Ready","기본 모양: ":"Basic shape: ","모양을 넣지 못했어요: ":"Couldn't add the shape: ","바꾸기":"Change","그림을 열지 못했어요: ":"Couldn't open the image: ","필압":"Pressure","속도":"Speed","무작위":"Random","먼저 브러시를 골라 주세요":"Pick a brush first","브러시 설정 — ":"Brush Settings — ","  ${t} 최소":"  ${t} min","크기":"Size","브러시 크기":"Brush size","크기 효과":"Size dynamics","필압 곡선":"Pressure curve","필압 곡선: 100보다 작으면 살살 눌러도 굵고 진하게, 크면 세게 눌러야 굵어져요(펜에만 적용).":"Pressure curve: below 100, light pressure gives thick, dark lines; above 100, you have to press harder to get thick lines (pen only).","잉크":"Ink","불투명도":"Opacity","불투명도 효과":"Opacity dynamics","흐름(밀도)":"Flow (density)","흐름 효과":"Flow dynamics","안티에일리어스":"Anti-aliasing","합성 모드":"Blend mode","보통":"Normal","물감 겹치기":"Glaze","곱하기":"Multiply","물감 겹치기: 투명한 물감을 덧칠한 것처럼 감산 혼합돼요(노랑 위에 파랑 = 초록, 수채). 곱하기: 화면 곱하기라 겹칠수록 어둡고 탁해요(마커). 지우기: 이 브러시 모양 그대로 지우개가 돼요. 같은 레이어 안의 그림과 섞여요.":"Glaze: blends subtractively, like layering transparent paint (blue over yellow = green, watercolor). Multiply: screen multiply, so overlaps get darker and muddier (marker). Erase: the brush becomes an eraser with this exact shape. Mixes with the drawing on the same layer.","수채 경계":"Watercolor edge","수채 경계 켜기":"Enable watercolor edge","범위":"Range","투명도 영향":"Opacity influence","명도 영향":"Brightness influence","물이 마르면서 가장자리에 물감이 고인 것처럼 획 테두리 안쪽을 진하게 해요. 그리는 동안에도 결과와 똑같이 보여요.":"Darkens the inside of the stroke's edge, as if paint pooled at the rim while drying. Looks the same while you draw as in the final result.","물감":"Paint","붓털 켜기":"Enable bristles","붓 모양":"Brush shape","둥근 붓":"Round brush","평붓":"Flat brush","털 수":"Bristle count","털 결 세기":"Bristle texture strength","털마다 색 차이":"Per-bristle color variation","붓털: 털마다 물감을 따로 묻혀 끊김 없는 결이 남아요. 획 탭의 \\'물감 마름\\'을 같이 쓰면 길게 그을수록 털이 하나씩 말라 갈라져요. 끝 모양·각도 설정 대신 쓰여요.":"Bristles: each bristle carries its own paint, leaving a continuous texture. Combine with \\'Paint dry-out\\' in the Stroke tab and the bristles dry and split one by one the longer you drag. Used instead of the tip shape and angle settings.","두께감":"Impasto","광택":"Gloss","두께감: 물감이 두껍게 올라온 것처럼 붓 자국 굴곡에 왼쪽 위 빛과 그림자를 넣어요(0 = 끔). 광택이 높을수록 유화처럼 반짝여요.":"Impasto: adds light from the upper left and shadows to the brushstroke ridges, as if the paint is built up thick (0 = off). Higher gloss makes it shine like oil paint.","젖은 물감(수채)":"Wet paint (watercolor)","가장자리 흔들림":"Edge wobble","가장자리 풀림":"Edge bleed","안료 알갱이":"Pigment granulation","젖은 물감: 물이 닿은 경계가 또렷하고 구불구불해져요. 풀림을 올리면 젖은 종이처럼 번지고, 알갱이는 종이 골에 안료가 가라앉은 오돌토돌함이에요. 수채 경계와 함께 쓰면 좋아요.":"Wet paint: edges where the water reaches become crisp and wavy. Raise bleed to spread like wet paper; granulation is the bumpy look of pigment settling into the paper grooves. Works well with watercolor edge.","색 혼합":"Color mixing","블렌드":"Blend","물감 섞기":"Paint mixing","물감량":"Paint amount","물감량 효과":"Paint amount dynamics","물감 농도":"Paint density","물감 농도 효과":"Paint density dynamics","색 늘이기":"Color stretch","섞을 밑색":"Mix with","현재 레이어":"Current layer","보이는 그림":"Visible image","물감량 100 = 메인 색만 · 0 = 밑색만 끌고 다님(손끝). 물감 농도가 낮을수록 묽게, 색 늘이기가 클수록 끌고 온 색이 길게 남아요.":"Paint amount 100 = main color only · 0 = drags only the underlying color (finger blend). Lower paint density = thinner paint; higher color stretch = the dragged color lasts longer.","끝 모양":"Tip shape","경도(원형일 때)":"Hardness (round tip)","두께":"Thickness","두께 방향":"Thickness direction","가로":"Horizontal","세로":"Vertical","두께 효과":"Thickness dynamics","각도":"Angle","각도: 필압":"Angle: pressure","각도: 진행 방향":"Angle: direction","각도: 무작위":"Angle: random","  무작위 정도":"  Randomness","좌우 반전":"Flip horizontal","반전":"Flip","상하 반전":"Flip vertical","여러 모양 순서":"Multiple tip order","차례":"Sequential","왕복":"Back and forth","획":"Stroke","간격":"Spacing","간격 효과":"Spacing dynamics","손떨림 보정":"Stabilizer","입(시작 가늘게)":"Start taper","출(끝 가늘게)":"End taper","리본(끝 모양을 띠처럼 늘이기)":"Ribbon (stretch the tip like a band)","흩어짐":"Scatter","물감 마름(길이)":"Paint dry-out (length)","  마른 뒤 남는 양":"  Amount left when dry","물감 마름: 그 길이만큼 그으면 붓의 물감이 줄어 획이 갈라져요(갈필). 0이면 꺼짐.":"Paint dry-out: after dragging this far, the brush runs low on paint and the stroke splits (dry brush). 0 = off.","스프레이":"Spray","스프레이 켜기":"Enable spray","입자 크기":"Particle size","입자 크기를 브러시 크기에 맞춤":"Match particle size to brush size","입자 크기 효과":"Particle size dynamics","입자 수":"Particle count","입자 수 효과":"Particle count dynamics","가운데로 모임":"Gather to center","텍스처를 쓰고 있어요":"Using a texture","텍스처 없음 — 아래 단추로 고르세요":"No texture — pick one with the button below","농도":"Density","배율":"Scale","농도 강조":"Density boost","결 방식":"Grain mode","무늬 덮기":"Overlay pattern","깊이":"Depth","골에 남는 가루(깊이)":"Powder left in grooves (depth)","깊이: 종이 결을 높낮이로 써요. 살살 칠하면 높은 곳에만 묻고, 세게·여러 번 칠할수록 골까지 채워져요(연필·목탄·파스텔). 농도 = 골 깊이.":"Depth: uses the paper grain as height. Light strokes only touch the high spots; pressing harder or layering fills the grooves too (pencil, charcoal, pastel). Density = groove depth.","도장마다 적용(끄면 획 전체에, 깊이 방식은 늘 획 전체)":"Apply per stamp (off = whole stroke; depth mode always applies to the whole stroke)","2중 브러시":"Dual brush","이 브러시에는 2중 브러시가 없어요. 클립 스튜디오 브러시(.sut)에 2중 브러시가 있으면 여기서 바꿀 수 있어요.":"This brush has no dual brush. If a Clip Studio brush (.sut) has one, you can change it here.","2중 브러시 쓰기":"Use dual brush","흐름":"Flow","흩뿌리기":"Scatter","두 번째 끝 모양으로 찍은 무늬 안쪽만 남겨서 거친 질감을 만들어요.":"Keeps only the inside of the pattern stamped with the second tip shape, for a rough texture.","색 흔들기":"Color jitter","색상":"Hue","채도":"Saturation","명도":"Brightness","도장마다 색을 이만큼 흔들어요(반짝이·잎 같은 브러시에 좋아요).":"Jitters the color this much per stamp (great for brushes like glitter or leaves).","이름·관리":"Name & Manage","이름":"Name","분류":"Category","끝 모양·텍스처 바꾸기…":"Change tip shape & texture…","이 브러시 복제":"Duplicate this brush"," 사본":" copy","연필·스케치":"Pencil & Sketch","잉크·펜":"Ink & Pen","마커":"Marker","드라이 (목탄·파스텔)":"Dry (Charcoal & Pastel)","물감 (유화·구아슈)":"Paint (Oil & Gouache)","섞기·문지르기":"Blend & Smudge","에어브러시":"Airbrush","질감·특수":"Texture & Special","장식·자연":"Decoration & Nature","HB 연필":"HB Pencil","단단하고 옅은 선. 살살 그으면 종이 이에만 걸려요":"Hard, light lines. Light strokes catch only the paper's tooth","4B 연필":"4B Pencil","부드럽고 진한 흑연. 눌러 칠하면 결이 메워져요":"Soft, dark graphite. Press hard to fill in the grain","8B 연필":"8B Pencil","아주 무른 연필. 진하고 번들거리는 검정":"A very soft pencil. Dark, shiny black","샤프":"Mechanical Pencil","가늘고 일정한 밑그림 선":"Thin, even sketch lines","색연필":"Colored Pencil","색이 종이 결에 걸리는 밀랍 질감, 겹쳐 칠해 진하게":"Waxy texture where color catches the paper grain; layer it to darken","연필 눕혀 칠하기":"Pencil (side)","연필을 눕혀 넓게 음영 넣기":"Lay the pencil on its side for broad shading","목탄 연필":"Charcoal Pencil","거칠고 깊은 검정, 결이 가로로 비쳐요":"Rough, deep black with horizontal grain showing through","G펜":"G-Pen","필압으로 굵기가 바뀌는 매끈한 펜 선":"Smooth pen lines whose width changes with pressure","마루펜":"Maru Pen","가늘고 단단한 펜. 세밀한 선":"Thin, firm pen for fine lines","테크니컬 펜":"Technical Pen","굵기가 일정한 제도 펜":"Drafting pen with a constant width","붓펜":"Brush Pen","끝이 날렵한 붓펜":"Brush pen with a sharp tip","먹 붓":"Ink Brush","누르는 만큼 확 굵어지는 먹선":"Ink lines that swell sharply with pressure","마른 먹":"Dry Ink","그을수록 먹이 말라 갈라지는 붓 선":"Brush lines where the ink dries and splits as you drag","캘리그래피 펜":"Calligraphy Pen","각도가 고정된 납작 펜촉 (가로획 굵고 세로획 가늘게)":"Flat nib at a fixed angle (thick horizontal, thin vertical strokes)","펠트펜":"Felt Pen","가장자리가 살짝 번진 사인펜":"Felt-tip pen with slightly bleeding edges","사각 마커":"Chisel Marker","겹칠수록 진해지는 납작 마커":"Flat marker that darkens where strokes overlap","알코올 마커":"Alcohol Marker","부드러운 가장자리, 덧칠하면 한 단계씩 진해짐":"Soft edges; each layer darkens it one step","형광펜":"Highlighter","아래 그림이 비치는 형광 띠":"Highlighter band that lets the drawing below show through","버드나무 목탄":"Willow Charcoal","가볍고 부드러운 목탄. 손에 묻어나듯 결이 많이 남아요":"Light, soft charcoal. Leaves lots of grain, like it rubs off on your hand","압축 목탄":"Compressed Charcoal","진하고 무거운 검정, 세게 누르면 꽉 메워짐":"Dark, heavy black; fills in solid when you press hard","목탄 옆면":"Charcoal (side)","목탄을 눕혀 넓게 끌기 — 큰 면과 음영":"Drag charcoal on its side — big areas and shading","콩테":"Conté","단단한 사각 스틱, 또렷한 결":"Hard square stick with crisp grain","소프트 파스텔":"Soft Pastel","가루가 날리는 부드러운 파스텔, 큰 종이 결":"Soft, dusty pastel with large paper grain","오일 파스텔":"Oil Pastel","끈적하게 밀리며 밑색과 살짝 섞이는 밀랍 파스텔":"Waxy pastel that drags stickily and mixes slightly with the color below","크레용":"Crayon","어린이 크레용처럼 오돌토돌하게":"Bumpy, like kids' crayons","분필":"Chalk","칠판 분필, 가루와 끊김":"Blackboard chalk, dusty and broken","갈필 (마른 붓)":"Dry Brush","물감이 마르며 털 자국이 갈라지는 붓 — 길게 그어 보세요":"A brush whose bristle marks split as the paint dries — try a long stroke","스펀지":"Sponge","스펀지로 두드린 구멍 숭숭한 자국":"Porous marks dabbed with a sponge","점묘":"Stippling","펜 끝으로 콕콕 찍은 점 음영":"Dot shading tapped with a pen tip","수채 둥근 붓":"Round Watercolor","가장자리에 물감이 고이는 맑은 수채":"Clear watercolor with paint pooling at the edges","수채 세필":"Fine Watercolor","작은 붓으로 그리는 가는 수채 선":"Thin watercolor lines with a small brush","수채 번짐":"Watercolor Bleed","젖은 종이에 떨어뜨린 듯 가장자리가 풀리는 수채":"Watercolor whose edges spread, as if dropped on wet paper","수채 글레이즈":"Watercolor Glaze","넓고 고르게 까는 투명한 막 — 덧칠할수록 한 겹씩 진해져요":"A wide, even transparent wash — each layer darkens it one step","수채 알갱이":"Granulating Watercolor","울트라마린처럼 안료가 종이 골에 가라앉아 오돌토돌":"Pigment settles into the paper grooves for a bumpy look, like ultramarine","마른 수채":"Dry Watercolor","물기 적은 붓이 종이 결 위로 스치는 거친 수채":"Rough watercolor from a dry brush skimming the paper grain","수채 평붓":"Flat Watercolor","넓은 면을 고르게 바르는 납작 수채 붓, 옅은 털 결":"Flat watercolor brush for even, wide areas, with faint bristle grain","수채 물 번지기":"Watercolor Water Blend","밑색을 끌어와 물로 풀어 주는 붓":"A brush that pulls the underlying color and loosens it with water","유화 둥근 붓":"Round Oil Brush","털 결이 남고 밑색과 섞이는 유화, 길게 그으면 갈라져요":"Oil paint that leaves bristle grain and mixes with the color below; splits on long strokes","유화 평붓":"Flat Oil Brush","넓은 평붓으로 물감을 밀어 바르기":"Push paint on with a wide flat brush","유화 임파스토":"Oil Impasto","물감을 두껍게 올려 붓 자국이 도드라지는 유화":"Oil paint laid on thick so the brushstrokes stand out","마른 붓 (스컴블)":"Dry Brush (Scumble)","물감 적은 붓을 문질러 털 자국만 거칠게 남기기":"Rub a brush with little paint to leave only rough bristle marks","구아슈":"Gouache","불투명하고 무광으로 고르게 덮이는 물감":"Opaque, matte paint that covers evenly","구아슈 둥근 붓":"Round Gouache","작은 면과 디테일을 납작하게 메우는 구아슈":"Gouache for filling small areas and details flat","아크릴":"Acrylic","빨리 마르는 진한 물감, 끝으로 갈수록 털 자국":"Fast-drying rich paint, with bristle marks toward the end","팔레트 나이프":"Palette Knife","칼날로 물감을 펴 바르면 가장자리에 물감 둑이 생겨요":"Spread paint with the blade and ridges of paint form at the edges","색 섞기 붓":"Color Blender","밑색을 끌며 부드럽게 섞기":"Pull the underlying color and blend softly","유화 블렌더":"Oil Blender","마른 붓으로 물감 경계를 털 결 따라 풀어 주기":"Loosen paint edges along the bristle grain with a dry brush","손끝 (문지르기)":"Finger Blend (Smudge)","색 없이 손가락으로 문지르기":"Smudge with your finger, no color","거친 문지르기":"Rough Smudge","결이 남게 문질러 펴기 (목탄·파스텔 문지르기)":"Smudge and spread while keeping the grain (for charcoal/pastel)","붓털 문지르기":"Bristle Smudge","털 결을 따라 색을 끌어 늘이기":"Drag and stretch color along the bristle grain","부드러운 에어브러시":"Soft Airbrush","아주 부드러운 그러데이션":"Very soft gradient","단단한 에어브러시":"Hard Airbrush","가장자리가 조금 더 또렷한 에어브러시":"Airbrush with slightly crisper edges","거친 에어브러시":"Rough Airbrush","알갱이가 보이는 그러데이션 (노이즈 음영)":"Gradient with visible grain (noise shading)","흩뿌린 물감 입자":"Scattered paint particles","종이결 칠":"Paper Texture","종이 결이 살아 있는 넓은 음영":"Broad shading with lively paper grain","캔버스결 칠":"Canvas Texture","캔버스 천 결이 비치는 칠":"Fill with the canvas weave showing through","그런지":"Grunge","낡고 얼룩진 질감 칠하기":"Paint a worn, stained texture","물감 튀김":"Paint Splatter","튀긴 물감 방울":"Splattered paint drops","빗금 칠":"Hatching","칠한 곳에 빗금 무늬":"Hatching pattern where you paint","망점 (스크린톤)":"Halftone (Screentone)","칠한 곳에 망점 무늬":"Halftone pattern where you paint","풀":"Grass","풀잎 무더기를 이어 찍기":"Stamp clumps of grass in a row","털 (레이크)":"Fur (Rake)","나란한 털 결을 한 번에":"Parallel fur strands in one go","털 가닥":"Hair Strands","짐승 털·머리카락 뭉치":"Clumps of animal fur or hair","잎 뿌리기":"Leaf Scatter","흩날리는 잎":"Drifting leaves","구름":"Clouds","뭉게구름 덩이":"Puffy cloud clumps","반짝이":"Sparkle","반짝이는 십자 빛":"Sparkling cross-shaped light","별 뿌리기":"Star Scatter","크기·색이 조금씩 다른 별":"Stars of slightly varying size and color","눈송이":"Snowflakes","흩날리는 눈송이":"Drifting snowflakes","연필":"Pencil","진한 연필":"Dark Pencil","유화 (물감 섞기)":"Oil (Paint Mixing)","수채 번짐 (곱하기)":"Watercolor Bleed (Multiply)","망점(스크린톤)":"Halftone (Screentone)","가져온 브러시":"Imported Brushes","내 브러시":"My Brushes","새 브러시 — 프리셋 ${ADV_PRESETS.length}종":"New Brush — ${ADV_PRESETS.length} presets","고르면 지금 색으로 새 브러시가 만들어져요":"Pick one to create a new brush in the current color","빈 브러시 (끝 모양만 고르기)":"Blank Brush (choose tip shape only)","찾기 — 예: 연필, 목탄, 수채, 결":"Search — e.g. pencil, charcoal, watercolor, grain","브러시를 만들지 못했어요: ":"Couldn't create the brush: ","전체":"All","\"${pr.name}\" 브러시를 만들었어요":"Created the \"${pr.name}\" brush","찾는 프리셋이 없어요":"No matching presets","마법봉":"Magic Wand","빠른 선택":"Quick Selection","고급 브러시":"Advanced Brush","블러":"Blur","퀵 마스크":"Quick Mask","마법봉 (Magic Wand)":"Magic Wand","빠른 선택 (Quick Selection)":"Quick Selection","고급 브러시 (CSP Brush)":"Advanced Brush (CSP Brush)","블러 (Blur)":"Blur","퀵 마스크 (Quick Mask)":"Quick Mask","투명색 전환 (Transparent Color)":"Transparent Color Toggle","아무 키 조합이나 누르세요":"Press any key combination","선택 모드를 바꾸지 못했어요":"Couldn't change the selection mode","Magma의 Copy merged(Ctrl+Shift+C)가 응답하지 않았어요":"Magma's Copy merged (Ctrl+Shift+C) didn't respond","선택 모양을 읽지 못했어요":"Couldn't read the selection shape","선택 위치 정보를 읽지 못했어요":"Couldn't read the selection position","선택 범위 ${n}px 확장":"Expand selection by ${n}px","선택 범위 ${-n}px 축소":"Shrink selection by ${-n}px","${label} 중…":"${label}…","화면 위치 정보를 읽지 못해 멈췄어요":"Stopped: couldn't read the screen position info","화면을 회전하거나 뒤집은 상태에서는 아직 쓸 수 없어요":"This doesn't work yet while the view is rotated or flipped","화면을 읽지 못했어요":"Couldn't read the screen","선택 영역이 화면에 충분히 보이도록 한 뒤 다시 해 주세요":"Make sure enough of the selection is visible on screen, then try again","화면 위치 계산이 맞지 않아 안전을 위해 멈췄어요":"Stopped for safety: the screen position calculation didn't match","${label}: 남는 영역이 없어서 선택을 해제했어요":"${label}: nothing was left, so the selection was cleared","${label} 완료":"${label} done","${grow ? '넓힐' : '좁힐'} 픽셀 수":"Pixels to ${grow ? '넓힐' : '좁힐'}","선택 범위 확장…":"Expand Selection…","선택 범위 축소…":"Shrink Selection…","작업 기록 (내 컴퓨터)…":"History (this computer)…","레이어 속성 (내 화면)…":"Layer Properties (my screen)…","저장된 그림을 찾지 못했어요":"Couldn't find the saved image","방금":"just now","${Math.round(s / 60)}분 전":"${Math.round(s / 60)} min ago","${Math.round(s / 3600)}시간 전":"${Math.round(s / 3600)} h ago","${Math.round(s / 86400)}일 전":"${Math.round(s / 86400)} d ago","오늘":"Today","보드를 연 상태에서 쓸 수 있어요":"Available while a board is open","이 컴퓨터 사용량 ${fmtMB(await histUsage())}":"Used on this computer: ${fmtMB(await histUsage())}","기록을 읽지 못했어요":"Couldn't read the history","아직 저장된 기록이 없어요. 그림을 그리면 몇 분 안에 저장돼요(지금 저장도 돼요).":"Nothing saved yet. It saves within a few minutes after you draw (or use Save now).","레이어 ${p.layers.length}개":"${p.layers.length} layers"," · ${p.changed}개 바뀜":" · ${p.changed} changed"," (빈 레이어)":" (empty layer)","복사":"Copy","복사 중…":"Copying…","복사됨":"Copied","\"${l.name}\"(${fmtTime(p.t).split(' · ')[0]})을 복사했어요 → Edit → Paste on new layer로 붙이세요":"Copied \"${l.name}\" (${fmtTime(p.t).split(' · ')[0]}) → paste it with Edit → Paste on new layer","복사하지 못했어요: ":"Couldn't copy: ","저장 중…":"Saving…","지금 저장":"Save now","지금 상태를 저장했어요":"Saved the current state","마지막 기록과 달라진 게 없어요":"Nothing has changed since the last save","이 보드 기록 지우기":"Clear this board's history","이 보드의 작업 기록을 지웠어요 (Magma 보드는 그대로예요)":"Cleared this board's history (the Magma board itself is unchanged)","지우지 못했어요":"Couldn't delete","보드가 너무 커서 레이어 스트로크를 쓸 수 없어요":"The board is too large for layer stroke","레이어를 고른 뒤 다시 열어 주세요":"Pick a layer, then open this again","\"${L.name}\" 레이어 스트로크를 지웠어요":"Removed the layer stroke from \"${L.name}\"","투명색 사용 중":"Transparent color in use","투명색":"Transparent color"," (${(S.akeys || []).map(comboText).join(', ') || '단축키 없음'}) — 누르면 지금 색과 바꿔요":" (${(S.akeys || []).map(comboText).join(', ') || '단축키 없음'}) — click to swap with the current color","투명색: 그리면 지워져요":"Transparent color: drawing erases","투명색 — 브러시가 지우개가 돼요":"Transparent color — the brush becomes an eraser","원래 색으로 돌아왔어요":"Back to the original color","올가미 채우기를 지우기 모드로 바꾸지 못했어요":"Couldn't switch Lasso fill to erase mode"," 못 했어요: ":" failed: ","지우지":"Erase","투명색 지우기":"Transparent color erase","흐리게 하지":"Blur","잠긴 레이어 획":"Locked layer stroke","투명 부분 잠금이 켜진 레이어라 지울 수 없어요":"This layer has transparent pixel lock on, so it can't be erased","선택 영역이 있으면 고급 브러시로 지울 수 없어요 — 선택을 풀고 다시 해 주세요":"The Advanced Brush can't erase while there's a selection — deselect and try again","흐리게 할 레이어를 먼저 골라 주세요":"Pick a layer to blur first","글자 레이어는 흐리게 할 수 없어요":"Text layers can't be blurred","선택 영역이 있으면 블러를 쓸 수 없어요 — 선택을 풀고 다시 해 주세요":"Blur doesn't work while there's a selection — deselect and try again","흐리게 하지 못했어요: ":"Couldn't blur: ","사각형 선택":"Rectangle Selection","타원 선택":"Ellipse Selection","올가미 선택":"Lasso Selection","리퀴파이":"Liquify","사각형":"Rectangle","타원":"Ellipse","도형":"Shapes","손 (화면 이동)":"Hand (pan)","화면 회전":"Rotate View","확대·축소":"Zoom"," — 누르면 같은 폴더 도구가 펼쳐져요":" — click to open the other tools in this group","레이어 내용 선택 메뉴를 찾지 못했어요":"Couldn't find the layer content selection menu","Magma 편집기를 찾지 못했어요":"Couldn't find the Magma editor","이 레이어를 알아보지 못했어요":"Couldn't recognize this layer","먼저 레이어 하나를 골라 주세요":"Pick a layer first","다른 사람 레이어는 함께 고를 수 없어요":"Other people's layers can't be selected together","지금 레이어는 늘 함께 바뀌어요":"The current layer always changes along with them","한 번에 함께 바꿀 수 있는 레이어는 ${MS_MAX + 1}개까지예요 (되돌리기가 15칸이라서)":"You can change up to ${MS_MAX + 1} layers together at once (undo only has 15 steps)","레이어 ${n + 1}개를 함께 골랐어요 — 변형(Ctrl+T)·이동(V)·눈·속성을 함께 바꿔요":"Selected ${n + 1} layers together — transform (Ctrl+T), move (V), visibility and properties change together","함께 고르기를 풀었어요":"Cleared multi-selection","선택을 풀지 못함":"couldn't deselect","올가미 선택으로 바꾸지 못함":"couldn't switch to Lasso selection","선택 모드를 바꾸지 못함":"couldn't change the selection mode","원래 선택을 다시 긋지 못함":"couldn't redraw the original selection","레이어를 고르지 못함":"couldn't pick the layer","빈 레이어":"empty layer","변형을 시작하지 못함":"couldn't start the transform","왜곡 모드 단추를 찾지 못함":"couldn't find the distort mode button","변형이 시작되지 않음":"transform didn't start","모양이 맞지 않음":"shape doesn't match","모양이 맞지 않음 — Ctrl+Z로 되돌려 주세요":"shape doesn't match — undo with Ctrl+Z","모양이 맞지 않아 그대로 둠":"shape doesn't match, left as is","함께 변형하다 멈췄어요: ":"Stopped while transforming together: ","여러 조각(또는 구멍)으로 된 선택은 지금 레이어만 바뀌어요":"With a selection made of several pieces (or holes), only the current layer changes","선택 영역이 있을 때는 함께 고른 레이어 ${MS_MAX_SEL}개까지만 같이 바뀌어요(레이어마다 되돌리기 3칸) — 지금 레이어만 바뀌어요":"With a selection, only up to ${MS_MAX_SEL} selected layers can change together (3 undo steps per layer) — only the current layer changes","잠긴 레이어(${locked.map((L) => L.name).join(', ')})가 있어 지금 레이어만 바뀌어요":"There are locked layers (${locked.map((L) => L.name).join(', ')}), so only the current layer changes","레이어 ${todo.length}개에 같은 ${ss.kind === 'move' ? '이동' : '변형'}을 하는 중…":"Applying the same ${ss.kind === 'move' ? '이동' : '변형'} to ${todo.length} layers…","앞 레이어에서 멈춤":"stopped at an earlier layer","함께 옮기기":"Move together","함께 변형":"Transform together","${results.length - bad.length}개는 함께 바꿨지만 ${bad.map(([L, e]) => `\"${L.name}\"(${e})`).join(', ')}은 못 바꿨어요":"Changed ${results.length - bad.length} together, but couldn't change ${bad.map(([L, e]) => `\"${L.name}\"(${e})`).join(', ')}","레이어 ${results.length + 1}개를 함께 ${ss.kind === 'move' ? '옮겼어요' : '변형했어요'} (되돌리기는 레이어마다 ${ss.sel ? '3칸: 선택 해제·선택·변형' : '한 칸'})":"${ss.kind === 'move' ? '옮겼어요' : '변형했어요'} ${results.length + 1} layers together (undo per layer: ${ss.sel ? '3칸: 선택 해제·선택·변형' : '한 칸'})","속성을 함께 바꾸다 멈췄어요: ":"Stopped while changing properties together: ","레이어 칸을 찾지 못함":"couldn't find the layer row","불투명도 칸을 찾지 못함":"couldn't find the opacity field","불투명도가 바뀌지 않음":"opacity didn't change","합성 모드를 찾지 못함":"couldn't find the blend mode","합성 모드가 바뀌지 않음":"blend mode didn't change","단추를 찾지 못함":"couldn't find the button","바뀌지 않음":"didn't change","레이어 ${todo.length}개에 같은 속성을 맞추는 중…":"Matching the same properties on ${todo.length} layers…","\"${L.name}\"(고르지 못함)":"\"${L.name}\"(couldn't pick)","속성 함께 바꾸기":"Change properties together","투명 픽셀 잠금":"Lock transparent pixels","잠금":"Lock","클리핑":"Clipping","일부는 못 바꿨어요: ${bad.join(', ')}":"Some couldn't be changed: ${bad.join(', ')}","레이어 ${todo.length + 1}개에 ${Object.keys(ch).map((k) => names[k]).join('·')} 함께 맞췄어요":"Matched ${Object.keys(ch).map((k) => names[k]).join('·')} on ${todo.length + 1} layers","보드가 너무 커서 퀵 마스크를 쓸 수 없어요":"The board is too large for Quick Mask","칠한 모양: Enter = 선택으로 만들기 · Esc = 처음 선택으로 · Ctrl+Z = 한 획 되돌리기":"Painted shape: Enter = make selection · Esc = back to original selection · Ctrl+Z = undo one stroke","화면을 회전·뒤집기 한 상태에서는 퀵 마스크를 선택으로 만들 수 없어요 — 화면을 원래대로 돌리고 Enter":"Quick Mask can't become a selection while the view is rotated/flipped — reset the view, then press Enter","선택을 모두 지웠어요":"Cleared the whole selection","선택 모양을 만들지 못했어요":"Couldn't make the selection shape","퀵 마스크 선택":"Quick Mask selection","퀵 마스크를 선택으로 만들었어요 (${cnt.toLocaleString()}픽셀)":"Turned the Quick Mask into a selection (${cnt.toLocaleString()} px)"," · 작은 조각 ${P.dropped}개는 뺐어요":" · Left out ${P.dropped} small pieces","선택으로 만들지 못했어요: ":"Couldn't make a selection: ","처음 선택으로 돌렸어요":"Restored the original selection","되돌릴 획이 없어요 (Magma 되돌리기는 퀵 마스크에서 나간 뒤에)":"No strokes to undo (use Magma's undo after leaving Quick Mask)","클리핑을 바꾸지 못했어요: ":"Couldn't change clipping: ","다른 사람 레이어는 클리핑할 수 없어요":"Other people's layers can't be clipped","레이어를 고르지 못했어요":"Couldn't pick the layer","클리핑 단추를 찾지 못했어요":"Couldn't find the clipping button","\"${L.name}\" 클리핑 ${L.clippingGroup ? '켬 (아래 레이어 모양 안에만 보여요)' : '끔'}":"\"${L.name}\" clipping ${L.clippingGroup ? '켬 (아래 레이어 모양 안에만 보여요)' : '끔'}","클리핑이 바뀌지 않았어요":"Clipping didn't change","${g.what} 되돌렸어요 (Magma 되돌리기 ${done}칸을 한 번에)":"Undid ${g.what} (${done} Magma undo steps at once)"," · 더 앞의 칸은 15칸 한도로 지워져 있었어요":" · earlier steps were already gone due to the 15-step limit","${g.what} — ${g.n}칸 중 ${done}칸만 되돌렸어요":"${g.what} — undid only ${done} of ${g.n} steps","${r.what} 다시 했어요 (${done}칸을 한 번에)":"Redid ${r.what} (${done} steps at once)","${r.what} — ${r.n}칸 중 ${done}칸만 다시 했어요":"${r.what} — redid only ${done} of ${r.n} steps","칠할 영역을 이 픽셀만큼 넓히거나(+) 좁혀요(−). 0이면 Magma 그대로":"Grows (+) or shrinks (−) the fill area by this many pixels. 0 = Magma's default","확장/축소":"Expand/Shrink","Mode가 opacity·smart이거나 Target layer가 above·below면 확장/축소·빈틈 닫기 없이 Magma 그대로 칠해요":"If Mode is opacity/smart or Target layer is above/below, it fills the normal Magma way, without expand/shrink or gap closing","칠하지 못했어요: ":"Couldn't fill: ","칠할 레이어를 먼저 골라 주세요":"Pick a layer to fill first","그림을 읽지 못했어요":"Couldn't read the image","칠할 곳이 없어요 (너무 많이 좁혔어요)":"Nothing to fill (shrunk too much)","칠할 영역을 만들지 못했어요":"Couldn't create the fill area","올가미 채우기 모드를 맞추지 못해 안전을 위해 멈췄어요":"Stopped for safety: couldn't set the Lasso fill mode","${erase ? '지움' : '칠함'}: ${cnt.toLocaleString()}픽셀":"${erase ? '지움' : '칠함'}: ${cnt.toLocaleString()} px"," (영역 ${S.fillGrow > 0 ? '+' : ''}${S.fillGrow}px)":" (area ${S.fillGrow > 0 ? '+' : ''}${S.fillGrow}px)"," · 틈 ${ff.bridges}곳 이음":" · bridged ${ff.bridges} gaps","${erase ? '지움' : '칠함'}: ${cnt.toLocaleString()}픽셀 · 안티에일리어스":"${erase ? '지움' : '칠함'}: ${cnt.toLocaleString()} px · anti-aliased","원 (딱딱)":"Circle (hard)","원 (부드러움)":"Circle (soft)","납작붓":"Flat Brush","연필 (거친)":"Pencil (rough)","스프레이 점":"Spray Dots","붓털":"Bristles","수채 얼룩":"Watercolor Blot","흑연":"Graphite","목탄 끝":"Charcoal Tip","파스텔 덩이":"Pastel Chunk","마른 붓털":"Dry Bristles","납작 붓털":"Flat Bristles","레이크":"Rake","별":"Star","하트":"Heart","잎":"Leaf","삼각형":"Triangle","종이":"Paper","수채 종이":"Watercolor Paper","캔버스 천":"Canvas","노이즈":"Noise","거친 결":"Rough Grain","드로잉지 결":"Drawing Paper","목탄지":"Charcoal Paper","중목 종이":"Medium-Grain Paper","사포":"Sandpaper","빗금":"Hatching","망점":"Halftone","기본 브러시 ":"Basic Brush ","한글이 보이도록 기본 글꼴을 \"${font}\"로 맞췄어요 (끄려면 오른쪽 '자동' 해제)":"Set the default font to \"${font}\" so Korean text shows up (to turn this off, uncheck 'Auto' on the right)","\"${f}\" 글꼴에는 한글이 없어 네모로 보여요 — 글자를 고르고 오른쪽 '한글' 글꼴 단추를 눌러 주세요":"The \"${f}\" font has no Korean characters, so they show as boxes — select the text and click the 'Korean' font button on the right","한글":"Korean","글꼴을 ${f}로 (한글이 보이는 Magma 글꼴)":"Set the font to ${f} (a Magma font that shows Korean)","한글을 치면 자동으로 한글 글꼴로 바꿔요":"Switch to a Korean font automatically when you type Korean","자동":"Auto","내 컴퓨터 글꼴…":"My computer's fonts…","컴퓨터에 설치된 글꼴로 글자를 그림으로 넣어요":"Add text as an image using fonts installed on your computer","글자를 써 주세요":"Please type some text","붙일 레이어를 먼저 골라 주세요":"Pick a layer to paste on first","글자 레이어 말고 그림 레이어를 골라 주세요":"Pick a drawing layer, not a text layer","글자를 붙였어요 — 이동 도구로 옮길 수 있어요":"Text added — you can move it with the Move tool","여기에는 그림이 있는 레이어가 없어요":"There's no layer with a drawing here","\"${L.name}\" 레이어":"Layer \"${L.name}\"","를 골랐어요":" selected"," — 다른 사람 레이어예요":" — it's someone else's layer","채울 레이어를 먼저 골라 주세요":"Pick a layer to fill first","Alt를 떼면 채워요 — 다시 눌러 주세요":"Fills when you release Alt — press it again","올가미 채우기 설정을 바꾸지 못했어요":"Couldn't change the Lasso fill settings","선택 영역을 지웠어요":"Erased the selection","레이어 전체를 지웠어요":"Erased the whole layer","선택 영역을 채웠어요":"Filled the selection","보드 전체를 채웠어요":"Filled the whole board","채우지 못했어요: ":"Couldn't fill: ","레이어 속성 — 브러시 설정 자리에 레이어 속성을 띄워요":"Layer Properties — shows layer properties where the brush settings are","레이어 속성":"Layer Properties","레이어를 고르면 속성이 보여요":"Pick a layer to see its properties","경계 효과 (테두리)":"Border Effect (outline)","테두리 두께":"Border thickness","흐리기":"Blur","테두리 색":"Border color","테두리 안티에일리어싱":"Border anti-aliasing","내 화면에만 보여요 (보드에는 평범한 레이어)":"Only visible on my screen (a normal layer on the board)","효과":"Effect","켜짐":"On","꺼짐":"Off","그리기: 손을 떼면 보드에 들어가요 · Alt: 스포이트 · Shift+클릭: 직선 · Ctrl+Alt 끌기·[ ]: 크기":"Draw: goes onto the board when you release · Alt: eyedropper · Shift+click: straight line · Ctrl+Alt drag / [ ]: size","문지르기: 흐리게(손을 떼면 보드에 들어가요, 되돌리기 2칸) · [ ]: 크기":"Drag: blur (goes onto the board when you release, 2 undo steps) · [ ]: size","빨간 곳 = 선택 · 칠하기: 넣기 · Alt: 반대로 · Enter: 선택으로 · Esc: 처음으로 · [ ]: 크기":"Red = selection · Paint: add · Alt: reverse · Enter: to selection · Esc: start over · [ ]: size","문지르기: 선택(선택이 있으면 추가) · Alt: 빼기 · [ ]: 브러시 크기":"Drag: select (adds to an existing selection) · Alt: subtract · [ ]: brush size","클릭한 영역을 지금 색으로 채워요":"Fills the clicked area with the current color","클릭: 선택 · Shift: 추가 · Alt: 빼기":"Click: select · Shift: add · Alt: subtract","불투명도 (%)":"Opacity (%)","강도 (흐림 반경 px)":"Strength (blur radius px)","밀도 (%)":"Density (%)","선택으로 만들기":"Make Selection","아직 칠한 게 없어요":"Nothing painted yet","처음으로":"Start Over","모두 지우기":"Clear All","선택을 비우고 새로 칠하기":"Empty the selection and paint from scratch","칠하기":"Paint","선택 넣기":"Add to selection","선택 빼기":"Subtract from selection","참조":"Reference","모든 레이어":"All layers","허용 오차":"Tolerance","영역 확장":"Expand area","동작":"Action","선택":"Select","채우기":"Fill","이어진 곳만":"Contiguous","전체 같은 색":"All matching colors","빈틈 닫기":"Close gaps","v${VERSION}으로 업데이트됐어요":"Updated to v${VERSION}","도구":"Tools","색상환":"Color wheel","브러시 목록":"Brush list","레이어":"Layers","펼치기":"Expand","접기":"Collapse","닫기 (Window 메뉴에서 다시 열기)":"Close (reopen from the Window menu)","Window — 패널·화면 배치":"Window — panels & layout","패널":"Panels","화면 모드":"View mode","두 줄":"Two rows","배치 처음으로 (이 모드)":"Reset layout (this mode)","사용자 지정 UI 끄기 (원래 화면)":"Turn off custom UI (original layout)","사용자 지정 UI 켜기":"Turn on custom UI","레이아웃 설정 단추를 찾지 못했어요":"Couldn't find the layout settings button","Magma 화면 조각을 찾지 못함":"couldn't find a Magma screen element","화면 배치에 문제가 생겨 원래 Magma 화면으로 돌렸어요. 다른 기능은 그대로 쓸 수 있어요 (Window 메뉴에서 다시 켜기)":"Something went wrong with the layout, so it switched back to the original Magma layout. Other features still work (turn it back on from the Window menu)","처음 보는 화면 조각: ":"Unknown screen element: "};
  const I18N = { built: false, exact: new Map(), subs: [], pats: [], obs: null, busy: false };
  const I18N_SCOPE = '[class*="mw-"], [class*="mx-"]';
  const I18N_ATTRS = ['title', 'placeholder', 'aria-label', 'tooltip'];
  function i18nBuild() {
    if (I18N.built) return;
    I18N.built = true;
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [ko, en] of Object.entries(I18N_EN)) {
      if (!en || ko === en) continue;
      if (ko.includes('${')) {
        // `${…}` 자리는 아무 글자나 → 영어 쪽 같은 식 자리에 그대로
        const parts = ko.split(/(\$\{[^}]*\})/), exprs = [];
        let re = '';
        for (const p of parts) { if (/^\$\{[^}]*\}$/.test(p)) { exprs.push(p); re += '(.+?)'; } else re += esc(p.replace(/\\n/g, '\n').replace(/\\(['"`])/g, '$1')); }
        if (!HANGUL.test(parts.filter((p, i) => i % 2 === 0).join(''))) continue;
        I18N.pats.push({ re: new RegExp(re, 'g'), exprs, en: en.replace(/\\n/g, '\n').replace(/\\(['"`])/g, '$1') });
      } else {
        const k = ko.replace(/\\n/g, '\n').replace(/\\(['"`])/g, '$1'), v = en.replace(/\\n/g, '\n').replace(/\\(['"`])/g, '$1');
        I18N.exact.set(k.trim(), v.trim());
        if (k.trim().length >= 2) I18N.subs.push([k, v]);
      }
    }
    I18N.subs.sort((a, b) => b[0].length - a[0].length);
    I18N.pats.sort((a, b) => b.re.source.length - a.re.source.length);
  }
  function i18nText(str) {
    if (!str || !HANGUL.test(str)) return str;
    i18nBuild();
    const t = str.trim();
    if (I18N.exact.has(t)) { const lead = str.slice(0, str.indexOf(t)), tail = str.slice(str.indexOf(t) + t.length); return lead + I18N.exact.get(t) + tail; }
    let out = str;
    for (const p of I18N.pats) {
      if (!HANGUL.test(out)) break;
      p.re.lastIndex = 0;
      out = out.replace(p.re, (...m) => { let r = p.en; p.exprs.forEach((ex, i) => { r = r.split(ex).join(m[i + 1]); }); return r; });
    }
    for (const [k, v] of I18N.subs) { if (!HANGUL.test(out)) break; if (out.includes(k)) out = out.split(k).join(v); }
    return out;
  }
  function i18nNode(n, en) {
    if (n.nodeType === 3) {
      if (en) {
        if (n.__mwOut === n.data) return;
        if (!HANGUL.test(n.data)) return;
        n.__mwKo = n.data; const v = i18nText(n.data); n.__mwOut = v; if (v !== n.data) n.data = v;
      } else if (n.__mwKo != null && n.__mwOut === n.data) { n.data = n.__mwKo; n.__mwOut = null; n.__mwKo = null; }
      return;
    }
    if (n.nodeType !== 1) return;
    for (const a of I18N_ATTRS) {
      const v = n.getAttribute(a); if (v == null) continue;
      const ko = (n.__mwKoA || (n.__mwKoA = {}));
      if (en) { if (HANGUL.test(v) && v !== (n.__mwOutA || {})[a]) { ko[a] = v; const t = i18nText(v); (n.__mwOutA || (n.__mwOutA = {}))[a] = t; if (t !== v) n.setAttribute(a, t); } }
      else if (ko[a] != null && (n.__mwOutA || {})[a] === v) { n.setAttribute(a, ko[a]); ko[a] = null; }
    }
  }
  function i18nTree(root, en) {
    i18nNode(root, en);
    if (root.nodeType !== 1) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; while ((n = w.nextNode())) i18nNode(n, en);
  }
  const inScope = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; return !!(el && el.closest && el.closest(I18N_SCOPE)); };
  function i18nApplyAll() {
    const en = LANG_EN();
    for (const el of document.querySelectorAll(I18N_SCOPE)) if (!el.parentElement || !el.parentElement.closest(I18N_SCOPE)) i18nTree(el, en);
  }
  function i18nStart() {
    if (I18N.obs) return;
    I18N.obs = new MutationObserver((recs) => {
      if (I18N.busy) return;
      const en = LANG_EN();
      if (!en) return; // 한국어 화면: 원문 그대로
      I18N.busy = true;
      try {
        for (const r of recs) {
          if (r.type === 'childList') { for (const n of r.addedNodes) if (inScope(n)) i18nTree(n, true); }
          else if (inScope(r.target)) i18nNode(r.target, true);
        }
      } catch (e) { /* 번역 실패는 무시 (원문이 보일 뿐) */ } finally { I18N.busy = false; }
    });
    I18N.obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS });
    i18nApplyAll();
  }
  let i18nLast = null;
  function i18nTick() { const en = LANG_EN(); if (en !== i18nLast) { i18nLast = en; I18N.busy = true; try { i18nApplyAll(); } finally { I18N.busy = false; } } }
  function setExtLang(v) { // 'auto' | 'ko' | 'en'
    try { const st = JSON.parse(localStorage.getItem('magmaWand.settings') || '{}'); if (v === 'auto') delete st.lang; else st.lang = v; localStorage.setItem('magmaWand.settings', JSON.stringify(st)); } catch { /* 무시 */ }
    S.lang = v === 'auto' ? undefined : v; saveSettings();
    LANG_AT = 0; i18nTick(); if (DK.on) dkRender();
  }
  cleanups.push(() => { I18N.obs?.disconnect(); I18N.obs = null; });

  // Magma는 페이지 이동 없이 화면을 바꾸므로 주기적으로 상태를 맞춘다
  const tick = setInterval(() => {
    try { i18nStart(); i18nTick(); } catch (e) { /* 무시 */ }
    try { dkTick(); } catch (e) { console.warn('[MagmaWand] 사용자 지정 UI', e); }
    if (!getCanvas()) { if (S.active) setActive(false); return; }
    ensureStyle();
    ensureGroups();
    ensureKoRow();
    ensureFillRow();
    koToolTick();
    alphaTick();
    ensureLayerProps();
    if (S.active) {
      // 단축키 등으로 Magma가 다른 도구로 바뀌었으면 마법봉 끄기
      if (!S.busy && !S.switching && !switchingTo && !spaceDown && currentTool() !== 'lassoSelectionIcon') { setActive(false); return; } // Space(화면 이동) 동안 Magma가 잠깐 손 도구로 바꾸는 건 무시
      ensureSettings();
    } else if (pendingLasso() && !switchingTo && !QM.applying && currentTool() === 'lassoSelectionIcon') {
      // 되돌리지 못한 손떨림 보정(단축키로 도구를 바꿨거나 창을 닫았던 경우)을 올가미 선택이 보일 때 되돌림
      restoreLassoStab();
    }
  }, 400);

  // 새 버전이 들어올 때 이 버전을 깨끗이 걷어낸다
  window.__magmaWand.destroy = () => {
    destroyed = true;
    clearInterval(tick);
    clearTimeout(stabTimer); // 되돌릴 설정은 localStorage에 남아 있어 새 버전이 이어서 되돌린다
    BSZ.el?.remove(); BSZ.label?.remove(); BSZ.on = false;
    for (const f of cleanups.splice(0)) { try { f(); } catch { /* 무시 */ } }
    removeSettings();
    cancelAnimationFrame(ADV.raf); ADV.raf = 0; ADV.cv = null;
    // 덧그림 캔버스·떠 있는 창도 모두 치운다 (예전 버전이 남긴 것까지)
    document.querySelectorAll('.mw-menu, .mw-toast, .mw-dialog-wrap, .mw-shortcut, .mw-flyout, .mw-overlay, .mw-brush, .mw-alpha, .mw-eye, canvas.mw-adv, canvas.mw-fx, canvas.mw-cover, .mw-blurwrap, .mw-mswrap, .mw-msguard, .mw-bset, .mw-clipline, .mw-flashbox, .mw-size-ring, .mw-size-label').forEach((e) => e.remove());
    document.documentElement.classList.remove('mw-quick', 'mw-alpha-on', 'mw-lp');
    styleEl?.remove();
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
    histCheck, histPoints, histCopyLayer, openHistoryDialog, histUsage, getBrushSize, sizeRow,
    openStrokeDialog, fxSet, fxGet, fxKick, fxState: () => FX,
    advImportSut, advSelect, advListBrushes, advDeleteBrush, advState: () => ADV, dockState: () => DK, parseSut, sqliteTables, parseEffector, getAA, setAA, docToBuffer, selectionExists,
    setAlpha, advEraseCommit, fillSelection, pickLayerAt, pickLayer, lpShow, ensureLayerProps, eyeColorAt,
    ensureGroups, activateMember, selectLayerContent, advNewBrush, setMagmaFont, currentFontName, systemFonts, openTextImageDialog,
    blurDab, blurState: () => BLR, msState: () => MS, guState: () => GU, guRef, clipToggle, clipHitAt, advPutImage, builtinBlob, advSaveBrush, advPrepare, openBrushSettings, openPresetPicker, advNewFromPreset, ADV_PRESETS, advMixColor, setPrimaryHex, advState2: () => ADV, fgConfig, growMaskBy, ensureFillRow, rowLayer, msPick, msReplay, msDecompose, gapBridgeFill, qmState: () => QM, qmApply, msPropsApply, readLayerEff, replaceLayerRegion, BUILTIN_TIPS, BUILTIN_TEX, trfModeButtons, smpRequest, smpState: () => SMP, smpRender, smpRes, smpCanvas, hexRgb, presetBrushObj, advCatOf, ADV_CATS };
  window.__magmaWand.ready = true; // 끝까지 시작됨 (실행기는 이 표시가 없으면 다시 넣는다)
})();
