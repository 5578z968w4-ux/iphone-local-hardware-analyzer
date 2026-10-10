"use strict";
const $ = id => document.getElementById(id);
const fileInput = $("fileInput"), analyzeBtn = $("analyzeBtn"), resetBtn = $("resetBtn"), exportBtn = $("exportBtn");
const fileMeta = $("fileMeta"), progressWrap = $("progressWrap"), progressBar = $("progressBar"), progressText = $("progressText");
const summaryCard = $("summaryCard"), summaryGrid = $("summaryGrid"), rawCard = $("rawCard"), rawOutput = $("rawOutput"), warningsOutput = $("warningsOutput");
let selectedFile = null, lastReport = null;

function prettyBytes(n) {
  if (!Number.isFinite(n)) return "";
  const units = ["B", "KiB", "MiB", "GiB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) {v /= 1024; i++;}
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function setProgress(percent, message) {
  progressWrap.classList.remove("hidden");
  progressBar.style.width = `${percent}%`;
  progressText.textContent = message;
}
async function analyzeFile(file) {
  const state = LocalIPhoneAnalyzer.fresh();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  const maxLineChars = 2_000_000;
  let carry = "", bytes = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      carry += decoder.decode(value, {stream:true});
      let pos = 0;
      while (true) {
        const end = carry.indexOf("\n", pos);
        if (end < 0) break;
        LocalIPhoneAnalyzer.ingestLine(carry.slice(pos, end), state);
        pos = end + 1;
      }
      carry = carry.slice(pos);
      if (carry.length > maxLineChars) throw new Error("單一資料行過長，請檢查是否為正確的 Analytics 主檔");
      const pct = Math.min(98, Math.round((bytes / (file.size || 1)) * 98));
      setProgress(pct, `掃描中：${prettyBytes(bytes)} / ${prettyBytes(file.size)} · ${state.lineCount.toLocaleString()} 行`);
      await new Promise(r => requestAnimationFrame(r));
    }
    carry += decoder.decode();
    if (carry) LocalIPhoneAnalyzer.ingestLine(carry, state);
  } finally { reader.releaseLock(); }
  setProgress(100, `掃描完成：${state.lineCount.toLocaleString()} 行`);
  return state;
}
function renderReport(report) {
  summaryGrid.replaceChildren();
  for (const item of report.cards) {
    const el = document.createElement("div");
    el.className = "result" + ((item.value === "未確認" || item.value === "未取得") ? " warn" : "");
    const h = document.createElement("h3"); h.textContent = item.title;
    const v = document.createElement("div"); v.className = "value"; v.textContent = item.value;
    const s = document.createElement("div"); s.className = "sub"; s.textContent = [item.sub, item.note].filter(Boolean).join("\n");
    el.append(h, v, s); summaryGrid.append(el);
  }
  warningsOutput.textContent = report.warnings.join("\n");
  rawOutput.textContent = report.rawLines.join("\n") || "沒有找到可確認的白名單欄位。";
  summaryCard.classList.remove("hidden");
  rawCard.classList.remove("hidden");
}
function reportText(report) {
  const lines = [`iPhone 本機硬體分析 PWA V1.1`, `檔案：${report.fileName}`, `掃描行數：${report.lineCount}`, ""];
  for (const item of report.cards) {
    lines.push(`【${item.title}】 ${item.value}`);
    if (item.sub) lines.push(item.sub);
    if (item.note) lines.push(`註：${item.note}`);
    lines.push("");
  }
  lines.push("【重要限制】", ...report.warnings, "", "報告由本機程式分析，沒有上傳 Analytics 檔案。");
  return lines.join("\n");
}
fileInput.addEventListener("change", () => {
  selectedFile = fileInput.files?.[0] || null;
  lastReport = null;
  if (!selectedFile) return;
  fileMeta.textContent = `${selectedFile.name} · ${prettyBytes(selectedFile.size)}${selectedFile.name.toLowerCase().includes("session") ? " · 提醒：建議改選非 session 主檔" : ""}`;
  analyzeBtn.disabled = false;
  resetBtn.disabled = false;
  summaryCard.classList.add("hidden"); rawCard.classList.add("hidden"); progressWrap.classList.add("hidden");
});
resetBtn.addEventListener("click", () => {
  selectedFile = null; lastReport = null; fileInput.value = "";
  fileMeta.textContent = "尚未選擇檔案"; analyzeBtn.disabled = true; resetBtn.disabled = true;
  summaryCard.classList.add("hidden"); rawCard.classList.add("hidden"); progressWrap.classList.add("hidden");
  progressBar.style.width = "0";
});
analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  analyzeBtn.disabled = true; resetBtn.disabled = true;
  summaryCard.classList.add("hidden"); rawCard.classList.add("hidden");
  try {
    setProgress(1, "準備本機掃描…");
    const state = await analyzeFile(selectedFile);
    lastReport = LocalIPhoneAnalyzer.buildReport(selectedFile, state);
    renderReport(lastReport);
  } catch (e) {
    setProgress(0, `掃描失敗：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    analyzeBtn.disabled = false; resetBtn.disabled = false;
  }
});
exportBtn.addEventListener("click", () => {
  if (!lastReport) return;
  const blob = new Blob([reportText(lastReport)], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "iPhone_本機硬體分析_V1.1.txt"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
if ("serviceWorker" in navigator) window.addEventListener("load", () => {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
});
