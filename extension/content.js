// magma.com 페이지에 마법봉 코드를 넣는다. 새 버전이 저장되면 열린 페이지에도 바로 바꿔 끼운다.
function inject(code) {
  const s = document.createElement('script');
  s.textContent = code;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
}

chrome.runtime.sendMessage({ type: 'getWand' }, (wand) => {
  if (wand && wand.code) inject(wand.code);
  chrome.runtime.sendMessage({ type: 'check' });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.wand && changes.wand.newValue && changes.wand.newValue.code) {
    inject(changes.wand.newValue.code);
  }
});
