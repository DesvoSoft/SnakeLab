/* SnakeLab - App bootstrap */
(() => {
  // ===== State =====
  let editor = null;
  let pyodide = null;
  let fsHandle = null; // FileSystemFileHandle
  const STORAGE_KEY = "snakelab.current";
  const FILES = new Map(); // virtual project files (name -> content)
  let activeFile = null;

  // ===== DOM =====
  const FILENAME_INPUT = document.getElementById("filename-input");
  const STATUS_FILENAME = document.getElementById("status-filename");
  const STATUS_POS = document.getElementById("status-pos");
  const PYODIDE_STATUS = document.getElementById("pyodide-status");
  const OUTPUT = document.getElementById("output");
  const FILE_LIST = document.getElementById("file-list");
  const HIDDEN_INPUT = document.getElementById("hidden-file-input");

  // Actions
  const runBtn = document.getElementById("run-btn");
  const newBtn = document.getElementById("new-btn");
  const openBtn = document.getElementById("open-btn");
  const saveBtn = document.getElementById("save-btn");
  const formatBtn = document.getElementById("format-btn");
  const copyOutputBtn = document.getElementById("copy-output-btn");
  const clearOutputBtn = document.getElementById("clear-output-btn");
  const sidebarNewBtn = document.getElementById("sidebar-new");
  const themeSelect = document.getElementById("theme-select");
  const fontSizeSelect = document.getElementById("fontsize-select");

  // ===== Monaco load (AMD) =====
  require.config({
    paths: {
      vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs",
    },
  });

  require(["vs/editor/editor.main"], async function () {
    defineSnakeTheme();
    editor = monaco.editor.create(document.getElementById("editor"), {
      value: getInitialCode(),
      language: "python",
      theme: "snake-dark",
      automaticLayout: true,
      fontSize: Number(fontSizeSelect.value) || 14,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });

    // Cursor status
    editor.onDidChangeCursorPosition((e) => {
      STATUS_POS.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    });

    // Autosave current buffer
    editor.onDidChangeModelContent(
      debounce(() => {
        localStorage.setItem(STORAGE_KEY, editor.getValue());
        // sync to virtual file if any
        if (activeFile) FILES.set(activeFile, editor.getValue());
      }, 300)
    );

    // Init virtual files
    seedVirtualFiles();
    renderFileList();

    // Load Pyodide
    try {
      pyodide = await loadPyodide();
      PYODIDE_STATUS.textContent = "Pyodide: ready";
    } catch (err) {
      PYODIDE_STATUS.textContent = "Pyodide: failed to load";
      appendOutput(`❌ Pyodide load error: ${err}`, "err");
      console.error(err);
    }
  });

  // ====== Files (virtual) ======
  function seedVirtualFiles() {
    FILES.set(
      "example.py",
      `# Example: Fibonacci
def fib(n):
    a, b = 0, 1
    out = []
    for _ in range(n):
        out.append(a)
        a, b = b, a + b
    return out

print("Fib(10):", fib(10))
`
    );
    // Start with either saved buffer or a main.py
    const saved = localStorage.getItem(STORAGE_KEY);
    const initialName = "main.py";
    FILES.set(initialName, saved && saved.trim().length ? saved : defaultMain());
    setActiveFile(initialName);
  }

  function defaultMain() {
    return `# SnakeLab starter
print("Hello, SnakeLab!")
for i in range(3):
    print("Tick", i)`;
  }

  function setActiveFile(name) {
    activeFile = name;
    const content = FILES.get(name) ?? "";
    if (editor) editor.setValue(content);
    setFilename(name);
    highlightActiveFile();
  }

  function renderFileList(filter = "") {
    FILE_LIST.innerHTML = "";
    const items = [...FILES.keys()].filter((n) =>
      n.toLowerCase().includes(filter.toLowerCase())
    );
    for (const name of items) {
      const row = document.createElement("div");
      row.className = "sl-file";
      if (name === activeFile) row.classList.add("sl-file--active");
      row.dataset.name = name;

      const left = document.createElement("span");
      left.className = "sl-file__name";
      left.textContent = name;

      const right = document.createElement("span");
      right.className = "sl-file__meta";
      right.textContent = name === "example.py" ? "sample" : "local";

      row.appendChild(left);
      row.appendChild(right);
      FILE_LIST.appendChild(row);
    }
  }

  function highlightActiveFile() {
    const nodes = FILE_LIST.querySelectorAll(".sl-file");
    nodes.forEach((n) => {
      if (n.dataset.name === activeFile) n.classList.add("sl-file--active");
      else n.classList.remove("sl-file--active");
    });
  }

  function uniqueUntitled() {
    const base = "untitled";
    let i = 1;
    while (FILES.has(`${base}${i}.py`)) i++;
    return `${base}${i}.py`;
  }

  // Sidebar clicks
  FILE_LIST.addEventListener("click", (e) => {
    const item = e.target.closest(".sl-file");
    if (!item) return;
    const name = item.dataset.name;
    if (!name) return;
    fsHandle = null; // switching to virtual file
    setActiveFile(name);
  });

  // Search filter
  document.getElementById("search-input").addEventListener("input", (e) => {
    renderFileList(e.target.value || "");
  });

  // ===== UI Handlers =====

  // Run
  runBtn.addEventListener("click", async () => {
    if (!pyodide || !editor) return;
    const code = editor.getValue();
    OUTPUT.textContent = "⏳ Running...\n";

    try {
      const result = await pyodide.runPythonAsync(`
import sys
from io import StringIO
sys.stdout = sys.stderr = mystdout = StringIO()
try:
${indent(code, 1)}
except Exception as e:
    print("❌ Error:", e)
mystdout.getvalue()
      `);
      OUTPUT.textContent = result || "(no output)";
    } catch (e) {
      OUTPUT.textContent = "❌ Execution error: " + e;
    }
  });

  // Copy / Clear output
  copyOutputBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(OUTPUT.textContent);
      toast("Output copied");
    } catch {
      toast("Copy failed");
    }
  });
  clearOutputBtn.addEventListener("click", () => {
    OUTPUT.textContent = "";
  });

  // New (header + sidebar)
  function handleNew() {
    fsHandle = null;
    const name = uniqueUntitled();
    FILES.set(name, `# ${name}\nprint("Hello from SnakeLab!")\n`);
    renderFileList();
    setActiveFile(name);
  }
  newBtn.addEventListener("click", handleNew);
  sidebarNewBtn.addEventListener("click", handleNew);

  // Open (FS Access if available; fallback to <input>)
  openBtn.addEventListener("click", async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [
            { description: "Code/Text", accept: { "text/plain": [".py", ".txt", ".md", ".csv"] } },
          ],
          excludeAcceptAllOption: false,
          multiple: false,
        });
        fsHandle = handle;
        const file = await handle.getFile();
        const text = await file.text();
        // add/update into virtual list
        const name = file.name || "opened.py";
        FILES.set(name, text);
        renderFileList();
        setActiveFile(name);
      } catch (e) {
        // user cancelled
      }
    } else {
      HIDDEN_INPUT.click();
    }
  });

  HIDDEN_INPUT.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const name = file.name || "opened.py";
    FILES.set(name, text);
    renderFileList();
    setActiveFile(name);
    fsHandle = null;
    HIDDEN_INPUT.value = "";
  });

  // Save (FS Access if available and handle; else Save As; else download)
  saveBtn.addEventListener("click", async () => {
    const text = editor?.getValue() ?? "";
    const suggestedName = FILENAME_INPUT.value || activeFile || "main.py";
    // sync virtual file
    if (activeFile) FILES.set(activeFile, text);

    if (fsHandle && window.isSecureContext) {
      try {
        const writable = await fsHandle.createWritable();
        await writable.write(text);
        await writable.close();
        toast("Saved");
        return;
      } catch (e) {
        appendOutput(`⚠️ Save failed: ${e}`, "err");
      }
    }

    // Save As if possible
    if (window.showSaveFilePicker && window.isSecureContext) {
      try {
        fsHandle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: "Python", accept: { "text/x-python": [".py"] } }],
        });
        const writable = await fsHandle.createWritable();
        await writable.write(text);
        await writable.close();
        const savedFile = await fsHandle.getFile();
        const finalName = savedFile.name || suggestedName;
        // keep virtual list aligned with saved name
        if (activeFile && activeFile !== finalName) {
          FILES.delete(activeFile);
        }
        FILES.set(finalName, text);
        renderFileList();
        setActiveFile(finalName);
        toast("Saved");
        return;
      } catch (e) {
        // user cancelled; do nothing
      }
    }

    // Fallback: download via Blob
    downloadText(text, suggestedName.endsWith(".py") ? suggestedName : suggestedName + ".py");
  });

  // Filename input -> status + file rename in virtual list
  FILENAME_INPUT.addEventListener("change", () => {
    const newName = (FILENAME_INPUT.value || "main.py").trim();
    if (!activeFile || newName === activeFile) {
      setFilename(newName);
      return;
    }
    // rename virtual file if name unused
    if (!FILES.has(newName)) {
      const content = FILES.get(activeFile) ?? editor.getValue();
      FILES.delete(activeFile);
      FILES.set(newName, content);
      activeFile = newName;
      renderFileList();
      highlightActiveFile();
    }
    setFilename(newName);
  });

  // Theme + font size
  themeSelect.addEventListener("change", () => {
    monaco.editor.setTheme(themeSelect.value);
  });
  fontSizeSelect.addEventListener("change", () => {
    const size = Number(fontSizeSelect.value) || 14;
    editor?.updateOptions({ fontSize: size });
  });

  // Format (basic) — keep selection & cursor best-effort
  formatBtn.addEventListener("click", () => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    const prevSel = editor.getSelection();
    const formatted = basicFormatPython(model.getValue());

    editor.pushUndoStop();
    editor.executeEdits("format", [
      {
        range: model.getFullModelRange(),
        text: formatted,
        forceMoveMarkers: true,
      },
    ]);
    editor.pushUndoStop();

    // Restore selection position best-effort
    if (prevSel) {
      const lines = model.getLineCount();
      const newStartLine = Math.min(prevSel.startLineNumber, lines);
      const newEndLine = Math.min(prevSel.endLineNumber, lines);
      const newStartCol = Math.min(prevSel.startColumn, model.getLineMaxColumn(newStartLine));
      const newEndCol = Math.min(prevSel.endColumn, model.getLineMaxColumn(newEndLine));
      editor.setSelection({
        startLineNumber: newStartLine,
        startColumn: newStartCol,
        endLineNumber: newEndLine,
        endColumn: newEndCol,
      });
      editor.revealPositionInCenter({
        lineNumber: newStartLine,
        column: newStartCol,
      });
    }
    toast("Formatted");
  });

  // ===== Helpers =====
  function defineSnakeTheme() {
    monaco.editor.defineTheme("snake-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "", foreground: "e6f7ff" },
        { token: "comment", foreground: "6b8797", fontStyle: "italic" },
        { token: "keyword", foreground: "42a5ff" },
        { token: "number", foreground: "5e5aff" },
        { token: "string", foreground: "14ffb9" },
        { token: "delimiter", foreground: "a8c3d6" },
        { token: "type", foreground: "a8f7e6" },
      ],
      colors: {
        "editor.background": "#10151c",
        "editor.lineHighlightBackground": "#122131",
        "editorLineNumber.foreground": "#4f6c86",
        "editorCursor.foreground": "#42a5ff",
        "editor.selectionBackground": "#1e7ee655",
        "editor.inactiveSelectionBackground": "#1e7ee622",
        "editorIndentGuide.background": "#1a2b3b",
        "editorIndentGuide.activeBackground": "#2b4761",
        "editorWhitespace.foreground": "#1a2b3b",
      },
    });
  }

  function getInitialCode() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim().length > 0) return saved;
    return defaultMain();
  }

  function indent(code, level = 1) {
    const pad = "    ".repeat(level);
    return code
      .split("\n")
      .map((l) => pad + l)
      .join("\n");
  }

  function rtrim(s) {
    return s.replace(/[ \t]+$/g, "");
  }

  function basicFormatPython(src) {
    // Very basic: convert tabs to 4 spaces, trim trailing spaces, collapse >2 blank lines
    // and ensure file ends with a newline.
    const out = src
      .replace(/\t/g, "    ")
      .split("\n")
      .map((line) => rtrim(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    return out.endsWith("\n") ? out : out + "\n";
  }

  function appendOutput(text, cls) {
    OUTPUT.textContent += (OUTPUT.textContent ? "\n" : "") + text;
  }

  function downloadText(text, filename = "file.txt") {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function setFilename(name) {
    FILENAME_INPUT.value = name;
    STATUS_FILENAME.textContent = name;
  }

  function debounce(fn, ms = 250) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function toast(msg) {
    console.log("[SnakeLab]", msg);
  }
})();
