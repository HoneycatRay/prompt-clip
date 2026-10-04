# Prompt Clip

Prompt Clip is a cross-platform desktop app for keeping and quickly copying reusable AI prompts. It is built with Tauri v2, React, TypeScript, and Vite.

## Development

Install Node.js and the Rust toolchain. On Windows, also install the Microsoft C++ Build Tools and WebView2 Runtime.

Prompt Markdown files are stored in the app's local `Prompts` data folder by default. Use **選擇資料夾** in the app to use another existing folder; the selected folder is remembered on this device.

The `npm run tauri` command automatically adds Rust's standard `~/.cargo/bin` directory to its `PATH`. On Windows it also uses a build output directory without spaces by default, which is useful when the project path contains spaces. If Rust is installed in a non-standard location, add its `bin` directory to `PATH` before starting the app.

From the project root, install dependencies once and start the desktop app:

```powershell
npm install
npm run tauri dev
```

Use **新增** to create a Prompt, choose **編輯** to update it, and choose **刪除** to remove it and its `.md` file. The app lists Markdown files in the selected folder and saves Prompts with YAML frontmatter and Markdown content.

Press **Ctrl+Shift+P** on Windows/Linux or **Command+Shift+P** on macOS to show or hide Prompt Clip. Closing the window hides it to the system tray; click the tray icon to toggle the window, right-click for the menu, or choose **離開** to quit.

Click a Prompt card to use it. Prompts containing `{variable}` placeholders open a fill-in dialog; submitting copies the completed text to the system clipboard and hides the window. Use **編輯** on a card to edit it without copying.

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

Create a production desktop build with `npm run tauri build` (use the same Cargo environment variables above on Windows when the project path contains spaces).
