# 언어 시험: 시험 보드를 화면에 안 뜨는 크롬(손님)으로 여러 언어로 열어, 확장 기능이 영어 화면과 똑같이 동작하는지 확인한다.
#   python tools/langtest.py            → 다섯 언어 모두 (통과하면 tools/.langtest.json 에 도장 → release.js 가 확인)
#   python tools/langtest.py ko-KR      → 한 언어만 (도장 없음)
# 손님은 그릴 수 없으므로 보드는 바뀌지 않는다. 그래픽카드를 쓰지 않는다(소프트웨어 렌더링).
import io, json, os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(HERE, '..', 'src', 'wand.js')
SAFE = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-rasterization', '--disable-accelerated-video-decode']
BOARD = 'https://magma.com/d/UJfZeagVT3'
LANGS = ['en-US', 'ko-KR', 'ja-JP', 'zh-CN', 'es-ES']
node = lambda a: subprocess.run(['node', os.path.join(HERE, 'langcheck.js'), a], capture_output=True, text=True, encoding='utf-8').stdout.strip()
LABELS = json.loads(node('--labels'))

def run(loc):
    src = io.open(SRC, encoding='utf-8').read()
    ver = re.search(r"const VERSION = '([^']+)'", src).group(1)
    R, bad = {}, []
    def check(name, ok, got=None):
        R[name] = bool(ok)
        if not ok: bad.append('%s%s' % (name, '' if got is None else ' → %s' % (got,)))
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', headless=True, args=SAFE)
        try:
            c = b.new_context(viewport={'width': 1500, 'height': 900}, locale=loc); pg = c.new_page(); pg.set_default_timeout(20000)
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
            # 예전부터 쓰던 사람처럼 (소식 창이 뜨도록)
            pg.add_init_script("try{if(location.hostname==='magma.com'&&!localStorage.getItem('magmaWand.settings'))localStorage.setItem('magmaWand.settings','{}')}catch(e){}")
            pg.goto(BOARD, wait_until='domcontentloaded'); pg.wait_for_selector('.editor-canvas canvas', timeout=60000); time.sleep(6)
            pg.evaluate(src); time.sleep(3)
            ev = lambda js: pg.evaluate(js)
            I = lambda js: ev("(()=>{const I=window.__magmaWand.internals;return (%s)})()" % js)
            tool = lambda t: (I("I.selectTool('%s')&&0" % t), time.sleep(1.1))
            lang = ev("document.documentElement.lang"); check('화면 언어', lang.lower()[:2] == loc.lower()[:2], lang)
            # 확장이 찾는 글자가 이 언어의 번역표에 있는지
            miss = pg.evaluate("(l)=>{const d=window.locale;return d&&typeof d==='object'?l.filter(k=>!(k in d)):[]}", LABELS)
            R['번역표에 없는 글자'] = miss
            check('번역표', not miss, miss)
            pg.keyboard.press('e'); time.sleep(.8); pg.keyboard.press('b'); time.sleep(1.2)
            check('손떨림 보정 칸', isinstance(I("I.getStabilizer()"), (int, float)))
            check('브러시 크기 칸', I("!!I.sizeRow()"))
            cog = ev("[!!document.querySelector('.mx-cog'),!!document.querySelector('editor-color')]"); check('레이아웃 설정 단추', cog[0] or not cog[1], cog)
            # 안티에일리어싱 4단계
            st = lambda: ev("(()=>{const t=window.__magmaWand.internals.getEditor().activeTool;return [(document.querySelector('.mw-aarow .mw-aab.on')||{dataset:{}}).dataset.lv,t.pixelation,Math.round(t.hardness*100)]})()")
            pg.evaluate("(v)=>{const r=window.__magmaWand.internals.sizeRow(),en=r.querySelector('editable-number'),b=en.querySelector('button'),i=en.querySelector('input');b.click();i.value=String(v);i.dispatchEvent(new FocusEvent('blur'))}", 60); time.sleep(.5)
            for lv in ('none', 'weak', 'mid', 'strong'):
                try: pg.locator('.mw-aarow .mw-aab[data-lv="%s"]' % lv).click(timeout=4000); time.sleep(2)
                except Exception as e: check('AA ' + lv, False, str(e)[:60]); continue
                s = st(); check('AA ' + lv, s[0] == lv and s[1] == (lv == 'none') and (s[2] == 100 if lv == 'weak' else True), s)
            # 필압·크기에 따라 흐림 유지: 강하게 → 텍스처 깊이 켜짐(약하게 → 꺼짐은 아래에서)
            x = I("(()=>{const t=I.getEditor().activeTool;return [I.aaDepth('strong',t),I.aaTexOurs(t),I.aaCurD(t),t.patternDepthPressure]})()"); check('필압 흐림 설정', x[0] > 0 and x[1] and abs(x[2] - x[0]) < .006 and x[3] is True, x)
            # 크기를 바꾸면 경도가 따라가고, 번지는 폭이 같은지
            for sz in (20, 100):
                pg.evaluate("(v)=>{const r=window.__magmaWand.internals.sizeRow(),en=r.querySelector('editable-number'),b=en.querySelector('button'),i=en.querySelector('input');b.click();i.value=String(v);i.dispatchEvent(new FocusEvent('blur'))}", sz); time.sleep(2.6)
                s = I("(()=>{const t=I.getEditor().activeTool;return [t.size,Math.round(t.hardness*100),I.aaHard('strong',t)]})()")
                check('AA 크기 %d 따라감' % sz, s[0] == sz and s[1] == s[2], s)
            pg.locator('.mw-aarow .mw-aab[data-lv="weak"]').click(); time.sleep(1)
            time.sleep(1); check('약하게로 텍스처 꺼짐', not I('I.aaTexOurs(I.getEditor().activeTool)') and I('!(I.getEditor().activeTool.hasFeatures & 8)')); check('숨긴 창 닫힘', not ev("!!document.querySelector('editor-brushes-popup editor-popup.visible, .dropdown-menu.context-menu')||document.documentElement.classList.contains('mw-bphide')"))
            tool('lassoBrushIcon'); check('올가미 브러시 그리기/지우기', I("I.getBrushMode()") in ('draw', 'erase'), I("I.getBrushMode()"))
            m = ev("(async()=>{const I=window.__magmaWand.internals,a=await I.setBrushMode('erase'),b=I.getBrushMode();await I.setBrushMode('draw');return [b,I.getBrushMode()]})()"); check('올가미 모드 바꾸기', m == ['erase', 'draw'], m)
            check('올가미 자동 지우기', I("typeof I.getAutoErase()==='boolean'"))
            tool('faFillDrip'); check('페인트통 확장/축소 줄', ev("!!document.querySelector('.mw-fgrow')")); fg = I("I.fgConfig?I.fgConfig():'x'") if 'fgConfig,' in src.split('internals = {')[-1] else 'x'
            R['페인트통 설정'] = fg
            tool('lassoSelectionIcon'); check('선택 안티에일리어스', I("I.getAA()") is not None); check('선택 모드', I("I.getSelectionMode()") is not None, I("I.getSelectionMode()"))
            tool('faPaintBrush')
            # Edit 메뉴 항목 (글자 안 보고 두 번째 메뉴 단추)
            op = lambda i: (pg.evaluate("(i)=>document.querySelectorAll('editor-menu .menu-items button.dropdown-toggle')[i].click()", i), time.sleep(.9))
            op(1); check('Edit 메뉴 항목 4개', ev("document.querySelectorAll('.dropdown-menu .mw-menu').length") == 4, ev("document.querySelectorAll('.dropdown-menu .mw-menu').length")); pg.keyboard.press('Escape'); time.sleep(.4)
            op(4); v = ev("(document.querySelector('help-dropdown-content .mw-verb')||{}).textContent"); check('Help 메뉴 버전', v == 'Magma Extension v' + ver, v)
            last = ev("(()=>{const h=document.querySelector('help-dropdown-content');return !!h&&h.lastElementChild.classList.contains('mw-verb')})()"); check('버전이 맨 아래', last)
            if os.environ.get('LT_SHOT'): pg.screenshot(path=os.environ['LT_SHOT'] + loc + '.png')
            pg.keyboard.press('Escape'); time.sleep(.4)
            # 소식 창: 한 번만, × 눌러야 닫힘
            n = ev("(()=>{const e=document.querySelector('.mw-news');if(!e)return null;const r=e.getBoundingClientRect();return [r.left>0&&r.right<=innerWidth&&r.top>0&&r.bottom<=innerHeight,e.querySelectorAll('.mw-news-v').length,e.innerText]})()")
            check('소식 창', n and n[0] and n[1] >= 1, n)
            if n:
                ko = bool(re.search('[가-힣]', n[2])); check('소식 언어', ko == (loc == 'ko-KR'), n[2][:60])
                time.sleep(4); check('소식 안 사라짐', ev("!!document.querySelector('.mw-news')"))
                pg.locator('.mw-news-x').click(); time.sleep(1.2); check('소식 × 닫힘', not ev("!!document.querySelector('.mw-news')"))
                check('다시 안 뜸', ev("localStorage.getItem('magmaWand.seen')") == ver)
                op(4); pg.locator('.mw-verb').click(); time.sleep(.8); a = ev("document.querySelectorAll('.mw-news-v').length"); check('버전 누르면 전체 소식', a >= 4, a); pg.locator('.mw-news-x').click(); time.sleep(.4)
                # 여러 버전이 쌓였을 때 한 창에
                ev("localStorage.setItem('magmaWand.seen','0.35.0')"); time.sleep(1.2); a = ev("document.querySelectorAll('.mw-news').length+'/'+document.querySelectorAll('.mw-news-v').length")
                check('쌓인 소식 한 창에', a.startswith('1/') and int(a[2:]) >= 4, a); ev("localStorage.setItem('magmaWand.seen','%s')" % ver); time.sleep(1.2); check('다른 창에서 닫으면 같이 닫힘', not ev("!!document.querySelector('.mw-news')"))
            # 켜기·끄기 단추, 레이어 우클릭 래스터화
            check('전원 단추', ev("!!document.querySelector('editor-menu .mx-power')"))
            ev("(()=>{const I=window.__magmaWand.internals,L=I.getEditor().drawing.layers[0];I.fxSet('UJfZeagVT3',L.uid,{on:true,color:'#ff0000',width:3,aa:true,blur:0})})()"); time.sleep(.5)
            pg.locator('editor-layers .layer').first.click(button='right'); time.sleep(1.3); a = ev("[...document.querySelectorAll('.context-menu button.mw-fxm')].map(b=>{const r=b.getBoundingClientRect();return b.textContent+'|'+(r.height>5&&r.bottom<=innerHeight&&r.top>0)}).join()")
            check('래스터화 메뉴', a == ('경계 효과 래스터화' if loc == 'ko-KR' else 'Rasterize border effect') + '|true', a); pg.keyboard.press('Escape'); time.sleep(.4)
            ev("(()=>{const I=window.__magmaWand.internals,L=I.getEditor().drawing.layers[0];I.fxSet('UJfZeagVT3',L.uid,null)})()"); time.sleep(.3)
            # 한국어가 아니면 확장 화면에 한글이 없어야 함 (사용자가 정한 이름 등은 빼고)
            if loc != 'ko-KR':
                h = ev("[...new Set([...document.querySelectorAll('[class*=\"mw-\"],[class*=\"mx-\"]')].filter(e=>!e.closest('.mw-noi18n')&&e.offsetParent).flatMap(e=>[...e.childNodes].filter(x=>x.nodeType===3).map(x=>x.data.trim()).concat([e.title||''])).filter(t=>/[가-힣]/.test(t)))]")
                check('남은 한글', not h, h[:6])
            check('스크립트 오류', not [e for e in errs if 'MagmaWand' in e], errs[:2])
        finally: b.close()
    return R, bad

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    langs = sys.argv[1:] or LANGS; ok = True
    for l in langs:
        R, bad = run(l)
        print('%s: %s' % (l, '통과 %d개' % sum(1 for v in R.values() if v is True) if not bad else '실패 ' + ' | '.join(bad)))
        print('   번역표에 없는 글자:', R.get('번역표에 없는 글자'), '페인트통:', R.get('페인트통 설정'))
        ok = ok and not bad
    if ok and langs == LANGS:
        io.open(os.path.join(HERE, '.langtest.json'), 'w', encoding='utf-8').write(json.dumps({'digest': node('--digest'), 'langs': LANGS}))
        print('도장 찍음')
    sys.exit(0 if ok else 1)
