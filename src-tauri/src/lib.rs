use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DEFAULT_QUICK_SHORTCUT: &str = "Ctrl+Shift+Space";
const MAX_IMPORT_FILES: usize = 500;
const MAX_IMPORT_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IMPORT_TOTAL_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptDraft {
    title: String,
    content: String,
    #[serde(default)]
    metadata: Option<BTreeMap<String, serde_yaml_ng::Value>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptFile {
    file_name: String,
    title: String,
    content: String,
    #[serde(skip_serializing)]
    metadata: BTreeMap<String, serde_yaml_ng::Value>,
}

fn parse_prompt_markdown(file_name: String, markdown: String) -> Result<PromptFile, String> {
    let markdown = markdown.replace("\r\n", "\n");
    let file_title = Path::new(&file_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_owned();
    let (title, content, metadata) = if let Some(markdown) = markdown.strip_prefix("---\n") {
        let (frontmatter, content) = markdown
            .split_once("\n---")
            .ok_or_else(|| format!("Prompt has an unclosed YAML frontmatter block: {file_name}"))?;
        let metadata =
            serde_yaml_ng::from_str::<BTreeMap<String, serde_yaml_ng::Value>>(frontmatter)
                .map_err(|error| format!("Could not parse frontmatter in {file_name}: {error}"))?;
        let title = metadata
            .get("title")
            .and_then(serde_yaml_ng::Value::as_str)
            .unwrap_or(&file_title)
            .to_owned();
        (
            title,
            content.strip_prefix('\n').unwrap_or(content).to_owned(),
            metadata,
        )
    } else if let Some(markdown) = markdown.strip_prefix("# ") {
        if let Some((title, content)) = markdown.split_once("\n\n") {
            (title.to_owned(), content.to_owned(), BTreeMap::new())
        } else {
            (
                markdown.trim_end_matches('\n').to_owned(),
                String::new(),
                BTreeMap::new(),
            )
        }
    } else {
        (file_title, markdown, BTreeMap::new())
    };

    Ok(PromptFile {
        file_name,
        title,
        content,
        metadata,
    })
}

fn prompt_directory(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if !path.is_dir() {
        return Err(format!("Prompt folder does not exist: {}", path.display()));
    }
    path.canonicalize()
        .map_err(|error| format!("Could not resolve prompt folder: {error}"))
}

fn prompt_file_path(directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    let path = Path::new(file_name);
    if file_name.is_empty()
        || file_name.contains(['/', '\\'])
        || path.file_name().and_then(|name| name.to_str()) != Some(file_name)
        || path
            .extension()
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("md"))
    {
        return Err("Prompt file name must be a simple .md file name.".into());
    }

    let path = directory.join(path);
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Prompt path must be a regular Markdown file.".into());
        }
    }
    Ok(path)
}

fn prompt_from_file(path: &Path) -> Result<PromptFile, String> {
    let markdown = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?
        .replace("\r\n", "\n");
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Prompt file name is not valid UTF-8.".to_string())?
        .to_owned();
    parse_prompt_markdown(file_name, markdown)
}

fn safe_file_stem(title: &str) -> String {
    let mut stem = String::new();
    for character in title.trim().chars().take(80) {
        if character.is_control() || r#"/\<>:"|?*"#.contains(character) {
            stem.push('-');
        } else if character.is_whitespace() {
            stem.push('-');
        } else {
            stem.push(character);
        }
    }
    let stem = stem.trim_matches([' ', '.', '-']);
    let stem = if stem.is_empty() { "prompt" } else { stem };
    let device_name = stem.split('.').next().unwrap_or(stem);
    let is_reserved = ["CON", "PRN", "AUX", "NUL"]
        .iter()
        .any(|name| name.eq_ignore_ascii_case(device_name))
        || (1..=9).any(|number| {
            format!("COM{number}").eq_ignore_ascii_case(device_name)
                || format!("LPT{number}").eq_ignore_ascii_case(device_name)
        });
    if is_reserved {
        format!("{stem}-prompt")
    } else {
        stem.to_owned()
    }
}

fn save_prompt(
    folder_path: &str,
    title: &str,
    content: &str,
    file_name: Option<&str>,
) -> Result<PromptFile, String> {
    save_prompt_with_metadata(folder_path, title, content, file_name, None)
}

fn save_prompt_with_metadata(
    folder_path: &str,
    title: &str,
    content: &str,
    file_name: Option<&str>,
    imported_metadata: Option<BTreeMap<String, serde_yaml_ng::Value>>,
) -> Result<PromptFile, String> {
    let title = title.trim();
    if title.is_empty() || title.contains(['\r', '\n']) {
        return Err("Prompt title must be a non-empty single line.".into());
    }

    let directory = prompt_directory(folder_path)?;
    let path = if let Some(file_name) = file_name {
        let path = prompt_file_path(&directory, file_name)?;
        if !path.is_file() {
            return Err(format!("Prompt file does not exist: {file_name}"));
        }
        path
    } else {
        let stem = safe_file_stem(title);
        (1..)
            .map(|index| {
                let file_name = if index == 1 {
                    format!("{stem}.md")
                } else {
                    format!("{stem}-{index}.md")
                };
                prompt_file_path(&directory, &file_name)
            })
            .find_map(|candidate| match candidate {
                Ok(path) if !path.exists() => Some(Ok(path)),
                Err(error) => Some(Err(error)),
                _ => None,
            })
            .ok_or_else(|| "Could not find an available prompt file name.".to_string())??
    };

    let mut metadata = if path.exists() {
        prompt_from_file(&path)?.metadata
    } else {
        BTreeMap::new()
    };
    if let Some(imported_metadata) = imported_metadata {
        metadata = imported_metadata;
    }
    metadata.insert(
        "title".to_owned(),
        serde_yaml_ng::Value::String(title.to_owned()),
    );
    let frontmatter = serde_yaml_ng::to_string(&metadata)
        .map_err(|error| format!("Could not encode prompt metadata: {error}"))?;
    let markdown = format!("---\n{frontmatter}---\n{content}");
    fs::write(&path, markdown)
        .map_err(|error| format!("Could not save {}: {error}", path.display()))?;
    prompt_from_file(&path)
}

fn remove_prompt(folder_path: &str, file_name: &str) -> Result<(), String> {
    let directory = prompt_directory(folder_path)?;
    let path = prompt_file_path(&directory, file_name)?;
    if !path.is_file() {
        return Err(format!("Prompt file does not exist: {file_name}"));
    }
    fs::remove_file(&path).map_err(|error| format!("Could not delete {}: {error}", path.display()))
}

fn import_markdown_files(paths: &[String]) -> Result<Vec<PromptDraft>, String> {
    if paths.len() > MAX_IMPORT_FILES {
        return Err(format!(
            "An import can contain at most {MAX_IMPORT_FILES} files."
        ));
    }
    let mut drafts = Vec::new();
    let mut total_bytes = 0_u64;
    for path in paths {
        let file_path = Path::new(path);
        if !file_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err(format!("Only Markdown files can be imported: {path}"));
        }
        let metadata = fs::metadata(file_path)
            .map_err(|error| format!("Could not inspect {}: {error}", file_path.display()))?;
        if !metadata.is_file() || metadata.len() > MAX_IMPORT_FILE_BYTES {
            return Err(format!(
                "Markdown file is too large or is not a regular file: {path}"
            ));
        }
        total_bytes += metadata.len();
        if total_bytes > MAX_IMPORT_TOTAL_BYTES {
            return Err("The combined Markdown content exceeds the 10 MB import limit.".into());
        }
        let file_name = file_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("Invalid Markdown file name: {path}"))?
            .to_owned();
        let file = fs::File::open(file_path)
            .map_err(|error| format!("Could not open {}: {error}", file_path.display()))?;
        let mut markdown = String::new();
        file.take(MAX_IMPORT_FILE_BYTES + 1)
            .read_to_string(&mut markdown)
            .map_err(|error| format!("Could not read {}: {error}", file_path.display()))?;
        if markdown.len() as u64 > MAX_IMPORT_FILE_BYTES {
            return Err(format!(
                "Markdown file exceeds the 2 MB import limit: {path}"
            ));
        }
        let prompt = parse_prompt_markdown(file_name, markdown)?;
        drafts.push(PromptDraft {
            title: prompt.title,
            content: prompt.content,
            metadata: Some(prompt.metadata),
        });
        if drafts.len() > MAX_IMPORT_FILES {
            return Err(format!(
                "An import can contain at most {MAX_IMPORT_FILES} Prompts."
            ));
        }
    }
    Ok(drafts)
}

fn import_zip_files(paths: &[String]) -> Result<Vec<PromptDraft>, String> {
    if paths.len() > MAX_IMPORT_FILES {
        return Err(format!(
            "An import can contain at most {MAX_IMPORT_FILES} ZIP files."
        ));
    }
    let mut drafts = Vec::new();
    let mut total_bytes = 0_u64;
    for path in paths {
        let file =
            fs::File::open(path).map_err(|error| format!("Could not open {path}: {error}"))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|error| format!("Could not read ZIP archive {path}: {error}"))?;
        if archive.len() > 10_000 {
            return Err(format!("ZIP archive {path} contains too many entries."));
        }
        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|error| format!("Could not read ZIP entry in {path}: {error}"))?;
            if entry.is_dir()
                || !Path::new(entry.name())
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            {
                continue;
            }
            if entry.size() > MAX_IMPORT_FILE_BYTES {
                return Err(format!(
                    "ZIP entry {} exceeds the 2 MB import limit.",
                    entry.name()
                ));
            }
            let file_name = Path::new(entry.name())
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| format!("Invalid Markdown file name in ZIP: {}", entry.name()))?
                .to_owned();
            let entry_name = entry.name().to_owned();
            let mut markdown = String::new();
            entry
                .take(MAX_IMPORT_FILE_BYTES + 1)
                .read_to_string(&mut markdown)
                .map_err(|error| format!("Could not read ZIP entry {entry_name}: {error}"))?;
            let entry_bytes = markdown.len() as u64;
            if entry_bytes > MAX_IMPORT_FILE_BYTES {
                return Err(format!(
                    "ZIP entry {entry_name} exceeds the 2 MB import limit."
                ));
            }
            total_bytes += entry_bytes;
            if total_bytes > MAX_IMPORT_TOTAL_BYTES {
                return Err("The combined Markdown content in ZIP files exceeds 10 MB.".into());
            }
            let prompt = parse_prompt_markdown(file_name, markdown)?;
            drafts.push(PromptDraft {
                title: prompt.title,
                content: prompt.content,
                metadata: Some(prompt.metadata),
            });
            if drafts.len() > MAX_IMPORT_FILES {
                return Err(format!(
                    "An import can contain at most {MAX_IMPORT_FILES} Prompts."
                ));
            }
        }
    }
    Ok(drafts)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|error| format!("Could not locate app settings directory: {error}"))
}

fn read_quick_shortcut(app: &AppHandle) -> Result<String, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(DEFAULT_QUICK_SHORTCUT.to_owned());
    }
    let settings = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let value: serde_json::Value = serde_json::from_str(&settings)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))?;
    Ok(value
        .get("quickShortcut")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(DEFAULT_QUICK_SHORTCUT)
        .to_owned())
}

fn write_quick_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let path = settings_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "App settings path has no parent directory.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create {}: {error}", directory.display()))?;
    let contents = serde_json::to_vec_pretty(&serde_json::json!({ "quickShortcut": shortcut }))
        .map_err(|error| format!("Could not encode app settings: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, contents)
        .map_err(|error| format!("Could not write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not update {}: {error}", path.display()))
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main application window is unavailable.".to_string())?;
    main.show()
        .and_then(|()| main.set_focus())
        .map_err(|error| format!("Could not open the main application window: {error}"))?;
    if let Some(quick) = app.get_webview_window("quick") {
        quick
            .hide()
            .map_err(|error| format!("Could not hide the quick-use window: {error}"))?;
    }
    Ok(())
}

fn show_quick_window(app: &AppHandle) -> Result<(), String> {
    let quick = app
        .get_webview_window("quick")
        .ok_or_else(|| "Quick-use window is unavailable.".to_string())?;
    quick
        .show()
        .and_then(|()| quick.set_focus())
        .map_err(|error| format!("Could not open the quick-use window: {error}"))
}

fn toggle_quick_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("quick") else {
        eprintln!("Could not find the quick-use window to toggle.");
        return;
    };
    let result = match window.is_visible() {
        Ok(true) => window.hide(),
        Ok(false) => window.show().and_then(|()| window.set_focus()),
        Err(error) => {
            eprintln!("Could not determine quick-use window visibility: {error}");
            return;
        }
    };
    if let Err(error) = result {
        eprintln!("Could not toggle quick-use window: {error}");
    }
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("Could not find the main window to toggle.");
        return;
    };
    let result = match window.is_visible() {
        Ok(true) => window.hide(),
        Ok(false) => window.show().and_then(|()| window.set_focus()),
        Err(error) => {
            eprintln!("Could not determine main window visibility: {error}");
            return;
        }
    };
    if let Err(error) = result {
        eprintln!("Could not toggle main window: {error}");
    }
}

#[tauri::command]
fn default_prompt_directory(app: AppHandle) -> Result<String, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate app data directory: {error}"))?
        .join("Prompts");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create prompt directory: {error}"))?;
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_prompt_files(folder_path: String) -> Result<Vec<PromptFile>, String> {
    let directory = prompt_directory(&folder_path)?;
    let entries = fs::read_dir(&directory)
        .map_err(|error| format!("Could not list {}: {error}", directory.display()))?;
    let mut prompts = Vec::new();
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read prompt folder entry: {error}"))?;
        let entry_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect {}: {error}", entry.path().display()))?;
        if entry_type.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            prompts.push(prompt_from_file(&entry.path())?);
        }
    }
    prompts.sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));
    Ok(prompts)
}

#[tauri::command]
fn save_prompt_file(
    folder_path: String,
    title: String,
    content: String,
    file_name: Option<String>,
) -> Result<PromptFile, String> {
    save_prompt(&folder_path, &title, &content, file_name.as_deref())
}

#[tauri::command]
fn delete_prompt_file(folder_path: String, file_name: String) -> Result<(), String> {
    remove_prompt(&folder_path, &file_name)
}

#[tauri::command]
fn read_markdown_import(paths: Vec<String>) -> Result<Vec<PromptDraft>, String> {
    import_markdown_files(&paths)
}

#[tauri::command]
fn read_zip_import(paths: Vec<String>) -> Result<Vec<PromptDraft>, String> {
    import_zip_files(&paths)
}

#[tauri::command]
fn find_import_conflict(folder_path: String, title: String) -> Result<Option<PromptFile>, String> {
    prompt_directory(&folder_path)?;
    let target_stem = safe_file_stem(&title);
    for prompt in read_prompt_files(folder_path)? {
        if prompt.title.eq_ignore_ascii_case(title.trim())
            || Path::new(&prompt.file_name)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .is_some_and(|stem| stem.eq_ignore_ascii_case(&target_stem))
        {
            return Ok(Some(prompt));
        }
    }
    Ok(None)
}

#[tauri::command]
fn import_prompt_file(
    folder_path: String,
    title: String,
    content: String,
    overwrite_file_name: Option<String>,
    metadata: Option<BTreeMap<String, serde_yaml_ng::Value>>,
) -> Result<PromptFile, String> {
    save_prompt_with_metadata(
        &folder_path,
        &title,
        &content,
        overwrite_file_name.as_deref(),
        metadata,
    )
}

#[tauri::command]
fn get_quick_shortcut(app: AppHandle) -> Result<String, String> {
    read_quick_shortcut(&app)
}

#[tauri::command]
fn set_quick_shortcut(app: AppHandle, shortcut: String) -> Result<String, String> {
    let shortcut = shortcut.trim();
    let parsed: Shortcut = shortcut
        .parse()
        .map_err(|error| format!("無法辨識快捷鍵：{error}"))?;
    let previous = read_quick_shortcut(&app)?;
    let manager = app.global_shortcut();
    let previous_shortcut: Shortcut = previous.parse().unwrap_or_else(|_| {
        DEFAULT_QUICK_SHORTCUT
            .parse()
            .expect("default quick shortcut must be valid")
    });
    if parsed == previous_shortcut {
        if !manager.is_registered(parsed.clone()) {
            manager
                .register(parsed.clone())
                .map_err(|error| format!("快捷鍵無法使用，可能已被其他應用程式佔用：{error}"))?;
        }
        if previous != shortcut {
            write_quick_shortcut(&app, shortcut)?;
        }
        return Ok(shortcut.to_owned());
    }
    let new_was_registered = manager.is_registered(parsed.clone());
    if !new_was_registered {
        manager
            .register(parsed.clone())
            .map_err(|error| format!("快捷鍵無法使用，可能已被其他應用程式佔用：{error}"))?;
    }
    if manager.is_registered(previous_shortcut.clone()) {
        if let Err(error) = manager.unregister(previous_shortcut.clone()) {
            if !new_was_registered {
                let _ = manager.unregister(parsed.clone());
            }
            return Err(format!("無法更新快捷鍵：{error}"));
        }
    }
    if let Err(error) = write_quick_shortcut(&app, shortcut) {
        if !new_was_registered {
            let _ = manager.unregister(parsed.clone());
        }
        manager
            .register(previous_shortcut.clone())
            .map_err(|rollback| {
                format!("{error}; restoring the previous shortcut failed: {rollback}")
            })?;
        return Err(error);
    }
    Ok(shortcut.to_owned())
}

#[tauri::command]
fn open_main_window(app: AppHandle) -> Result<(), String> {
    show_main_window(&app)
}

#[tauri::command]
fn toggle_quick_window_command(app: AppHandle) {
    toggle_quick_window(&app);
}

#[tauri::command]
fn show_quick_window_command(app: AppHandle) -> Result<(), String> {
    show_quick_window(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick_window(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "開啟 Prompt Clip", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "離開", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;

            let main_window = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::other("Main window is unavailable."))?;
            main_window.set_icon(icon.clone())?;
            main_window.set_decorations(false)?;

            TrayIconBuilder::new()
                .icon(icon.clone())
                .tooltip("Prompt Clip")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Err(error) = show_main_window(app) {
                            eprintln!("Could not show Prompt Clip: {error}");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            WebviewWindowBuilder::new(
                app,
                "quick",
                WebviewUrl::App("index.html?window=quick".into()),
            )
            .title("Prompt Clip · 取用")
            .icon(icon)?
            .inner_size(420.0, 600.0)
            .min_inner_size(360.0, 420.0)
            .resizable(true)
            .visible(false)
            .build()?;

            let configured_shortcut = read_quick_shortcut(app.handle())?;
            let shortcut: Shortcut = match configured_shortcut.parse() {
                Ok(shortcut) => shortcut,
                Err(error) => {
                    eprintln!("Saved quick shortcut is invalid; using the default: {error}");
                    if let Err(error) = write_quick_shortcut(app.handle(), DEFAULT_QUICK_SHORTCUT) {
                        eprintln!("Could not repair saved quick shortcut: {error}");
                    }
                    DEFAULT_QUICK_SHORTCUT
                        .parse()
                        .expect("default quick shortcut must be valid")
                }
            };
            if let Err(error) = app.global_shortcut().register(shortcut) {
                eprintln!("Could not register the configured quick shortcut: {error}");
                if configured_shortcut != DEFAULT_QUICK_SHORTCUT {
                    let fallback: Shortcut = DEFAULT_QUICK_SHORTCUT
                        .parse()
                        .expect("default quick shortcut must be valid");
                    if app.global_shortcut().register(fallback).is_ok() {
                        if let Err(error) =
                            write_quick_shortcut(app.handle(), DEFAULT_QUICK_SHORTCUT)
                        {
                            eprintln!("Could not save the fallback quick shortcut: {error}");
                        }
                    }
                }
            }
            show_main_window(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("Could not hide Prompt Clip window: {error}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            default_prompt_directory,
            read_prompt_files,
            save_prompt_file,
            delete_prompt_file,
            read_markdown_import,
            read_zip_import,
            find_import_conflict,
            import_prompt_file,
            get_quick_shortcut,
            set_quick_shortcut,
            open_main_window,
            toggle_quick_window_command,
            show_quick_window_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_directory() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("prompt-clip-test-{unique}"));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    #[test]
    fn creates_lists_updates_and_deletes_markdown_prompt() {
        let directory = test_directory();
        let folder = directory.to_string_lossy();

        let created = save_prompt(&folder, "Code Review", "Review this code.", None)
            .expect("prompt should be created");
        assert_eq!(created.file_name, "Code-Review.md");
        assert_eq!(created.title, "Code Review");
        assert_eq!(created.content, "Review this code.");
        let created_markdown = fs::read_to_string(directory.join("Code-Review.md"))
            .expect("Markdown file should exist");
        assert!(created_markdown.starts_with("---\ntitle: Code Review\n---\n"));
        assert!(created_markdown.ends_with("Review this code."));
        assert_eq!(
            read_prompt_files(folder.to_string())
                .expect("prompts should be listed")
                .len(),
            1
        );
        fs::write(directory.join("ignore.txt"), "not a prompt")
            .expect("non-Markdown file should be created");

        let updated = save_prompt(
            &folder,
            "Careful Code Review",
            "Review this code carefully.",
            Some(&created.file_name),
        )
        .expect("prompt should be updated");
        assert_eq!(updated.title, "Careful Code Review");
        assert_eq!(updated.content, "Review this code carefully.");
        let updated_markdown = fs::read_to_string(directory.join("Code-Review.md"))
            .expect("updated Markdown file should exist");
        assert!(updated_markdown.starts_with("---\ntitle: Careful Code Review\n---\n"));
        assert!(updated_markdown.ends_with("Review this code carefully."));

        remove_prompt(&folder, &created.file_name).expect("prompt should be deleted");
        assert!(!directory.join("Code-Review.md").exists());
        assert!(read_prompt_files(folder.to_string())
            .expect("prompts should be listed")
            .is_empty());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn reads_and_preserves_yaml_frontmatter_when_editing_prompt() {
        let directory = test_directory();
        let folder = directory.to_string_lossy();
        let path = directory.join("review.md");
        fs::write(
            &path,
            "---\ntitle: Code Review\ntags:\n  - Coding\ndescription: Review code\n---\nReview this code.",
        )
        .expect("frontmatter prompt should be created");

        let prompt = read_prompt_files(folder.to_string())
            .expect("frontmatter prompt should be listed")
            .pop()
            .expect("frontmatter prompt should exist");
        assert_eq!(prompt.title, "Code Review");
        assert_eq!(prompt.content, "Review this code.");

        save_prompt(
            &folder,
            "Updated Review",
            "Review this code carefully.",
            Some(&prompt.file_name),
        )
        .expect("frontmatter prompt should be updated");
        let updated = fs::read_to_string(path).expect("updated frontmatter should exist");
        assert!(updated.contains("title: Updated Review"));
        assert!(updated.contains("tags:"));
        assert!(updated.contains("- Coding"));
        assert!(updated.contains("description: Review code"));
        assert!(updated.ends_with("Review this code carefully."));

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn creates_unique_safe_file_names_and_rejects_path_traversal() {
        let directory = test_directory();
        let folder = directory.to_string_lossy();

        let first = save_prompt(&folder, "../Review?", "One", None).expect("first prompt");
        let second = save_prompt(&folder, "../Review?", "Two", None).expect("second prompt");
        assert_eq!(first.file_name, "Review.md");
        assert_eq!(second.file_name, "Review-2.md");
        assert!(save_prompt(&folder, "Review", "Unsafe", Some("..\\outside.md")).is_err());
        assert!(!directory.parent().unwrap().join("outside.md").exists());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn reads_multiple_markdown_imports_and_keeps_frontmatter_title() {
        let directory = test_directory();
        let first = directory.join("review.md");
        let second = directory.join("notes.MD");
        fs::write(
            &first,
            "---\ntitle: Imported Review\ntags: [coding]\n---\nReview {file}.",
        )
        .expect("first import should be written");
        fs::write(&second, "# Meeting Notes\n\nSummarize {transcript}.")
            .expect("second import should be written");

        let drafts = import_markdown_files(&[
            first.to_string_lossy().into_owned(),
            second.to_string_lossy().into_owned(),
        ])
        .expect("Markdown files should be read");
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].title, "Imported Review");
        assert_eq!(drafts[0].content, "Review {file}.");
        assert!(drafts[0].metadata.as_ref().unwrap().contains_key("tags"));
        assert_eq!(drafts[1].title, "Meeting Notes");
        assert_eq!(drafts[1].content, "Summarize {transcript}.");
        let imported = save_prompt_with_metadata(
            &directory.to_string_lossy(),
            &drafts[0].title,
            &drafts[0].content,
            None,
            drafts[0].metadata.clone(),
        )
        .expect("import should preserve YAML metadata");
        let markdown = fs::read_to_string(directory.join(imported.file_name))
            .expect("imported Markdown should exist");
        assert!(markdown.contains("tags:"));
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn imports_markdown_recursively_from_zip_without_extracting_paths() {
        let directory = test_directory();
        let archive_path = directory.join("prompts.zip");
        let archive = fs::File::create(&archive_path).expect("archive should be created");
        let mut writer = zip::ZipWriter::new(archive);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        writer
            .start_file("nested/review.md", options)
            .expect("nested prompt should be added");
        writer
            .write_all(b"# Imported Review\n\nReview {file}.")
            .expect("prompt content should be written");
        writer
            .start_file("../outside.md", options)
            .expect("path-like entry should be added");
        writer
            .write_all(b"Safe to read without extracting.")
            .expect("path-like content should be written");
        writer
            .start_file("nested/readme.txt", options)
            .expect("non-Markdown entry should be added");
        writer
            .write_all(b"Ignore this.")
            .expect("non-Markdown content should be written");
        writer.finish().expect("archive should be finalized");

        let drafts = import_zip_files(&[archive_path.to_string_lossy().into_owned()])
            .expect("ZIP Markdown entries should be imported");
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].title, "Imported Review");
        assert_eq!(drafts[0].content, "Review {file}.");
        assert_eq!(drafts[1].title, "outside");
        assert_eq!(drafts[1].content, "Safe to read without extracting.");
        assert!(!directory.parent().unwrap().join("outside.md").exists());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn default_quick_shortcut_is_a_valid_global_shortcut() {
        let _: Shortcut = DEFAULT_QUICK_SHORTCUT
            .parse()
            .expect("default quick shortcut should be valid");
    }
}
