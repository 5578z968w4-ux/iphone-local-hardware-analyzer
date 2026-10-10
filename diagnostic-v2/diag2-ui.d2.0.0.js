'use strict';
(function(){
  const EXPECTED='DIAG-2.0.0', $=id=>document.getElementById(id);
  const IDs=['file','filemeta','scan','cancel','clear','progress','status','demo','error','results','stats','warnings','groups','scope','showValues','records','more','includeValues','preview','download','exportPreview','exportInfo','ready','version','demoNotice','recordDetails'];
  const E=Object.fromEntries(IDs.map(id=>[id,$(id)]));
  let worker=null,ready=false,busy=false,selected=null,report=null,exportText=null,isDemo=false,visibleRecords=20,initTimer;
  const pretty=n=>new Intl.NumberFormat('zh-TW').format(n);
  function node(tag,text,className){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(className)x.className=className;return x;}
  function fail(message){E.error.textContent=message;E.error.hidden=false;}
  function invalidateExport(){exportText=null;E.download.disabled=true;E.exportPreview.hidden=true;E.exportPreview.textContent='';E.exportInfo.textContent='尚未預覽，或選項已變更；請重新預覽。';}
  function eraseReport(){report=null;E.results.hidden=true;E.groups.replaceChildren();E.records.replaceChildren();E.stats.replaceChildren();E.warnings.textContent='';visibleRecords=20;invalidateExport();}
  function controls(){E.scan.disabled=!ready||busy||!selected;E.demo.disabled=!ready||busy;E.cancel.disabled=!busy;E.file.disabled=busy;}
  function setupWorker(){
    if(worker)worker.terminate();ready=false;E.ready.textContent='正在載入解析器…';controls();
    if(!window.Diag2||Diag2.VERSION!==EXPECTED){fail('程式版本不一致。請重新載入 DIAG-2 頁面；不要使用正式 V1.1 解析器。');return;}
    if(!('Worker' in window)){fail('這個瀏覽器不支援診斷所需的 Worker，請改用 Safari。');return;}
    try{worker=new Worker('./diag2-worker.d2.0.0.js');}catch(_){fail('無法載入診斷程式。請用已部署的 HTTPS 網址，不要直接點本機 HTML。');return;}
    clearTimeout(initTimer);initTimer=setTimeout(()=>{if(!ready)fail('解析器尚未載入，請確認 diagnostic-v2 資料夾內五個檔案均已部署。');},15000);
    worker.onerror=()=>{clearTimeout(initTimer);busy=false;ready=false;fail('解析器載入或執行失敗。請確認全部檔案均為 DIAG-2.0.0；原檔沒有被改寫。');controls();};
    worker.onmessage=({data})=>{
      if(data.type==='ready'){
        clearTimeout(initTimer);if(data.version!==EXPECTED){fail('主頁與解析器版本不一致，請重新部署整個 diagnostic-v2 資料夾。');return;}
        ready=true;E.ready.textContent='解析器已就緒 · 本機處理';controls();
      }else if(data.type==='progress'){
        E.progress.value=Math.min(99,Math.round(data.bytes/data.total*100));
        E.status.textContent=`已讀 ${(data.bytes/1048576).toFixed(1)} / ${(data.total/1048576).toFixed(1)} MiB · ${pretty(data.lines)} 行 · ${pretty(data.targets)} 次目標欄位`;
      }else if(data.type==='done'){
        busy=false;report=data.report;E.progress.value=100;E.status.textContent=`掃描完成：${pretty(report.stats.lines)} 行。請查看候選值與來源警示。`;controls();render();
      }else if(data.type==='error'){
        busy=false;const messages={FILE_REQUIRED:'沒有收到檔案，請重新選取。',FILE_TOO_LARGE:'檔案超過 100 MiB 上限。',EMPTY_FILE:'檔案是空的。',COMPRESSED_FILE:'這是壓縮檔；請使用未壓縮的 Analytics 檔。',UNSUPPORTED_ENCODING:'這份檔案不是支援的 UTF-8 格式。',VERSION_MISMATCH:'解析器版本不一致。',READ_OR_PARSE_FAILED:'讀取或解析失敗；請確認選的是原 Analytics 檔，並已從雲端完整下載。'};
        fail(messages[data.code]||'診斷失敗；不會自動上傳檔案。');E.status.textContent='診斷未完成。';controls();
      }
    };
  }
  function scan(file,demo=false){
    if(!ready||busy||!file)return;
    eraseReport();E.error.hidden=true;E.progress.value=0;busy=true;isDemo=demo;E.status.textContent='開始本機掃描…';controls();
    worker.postMessage({type:'scan',file});
  }
  function recordSelection(){if(!report)return[];return report.records.filter(r=>E.scope.value==='all'||r.scope===E.scope.value||r.values.some(v=>v.scope===E.scope.value));}
  function renderRecords(){
    E.records.replaceChildren();if(!report)return;
    const rs=recordSelection();
    for(const r of rs.slice(0,visibleRecords)){
      const el=node('div',undefined,'record');el.append(node('strong',`${r.ref} · ${Diag2.SCOPES[r.scope]}`));
      el.append(node('div',`來源依據：${r.evidence}`,'note'));
      if(E.showValues.checked&&r.models.length)el.append(node('div',`型號線索：${r.models.join(' / ')}`,'note'));
      if(r.companionModels.length)el.append(node('div',E.showValues.checked?`另見配對 Watch：${r.companionModels.join(' / ')}（不改寫來源）`:'另見配對 Watch 線索（不改寫本物件來源）','note'));
      for(const v of r.values){let text=v.field+(v.scope!==r.scope?' ['+Diag2.SCOPES[v.scope]+']':'');
        if(E.showValues.checked)text+=' = '+(v.localValue??(v.tokens?.length?'[已遮罩] '+v.tokens.join(' / '):v.status==='null'?'null／空值':v.status==='presence-only'?'[識別欄位不保留值]':'[未保留值]'));
        el.append(node('div',text,'record-value'));
      }E.records.append(el);
    }
    if(!rs.length)E.records.append(node('p','此來源篩選沒有保留物件。','empty'));
    E.more.hidden=rs.length<=visibleRecords;
  }
  function renderFields(){
    E.groups.replaceChildren();if(!report)return;
    for(const [g,label] of Object.entries(Diag2.LABELS)){
      const fs=report.fields.filter(f=>f.group===g&&(E.scope.value==='all'||f.scopes[E.scope.value]>0));
      const box=node('details');box.open=fs.length>0;box.append(node('summary',`${label} · ${fs.length} 個命中欄位`));
      if(!fs.length)box.append(node('p','未命中本版白名單；不是斷言原檔完全沒有相關資訊。','empty'));
      for(const f of fs){
        const item=node('div',undefined,'field'),head=node('div',undefined,'field-head');
        head.append(node('code',f.field),node('span',f.valid?'有值，待核對':f.nulls===f.occurrences?'僅有空值':'已見欄位','pill'));
        item.append(head,node('p',`出現 ${f.occurrences} 次 · 可顯示 ${f.valid} 次 · 空值 ${f.nulls} 次 · 遮罩 ${f.redacted+f.presenceOnly} 次${f.invalid?` · 非預期型別 ${f.invalid} 次`:''}`,'note'));
        item.append(node('p',f.note+(f.aggregation==='sum'?' 注意：此欄位是 sum_of_ 聚合數字，不能當成單次容量。':''),'note'));
        item.append(node('p',Object.entries(f.scopes).filter(([,n])=>n).map(([s,n])=>`${Diag2.SCOPES[s]}：${n}`).join('；'),'note'));
        if(E.showValues.checked){
          const vs=f.variants.filter(v=>E.scope.value==='all'||v.scope===E.scope.value);
          for(const v of vs){const display=v.localValue??`[原值已遮罩] ${v.tokens.join(' / ')}`;
            item.append(node('div',`${display}\n${Diag2.SCOPES[v.scope]} · ${v.count} 次 · ${v.refs.join('、')}`,'values'));}
          if(!vs.length)item.append(node('p','沒有可顯示的原值。可能為 null、格式不符或識別欄位。','empty'));
          if(f.omittedVariants)item.append(node('p',`另有 ${f.omittedVariants} 次值因不同值上限而未保留。`,'note'));
        }
        box.append(item);
      }E.groups.append(box);
    }
  }
  function render(){
    E.results.hidden=false;E.demoNotice.hidden=!isDemo;E.stats.replaceChildren();
    for(const [n,label] of [[report.stats.lines,'總行數'],[report.fields.length,'目標欄位種類'],[report.stats.targetObjects,'命中物件'],[report.stats.scopes.unknown,'來源未關聯物件']]){
      const x=node('div',undefined,'metric');x.append(node('strong',pretty(n)),node('span',label));E.stats.append(x);
    }
    E.warnings.textContent=report.warnings.join('\n');
    renderFields();renderRecords();
  }
  E.file.addEventListener('change',()=>{selected=E.file.files?.[0]||null;eraseReport();E.error.hidden=true;E.progress.value=0;E.status.textContent='等待開始。';E.filemeta.textContent=selected?`${selected.name} · ${(selected.size/1048576).toFixed(1)} MiB`:'尚未選取檔案';controls();});
  E.scan.addEventListener('click',()=>scan(selected));
  E.cancel.addEventListener('click',()=>{worker.terminate();busy=false;eraseReport();E.status.textContent='已停止，未產生完整結果；原檔沒有被改寫。';setupWorker();});
  E.clear.addEventListener('click',()=>{if(worker)worker.terminate();busy=false;selected=null;E.file.value='';eraseReport();E.includeValues.checked=false;E.showValues.checked=false;E.progress.value=0;E.filemeta.textContent='尚未選取檔案';E.status.textContent='已清除本頁資料。已下載的 JSON 不會被刪除。';E.error.hidden=true;setupWorker();});
  E.scope.addEventListener('change',()=>{visibleRecords=20;renderFields();renderRecords();});
  E.showValues.addEventListener('change',()=>{renderFields();renderRecords();});
  E.more.addEventListener('click',()=>{visibleRecords+=20;renderRecords();});
  E.includeValues.addEventListener('change',invalidateExport);
  E.preview.addEventListener('click',()=>{if(!report)return;
    const data=Diag2.forExport(report,E.includeValues.checked);data.syntheticDemo=isDemo;
    exportText=JSON.stringify(data,null,2);E.exportPreview.textContent=exportText;E.exportPreview.hidden=false;
    E.download.disabled=false;E.exportInfo.textContent=`預覽內容即下載內容 · ${(new Blob([exportText]).size/1024).toFixed(1)} KiB · ${E.includeValues.checked?'包含受限候選值':'不含欄位值'}。檢查後再下載分享。`;
  });
  E.download.addEventListener('click',()=>{if(exportText===null)return;
    const blob=new Blob([exportText],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=node('a');
    a.href=url;a.download='iPhone_DIAG-2_精準診斷摘要.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  });
  E.demo.addEventListener('click',()=>{
    const records=[
      {ProductType:'iPhone15,2',message:{last_value_CycleCount:123,last_value_MaximumCapacityPercent:95,last_value_MaximumFCC:4000,last_value_NominalChargeCapacity:3800}},
      {message:{nandDesc:'EXAMPLE KIOXIA TLC 256GB',dramSize:8,watchHardwareModel:'Watch6,7',actuatorVendorWide:2,actuatorVendorTele:3}},
      {HardwareModel:'Watch6,7',message:{last_value_CycleCount:40}},
      {message:{sum_of_sysctl_hw_memsize_physical:17179869184,sum_of_deviceNandSize:549755813888,coreRepairStatusRearCameraAssembly:0}},
      {message:{nandDesc:null,HostApplicationDisplayID:'do-not-collect',rsrp_rsrq_per_antenna_panel_rsrp:-80}}
    ];
    E.filemeta.textContent='合成示範資料 · 不是你的 Analytics';scan(new File([records.map(r=>JSON.stringify(r)).join('\n')],'synthetic.txt',{type:'text/plain'}),true);
  });
  window.addEventListener('pagehide',()=>{if(worker)worker.terminate();report=null;exportText=null;ready=false;busy=false;});
  window.addEventListener('pageshow',e=>{if(e.persisted){eraseReport();setupWorker();}});
  setupWorker();
})();
