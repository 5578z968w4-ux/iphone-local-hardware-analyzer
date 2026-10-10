"""Browser smoke tests. Requires Playwright and Chromium; serve parent folder on 8891."""
from pathlib import Path
import json, time
from playwright.sync_api import sync_playwright
BASE=Path(__file__).resolve().parent.parent
OUT=BASE/'說明與測試'
URL='http://127.0.0.1:8891/diagnostic-v2/'
checks=[]
def record(name): checks.append({'test':name,'status':'PASS'})
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,accept_downloads=True)
    page=context.new_page()
    requests=[]; errors=[]
    page.on('request',lambda r: requests.append({'url':r.url,'method':r.method}))
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function("document.querySelector('#ready').textContent.includes('已就緒')")
    assert page.locator('#version').inner_text()=='DIAG-2.0.0'
    assert page.locator('#scan').is_disabled()
    record('版本握手與未選檔防護')
    page.screenshot(path=str(OUT/'mobile-before-scan.png'),full_page=True)
    req_count=len(requests)
    page.locator('#demo').click()
    page.wait_for_selector('#results:not([hidden])')
    assert page.locator('#demoNotice').is_visible()
    assert page.locator('#status').inner_text().startswith('掃描完成：5 行')
    assert page.locator('#groups').inner_text().find('nandDesc')>=0
    assert 'HostApplicationDisplayID' not in page.locator('#groups').inner_text()
    record('合成資料可完成掃描且不把無關欄位當硬體')
    assert len(requests)==req_count
    record('掃描期間無 HTTP(S) 請求')
    page.locator('#showValues').check()
    assert 'EXAMPLE KIOXIA TLC 256GB' in page.locator('#groups').inner_text()
    assert '來源未' in page.locator('body').inner_text()
    record('本機原值切換和來源標籤')
    page.locator('#scope').select_option('watch')
    assert 'Watch' in page.locator('#groups').inner_text()
    assert 'EXAMPLE KIOXIA' not in page.locator('#groups').inner_text()
    page.locator('#scope').select_option('all')
    record('來源篩選不混入其他組別')
    page.locator('#preview').click()
    structure=json.loads(page.locator('#exportPreview').inner_text())
    assert structure['privacy']['includesAllowedValues'] is False
    assert all(not f['values'] for f in structure['fields'])
    record('預設匯出不含樣本值')
    page.locator('#includeValues').check()
    assert page.locator('#download').is_disabled()
    page.locator('#preview').click()
    exported=page.locator('#exportPreview').inner_text()
    data=json.loads(exported)
    assert data['privacy']['includesAllowedValues']
    assert 'EXAMPLE' not in exported
    assert 'KIOXIA' in exported
    assert 'filename' not in data
    record('候選值需重新預覽且 NAND 描述遮罩')
    with page.expect_download() as download_info:
        page.locator('#download').click()
    download=download_info.value
    downloaded=Path(download.path()).read_text()
    assert downloaded==exported
    assert download.suggested_filename=='iPhone_DIAG-2_精準診斷摘要.json'
    record('JSON 下載與預覽逐字相符')
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.locator('#exportPreview').evaluate('(e)=>e.hidden=true')
    page.screenshot(path=str(OUT/'mobile-demo-results.png'),full_page=True)
    record('390px 手機版型無水平溢出')
    page.locator('#clear').click()
    page.wait_for_function("document.querySelector('#ready').textContent.includes('已就緒')")
    assert page.locator('#results').is_hidden()
    assert not page.locator('#includeValues').is_checked()
    assert not page.locator('#showValues').is_checked()
    assert page.locator('#file').input_value()==''
    assert page.evaluate('localStorage.length')==0
    record('清除檔案、原值、匯出並重設選項，不寫入 localStorage')
    # Worker was loaded before switching offline. No fake uploaded analytics.
    context.set_offline(True)
    fixture='\n'.join(json.dumps(x) for x in [
      {'ProductType':'iPhone15,2','message':{'CycleCount':222}},
      {'nandDesc':'TLC 512GB','dramSize':12},
      {'watchHardwareModel':'Watch6,7','actuatorVendorWide':4}])
    before=len(requests)
    page.locator('#file').set_input_files({'name':'local-fixture.ips.ca.synced','mimeType':'application/octet-stream','buffer':fixture.encode()})
    page.locator('#scan').click()
    page.wait_for_selector('#results:not([hidden])')
    assert page.locator('#status').inner_text().startswith('掃描完成：3 行')
    assert len(requests)==before
    record('程式已載入後，斷網選檔與掃描成功')
    context.set_offline(False)
    # A representative large file, entirely synthetic and generated in this container.
    large=OUT/'synthetic-large.ips'
    row={'padding':'x'*548,'unrelatedCount':1}
    lines=[]
    for i in range(44780):
        if i%1000==0:
            obj={**row,'ProductType':'iPhone15,2','message':{'last_value_CycleCount':123,'actuatorVendorTele':3}}
        else: obj=row
        lines.append(json.dumps(obj,separators=(',',':')))
    large.write_text('\n'.join(lines))
    size=large.stat().st_size
    page.locator('#file').set_input_files(str(large))
    before=len(requests);t=time.perf_counter()
    page.locator('#scan').click()
    page.wait_for_function("document.querySelector('#status').textContent.startsWith('掃描完成')",timeout=30000)
    elapsed=round(time.perf_counter()-t,3)
    assert '44,780' in page.locator('#status').inner_text()
    assert len(requests)==before
    record('44,780 行合成大檔完成掃描，分析時無網路請求')
    # Stop promptly during the same large scan.
    page.locator('#scan').click()
    page.locator('#cancel').click()
    page.wait_for_function("document.querySelector('#ready').textContent.includes('已就緒')")
    assert page.locator('#results').is_hidden()
    assert '已停止' in page.locator('#status').inner_text()
    record('停止按鈕可中止 Worker 並清掉部分結果')
    page.locator('#file').set_input_files({'name':'empty.ips','mimeType':'text/plain','buffer':b''})
    page.locator('#scan').click()
    page.wait_for_selector('#error:not([hidden])')
    assert '空的' in page.locator('#error').inner_text()
    record('空檔明確錯誤，沒有假成功畫面')
    page.locator('#file').set_input_files({'name':'bad.ips','mimeType':'text/plain','buffer':b'not json\n{"nandDesc":null}'})
    page.locator('#scan').click()
    page.wait_for_selector('#results:not([hidden])')
    assert '不是單行 JSON' in page.locator('#warnings').inner_text()
    assert '僅有空值' in page.locator('#groups').inner_text()
    record('解析缺漏及全為 null 欄位明確告知')
    # Security assertions in the generated main document.
    csp=page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute('content')
    assert "connect-src 'none'" in csp and "form-action 'none'" in csp
    outcome=page.evaluate("async()=>{try{await fetch('/must-be-blocked');return 'FAIL'}catch(e){return 'BLOCKED'}}")
    assert outcome=='BLOCKED'
    record('CSP 主動連線阻擋實測，表單禁止指令檢查')
    assert not errors,errors
    record('完整操作流程無未處理 JavaScript 例外')
    result={'browser':'system Chromium via Playwright','viewport':'390x844','checks':checks,
      'syntheticBenchmark':{'bytes':size,'MiB':round(size/1048576,2),'lines':44780,'seconds':elapsed,
      'environment':'container desktop Chromium, NOT iPhone Safari'},'iPhoneSafariTested':False,
      'realRawAnalyticsTested':False,'pageErrors':errors}
    (OUT/'browser-test-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False,indent=2))
    large.unlink()
    browser.close()
