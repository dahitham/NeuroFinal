from playwright.sync_api import sync_playwright
import tempfile, json, urllib.request, urllib.error
EXT='/home/claude/NS/NeuroSync/extension'; API='http://localhost:4000/api'
def call(method,path,body=None,token=None):
    req=urllib.request.Request(API+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return {'__status':e.code, **json.loads(e.read() or b'{}')}
tok=call('POST','/auth/signup',{'name':'Extie','email':'ext'+__import__('time').strftime('%H%M%S')+'@example.com','password':'password123'})['token']
q=call('POST','/assessment/start',{'part':'core','mode':'high'},tok)
while True:
    st=q['step']
    body={'part':'core','stepId':st['id'],'timeMs':600000} if st['kind']=='passage' else {'part':'core','stepId':st['id'],'value':st['options'][-1],'timeMs':900}
    a=call('POST','/assessment/answer',body,tok)
    if a.get('complete'): break
    q={'step':a['step']}
res=call('POST','/assessment/submit',{'part':'core'},tok); print('level', res['level']['level'], 'score', res['score']['total'])
call('POST','/accessibility/reset',{'to':'recommended'},tok)
code=call('POST','/extension/pairing-code',{},tok)['code']; print('code',code)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),headless=True,channel='chromium',args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}','--headless=new'])
    sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker',timeout=10000)
    eid=sw.url.split('/')[2]
    site=ctx.new_page(); site.goto('http://localhost:8000/'); site.wait_for_timeout(1000)
    print('before connect: ns-on =', site.evaluate("document.documentElement.classList.contains('ns-on')"))
    pop=ctx.new_page(); pop.goto(f'chrome-extension://{eid}/popup/popup.html'); pop.wait_for_timeout(400)
    print('popup state:', pop.inner_text('#level'), '| connect visible:', pop.locator('#connect').is_visible())
    pop.fill('#code','WRNG-1234'); pop.click('#connectBtn'); pop.wait_for_selector('#connectMsg:not([hidden])'); print('bad code msg:', pop.inner_text('#connectMsg'))
    pop.fill('#code',code); pop.click('#connectBtn'); pop.wait_for_selector('#controls:not([hidden])',timeout=8000)
    print('connected popup:', pop.inner_text('#level'), '| font select =', pop.input_value('#font'))
    print('backend sees connection:', call('GET','/extension/status',None,tok)['connected'])
    site.reload(); site.wait_for_timeout(1500)
    print('ns-on:', site.evaluate("document.documentElement.classList.contains('ns-on')"))
    print('font:', site.evaluate("getComputedStyle(document.querySelector('p')).fontFamily")[:28], '| size', site.evaluate("getComputedStyle(document.querySelector('p')).fontSize"), '| letter', site.evaluate("getComputedStyle(document.querySelector('p')).letterSpacing"))
    print('ruler:', site.locator('#ns-ruler').count(), '| tint overlay:', site.locator('[id^=ns-overlay]').count(), '| reader auto-open on article:', site.locator('#ns-reader').count())
    pop.check('#bionicReading'); site.wait_for_timeout(1200); print('bionic spans:', site.locator('.ns-b').count())
    pop.click('#reset'); site.wait_for_timeout(800); print('after popup Reset Settings, bionic spans:', site.locator('.ns-b').count())
    call('PUT','/accessibility/profile',{'settings':{'font':'atkinson','readerMode':False,'letterSpacing':9}},tok)
    pop.reload(); pop.wait_for_timeout(1500); site.reload(); site.wait_for_timeout(1500)
    print('after server-side change: font', site.evaluate("getComputedStyle(document.querySelector('p')).fontFamily")[:30], '| reader:', site.locator('#ns-reader').count(), '| password form untouched:', site.locator('#sens .ns-b').count()==0)
    site.evaluate("""()=>{const p=document.querySelector('article p');const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))}""")
    site.wait_for_timeout(400); host=site.locator('#neurosync-selection-host'); host.get_by_role('button',name='Simplify').click(); site.wait_for_timeout(1500)
    print('AI via extension (no key):', host.locator('.panel').inner_text().replace('\n',' | ')[:160])
    call('POST','/extension/disconnect',{},tok); pop.reload(); pop.wait_for_timeout(1500)
    print('after disconnect: popup shows connect form:', pop.locator('#connect').is_visible(), '| token cleared:', sw.evaluate("()=>chrome.storage.local.get('ns_token')"))
    ctx.close()
