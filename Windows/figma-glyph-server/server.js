// server.js
// Phase 1 + 3: OS Font Scanning and Dynamic Glyph Endpoint

const express = require('express');
const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');
const getSystemFonts = require('get-system-fonts');

const app = express();
const PORT = 3000;

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
async function buildFontDictionary() {
    console.log("--------------------------------------------------");
    console.log("Scanning OS for system fonts. This may take a minute...");
    
    try {
        const fontPaths = await getSystemFonts();
        console.log(`Found ${fontPaths.length} raw font files. Indexing OpenType metadata...`);

        let successCount = 0;

        for (const filePath of fontPaths) {
            try {
                const lowerPath = filePath.toLowerCase();
                if (!lowerPath.endsWith('.ttf') &&!lowerPath.endsWith('.otf')) {
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
        const glyphData =[];
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

        res.json({
            fontFamily: font.names.fontFamily?.en || resolvedFamily,
            style: resolvedStyle,
            totalGlyphsParsed: glyphData.length,
            glyphs: glyphData
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