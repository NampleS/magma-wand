// 최신 마법봉 코드(wand.js)를 GitHub 릴리스에서 받아 저장해 둔다.
// 받은 파일은 version.json의 SHA-256과 맞을 때만 쓴다.
const BASE = 'https://github.com/NampleS/magma-wand/releases/latest/download/';
const CHECK_EVERY_MIN = 10;

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

let checking = null;
async function checkUpdate(force = false) {
  if (checking) return checking;
  checking = (async () => {
    const { lastCheck = 0, wand } = await chrome.storage.local.get(['lastCheck', 'wand']);
    if (!force && Date.now() - lastCheck < CHECK_EVERY_MIN * 60 * 1000) return;
    await chrome.storage.local.set({ lastCheck: Date.now() });
    const v = await (await fetch(BASE + 'version.json?t=' + Date.now(), { cache: 'no-store' })).json();
    if (wand && wand.version === v.version) return;
    const buf = await (await fetch(BASE + 'wand.js?t=' + Date.now(), { cache: 'no-store' })).arrayBuffer();
    if ((await sha256Hex(buf)) !== String(v.files['wand.js']).toUpperCase()) throw new Error('hash mismatch');
    const code = new TextDecoder('utf-8').decode(buf);
    await chrome.storage.local.set({ wand: { version: v.version, code } });
  })().catch((e) => console.warn('[MagmaWand] 업데이트 확인 실패', e)).finally(() => { checking = null; });
  return checking;
}

async function getWand() {
  const { wand } = await chrome.storage.local.get('wand');
  if (wand && wand.code) return wand;
  // 처음 설치 직후·오프라인: 확장에 들어 있는 기본 버전
  const code = await (await fetch(chrome.runtime.getURL('wand.js'))).text();
  return { version: 'bundled', code };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('magma-wand-update', { periodInMinutes: CHECK_EVERY_MIN });
  checkUpdate(true);
});
chrome.runtime.onStartup.addListener(() => checkUpdate(true));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'magma-wand-update') checkUpdate(true); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'getWand') { getWand().then(reply); return true; }
  if (msg && msg.type === 'check') { checkUpdate(false); }
  return false;
});
