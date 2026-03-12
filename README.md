# Figma Local Glyph Picker & Server

This repository contains a local companion server and a Figma plugin that allows users to access, browse, and insert glyphs from their **locally installed OS fonts** directly into Figma. 

Because Figma runs in a browser environment with strict security sandboxing, it cannot directly read local font files to extract SVG paths. This project solves that by running a lightweight, headless Electron/Node.js server in the background.

## 🗂 Project Structure

This repository is split into macOS and Windows environments:

* **/Windows**
    * **/figma-glyph-server:** The Node.js/Electron server that scans OS fonts and serves glyph data.
    * **/figma-glyph-plugin:** The actual Figma plugin code (UI and logic) that communicates with the server.
* **/MACOS**
    * *(Mac equivalents of the server and plugin)*

## 🚀 Features
* **Deep OS Font Scanning:** Uses `get-system-fonts` to locate `.ttf` and `.otf` files across the operating system.
* **Dynamic Glyph Parsing:** Uses `opentype.js` to extract precise SVG paths and advance widths for specific characters.
* **Fuzzy Matching:** Automatically resolves font family names and styles (e.g., matching a requested "Regular" style to the closest available variant).
* **Headless Electron App:** Runs quietly in the background (tray app) so designers don't have to look at a terminal window.

---

## 💻 How to Run the Server (Development)

1. Open your terminal and navigate to the server folder:
   ```bash
   cd Windows/figma-glyph-server