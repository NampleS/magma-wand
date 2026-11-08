// 1) 확장 안에 들어 있는 wand.js는 크롬이 magma.com 페이지에 직접 넣는다(manifest의 content_scripts, MAIN world).
//    → 인터넷이 안 되거나 업데이트가 실패해도 마법봉은 항상 뜬다.
// 2) 여기(백그라운드)서는 GitHub 릴리스의 최신 wand.js를 받아 저장하고, 열린 Magma 탭에 넣는다.
//    wand.js는 자기보다 낮은 버전 위에만 덮어써지므로 여러 번 넣어도 안전하다.
const BASE = 'https://github.com/NampleS/magma-wand/releases/latest/download/';
const CHECK_EVERY_MIN = 10;
const MAGMA_URL = /^https:\/\/([a-z0-9-]+\.)?magma\.com\//i;

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

let checking = null;
async function checkUpdate(force = false) {
  if (checking) return checking;
  checking = (async () => {
    const { lastCheck = 0, wand } = await chrome.storage.local.get(['lastCheck', 'wand']);
    if (!force && Date.now() - lastCheck < CHECK_EVERY_MIN * 60 * 1000) return false;
    await chrome.storage.local.set({ lastCheck: Date.now() });
    const v = await (await fetch(BASE + 'version.json?t=' + Date.now(), { cache: 'no-store' })).json();
    if (wand && wand.version === v.version) return false;
    const buf = await (await fetch(BASE + 'wand.js?t=' + Date.now(), { cache: 'no-store' })).arrayBuffer();
    if ((await sha256Hex(buf)) !== String(v.files['wand.js']).toUpperCase()) throw new Error('hash mismatch');
    const code = new TextDecoder('utf-8').decode(buf);
    await chrome.storage.local.set({ wand: { version: v.version, code } });
    return true;
  })().catch((e) => { console.warn('[MagmaWand] 업데이트 확인 실패', e); return false; })
    .finally(() => { checking = null; });
  return checking;
}

// 저장된 최신 코드를 탭의 페이지(MAIN world)에서 실행
async function injectInto(tabId) {
  const { wand } = await chrome.storage.local.get('wand');
  if (!wand || !wand.code) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (code) => {
        try { (0, eval)(code); } catch (e) { console.error('[MagmaWand] 실행 실패', e); }
      },
      args: [wand.code],
    });
  } catch (e) {
    console.warn('[MagmaWand] 넣기 실패', tabId, e);
  }
}
async function injectAll() {
  const tabs = await chrome.tabs.query({ url: ['https://magma.com/*', 'https://*.magma.com/*'] });
  for (const t of tabs) await injectInto(t.id);
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('magma-wand-update', { periodInMinutes: CHECK_EVERY_MIN });
  await checkUpdate(true);
  await injectAll();
});
chrome.runtime.onStartup.addListener(async () => { await checkUpdate(true); await injectAll(); });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'magma-wand-update' && (await checkUpdate(true))) await injectAll();
});
// Magma 페이지가 열릴 때마다: 저장된 최신 버전 넣기 + (10분 지났으면) 업데이트 확인
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !MAGMA_URL.test(tab.url)) return;
  await injectInto(tabId);
  if (await checkUpdate(false)) await injectAll();
});
