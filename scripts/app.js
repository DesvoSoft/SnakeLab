/* SnakeLab - stable build (no optional chaining) */
(function () {
  // ===== State =====
  var editor = null;
  var pyodide = null;

  // Local storage keys
  var LS_CODE = "snakelab.code";
  var LS_NAME = "snakelab.filename";
  var LS_LAYOUT = "snakelab.layout"; // 'row' or 'col'
  var LS_THEME = "snakelab.theme";
  var LS_FONTSIZE = "snakelab.fontsize";

  // ===== DOM =====
  var BOOT = document.getElementById("boot-screen");
  var APP = document.querySelector(".sl-app");

  var FILENAME_INPUT = document.getElementById("filename-input");
  var STATUS_POS = document.getElementById("status-pos");
  var OUTPUT = document.getElementById("output");
  var WORKBENCH = document.getElementById("workbench");

  var runBtn = document.getElementById("run-btn");
  var newBtn = document.getElementById("new-btn");
  var downloadBtn = document.getElementById("download-btn");
  var copyOutputBtn = document.getElementById("copy-output-btn");
  var clearOutputBtn = document.getElementById("clear-output-btn");
  var layoutToggleBtn = document.getElementById("layout-toggle");

  // Optional controls (exist only if added in HTML)
  var appendToggle = document.getElementById("append-output");
  var openBtn = document.getElementById("open-btn");
  var openInput = document.getElementById("open-file-input");

  // Toolbar toggle (header ☰)
  var navToolbarToggle = document.getElementById("nav-toolbar-toggle");
  var MAIN = document.querySelector(".sl-main");

  function updateToolbarLayoutState() {
    var isMobile = window.matchMedia("(max-width: 720px)").matches;
    var hidden =
      (isMobile && !document.body.classList.contains("ui-toolbar-open")) ||
      (!isMobile && document.body.classList.contains("ui-toolbar-collapsed"));

    if (MAIN) {
      if (hidden) MAIN.classList.add("no-toolbar");
      else MAIN.classList.remove("no-toolbar");
    }
  }

  if (navToolbarToggle) {
    navToolbarToggle.addEventListener("click", function () {
      var isMobile = window.matchMedia("(max-width: 720px)").matches;
      var expanded;
      if (isMobile) {
        expanded = document.body.classList.toggle("ui-toolbar-open");
        document.body.classList.remove("ui-toolbar-collapsed");
      } else {
        expanded = !document.body.classList.toggle("ui-toolbar-collapsed");
        document.body.classList.remove("ui-toolbar-open");
      }
      navToolbarToggle.setAttribute("aria-expanded", String(expanded));
      updateToolbarLayoutState();
    });
  }

  window.addEventListener("resize", updateToolbarLayoutState);
  window.addEventListener("orientationchange", updateToolbarLayoutState);
  document.addEventListener("DOMContentLoaded", updateToolbarLayoutState);

  // ===== Helpers =====
  function showBoot(show, message) {
    if (!BOOT) return Promise.resolve();
    if (typeof message === "string") setBootMessage(message);
    if (show) {
      BOOT.style.display = "flex";
      if (APP) APP.setAttribute("aria-hidden", "true");
      return Promise.resolve();
    } else {
      return new Promise(function (resolve) {
        BOOT.setAttribute("aria-hidden", "true");
        setTimeout(function () {
          if (BOOT && BOOT.parentNode) BOOT.parentNode.removeChild(BOOT);
          if (APP) APP.removeAttribute("aria-hidden");
          resolve();
        }, 200);
      });
    }
  }

  function setBootMessage(text) {
    var msg = document.querySelector(".sl-boot__msg");
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
        { token: "type", foreground: "a8f7e6" }
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
        "editorWhitespace.foreground": "#1a2b3b"
      }
    });
  }

  function getInitialCode() {
    var saved = localStorage.getItem(LS_CODE);
    if (saved && saved.trim().length > 0) return saved;
    return (
      '# SnakeLab starter\n' +
      'print("Hello, SnakeLab!")\n' +
      'for i in range(3):\n' +
      '    print("Tick", i)'
    );
  }

  function getInitialName() {
    var saved = localStorage.getItem(LS_NAME);
    return saved && saved.trim().length ? saved : "main.py";
  }

  function setFilename(name) {
    if (FILENAME_INPUT) FILENAME_INPUT.value = name;
    localStorage.setItem(LS_NAME, name);
  }

  function getInitialLayout() {
    var saved = localStorage.getItem(LS_LAYOUT);
    return saved === "col" ? "col" : "row";
  }

  function applyLayout(mode) {
    if (!WORKBENCH || !layoutToggleBtn) return;
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
    var stamp = Date.now().toString().slice(-5);
    return "untitled_" + stamp + ".py";
  }

  function indent(code, level) {
    if (level === void 0) level = 1;
    var pad = new Array(level + 1).join("    ");
    return code.split("\n").map(function (l) { return pad + l; }).join("\n");
  }

  function downloadText(text, filename) {
    if (filename === void 0) filename = "file.py";
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function debounce(fn, ms) {
    if (ms === void 0) ms = 250;
    var t = null;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  // ===== Custom Dropdowns =====
  function setupDropdown(rootEl, onChange) {
    if (!rootEl) return;
    var button = rootEl.querySelector(".sl-select__button");
    var label = rootEl.querySelector(".sl-select__label");
    var menu = rootEl.querySelector(".sl-select__menu");
    if (!button || !menu) return;
    var options = Array.prototype.slice.call(menu.querySelectorAll(".sl-select__option"));

    rootEl.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-expanded", "false");

    button.addEventListener("click", function () {
      var isOpen = rootEl.getAttribute("aria-expanded") === "true";

      var openNodes = document.querySelectorAll(".sl-select[aria-expanded='true']");
      for (var i = 0; i < openNodes.length; i++) {
        var n = openNodes[i];
        if (n !== rootEl) {
          n.setAttribute("aria-expanded", "false");
          var b = n.querySelector(".sl-select__button");
          if (b) b.setAttribute("aria-expanded", "false");
        }
      }

      rootEl.setAttribute("aria-expanded", isOpen ? "false" : "true");
      button.setAttribute("aria-expanded", isOpen ? "false" : "true");
      if (!isOpen) menu.focus();
    });

    options.forEach(function (opt) {
      opt.addEventListener("click", function () {
        options.forEach(function (o) { o.classList.remove("is-active"); });
        opt.classList.add("is-active");
        var value = opt.getAttribute("data-value");
        var text = (opt.textContent || "").trim();
        if (label) label.textContent = text;
        rootEl.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-expanded", "false");
        if (onChange) onChange(value, text);
      });
      opt.tabIndex = 0;
    });

    menu.addEventListener("keydown", function (e) {
      var active = document.activeElement;
      var current = null;
      for (var i = 0; i < options.length; i++) {
        if (options[i] === active || (active && options[i] === active.closest && active.closest(".sl-select__option"))) {
          current = options[i];
          break;
        }
      }
      var idx = current ? options.indexOf(current) : -1;
      if (e.key === "Escape") {
        rootEl.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-expanded", "false");
        button.focus();
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        var next = options[idx + 1] || options[0];
        next && next.focus();
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        var prev = options[idx - 1] || options[options.length - 1];
        prev && prev.focus();
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (current) current.click();
      }
    });
  }

  document.addEventListener("click", function (e) {
    var openNodes = document.querySelectorAll(".sl-select[aria-expanded='true']");
    for (var i = 0; i < openNodes.length; i++) {
      var node = openNodes[i];
      if (!node.contains(e.target)) {
        node.setAttribute("aria-expanded", "false");
        var b = node.querySelector(".sl-select__button");
        if (b) b.setAttribute("aria-expanded", "false");
      }
    }
  });

  // ===== Monaco load (AMD) =====
  require.config({
    paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs" }
  });

  require(["vs/editor/editor.main"], function () {
    defineSnakeTheme();

    // Restore preferences before creating the editor
    var savedTheme = localStorage.getItem(LS_THEME) || "snake-dark";
    var savedFont = Number(localStorage.getItem(LS_FONTSIZE) || 14);

    editor = monaco.editor.create(document.getElementById("editor"), {
      value: getInitialCode(),
      language: "python",
      theme: savedTheme,
      automaticLayout: true,
      fontSize: savedFont,
      minimap: { enabled: false },
      scrollBeyondLastLine: false
    });

    // filename init
    setFilename(getInitialName());

    // Cursor status
    editor.onDidChangeCursorPosition(function (e) {
      if (STATUS_POS) {
        STATUS_POS.textContent = "Ln " + e.position.lineNumber + ", Col " + e.position.column;
      }
    });

    // Auto-save
    editor.onDidChangeModelContent(
      debounce(function () {
        localStorage.setItem(LS_CODE, editor.getValue());
      }, 250)
    );

    // Init layout
    applyLayout(getInitialLayout());

    // Dropdowns
    var themeDD = document.getElementById("theme-select");
    var fontDD = document.getElementById("fontsize-select");

    var themeLabel = themeDD ? themeDD.querySelector(".sl-select__label") : null;
    if (themeLabel) {
      themeLabel.textContent =
        savedTheme === "vs-dark" ? "VS Dark" :
        savedTheme === "vs-light" ? "VS Light" : "Snake Dark";
    }

    var fontLabel = fontDD ? fontDD.querySelector(".sl-select__label") : null;
    if (fontLabel) fontLabel.textContent = String(savedFont);

    setupDropdown(themeDD, function (value) {
      monaco.editor.setTheme(value);
      localStorage.setItem(LS_THEME, value);
    });

    setupDropdown(fontDD, function (value) {
      var size = Number(value) || 14;
      if (editor) editor.updateOptions({ fontSize: size });
      localStorage.setItem(LS_FONTSIZE, String(size));
    });

    // Boot & Pyodide
    (function initPyodide() {
      showBoot(true, "Loading Python...")
        .then(function () { return loadPyodide(); })
        .then(function (py) {
          pyodide = py;
          return showBoot(false);
        })
        .catch(function (err) {
          setBootMessage("Failed to load Pyodide. Check your network and reload.");
          console.error(err);
        });
    })();

    // ===== Shortcuts =====
    // Run (Ctrl/Cmd + Enter) -> all
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function () {
      runAll();
    });
    // Run selection (Shift + Enter)
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, function () {
      runSelection();
    });
    // Download (Ctrl/Cmd + S)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
      if (downloadBtn) downloadBtn.click();
    });
  });

  // ===== Execution helpers =====
  function getSelectionOrAll() {
    if (!editor) return "";
    var sel = editor.getSelection ? editor.getSelection() : null;
    var selectedText = sel ? editor.getModel().getValueInRange(sel) : "";
    if (selectedText && selectedText.trim().length) return selectedText;
    return editor.getValue();
  }

  async function executePython(code, opts) {
    if (!opts) opts = {};
    var append = !!opts.append;
    if (!pyodide || !editor || !OUTPUT) return;
  
    // 1) Indicar estado en el botón Run (sin ensuciar la consola)
    var prevRunText = runBtn ? runBtn.textContent : "";
    var prevRunDisabled = runBtn ? runBtn.disabled : false;
    if (runBtn) {
      runBtn.textContent = "Running…";
      runBtn.disabled = true;
    }
  
    // 2) Preparar consola
    if (!append) {
      OUTPUT.textContent = "";        // reemplazar
    } else if (OUTPUT.textContent && !OUTPUT.textContent.endsWith("\n")) {
      OUTPUT.textContent += "\n";     // separar runs
    }
  
    // 3) Ejecutar Python capturando stdout/err
    var program = [
      "import sys",
      "from io import StringIO",
      "sys.stdout = sys.stderr = mystdout = StringIO()",
      "try:",
      indent(code, 1),
      "except Exception as e:",
      '    print(\"❌ Error:\", e)',
      "mystdout.getvalue()"
    ].join("\n");
  
    try {
      var result = await pyodide.runPythonAsync(program);
      var text = result || "(no output)";
      // 4) Escribir resultado (sin rastro de “Running…”)
      OUTPUT.textContent += text;
    } catch (e) {
      OUTPUT.textContent += "❌ Execution error: " + e;
    } finally {
      // 5) Restaurar botón Run
      if (runBtn) {
        runBtn.textContent = prevRunText || "Run";
        runBtn.disabled = prevRunDisabled;
      }
      // Auto scroll al final
      OUTPUT.scrollTop = OUTPUT.scrollHeight;
    }
  }
  

  function runAll() {
    var code = editor ? editor.getValue() : "";
    var append = !!(appendToggle && appendToggle.checked);
    executePython(code, { append: append });
  }

  function runSelection() {
    var code = getSelectionOrAll();
    var append = !!(appendToggle && appendToggle.checked);
    executePython(code, { append: append });
  }

  // ===== Actions =====
  if (runBtn) runBtn.addEventListener("click", runAll);

  if (copyOutputBtn) {
    copyOutputBtn.addEventListener("click", function () {
      if (!OUTPUT) return;
      try { navigator.clipboard.writeText(OUTPUT.textContent); } catch (e) {}
    });
  }

  if (clearOutputBtn) {
    clearOutputBtn.addEventListener("click", function () {
      if (OUTPUT) OUTPUT.textContent = "";
    });
  }

  if (newBtn) {
    newBtn.addEventListener("click", function () {
      var ok = window.confirm("This will clear the current code buffer. Are you sure?");
      if (!ok) return;
      var next = uniqueUntitled();
      setFilename(next);
      var tpl = "# " + next + "\nprint(\"Hello from SnakeLab!\")";
      if (editor) editor.setValue(tpl);
      localStorage.setItem(LS_CODE, tpl);
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener("click", function () {
      var text = editor ? editor.getValue() : "";
      var name = (FILENAME_INPUT && FILENAME_INPUT.value ? FILENAME_INPUT.value : "main.py").trim();
      downloadText(text, name.endsWith(".py") ? name : name + ".py");
    });
  }

  if (openBtn && openInput) {
    openBtn.addEventListener("click", function () { openInput.click(); });
    openInput.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        if (editor) editor.setValue(text);
        setFilename(file.name && /\.py$/i.test(file.name) ? file.name : file.name + ".py");
        localStorage.setItem(LS_CODE, text);
      });
    });
  }

  if (FILENAME_INPUT) {
    FILENAME_INPUT.addEventListener("change", function () {
      var newName = (FILENAME_INPUT.value || "main.py").trim();
      setFilename(newName);
    });
  }

  if (layoutToggleBtn) {
    layoutToggleBtn.addEventListener("click", function () {
      if (!WORKBENCH) return;
      var isRow = WORKBENCH.classList.contains("sl-workbench--row");
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
  }
})();
