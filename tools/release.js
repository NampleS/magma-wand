// 릴리스 도구
//   node tools/release.js <버전> ["변경 내용"]          → dist/ 만들기만
//   node tools/release.js <버전> ["변경 내용"] --publish → 커밋·태그·푸시 + GitHub 릴리스 올리기
//   node tools/release.js <버전> "사유" --kill --publish → 비상 정지(모든 설치본의 Magma Extension을 끔)
// 릴리스가 올라가는 즉시 설치된 모든 컴퓨터가 5~10분 안에 새 버전을 받아 간다.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const args = process.argv.slice(2);
const publish = args.includes('--publish');
const [version, notes = ''] = args.filter((a) => !a.startsWith('--'));
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('사용법: node tools/release.js 0.2.1 "변경 내용" [--publish]');
  process.exit(1);
}

const p = (...a) => path.join(ROOT, ...a);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').toUpperCase();
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// 비상 정지: --kill 이면 배포되는 wand.js를 "옛 버전을 걷어내고 아무것도 안 하는" 코드로 바꾼다.
// (src/wand.js는 건드리지 않는다. 고친 뒤 더 높은 버전으로 다시 배포하면 원래대로 돌아온다.)
const kill = args.includes('--kill');
const KILL_STUB = `// Magma 마법봉 — 비상 정지 버전 (${version})
(() => {
  const VERSION = '${version}';
  const isNewer = (a, b) => { const pa = String(a).split('.').map(Number), pb = String(b || '0').split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); } return false; };
  const prev = window.__magmaWand;
  if (prev && !isNewer(VERSION, prev.version)) return;
  try { prev && prev.destroy && prev.destroy(); } catch (e) { }
  window.__magmaWand = { version: VERSION, disabled: true, destroy() { } };
  console.warn('[MagmaWand] 비상 정지됨: ' + ${JSON.stringify(notes)});
})();
`;

// 1) 버전 번호 넣기
const wandPath = p('src', 'wand.js');
if (!kill) {
  let wand = fs.readFileSync(wandPath, 'utf8');
  wand = wand.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
  fs.writeFileSync(wandPath, wand);
  fs.copyFileSync(wandPath, p('extension', 'wand.js')); // 크롬 확장 기본 버전
}

// 2) PowerShell 파일은 BOM이 있어야 한국어가 안 깨진다 (Windows PowerShell 5.1)
for (const f of fs.readdirSync(p('app')).filter((f) => f.endsWith('.ps1'))) {
  const buf = fs.readFileSync(p('app', f));
  if (!buf.subarray(0, 3).equals(BOM)) fs.writeFileSync(p('app', f), Buffer.concat([BOM, buf]));
}

// 3) dist 만들기
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);
if (kill) fs.writeFileSync(path.join(DIST, 'wand.js'), KILL_STUB);
else fs.copyFileSync(wandPath, path.join(DIST, 'wand.js'));
for (const f of ['launcher.ps1', 'boot.ps1', 'run.vbs', 'install.ps1', 'uninstall.ps1', 'MagmaWand-Setup.cmd']) {
  fs.copyFileSync(p('app', f), path.join(DIST, f));
}
fs.copyFileSync(p('app', 'MagmaWand-Setup.cmd'), path.join(DIST, 'MagmaExtension-Setup.cmd')); // 새 이름 설치 파일 (예전 링크도 계속 동작)
const zip = path.join(DIST, 'magma-wand-chrome.zip');
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Compress-Archive -Path '${p('extension')}\\*' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });

// 자동 업데이트 대상 = version.json의 files
const files = {};
for (const f of ['wand.js', 'launcher.ps1', 'magma-wand-chrome.zip', 'uninstall.ps1']) files[f] = sha(path.join(DIST, f));
fs.writeFileSync(path.join(DIST, 'version.json'),
  JSON.stringify({ version, date: new Date().toISOString(), notes, files }, null, 2));
console.log(`dist 준비 완료: v${version}`);

if (!publish) process.exit(0);

// 4) 올리기
const run = (cmd, a) => execFileSync(cmd, a, { cwd: ROOT, stdio: 'inherit' });
run('git', ['add', '-A']);
const msg = `v${version}${notes ? ': ' + notes : ''}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
try { run('git', ['commit', '-m', msg]); } catch { /* 바뀐 게 없으면 넘어감 */ }
run('git', ['tag', '-f', `v${version}`]);
run('git', ['push', 'origin', 'HEAD']);
run('git', ['push', 'origin', `v${version}`, '--force']);
const assets = fs.readdirSync(DIST).map((f) => path.join(DIST, f));
run('gh', ['release', 'create', `v${version}`, ...assets, '--title', `v${version}`, '--notes', notes || `v${version}`, '--latest']);
console.log(`릴리스 v${version} 올림`);
