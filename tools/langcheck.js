// 언어 검사: Magma는 계정 언어로 화면 글자를 번역하므로, 확장이 Magma 칸을 영어 글자로만 찾으면 다른 언어 화면에서 고장 난다.
// (실제 사고: 한국어 Magma에서 안티에일리어싱·브러시 크기·페인트통이 안 됨 → v0.35.2)
// release.js가 배포 전에 부른다. 걸리면 배포를 멈춘다.
//  - 글자 비교는 isT / hasT / rowOf / mT 로. 정말 번역되지 않는 글자면 그 줄에 'lang-ok: 이유' 주석.
//  - 업데이트 소식(NEWS)에 이번 버전이 한국어·영어 같은 줄 수로 있어야 한다.
'use strict';
const fs = require('fs');
const path = require('path');

const TEXT = String.raw`(?:textContent|innerText|nodeValue|tipOf\([^)]*\)|\.title|getAttribute\('(?:title|tooltip|aria-label|placeholder)'\))`;
const RULES = [
  [new RegExp(TEXT + String.raw`[^;|&]{0,70}?(?:===|!==|==|!=|\.includes\(|\.startsWith\(|\.endsWith\(|\.indexOf\()\s*['"\x60][A-Za-z][A-Za-z]{2,}`), '영어 글자와 바로 비교'],
  [new RegExp(String.raw`\/[^\/\s(),;]*[A-Za-z]{3,}[^\/\n]{0,60}\/[a-z]*\.test\([^;]{0,80}?` + TEXT), '영어 글자를 정규식으로 비교'],
  [new RegExp(TEXT + String.raw`[^;|&]{0,40}?\.match\(\s*\/[^\/]*[A-Za-z]{3,}`), '영어 글자를 match로 비교'],
  [/\[(?:title|tooltip|aria-label|placeholder|ng-reflect-tooltip)[\^*$~|]?=\s*["']?[A-Za-z]{3,}/, '번역되는 속성값으로 찾기'],
];
const SAFE = /\b(?:isT|hasT|mT|rowOf|normT\(mT|brushModeOf)\(|lang-ok/;

function checkSource(src) {
  const bad = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (/I18N_EN\s*=/.test(line) || /^\s*\/\//.test(line)) return;
    const code = line.length > 4000 ? '' : line;
    if (SAFE.test(code)) return;
    for (const [re, why] of RULES) if (re.test(code)) { bad.push(`${i + 1}번째 줄 (${why}): ${code.trim().slice(0, 140)}`); break; }
  });
  return bad;
}
// 확장이 찾는 Magma 글자들 (isT·hasT·rowOf·mT에 쓴 영어) — tools/langtest.py가 실제 Magma 번역표에 있는지 확인한다
function labels(src) {
  const out = new Set();
  for (const m of src.matchAll(/\b(?:isT|hasT)\((?:[^()]|\([^()]*\))*?,\s*'([^']+)'\)/g)) out.add(m[1]);
  for (const m of src.matchAll(/\b(?:rowOf|mT|fgRow|dkLayoutOption)\('([^']+)'\)/g)) out.add(m[1]);
  const t = src.match(/TRF_TIPS = \[([^\]]*)\]/); if (t) for (const m of t[1].matchAll(/'([^']+)'/g)) out.add(m[1]);
  return [...out];
}
function news(src, version) {
  const i = src.indexOf('const NEWS = ['), j = src.indexOf('\n  ];', i);
  if (i < 0 || j < 0) return ['NEWS 목록을 찾지 못했어요'];
  let list; try { list = new Function('return ' + src.slice(i + 'const NEWS = '.length, j + 4))(); } catch (e) { return ['NEWS 문법 오류: ' + e.message]; }
  const n = list[0], bad = [];
  if (!n || n.v !== version) bad.push(`NEWS 맨 위가 v${version}이 아니에요 (지금 v${n && n.v})`);
  for (const x of list) {
    if (!x.ko || !x.en || !x.ko.length || x.ko.length !== x.en.length) bad.push(`NEWS v${x.v}: 한국어·영어 줄 수가 달라요`);
    if ((x.en || []).some((t) => /[가-힣]/.test(t))) bad.push(`NEWS v${x.v}: 영어 쪽에 한글이 있어요`);
  }
  return bad;
}
// 언어 시험(langtest.py)을 통과한 파일인지 (버전 번호 줄은 빼고 비교)
const digest = (src) => require('crypto').createHash('sha256').update(src.replace(/const VERSION = '[^']*';/, '').replace(/\r\n/g, '\n')).digest('hex');
module.exports = { checkSource, labels, news, digest };

if (require.main === module) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'wand.js'), 'utf8');
  if (process.argv[2] === '--labels') console.log(JSON.stringify(labels(src)));
  else if (process.argv[2] === '--digest') console.log(digest(src));
  else { const b = checkSource(src); console.log(b.length ? b.join('\n') : '언어 검사 통과'); process.exit(b.length ? 1 : 0); }
}
