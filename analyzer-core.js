/* iPhone local analyzer core — no network, no telemetry, no persistent storage */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LocalIPhoneAnalyzer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const GROUPS = Object.freeze({
    device: ["ProductType", "product_type", "ModelIdentifier", "DeviceModel", "HardwareModel", "OSVersion", "osVersion", "BuildVersion", "StorageCapacity", "DiskCapacity"],
    battery: ["CycleCount", "BatteryCycleCount", "MaximumFCC", "NominalChargeCapacity", "DesignCapacity", "RawMaxCapacity", "AppleRawMaxCapacity", "AppleRawCurrentCapacity", "MaximumCapacityPercent", "BatteryHealthMetric"],
    storage: ["nand-marketing-name", "NANDVendor", "NANDManufacturer", "SSDModel", "StorageModel", "default-bits-per-cell", "cell-type"],
    memory: ["DRAMCapacity", "RAMCapacity", "MemoryVendor", "MemoryManufacturer", "DRAMVendor", "DRAMManufacturer", "RAMVendor", "RAMManufacturer"],
    display: ["DisplayVendorID", "PanelVendorID", "DisplayManufacturer", "PanelManufacturer", "DisplayModel", "PanelModel", "panel-prefix", "panel_prefix", "display-vendor", "display_vendor"],
    camera: ["CameraVendor", "CameraManufacturer", "CameraModule", "FrontCameraVendor", "RearCameraVendor", "MainCameraVendor", "UltraWideCameraVendor", "TelephotoCameraVendor", "WideCameraVendor"]
  });
  const KEY_GROUP = Object.create(null);
  for (const [group, keys] of Object.entries(GROUPS)) for (const key of keys) KEY_GROUP[key.toLowerCase()] = [group, key];
  const KEYS = [...new Set(Object.values(GROUPS).flat())].sort((a, b) => b.length - a.length);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const FIELD_RE = new RegExp('(?:^|[,{\\s])(?:["\\\']?)(?:last_value_)?(' + KEYS.map(esc).join('|') + ')(?:["\\\']?)\\s*[:=]\\s*(?:"([^"\\n]{0,120})"|\\\'([^\\\'\\n]{0,120})\\\'|([^,}\\]\\s]{1,120}))', 'gi');
  const QUICK_RE = /(?:producttype|modelidentifier|hardwaremodel|cyclecount|maximumfcc|chargecapacity|batteryhealthmetric|maximumcapacitypercent|osversion|buildversion|diskcapacity|storagecapacity|dramcapacity|ramcapacity|memoryvendor|nand|displayvendor|camera|panel|bits-per-cell|memsize)/i;
  const INVALID = /^(?:null|undefined|nan|none|n\/a|unknown|false|-)$/i;
  const SERIALISH = /(?:imei|udid|ecid|iccid|serial|macaddress|deviceid|advertisingidentifier)/i;
  const NUMERIC_KEYS = new Set(["CycleCount", "BatteryCycleCount", "MaximumFCC", "NominalChargeCapacity", "DesignCapacity", "RawMaxCapacity", "AppleRawMaxCapacity", "AppleRawCurrentCapacity", "MaximumCapacityPercent", "BatteryHealthMetric", "DRAMCapacity", "RAMCapacity", "StorageCapacity", "DiskCapacity", "default-bits-per-cell"]);

  const fresh = () => ({
    fields: Object.fromEntries(Object.keys(GROUPS).map(g => [g, Object.create(null)])),
    lineCount: 0,
    candidates: { iphone: new Set(), watch: new Set() },
    skippedWatchLines: 0,
    skippedInvalidValues: 0,
    ignoredMemSize: 0,
    scopedIPhone: false,
    distinctSources: new Set()
  });

  function valueOK(key, value) {
    if (!value || value.length > 120 || INVALID.test(value)) return false;
    if (SERIALISH.test(value)) return false;
    if (!NUMERIC_KEYS.has(key) && /(?:[a-f0-9]{16,}|\d{12,})/i.test(value)) return false;
    if (NUMERIC_KEYS.has(key)) {
      if (!/^\d+(?:\.\d+)?$/.test(value)) return false;
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0) return false;
      if ((key === "CycleCount" || key === "BatteryCycleCount") && num > 10000) return false;
      if (["MaximumFCC", "NominalChargeCapacity", "DesignCapacity", "RawMaxCapacity", "AppleRawMaxCapacity", "AppleRawCurrentCapacity"].includes(key) && (num < 100 || num > 30000)) return false;
      if (key === "MaximumCapacityPercent" && (num < 1 || num > 120)) return false;
    } else {
      if (!/^[a-z\d.\s_+\-/()%,:]+$/i.test(value)) return false;
    }
    return true;
  }

  function ingestLine(line, state) {
    state.lineCount++;
    if (!line || !QUICK_RE.test(line)) return;
    // A Watch can be present in the same CoreAnalytics file. Never assign an explicitly
    // Watch-scoped row to the iPhone.
    const watch = /(?:"|')?(?:HardwareModel|ProductType|ModelIdentifier|DeviceModel)(?:"|')?\s*[:=]\s*(?:"|')?Watch\d{1,2},\d{1,2}/i.test(line);
    if (watch) state.skippedWatchLines++;
    const found = [];
    FIELD_RE.lastIndex = 0;
    for (const match of line.matchAll(FIELD_RE)) {
      const pair = KEY_GROUP[match[1].toLowerCase()];
      if (!pair) continue;
      const [group, key] = pair;
      const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
      if (!valueOK(key, value)) { state.skippedInvalidValues++; continue; }
      found.push({ group, key, value });
    }
    for (const {key, value} of found) {
      if (["HardwareModel", "ProductType", "ModelIdentifier", "DeviceModel"].includes(key) && /^Watch\d{1,2},\d{1,2}$/i.test(value)) state.candidates.watch.add(value);
      if (["HardwareModel", "ProductType", "ModelIdentifier", "DeviceModel"].includes(key) && /^iPhone\d{1,2},\d{1,2}$/i.test(value)) state.candidates.iphone.add(value);
    }
    if (watch) return;
    // This check applies per line. Records without a model remain unscoped candidates.
    const iphoneLine = found.some(({key, value}) => ["HardwareModel", "ProductType", "ModelIdentifier", "DeviceModel"].includes(key) && /^iPhone\d{1,2},\d{1,2}$/i.test(value));
    if (iphoneLine) state.scopedIPhone = true;
    for (const {group, key, value} of found) {
      if (group === "device" && ["HardwareModel", "ProductType", "ModelIdentifier", "DeviceModel"].includes(key) && !/^iPhone\d{1,2},\d{1,2}$/i.test(value)) continue;
      // Do not treat generic, ambiguously sourced 'memSize' as physical RAM.
      const values = (state.fields[group][key] ||= new Set());
      if (values.size < 12) values.add(value);
    }
    if (/\bmemSize\b/i.test(line)) state.ignoredMemSize++;
  }

  function vals(state, group, key) { return [...(state.fields[group][key] || [])]; }
  function pick(state, group, keys) { for (const key of keys) { const v = vals(state, group, key)[0]; if (v) return {key, value:v}; } return null; }
  function details(state, group, keys) {
    const list = [];
    for (const key of keys) for (const v of vals(state, group, key)) list.push(`${key}: ${v}`);
    return list.slice(0, 35).join("\n");
  }
  function safeBytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return null;
    return `${(v / 1073741824).toFixed(1)} GiB`;
  }
  function card(title, value, sub, note="") { return {title, value: value || "未確認", sub: sub || "", note}; }
  function buildReport(file, state) {
    const deviceID = [...state.candidates.iphone];
    const watchIDs = [...state.candidates.watch];
    const explicitDevice = deviceID.length === 1 ? deviceID[0] : "";
    const unscoped = "注意：部分紀錄未標示來源裝置，數值僅供核對，不能直接認定為這台 iPhone。";
    const cycles = pick(state, "battery", ["CycleCount", "BatteryCycleCount"]);
    const pct = pick(state, "battery", ["MaximumCapacityPercent"]);
    const storage = pick(state, "device", ["StorageCapacity", "DiskCapacity"]);
    const nand = pick(state, "storage", ["nand-marketing-name", "NANDVendor", "NANDManufacturer", "SSDModel", "StorageModel"]);
    const panel = pick(state, "display", ["DisplayManufacturer", "PanelManufacturer", "display-vendor", "display_vendor", "DisplayVendorID", "PanelVendorID"]);
    const camera = pick(state, "camera", ["CameraManufacturer", "CameraVendor", "MainCameraVendor", "RearCameraVendor", "CameraModule"]);
    const ram = pick(state, "memory", ["RAMCapacity", "DRAMCapacity"]);
    const versionVariants = [...new Set([...vals(state, "device", "OSVersion"), ...vals(state, "device", "osVersion")])];
    const systemValue = versionVariants.length === 1 ? versionVariants[0] : "未確認";
    const cards = [
      card("機型識別碼", explicitDevice || "未確認", `iPhone 候選碼：${deviceID.length ? deviceID.join("、") : "未取得"}${watchIDs.length ? `\n已排除 Watch：${watchIDs.join("、")}` : ""}`, !explicitDevice ? "不得由 Watch 型號推定 iPhone 機型" : "僅顯示原始識別碼，未作機型名稱推斷"),
      card("iOS / Build", systemValue, details(state, "device", ["OSVersion", "osVersion", "BuildVersion"]), versionVariants.length > 1 ? "同一份檔案有多種版本，來源裝置未能核實" : (explicitDevice ? "未能證明該版本與機型碼屬於同一筆紀錄" : "來源裝置尚未驗證")),
      card("電池循環（候選）", cycles ? `${cycles.value} 次` : "未取得", details(state, "battery", ["CycleCount", "BatteryCycleCount"]), cycles ? "擷取自 Analytics；請用 iPhone 設定中的電池資訊交叉核對" : ""),
      card("電池健康度", pct ? `${pct.value}%` : "未確認", details(state, "battery", ["MaximumCapacityPercent", "MaximumFCC", "NominalChargeCapacity", "DesignCapacity", "RawMaxCapacity", "AppleRawMaxCapacity", "BatteryHealthMetric"]), pct ? "僅讀取 MaximumCapacityPercent 候選值，非由 FCC 與 NominalChargeCapacity 推算" : "不能直接使用 FCC ÷ NominalChargeCapacity 當健康度；BatteryHealthMetric 也不是健康百分比"),
      card("儲存容量", storage ? (/^\d+$/.test(storage.value) && Number(storage.value) > 1073741824 ? safeBytes(storage.value) : storage.value) : "未取得", details(state, "device", ["StorageCapacity", "DiskCapacity"]), storage ? "候選欄位；需確認是總容量而非其他統計值" : ""),
      card("NAND / SSD", nand ? nand.value : "未取得", details(state, "storage", GROUPS.storage), nand ? "供應商或類型需再核實；不作頂級評分" : "分析檔沒有足以確認顆粒廠商的欄位"),
      card("RAM / DRAM", "未確認", details(state, "memory", GROUPS.memory), ram ? `找到 ${ram.key} 候選值，但缺乏裝置關聯證明；不將 memSize 當實體 RAM` : "memSize 屬於模糊的記憶體統計欄位，已停止當成實體 RAM"),
      card("螢幕 / 面板", panel ? panel.value : "未取得", details(state, "display", GROUPS.display), panel ? "原始欄位候選；不等於 Apple 官方供應商品質分級" : "無足夠資料判定供應商"),
      card("相機模組", camera ? camera.value : "未取得", details(state, "camera", GROUPS.camera), camera ? "原始欄位候選；未經供應商代碼比對" : "無足夠資料判定供應商"),
    ];
    const warnings = [
      unscoped,
      ...(watchIDs.length ? ["已偵測 Apple Watch 型號並排除相關紀錄。"] : []),
      ...(versionVariants.length > 1 ? ["檔案包含多組 OSVersion，不能任選第一個作為 iPhone 版本。"] : []),
      "未取得的項目表示 Analytics 缺乏足以可靠判定的欄位，不能推測零件供應商。",
    ];
    const safeFields = [];
    for (const [group, keys] of Object.entries(GROUPS)) {
      for (const key of keys) for (const value of vals(state, group, key)) safeFields.push(`${group}.${key}: ${value}`);
    }
    return {fileName:file.name, fileSize:file.size, lineCount:state.lineCount, cards, warnings, rawLines:safeFields, stats:{excludedWatch:state.skippedWatchLines, ignoredMemSize:state.ignoredMemSize, skippedInvalid:state.skippedInvalidValues}};
  }
  return {GROUPS, fresh, ingestLine, buildReport};
});
