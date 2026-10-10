/* DIAG-2.0.2 — local, allowlisted evidence extraction. No vendor-code database. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Diag2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'DIAG-2.0.2';
  const LIMITS = Object.freeze({fileBytes:100*1024*1024, chunkBytes:256*1024,
    lineChars:2*1024*1024, depth:24, nodes:20000, retainedRecords:600, variants:24});
  const LABELS = Object.freeze({device:'裝置與來源',battery:'電池',nand:'NAND／儲存',ram:'RAM／記憶體',actuator:'相機致動器',display:'螢幕線索',repair:'維修狀態線索'});
  const SCOPES = Object.freeze({iphone:'同物件／祖先有 iPhone 線索',watch:'同物件／祖先有 Watch 線索',mixed:'裝置線索衝突',related:'配對／遠端／配件子樹',unknown:'未建立來源關聯'});
  const defs = [];
  function def(name, group, kind, note, opts={}) {
    defs.push({name,group,kind,note,...opts});
  }
  const modelNote = '僅為型號線索，不是裝置唯一識別碼；不得據此合併不同紀錄。';
  for (const name of ['ProductType','product_type','HardwareModel','hardware_model','ModelIdentifier','DeviceModel','device_model','modelCode','model_code','model','hw.model'])
    def(name,'device','model',modelNote,{role:'record'});
  def('watchHardwareModel','device','model','配對 Watch 線索；不能據此把同筆 iPhone 電池資料歸給 Watch。',{role:'companion'});
  def('remoteHardwareModel','device','model','遠端裝置線索；不當成本機型號。',{role:'remote'});
  for (const name of ['OSVersion','os_version','iOSVersion','BuildVersion','build_version'])
    def(name,'device','version','版本候選；只保留經嚴格解析的版本與 Build，不保留原始字串，不推定來源裝置。');
  for (const name of ['CycleCount','BatteryCycleCount','CycleCountLastQmax'])
    def(name,'battery','number','原始計數候選；三次出現不代表三顆電池。',{min:0,max:10000,integer:true});
  def('MaximumCapacityPercent','battery','number','健康百分比候選；需和設定中的電池健康度核對。',{min:0,max:150});
  for (const name of ['MaximumFCC','NominalChargeCapacity','DesignCapacity','AppleRawMaxCapacity','RawMaxCapacity'])
    def(name,'battery','number','容量原值；單位與來源未核實。不做 FCC／Nominal 比值推算。',{min:0,max:100000});
  def('BatteryHealthMetric','battery','number','內部指標候選；不當作健康百分比。',{min:0,max:100000});
  def('batteryServiceFlags','battery','number','旗標原值；不擅自解碼。',{min:0,max:4294967295,integer:true});
  def('BatteryPackID','battery','presence','僅計數；不保留電池組識別碼。');
  def('nandDesc','nand','descriptor','NAND 候選：有限範圍的數字代碼僅供本機查看，不匯出；未知字串不解碼成供應商。');
  for (const name of ['deviceNandSize','StorageCapacity','DiskCapacity'])
    def(name,'nand','number','容量候選；未提供單位或聚合筆數前，不換算銷售容量。',{min:0,max:9007199254740991});
  for (const name of ['averageTLCPECycles','ESR_averageTLCPECycles','directToTLCSectors','nandReads','nandWrites'])
    def(name,'nand','number','運作／寫入統計。欄名含 TLC 不足以證明顆粒類型。',{min:0,max:9007199254740991});
  def('default-bits-per-cell','nand','number','每單元位元數候選；先核實來源與語意，不產生品質評級。',{min:1,max:8,integer:true});
  for (const name of ['dramSize','sysctl_hw_memsize','sysctl_hw_memsize_physical','RAMCapacity','DRAMCapacity'])
    def(name,'ram','number','記憶體候選原值。sum_of_ 是聚合標記，不直接當成單台實體 RAM。',{min:0,max:9007199254740991});
  for (const name of ['actuatorVendorWide','actuatorVendorTele','actuatorVendorSuperWide'])
    def(name,'actuator','code','致動器供應商代碼候選，不等於感光元件或完整相機模組製造商。');
  for (const name of ['DisplayVendorID','PanelVendorID','DisplayManufacturer','PanelManufacturer','panel-prefix','panel_prefix'])
    def(name,'display','code','面板線索候選；沒有可靠對照資料時不解碼。');
  def('coreRepairStatusRearCameraAssembly','repair','code','維修狀態候選；未知枚舉不代表故障，也不代表已更換零件。');
  const BY_KEY = new Map(defs.map(d=>[d.name.toLowerCase(),d]));
  const PREFIXES = ['last_value_','first_value_','sum_of_','avg_','max_','min_'];
  const PRIVATE_KEY = /serial|imei|udid|ecid|iccid|uuid|guid|bssid|ssid|mac.?address|device.?id|account|user.?name|user.?id|email|phone.?number|address|location|longitude|latitude|token|secret|password|credential|keychain|advertising|idfa|session|crashreporter|file.?path|bundle.?identifier/i;
  const RELATED_KEY = /^(?:watch|watches|applewatch|pairedwatch|companion|companions|paireddevice|paireddevices|remote|remotedevice|accessory|accessories|bluetooth|peripheral|peripherals)$/i;
  const MODEL = /^(iPhone|Watch|iPad|Mac|MacBookPro|MacBookAir|iMac|Macmini|iPod)\d{1,2},\d{1,2}$/i;
  const SENSITIVE = /(?:https?:\/\/|[a-z\d._%+-]+@[a-z\d.-]+\.[a-z]{2,}|\b\d{1,3}(?:\.\d{1,3}){3}\b|(?:[\da-f]{2}[:-]){5}[\da-f]{2}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}|\b\d{10,}\b|\b[\da-f]{16,}\b|serial|imei|udid|ecid|iccid|password|token|account)/i;
  function resolve(key) {
    if (typeof key !== 'string' || key.length > 120 || PRIVATE_KEY.test(key)) return null;
    let k=key.toLowerCase(), prefix='';
    // Known dotted scalar keys are allowed; arbitrary paths are never exported.
    if (!BY_KEY.has(k) && k.startsWith('message.')) k=k.slice(8);
    for (const p of PREFIXES) if (k.startsWith(p)) {prefix=p;k=k.slice(p.length);break;}
    const d=BY_KEY.get(k);
    return d ? {...d,field:prefix+d.name,aggregation:prefix==='sum_of_'?'sum':prefix==='last_value_'?'last':prefix==='first_value_'?'first':prefix?'other':'raw'} : null;
  }
  function modelValue(value) {
    if (typeof value!=='string') return null;
    const v=value.trim(); return MODEL.test(v)?v:null;
  }
  function descriptorTokens(value) {
    if (typeof value!=='string') return [];
    const matches=value.match(/\b(?:KIOXIA|TOSHIBA|SAMSUNG|HYNIX|MICRON|SANDISK|WESTERN DIGITAL|SK HYNIX|TLC|QLC|MLC|SLC|(?:16|32|64|128|256|512|1024|2048)\s*(?:GB|GiB)|(?:1|2|4)\s*(?:TB|TiB))\b/gi)||[];
    return [...new Set(matches.map(x=>x.toUpperCase().replace(/\s+/g,' ')))].slice(0,10);
  }
  // Only extract a strict version and optional Apple-style build from a bounded,
  // anchored string. Never copy arbitrary source text into UI/export.
  // An extracted version remains a *candidate* without device provenance.
  function normalizedVersion(value) {
    if (typeof value!=='string'||value.length>160) return null;
    const v=value.trim().replace(/\s+/g,' ');
    if (!v||SENSITIVE.test(v))return null;
    const m=v.match(/^(?:(iPhone OS|iOS|iPadOS|watchOS|macOS|OS Version|Version)[ :=]*)?(\d{1,2}(?:\.\d{1,3}){1,3})(?:\s*[-–]\s*(\d{1,2}(?:\.\d{1,3}){1,3}))?(?:\s*\(\s*(?:Build\s+)?([0-9]{1,3}[A-Z][0-9]{1,5}[a-z]?)\s*\)|\s+([0-9]{1,3}[A-Z][0-9]{1,5}[a-z]?))?$/i);
    if (!m)return null;
    const product=m[1] ? m[1].replace(/^(?:OS Version|Version)$/i,'OS').replace(/\s+/g,' ') : '';
    const build=m[4]||m[5]||'';
    return `${product?product+' ':''}${m[2]}${m[3]?'–'+m[3]:''}${build?' ('+build+')':''}`;
  }
  // Privacy-preserving classification only. Do not retain a nandDesc numeric
  // value when it does not match the existing local-only allow policy.
  // The source JSON numeric representation may already be rounded by JSON.parse.
  function nandNumericShape(value) {
    if (typeof value !== 'number') return 'non-number';
    if (!Number.isFinite(value)) return 'non-finite';
    if (value < 0) return Number.isInteger(value) ? 'negative-integer' : 'negative-fraction';
    if (!Number.isInteger(value)) return 'nonnegative-fraction';
    if (!Number.isSafeInteger(value)) return 'unsafe-integer';
    if (value > 0xffffffff) return 'integer-above-uint32';
    return 'uint32-local-only';
  }
  function sanitize(d,value) {
    if (value===null) return {status:'null',type:'null'};
    const type=typeof value;
    if (d.kind==='presence') return {status:'presence-only',type};
    if (!['number','string'].includes(type)) return {status:'invalid',type};
    if (type==='string' && /^(?:\s*|null|undefined|nan|unknown|none|n\/a)$/i.test(value.trim())) return {status:'null',type};
    if (d.kind==='number') {
      const s=String(value).trim();
      if (!/^\d+(?:\.\d+)?$/.test(s)) return {status:'invalid',type};
      const n=Number(s);
      if (!Number.isFinite(n)||n<d.min||n>d.max||(d.integer&&!Number.isInteger(n))||Math.abs(n)>Number.MAX_SAFE_INTEGER)
        return {status:'invalid',type};
      return {status:'value',type,localValue:s,exportValue:s,exportKind:'number-candidate'};
    }
    if (d.kind==='model') {
      const v=modelValue(value); return v?{status:'value',type,localValue:v,exportValue:v,exportKind:'model-candidate'}:{status:'redacted',type};
    }
    const v=String(value).trim();
    if (d.kind==='version') {
      const normalized=normalizedVersion(v);
      return normalized
        ? {status:'value',type,localValue:normalized,exportValue:normalized,exportKind:'normalized-version-candidate'}
        : {status:'redacted',type,exportKind:'unrecognized-version-format'};
    }
    if (d.kind==='descriptor') {
      // nandDesc was wrongly treated only as a text descriptor in DIAG-2.0.0.
      // Keep bounded numeric enums on device only. Unknown numeric values could be
      // identifying hardware data; NEVER export them, even with includeValues=true.
      if ((type==='number' || /^\d{1,5}$/.test(v)) && /^\d{1,10}$/.test(v)) {
        const n=Number(v);
        if (Number.isSafeInteger(n) && n>=0 && n<=0xffffffff)
          return {status:'value',type,localValue:type==='string'?v:String(n),exportValue:null,exportKind:'numeric-nand-local-only'};
        return {status:'redacted',type,exportKind:'numeric-nand-out-of-policy'};
      }
      if (type==='number' || /^\d+$/.test(v))return {status:'redacted',type,exportKind:'numeric-nand-out-of-policy'};
      const tokens=descriptorTokens(v);
      const safe=v.length<=160 && !SENSITIVE.test(v) && /^[\w .,:;()\[\]+/\-]+$/.test(v) && !/\b[a-z\d]{16,}\b/i.test(v);
      return {status:safe?'value':'redacted',type,...(safe?{localValue:v}:{}),tokens,
        exportKind:'descriptor-tokens-only',exportValue:tokens.length?tokens.join(' | ')+' | [其他描述已遮罩]':null};
    }
    // Unknown string codes remain local. Export only numeric enums or a tiny lexical whitelist.
    if (v.length>40||SENSITIVE.test(v)||!/^[a-z\d._+ /\-]+$/i.test(v)||/^[a-z\d]{13,}$/i.test(v)) return {status:'redacted',type};
    let exportValue=null;
    if (/^\d{1,5}$/.test(v) && Number(v)<=65535) exportValue=v;
    if (/^(?:LG|LGIT|SAMSUNG|SONY|KIOXIA|TOSHIBA|HYNIX|SK HYNIX|MICRON|FOXCONN|SHARP|BOE|TLC|QLC|MLC|SLC)$/i.test(v)) exportValue=v;
    return {status:'value',type,localValue:v,exportValue,exportKind:exportValue===null?'masked-code':'enum-candidate'};
  }
  function fresh() {
    return {version:VERSION,stats:{lines:0,blankLines:0,jsonLines:0,nonJsonLines:0,oversizeLines:0,limitedRecords:0,ignoredKeys:0,
      targetOccurrences:0,targetObjects:0,retainedObjects:0,omittedObjects:0,summaryInputs:0,
      nandDescNumericShape:{'uint32-local-only':0,'integer-above-uint32':0,'unsafe-integer':0,
        'nonnegative-fraction':0,'negative-integer':0,'negative-fraction':0,'non-finite':0,'non-number':0},
      scopes:Object.fromEntries(Object.keys(SCOPES).map(k=>[k,0]))},fields:new Map(),records:[],
      hints:{record:new Set(),companion:new Set(),remote:new Set(),related:new Set()},fieldLimit:false};
  }
  function directEvidence(node,related) {
    const models=[]; const companions=[];const remotes=[];
    for (const key of Object.keys(node)) {
      const d=resolve(key); if (!d||d.kind!=='model') continue;
      const v=modelValue(node[key]); if (!v) continue;
      if (d.role==='companion') companions.push(v);
      else if(d.role==='remote') remotes.push(v);
      else models.push(v);
    }
    const unique=[...new Set(models)];
    const types=new Set(unique.map(x=>/^iPhone/i.test(x)?'iphone':/^Watch/i.test(x)?'watch':'related'));
    return {models:unique,companions:[...new Set(companions)],remotes:[...new Set(remotes)],scope:related?'related':unique.length>1?'mixed':types.size===1?[...types][0]:'unknown'};
  }
  function addField(state,d,s,scope,ref) {
    let f=state.fields.get(d.field);
    if(!f){f={field:d.field,group:d.group,kind:d.kind,role:d.role||'',aggregation:d.aggregation,note:d.note,
      occurrences:0,valid:0,nulls:0,invalid:0,redacted:0,presenceOnly:0,types:{},scopes:Object.fromEntries(Object.keys(SCOPES).map(k=>[k,0])),variants:[],omittedVariants:0};state.fields.set(d.field,f);}
    f.occurrences++; f.scopes[scope]++;f.types[s.type]=(f.types[s.type]||0)+1;
    if(s.status==='value')f.valid++; else if(s.status==='null')f.nulls++;else if(s.status==='redacted')f.redacted++;else if(s.status==='presence-only')f.presenceOnly++;else f.invalid++;
    const visible=s.localValue!==undefined||s.tokens?.length;
    if(visible){
      const signature=JSON.stringify([s.localValue||null,s.exportValue||null,scope]);
      let v=f.variants.find(x=>x.signature===signature);
      if(!v){if(f.variants.length>=LIMITS.variants){f.omittedVariants++;return;}
        v={signature,scope,status:s.status,type:s.type,localValue:s.localValue??null,exportValue:s.exportValue??null,exportKind:s.exportKind||null,tokens:s.tokens||[],count:0,refs:[]};f.variants.push(v);}
      v.count++;if(v.refs.length<5)v.refs.push(ref);
    }
  }
  function ingestObject(root,state,lineNumber) {
    let nodes=0, limited=false, oid=0;
    function walk(node,inherited,related,depth) {
      if(node===null||typeof node!=='object')return;
      if(depth>LIMITS.depth||nodes>=LIMITS.nodes){limited=true;return;}
      if(Array.isArray(node)) { for(const item of node){if(nodes>=LIMITS.nodes){limited=true;break;}walk(item,inherited,related,depth+1);}return; }
      const thisOID=++oid; nodes++;
      const ev=directEvidence(node,related);
      const ctx=ev.models.length?{scope:ev.scope,models:ev.models,evidence:'same-object'}:
        inherited?{...inherited,evidence:'ancestor-object'}:{scope:related?'related':'unknown',models:[],evidence:'none'};
      if(related){ctx.scope='related';ctx.evidence=ev.models.length?'related-object':'related-context';}
      for(const v of ev.models)state.hints[related?'related':'record'].add(v);
      for(const v of ev.companions)state.hints.companion.add(v);
      for(const v of ev.remotes)state.hints.remote.add(v);
      const values=[];
      const ref=`L${lineNumber}-O${thisOID}`;
      const keys=Object.keys(node);
      for(const key of keys){
        if(++nodes>LIMITS.nodes){limited=true;break;}
        const d=resolve(key);if(!d){state.stats.ignoredKeys++;continue;}
        const val=node[key];
        if (d.field==='nandDesc') {
          const shape=nandNumericShape(val);
          state.stats.nandDescNumericShape[shape]++;
        }
        const s=sanitize(d,val);
        // A companion model is evidence about the companion only, never about sibling metrics.
        const fieldScope=(d.role==='companion'||d.role==='remote')?'related':ctx.scope;
        addField(state,d,s,fieldScope,ref);state.stats.targetOccurrences++;
        values.push({field:d.field,group:d.group,scope:fieldScope,...s});
      }
      if(values.length){
        state.stats.targetObjects++;state.stats.scopes[ctx.scope]++;
        if(state.records.length<LIMITS.retainedRecords){state.records.push({ref,scope:ctx.scope,evidence:ctx.evidence,
          models:ctx.models,companionModels:ev.companions,remoteModels:ev.remotes,values});state.stats.retainedObjects++;}
        else state.stats.omittedObjects++;
      }
      for(const key of keys){
        if(nodes>=LIMITS.nodes){limited=true;break;}
        if(PRIVATE_KEY.test(key))continue;
        const val=node[key];
        if(val&&typeof val==='object')walk(val,ctx,related||RELATED_KEY.test(key),depth+1);
      }
    }
    walk(root,null,false,0);
    if(limited)state.stats.limitedRecords++;
  }
  function ingestLine(line,state) {
    state.stats.lines++;
    if(line.length>LIMITS.lineChars){state.stats.oversizeLines++;return;}
    const t=line.trim().replace(/^\uFEFF/,'');
    if(!t){state.stats.blankLines++;return;}
    let obj;try{obj=JSON.parse(t);}catch(_){state.stats.nonJsonLines++;return;}
    state.stats.jsonLines++;
    if(obj&&typeof obj==='object'&&!Array.isArray(obj)&&
      (obj.tool==='iPhone 本機硬體欄位診斷'||obj.tool==='iPhone 精準硬體診斷')){state.stats.summaryInputs++;return;}
    ingestObject(obj,state,state.stats.lines);
  }
  function result(state) {
    const fields=[...state.fields.values()].map(f=>({...f,variants:f.variants.map(({signature,...v})=>v)}));
    fields.sort((a,b)=>Object.keys(LABELS).indexOf(a.group)-Object.keys(LABELS).indexOf(b.group)||a.field.localeCompare(b.field));
    const warnings=[];
    state.stats.omittedModelHints=Object.values(state.hints).reduce((s,v)=>s+Math.max(0,v.size-30),0);
    if(state.stats.omittedModelHints)warnings.push('型號候選清單已達保留上限，未顯示所有候選。');
    if(state.stats.nonJsonLines)warnings.push(`${state.stats.nonJsonLines} 行不是單行 JSON，未猜測解析。診斷可能不完整。`);
    if(state.stats.oversizeLines||state.stats.limitedRecords||state.stats.omittedObjects||fields.some(f=>f.omittedVariants))
      warnings.push('已達部分大小／保留上限。請參考統計；沒有展示不代表原檔沒有。');
    if(state.stats.summaryInputs)warnings.push('選到已匯出的診斷摘要；摘要無法還原原值，請在手機選原 Analytics 檔。');
    if(state.stats.targetOccurrences===0)warnings.push('沒有命中目標欄位。可能是檔案類型、格式或欄位不同，不代表硬體不存在。');
    const shapeInfo=Object.entries(state.stats.nandDescNumericShape).filter(([,n])=>n>0);
    if(shapeInfo.length)warnings.push('nandDesc 數值形態統計（不含原值）：'+shapeInfo.map(([k,n])=>k+'='+n).join('；')+'。這是 JSON.parse 後的數值分類，不代表 NAND 廠商或品質。');
    warnings.push('來源標籤只反映同物件／祖先的型號線索，不是經 Apple 驗證的裝置身分。未知來源不自動歸到 iPhone。');
    warnings.push('不跨物件拼接電池、RAM 或 NAND 數值；sum_of_ 保留為聚合原值。沒有供應商代碼對照庫。');
    return {tool:'iPhone 精準硬體診斷',version:VERSION,limits:LIMITS,stats:{...state.stats},
      modelHints:Object.fromEntries(Object.entries(state.hints).map(([k,v])=>[k,[...v].slice(0,30)])),fields,records:state.records,warnings};
  }
  function forExport(report,includeValues=false) {
    // Build a fresh object. Do not rely on blacklisting properties from the private report.
    return {tool:report.tool,version:VERSION,privacy:{noAutomaticUpload:true,rawLinesExported:false,
        originalFilenameExported:false,arbitraryIdentifiersExported:false,includesAllowedValues:!!includeValues,
        descriptorPolicy:'nandDesc 原始數字不匯出；僅匯出數字形態統計，文字保留白名單詞彙，不推定廠商'},
      stats:report.stats,limits:report.limits,warnings:report.warnings,
      ...(includeValues?{modelHints:report.modelHints}:{}),
      fields:report.fields.map(f=>({field:f.field,group:f.group,kind:f.kind,role:f.role,aggregation:f.aggregation,
        occurrences:f.occurrences,valid:f.valid,nulls:f.nulls,invalid:f.invalid,redacted:f.redacted,
        presenceOnly:f.presenceOnly,types:f.types,scopes:f.scopes,omittedVariants:f.omittedVariants,
        values:includeValues?f.variants.map(v=>({scope:v.scope,value:v.exportValue,
          masked:v.exportValue===null||v.exportKind==='descriptor-tokens-only',kind:v.exportKind,count:v.count,refs:v.refs})):[]})),
      records:report.records.map(r=>({ref:r.ref,scope:r.scope,evidence:r.evidence,
        ...(includeValues?{models:r.models,companionModels:r.companionModels,remoteModels:r.remoteModels}:{}),
        values:r.values.map(v=>({field:v.field,group:v.group,scope:v.scope,status:v.status,type:v.type,
          ...(includeValues?{value:v.exportValue??null,masked:v.exportValue==null||v.exportKind==='descriptor-tokens-only',kind:v.exportKind||null}:{})}))}))};
  }
  async function scanBlob(blob,onProgress=()=>{}) {
    if(!blob||typeof blob.slice!=='function')throw Error('FILE_REQUIRED');
    if(blob.size>LIMITS.fileBytes)throw Error('FILE_TOO_LARGE');
    if(blob.size===0)throw Error('EMPTY_FILE');
    const signature=new Uint8Array(await blob.slice(0,4).arrayBuffer());
    if(signature[0]===31&&signature[1]===139)throw Error('COMPRESSED_FILE');
    if((signature[0]===255&&signature[1]===254)||(signature[0]===254&&signature[1]===255))throw Error('UNSUPPORTED_ENCODING');
    const state=fresh(),decoder=new TextDecoder('utf-8');let carry='',discard=false,lastTime=0;
    function chunk(text){
      let start=0;
      while(start<text.length){
        const end=text.indexOf('\n',start);
        const part=text.slice(start,end<0?text.length:end);
        if(!discard){
          if(carry.length+part.length>LIMITS.lineChars){carry='';discard=true;}
          else carry+=part;
        }
        if(end<0)break;
        if(discard){state.stats.lines++;state.stats.oversizeLines++;}else ingestLine(carry,state);
        carry='';discard=false;start=end+1;
      }
    }
    for(let offset=0;offset<blob.size;offset+=LIMITS.chunkBytes){
      const end=Math.min(offset+LIMITS.chunkBytes,blob.size);
      chunk(decoder.decode(await blob.slice(offset,end).arrayBuffer(),{stream:true}));
      const now=Date.now();if(now-lastTime>=100||end===blob.size){onProgress({bytes:end,total:blob.size,lines:state.stats.lines,targets:state.stats.targetOccurrences});lastTime=now;}
    }
    chunk(decoder.decode());
    if(discard){state.stats.lines++;state.stats.oversizeLines++;}else if(carry)ingestLine(carry,state);
    return result(state);
  }
  return {VERSION,LIMITS,LABELS,SCOPES,definitions:defs,resolve,sanitize,fresh,ingestLine,result,forExport,scanBlob};
});
