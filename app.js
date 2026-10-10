
"use strict";

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const analyzeBtn = $("analyzeBtn");
const resetBtn = $("resetBtn");
const exportBtn = $("exportBtn");
const fileMeta = $("fileMeta");
const progressWrap = $("progressWrap");
const progressBar = $("progressBar");
const progressText = $("progressText");
const summaryCard = $("summaryCard");
const summaryGrid = $("summaryGrid");
const rawCard = $("rawCard");
const rawOutput = $("rawOutput");

let selectedFile = null;
let lastReport = null;

const FIELD_GROUPS = {
  device: [
    "ProductType","product_type","HardwareModel","ModelIdentifier","DeviceModel",
    "OSVersion","osVersion","BuildVersion","StorageCapacity","DiskCapacity","MemoryCapacity"
  ],
  battery: [
    "CycleCount","BatteryCycleCount","MaximumFCC","NominalChargeCapacity","DesignCapacity",
    "RawMaxCapacity","AppleRawMaxCapacity","AppleRawCurrentCapacity",
    "MaximumCapacityPercent","BatteryHealthMetric","StateOfCharge","Temperature"
  ],
  storage: [
    "nand-marketing-name","NANDVendor","NANDManufacturer","SSDModel","StorageModel",
    "vendor-name","manufacturer-id","chip-id","default-bits-per-cell","cell-type","AppleNANDStatus"
  ],
  display: [
    "DisplayVendorID","PanelVendorID","DisplayManufacturer","PanelManufacturer",
    "DisplayModel","PanelModel","panel-prefix","panel_prefix","display-vendor","display_vendor"
  ],
  memory: [
    "MemoryVendor","MemoryManufacturer","DRAMVendor","DRAMManufacturer",
    "RAMVendor","RAMManufacturer","DRAMCapacity","RAMCapacity","memSize","MemoryCapacity"
  ],
  camera: [
    "CameraVendor","CameraManufacturer","CameraModule","FrontCameraVendor","RearCameraVendor",
    "MainCameraVendor","UltraWideCameraVendor","TelephotoCameraVendor","WideCameraVendor"
  ]
};

const ALL_KEYS = [...new Set(Object.values(FIELD_GROUPS).flat())];
const KEY_RE = new RegExp(ALL_KEYS.map(escapeRegExp).join("|"), "i");
const SENSITIVE_RE = /(IMEI|ECID|UDID|ICCID|MACAddress|SerialNumber|serial-number|deviceSerial)/i;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setProgress(pct, msg) {
  progressWrap.classList.remove("hidden");
  progressBar.style.width = `${pct}%`;
  progressText.textContent = msg;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  const units = ["B","KB","MB","GB","TB"];
  let i=0, v=n;
  while (v>=1024 && i<units.length-1){v/=1024;i++}
  return `${v.toFixed(i===0?0:1)} ${units[i]}`;
}

function safeSizeValue(v) {
  const n = Number(String(v).replace(/[^\d.]/g,""));
  if (!Number.isFinite(n)) return String(v);
  if (n > 1024*1024*1024) return `${v} (${formatBytes(n)})`;
  return String(v);
}

function cleanScalar(v) {
  if (v == null) return "";
  let s = String(v).trim();
  s = s.replace(/^["']|["']$/g,"");
  s = s.replace(/[}\],]+$/,"").trim();
  return s.slice(0, 240);
}

function extractKeyValue(line, key) {
  // JSON / plist-ish / text-ish value forms.
  const k = escapeRegExp(key);
  const patterns = [
    new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"'\\n]{0,240})["']`, "i"),
    new RegExp(`["']?${k}["']?\\s*:\\s*([^,}\\]\\n]{1,240})`, "i"),
    new RegExp(`["']?${k}["']?\\s*=\\s*["']?([^,;}\\]\\n]{1,240})`, "i"),
    new RegExp(`${k}\\s+([^,;}\\]\\n]{1,240})`, "i")
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (m) return cleanScalar(m[1]);
  }
  return "";
}

function ingestLine(line, state) {
  if (!line || !KEY_RE.test(line)) return;
  if (SENSITIVE_RE.test(line)) {
    // We do not retain lines that contain sensitive unique identifiers.
    // A line may also contain target fields; parse only target values, not the whole line.
  }

  let hit = false;
  for (const [group, keys] of Object.entries(FIELD_GROUPS)) {
    for (const key of keys) {
      if (line.toLowerCase().includes(key.toLowerCase())) {
        const val = extractKeyValue(line, key);
        if (val) {
          if (!state.fields[group][key]) state.fields[group][key] = [];
          if (!state.fields[group][key].includes(val)) state.fields[group][key].push(val);
          hit = true;
        }
      }
    }
  }
  if (hit && !SENSITIVE_RE.test(line) && state.rawLines.length < 400) {
    state.rawLines.push(line.slice(0, 4000));
  }
}

async function analyzeFile(file) {
  const state = {
    fields: {device:{},battery:{},storage:{},display:{},memory:{},camera:{}},
    rawLines: [],
    bytesRead: 0,
    lineCount: 0
  };

  const total = file.size || 1;
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let carry = "";

  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    state.bytesRead += value.byteLength;
    carry += decoder.decode(value, {stream:true});

    let start = 0;
    for (let i=0;i<carry.length;i++) {
      if (carry.charCodeAt(i) === 10) {
        const line = carry.slice(start, i);
        ingestLine(line, state);
        state.lineCount++;
        start = i+1;
      }
    }
    carry = carry.slice(start);

    const pct = Math.min(96, Math.round((state.bytesRead/total)*96));
    setProgress(pct, `掃描中… ${pct}% · ${state.lineCount.toLocaleString()} 行`);
    await new Promise(requestAnimationFrame);
  }
  carry += decoder.decode();
  if (carry) {
    ingestLine(carry, state);
    state.lineCount++;
  }
  setProgress(100, `完成 · ${state.lineCount.toLocaleString()} 行`);
  return state;
}

function first(fields, keys) {
  for (const k of keys) {
    const arr = fields[k];
    if (arr && arr.length) return arr[0];
  }
  return "";
}

function all(fields, keys) {
  const out = [];
  for (const k of keys) {
    if (fields[k]) {
      for (const v of fields[k]) out.push(`${k}: ${v}`);
    }
  }
  return [...new Set(out)];
}

function numeric(v) {
  if (!v) return NaN;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function buildReport(file, state) {
  const d = state.fields.device, b = state.fields.battery, s = state.fields.storage,
        dp = state.fields.display, m = state.fields.memory, c = state.fields.camera;

  const productType = first(d, ["ProductType","product_type","ModelIdentifier","DeviceModel","HardwareModel"]);
  const osVersion = first(d, ["OSVersion","osVersion","BuildVersion"]);
  const storageCap = first(d, ["StorageCapacity","DiskCapacity"]);
  const memoryCap = first(m, ["MemoryCapacity","DRAMCapacity","RAMCapacity","memSize"]) || first(d, ["MemoryCapacity"]);

  const cycle = first(b, ["CycleCount","BatteryCycleCount"]);
  const maxFCC = first(b, ["MaximumFCC","AppleRawMaxCapacity","RawMaxCapacity"]);
  const nominal = first(b, ["NominalChargeCapacity","DesignCapacity"]);
  const maxPct = first(b, ["MaximumCapacityPercent","BatteryHealthMetric"]);
  let calcHealth = "";
  const nMax = numeric(maxFCC), nNom = numeric(nominal);
  if (Number.isFinite(nMax) && Number.isFinite(nNom) && nNom > 0) {
    calcHealth = `${(nMax/nNom*100).toFixed(1)}%`;
  }

  const bits = first(s, ["default-bits-per-cell"]);
  let nandType = first(s, ["cell-type"]);
  if (!nandType && bits) {
    const n = numeric(bits);
    if (n === 3) nandType = "TLC";
    else if (n === 4) nandType = "QLC";
    else if (n === 2) nandType = "MLC";
  }

  const report = {
    fileName: file.name,
    fileSize: formatBytes(file.size),
    lineCount: state.lineCount,
    cards: [
      {title:"機型 / 裝置", value: productType || "未取得", sub: all(d,["HardwareModel","ModelIdentifier","DeviceModel"]).join("\n")},
      {title:"iOS / Build", value: osVersion || "未取得", sub: all(d,["OSVersion","osVersion","BuildVersion"]).join("\n")},
      {title:"電池循環", value: cycle ? `${cycle} 次` : "未取得", sub: all(b,["CycleCount","BatteryCycleCount"]).join("\n")},
      {title:"電池容量", value: maxPct ? `${maxPct}%` : (calcHealth || "未取得"),
       sub: all(b,["MaximumFCC","NominalChargeCapacity","DesignCapacity","RawMaxCapacity","AppleRawMaxCapacity","BatteryHealthMetric"]).join("\n")},
      {title:"儲存容量", value: storageCap ? safeSizeValue(storageCap) : "未取得", sub: all(d,["StorageCapacity","DiskCapacity"]).join("\n")},
      {title:"NAND / SSD", value: first(s,["nand-marketing-name","SSDModel","StorageModel","NANDVendor","NANDManufacturer","vendor-name"]) || "未取得",
       sub: [nandType ? `類型: ${nandType}`:"", ...all(s,["manufacturer-id","chip-id","default-bits-per-cell","cell-type","AppleNANDStatus"])].filter(Boolean).join("\n")},
      {title:"RAM / DRAM", value: memoryCap ? safeSizeValue(memoryCap) : (first(m,["MemoryVendor","MemoryManufacturer","DRAMVendor","DRAMManufacturer","RAMVendor"]) || "未取得"),
       sub: all(m,["MemoryVendor","MemoryManufacturer","DRAMVendor","DRAMManufacturer","RAMVendor","RAMManufacturer","DRAMCapacity","RAMCapacity","memSize","MemoryCapacity"]).join("\n")},
      {title:"螢幕 / 面板", value: first(dp,["DisplayManufacturer","PanelManufacturer","display-vendor","display_vendor","DisplayVendorID","PanelVendorID"]) || "未取得",
       sub: all(dp,Object.keys(dp)).join("\n")},
      {title:"相機模組", value: first(c,["CameraManufacturer","CameraVendor","MainCameraVendor","RearCameraVendor","CameraModule"]) || "未取得",
       sub: all(c,Object.keys(c)).join("\n")}
    ],
    rawLines: state.rawLines
  };
  return report;
}

function renderReport(report) {
  summaryGrid.innerHTML = "";
  for (const card of report.cards) {
    const el = document.createElement("div");
    el.className = "result" + (card.value==="未取得" ? " warn" : "");
    const h = document.createElement("h3");
    h.textContent = card.title;
    const v = document.createElement("div");
    v.className = "value";
    v.textContent = card.value;
    const s = document.createElement("div");
    s.className = "sub";
    s.textContent = card.sub || (card.value==="未取得" ? "這份 Analytics 沒有找到可驗證欄位" : "");
    el.append(h,v,s);
    summaryGrid.appendChild(el);
  }
  rawOutput.textContent = report.rawLines.join("\n\n") || "沒有保留到可安全顯示的原始命中行。";
  summaryCard.classList.remove("hidden");
  rawCard.classList.remove("hidden");
}

function reportText(report) {
  const lines = [
    "iPhone 本機硬體分析 PWA V1.0",
    `檔案：${report.fileName}`,
    `大小：${report.fileSize}`,
    `掃描行數：${report.lineCount}`,
    ""
  ];
  for (const c of report.cards) {
    lines.push(`【${c.title}】`);
    lines.push(c.value);
    if (c.sub) lines.push(c.sub);
    lines.push("");
  }
  lines.push("隱私：本報告由瀏覽器本機解析產生，未上傳 Analytics 原始檔。");
  return lines.join("\n");
}

fileInput.addEventListener("change", () => {
  selectedFile = fileInput.files?.[0] || null;
  if (!selectedFile) return;
  const lower = selectedFile.name.toLowerCase();
  const suspicious = lower.includes("session");
  fileMeta.textContent = `${selectedFile.name} · ${formatBytes(selectedFile.size)}${suspicious ? " · 注意：這看起來是 session 檔，建議選非 session 主檔" : ""}`;
  analyzeBtn.disabled = false;
  resetBtn.disabled = false;
  summaryCard.classList.add("hidden");
  rawCard.classList.add("hidden");
  progressWrap.classList.add("hidden");
});

resetBtn.addEventListener("click", () => {
  selectedFile = null;
  lastReport = null;
  fileInput.value = "";
  fileMeta.textContent = "尚未選擇檔案";
  analyzeBtn.disabled = true;
  resetBtn.disabled = true;
  summaryCard.classList.add("hidden");
  rawCard.classList.add("hidden");
  progressWrap.classList.add("hidden");
  progressBar.style.width = "0";
});

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  analyzeBtn.disabled = true;
  resetBtn.disabled = true;
  summaryCard.classList.add("hidden");
  rawCard.classList.add("hidden");
  try {
    setProgress(1, "正在讀取檔案…");
    const state = await analyzeFile(selectedFile);
    lastReport = buildReport(selectedFile, state);
    renderReport(lastReport);
    setProgress(100, `完成 · ${state.lineCount.toLocaleString()} 行`);
  } catch (err) {
    console.error(err);
    setProgress(0, `分析失敗：${err?.message || err}`);
  } finally {
    analyzeBtn.disabled = false;
    resetBtn.disabled = false;
  }
});

exportBtn.addEventListener("click", () => {
  if (!lastReport) return;
  const blob = new Blob([reportText(lastReport)], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `iPhone_硬體分析_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  });
}
