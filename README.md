# iPhone 本機硬體分析 — GitHub Pages V1.1

## 這次更新內容

已確認原 V1.0 能掃描 24.9MB / 44,780 行 Analytics，但欄位有跨裝置誤判。

- **修正 Watch 型號誤判為 iPhone**：遇到 `Watch6,7` 等 Watch 型號時排除該行，不拿來推定 iPhone 型號。
- **忽略 `null`、`undefined`、無效欄位**：顯示「未確認」，不再把 `null` 當機型。
- **不再把 `memSize` 當實體 RAM**：例如 24,527,000,000 bytes 不應直接被標示為 iPhone 22.8GB RAM。
- **不再用 MaximumFCC ÷ NominalChargeCapacity 計算健康度**：只保留明確 `MaximumCapacityPercent` 欄位的候選值，且標示來源未經證實。
- **修正欄位名稱的部分字串誤判**：只讀取精確的欄位名稱。
- **不保留 Analytics 原始整行**：只顯示白名單欄位和值，降低顯示不必要識別資訊的風險。
- PWA 快取版本更新至 `iphone-hw-github-v1.1.0`，頁面資源採網路優先、離線快取備援。

## GitHub 網頁更新方式

Repository: `5578z968w4-ux/iphone-local-hardware-analyzer`

將本包**解壓縮後的檔案**放到 Repository `main` 分支的 **根目錄**，更新同名檔案，Commit changes。
**不要上傳 ZIP，不要把 Analytics 原始檔放在 GitHub。**

必須保留所有檔案，特別是這次新增加的 `analyzer-core.js`。

網址：`https://5578z968w4-ux.github.io/iphone-local-hardware-analyzer/`

如看到舊版：等 Pages 部署完成、重新整理 Safari；PWA 安裝版可完全結束後再開。如果仍顯示 V1.0，請清除此網站快取後重新進入。

## 注意

即使修正版能擷取 `CycleCount: 247`、`OSVersion` 等欄位，也不代表已確認這些值必然來自 iPhone：
Apple Analytics 可能同時包含 Apple Watch / 多個元件或多筆來源紀錄。

未取得原始 iPhone ProductType 且缺乏可靠裝置關聯時，報告會保守標示「未確認」。
沒有正式欄位及可靠對照時，不會自行認定 RAM / NAND / 螢幕 / 相機的供應商。

此版本做了靜態、核心單元測試與模擬網頁流程驗證，尚未在你的 iPhone / iOS 27 實機驗證。
