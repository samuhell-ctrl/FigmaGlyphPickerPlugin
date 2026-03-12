# Figma Local Glyph Picker & Server

This repository contains a local companion server and a Figma plugin that allows users to access, browse, and insert glyphs from their **locally installed OS fonts** directly into Figma. 

Because Figma runs in a browser environment with strict security sandboxing, it cannot directly read local font files to extract SVG paths. This project solves that by running a lightweight, headless Electron/Node.js server in the background.

---

## 📥 Download & Installation

You don't need to build this from scratch! Our automated cloud pipeline packages everything you need into simple ZIP files.

### 🖥️ Windows
**👉 [Download the Windows Version](https://github.com/samuhell-ctrl/FigmaGlyphPickerPlugin/releases/latest)**

### 🍎 macOS
**👉 [Download the Mac Version](https://github.com/samuhell-ctrl/FigmaGlyphPickerPlugin/releases/latest)**

*(Note: These links will take you to the latest Release page. Simply scroll to the **Assets** section at the bottom and click the `.zip` file for your operating system!)*

**Inside your downloaded ZIP, you will find:**
1. **The Server Executable** (`.exe` or `.dmg`): Run this once to start the background font server.
2. **The Plugin Folder** (`figma-glyph-plugin`): Load this folder into your Figma Desktop app by going to `Plugins > Development > Import plugin from manifest...` and selecting the `manifest.json` file.

---

## 🗂 Project Structure for Developers

This project uses a unified codebase for both Mac and Windows:

* **/figma-glyph-plugin:** The Figma plugin code (UI and logic) that communicates with the local server.
* **/figma-glyph-server:** The Node.js/Electron server that scans OS fonts and serves glyph data.
* **/.github/workflows:** The CI/CD cloud robots that automatically build and publish the `.zip` files whenever code is updated.

---

## 🚀 Features
* **Deep OS Font Scanning:** Uses `get-system-fonts` to locate `.ttf` and `.otf` files across the operating system.
* **Dynamic Glyph Parsing:** Uses `opentype.js` to extract precise SVG paths and advance widths for specific characters.
* **Fuzzy Matching:** Automatically resolves font family names and styles (e.g., matching a requested "Regular" style to the closest available variant).
* **Headless Electron App:** Runs quietly in the background (tray app) so designers don't have to look at a terminal window.

---

## 💻 How to Run the Server (Development)

If you want to modify the code and run it locally:

1. Open your terminal and navigate to the server folder:
   ```bash
   cd figma-glyph-server