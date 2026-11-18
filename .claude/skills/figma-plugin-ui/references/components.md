# Component and API reference

Contents:
1. [Tokens](#tokens)
2. [Layout](#layout)
3. [Components](#components)
4. [window.K](#windowk)
5. [Message contract](#message-contract)
6. [Recipes](#recipes)

Everything is in `assets/src/`. Build `assets/gallery.src.html` and open
`dist/gallery.html` to see every component rendered at real panel widths.

---

## Tokens

All in `assets/src/tokens.css`, prefixed `--k-` so they never collide with
Figma's injected `--figma-color-*`. Components reference tokens only; a
hardcoded value in a component is a bug.

| Group | Tokens |
|---|---|
| Scale | `--k-scale` — one number, resizes the whole UI |
| Layout | `--k-pad-x/y`, `--k-gap-xs/sm/md/lg`, `--k-radius-sm/md/lg/pill`, `--k-row-h`, `--k-row-h-sm`, `--k-hairline` |
| Type | `--k-font-ui`, `--k-font-mono`, `--k-text-xs/sm/md/lg`, `--k-weight-regular/medium/strong`, `--k-leading`, `--k-tracking-caps` |
| Motion | `--k-dur-fast/dur/dur-slow`, `--k-ease`, `--k-ease-out` |
| Surface | `--k-bg`, `--k-bg-raised`, `--k-bg-sunken`, `--k-bg-hover`, `--k-bg-active`, `--k-bg-selected` |
| Text | `--k-fg`, `--k-fg-secondary`, `--k-fg-muted`, `--k-fg-placeholder` |
| Line | `--k-border`, `--k-border-strong`, `--k-divider` |
| Field | `--k-field-bg`, `--k-field-bg-focus`, `--k-field-border`, `--k-focus-ring` |
| Status | `--k-success/warning/danger/info` and each `-soft` |
| Brand | `--k-accent`, `--k-accent-hover`, `--k-accent-fg`, `--k-accent-soft` |
| Depth | `--k-shadow-sm/md/lg`, `--k-scrim`, `--k-glass-bg`, `--k-glass-border` |

Per-plugin, override only `--k-scale`, `--k-accent` and the font. Figma panels
are small: `--k-scale: 1` is Figma-native density, 1.2–1.35 reads better for
preview-heavy tools.

---

## Layout

| Class | Use |
|---|---|
| `.k-app` | Vertical shell: fixed header, scrolling middle, fixed footer |
| `.k-header` / `.k-footer` | Padded, hairline-separated bands |
| `.k-scroll` | The scrolling region. Thin scrollbar that appears on hover |
| `.k-scroll--hidden` | Same, scrollbar fully hidden |
| `.k-stack` / `.k-stack-sm` | Vertical flex with gap |
| `.k-row` + `--between` / `--end` / `--wrap` | Horizontal flex |
| `.k-grow` | `flex: 1`, min-width 0 (needed for truncation) |
| `.k-divider` | Hairline rule |
| `.k-meta-row` | Label left, value right-aligned |

---

## Components

| Component | Classes |
|---|---|
| Type | `.k-title` `.k-label` `.k-value` `.k-caption` `.k-section-title` `.k-mono` `.k-truncate` `.k-selectable` |
| Button | `.k-btn` + `--primary` `--secondary` `--ghost` `--danger` `--icon` `--sm` `--block`; `data-loading="true"` swaps the label for a spinner without reflow |
| Input | `.k-input` `.k-textarea` `.k-select`; `aria-invalid="true"` for the error state |
| Search | `.k-search` wrapping `.k-search__icon`, `.k-input`, `.k-search__clear` |
| Stepper | `.k-stepper` with two `.k-btn` and an `.k-input` |
| Checkbox / radio | `.k-check` wrapping a native input |
| Switch | `.k-switch` wrapping a native checkbox |
| Segmented | `.k-segment` + `.k-segment__item[data-value]`, `aria-selected` |
| Tabs | `.k-tabs` + `.k-tabs__item[data-value]` |
| Range | `.k-range` |
| Cell grid | `.k-grid` (set `--k-grid-cols`) or `.k-grid--auto` (`--k-cell-min`) + `.k-cell`, `.k-cell__caption` |
| List | `.k-list` + `.k-list__row` (`--flush`) + `.k-list__meta` |
| Badge | `.k-badge` + `--info` `--success` `--warning` `--danger` `--dot` |
| Banner | `.k-banner` + the same tones |
| Status line | `.k-status[data-tone]` — collapses when empty |
| Progress | `.k-progress` + `.k-progress__bar`, `.k-progress--indeterminate` |
| Spinner | `.k-spinner` |
| Skeleton | `.k-skeleton` + `--text` `--cell` |
| Empty state | `.k-empty` + `__title` `__body` |
| Tooltip | `data-tip="…"`, `data-tip-pos="bottom"` |
| Collapsible | `<details class="k-collapse">` + `.k-collapse__body` |
| Modal | `.k-modal` + `__card` `__header` `__body` `__footer`; `.is-open` |
| Toast | `.k-toasts` / `.k-toast[data-tone]` — created by `K.toast` |
| Keycap | `.k-kbd` |
| Drop zone | `.k-drop`, `.is-over` while dragging |
| Icons | `<svg class="k-icon"><use href="#i-search"></use></svg>` |

Sprite ids: `i-search` `i-close` `i-check` `i-chevron-down` `i-chevron-right`
`i-plus` `i-minus` `i-refresh` `i-settings` `i-info` `i-warning` `i-copy`
`i-trash` `i-external` `i-sun` `i-moon` `i-type`.

Selection state is `aria-selected="true"` on cells, list rows, segment items
and tabs — it styles the element and carries the meaning to screen readers at
the same time, so there is no separate `.is-selected` to keep in sync.

---

## window.K

| Call | Does |
|---|---|
| `K.init(opts)` | Wires theme switches, restores stored settings. Call once. `opts.settings` adds extra `clientStorage` keys to fetch. |
| `K.send(type, payload)` | Message `code.js`. |
| `K.on(type, fn)` | Receive from `code.js`. `"*"` catches everything. Returns an unsubscriber. |
| `K.delegate(evt, sel, fn)` | Delegated listener — the right tool for rebuilt lists. |
| `K.theme.get()` | `"light"` or `"dark"`, resolved. |
| `K.theme.set(v)` | `"light"`, `"dark"` or `"auto"`. Persisted. |
| `K.theme.toggle()` | Flip. |
| `K.scale(n)` | Resize the whole UI, persisted. |
| `K.toast(msg, {tone, duration})` | `tone`: `"success"` or `"danger"`. |
| `K.modal(sel)` | `{open, close, isOpen, el}`. Esc and scrim close it; `[data-kit="modal-close"]` wired automatically. |
| `K.segment(sel, onChange)` | Segmented control or tabs, arrow-key navigable. `{select, value}`. |
| `K.search(sel, onInput, ms)` | Debounce (120 ms default), clear button, Esc to empty. |
| `K.loading(btn, bool)` | Spinner in place of the label, disables the button. |
| `K.progress(sel, 0…1)` | `null` for indeterminate. |
| `K.autoResize({max, min, measure})` | Asks `code.js` to fit the window to content. |
| `K.insideFigma` | `false` when the file is opened in a plain browser. |

Declarative hooks, no JS needed: `data-kit="theme-switch"`,
`data-kit="theme-toggle"`, `data-kit="modal-close"`, `data-kit="search-clear"`.

Events on `document`: `kit:ready` (settings restored) and `kit:themechange`.

---

## Message contract

Every message is `{ type, payload }`. The kit reserves the `kit:` prefix;
everything else is yours.

| Direction | Type | Payload |
|---|---|---|
| UI → main | `kit:get-settings` | `{ keys: [...] }` |
| UI → main | `kit:set-setting` | `{ key, value }` |
| UI → main | `kit:resize` | `{ width, height }` |
| main → UI | `kit:settings` | `{ [key]: value }` |

`assets/templates/code.js` answers all three already. Add your own cases to the
same switch.

---

## Recipes

**Rebuild a grid and keep selection working** — bind once with `K.delegate`,
not per cell, so re-rendering `innerHTML` cannot drop listeners:

```js
K.delegate("click", "#grid .k-cell", (_, cell) => {
  cell.parentElement.querySelectorAll(".k-cell")
    .forEach((c) => c.setAttribute("aria-selected", String(c === cell)));
  K.send("item:pick", { index: Number(cell.dataset.index) });
});
```

**Long-running work with honest feedback:**

```js
K.send("scan");
K.progress("#prog", null);                       // indeterminate
K.on("scan:progress", ({ done, total }) => K.progress("#prog", done / total));
K.on("scan:done", ({ count }) => {
  K.progress("#prog", 1);
  K.toast(`${count} items`, { tone: "success" });
});
```

**Persist a user setting:**

```js
K.init({ settings: ["myplugin:lastFamily"] });
document.addEventListener("kit:ready", (e) => {
  const last = e.detail["myplugin:lastFamily"];
  if (last) select.value = last;
});
select.addEventListener("change", () =>
  K.send("kit:set-setting", { key: "myplugin:lastFamily", value: select.value })
);
```

**Fit the window to content** (call after rendering, not before):

```js
K.on("items", ({ items }) => {
  render(items);
  requestAnimationFrame(() => K.autoResize({ max: 640 }));
});
```
