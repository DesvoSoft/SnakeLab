/* SnakeLab - Single-file (no formatter) + fullscreen boot screen + custom dropdowns */
(() => {
  // ===== State =====
  let editor = null;
  let pyodide = null;

  // Local storage keys
  const LS_CODE = "snakelab.code";
  const LS_NAME = "snakelab.filename";
  const LS_LAYOUT = "snakelab.layout"; // 'row' or 'col'

  // ===== DOM =====
  const BOOT = document.getElementById("boot-screen");
  const APP = document.querySelector(".sl-app");

  const FILENAME_INPUT = document.getElementById("filename-input");
  const STATUS_POS = document.getElementById("status-pos");
  const OUTPUT = document.getElementById("output");
  const WORKBENCH = document.getElementById("workbench");

  const runBtn = document.getElementById("run-btn");
  const newBtn = document.getElementById("new-btn");
  const downloadBtn = document.getElementById("download-btn");
  const copyOutputBtn = document.getElementById("copy-output-btn");
  const clearOutputBtn = document.getElementById("clear-output-btn");
  const layoutToggleBtn = document.getElementById("layout-toggle");

  // ===== Helpers (shared) =====
  function showBoot(show, message) {
    if (!BOOT) return Promise.resolve();
    if (typeof message === "string") setBootMessage(message);
    if (show) {
      BOOT.style.display = "flex";
      if (APP) APP.setAttribute("aria-hidden", "true");
      return Promise.resolve();
    } else {
      return new Promise((r) => {
        setTimeout(() => {
          BOOT.remove(); // fully remove so it can't intercept events
          if (APP) APP.removeAttribute("aria-hidden");
          r();
        }, 150);
      });
    }
  }

  function setBootMessage(text) {
    const msg = document.querySelector(".sl-boot__msg");
    if (msg) msg.textContent = text;
  }

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
    FILENAME_INPUT.value = name;
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
    return code.split("\n").map((l) => pad + l).join("\n");
  }

  function downloadText(text, filename = "file.py") {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function debounce(fn, ms = 250) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ===== Custom Dropdown Component =====
  // Initializes a custom dropdown at `rootEl` and calls `onChange(value, label)` on selection
  function setupDropdown(rootEl, onChange) {
    if (!rootEl) return;
    const button = rootEl.querySelector(".sl-select__button");
    const label = rootEl.querySelector(".sl-select__label");
    const menu = rootEl.querySelector(".sl-select__menu");
    const options = Array.from(menu.querySelectorAll(".sl-select__option"));

    // Default ARIA
    rootEl.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-expanded", "false");

    // Toggle open/close
    button.addEventListener("click", () => {
      const isOpen = rootEl.getAttribute("aria-expanded") === "true";
      // close others
      document.querySelectorAll(".sl-select[aria-expanded='true']").forEach(n => {
        if (n !== rootEl) {
          n.setAttribute("aria-expanded", "false");
          const b = n.querySelector(".sl-select__button");
          if (b) b.setAttribute("aria-expanded", "false");
        }
      });
      rootEl.setAttribute("aria-expanded", isOpen ? "false" : "true");
      button.setAttribute("aria-expanded", isOpen ? "false" : "true");
      if (!isOpen) menu.focus();
    });

    // Option click
    options.forEach(opt => {
      opt.addEventListener("click", () => {
        options.forEach(o => o.classList.remove("is-active"));
        opt.classList.add("is-active");
        const value = opt.getAttribute("data-value");
        const text = opt.textContent.trim();
        if (label) label.textContent = text;
        rootEl.setAttribute("aria-expanded","false");
        button.setAttribute("aria-expanded","false");
        onChange?.(value, text);
      });
    });

    // Keyboard nav on menu
    options.forEach(o => o.tabIndex = 0);
    menu.addEventListener("keydown", (e) => {
      const current = document.activeElement.closest(".sl-select__option");
      const idx = options.indexOf(current);
      if (e.key === "Escape") { rootEl.setAttribute("aria-expanded","false"); button.setAttribute("aria-expanded","false"); button.focus(); }
      if (e.key === "ArrowDown") { e.preventDefault(); (options[idx+1] || options[0]).focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (options[idx-1] || options[options.length-1]).focus(); }
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); current?.click(); }
    });
  }

  // Close dropdowns when clicking outside
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".sl-select[aria-expanded='true']").forEach(node => {
      if (!node.contains(e.target)) {
        node.setAttribute("aria-expanded", "false");
        const b = node.querySelector(".sl-select__button");
        if (b) b.setAttribute("aria-expanded", "false");
      }
    });
  });

  // ===== Monaco load (AMD) =====
  require.config({
    paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs" },
  });

  require(["vs/editor/editor.main"], async function () {
    defineSnakeTheme();

    editor = monaco.editor.create(document.getElementById("editor"), {
      value: getInitialCode(),
      language: "python",
      theme: "snake-dark",
      automaticLayout: true,
      fontSize: 14,
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
    editor.onDidChangeModelContent(debounce(() => {
      localStorage.setItem(LS_CODE, editor.getValue());
    }, 250));

    // Init layout
    applyLayout(getInitialLayout());

    // ---- Custom dropdowns (Theme / Font size) ----
    const themeDD = document.getElementById("theme-select");
    const fontDD = document.getElementById("fontsize-select");

    setupDropdown(themeDD, (value) => {
      monaco.editor.setTheme(value);
    });

    setupDropdown(fontDD, (value) => {
      const size = Number(value) || 14;
      editor?.updateOptions({ fontSize: size });
    });

    // ---- Boot & Pyodide ----
    try {
      await showBoot(true, "Loading Python runtime…");
      pyodide = await loadPyodide();
      await showBoot(false);
    } catch (err) {
      setBootMessage("Failed to load Pyodide. Check your network and reload.");
      console.error(err);
      return;
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
      // Optional toast
    } catch {
      // ignore
    }
  });

  clearOutputBtn.addEventListener("click", () => {
    OUTPUT.textContent = "";
  });

  // New -> confirm before clearing current buffer
  newBtn.addEventListener("click", () => {
    const ok = window.confirm("This will clear the current code buffer. Are you sure?");
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

  // Layout toggle (Right <-> Bottom)
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
})();
