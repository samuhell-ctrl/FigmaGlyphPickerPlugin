---
name: figma-plugin-ui
description: Build Figma plugin interfaces with a bundled token-driven UI kit (buttons, fields, search, grids, modals, toasts, light/dark, one-file build) and get the manifest.json right for publishing — networkAccess, allowedDomains, devAllowedDomains, reasoning, documentAccess, permissions, and how custom fonts work inside the plugin iframe. Use this skill whenever the user is building, styling, scaffolding or debugging a Figma plugin or widget, mentions ui.html / code.js / manifest.json / figma.showUI, asks why a plugin looks wrong in dark mode or why a font or network request fails once published, or asks anything about submitting a plugin to Figma Community — even if they do not mention a UI kit or ask for one by name.
---

# Figma Plugin UI

A Figma plugin is two runtimes: `code.js` on the main thread (full Figma API, no
DOM) and `ui.html` in a sandboxed `null`-origin iframe (DOM, no Figma API),
talking over `postMessage`. Almost every frustrating plugin bug traces back to
that split or to the manifest that governs it.

This skill carries a complete UI layer in `assets/` plus the manifest rules that
only bite after publishing.

## Pick the path

| Situation | Do this |
|---|---|
| New plugin from scratch | **Scaffold** below |
| Existing plugin, wants better/consistent UI | **Retrofit** below |
| Question about manifest, publishing, network, fonts | read `references/manifest.md` |
| Which class / which `K.*` call | read `references/components.md` |

Before scaffolding into an existing repo, look at what is already there. If the
plugin has its own CSS conventions the user likes, lift the tokens rather than
replacing their interface wholesale — surprise refactors are rarely wanted.

## Scaffold

1. Copy `assets/` into the plugin repo as `plugin-ui-kit/`.
2. Copy `assets/templates/ui.src.html`, `assets/templates/code.js` and
   `assets/templates/manifest.json` to the repo root.
3. Build: `node plugin-ui-kit/build.mjs` → `dist/ui.html`.
4. Point the manifest at the **built** file: `"ui": "dist/ui.html"`.
5. Tell the user to run **Plugins → Development → New plugin…** in the Figma
   desktop app and paste the `id` Figma issues into `manifest.json`. You cannot
   invent that id, and publishing fails with a wrong one.

Then adapt `ui.src.html` to the actual plugin: its real sections, its real
messages. The template is a starting layout, not a thing to leave as-is.

## Retrofit

Copy `assets/src/` in, add the three include lines at the top of their existing
UI file, and migrate their CSS to the tokens incrementally. Their bespoke rules
keep working alongside `.k-*`; nothing is global except the body reset.

## The build step is not optional

Figma loads exactly **one** HTML file for the UI. The iframe has no file
access, so `<link href="tokens.css">` and `<script src="kit.js">` fail silently
and the plugin renders unstyled. `build.mjs` resolves

```html
<!-- kit:include src/tokens.css -->
```

into inline `<style>` / `<script>`, so you still author in separate files.

```bash
node build.mjs            # build every *.src.html into dist/
node build.mjs --watch    # rebuild on save
node build.mjs --minify   # strip comments before publishing
```

If the user wants to see the kit, build and open `dist/gallery.html` — every
component at 240/300/360/420 panel widths, both themes, variable scale.

## What the kit gives you

`assets/src/tokens.css` — every color, size, radius and duration, light and
dark, plus `--k-scale`: one number that resizes the whole interface. Change
values here, never in components.

`assets/src/components.css` — ~40 components as `.k-*` classes: buttons (primary
/secondary/ghost/danger/icon, loading state), inputs, search with clear,
select, stepper, checkbox, radio, switch, segmented control, tabs, range, cell
grid, list rows, badges, banners, progress, spinner, skeleton, empty state,
tooltip, collapsible, modal, toast, drop zone.

`assets/src/kit.js` — `window.K`: the `postMessage` bridge (`K.send` / `K.on`),
theme with `clientStorage` persistence, `K.toast`, `K.modal`, `K.segment`,
debounced `K.search`, `K.loading`, `K.progress`, `K.autoResize`.

`assets/src/icons.html` — 16px SVG sprite, `currentColor`.

`assets/templates/code.js` — main thread that already answers the kit's
`kit:get-settings`, `kit:set-setting` and `kit:resize` messages.

Full class and API tables: `references/components.md`.

## Theming

Open the UI with `themeColors: true` so Figma puts `figma-light` / `figma-dark`
on `<html>` and injects `--figma-color-*`:

```js
figma.showUI(__html__, { width: 300, height: 480, themeColors: true });
```

The kit resolves theme in this order: an explicit `body[data-theme]` the user
chose (persisted through `clientStorage`), then Figma's own class, then
`prefers-color-scheme` for when the file is opened outside Figma. Adding
`class="k-native"` to `<body>` maps the kit's tokens onto Figma's own colors, so
the plugin matches the user's exact theme instead of the kit palette.

Dark mode bugs are nearly always a hardcoded hex that skipped the tokens.

## Manifest rules worth knowing by heart

`references/manifest.md` has the full field-by-field reference. These four
cause the most damage, so carry them:

**`networkAccess` is required to publish.** A plugin that touches no network
still has to say so, as an array containing the string:

```json
"networkAccess": { "allowedDomains": ["none"] }
```

**Every origin the iframe touches must be listed** — CSS, fonts, images,
`fetch`, WebSocket, `<iframe src>`. Scheme-qualified (`https://fonts.gstatic.com`,
never bare `fonts.gstatic.com`). `https://*.example.com` matches subdomains;
`"*"` matches everything and makes `reasoning` mandatory, which reviewers
question.

**`devAllowedDomains` only applies to plugins run from Plugins → Development.**
It is where `http://localhost:PORT` belongs. It does nothing for a published
build, which is why "it worked in dev" is such a common report.

**`documentAccess: "dynamic-page"`** is required for new plugins, and pairs with
`figma.loadAllPagesAsync()` before any whole-document traversal.

## Fonts

Two unrelated things get confused here. Separate them before answering.

**The UI's own typeface** lives in the iframe and is governed by
`networkAccess`. Three routes, in order of how well they survive review:

- **Embed it.** A `data:` URI is not a network request, so nothing has to be
  declared and nothing can break post-publish. Subset first, then
  `node tools/inline-font.mjs --family "Plugin UI" Inter-Regular.woff2:400 --out src/fonts.css`.
  The manifest stays `["none"]`. Recommend this unless the licence forbids
  redistribution.
- **A CDN.** List the stylesheet origin *and* the font-binary origin — they are
  different hosts (`fonts.googleapis.com` and `fonts.gstatic.com`), and missing
  the second is the usual cause of a published build falling back to system
  type. There is also a CSP catch: authors report that a remote
  `<link rel="stylesheet">` is refused by the iframe's `style-src` even with the
  domain declared, so `fetch()` the CSS and inject it inline. See
  `references/manifest.md`.
- **System fonts.** No network, no declaration, but the UI differs per OS and
  `queryLocalFonts()` is unavailable in the iframe — you can name faces, not
  enumerate them.

**Text on the canvas** needs no manifest entry at all, only an awaited load on
the main thread. Missing the await is the `Cannot write to node with unloaded
font` error:

```js
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
node.fontName = { family: "Inter", style: "Regular" };
node.characters = "Hello";
```

Mixed-font text nodes need every font in the range loaded, so
`figma.loadFontAsync` once per `node.getRangeAllFontNames(0, node.characters.length)`.

## Before telling the user they can publish

- `networkAccess` present — `["none"]` or real origins.
- Both CSS host and binary host listed, if a remote font is used.
- `reasoning` reads like a sentence a user would understand.
- `localhost` only in `devAllowedDomains`.
- `"ui"` and `"main"` point at built files, not `.src.html`.
- `id` is the one Figma issued.
- `enableProposedApi` absent or `false` — proposed APIs are blocked once published.
- `permissions` lists only what the code actually calls; each one is reviewed.
- Tested in both themes and after a desktop restart, so `clientStorage` is cold.

## Checking your work

There is no way to run Figma headlessly, but the built UI is a plain HTML file.
Open `dist/ui.html` in a browser at the real panel size (300×480 is typical) and
in both themes — `K` degrades to a no-op outside Figma, so layout, states and
dark mode are all verifiable. Catching a broken empty state there beats
reloading the plugin in the desktop app twenty times.
