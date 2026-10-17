from playwright.sync_api import sync_playwright
import json, time
B='http://localhost:5173'
errors=[]
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1280,'height':900}); pg=ctx.new_page()
    pg.on('console', lambda m: errors.append(('console',m.text)) if m.type=='error' and 'favicon' not in m.text else None)
    pg.on('pageerror', lambda e: errors.append(('pageerror',str(e))))
    pg.goto(B+'/'); pg.wait_for_selector('text=Personalize the way'); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/shots/n_landing.png')
    # unauthenticated redirect
    pg.goto(B+'/dashboard'); pg.wait_for_url('**/login'); print('redirect to login: ok')
    # signup
    pg.goto(B+'/signup'); pg.fill('#name','Dahi'); pg.fill('#email','dahi@example.com'); pg.fill('#password','password123'); pg.click('button:has-text("Create account")')
    pg.wait_for_url('**/assessment'); pg.wait_for_selector('text=Question 1 of'); pg.screenshot(path='/tmp/shots/n_assess1.png')
    # leave and check dashboard empty-ish
    print('first step:', pg.inner_text('h1')[:60], '|', pg.inner_text('text=/Question 1 of/'))
    # answer through the UI
    n=0
    while n<40:
        n+=1
        pg.wait_for_selector('button:has-text("Next"), button:has-text("Finish")')
        label=pg.inner_text('main p.ns-muted').strip()
        has_opts=pg.locator('input.op').count()
        if has_opts: pg.locator('label.ol').first.click()
        else: pg.wait_for_timeout(1200)   # reading time
        if n==3:  # test Previous then forward again
            pg.click('button:has-text("Previous")'); pg.wait_for_timeout(400); pg.click('button:has-text("Next")'); pg.wait_for_timeout(400)
        if n==6:  # save & exit then resume
            pg.click('text=Save & exit'); pg.wait_for_url('**/dashboard'); pg.wait_for_selector('text=Continue assessment'); print('dashboard in-progress:', pg.inner_text('a.btn')); pg.click('text=Continue assessment'); pg.wait_for_selector('text=/Question \\d+ of/'); print('resumed at:', pg.inner_text('main p.ns-muted').strip()); continue
        last = pg.locator('button:has-text("Finish")').count()>0
        pg.click('button[type=submit]')
        if last: break
        pg.wait_for_timeout(250)
    pg.wait_for_url('**/results'); pg.wait_for_selector('text=Your assessment is complete'); pg.wait_for_timeout(300)
    print('results:', pg.inner_text('section[aria-labelledby=lv]').replace('\n',' | ')[:200])
    pg.screenshot(path='/tmp/shots/n_results.png',full_page=True)
    pg.click('text=Apply Recommended Settings'); pg.wait_for_url('**/dashboard'); pg.wait_for_selector('text=Welcome back, Dahi'); pg.wait_for_timeout(500)
    pg.screenshot(path='/tmp/shots/n_dash.png',full_page=True)
    print('dashboard level box current:', pg.locator('[aria-current=true]').inner_text().replace('\n',' '))
    print('profile list:', pg.locator('section[aria-labelledby=ap] li').all_inner_texts())
    # quick control
    sw=pg.locator('button[aria-labelledby=q1]'); before=sw.get_attribute('aria-checked'); sw.click(); pg.wait_for_timeout(700); pg.reload(); pg.wait_for_selector('button[aria-labelledby=q1]'); print('focus switch persisted:', before,'->',pg.locator('button[aria-labelledby=q1]').get_attribute('aria-checked'))
    # pairing code
    pg.click('text=Get pairing code'); pg.wait_for_selector('text=Enter this code'); print('pairing:', pg.inner_text('section[aria-labelledby=be]').replace('\n',' ')[:120])
    # Reading studio
    pg.click('nav >> text=Reading Studio'); pg.wait_for_selector('#ft'); pg.wait_for_timeout(600)
    print('studio font:', pg.input_value('#ft'), 'size', pg.input_value('#fs'))
    pg.select_option('#ft','atkinson'); pg.fill('#fs','24'); pg.wait_for_timeout(300)
    print('preview font/size:', pg.evaluate("(()=>{const c=getComputedStyle(document.querySelector('#pv ~ div p, .preview-box p'));return c.fontFamily+' / '+c.fontSize})()"))
    pg.locator('button[aria-labelledby=r1]').click(); pg.wait_for_timeout(500); print('bionic spans in preview:', pg.locator('.preview-box .ns-b').count())
    pg.wait_for_selector('text=All changes saved'); pg.screenshot(path='/tmp/shots/n_studio.png',full_page=True)
    pg.reload(); pg.wait_for_selector('#ft'); pg.wait_for_timeout(500); print('persisted after reload:', pg.input_value('#ft'), pg.input_value('#fs'), pg.locator('button[aria-labelledby=r1]').get_attribute('aria-checked'))
    pg.click('text=Reset to Recommended'); pg.wait_for_selector('text=Reset to your recommended'); print('after reset recommended:', pg.input_value('#ft'), pg.input_value('#fs'))
    pg.click('text=Reset to Default'); pg.wait_for_selector('text=Reset to default'); print('after reset default:', pg.input_value('#ft'), pg.input_value('#fs'))
    # reader mode in preview
    pg.locator('button[aria-labelledby=r4]').click(); pg.wait_for_timeout(500); print('reader overlay:', pg.locator('#ns-reader').count()); pg.get_by_role('button',name='Exit Reader Mode').click(); pg.wait_for_timeout(300); print('reader switch after exit:', pg.locator('button[aria-labelledby=r4]').get_attribute('aria-checked'))
    # AI tools
    pg.click('nav >> text=Reading Intelligence'); pg.wait_for_selector('#i1')
    pg.fill('#i1','The precipitate dissemination of multifaceted information has revolutionized communication.'); pg.click('button.go >> nth=0'); pg.wait_for_selector('.res >> nth=0 >> text=/unavailable/'); print('simplify (no key):', pg.inner_text('.res >> nth=0'))
    pg.fill('#i3','ephemeral'); pg.click('button.go >> nth=2'); pg.wait_for_selector('.res >> nth=2 >> text=Meaning'); print('word local:', pg.inner_text('.res >> nth=2').replace('\n',' | '))
    pg.fill('#i3','two words'); pg.click('button.go >> nth=2'); pg.wait_for_timeout(300); print('word phrase msg:', pg.inner_text('.res >> nth=2'))
    pg.screenshot(path='/tmp/shots/n_ai.png',full_page=True)
    # settings + profile
    pg.click('nav >> text=Settings'); pg.wait_for_selector('#mode'); pg.select_option('#mode','low'); pg.wait_for_selector('text=Saved. This applies')
    pg.click('button[aria-labelledby=rc]'); pg.wait_for_selector('text=Thank you. You can switch'); pg.wait_for_selector('text=Share feedback'); 
    for k in ['easeOfReading','navigationEase','usefulness','satisfaction']: pg.select_option('#'+k,'4')
    pg.click('text=Submit anonymously'); pg.wait_for_selector('text=recorded as P001'); print('evaluation: ok')
    pg.screenshot(path='/tmp/shots/n_settings.png',full_page=True)
    pg.click('nav >> text=Profile'); pg.wait_for_selector('#pn'); print('profile email:', pg.input_value('#pe'))
    # logout
    pg.click('text=Log out'); pg.wait_for_url(B+'/'); pg.goto(B+'/dashboard'); pg.wait_for_url('**/login'); print('logout works')
    # login again, data persisted
    pg.fill('#email','dahi@example.com'); pg.fill('#password','password123'); pg.click('button:has-text("Log in")'); pg.wait_for_url('**/dashboard'); pg.wait_for_selector('text=View full results'); print('relogin: results persisted')
    # mobile
    m=b.new_context(viewport={'width':390,'height':800}); mp=m.new_page(); mp.goto(B+'/login'); mp.fill('#email','dahi@example.com'); mp.fill('#password','password123'); mp.click('button:has-text("Log in")'); mp.wait_for_url('**/dashboard'); mp.wait_for_timeout(600)
    print('mobile h-scroll dashboard:', mp.evaluate("document.documentElement.scrollWidth>innerWidth")); mp.screenshot(path='/tmp/shots/n_mobile.png')
    b.close()
print('CONSOLE/PAGE ERRORS:', errors)
