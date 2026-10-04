use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptFile {
    file_name: String,
    title: String,
    content: String,
    #[serde(skip_serializing)]
    metadata: BTreeMap<String, serde_yaml_ng::Value>,
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

    let file_title = path
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main_window(app);
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

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Prompt Clip")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if let Err(error) = window.show().and_then(|()| window.set_focus()) {
                                eprintln!("Could not show Prompt Clip: {error}");
                            }
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

            let shortcut: Shortcut = "CommandOrControl+Shift+P".parse()?;
            app.global_shortcut().register(shortcut)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("Could not hide Prompt Clip: {error}");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            default_prompt_directory,
            read_prompt_files,
            save_prompt_file,
            delete_prompt_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
