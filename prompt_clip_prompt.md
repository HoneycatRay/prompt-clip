# Prompt Clip - AI 開發任務 Prompt (VS Code Agent / GitHub Copilot)

> **角色**：資深桌面端軟體工程師 (Rust / Tauri / React / TypeScript Specialist)
>
> **任務**：協助建立並開發一個名為 **Prompt Clip** 的跨平台 AI Prompt 複製便籤桌面應用程式。

## 1. 專案概述 (Project Overview)

**Prompt Clip** 是一個輕量級的桌面常駐便籤工具，專為高頻使用 AI Prompt 的使用者設計。

* **主要特點**：以本地 Markdown 檔案或目錄作為 Prompt 範本庫。

* **目標平台**：優先支援 Windows 11，且程式碼架構必須完全相容於 macOS (Cross-Platform Ready)。

* **核心體驗**：隱藏在系統選單/工作列圖示 (System Tray)，透過全系統全域快捷鍵呼叫浮動便籤視窗，支援搜尋、變數動態替換與一鍵複製。

## 2. 技術棧建議 (Tech Stack)

請採用以下技術棧進行開發，以確保記憶體佔用極小、啟動速度極快且支援雙平台：

* **前端框架**：React + TypeScript + Vite + Tailwind CSS + Lucide Icons

* **桌面端核心 (Backend)**：Tauri v2 (Rust)

* **狀態管理與 Markdown 解析**：Zustand / `gray-matter` (解析 Frontmatter) / `marked` 或 React-Markdown

* **版本控制工具**：Git + GitHub CLI (`gh`)

## 3. 核心功能規格 (Detailed Features)

### 3.1 本地 Markdown 檔案管理 (Storage)

1. **設定頁面**：允許使用者指定一個「Prompt 範本資料夾」（例如 `~/Prompts`）。

2. **格式支援**：支援 `.md` 檔案，且可解析 YAML Frontmatter 格式：

   ```yaml
   ---
   title: "程式碼重構助理"
   tags: ["Coding", "Refactor"]
   description: "幫忙將現有程式碼進行模組化重構"
   ---
   請重構以下 {語言} 程式碼，確保符合 Clean Code 原則：
   
   ```

3. **動態變數支援**：自動偵測內文中的 `{變數名稱}`（例如 `{語言}`、 `{主題}`）。

### 3.2 視窗與系統列整合 (System Tray & Shortcut)

1. **常駐常駐選單**：啟動後縮小至系統列，顯示選單（「開啟 Prompt Clip」、「設定範本目錄」、「離開」）。

2. **全域快捷鍵 (Global Shortcut)**：

   * 預設快捷鍵：`Alt + Space` 或 `Ctrl + Shift + P`（Windows/Mac 相容設定）。

   * 按下快捷鍵可切換顯示/隱藏「浮動速查視窗」。

3. **視窗行為**：浮動視窗無邊框、置頂 (Always on Top)、失焦自動隱藏（可在設定中切換）。

### 3.3 浮動便籤視窗 (Quick Picker UI)

1. **即時搜尋**：提供搜尋框，可依標題、標籤 (Tag) 或內文快速過濾。

2. **變數填空面板 (Dynamic Fill)**：

   * 點擊 Prompt 範本時，若偵測到 `{變數}`，跳出輕量對話框讓使用者填寫變數內容。

   * 若無變數，直接複製。

3. **一鍵複製與通知**：複製處理後的 Prompt 至剪貼簿，顯示 Toast 成功提示並關閉視窗。

## 4. 執行步驟說明 (Step-by-Step Implementation Guide)

請 Copilot Agent 按照以下 4 個階段逐步完成此專案：

### Phase 1: 專案初始化與 Git / GitHub 倉庫設定

1. 建立基於 Tauri 2.0 + React + TypeScript 的專案結構。

2. 初始化本地 Git 儲存庫：`git init`

3. 建立基本 `.gitignore` (包含 node_modules, target, .DS_Store 等)。

4. 進行首次提交：`git add .` 與 `git commit -m "feat: initial commit for prompt clip"`

5. **使用 GitHub CLI 建立遠端 Repository**：

   * 執行 `gh repo create prompt-clip --public --source=. --remote=origin --push` (若偏好私有可替換為 `--private`)。

### Phase 2: Tauri 後端邏輯 (Rust)

1. 設定 Tauri Tray Icon 與 全域快捷鍵 Plugin (`tauri-plugin-global-shortcut`)。

2. 實作 Rust Native API Command：

   * `select_folder()`: 調用原生檔案選擇器。

   * `read_prompt_files(folder_path)`: 讀取目錄下所有 `.md` 檔案內容。

   * `watch_folder(folder_path)`: (可選) 監聽目錄變更。

### Phase 3: 前端介面與邏輯 (React + Tailwind)

1. 建立兩大頁面觀點：

   * **Main View (主頁面 / 設定頁)**：設定資料夾路徑、編輯選單、檢視檔案列表。

   * **Floating View (便籤浮動視窗)**：搜尋列、Prompt 卡片列表、變數替換 Popup。

2. 實作 YAML Frontmatter 解析與 `{變數}` 正則匹配替換。

3. 整合剪貼簿 API (`navigator.clipboard.writeText`)。

### Phase 4: Windows 11 調試與打包驗證

1. 測試全域快捷鍵與喚醒視窗動畫。

2. 驗證背景執行記憶體占用。

3. 確保專案內未含有 Windows 獨占且不可移植的程式碼（使用 Tauri 官方 API 確保未來可於 macOS 順利編譯）。

## 5. 開始指令 (Action Prompt)

> 請 VS Code Agent 從 **Phase 1** 開始，逐一執行終端機指令以設定專案、建立 Git/GitHub 儲存庫，並開始編寫基本專案架構程式碼。
