# Prompt Clip

Prompt Clip is a cross-platform desktop app for keeping and quickly copying reusable AI prompts. It is built with Tauri v2, React, TypeScript, and Vite.

## Development

Install Node.js and the Rust toolchain. On Windows, also install the Microsoft C++ Build Tools and WebView2 Runtime.

Prompt Markdown files are stored in the app's local `Prompts` data folder by default. Use **選擇其他資料夾** in the app to use another existing folder; the selected folder is remembered on this device.

The `npm run tauri` command automatically adds Rust's standard `~/.cargo/bin` directory to its `PATH`. On Windows it also uses a build output directory without spaces by default, which is useful when the project path contains spaces. If Rust is installed in a non-standard location, add its `bin` directory to `PATH` before starting the app.

From the project root, install dependencies once and start the desktop app:

```powershell
npm install
npm run tauri dev
```

Use **新增提示詞** to create an item, select one from the library to edit it, and choose **刪除** to remove it and its `.md` file. The app lists Markdown files in the selected folder and saves Prompts with YAML frontmatter and Markdown content.

Press **Ctrl+Shift+Space** to show or hide the compact Prompt-use window. Change the shortcut under **設定** in the main app. The compact window only searches and copies Prompts; use **回到主 App** to manage them. Closing either window hides it; click the tray icon to open the main app, right-click for the menu, or choose **離開** to quit.

The sidebar can be collapsed and expanded. Its **提示詞**, **設定**, and **查看說明** items are grouped together; the guide includes a step-by-step manual and a button for detailed import formats. Open **設定** to choose a light, dark, or system-matched theme, manage the Prompt folder, and change the global shortcut. The compact-window shortcut appears beside its label when you hover over or focus its button.

The main app can import multiple `.md` files, `.zip` archives (including Markdown files in nested folders), or JSON text. Select **匯入格式詳細內容** in the guide or import dialog for detailed instructions. The JSON format is an array of Prompt records, or an object containing a `prompts` array:

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

On a name conflict, choose **覆寫** or **略過** for each Prompt. Imports are limited to 500 Prompts and 10 MB of combined Markdown content per batch.

Click **取用** beside a Prompt (or click it in the compact window) to copy it. Prompts containing `{variable}` placeholders open a fill-in dialog; submitting copies the completed text to the system clipboard and hides that window. Select an item in the main list to edit it.

Run the frontend production build and Rust filesystem tests with:

```powershell
npm run build
cargo test --manifest-path src-tauri\Cargo.toml
```

Keep the same Cargo environment variables set for the Rust test command on Windows when the project path contains spaces. On macOS or Windows when the project path has no spaces, the app can be started with:

```sh
npm install
npm run tauri dev
```

Create a Windows portable folder with the root launcher by running:

```powershell
.\scripts\package-portable.ps1
```

The script builds the app into `PromptClipPortable`; double-click `啟動 Prompt Clip.bat` in the project folder to open that build. To share the portable version, share the complete `PromptClipPortable` folder, which includes its own `啟動 Prompt Clip.bat`. The target PC needs the Microsoft Edge WebView2 Runtime. The native app, tray, and installer icons are generated from `public/prompt-clip-mark.svg`. A regular installer can be built with `npm run tauri -- build`.
