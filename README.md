# Prompt Clip

Prompt Clip is a cross-platform desktop app for keeping and quickly copying reusable AI prompts. It is built with Tauri v2, React, TypeScript, and Vite.

## Development

Install Node.js and the Rust toolchain. On Windows, also install the Microsoft C++ Build Tools and WebView2 Runtime.

On Windows, if the project path contains spaces, set Cargo's build output directory to a path without spaces before starting the app:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_TARGET_DIR = "$env:USERPROFILE\.cargo\target\prompt-clip"
npm install
npm run tauri dev
```

On macOS, or on Windows when the project path has no spaces, run:

```sh
npm install
npm run tauri dev
```

Create a production build with `npm run tauri build` (use the same PowerShell environment settings above on Windows when the project path contains spaces).

```sh
npm run tauri build
```
