# iPhone 本機硬體分析 — GitHub Pages 版 V1.0

這是純靜態 PWA。GitHub Pages 只負責提供 HTML / CSS / JavaScript 程式檔，
使用者選取的 Apple Analytics 檔案由 Safari 在裝置本機讀取與解析。

## 最簡單部署方式：Deploy from a branch

建議 Repository 名稱：

`iphone-local-hardware-analyzer`

### 1. 建立 GitHub Repository

最簡單是建立 **Public** repository。

> GitHub Free 的 Pages 可直接用 Public repository。
> 若要 Private repository 的 Pages，需依 GitHub 方案支援情況。

### 2. 將本資料夾全部內容放到 repository 根目錄

必要檔案：

- `index.html`
- `styles.css`
- `app.js`
- `sw.js`
- `manifest.webmanifest`
- `icon-192.png`
- `icon-512.png`
- `apple-touch-icon.png`
- `.nojekyll`

### 3. 開啟 GitHub Pages

Repository：

`Settings` → `Pages`

Build and deployment：

- Source：`Deploy from a branch`
- Branch：`main`
- Folder：`/(root)`

按 `Save`。

### 4. 網址

一般 Project Pages 網址會是：

`https://你的GitHub帳號.github.io/你的Repository名稱/`

例如：

`https://example.github.io/iphone-local-hardware-analyzer/`

### 5. iPhone 安裝成 PWA

iPhone Safari 開啟上述網址：

`分享` → `加入主畫面`

之後就可像 App 一樣從主畫面開啟。

---

## 每次分析

1. iPhone：
   `設定` → `隱私權與安全性` → `分析與改進` → `分析資料`
2. 找最新、**沒有 `session`** 的 Analytics 主檔。
3. 分享 → `儲存到「檔案」`
4. 開啟「iPhone 硬體分析」PWA。
5. 選擇剛儲存的 Analytics 檔。
6. 點「開始本機分析」。

---

## 隱私

程式碼：

- 不使用 Analytics 上傳 API
- 不使用 ChatGPT / AI API
- 不使用第三方 JavaScript
- 不含廣告或追蹤碼
- 使用 Browser File API / Streams 在本機掃描檔案
- 預設不保留含 IMEI、ECID、UDID、ICCID、MAC、完整序號的原始資料行

**GitHub Pages 網站本身是公開網頁。不要把任何真實 Analytics 檔案 commit 到 repository。**

---

## 更新

未來只要更新 repository 內的：

- `app.js`
- `index.html`
- `styles.css`
- `sw.js`

GitHub Pages 重新部署後，PWA 下次開啟會更新程式版本。

若 Safari 仍顯示舊版本，可關閉 PWA 後重新開啟，或在 Safari 清除此網站資料再載入。
