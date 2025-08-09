# SnakeLab
🐍 A browser-based Python playground built with Pyodide and Monaco Editor. Learn, experiment, and run Python code instantly — all in your browser, no installation needed. 

# SnakeLab 🐍
A lightweight **in-browser Python IDE** powered by **Pyodide** + **Monaco Editor**.  
No backend. Runs entirely in your browser.

**Live demo:** https://desvosoft.github.io/SnakeLab/

<!-- ![SnakeLab UI](./assets/snakelab-cover.png) -->

## Features
<!-- - ✨ Modern UI -->
- 🧠 Monaco Editor (syntax highlighting, cursor position, theme & font size)
- 🐍 Run Python via **Pyodide**
- 💾 Autosave current buffer to `localStorage`
- 🧹 Basic format (tabs→spaces, trim, collapse blank lines)
- 📋 Copy & clear output

## Tech stack
- [Pyodide](https://pyodide.org/) — Python compiled to WebAssembly
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- Vanilla HTML/CSS/JS, no frameworks