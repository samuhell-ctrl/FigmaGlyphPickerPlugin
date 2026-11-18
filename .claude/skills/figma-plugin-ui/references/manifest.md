# manifest.json — field reference, network access, fonts

Contents:
1. [Every field](#every-field)
2. [networkAccess in depth](#networkaccess-in-depth)
3. [Fonts in the plugin UI](#fonts-in-the-plugin-ui)
4. [Fonts on the canvas](#fonts-on-the-canvas)
5. [Troubleshooting](#troubleshooting)
6. [Sources](#sources)

A copy-paste annotated version lives in `assets/templates/manifest.annotated.jsonc`.
`manifest.json` itself must be strict JSON — no comments, no trailing commas.

---

## Every field

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Shown in the plugin list and in Community. |
| `id` | yes | Issued by Figma at **Plugins → Development → New plugin…**. Never invent or reuse one. |
| `api` | yes | `"1.0.0"`. |
| `main` | yes | Main-thread bundle. Full Figma API, no DOM. |
| `ui` | no | One self-contained HTML file. Omit for a UI-less plugin. |
| `editorType` | yes | Any of `"figma"`, `"figjam"`, `"slides"`, `"dev"`. |
| `documentAccess` | yes for new plugins | `"dynamic-page"`. Pairs with `figma.loadAllPagesAsync()`. |
| `networkAccess` | yes to publish | See below. |
| `permissions` | no | `"currentuser"`, `"activeusers"`, `"fileusers"`, `"payments"`, `"teamlibrary"`. Each is reviewed — request nothing unused. |
| `capabilities` | no | `"textreview"`, `"codegen"`, `"inspect"`, `"vscode"`. |
| `menu` | no | Submenu entries; the chosen one arrives as `figma.command`. |
| `relaunchButtons` | no | Panel buttons for touched nodes (`node.setRelaunchData({ edit: "" })`). |
| `parameters` / `parameterOnly` | no | Prompt-style input before the UI opens. |
| `enableProposedApi` | no | Never ship `true` — proposed APIs are blocked once published. |
| `build` | no | Shell command Figma runs on import/reload, e.g. `"node build.mjs"`. |

---

## networkAccess in depth

Required for publishing. It covers **both** runtimes: `fetch` from `code.js`
and everything the UI iframe loads — stylesheets, fonts, images, XHR,
WebSocket, `<iframe src>`. Anything not declared is blocked with a CSP error in
the console.

```json
"networkAccess": {
  "allowedDomains": ["https://api.example.com"],
  "devAllowedDomains": ["http://localhost:3000"],
  "reasoning": "One sentence a user would understand."
}
```

**`allowedDomains`** — either the literal `["none"]` or a list of origins.

- An array containing the string. `"none"` on its own is invalid.
- Scheme-qualified: `https://api.example.com`, not `api.example.com`.
- `https://*.example.com` matches subdomains.
- `"*"` matches everything and makes `reasoning` mandatory. Reviewers push back
  on it; list real origins instead.
- Omitting the whole `networkAccess` key means unrestricted in development, but
  publishing fails.

**`devAllowedDomains`** — additional origins allowed **only** when the plugin
runs from *Plugins → Development*. This is where `http://localhost:PORT`
belongs. It has no effect on a published build. A plugin whose published
version talks to a companion app on localhost needs that origin in
`allowedDomains` as well, with `reasoning` that explains the companion app —
expect questions during review.

**`reasoning`** — user-facing. Mandatory with a `*` wildcard, worth writing
always, because it is what the review team reads. One plain sentence about what
is fetched and why.

**`networkAccess` is not CORS.** It governs whether the request may leave the
plugin. Whether the response can be read is the target server's business. A
request that passes the allowlist and still fails with an opaque-response or
CORS error needs a fix on the API side, or a proxy.

---

## Fonts in the plugin UI

### Route A — embed the font (recommended)

A `data:` URI is not a network request. Nothing to declare, nothing to block,
works offline and behind corporate proxies. The manifest stays:

```json
"networkAccess": { "allowedDomains": ["none"] }
```

Subset before inlining — base64 adds about a third to the byte count, and the
whole built `ui.html` should stay comfortably small:

```bash
pip install fonttools brotli
pyftsubset Inter.ttf --flavor=woff2 --output-file=Inter-Regular.woff2 \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2018-201D,U+2026,U+2013-2014" \
  --layout-features="kern,liga"

node tools/inline-font.mjs --family "Plugin UI" \
  Inter-Regular.woff2:400 Inter-SemiBold.woff2:600 --out src/fonts.css
```

`src/fonts.css` is already included by `templates/ui.src.html`, and the
generated file repoints `--k-font-ui` at the family.

A full Latin woff2 runs 25–40 kB; a Latin-subset UI face is usually 15–25 kB.
`build.mjs` warns once the built file passes 1.5 MB.

### Route B — load from a CDN

List the stylesheet origin **and** the font-binary origin. They are different
hosts, and missing the second is the classic "fine in development, fallback
type once published":

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

**The CSP catch.** Even with both domains declared, plugin authors report that

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
```

is refused by the iframe's `style-src` policy, which permits `'unsafe-inline'`,
`data:` and `blob:` but not remote stylesheets. Fetch the CSS and inject it
inline; the binaries it references then load normally off the allowlist:

```js
const css = await fetch(
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap"
).then((r) => r.text());
document.head.appendChild(
  Object.assign(document.createElement("style"), { textContent: css })
);
await document.fonts.ready;
```

Self-hosting on your own domain works the same way: list that origin, serve
with permissive CORS, inject inline.

Use route B only when the font genuinely cannot ship inside the plugin — a
licence that forbids redistribution, say.

### Route C — system fonts

```css
:root { --k-font-ui: "SF Pro Text", -apple-system, system-ui, sans-serif; }
```

No network, no declaration. The UI then looks different per OS, and
`queryLocalFonts()` is unavailable in the iframe — faces can be named, not
enumerated.

---

## Fonts on the canvas

Unrelated to the UI font and to the manifest. Text nodes need the face loaded
on the main thread first:

```js
const node = figma.createText();
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
node.fontName = { family: "Inter", style: "Regular" };
node.characters = "Hello";
```

- Missing the await → `Cannot write to node with unloaded font`.
- Editing an existing node means loading **its** current font before any write,
  including `node.characters = …` on a node you did not create.
- Mixed-font nodes: load every entry of
  `node.getRangeAllFontNames(0, node.characters.length)`.
- `figma.listAvailableFontsAsync()` reports what is actually loadable, including
  the user's local fonts.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Plugin renders unstyled | `<link>`/`<script src>` in `ui.html`. The iframe has no file access — inline them (`build.mjs`). |
| Works in dev, font falls back once published | Font host only in `devAllowedDomains`, or the binary host missing. |
| `Refused to load the stylesheet … style-src` | Remote `<link>` stylesheet. Fetch and inject inline. |
| `request blocked` / CSP error at runtime | Origin not in `allowedDomains`, or not scheme-qualified. |
| Publishing rejected before review | `networkAccess` missing, or `"none"` as a bare string. |
| `Cannot write to node with unloaded font` | No awaited `figma.loadFontAsync` for that node's current font. |
| Dark mode wrong | Hardcoded hex instead of a token, or `themeColors: true` not passed to `showUI`. |
| Theme resets every launch | Preference not round-tripped through `figma.clientStorage` — the iframe's own storage does not persist. |
| `figma is not defined` in the UI | The Figma API only exists on the main thread; send a message instead. |
| Whole-document traversal throws | `documentAccess: "dynamic-page"` needs `await figma.loadAllPagesAsync()` first. |

---

## Sources

- [Figma — Plugin Manifest](https://developers.figma.com/docs/plugins/manifest)
- [Figma — Making Network Requests](https://developers.figma.com/docs/plugins/making-network-requests)
- [Forum: published plugin doesn't load Google Fonts](https://forum.figma.com/ask-the-community-7/figma-plugin-published-version-doesn-t-load-google-fonts-13474)
- [Forum: plugin UI font-family](https://forum.figma.com/t/figma-plugin-ui-font-family/22484)

Figma's docs move. When a detail here decides whether something ships, check
the live manifest page before telling the user it is settled.
