// server.js
// Phase 1 + 3: OS Font Scanning and Dynamic Glyph Endpoint

const express = require('express');
const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');
const getSystemFonts = require('get-system-fonts');

const app = express();
const PORT = 3000;
// Load the package.json so we know the current app version
const packageJson = require('./package.json');

// --- NEW ENDPOINT: Return the current version ---
app.get('/version', (req, res) => {
    res.json({ version: packageJson.version });
});

// The in-memory dictionary. 
const fontDictionary = {};

// ==========================================
// MIDDLEWARE: CORS Bypass
// ==========================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ==========================================
// BOOT SEQUENCE: Build the Font Dictionary
// ==========================================
function getAdobeFontDirectories() {
    const dirs = [];
    const platform = process.platform; // 'darwin', 'win32', 'linux'

    if (platform === 'darwin') {
        const base = path.join(
            process.env.HOME || process.env.USERPROFILE || '',
            'Library',
            'Application Support',
            'Adobe',
            'CoreSync',
            'plugins',
            'livetype'
        );

        const macCandidates = [
            base,
            path.join(base, '.fonts'),
            path.join(base, 'runtime', 'data', 'fonts')
        ];

        for (const p of macCandidates) {
            if (p && fs.existsSync(p)) {
                dirs.push(p);
            }
        }
    } else if (platform === 'win32') {
        const appData = process.env.APPDATA || '';
        if (appData) {
            const base = path.join(appData, 'Adobe', 'CoreSync', 'plugins', 'livetype');
            const winCandidates = [
                base,
                path.join(base, 'runtime', 'data', 'fonts')
            ];

            for (const p of winCandidates) {
                if (p && fs.existsSync(p)) {
                    dirs.push(p);
                }
            }
        }
    }

    return dirs;
}

function collectAdobeFontFilesRecursively(rootDirs) {
    const results = [];

    const stack = [...rootDirs];
    while (stack.length > 0) {
        const current = stack.pop();
        let stat;
        try {
            stat = fs.statSync(current);
        } catch {
            continue;
        }

        if (stat.isDirectory()) {
            let entries;
            try {
                entries = fs.readdirSync(current);
            } catch {
                continue;
            }

            for (const entry of entries) {
                if (SKIP_DIR_NAMES.has(entry)) continue;
                const full = path.join(current, entry);
                stack.push(full);
            }
        } else if (stat.isFile()) {
            const lower = current.toLowerCase();
            if (lower.endsWith('.ttf') || lower.endsWith('.otf')) {
                results.push(current);
            }
        }
    }

    return results;
}

// ==========================================
// FONT SOURCE DISCOVERY
// ==========================================
// Fonts reach the OS from three kinds of place:
//   standard - the OS font folders a user installs into directly
//   adobe    - Creative Cloud livetype cache
//   manager  - third-party font managers (Monotype Connect, Extensis
//              Connect Fonts, Suitcase Fusion, FontBase, ...) which
//              activate fonts through CoreText from their own vault.
//              Figma sees those fonts because it asks CoreText; walking
//              only the standard folders misses them entirely.
const SOURCE_PRIORITY = { standard: 3, adobe: 2, manager: 1 };

// Vault subtrees holding previews, backups and scratch copies rather than
// canonical font files.
const SKIP_DIR_NAMES = new Set([
    'DocPreviewsCache', 'panel-previews', 'backups', 'temp', 'Caches', 'QuickMatch'
]);

function getUserHome() {
    return process.env.HOME || process.env.USERPROFILE || '';
}

function existingDirs(candidates) {
    const seen = new Set();
    const out = [];
    for (const dir of candidates) {
        if (!dir || seen.has(dir)) continue;
        seen.add(dir);
        try {
            if (fs.statSync(dir).isDirectory()) out.push(dir);
        } catch {
            // Not present on this machine.
        }
    }
    return out;
}

function getStandardFontDirectories() {
    const home = getUserHome();
    const candidates = [];

    if (process.platform === 'darwin') {
        if (home) candidates.push(path.join(home, 'Library', 'Fonts'));
        candidates.push('/Library/Fonts', '/System/Library/Fonts', '/Network/Library/Fonts');
    } else if (process.platform === 'win32') {
        candidates.push(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'));
        if (process.env.LOCALAPPDATA) {
            candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
        }
    } else {
        if (home) {
            candidates.push(path.join(home, '.fonts'));
            candidates.push(path.join(home, '.local', 'share', 'fonts'));
        }
        candidates.push('/usr/share/fonts', '/usr/local/share/fonts');
    }

    return existingDirs(candidates);
}

function getFontManagerDirectories() {
    const home = getUserHome();
    if (!home) return [];

    // Monotype Connect and Extensis Connect Fonts are the same product and
    // share this vault path; Suitcase Fusion is its former name.
    const candidates = [
        path.join(home, 'Library', 'Extensis', 'Connect Fonts'),
        path.join(home, 'Library', 'Extensis', 'Suitcase Fusion'),
        path.join(home, 'Library', 'Application Support', 'Extensis'),
        path.join(home, 'Library', 'Application Support', 'Monotype', 'Monotype Connect'),
        path.join(home, 'Library', 'Application Support', 'FontBase'),
        path.join(home, 'Library', 'Application Support', 'RightFont'),
        path.join(home, 'Library', 'Application Support', 'Typeface')
    ];

    return existingDirs(candidates);
}

function getConfigFilePath() {
    const home = getUserHome();
    return home ? path.join(home, '.figma-glyph-server', 'config.json') : '';
}

// Extra directories the user can add without a new build, via
// GLYPH_EXTRA_FONT_DIRS or ~/.figma-glyph-server/config.json
function getConfiguredFontDirectories() {
    const dirs = [];

    const fromEnv = process.env.GLYPH_EXTRA_FONT_DIRS;
    if (fromEnv) dirs.push(...fromEnv.split(path.delimiter));

    const configPath = getConfigFilePath();
    if (configPath) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (Array.isArray(config.extraFontDirectories)) {
                dirs.push(...config.extraFontDirectories);
            }
        } catch {
            // No config file, or unreadable - not an error.
        }
    }

    return existingDirs(dirs.map((d) => String(d || '').trim()).filter(Boolean));
}

function getAllFontSources() {
    return [
        { kind: 'standard', dirs: getStandardFontDirectories() },
        { kind: 'adobe', dirs: getAdobeFontDirectories() },
        { kind: 'manager', dirs: getFontManagerDirectories() },
        // Explicitly configured directories carry the same weight as a
        // direct install, because the user asked for them by name.
        { kind: 'standard', dirs: getConfiguredFontDirectories() }
    ];
}

// ==========================================
// INDEXING
// ==========================================
// "family\u0000style" -> { priority, revision }, so a later file can decide
// whether it beats the one already mapped.
const fontEntryMeta = new Map();
// Every path already parsed, so a rescan only opens new files.
const indexedFontFiles = new Set();

function getFontRevision(font) {
    const revision = font.tables && font.tables.head && font.tables.head.fontRevision;
    return typeof revision === 'number' && isFinite(revision) ? revision : 0;
}

function registerFontFile(filePath, sourceKind) {
    if (indexedFontFiles.has(filePath)) return false;
    indexedFontFiles.add(filePath);

    const lower = filePath.toLowerCase();
    if (!lower.endsWith('.ttf') && !lower.endsWith('.otf')) return false;

    let font;
    try {
        font = opentype.loadSync(filePath);
    } catch {
        return false; // Corrupted or unsupported.
    }

    const family = resolveDictionaryFamily(font);
    if (!family) return false;
    const style = resolveDictionaryStyle(font);

    const priority = SOURCE_PRIORITY[sourceKind] || 0;
    const revision = getFontRevision(font);
    const key = family + '\u0000' + style;
    const existing = fontEntryMeta.get(key);

    // A font manager vault keeps several versions of the same face side by
    // side, and a directly installed face should beat a vault copy.
    // Highest priority wins; ties go to the newer fontRevision.
    if (existing && (existing.priority > priority ||
        (existing.priority === priority && existing.revision >= revision))) {
        return false;
    }

    if (!fontDictionary[family]) fontDictionary[family] = {};
    fontDictionary[family][style] = filePath;
    fontEntryMeta.set(key, { priority, revision });
    return true;
}

async function buildFontDictionary() {
    console.log("--------------------------------------------------");
    console.log("Scanning for system, Adobe and font-manager fonts. This may take a minute...");

    try {
        const sources = getAllFontSources();
        for (const source of sources) {
            for (const dir of source.dirs) {
                console.log("  [" + source.kind + "] " + dir);
            }
        }

        let scanned = 0;
        let mapped = 0;

        let systemFontPaths = [];
        try {
            systemFontPaths = await getSystemFonts();
        } catch (err) {
            console.warn("get-system-fonts failed, falling back to directory scan:", err.message);
        }
        for (const filePath of systemFontPaths) {
            scanned++;
            if (registerFontFile(filePath, 'standard')) mapped++;
        }

        for (const source of sources) {
            for (const filePath of collectAdobeFontFilesRecursively(source.dirs)) {
                scanned++;
                if (registerFontFile(filePath, source.kind)) mapped++;
            }
        }

        console.log("Initialization Complete! Scanned " + scanned + " files, mapped " +
            mapped + " styles across " + Object.keys(fontDictionary).length + " families.");
        console.log("--------------------------------------------------");
    } catch (error) {
        console.error("Failed to scan system fonts:", error);
    }
}

let lastRescanAt = 0;
const RESCAN_MIN_INTERVAL_MS = 5000;

// Picks up fonts installed or activated since the last scan. Enumeration is
// cheap; only files never parsed before get opened.
function rescanFontDirectories(reason) {
    const now = Date.now();
    if (now - lastRescanAt < RESCAN_MIN_INTERVAL_MS) return 0;
    lastRescanAt = now;

    let added = 0;
    for (const source of getAllFontSources()) {
        for (const filePath of collectAdobeFontFilesRecursively(source.dirs)) {
            if (registerFontFile(filePath, source.kind)) added++;
        }
    }

    if (added) console.log("Rescan (" + reason + ") mapped " + added + " new font style(s).");
    return added;
}

function pickEnglishName(nameRecord) {
    if (!nameRecord || typeof nameRecord !== 'object') return '';

    const valueFor = (lang) => {
        const v = nameRecord[lang];
        return typeof v === 'string' && v.trim() ? v.trim() : '';
    };

    // Pin to English so dictionary keys do not shift with the machine
    // locale - a French Mac otherwise keys styles as "Gras" or "Leger".
    const exact = valueFor('en');
    if (exact) return exact;

    const englishVariants = Object.keys(nameRecord)
        .filter((lang) => /^en([-_]|$)/i.test(lang))
        .sort();
    for (const lang of englishVariants) {
        const v = valueFor(lang);
        if (v) return v;
    }

    // No English record at all: fall back deterministically rather than
    // depending on object key order.
    for (const lang of Object.keys(nameRecord).sort()) {
        const v = valueFor(lang);
        if (v) return v;
    }
    return '';
}

function resolveDictionaryFamily(font) {
    const preferredFamily = pickEnglishName(font.names.preferredFamily);
    if (preferredFamily) return preferredFamily;
    return pickEnglishName(font.names.fontFamily);
}

function resolveDictionaryStyle(font) {
    const preferredSubfamily = pickEnglishName(font.names.preferredSubfamily);
    if (preferredSubfamily) return preferredSubfamily;

    const fontSubfamily = pickEnglishName(font.names.fontSubfamily);
    return fontSubfamily || 'Regular';
}

function normalizeFontKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Exact hit first, then the closest normalized prefix match.
function resolveFamilyEntry(family) {
    if (fontDictionary[family]) {
        return { resolvedFamily: family, familyDict: fontDictionary[family] };
    }

    const requested = String(family).toLowerCase();
    const requestedNormalized = normalizeFontKey(family);
    const allFamilies = Object.keys(fontDictionary);

    const candidates = allFamilies.filter((key) =>
        normalizeFontKey(key).startsWith(requestedNormalized));

    let fallbackKey = null;

    if (candidates.length > 0) {
        const regularCandidates = candidates.filter((k) => k.toLowerCase().includes('regular'));
        if (regularCandidates.length > 0) {
            regularCandidates.sort((a, b) => a.length - b.length);
            fallbackKey = regularCandidates[0];
        } else {
            candidates.sort((a, b) => a.length - b.length);
            fallbackKey = candidates[0];
        }
    } else {
        fallbackKey = allFamilies.find((key) => key.toLowerCase() === requested) ||
            allFamilies.find((key) => key.toLowerCase().includes(requested));
    }

    if (!fallbackKey) return { resolvedFamily: family, familyDict: null };

    console.log("Family '" + family + "' not found, using closest match '" + fallbackKey + "'.");
    return { resolvedFamily: fallbackKey, familyDict: fontDictionary[fallbackKey] };
}

// ==========================================
// PHASE 1 VERIFICATION ENDPOINT
// ==========================================
app.get('/fonts', (req, res) => {
    res.json({
        message: "Font Dictionary Status",
        totalFamilies: Object.keys(fontDictionary).length,
        dictionary: fontDictionary
    });
});

// Lets the tray app (or a user) pick up newly installed fonts without a
// restart. Throttled internally so it cannot be hammered.
app.get('/rescan', (req, res) => {
    const added = rescanFontDirectories('manual request');
    res.json({
        added,
        totalFamilies: Object.keys(fontDictionary).length,
        directories: getAllFontSources()
            .flatMap((source) => source.dirs.map((dir) => ({ kind: source.kind, dir })))
    });
});

// ==========================================
// PHASE 3: DYNAMIC GLYPH ENDPOINT
// ==========================================
function extractStylisticSetsFromFont(font) {
    const gsub = font.tables && font.tables.gsub;
    if (!gsub || !Array.isArray(gsub.features) || !Array.isArray(gsub.lookups)) {
        return {
            stylisticSets: {},
            stylisticSetLabels: {}
        };
    }

    const stylisticTags = new Set();
    for (let i = 1; i <= 20; i++) {
        stylisticTags.add(`ss${i.toString().padStart(2, '0')}`);
    }

    const lookups = gsub.lookups;

    // tag -> inputUnicodeDecString -> Set(altGlyphId)
    const raw = Object.create(null);
    // tag -> featureNameID (for user-facing label lookup)
    const labelNameIdByTag = Object.create(null);

    function asNumber(x) {
        return typeof x === 'number' && Number.isFinite(x) ? x : null;
    }

    function getSetNumberFromTag(tag) {
        const match = /^ss(\d{2})$/i.exec(tag || '');
        return match ? Number.parseInt(match[1], 10) : null;
    }

    function defaultSetLabelForTag(tag) {
        const n = getSetNumberFromTag(tag);
        return Number.isFinite(n) ? `Set ${n}` : String(tag || '').toUpperCase();
    }

    function readNameRecordString(record) {
        if (!record) return '';
        const value = record.string ?? record.text ?? record.value ?? '';
        if (typeof value === 'string') return value;
        if (value && typeof value === 'object' && typeof value.en === 'string') return value.en;
        return '';
    }

    function getLabelFromNameTableById(nameId) {
        const nameTable = font.tables && font.tables.name;
        if (!nameTable || !Array.isArray(nameTable.records)) return '';

        const records = nameTable.records.filter(r => r && r.nameID === nameId);
        if (!records.length) return '';

        // Prefer English-ish records when possible, then first non-empty.
        const preferred = records.find(r =>
            r.platformID === 3 &&
            (r.languageID === 1033 || r.languageID === 0x0409)
        ) || records[0];

        return readNameRecordString(preferred).trim();
    }

    function normalizeLabel(tag, rawLabel) {
        const fallback = defaultSetLabelForTag(tag);
        const cleaned = String(rawLabel || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return fallback;
        if (/^ss\d{2}$/i.test(cleaned)) return fallback;
        return cleaned;
    }

    function getGlyphIdCount() {
        return (font && font.glyphs && typeof font.glyphs.length === 'number') ? font.glyphs.length : 0;
    }

    function getUnicodeForGlyphId(gid) {
        try {
            const g = font.glyphs.get(gid);
            const u = g && typeof g.unicode === 'number' ? g.unicode : null;
            return (u === 0 || (typeof u === 'number' && Number.isFinite(u))) ? u : null;
        } catch {
            return null;
        }
    }

    function getCoverageGlyphIds(coverage) {
        if (!coverage) return [];

        // opentype.js commonly gives { glyphs: number[] } or { ranges: [{start,end}] }
        if (Array.isArray(coverage)) {
            return coverage.filter(n => typeof n === 'number' && Number.isFinite(n));
        }

        const glyphs = coverage.glyphs || coverage.glyphArray || coverage.glyphIndices;
        if (Array.isArray(glyphs)) {
            return glyphs.filter(n => typeof n === 'number' && Number.isFinite(n));
        }

        const ranges = coverage.ranges || coverage.rangeRecords;
        if (Array.isArray(ranges)) {
            const out = [];
            const maxGlyphId = getGlyphIdCount() - 1;
            for (const r of ranges) {
                const start = asNumber(r.start ?? r.startGlyphID ?? r.startGlyphId ?? r.firstGlyph);
                const end = asNumber(r.end ?? r.endGlyphID ?? r.endGlyphId ?? r.lastGlyph);
                if (start === null || end === null) continue;
                const s = Math.max(0, start);
                const e = Math.min(maxGlyphId >= 0 ? maxGlyphId : end, end);
                for (let g = s; g <= e; g++) out.push(g);
            }
            return out;
        }

        // Some parsers nest coverage deeper
        if (coverage.coverage) return getCoverageGlyphIds(coverage.coverage);
        if (coverage.table) return getCoverageGlyphIds(coverage.table);

        return [];
    }

    function addMapping(tag, inputGlyphId, altGlyphIds) {
        if (!stylisticTags.has(tag)) return;
        if (!altGlyphIds || altGlyphIds.length === 0) return;

        const inputUnicode = getUnicodeForGlyphId(inputGlyphId);
        if (inputUnicode === null) return;
        const inputKey = String(inputUnicode);

        if (!raw[tag]) raw[tag] = Object.create(null);
        if (!raw[tag][inputKey]) raw[tag][inputKey] = new Set();

        const store = raw[tag][inputKey];
        for (const altId of altGlyphIds) {
            const n = asNumber(altId);
            if (n === null) continue;
            store.add(n);
        }
    }

    function unwrapExtensionLookup(lookupType, subtable) {
        // GSUB Extension Substitution (lookup type 7) wraps another lookup type
        if (lookupType !== 7 || !subtable) return null;
        const extType = asNumber(subtable.extensionLookupType ?? subtable.extLookupType);
        const ext = subtable.extension || subtable.extSubtable || subtable.subtable;
        if (extType === null || !ext) return null;
        return { lookupType: extType, subtable: ext };
    }

    function extractFromSingleSubtable(tag, lookupType, subtable, depth, visitedLookups) {
        if (!subtable) return;

        // Unwrap extension lookups
        const ext = unwrapExtensionLookup(lookupType, subtable);
        if (ext) {
            extractFromSingleSubtable(tag, ext.lookupType, ext.subtable, depth, visitedLookups);
            return;
        }

        // --- Type 1: Single Substitution ---
        if (lookupType === 1) {
            const coverageGlyphIds = getCoverageGlyphIds(subtable.coverage);
            const format = subtable.substFormat ?? subtable.format ?? subtable.substitutionFormat;

            // Format 1: deltaGlyphId
            if (asNumber(subtable.deltaGlyphId) !== null) {
                const delta = subtable.deltaGlyphId;
                for (const inId of coverageGlyphIds) {
                    addMapping(tag, inId, [inId + delta]);
                }
                return;
            }

            // Format 2: substitute array aligned with coverage
            if (Array.isArray(subtable.substitute)) {
                for (let i = 0; i < coverageGlyphIds.length; i++) {
                    const inId = coverageGlyphIds[i];
                    const outId = subtable.substitute[i];
                    if (asNumber(outId) !== null) addMapping(tag, inId, [outId]);
                }
                return;
            }

            // Some fonts/parsers expose a mapping object
            if (subtable.substitute && typeof subtable.substitute === 'object') {
                // Try keys as input glyph IDs (stringified numbers)
                for (const k of Object.keys(subtable.substitute)) {
                    const inId = asNumber(Number(k));
                    const outId = asNumber(subtable.substitute[k]);
                    if (inId !== null && outId !== null) addMapping(tag, inId, [outId]);
                }
                return;
            }

            // Best-effort: if coverage exists but no known fields, do nothing safely.
            return;
        }

        // --- Type 3: Alternate Substitution ---
        if (lookupType === 3) {
            const coverageGlyphIds = getCoverageGlyphIds(subtable.coverage);
            const altSets =
                subtable.alternateSets ||
                subtable.alternates ||
                subtable.altSets ||
                [];

            if (Array.isArray(altSets)) {
                for (let i = 0; i < coverageGlyphIds.length; i++) {
                    const inId = coverageGlyphIds[i];
                    const alts = altSets[i];
                    if (Array.isArray(alts)) addMapping(tag, inId, alts);
                }
            }
            return;
        }

        // --- Type 2: Multiple Substitution (coverage -> sequences of glyph IDs) ---
        if (lookupType === 2) {
            const coverageGlyphIds = getCoverageGlyphIds(subtable.coverage);
            const sequences = subtable.sequences || subtable.sequence || subtable.substitute;

            if (Array.isArray(sequences)) {
                for (let i = 0; i < coverageGlyphIds.length; i++) {
                    const inId = coverageGlyphIds[i];
                    const seq = sequences[i];
                    if (Array.isArray(seq)) {
                        // treat each component as an alternate candidate (best-effort)
                        addMapping(tag, inId, seq);
                    }
                }
            }
            return;
        }

        // --- Type 4: Ligature Substitution (coverage -> ligatureSets) ---
        if (lookupType === 4) {
            const coverageGlyphIds = getCoverageGlyphIds(subtable.coverage);
            const ligatureSets = subtable.ligatureSets || subtable.ligatures;
            if (Array.isArray(ligatureSets)) {
                for (let i = 0; i < coverageGlyphIds.length; i++) {
                    const inId = coverageGlyphIds[i];
                    const set = ligatureSets[i];
                    if (!Array.isArray(set)) continue;
                    for (const lig of set) {
                        const ligGlyph = asNumber(lig && (lig.ligGlyph ?? lig.ligatureGlyph ?? lig.glyph));
                        if (ligGlyph !== null) {
                            // Best-effort: map first covered glyph -> ligature glyph
                            addMapping(tag, inId, [ligGlyph]);
                        }
                    }
                }
            }
            return;
        }

        // --- Contextual / Chained Contextual: follow lookupRecords to other lookups (best-effort) ---
        if ((lookupType === 5 || lookupType === 6) && depth < 4) {
            // Different formats: sometimes rules are in subRules/subClassSets/chainSubRules/chainSubClassSets
            const candidateRuleSets = [
                subtable.subRules,
                subtable.subRuleSets,
                subtable.subClassSets,
                subtable.chainSubRules,
                subtable.chainSubRuleSets,
                subtable.chainSubClassSets,
                subtable.rules,
                subtable.ruleSets
            ].filter(Boolean);

            const lookupRecords = [];

            function collectLookupRecordsFromRule(rule) {
                if (!rule) return;
                const recs =
                    rule.lookupRecords ||
                    rule.substLookupRecords ||
                    rule.lookups ||
                    [];
                if (Array.isArray(recs)) {
                    for (const r of recs) lookupRecords.push(r);
                }
            }

            function walkRuleSet(set) {
                if (!set) return;
                if (Array.isArray(set)) {
                    for (const item of set) walkRuleSet(item);
                    return;
                }
                // Some structures have `.rules`
                if (Array.isArray(set.rules)) {
                    for (const r of set.rules) collectLookupRecordsFromRule(r);
                }
                // Or are directly rules
                collectLookupRecordsFromRule(set);
            }

            for (const rs of candidateRuleSets) walkRuleSet(rs);

            for (const rec of lookupRecords) {
                const idx = asNumber(rec.lookupListIndex ?? rec.lookupIndex ?? rec.lookupListIdx ?? rec.lookup);
                if (idx === null) continue;
                extractFromLookupIndex(tag, idx, depth + 1, visitedLookups);
            }
            return;
        }

        // Other lookup types exist (e.g., 8 reverse chaining single) — ignore safely for now.
    }

    function extractFromLookupIndex(tag, idx, depth, visitedLookups) {
        if (idx === null || idx === undefined) return;
        if (!lookups[idx]) return;
        const key = `${tag}:${idx}`;
        if (visitedLookups.has(key)) return;
        visitedLookups.add(key);

        const lookup = lookups[idx];
        const lookupType = lookup.lookupType;
        const subtables = Array.isArray(lookup.subtables) ? lookup.subtables : [];

        for (const subtable of subtables) {
            try {
                extractFromSingleSubtable(tag, lookupType, subtable, depth, visitedLookups);
            } catch {
                // Be resilient: skip broken subtables
            }
        }
    }

    // Iterate stylistic set features -> resolve lookups -> extract alternates
    for (const featureRecord of gsub.features) {
        const tag = featureRecord && featureRecord.tag;
        if (!stylisticTags.has(tag)) continue;

        const feature = featureRecord.feature || featureRecord;
        const featureParams = feature.featureParams || feature.params || feature.featureParameters || null;
        const uiNameId = asNumber(
            featureParams && (
                featureParams.uiNameID ??
                featureParams.uiNameId ??
                featureParams.nameID ??
                featureParams.nameId
            )
        );
        if (uiNameId !== null && labelNameIdByTag[tag] === undefined) {
            labelNameIdByTag[tag] = uiNameId;
        }

        const indices = feature.lookupListIndexes || feature.lookupIndexes || [];
        const visitedLookups = new Set();

        for (const idx of indices) {
            extractFromLookupIndex(tag, idx, 0, visitedLookups);
        }
    }

    // Convert glyph IDs into the response shape with SVG paths.
    const finalResult = {};
    const stylisticSetLabels = {};
    const targetFontSize = 72;

    for (const tag of Object.keys(raw)) {
        const configuredNameId = labelNameIdByTag[tag];
        const labelFromNameTable = configuredNameId !== undefined
            ? getLabelFromNameTableById(configuredNameId)
            : '';
        stylisticSetLabels[tag] = normalizeLabel(tag, labelFromNameTable);

        finalResult[tag] = {};
        for (const inputCode of Object.keys(raw[tag])) {
            const glyphIdSet = raw[tag][inputCode];
            const glyphEntries = [];

            for (const altId of glyphIdSet) {
                let g = null;
                try {
                    g = font.glyphs.get(altId);
                } catch {
                    g = null;
                }
                if (!g) continue;

                const unicode = (typeof g.unicode === 'number' && Number.isFinite(g.unicode)) ? g.unicode : null;
                let svgPathString = '';
                try {
                    svgPathString = g.getPath(0, 0, targetFontSize).toPathData(2);
                } catch {
                    svgPathString = '';
                }

                // Keep schema mostly consistent, but allow null unicode for unencoded alternates
                glyphEntries.push({
                    glyphId: altId,
                    unicode,
                    hex: unicode === null ? null : `U+${unicode.toString(16).toUpperCase().padStart(4, '0')}`,
                    name: g.name || 'Unnamed',
                    path: svgPathString
                });
            }

            if (glyphEntries.length > 0) {
                finalResult[tag][inputCode] = glyphEntries;
            }
        }
    }

    return {
        stylisticSets: finalResult,
        stylisticSetLabels
    };
}

app.get('/get-glyphs', (req, res) => {
    const family = req.query.family;
    const style = req.query.style;

    if (!family ||!style) {
        return res.status(400).json({ error: "Missing family or style parameters." });
    }

    // 1. Resolve the family. If it misses, the font may have been installed
    //    or activated by a font manager since the last scan, so rescan once
    //    and try again before giving up.
    let { resolvedFamily, familyDict } = resolveFamilyEntry(family);

    if (!familyDict) {
        rescanFontDirectories(`lookup miss for '${family}'`);
        ({ resolvedFamily, familyDict } = resolveFamilyEntry(family));
    }

    if (!familyDict) {
        return res.status(404).json({ error: `Font family '${family}' not found on system.` });
    }

    // Always prefer the "Regular" style for glyph display, 
    // and fall back to the first available style if Regular doesn't exist.
    const styleKeys = Object.keys(familyDict);
    if (styleKeys.length === 0) {
        return res.status(404).json({ error: `No styles found for family '${resolvedFamily}'.` });
    }

    let resolvedStyle = 'Regular';
    if (!familyDict[resolvedStyle]) {
        resolvedStyle = styleKeys[0];
    }

    const filePath = familyDict[resolvedStyle];

    // 2. Parse the specific local file
    try {
        console.log(` Parsing: ${filePath}`);
        const font = opentype.loadSync(filePath);
        const glyphData = [];
        const targetFontSize = 72; 
        const maxGlyphsToProcess = 1000;
        let processedCount = 0;

        for (let i = 0; i < font.glyphs.length; i++) {
            const glyph = font.glyphs.get(i);

            if (glyph.unicode) {
                const svgPathString = glyph.getPath(0, 0, targetFontSize).toPathData(2);

                glyphData.push({
                    unicode: glyph.unicode,
                    hex: `U+${glyph.unicode.toString(16).toUpperCase().padStart(4, '0')}`,
                    name: glyph.name || 'Unnamed',
                    path: svgPathString,
                    advanceWidth: glyph.advanceWidth
                });

                processedCount++;
                if (processedCount >= maxGlyphsToProcess) break;
            }
        }

        const {
            stylisticSets,
            stylisticSetLabels
        } = extractStylisticSetsFromFont(font);

        res.json({
            fontFamily: font.names.fontFamily?.en || resolvedFamily,
            style: resolvedStyle,
            totalGlyphsParsed: glyphData.length,
            glyphs: glyphData,
            stylisticSets,
            stylisticSetLabels
        });

    } catch (error) {
        console.error("Dynamic Parsing Failed:", error);
        res.status(500).json({ error: "Failed to parse local font file.", details: error.message });
    }
});

// ==========================================
// SERVER INITIALIZATION API (for Electron)
// ==========================================
let httpServer = null;

async function startServer() {
    if (httpServer) {
        return httpServer; // already running
    }

    await buildFontDictionary();

    await new Promise((resolve) => {
        httpServer = app.listen(PORT, () => {
            console.log(`Figma Dynamic Font Server ACTIVE`);
            console.log(`Verify your mapped OS fonts here: http://localhost:${PORT}/fonts`);
            resolve();
        });
    });

    return httpServer;
}

async function stopServer() {
    if (!httpServer) {
        return;
    }

    await new Promise((resolve, reject) => {
        httpServer.close((err) => {
            if (err) return reject(err);
            console.log('Figma Dynamic Font Server stopped.');
            httpServer = null;
            resolve();
        });
    });
}

module.exports = {
    startServer,
    stopServer,
};