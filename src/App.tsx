import { useEffect, useMemo, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type PromptFile = {
  fileName: string;
  title: string;
  content: string;
};

const directoryStorageKey = "prompt-clip.prompt-directory";

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

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const defaultDirectory = await invoke<string>("default_prompt_directory");
        const directory =
          localStorage.getItem(directoryStorageKey) ?? defaultDirectory;
        const files = await invoke<PromptFile[]>("read_prompt_files", {
          folderPath: directory,
        });
        if (cancelled) return;
        setFolderPath(directory);
        setPrompts(files);
        if (files.length > 0) {
          setSelectedFileName(files[0].fileName);
          setTitle(files[0].title);
          setContent(files[0].content);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(`無法載入 Prompt：${String(cause)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredPrompts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return prompts;
    return prompts.filter((prompt) =>
      `${prompt.title}\n${prompt.content}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [prompts, search]);

  function confirmDiscardChanges() {
    const selectedPrompt = prompts.find(
      (prompt) => prompt.fileName === selectedFileName,
    );
    const hasUnsavedChanges = selectedPrompt
      ? selectedPrompt.title !== title || selectedPrompt.content !== content
      : Boolean(title || content);
    return (
      !hasUnsavedChanges ||
      window.confirm("目前的變更尚未儲存，確定要捨棄嗎？")
    );
  }

  function resetEditor() {
    setSelectedFileName(null);
    setTitle("");
    setContent("");
    setNotice("");
    setError("");
  }

  function startNewPrompt() {
    if (!confirmDiscardChanges()) return;
    resetEditor();
  }

  function selectPrompt(prompt: PromptFile) {
    if (!confirmDiscardChanges()) return;
    setSelectedFileName(prompt.fileName);
    setTitle(prompt.title);
    setContent(prompt.content);
    setNotice("");
    setError("");
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
    if (!confirmDiscardChanges()) return;
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
      const files = await invoke<PromptFile[]>("read_prompt_files", {
        folderPath,
      });
      setPrompts(files);
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
      await invoke("delete_prompt_file", {
        folderPath,
        fileName: selectedFileName,
      });
      const files = await invoke<PromptFile[]>("read_prompt_files", {
        folderPath,
      });
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            P
          </div>
          <div>
            <h1>Prompt Clip</h1>
            <p>本地 Prompt 管理</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="shortcut-hint">
            快速切換 <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}</kbd> +
            <kbd>Shift</kbd> + <kbd>P</kbd>
          </span>
          <button className="button button-secondary" onClick={chooseFolder}>
            選擇資料夾
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div>
              <h2>Prompts</h2>
              <span className="count-label">{prompts.length} 個範本</span>
            </div>
            <button
              className="button button-primary button-compact"
              onClick={startNewPrompt}
              aria-label="新增 Prompt"
            >
              <span aria-hidden="true">＋</span> 新增
            </button>
          </div>

          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="搜尋標題或內容"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </label>

          <div className="prompt-list" aria-label="Prompt 清單">
            {loading ? (
              <p className="list-message">載入中…</p>
            ) : filteredPrompts.length === 0 ? (
              <p className="list-message">
                {search ? "找不到符合的 Prompt" : "還沒有 Prompt，新增一個開始使用。"}
              </p>
            ) : (
              filteredPrompts.map((prompt) => (
                <div
                  className={`prompt-item ${
                    selectedFileName === prompt.fileName ? "is-selected" : ""
                  }`}
                  key={prompt.fileName}
                >
                  <button
                    className="prompt-item-main"
                    onClick={() => void usePrompt(prompt)}
                    title="使用並複製 Prompt"
                  >
                    <span className="prompt-item-title">{prompt.title}</span>
                    <span className="prompt-item-preview">
                      {prompt.content || "尚無內容"}
                    </span>
                    <span className="prompt-item-file">{prompt.fileName}</span>
                  </button>
                  <button
                    className="prompt-edit-button"
                    onClick={() => selectPrompt(prompt)}
                    title="編輯 Prompt"
                    aria-label={`編輯 ${prompt.title}`}
                  >
                    編輯
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="folder-card">
            <span className="folder-icon" aria-hidden="true">
              ▰
            </span>
            <div>
              <span className="folder-label">儲存位置</span>
              <span className="folder-path" title={folderPath}>
                {folderPath || "正在載入…"}
              </span>
            </div>
          </div>
        </aside>

        <section className="editor-panel">
          <div className="editor-heading">
            <div>
              <span className="eyebrow">
                {selectedFileName ? "編輯範本" : "建立範本"}
              </span>
              <h2>{selectedFileName ? "Prompt 詳細資料" : "新增 Prompt"}</h2>
            </div>
            <span className="markdown-badge">.MD · 本機</span>
          </div>

          {error && (
            <div className="message message-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="message message-success" role="status">
              {notice}
            </div>
          )}

          <form className="prompt-form" onSubmit={savePrompt}>
            <label className="field">
              <span>標題</span>
              <input
                autoFocus
                maxLength={120}
                placeholder="例如：程式碼審查助理"
                required
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </label>

            <label className="field content-field">
              <span className="field-label-row">
                Prompt 內容
                <span>支援 Markdown</span>
              </span>
              <textarea
                placeholder={"描述你想重複使用的 Prompt…\n\n可使用 {變數名稱} 作為動態填寫欄位。"}
                value={content}
                onChange={(event) => setContent(event.currentTarget.value)}
              />
            </label>

            <div className="file-hint">
              <span aria-hidden="true">↳</span>
              {selectedFileName
                ? `變更會直接儲存至 ${selectedFileName}`
                : "儲存時會在所選資料夾建立新的 .md 檔案"}
            </div>

            <div className="form-actions">
              {selectedFileName && (
                <button
                  className="button button-danger"
                  type="button"
                  onClick={deletePrompt}
                >
                  刪除
                </button>
              )}
              <button
                className="button button-primary save-button"
                disabled={saving || loading || !folderPath}
                type="submit"
              >
                {saving ? "儲存中…" : "儲存 Prompt"}
              </button>
            </div>
          </form>
        </section>
      </div>

      {variablePrompt && (
        <div className="dialog-backdrop">
          <section
            aria-labelledby="variable-dialog-title"
            aria-modal="true"
            className="variable-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <span className="eyebrow">填寫變數</span>
              <h2 id="variable-dialog-title">{variablePrompt.title}</h2>
              <p>填入 Prompt 中的欄位，完成後會複製至剪貼簿。</p>
            </div>
            {error && (
              <div className="message message-error" role="alert">
                {error}
              </div>
            )}
            <form className="variable-form" onSubmit={copyFilledPrompt}>
              {promptVariables(variablePrompt.content).map((variable, index) => (
                <label className="field" key={variable}>
                  <span>{variable}</span>
                  <input
                    autoFocus={index === 0}
                    value={variableValues[variable] ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setVariableValues((current) => ({
                        ...current,
                        [variable]: value,
                      }));
                    }}
                    placeholder={`輸入${variable}`}
                  />
                </label>
              ))}
              <div className="dialog-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setVariablePrompt(null)}
                >
                  取消
                </button>
                <button className="button button-primary" type="submit">
                  填寫並複製
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
