/* SnakeLab - Single-file edition (no Open, Run in Editor, layout toggle) */
(() => {
  // ===== State =====
  let editor = null;
  let pyodide = null;

  // Local storage keys
  const LS_CODE = "snakelab.code";
  const LS_NAME = "snakelab.filename";
  const LS_LAYOUT = "snakelab.layout"; // 'row' or 'col'

  // ===== DOM =====
  const FILENAME_INPUT = document.getElementById("filename-input");
  const STATUS_POS = document.getElementById("status-pos");
  const PYODIDE_STATUS = document.getElementById("pyodide-status");
  const OUTPUT = document.getElementById("output");
  const WORKBENCH = document.getElementById("workbench");

  const runBtn = document.getElementById("run-btn");
  const newBtn = document.getElementById("new-btn");
  const downloadBtn = document.getElementById("download-btn");
  const formatBtn = document.getElementById("format-btn");
  const copyOutputBtn = document.getElementById("copy-output-btn");
  const clearOutputBtn = document.getElementById("clear-output-btn");
  const themeSelect = document.getElementById("theme-select");
  const fontSizeSelect = document.getElementById("fontsize-select");
  const layoutToggleBtn = document.getElementById("layout-toggle");

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

    // filename init
    setFilename(getInitialName());

    // Cursor status
    editor.onDidChangeCursorPosition((e) => {
      STATUS_POS.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    });

    // Auto-save
    editor.onDidChangeModelContent(
      debounce(() => {
        localStorage.setItem(LS_CODE, editor.getValue());
      }, 250)
    );

    // Init layout
    applyLayout(getInitialLayout());

    // Load Pyodide
    try {
      pyodide = await loadPyodide();
      PYODIDE_STATUS.textContent = "Pyodide: ready";
    } catch (err) {
      PYODIDE_STATUS.textContent = "Pyodide: failed to load";
      appendOutput(`❌ Pyodide load error: ${err}`, "err");
      console.error(err);
    }

    // Keyboard shortcut: Run (Ctrl/Cmd+Enter)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runBtn.click();
    });
  });

  // ===== Actions =====
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

  // New -> confirm before clearing current buffer
  newBtn.addEventListener("click", () => {
    const ok = window.confirm(
      "This will clear the current code buffer. Are you sure?"
    );
    if (!ok) return;

    const next = uniqueUntitled();
    setFilename(next);
    const tpl = `# ${next}
print("Hello from SnakeLab!")`;
    editor?.setValue(tpl);
    localStorage.setItem(LS_CODE, tpl);
  });

  // Download .py (single-file)
  downloadBtn.addEventListener("click", () => {
    const text = editor?.getValue() ?? "";
    const name = (FILENAME_INPUT.value || "main.py").trim();
    downloadText(text, name.endsWith(".py") ? name : name + ".py");
  });

  // Filename change (just update LS name)
  FILENAME_INPUT.addEventListener("change", () => {
    const newName = (FILENAME_INPUT.value || "main.py").trim();
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

  // Basic Format (later: Worker + Black)
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

  // Layout toggle (Right <-> Bottom) — only visible on landscape (CSS)
  layoutToggleBtn.addEventListener("click", () => {
    const isRow = WORKBENCH.classList.contains("sl-workbench--row");
    if (isRow) {
      WORKBENCH.classList.remove("sl-workbench--row");
      WORKBENCH.classList.add("sl-workbench--col");
      layoutToggleBtn.textContent = "Output: Bottom";
      localStorage.setItem(LS_LAYOUT, "col");
    } else {
      WORKBENCH.classList.remove("sl-workbench--col");
      WORKBENCH.classList.add("sl-workbench--row");
      layoutToggleBtn.textContent = "Output: Right";
      localStorage.setItem(LS_LAYOUT, "row");
    }
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
    const saved = localStorage.getItem(LS_CODE);
    if (saved && saved.trim().length > 0) return saved;
    return `# SnakeLab starter
print("Hello, SnakeLab!")
for i in range(3):
    print("Tick", i)`;
  }

  function getInitialName() {
    const saved = localStorage.getItem(LS_NAME);
    return saved && saved.trim().length ? saved : "main.py";
  }

  function setFilename(name) {
    document.getElementById("filename-input").value = name;
    localStorage.setItem(LS_NAME, name);
  }

  function getInitialLayout() {
    const saved = localStorage.getItem(LS_LAYOUT);
    return saved === "col" ? "col" : "row";
  }

  function applyLayout(mode) {
    if (mode === "col") {
      WORKBENCH.classList.remove("sl-workbench--row");
      WORKBENCH.classList.add("sl-workbench--col");
      layoutToggleBtn.textContent = "Output: Bottom";
    } else {
      WORKBENCH.classList.remove("sl-workbench--col");
      WORKBENCH.classList.add("sl-workbench--row");
      layoutToggleBtn.textContent = "Output: Right";
    }
  }

  function uniqueUntitled() {
    const stamp = Date.now().toString().slice(-5);
    return `untitled_${stamp}.py`;
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
    // basic: tabs->spaces, trim trailing, collapse >2 blank lines, end with newline
    const out = src
      .replace(/\t/g, "    ")
      .split("\n")
      .map((line) => rtrim(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    return out.endsWith("\n") ? out : out + "\n";
  }

  function appendOutput(text) {
    OUTPUT.textContent += (OUTPUT.textContent ? "\n" : "") + text;
  }

  function downloadText(text, filename = "file.py") {
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
