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

async function buildFontDictionary() {
    console.log("--------------------------------------------------");
    console.log("Scanning OS for system fonts and Adobe Creative Cloud fonts. This may take a minute...");
    
    try {
        const systemFontPaths = await getSystemFonts();
        const adobeDirs = getAdobeFontDirectories();
        const adobeFontPaths = collectAdobeFontFilesRecursively(adobeDirs);

        const combinedPathsSet = new Set();
        for (const p of systemFontPaths) {
            combinedPathsSet.add(p);
        }
        for (const p of adobeFontPaths) {
            combinedPathsSet.add(p);
        }

        const allFontPaths = Array.from(combinedPathsSet);

        console.log(`Found ${allFontPaths.length} unique font files (system + Adobe). Indexing OpenType metadata...`);

        let successCount = 0;

        for (const filePath of allFontPaths) {
            try {
                const lowerPath = filePath.toLowerCase();
                if (!lowerPath.endsWith('.ttf') && !lowerPath.endsWith('.otf')) {
                    continue;
                }

                const font = opentype.loadSync(filePath);
                const family = font.names.fontFamily?.en;
                const style = font.names.fontSubfamily?.en || 'Regular';

                if (family) {
                    if (!fontDictionary[family]) {
                        fontDictionary[family] = {};
                    }
                    
                    fontDictionary[family][style] = filePath;
                    successCount++;
                    
                    if (successCount % 200 === 0) {
                        console.log(`... Mapped ${successCount} font styles...`);
                    }
                }
            } catch (err) {
                // Skip corrupted or unsupported fonts
            }
        }

        console.log(`Initialization Complete! Mapped ${successCount} total font styles.`);
        console.log("--------------------------------------------------");

    } catch (error) {
        console.error("Failed to scan system fonts:", error);
    }
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

// ==========================================
// PHASE 3: DYNAMIC GLYPH ENDPOINT
// ==========================================
function extractStylisticSetsFromFont(font) {
    const gsub = font.tables && font.tables.gsub;
    if (!gsub || !Array.isArray(gsub.features) || !Array.isArray(gsub.lookups)) {
        return {};
    }

    const stylisticTags = new Set();
    for (let i = 1; i <= 20; i++) {
        stylisticTags.add(`ss${i.toString().padStart(2, '0')}`);
    }

    const lookups = gsub.lookups;

    // tag -> inputUnicodeDecString -> Set(altGlyphId)
    const raw = Object.create(null);

    function asNumber(x) {
        return typeof x === 'number' && Number.isFinite(x) ? x : null;
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
        const indices = feature.lookupListIndexes || feature.lookupIndexes || [];
        const visitedLookups = new Set();

        for (const idx of indices) {
            extractFromLookupIndex(tag, idx, 0, visitedLookups);
        }
    }

    // Convert glyph IDs into the response shape with SVG paths.
    const finalResult = {};
    const targetFontSize = 72;

    for (const tag of Object.keys(raw)) {
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

    return finalResult;
}

app.get('/get-glyphs', (req, res) => {
    const family = req.query.family;
    const style = req.query.style;

    if (!family ||!style) {
        return res.status(400).json({ error: "Missing family or style parameters." });
    }

    // 1. Look up the font in our OS dictionary (with a fallback for close matches, e.g. variable fonts)
    let resolvedFamily = family;
    let familyDict = fontDictionary[resolvedFamily];

    if (!familyDict) {
        const requested = family.toLowerCase();
        const requestedNormalized = requested.replace(/[^a-z0-9]/g, '');
        const allFamilies = Object.keys(fontDictionary);

        // Collect all candidates whose normalized name starts with the requested normalized name
        const candidates = allFamilies.filter(key => {
            const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
            return normalizedKey.startsWith(requestedNormalized);
        });

        let fallbackKey = null;

        if (candidates.length > 0) {
            // Prefer names that contain "regular"
            const regularCandidates = candidates.filter(k => k.toLowerCase().includes('regular'));
            if (regularCandidates.length > 0) {
                // Among "regular" candidates, prefer the shortest name (usually base style)
                regularCandidates.sort((a, b) => a.length - b.length);
                fallbackKey = regularCandidates[0];
            } else {
                // Otherwise prefer the shortest candidate name overall
                candidates.sort((a, b) => a.length - b.length);
                fallbackKey = candidates[0];
            }
        } else {
            // Fallback to more generic heuristics if no normalized prefix matches are found
            // Try exact case-insensitive match first
            fallbackKey = allFamilies.find(key => key.toLowerCase() === requested);

            // Then try partial match
            if (!fallbackKey) {
                fallbackKey = allFamilies.find(key => key.toLowerCase().includes(requested));
            }
        }

        if (fallbackKey) {
            resolvedFamily = fallbackKey;
            familyDict = fontDictionary[resolvedFamily];
            console.log(`Family '${family}' not found, using closest match '${resolvedFamily}'.`);
        }
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

        const stylisticSets = extractStylisticSetsFromFont(font);

        res.json({
            fontFamily: font.names.fontFamily?.en || resolvedFamily,
            style: resolvedStyle,
            totalGlyphsParsed: glyphData.length,
            glyphs: glyphData,
            stylisticSets
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