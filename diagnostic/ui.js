'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const UI = {
    file: $('file'), sample: $('samples'), analyze: $('analyze'), reset: $('reset'),
    export: $('export'), selected: $('selected'), progress: $('progress'),
    progressLabel: $('progressLabel'), results: $('results'), stats: $('stats'),
    warning: $('warning'), categories: $('categories'), title: $('version')
  };
  UI.title.textContent = HardwareFieldDiagnostic.VERSION;
  let selectedFile = null;
  let summary = null;
  let working = false;
  let aggregate = null;
  const number = x => Number(x).toLocaleString('zh-TW');
  const add = (parent,tag,text,cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    n.textContent = text;
    parent.appendChild(n);
    return n;
  };
  const size = n => (n / 1024 / 1024).toFixed(1) + ' MiB';
  const sleepFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  function setProgress(p, msg) {
    UI.progress.value = p;
    UI.progressLabel.textContent = msg;
  }
  async function scanFile(file, options) {
    if (file.size > HardwareFieldDiagnostic.MAX_FILE_BYTES) throw new Error('檔案超過 100 MiB 的安全限制');
    const state = HardwareFieldDiagnostic.newState(options);
    const reader = file.stream().getReader();
    const dec = new TextDecoder('utf-8');
    let buffer = '', read = 0;
    try {
      while (true) {
        const {value,done} = await reader.read();
        if (done) break;
        read += value.byteLength;
        buffer += dec.decode(value,{stream:true});
        let off = 0, end;
        while ((end = buffer.indexOf('\n',off)) !== -1) {
          HardwareFieldDiagnostic.ingestLine(buffer.slice(off,end), state);
          off = end + 1;
        }
        buffer = buffer.slice(off);
        if (buffer.length > HardwareFieldDiagnostic.MAX_LINE) {
          throw new Error('單一資料行超過解析上限，請確認是否為 Analytics 主檔');
        }
        setProgress(Math.min(98,Math.round(read / Math.max(1,file.size)*98)), `掃描中：${size(read)}／${size(file.size)}，${number(state.totalLines)} 行`);
        await sleepFrame();
      }
      buffer += dec.decode();
      if (buffer) HardwareFieldDiagnostic.ingestLine(buffer,state);
    } finally { reader.releaseLock(); }
    return HardwareFieldDiagnostic.summarize(state,file.name);
  }
  function render(data) {
    UI.results.hidden = false;
    UI.stats.replaceChildren(); UI.categories.replaceChildren();
    const pairs = [
      ['總掃描行數',number(data.counts.totalLines)],
      ['硬體相關行',number(data.counts.candidateLines)],
      ['發現欄位／來源組合',number(data.counts.fieldScopePairs)],
      ['標示為 iPhone 的紀錄',number(data.counts.scope.iphone)],
      ['標示為 Watch 的紀錄',number(data.counts.scope.watch)],
      ['同列混合機型紀錄',number(data.counts.scope.mixed)],
      ['未標明來源的紀錄',number(data.counts.scope.unknown)]
    ];
    for (const [label,value] of pairs) {
      const card=add(UI.stats,'div','', 'stat');
      add(card,'span',label,'stat-label'); add(card,'strong',value,'stat-value');
    }
    const iphones=data.modelCandidates.iphone.join('、') || '沒有發現明確 iPhone 型號欄位';
    const watches=data.modelCandidates.watch.join('、') || '沒有發現';
    UI.warning.textContent = `iPhone 代碼：${iphones}\nApple Watch 代碼：${watches}\n注意：「未標明來源」不等於 iPhone，欄位出現不代表供應商已確認。`;
    const groups = data.categories;
    for (const [id,g] of Object.entries(groups)) {
      const details = document.createElement('details');
      const summaryEl = document.createElement('summary');
      summaryEl.textContent = `${g.label} · ${g.fields.length} 種欄位／來源組合`;
      details.appendChild(summaryEl);
      const table = document.createElement('table');
      const head = document.createElement('thead');
      const hr = document.createElement('tr');
      for (const title of ['欄位','來源','次數',...(data.privacy.includesSafeSamples ? ['候選短值'] : [])]) add(hr,'th',title);
      head.appendChild(hr); table.appendChild(head);
      const body = document.createElement('tbody');
      if (!g.fields.length) {
        const row=document.createElement('tr');
        const cell=add(row,'td','此類沒有發現候選欄位');
        cell.colSpan=data.privacy.includesSafeSamples?4:3;
        body.appendChild(row);
      } else {
        for (const f of g.fields.slice(0,70)) {
          const row = document.createElement('tr');
          add(row,'td',f.field); add(row,'td',({iphone:'iPhone',watch:'Watch',mixed:'混合',unknown:'未標明'})[f.scope]);
          add(row,'td',number(f.count));
          if (data.privacy.includesSafeSamples) add(row,'td',f.samples.join('、')||'—');
          body.appendChild(row);
        }
      }
      table.appendChild(body); details.appendChild(table); UI.categories.appendChild(details);
    }
  }
  function reset() {
    if (working) return;
    selectedFile=null; summary=null; aggregate=null;
    UI.file.value=''; UI.selected.textContent='未選擇檔案';
    UI.analyze.disabled=true; UI.export.disabled=true; UI.results.hidden=true;
    setProgress(0,'請先選擇檔案');
  }
  UI.file.addEventListener('change', () => {
    if (working) return;
    selectedFile = UI.file.files?.[0] || null;
    summary=null; UI.export.disabled=true; UI.results.hidden=true;
    UI.selected.textContent=selectedFile ? `${selectedFile.name} · ${size(selectedFile.size)}（僅本機讀取）` : '未選擇檔案';
    UI.analyze.disabled=!selectedFile;
    setProgress(0, selectedFile ? '準備開始掃描' : '請先選擇檔案');
  });
  UI.reset.addEventListener('click',reset);
  UI.analyze.addEventListener('click',async () => {
    if (!selectedFile || working) return;
    working=true; UI.analyze.disabled=true; UI.reset.disabled=true; UI.export.disabled=true;
    UI.results.hidden=true;
    try {
      summary=await scanFile(selectedFile,{includeSamples:UI.sample.checked});
      render(summary); UI.export.disabled=false;
      setProgress(100,`完成：${number(summary.counts.totalLines)} 行，${number(summary.counts.fieldScopePairs)} 種候選欄位／來源`);
    } catch (err) {
      setProgress(0,'分析失敗：'+String(err?.message||err));
    } finally {working=false;UI.analyze.disabled=false;UI.reset.disabled=false;}
  });
  UI.export.addEventListener('click', () => {
    if (!summary) return;
    const safeCopy = JSON.stringify(summary,null,2);
    const blob = new Blob([safeCopy],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='iPhone_硬體欄位診斷_脫敏摘要.json';
    a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
})();
