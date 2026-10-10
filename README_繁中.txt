iPhone 本機硬體欄位診斷 · 1.1-DIAG-1
=======================================

獨立診斷頁，不改動正式 V1.1 的任何檔案。
上傳到現有 Repository 的 diagnostic/ 子目錄：
    diagnostic/index.html
    diagnostic/core.js
    diagnostic/ui.js

預計網址：
    https://5578z968w4-ux.github.io/iphone-local-hardware-analyzer/diagnostic/

操作方式：
1. 用 iPhone Safari 打開上方診斷頁。
2. 在「選擇 Analytics 主檔」選取已存到 iPhone「檔案」的 Analytics。
3. 不勾選短代碼示例，先按「開始本機診斷」。
4. 檢視各類硬體欄位名稱與紀錄數。
5. 點「匯出脫敏摘要 JSON」。如要分享給 ChatGPT，先檢查內容是否有不想分享的欄位。

安全限制：
- 沒有 API、追蹤碼、第三方 JavaScript、上傳函式。
- 只在記憶體中處理原始檔；無任何持久儲存。
- 網頁 CSP connect-src 'none' 禁止網路資料請求。
- 匯出不含原始行，預設只包含欄位名稱、次數和來源種類。
- 標示 iPhone / Watch / 混合 / 未明來源，不把不明來源硬判成 iPhone。
- 未知零件代碼不映射成供應商，也不替廠商評級。

這是診斷版，不是 V1.2 正式版。
