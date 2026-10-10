/* iPhone Analytics field diagnostics — privacy-preserving, local-only. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HardwareFieldDiagnostic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.1-DIAG-1';
  const GROUPS = [
    ['device', '裝置與系統', /(?:^|[.\/_-])(?:producttype|product_type|hardwaremodel|modelidentifier|devicemodel|device_model|osversion|iosversion|buildversion|modelnumber|devicefamily)(?:$|[.\/_-])/i],
    ['battery', '電池', /battery|cyclecount|maximumfcc|nominalcharge|designcapacity|rawmaxcapacity|capacitypercent|chargecounter/i],
    ['storage', 'NAND／儲存', /nand|flash|ssd|storage|diskcapacity|bits[-_]?per[-_]?cell|qlc|tlc|ufs/i],
    ['memory', 'RAM／記憶體', /dram|lpddr|ramcapacity|ramsize|memsize|memorycapacity|physicalmemory|memoryvendor|ramvendor/i],
    ['display', '螢幕／面板', /display|panel|oled|screen|lcd|tcon/i],
    ['camera', '相機', /camera|imager|lens|telephoto|ultra[-_]?wide|cmos|imagesensor|sensorsupplier/i],
    ['other', '其他硬體線索', /vendor|manufacturer|hardware|component|partnumber|boardid|chipset|chipid|firmware|factory/i]
  ];
  const CATEGORY_LABELS = Object.fromEntries(GROUPS.map(([id, label]) => [id, label]));
  const FAST = /producttype|product_type|hardwaremodel|modelidentifier|devicemodel|device_model|osversion|iosversion|buildversion|modelnumber|devicefamily|battery|cyclecount|maximumfcc|nominalcharge|designcapacity|rawmaxcapacity|capacitypercent|chargecounter|nand|flash|ssd|storage|diskcapacity|bits.?per.?cell|qlc|tlc|ufs|dram|lpddr|ramcapacity|ramsize|memsize|memorycapacity|physicalmemory|memoryvendor|ramvendor|display|panel|oled|screen|lcd|tcon|camera|imager|lens|telephoto|ultrawide|cmos|imagesensor|sensorsupplier|vendor|manufacturer|hardware|component|partnumber|boardid|chipset|chipid|firmware|factory/i;
  // Do not retain or display private identifiers, including keys containing these tokens.
  const BLOCKED_KEY = /serial|imei|udid|ecid|iccid|uuid|guid|macaddress|mac_address|bssid|ssid|wifi|bluetooth|deviceid|device_id|account|username|userid|user_id|email|phone|address|location|longitude|latitude|geolocation|token|secret|password|credential|privatekey|keychain|advertisingidentifier|idfa|session|ipaddress|ip_address|analyticsid|crashreporterkey|identifierforvendor|filepath|file_path|filename|file_name|processname|bundleidentifier/i;
  const MODEL_KEY = /^(?:producttype|product_type|hardwaremodel|modelidentifier|devicemodel|device_model)$/i;
  const MODEL_VALUE = /^(?:iPhone\d{1,2},\d{1,2}|Watch\d{1,2},\d{1,2})$/i;
  const VALUE_ONLY_SAFE = /^(?:[a-z][a-z0-9._+\-/]{0,23}|[1-9]\d{0,5}(?:\.\d{1,2})?|iPhone\d{1,2},\d{1,2}|Watch\d{1,2},\d{1,2})$/i;
  const UUID_LIKE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
  const SENSITIVE_VALUE = /(?:https?:\/\/|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b\d{7,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[0-9a-f]{2}:){5}[0-9a-f]{2})/i;
  const MAX_FIELDS = 750;
  const MAX_NODES_PER_RECORD = 8000;
  const MAX_LINE = 2_000_000;
  const MAX_FILE_BYTES = 100 * 1024 * 1024;

  function newState(options = {}) {
    return {
      version: VERSION,
      sampleMode: !!options.includeSamples,
      totalLines: 0,
      candidateLines: 0,
      jsonLines: 0,
      nonJsonLines: 0,
      tooLargeLines: 0,
      truncatedNodes: 0,
      suppressedFields: 0,
      scopeCounts: { iphone:0, watch:0, mixed:0, unknown:0 },
      models: { iphone:new Set(), watch:new Set() },
      fields: new Map()
    };
  }

  function safeKey(key) {
    if (typeof key !== 'string' || key.length < 2 || key.length > 70) return false;
    if (!/^[a-z][a-z0-9_.:-]*$/i.test(key)) return false;
    if (BLOCKED_KEY.test(key) || UUID_LIKE.test(key)) return false;
    if (/\d{7,}/.test(key)) return false;
    return true;
  }

  function sampleValue(value, key) {
    if (value == null || typeof value === 'boolean') return null;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const v = String(value).trim();
    if (!v || v.length > 24 || /^(?:null|undefined|nan|unknown|none|n\/a)$/i.test(v)) return null;
    if (BLOCKED_KEY.test(key) || UUID_LIKE.test(v) || SENSITIVE_VALUE.test(v)) return null;
    if (/^[a-z0-9]{16,}$/i.test(v)) return null;
    if (!VALUE_ONLY_SAFE.test(v)) return null;
    return v;
  }

  function groupFrom(pathParts) {
    const full = pathParts.join('.');
    for (const [id, , pattern] of GROUPS) if (pattern.test(full)) return id;
    return null;
  }

  function fieldLabel(pathParts) {
    const leaf = pathParts[pathParts.length - 1];
    const parent = pathParts[pathParts.length - 2];
    // Include parent only for generic leaf names, to distinguish e.g. display.vendor.
    if (/^(?:vendor|manufacturer|vendorid|manufacturerid|model|type|id|capacity|version|name|supplier|revision|part)$/i.test(leaf) && parent && safeKey(parent)) return `${parent}.${leaf}`;
    return leaf;
  }

  function scanJSON(node, path, result, state, budget) {
    if (budget.n++ >= MAX_NODES_PER_RECORD) {budget.truncated = true; return;}
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      // Arrays can contain hundreds of event samples. Keep traversal bounded.
      for (let i = 0; i < Math.min(node.length, 160); i++) scanJSON(node[i], path, result, state, budget);
      if (node.length > 160) budget.truncated = true;
      return;
    }
    for (const [key, val] of Object.entries(node)) {
      if (budget.n >= MAX_NODES_PER_RECORD) {budget.truncated = true; break;}
      if (!safeKey(key)) {state.suppressedFields++; continue;}
      const parts = [...path, key];
      if (MODEL_KEY.test(key) && typeof val === 'string' && MODEL_VALUE.test(val)) {
        if (/^iphone/i.test(val)) result.models.iphone.add(val);
        else result.models.watch.add(val);
      }
      const group = groupFrom(parts);
      if (group && (typeof val === 'number' || typeof val === 'string')) {
        const label = fieldLabel(parts);
        if (safeKey(label.split('.').at(-1))) result.fields.push({group, label, value:val});
      }
      if (val && typeof val === 'object') scanJSON(val, parts.slice(-5), result, state, budget);
      budget.n++;
    }
  }

  function scanLoose(line, result, state) {
    // The fallback only inspects key / scalar pairs, never stores complete raw lines.
    const re = /["']?([a-z][a-z0-9_.:-]{1,69})["']?\s*[:=]\s*(?:["']([^"'\r\n]{0,32})["']|(-?\d{1,7}(?:\.\d{1,3})?))/gi;
    for (const m of line.matchAll(re)) {
      const key = m[1];
      if (!safeKey(key)) {state.suppressedFields++; continue;}
      const val = m[2] ?? m[3];
      if (MODEL_KEY.test(key) && MODEL_VALUE.test(val)) {
        if (/^iphone/i.test(val)) result.models.iphone.add(val);
        else result.models.watch.add(val);
      }
      const group = groupFrom([key]);
      if (group) result.fields.push({group, label:key, value:val});
    }
  }

  function ingestLine(line, state) {
    state.totalLines++;
    if (!line || !FAST.test(line)) return;
    state.candidateLines++;
    if (line.length > MAX_LINE) { state.tooLargeLines++; return; }
    const result = {fields:[], models:{iphone:new Set(),watch:new Set()}};
    const trimmed = line.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const obj = JSON.parse(trimmed);
        state.jsonLines++;
        const budget = {n:0,truncated:false};
        scanJSON(obj, [], result, state, budget);
        if (budget.truncated) state.truncatedNodes++;
      } catch (_) {
        state.nonJsonLines++;
        scanLoose(trimmed, result, state);
      }
    } else {
      state.nonJsonLines++;
      scanLoose(trimmed, result, state);
    }
    const hasIPhone = result.models.iphone.size > 0;
    const hasWatch = result.models.watch.size > 0;
    const scope = hasIPhone && hasWatch ? 'mixed' : hasIPhone ? 'iphone' : hasWatch ? 'watch' : 'unknown';
    state.scopeCounts[scope]++;
    for (const mod of result.models.iphone) state.models.iphone.add(mod);
    for (const mod of result.models.watch) state.models.watch.add(mod);
    const seenThisLine = new Set();
    for (const f of result.fields) {
      const key = `${f.group}\u0001${f.label}\u0001${scope}`;
      if (seenThisLine.has(key)) continue;
      seenThisLine.add(key);
      let item = state.fields.get(key);
      if (!item) {
        if (state.fields.size >= MAX_FIELDS) {state.suppressedFields++; continue;}
        item = {group:f.group, field:f.label, scope, count:0, samples:[]};
        state.fields.set(key,item);
      }
      item.count++;
      // Retain safe, short samples only following explicit user opt-in.
      if (state.sampleMode && item.samples.length < 2) {
        const candidate = sampleValue(f.value, f.label);
        if (candidate !== null && !item.samples.includes(candidate)) item.samples.push(candidate);
      }
    }
  }

  function summarize(state, filename) {
    const items = [...state.fields.values()].sort((a,b) => b.count - a.count || a.group.localeCompare(b.group) || a.field.localeCompare(b.field));
    const categories = Object.fromEntries(GROUPS.map(([id,label]) => [id, {label, count:0, fields:[]} ]));
    for (const item of items) {
      categories[item.group].count += item.count;
      categories[item.group].fields.push({...item, samples:[...item.samples]});
    }
    return {
      tool: 'iPhone 本機硬體欄位診斷', version:VERSION,
      filename: filename ? String(filename).slice(0,100) : '',
      privacy: {uploaded:false, rawLinesExported:false, includesSafeSamples:state.sampleMode},
      counts: {
        totalLines:state.totalLines, candidateLines:state.candidateLines, jsonLines:state.jsonLines,
        nonJsonLines:state.nonJsonLines, tooLargeLines:state.tooLargeLines,
        truncatedNodes:state.truncatedNodes, suppressedFields:state.suppressedFields,
        scope: {...state.scopeCounts}, fieldScopePairs:state.fields.size
      },
      modelCandidates: {iphone:[...state.models.iphone].sort(), watch:[...state.models.watch].sort()},
      categories
    };
  }

  return {VERSION, GROUPS:CATEGORY_LABELS, MAX_FILE_BYTES, MAX_LINE, newState, ingestLine, summarize, sampleValue};
});
