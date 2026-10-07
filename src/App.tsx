import { useEffect, useMemo, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type PromptFile = {
  fileName: string;
  title: string;
  content: string;
};

type PromptDraft = {
  title: string;
  content: string;
  metadata?: Record<string, unknown> | null;
};

const directoryStorageKey = "prompt-clip.prompt-directory";
const themeStorageKey = "prompt-clip.theme";
const sidebarStorageKey = "prompt-clip.sidebar-collapsed";
const onboardingStorageKey = "prompt-clip.onboarding-complete";
const quickWindow = getCurrentWindow().label === "quick";
type ThemePreference = "system" | "light" | "dark";
type Theme = Exclude<ThemePreference, "system">;
type SettingsCategory = "appearance" | "data" | "shortcuts";

function isThemePreference(value: string): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem(themeStorageKey);
  return stored && isThemePreference(stored) ? stored : "system";
}

function BrandMark({ className = "" }: { className?: string }) {
  return <img className={className} src="/prompt-clip-mark.svg" alt="" aria-hidden="true" />;
}

function promptVariables(content: string) {
  return [
    ...new Set(
      Array.from(content.matchAll(/\{([^{}]+)\}/g), (match) => match[1].trim()).filter(
        Boolean,
      ),
    ),
  ];
}

function App() {
  const [folderPath, setFolderPath] = useState("");
  const [prompts, setPrompts] = useState<PromptFile[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [variablePrompt, setVariablePrompt] = useState<PromptFile | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [showImporter, setShowImporter] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [importQueue, setImportQueue] = useState<PromptDraft[]>([]);
  const [importIndex, setImportIndex] = useState(0);
  const [importConflict, setImportConflict] = useState<PromptFile | null>(null);
  const [checkingImportConflict, setCheckingImportConflict] = useState(false);
  const [processingImport, setProcessingImport] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [shortcut, setShortcut] = useState("Ctrl+Shift+Space");
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [savingShortcut, setSavingShortcut] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>("appearance");
  const [showImportHelp, setShowImportHelp] = useState(false);
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(readThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const theme: Theme =
    themePreference === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : themePreference;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(sidebarStorageKey) === "true",
  );
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (!quickWindow && localStorage.getItem(onboardingStorageKey) !== "true") {
      setShowWelcome(true);
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemPrefersDark(media.matches);
    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    if (!quickWindow) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<ThemePreference>("prompt-clip-theme-changed", (event) => {
      if (isThemePreference(event.payload)) {
        setThemePreference(event.payload);
      }
    }).then((dispose) => {
      if (active) unlisten = dispose;
      else dispose();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  function changeThemePreference(preference: ThemePreference) {
    setThemePreference(preference);
    localStorage.setItem(themeStorageKey, preference);
    void emit("prompt-clip-theme-changed", preference).catch((cause) => {
      setError(`無法同步深色模式：${String(cause)}`);
    });
  }

  function toggleSidebar() {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    localStorage.setItem(sidebarStorageKey, String(collapsed));
  }

  async function runWindowAction(action: "minimize" | "toggleMaximize" | "close") {
    const currentWindow = getCurrentWindow();
    try {
      if (action === "minimize") {
        await currentWindow.minimize();
      } else if (action === "toggleMaximize") {
        await currentWindow.toggleMaximize();
      } else {
        await currentWindow.close();
      }
    } catch (cause) {
      setError(`無法操作視窗：${String(cause)}`);
    }
  }

  function dismissWelcome() {
    localStorage.setItem(onboardingStorageKey, "true");
    setShowWelcome(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const defaultDirectory = await invoke<string>("default_prompt_directory");
        const directory = localStorage.getItem(directoryStorageKey) ?? defaultDirectory;
        const files = await invoke<PromptFile[]>("read_prompt_files", {
          folderPath: directory,
        });
        const savedShortcut = await invoke<string>("get_quick_shortcut");
        if (cancelled) return;
        setFolderPath(directory);
        setPrompts(files);
        setShortcut(savedShortcut);
        if (files.length > 0) {
          setSelectedFileName(files[0].fileName);
          setTitle(files[0].title);
          setContent(files[0].content);
        }
      } catch (cause) {
        if (!cancelled) setError(`無法載入 Prompt：${String(cause)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!quickWindow) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<string>("prompt-folder-changed", async (event) => {
      localStorage.setItem(directoryStorageKey, event.payload);
      setFolderPath(event.payload);
      try {
        setPrompts(
          await invoke<PromptFile[]>("read_prompt_files", {
            folderPath: event.payload,
          }),
        );
      } catch (cause) {
        setError(`無法載入 Prompt 資料夾：${String(cause)}`);
      }
    }).then((dispose) => {
      if (active) unlisten = dispose;
      else dispose();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!recordingShortcut) return;
    function captureShortcut(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;

      const modifiers = [
        event.ctrlKey && "Ctrl",
        event.altKey && "Alt",
        event.shiftKey && "Shift",
        event.metaKey && "Super",
      ].filter(Boolean);
      const key =
        event.code === "Space"
          ? "Space"
          : event.code.startsWith("Key")
            ? event.code.slice(3)
            : event.code.startsWith("Digit")
              ? event.code.slice(5)
              : event.key.length === 1
                ? event.key.toUpperCase()
                : event.key;
      if (modifiers.length === 0) return;
      setShortcutDraft([...modifiers, key].join("+"));
      setRecordingShortcut(false);
    }
    window.addEventListener("keydown", captureShortcut, true);
    return () => window.removeEventListener("keydown", captureShortcut, true);
  }, [recordingShortcut]);

  const filteredPrompts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return prompts;
    return prompts.filter((prompt) =>
      `${prompt.title}\n${prompt.content}`.toLocaleLowerCase().includes(query),
    );
  }, [prompts, search]);

  function confirmDiscardChanges() {
    const selectedPrompt = prompts.find(
      (prompt) => prompt.fileName === selectedFileName,
    );
    const hasUnsavedChanges = selectedPrompt
      ? selectedPrompt.title !== title || selectedPrompt.content !== content
      : Boolean(title || content);
    return !hasUnsavedChanges || window.confirm("目前的變更尚未儲存，確定要捨棄嗎？");
  }

  function resetEditor() {
    setSelectedFileName(null);
    setTitle("");
    setContent("");
    setNotice("");
    setError("");
  }

  async function refreshPrompts() {
    if (!folderPath) return;
    const files = await invoke<PromptFile[]>("read_prompt_files", { folderPath });
    setPrompts(files);
  }

  async function copyPrompt(prompt: PromptFile, values?: Record<string, string>) {
    const text = prompt.content.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
      values ? (values[name.trim()] ?? placeholder) : placeholder,
    );
    setError("");
    try {
      await writeText(text);
    } catch (cause) {
      setError(`無法複製 Prompt：${String(cause)}`);
      return false;
    }
    setNotice("Prompt 已複製到剪貼簿。");
    try {
      await getCurrentWindow().hide();
    } catch (cause) {
      setError(`Prompt 已複製，但無法隱藏視窗：${String(cause)}`);
    }
    return true;
  }

  async function usePrompt(prompt: PromptFile) {
    if (!quickWindow && !confirmDiscardChanges()) return;
    setNotice("");
    const variables = promptVariables(prompt.content);
    if (variables.length === 0) {
      await copyPrompt(prompt);
      return;
    }
    setVariablePrompt(prompt);
    setVariableValues(Object.fromEntries(variables.map((variable) => [variable, ""])));
    setError("");
  }

  async function copyFilledPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!variablePrompt) return;
    if (await copyPrompt(variablePrompt, variableValues)) {
      setVariablePrompt(null);
      setVariableValues({});
    }
  }

  async function openQuickWindow() {
    try {
      await invoke("show_quick_window_command");
    } catch (cause) {
      setError(`無法開啟取用視窗：${String(cause)}`);
    }
  }

  async function openMainWindow() {
    try {
      await invoke("open_main_window");
    } catch (cause) {
      setError(`無法回到主 App：${String(cause)}`);
    }
  }

  async function chooseFolder() {
    if (!confirmDiscardChanges()) return;
    setError("");
    setNotice("");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "選擇 Prompt 資料夾",
      });
      if (typeof selected !== "string") return;
      const files = await invoke<PromptFile[]>("read_prompt_files", {
        folderPath: selected,
      });
      localStorage.setItem(directoryStorageKey, selected);
      setFolderPath(selected);
      setPrompts(files);
      await emit("prompt-folder-changed", selected);
      if (files.length > 0) {
        setSelectedFileName(files[0].fileName);
        setTitle(files[0].title);
        setContent(files[0].content);
      } else {
        resetEditor();
      }
    } catch (cause) {
      setError(`無法開啟 Prompt 資料夾：${String(cause)}`);
    }
  }

  async function savePrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!folderPath) {
      setError("尚未載入 Prompt 資料夾，請重新啟動應用程式。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await invoke<PromptFile>("save_prompt_file", {
        folderPath,
        title,
        content,
        fileName: selectedFileName,
      });
      await refreshPrompts();
      setSelectedFileName(saved.fileName);
      setTitle(saved.title);
      setContent(saved.content);
      setNotice("Prompt 已儲存至本地 Markdown 檔案。");
    } catch (cause) {
      setError(`無法儲存 Prompt：${String(cause)}`);
    } finally {
      setSaving(false);
    }
  }

  async function deletePrompt() {
    if (!selectedFileName || !folderPath) return;
    if (!window.confirm(`確定要刪除「${title}」嗎？此操作無法復原。`)) return;
    setError("");
    setNotice("");
    try {
      await invoke("delete_prompt_file", { folderPath, fileName: selectedFileName });
      const files = await invoke<PromptFile[]>("read_prompt_files", { folderPath });
      setPrompts(files);
      if (files.length > 0) {
        setSelectedFileName(files[0].fileName);
        setTitle(files[0].title);
        setContent(files[0].content);
      } else {
        resetEditor();
      }
      setNotice("Prompt 與本地 Markdown 檔案已刪除。");
    } catch (cause) {
      setError(`無法刪除 Prompt：${String(cause)}`);
    }
  }

  async function queueDrafts(drafts: PromptDraft[]) {
    if (!drafts.length) {
      setError("沒有找到可匯入的 Prompt。");
      return;
    }
    if (drafts.length > 500) {
      setError("單次最多可匯入 500 個 Prompt。");
      return;
    }
    const totalBytes = drafts.reduce(
      (total, draft) =>
        total +
        new TextEncoder().encode(draft.title).byteLength +
        new TextEncoder().encode(draft.content).byteLength,
      0,
    );
    if (totalBytes > 10 * 1024 * 1024) {
      setError("單次匯入的文字總量不可超過 10 MB。");
      return;
    }
    if (drafts.some((draft) => !draft.title.trim() || typeof draft.content !== "string")) {
      setError("每筆 Prompt 都必須有非空標題與文字內容。");
      return;
    }
    setError("");
    setNotice("");
    setImportQueue(drafts);
    setImportIndex(0);
    setImportedCount(0);
    setSkippedCount(0);
    setImportConflict(null);
    setCheckingImportConflict(true);
    setShowImporter(false);
    try {
      const conflict = await invoke<PromptFile | null>("find_import_conflict", {
        folderPath,
        title: drafts[0].title,
      });
      setImportConflict(conflict);
      setCheckingImportConflict(false);
    } catch (cause) {
      setImportQueue([]);
      setCheckingImportConflict(false);
      setError(`無法檢查匯入項目：${String(cause)}`);
    }
  }

  async function advanceImport(nextIndex: number, imported: number, skipped: number) {
    if (nextIndex >= importQueue.length) {
      setImportQueue([]);
      setImportConflict(null);
      try {
        await refreshPrompts();
        setNotice(`匯入完成：新增／覆寫 ${imported} 個，略過 ${skipped} 個。`);
      } catch (cause) {
        setError(`匯入已完成，但無法重新載入清單：${String(cause)}`);
      }
      return;
    }
    setImportIndex(nextIndex);
    setImportConflict(null);
    setCheckingImportConflict(true);
    try {
      const conflict = await invoke<PromptFile | null>("find_import_conflict", {
        folderPath,
        title: importQueue[nextIndex].title,
      });
      setImportConflict(conflict);
      setCheckingImportConflict(false);
    } catch (cause) {
      setImportQueue([]);
      setCheckingImportConflict(false);
      setError(`無法檢查匯入項目：${String(cause)}`);
    }
  }

  async function decideImport(overwrite: boolean) {
    if (processingImport || checkingImportConflict) return;
    const draft = importQueue[importIndex];
    if (!draft) return;
    setProcessingImport(true);
    let imported = importedCount;
    let skipped = skippedCount;
    try {
      if (overwrite || !importConflict) {
        await invoke<PromptFile>("import_prompt_file", {
          folderPath,
          title: draft.title.trim(),
          content: draft.content,
          overwriteFileName: overwrite ? importConflict?.fileName ?? null : null,
          metadata: draft.metadata ?? null,
        });
        imported += 1;
        setImportedCount(imported);
      } else {
        skipped += 1;
        setSkippedCount(skipped);
      }
      await advanceImport(importIndex + 1, imported, skipped);
    } catch (cause) {
      setError(`匯入「${draft.title}」失敗：${String(cause)}`);
    } finally {
      setProcessingImport(false);
    }
  }

  async function readSelectedFiles(archive: boolean) {
    setError("");
    try {
      const selected = await open({
        multiple: true,
        title: archive ? "選擇 ZIP 壓縮檔" : "選擇 Markdown 檔案",
        filters: [
          {
            name: archive ? "ZIP" : "Markdown",
            extensions: [archive ? "zip" : "md"],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const drafts = await invoke<PromptDraft[]>(
        archive ? "read_zip_import" : "read_markdown_import",
        { paths },
      );
      await queueDrafts(drafts);
    } catch (cause) {
      setError(`讀取匯入檔案失敗：${String(cause)}`);
    }
  }

  async function importJsonText() {
    try {
      const parsed: unknown = JSON.parse(jsonText);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "prompts" in parsed
          ? (parsed as { prompts: unknown }).prompts
          : null;
      if (!Array.isArray(list)) {
        throw new Error("JSON 頂層必須是陣列，或包含 prompts 陣列。");
      }
      const drafts = list.map((item, index) => {
        if (
          !item ||
          typeof item !== "object" ||
          !("title" in item) ||
          !("content" in item) ||
          typeof item.title !== "string" ||
          typeof item.content !== "string"
        ) {
          throw new Error(`第 ${index + 1} 筆必須包含字串 title 與 content。`);
        }
        return { title: item.title, content: item.content };
      });
      await queueDrafts(drafts);
    } catch (cause) {
      setError(`文字格式不正確：${String(cause)}`);
    }
  }

  async function saveShortcut() {
    setSavingShortcut(true);
    setError("");
    try {
      const saved = await invoke<string>("set_quick_shortcut", {
        shortcut: shortcutDraft,
      });
      setShortcut(saved);
      setShortcutDraft("");
      setNotice(`取用視窗快捷鍵已設為 ${saved}。`);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSavingShortcut(false);
    }
  }

  function cancelImportBatch() {
    if (processingImport) return;
    setImportQueue([]);
    setImportConflict(null);
    setNotice(`匯入已停止。已處理 ${importedCount} 筆。`);
    void refreshPrompts().catch((cause) =>
      setError(`無法重新載入 Prompt 清單：${String(cause)}`),
    );
  }

  function closeSettings() {
    setShowSettings(false);
    setShowImportHelp(false);
    setRecordingShortcut(false);
    setError("");
  }

  const importStep = importQueue[importIndex];

  if (quickWindow) {
    return (
      <main className="quick-shell" data-theme={theme}>
        <header className="quick-header">
          <div className="quick-brand">
            <BrandMark className="quick-brand-mark" />
            <div>
              <p className="eyebrow">PROMPT CLIP</p>
              <h1>取用 Prompt</h1>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={() => void openMainWindow()}
            title="回到主 App"
            aria-label="回到主 App"
          >
            ↗
          </button>
        </header>
        <label className="search-box quick-search">
          <span aria-hidden="true">⌕</span>
          <input
            autoFocus
            type="search"
            placeholder="搜尋 Prompt"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        {error && <p className="message message-error">{error}</p>}
        <div className="quick-list" aria-label="Prompt 清單">
          {loading ? (
            <p className="list-message">載入中…</p>
          ) : filteredPrompts.length ? (
            filteredPrompts.map((prompt) => (
              <button
                className="quick-prompt"
                key={prompt.fileName}
                onClick={() => void usePrompt(prompt)}
              >
                <span>{prompt.title}</span>
                <small>{prompt.content || "尚無內容"}</small>
              </button>
            ))
          ) : (
            <p className="list-message">
              {search ? "找不到符合的 Prompt" : "尚無 Prompt，請先回主 App 新增。"}
            </p>
          )}
        </div>
        <footer className="quick-footer">
          <span>按一下即可複製到剪貼簿</span>
          <button className="text-button" onClick={() => void openMainWindow()}>
            回到主 App
          </button>
        </footer>
        {variablePrompt && (
          <VariableDialog
            prompt={variablePrompt}
            values={variableValues}
            error={error}
            setValues={setVariableValues}
            onCancel={() => setVariablePrompt(null)}
            onSubmit={copyFilledPrompt}
          />
        )}
      </main>
    );
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} data-theme={theme}>
      <aside className={`sidebar ${sidebarCollapsed ? "" : "is-expanded"}`}>
        <div className="sidebar-head">
          <div className="brand">
            <BrandMark className="brand-mark" />
            <div>
              <h1>Prompt Clip</h1>
              <p>本機提示詞資料庫</p>
            </div>
          </div>
          <button
            className="sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "展開側邊欄" : "收起側邊欄"}
            aria-label={sidebarCollapsed ? "展開側邊欄" : "收起側邊欄"}
          >
            <span aria-hidden="true">{sidebarCollapsed ? "»" : "«"}</span>
          </button>
        </div>

        <nav className="primary-nav" aria-label="主要功能">
          <span className="nav-section-label">工作區</span>
          <button className="nav-item active" title="提示詞" aria-label="提示詞">
            <span aria-hidden="true">▤</span> 提示詞
            <span className="nav-count">{prompts.length}</span>
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setSettingsCategory("appearance");
              setShowSettings(true);
            }}
            title="設定"
            aria-label="設定"
          >
            <span aria-hidden="true">⚙</span> 設定
          </button>
        </nav>

        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={() => setShowWelcome(true)}
            title="查看提示"
            aria-label="查看提示"
          >
            <span aria-hidden="true">?</span> 查看提示
          </button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="page-header" data-tauri-drag-region>
          <div>
            <span className="eyebrow">個人工作區</span>
            <h2 className="page-title">
              <BrandMark className="page-title-mark" />
              提示詞
            </h2>
            <p>整理常用內容，需要時快速複製。</p>
          </div>
          <div className="header-actions">
            <button
              className="button button-secondary shortcut-action"
              onClick={() => void openQuickWindow()}
              title={`開啟取用視窗 (${shortcut})`}
            >
              <span className="shortcut-action-label">開啟取用視窗</span>
              <kbd>{shortcut}</kbd>
            </button>
            <button className="button button-secondary" onClick={() => setShowImporter(true)}>
              匯入
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                if (confirmDiscardChanges()) resetEditor();
              }}
            >
              新增提示詞
            </button>
            <div className="window-controls" aria-label="視窗控制">
              <button
                type="button"
                onClick={() => void runWindowAction("minimize")}
                title="最小化"
                aria-label="最小化視窗"
              >
                <span aria-hidden="true">−</span>
              </button>
              <button
                type="button"
                onClick={() => void runWindowAction("toggleMaximize")}
                title="最大化或還原"
                aria-label="最大化或還原視窗"
              >
                <span aria-hidden="true">□</span>
              </button>
              <button
                className="window-close"
                type="button"
                onClick={() => void runWindowAction("close")}
                title="關閉"
                aria-label="關閉視窗"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>
        </header>

        <div className="workspace">
          <section className="library-panel">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="搜尋標題或內容"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
            </label>
            <div className="library-heading">
              <span>全部提示詞</span>
              <span className="count-label">{filteredPrompts.length}</span>
            </div>
            <div className="prompt-list" aria-label="Prompt 清單">
              {loading ? (
                <p className="list-message">載入中…</p>
              ) : filteredPrompts.length === 0 ? (
                <p className="list-message">
                  {search ? "找不到符合的項目" : "尚無提示詞，新增一筆開始整理。"}
                </p>
              ) : (
                filteredPrompts.map((prompt) => (
                  <article
                    className={`prompt-item ${selectedFileName === prompt.fileName ? "is-selected" : ""}`}
                    key={prompt.fileName}
                  >
                    <button
                      className="prompt-item-main"
                      onClick={() => {
                        if (!confirmDiscardChanges()) return;
                        setSelectedFileName(prompt.fileName);
                        setTitle(prompt.title);
                        setContent(prompt.content);
                        setError("");
                        setNotice("");
                      }}
                    >
                      <span className="prompt-item-title">{prompt.title}</span>
                      <span className="prompt-item-preview">
                        {prompt.content || "尚無內容"}
                      </span>
                    </button>
                    <button
                      className="use-button"
                      onClick={() => void usePrompt(prompt)}
                      title="取用並複製"
                    >
                      取用
                    </button>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="editor-panel">
            <div className="editor-heading">
              <div>
                <span className="eyebrow">{selectedFileName ? "提示詞" : "新項目"}</span>
                <h3>{selectedFileName ? title || "未命名提示詞" : "建立提示詞"}</h3>
              </div>
              <span className="format-label">Markdown</span>
            </div>
            {error && <div className="message message-error" role="alert">{error}</div>}
            {notice && <div className="message message-success" role="status">{notice}</div>}
            <form className="prompt-form" onSubmit={savePrompt}>
              <label className="field">
                <span>標題</span>
                <input
                  maxLength={120}
                  placeholder="為這筆提示詞命名"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
              </label>
              <label className="field content-field">
                <span className="field-label-row">
                  內容 <span>支援 Markdown 與 {"{變數}"}</span>
                </span>
                <textarea
                  placeholder={"撰寫可重複使用的提示詞…\n\n以 {變數名稱} 加入可填寫欄位。"}
                  value={content}
                  onChange={(event) => setContent(event.currentTarget.value)}
                />
              </label>
              <div className="file-hint">
                {selectedFileName
                  ? `儲存至 ${selectedFileName}`
                  : "儲存後會建立本機 .md 檔案"}
              </div>
              <div className="form-actions">
                {selectedFileName && (
                  <button className="button button-danger" type="button" onClick={deletePrompt}>
                    刪除
                  </button>
                )}
                <button
                  className="button button-primary"
                  disabled={saving || loading || !folderPath}
                  type="submit"
                >
                  {saving ? "儲存中…" : "儲存"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </section>

      {variablePrompt && (
        <VariableDialog
          prompt={variablePrompt}
          values={variableValues}
          error={error}
          setValues={setVariableValues}
          onCancel={() => setVariablePrompt(null)}
          onSubmit={copyFilledPrompt}
        />
      )}

      {showImporter && (
        <div className="dialog-backdrop" onClick={() => setShowImporter(false)}>
          <section
            className="modal import-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <span className="eyebrow">資料管理</span>
              <h2>批次匯入</h2>
              <p>支援 Markdown 檔、ZIP 壓縮檔或 JSON 文字。</p>
            </div>
            {error && <div className="message message-error" role="alert">{error}</div>}
            <div className="import-sources">
              <button className="import-source" onClick={() => void readSelectedFiles(false)}>
                <strong>Markdown 檔案</strong>
                <span>一次選取多個 .md</span>
              </button>
              <button className="import-source" onClick={() => void readSelectedFiles(true)}>
                <strong>ZIP 壓縮檔</strong>
                <span>遞迴讀取其中的 .md 檔案</span>
              </button>
            </div>
            <label className="field json-field">
              <span>JSON 文字格式</span>
              <textarea
                value={jsonText}
                onChange={(event) => setJsonText(event.currentTarget.value)}
                placeholder={'[\n  {\n    "title": "程式碼審查",\n    "content": "請檢查 {檔案} 的程式碼。"\n  }\n]'}
              />
            </label>
            <p className="import-note">
              每筆需包含字串 <code>title</code> 與 <code>content</code>。同名時可逐筆覆寫或略過。
            </p>
            <button
              className="text-button import-help-link"
              onClick={() => setShowImportHelp(true)}
            >
              查看匯入格式與範例
            </button>
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={() => setShowImporter(false)}>
                關閉
              </button>
              <button
                className="button button-primary"
                disabled={!jsonText.trim()}
                onClick={() => void importJsonText()}
              >
                匯入 JSON
              </button>
            </div>
          </section>
        </div>
      )}

      {importStep && (
        <div className="dialog-backdrop" onClick={cancelImportBatch}>
          <section
            className="modal import-step"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">
              匯入進度 {importIndex + 1} / {importQueue.length}
            </span>
            <h2>{importConflict ? "發現同名提示詞" : "匯入提示詞"}</h2>
            <p className="import-preview-title">{importStep.title}</p>
            <p className="import-preview-content">{importStep.content || "（內容為空）"}</p>
            {importConflict && (
              <p className="conflict-note">
                已有「{importConflict.title}」。你可以覆寫既有內容，或略過此筆。
              </p>
            )}
            <div className="dialog-actions">
              {importConflict ? (
                <button
                  className="button button-secondary"
                  disabled={checkingImportConflict || processingImport}
                  onClick={() => void decideImport(false)}
                >
                  略過
                </button>
              ) : (
                <button
                  className="button button-secondary"
                  disabled={checkingImportConflict || processingImport}
                  onClick={() => {
                    cancelImportBatch();
                  }}
                >
                  取消整批
                </button>
              )}
              <button
                className="button button-primary"
                disabled={checkingImportConflict || processingImport}
                onClick={() => void decideImport(Boolean(importConflict))}
              >
                {importConflict ? "覆寫" : "匯入"}
              </button>
            </div>
            <button
              className="text-button cancel-import"
              disabled={processingImport}
              onClick={cancelImportBatch}
            >
              停止剩餘匯入
            </button>
          </section>
        </div>
      )}

      {showSettings && (
        <div className="dialog-backdrop" onClick={closeSettings}>
          <section
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <aside className="settings-nav" aria-label="設定分類">
              <span className="eyebrow">設定</span>
              <button
                className={settingsCategory === "appearance" ? "is-active" : ""}
                onClick={() => setSettingsCategory("appearance")}
              >
                <span aria-hidden="true">◐</span> 外觀
              </button>
              <button
                className={settingsCategory === "data" ? "is-active" : ""}
                onClick={() => setSettingsCategory("data")}
              >
                <span aria-hidden="true">▰</span> 資料與儲存
              </button>
              <button
                className={settingsCategory === "shortcuts" ? "is-active" : ""}
                onClick={() => setSettingsCategory("shortcuts")}
              >
                <span aria-hidden="true">⌘</span> 快捷鍵
              </button>
            </aside>

            <div className="settings-content">
              {settingsCategory === "appearance" && (
                <>
                  <div className="dialog-heading">
                    <span className="eyebrow">偏好設定</span>
                    <h2 id="settings-title">外觀</h2>
                    <p>選擇符合你工作環境的顯示方式。</p>
                  </div>
                  <label className="setting-row">
                    <span>
                      <strong>色彩主題</strong>
                      <small>可固定淺色、深色，或跟隨系統設定。</small>
                    </span>
                    <select
                      value={themePreference}
                      onChange={(event) => {
                        const preference = event.currentTarget.value;
                        if (isThemePreference(preference)) {
                          changeThemePreference(preference);
                        }
                      }}
                    >
                      <option value="system">與系統相同</option>
                      <option value="light">淺色</option>
                      <option value="dark">深色</option>
                    </select>
                  </label>
                </>
              )}

              {settingsCategory === "data" && (
                <>
                  <div className="dialog-heading">
                    <span className="eyebrow">偏好設定</span>
                    <h2 id="settings-title">資料與儲存</h2>
                    <p>管理提示詞所在的本機資料夾。</p>
                  </div>
                  <div className="setting-row folder-setting">
                    <span>
                      <strong>目前資料夾</strong>
                      <small className="folder-location">{folderPath || "載入中…"}</small>
                    </span>
                    <button
                      className="button button-secondary"
                      onClick={() => void chooseFolder()}
                    >
                      選擇資料夾
                    </button>
                  </div>
                  <p className="import-note">
                    提示詞以 Markdown 檔案儲存在此資料夾。選擇新資料夾不會搬移原有檔案。
                  </p>
                </>
              )}

              {settingsCategory === "shortcuts" && (
                <>
                  <div className="dialog-heading">
                    <span className="eyebrow">偏好設定</span>
                    <h2 id="settings-title">取用快捷鍵</h2>
                    <p>按下快捷鍵即可切換精簡取用視窗的顯示狀態。</p>
                  </div>
                  {error && <div className="message message-error" role="alert">{error}</div>}
                  {notice && <div className="message message-success" role="status">{notice}</div>}
                  <div className="shortcut-editor">
                    <kbd>{shortcutDraft || shortcut}</kbd>
                    <button
                      className="button button-secondary"
                      onClick={() => {
                        setShortcutDraft("");
                        setRecordingShortcut(true);
                      }}
                    >
                      {recordingShortcut ? "請按下組合鍵…" : "錄製快捷鍵"}
                    </button>
                  </div>
                  <p className="import-note">
                    預設為 Ctrl+Shift+Space。快捷鍵若被其他程式使用，請改用其他組合。
                  </p>
                </>
              )}

              <div className="dialog-actions">
                <button className="button button-secondary" onClick={closeSettings}>
                  關閉
                </button>
                {settingsCategory === "shortcuts" && (
                  <button
                    className="button button-primary"
                    disabled={!shortcutDraft || recordingShortcut || savingShortcut}
                    onClick={() => void saveShortcut()}
                  >
                    {savingShortcut ? "儲存中…" : "儲存快捷鍵"}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {showImportHelp && (
        <div
          className="dialog-backdrop import-help-backdrop"
          onClick={() => setShowImportHelp(false)}
        >
          <section
            className="modal import-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <span className="eyebrow">批次匯入</span>
              <h2 id="import-help-title">格式與範例</h2>
              <p>
                可一次選取多個 Markdown 檔案、匯入含有 .md 檔案的 ZIP，或貼上 JSON。
                ZIP 內的子資料夾也會一併搜尋。
              </p>
            </div>
            <div className="import-format-list">
              <p><strong>JSON 格式</strong>：最上層為提示詞陣列，或包含 <code>prompts</code> 陣列的物件。</p>
              <pre>{`[
  {
    "title": "程式碼審查",
    "content": "請檢查 {檔案} 的程式碼，並列出改善建議。"
  }
]`}</pre>
              <p>每筆都必須有非空的 <code>title</code> 和字串 <code>content</code>。單次最多 500 筆、文字總量 10 MB；遇到同名項目可選擇覆寫或略過。</p>
            </div>
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={() => setShowImportHelp(false)}>
                返回匯入
              </button>
            </div>
          </section>
        </div>
      )}

      {showWelcome && (
        <div className="dialog-backdrop welcome-backdrop" onClick={dismissWelcome}>
          <section
            className="modal welcome-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
            onClick={(event) => event.stopPropagation()}
          >
            <BrandMark className="welcome-mark" />
            <span className="eyebrow">WELCOME TO PROMPT CLIP</span>
            <h2 id="welcome-title">讓常用提示詞，隨手可得</h2>
            <p>在本機整理、搜尋並重複使用你的 AI 提示詞，內容只儲存在自己的資料夾。</p>
            <ol className="welcome-steps">
              <li>
                <strong>建立提示詞</strong>
                <span>新增內容，支援 Markdown 與可填寫變數。</span>
              </li>
              <li>
                <strong>快速取用</strong>
                <span>按「取用」複製，或開啟精簡取用視窗。</span>
              </li>
              <li>
                <strong>自訂工作區</strong>
                <span>側邊欄可收合；外觀與資料夾可在「設定」調整。</span>
              </li>
              <li>
                <strong>批次匯入</strong>
                <span>可匯入多個 Markdown、含子資料夾的 ZIP，或 JSON；最多 500 筆、10 MB。</span>
              </li>
            </ol>
            <p className="welcome-shortcut">
              快捷鍵提示會在滑鼠移到取用視窗按鈕時顯示；匯入視窗也有格式範例。
            </p>
            <div className="dialog-actions">
              <button className="button button-primary" onClick={dismissWelcome}>開始使用</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function VariableDialog({
  prompt,
  values,
  error,
  setValues,
  onCancel,
  onSubmit,
}: {
  prompt: PromptFile;
  values: Record<string, string>;
  error: string;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <section
        aria-labelledby="variable-dialog-title"
        aria-modal="true"
        className="modal variable-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <span className="eyebrow">填寫變數</span>
          <h2 id="variable-dialog-title">{prompt.title}</h2>
          <p>填入欄位後，完成內容會複製至剪貼簿。</p>
        </div>
        {error && <div className="message message-error" role="alert">{error}</div>}
        <form className="variable-form" onSubmit={onSubmit}>
          {promptVariables(prompt.content).map((variable, index) => (
            <label className="field" key={variable}>
              <span>{variable}</span>
              <input
                autoFocus={index === 0}
                value={values[variable] ?? ""}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setValues((current) => ({ ...current, [variable]: value }));
                }}
                placeholder={`輸入${variable}`}
              />
            </label>
          ))}
          <div className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={onCancel}>
              取消
            </button>
            <button className="button button-primary" type="submit">
              填寫並複製
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default App;
