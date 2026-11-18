# Plugin UI Kit

A token-driven UI layer for Figma plugins. Drop it into a new plugin, build one
self-contained `ui.html`, and get the same light/dark, scalable interface every
time.

```
plugin-ui-kit/
├── build.mjs                     inlines everything into one HTML file
├── gallery.src.html              every component, side by side
├── src/
│   ├── tokens.css                colors, type, spacing, motion — edit here
│   ├── components.css            ~40 components, all .k-* classes
│   ├── fonts.css                 generated @font-face (base64)
│   ├── icons.html                16px SVG sprite
│   └── kit.js                    window.K — bridge, theme, toast, modal…
├── templates/
│   ├── ui.src.html               starter plugin UI
│   ├── code.js                   starter main thread (settings + resize)
│   ├── manifest.json             publish-ready, no network
│   ├── manifest.remote-fonts.json
│   └── manifest.annotated.jsonc  every field explained
├── tools/inline-font.mjs         woff2 → base64 @font-face
└── dist/                         build output (ui.html, gallery.html)
```

```bash
node build.mjs          # build
node build.mjs --watch  # rebuild on save
node build.mjs --minify # strip comments before publishing
```

Open `dist/gallery.html` in a browser to browse the components at 240/300/360/420
panel widths, in both themes, at any UI scale.

---

## Starting a new plugin

1. Copy `plugin-ui-kit/` into the new plugin repo.
2. Copy `templates/ui.src.html`, `templates/code.js` and `templates/manifest.json`
   to the repo root.
3. In Figma desktop: **Plugins → Development → New plugin…** — paste the `id`
   Figma generates into `manifest.json`.
4. `node plugin-ui-kit/build.mjs` → `dist/ui.html`.
5. Point `manifest.json` at the **built** file: `"ui": "dist/ui.html"`.

Override only `--k-scale`, `--k-accent` and your font in the plugin's own
`<style>` block. Everything else stays in the kit so fixes propagate.

### Why a build step

The plugin UI runs in a sandboxed `null`-origin iframe with no file access.
`<link href="tokens.css">` and `<script src="kit.js">` silently fail — Figma
loads exactly one HTML file. `build.mjs` resolves

```html
<!-- kit:include src/tokens.css -->
```

into an inline `<style>` / `<script>`, so you still author in separate files.

---

## Theming

Three sources, resolved in this order by `kit.js`:

| Source | Mechanism |
|---|---|
| Explicit choice | `body[data-theme="dark"]`, persisted to `clientStorage` |
| Figma's own theme | `html.figma-dark` + `--figma-color-*`, needs `themeColors: true` |
| Outside Figma | `prefers-color-scheme` |

```js
figma.showUI(__html__, { width: 300, height: 480, themeColors: true });
```

Add `class="k-native"` to `<body>` to map the kit's tokens onto Figma's own
`--figma-color-*` values, so the plugin matches the user's exact theme instead
of the kit palette.

## Runtime API — `window.K`

| Call | Does |
|---|---|
| `K.init()` | wire theme switches, restore stored settings |
| `K.send(type, payload)` | message `code.js` |
| `K.on(type, fn)` | receive from `code.js` (`"*"` for all) |
| `K.delegate(evt, sel, fn)` | delegated listener |
| `K.theme.get/set/toggle()` | `"light" \| "dark" \| "auto"` |
| `K.scale(1.2)` | resize the whole UI, persisted |
| `K.toast(msg, {tone, duration})` | transient message |
| `K.modal("#id")` | `{open, close, isOpen}`, Esc + scrim close |
| `K.segment(el, onChange)` | segmented control / tabs, arrow keys |
| `K.search(el, onInput, ms)` | debounce + clear button + Esc |
| `K.loading(btn, bool)` | spinner in place of the label |
| `K.progress(el, 0…1)` | `null` = indeterminate |
| `K.autoResize({max})` | ask `code.js` to fit the window to content |

`templates/code.js` already answers `kit:get-settings`, `kit:set-setting` and
`kit:resize`.

---

# Fonts & the manifest

The question that bites after publishing. Three routes, in order of how well
they survive review.

## A. Embed the font — recommended

A `data:` URI is not a network request, so **no domain has to be declared** and
nothing can be blocked at runtime, offline, or behind a corporate proxy.

```bash
# subset first — a full Latin woff2 is 25–40 kB, base64 adds ~33%
pip install fonttools brotli
pyftsubset Inter.ttf --flavor=woff2 --output-file=Inter-Regular.woff2 \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2018-201D,U+2026,U+2013-2014" \
  --layout-features="kern,liga"

node tools/inline-font.mjs --family "Plugin UI" \
  fonts/Inter-Regular.woff2:400 \
  fonts/Inter-SemiBold.woff2:600 \
  --out src/fonts.css
```

`src/fonts.css` is already included by `templates/ui.src.html`, and the
generated file repoints `--k-font-ui` at your family.

The manifest then declares **no network access at all** — and it must say so
explicitly, because `networkAccess` is required for publishing:

```json
{
  "name": "Plugin name",
  "id": "1234567890123456789",
  "api": "1.0.0",
  "main": "dist/code.js",
  "ui": "dist/ui.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": { "allowedDomains": ["none"] }
}
```

`["none"]` is an array containing the string, not the bare string `"none"`.

## B. Load the font from a CDN

Every origin the iframe touches must be listed — **the stylesheet origin and the
font-binary origin are different hosts**, and missing the second is the usual
cause of "it worked in development, the published build shows fallback type".

```json
"networkAccess": {
  "allowedDomains": [
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com"
  ],
  "devAllowedDomains": [
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
    "http://localhost:3000"
  ],
  "reasoning": "Loads the plugin interface typeface from Google Fonts."
}
```

Rules that apply:

- **Scheme-qualified origins.** `https://fonts.gstatic.com`, not `fonts.gstatic.com`.
- **`https://*.gstatic.com`** matches subdomains. `"*"` matches everything and
  makes `reasoning` mandatory — reviewers push back on it.
- **`devAllowedDomains`** only applies to plugins run from
  *Plugins → Development*. It is where `http://localhost:PORT` belongs; it does
  nothing for the published build.
- **`reasoning`** is user-facing and is what the review team reads. One plain
  sentence.
- Self-hosting on your own domain works the same way — list that origin.

**The CSP catch.** Even with the domains declared, plugin authors report that a
remote `<link rel="stylesheet" href="https://fonts.googleapis.com/…">` is
refused by the iframe's `style-src` policy, which permits `'unsafe-inline'`,
`data:` and `blob:` but not remote stylesheets. Fetch the CSS and inject it
inline instead — the font binaries it references then load normally, because
`fonts.gstatic.com` is on the allowlist:

```js
const css = await fetch(
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap"
).then((r) => r.text());
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: css }));
await document.fonts.ready;
```

Route A avoids this entirely. Use B only when the font genuinely cannot ship
with the plugin (a licence that forbids redistribution, say).

## C. Use a font already on the user's machine

```css
:root { --k-font-ui: "SF Pro Text", -apple-system, system-ui, sans-serif; }
```

No network, no manifest entry, no declaration. The catch is that the UI looks
different per OS, and `queryLocalFonts()` is not available in the iframe — you
cannot enumerate what the user has, only name faces and let CSS fall back.

## Not the same thing: text on the canvas

The UI font and canvas typography are unrelated. Writing text into the document
needs no manifest entry at all — only an awaited load on the main thread:

```js
const node = figma.createText();
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
node.fontName = { family: "Inter", style: "Regular" };
node.characters = "Hello";
```

Missing that await is the `Cannot write to node with unloaded font` error. For a
font that exists only on the user's machine, `figma.listAvailableFontsAsync()`
tells you what is actually loadable.

## Publishing checklist

- [ ] `networkAccess` present — `["none"]` or real origins. Publishing fails without it.
- [ ] Both the CSS host and the font-binary host listed, if using route B.
- [ ] `reasoning` written as a sentence a user would understand (mandatory with `*`).
- [ ] `localhost` only in `devAllowedDomains`.
- [ ] `"ui"` and `"main"` point at built files, not `.src.html`.
- [ ] `id` is the one Figma issued for this plugin.
- [ ] `enableProposedApi` absent or `false` — proposed APIs are blocked once published.
- [ ] `permissions` lists only what the code calls.
- [ ] Built `ui.html` is lean — `build.mjs` warns past 1.5 MB.
- [ ] Tested in *both* Figma themes and after a desktop restart (cold `clientStorage`).

Full field-by-field reference: `templates/manifest.annotated.jsonc`.

---

### Sources

- [Figma — Plugin Manifest](https://developers.figma.com/docs/plugins/manifest)
- [Figma — Making Network Requests](https://developers.figma.com/docs/plugins/making-network-requests)
- [Forum: published plugin doesn't load Google Fonts](https://forum.figma.com/ask-the-community-7/figma-plugin-published-version-doesn-t-load-google-fonts-13474)
- [Forum: plugin UI font-family](https://forum.figma.com/t/figma-plugin-ui-font-family/22484)
