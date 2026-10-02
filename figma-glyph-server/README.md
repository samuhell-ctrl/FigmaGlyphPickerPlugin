# Figma Glyph Font Server

Headless tray app that scans the machine for fonts and serves glyph data to
the Local Glyph Picker Figma plugin on `http://localhost:3000`.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /version` | The running server version. This is the only reliable version source — the badge in the plugin UI is hardcoded in the HTML. |
| `GET /fonts` | The full font dictionary (`family -> style -> file path`) and the family count. |
| `GET /rescan` | Re-scans all font directories and indexes anything new. Returns how many styles were added plus the directories searched. |
| `GET /get-glyphs?family=…&style=…` | Glyph outlines and stylistic sets for a family. |

## Where fonts are found

The scanner reads four kinds of location:

- **standard** — the OS font folders (`~/Library/Fonts`, `/Library/Fonts`,
  `/System/Library/Fonts` on macOS; the Windows font folders elsewhere)
- **adobe** — the Creative Cloud `livetype` cache
- **manager** — third-party font manager vaults: Monotype Connect, Extensis
  Connect Fonts, Suitcase Fusion, FontBase, RightFont, Typeface
- **configured** — anything you add yourself (see below)

Font managers matter because they activate fonts through CoreText from their
own vault rather than installing into the OS folders. Figma sees those fonts;
a scanner that only walks the standard folders does not, which shows up in the
plugin as `Cannot load local file for <font>`.

When a family is requested but not found, the server rescans automatically
before returning 404, so a font installed while the server is running is
picked up without a restart.

### Adding your own font directories

Either set an environment variable (`:`-separated on macOS/Linux,
`;`-separated on Windows):

```bash
GLYPH_EXTRA_FONT_DIRS="/Volumes/Shared/Brand Fonts:/opt/fonts"
```

…or create `~/.figma-glyph-server/config.json`:

```json
{
  "extraFontDirectories": [
    "/Volumes/Shared/Brand Fonts",
    "/opt/fonts"
  ]
}
```

Configured directories rank alongside a direct install, so they take
precedence over a font manager's vault copy of the same face.

### Duplicate handling

A vault keeps several versions of the same face side by side. When two files
map to the same family and style, the one from the higher-priority source wins
(`standard` > `adobe` > `manager`); on a tie the newer `fontRevision` wins.

Style names are read from the font's English name records, so dictionary keys
stay stable on a non-English machine — a French Mac would otherwise key styles
as `Gras` or `Léger`.

## Troubleshooting

`scripts/glyph-diagnose.command` in the repo root collects server version,
indexed families, live `/get-glyphs` responses, font folder contents, font
manager vault discovery and the CoreText font list into a single report.

## Development

```bash
cd figma-glyph-server
npm install
npm start          # runs the tray app via electron
npm run dist:mac   # or dist:win
```
