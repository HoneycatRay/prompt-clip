# Prompt Clip

Prompt Clip 是以 Tauri 2、React、TypeScript 與 Rust 開發的桌面提示詞管理工具。提示詞以 Markdown 檔案儲存在本機，可搜尋、編輯、匯入並快速複製使用。

## 使用方式

- 在提示詞頁面新增、編輯、搜尋或刪除提示詞；內容支援 Markdown 與 `{變數}`。
- 按「取用」複製提示詞。內容有變數時，先填入欄位再複製。
- 按 `Ctrl+Shift+Space` 開啟精簡取用視窗；可在「設定 → 快捷鍵」變更組合鍵。
- 「設定 → 資料與儲存」可選擇另一個既有資料夾。切換資料夾不會搬移檔案。
- 「匯入」支援多個 Markdown 檔、ZIP 壓縮檔與 JSON；同名提示詞可逐筆覆寫或略過。
- 側邊欄的「查看說明」可隨時開啟應用程式操作手冊。應用程式啟動時不會自動彈出說明視窗。
- 側邊欄可以收合；「設定」可切換淺色、深色或跟隨系統主題。
- 精簡取用視窗用於搜尋和複製；按「回到主 App」管理提示詞。關閉視窗會將應用程式縮至系統匣，可按系統匣圖示重新開啟，或從選單離開。
- 提示詞以含 YAML frontmatter 的 Markdown 檔儲存；可在「查看說明」或匯入視窗查看格式與匯入限制。每批最多匯入 500 筆，Markdown 內容總量上限為 10 MB。

JSON 匯入可使用陣列，或包含 `prompts` 陣列的物件；每筆需要字串 `title` 和 `content`：

```json
[
  {
    "title": "程式碼審查",
    "content": "請檢查 {檔案} 的程式碼，並列出具體改善建議。"
  },
  {
    "title": "會議摘要",
    "content": "請將以下逐字稿整理為重點與待辦事項：\n\n{逐字稿}"
  }
]
```

## 啟動應用程式

### 一般使用者：下載 Windows 版本

Windows 10/11 x64 使用者可直接[下載 Prompt Clip.exe](downloads/Prompt%20Clip.exe)，或從 GitHub 儲存庫下載 ZIP 並解壓縮後，開啟 `downloads` 資料夾中的 `Prompt Clip.exe`。直接雙擊即可啟動，不需要安裝 Node.js、Rust、`.bat` 啟動器或命令提示字元視窗。目標電腦需安裝 Microsoft Edge WebView2 Runtime。

此執行檔是 Windows x64 版本；其他平台請依下方步驟從原始碼建置。
目前執行檔未經數位簽章，Windows SmartScreen 可能會顯示未知發行者警告；執行前請確認檔案是從本專案 GitHub 儲存庫下載。

### 開發者：從原始碼建置 Windows 單一檔案

先安裝 Node.js、Rust 工具鏈及 Windows C++ Build Tools，然後在專案根目錄執行：

```powershell
npm install
npm run build:windows
```

成功後開啟 `release/Prompt Clip.exe`。若要建立一般安裝程式，執行 `npm run tauri -- build`，安裝檔會輸出至 `%USERPROFILE%\.cargo\target\prompt-clip\release\bundle\`。

### 開發模式

安裝 Node.js、Rust 工具鏈及 Windows C++ Build Tools，並確保系統可使用 Microsoft Edge WebView2 Runtime。首次在專案根目錄安裝相依套件，之後即可啟動開發版：

```powershell
npm install
npm run tauri dev
```

`npm run tauri` 會協助加入標準 Rust Cargo 執行路徑；Windows 預設將 Cargo 建置輸出放在 `%USERPROFILE%\.cargo\target\prompt-clip\`，避免專案路徑中的空格影響建置。若 Rust 安裝在非標準位置，請先將 Cargo 的 `bin` 目錄加入 `PATH`。

## 修改程式

- 前端介面與操作邏輯：`src/App.tsx`
- 前端樣式：`src/App.css`
- React 進入點：`src/main.tsx`
- Rust 命令、檔案存取、系統匣與視窗行為：`src-tauri/src/lib.rs`
- Tauri 視窗、權限與建置設定：`src-tauri/tauri.conf.json`、`src-tauri/capabilities/`
- 應用程式品牌圖示：`public/prompt-clip-mark.svg` 與 `src-tauri/icons/`

前端修改可用 `npm run tauri dev` 即時預覽；產生正式前端建置請執行 `npm run build`，產生 Windows 單一執行檔則執行 `npm run build:windows`。

## 專案架構

```text
.
├── public/                 前端靜態檔案與品牌圖示
├── downloads/              可直接執行的 Windows x64 版本
├── scripts/                Tauri 執行環境與 Windows 建置腳本
├── src/                    React / TypeScript 介面與樣式
├── src-tauri/
│   ├── capabilities/       Tauri 視窗權限設定
│   ├── icons/              桌面程式圖示
│   └── src/                Rust 桌面程式邏輯
├── index.html              前端 HTML 入口
├── package.json            npm 指令與 JavaScript 相依套件
└── vite.config.ts          Vite 開發伺服器設定
```

`node_modules/`、`dist/`、Rust `target/` 與 `release/` 都是本機相依套件或建置輸出，不需提交至 GitHub。`package-lock.json` 與 `src-tauri/Cargo.lock` 則應保留，以鎖定相依套件版本。

## 驗證

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_TARGET_DIR = "$env:USERPROFILE\.cargo\target\prompt-clip-portable"
npm run build
cargo test --manifest-path src-tauri\Cargo.toml
```
