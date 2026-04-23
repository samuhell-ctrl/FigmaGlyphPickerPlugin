// Phase 3: Dynamic Sandbox and Text Insertion
// Define your base rem size (usually 16px)
const rem = 16; 

// Now you can do the math right in the function call!
// E.g., 25rem wide and 37.5rem tall
figma.showUI(__html__, { width: 30 * rem, height: 42.5 * rem });

const IS_DEV_BUILD = true;

function postRuntimeConfig() {
    figma.ui.postMessage({
        type: 'runtime-config',
        isDevBuild: IS_DEV_BUILD,
        enableDevTools: IS_DEV_BUILD
    });
}

postRuntimeConfig();

// 1. Analyze Selection and Send Font to UI
function checkSelection() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        figma.ui.postMessage({ type: 'status', message: 'Please select a text layer.' });
        return;
    }

    const node = selection[0];
    if (node.type!== 'TEXT') {
        figma.ui.postMessage({ type: 'status', message: `Expected TEXT layer, but selected ${node.type}.` });
        return;
    }
    if (node.fontName === figma.mixed) {
        figma.ui.postMessage({ type: 'status', message: 'Multiple fonts detected in selection.' });
        return;
    }

    const textRange = figma.currentPage.selectedTextRange;
    let selectedChar = null;
    let cursorPosition = null;
    let isEditing = false;
    let selectionStart = null;
    let selectionEnd = null;

    if (textRange && textRange.node === node) {
        isEditing = true;
        const { start, end } = textRange;
        selectionStart = start;
        selectionEnd = end;
        cursorPosition = end;

        const characters = node.characters;
        if (start === end) {
            // Caret: use char before caret, or after if at position 0
            let index = -1;
            if (end > 0) {
                index = end - 1;
            } else if (characters.length > 0) {
                index = 0;
            }
            if (index >= 0 && index < characters.length) {
                selectedChar = characters.substring(index, index + 1);
            }
        } else {
            const rangeText = characters.substring(start, end);
            if (rangeText.length === 1) {
                selectedChar = rangeText;
            } else if (rangeText.length > 1) {
                selectedChar = 'multiple';
            }
        }
    }

    figma.ui.postMessage({
        type: 'font-selected',
        family: node.fontName.family,
        style: node.fontName.style,
        selectedChar,
        cursorPosition,
        isEditing,
        selectionStart,
        selectionEnd
    });
}

let selectionSyncQueued = false;

function queueSelectionSync() {
    if (selectionSyncQueued) return;
    selectionSyncQueued = true;
    setTimeout(() => {
        selectionSyncQueued = false;
        checkSelection();
    }, 0);
}

function getSelectionSignature() {
    const selection = figma.currentPage.selection;
    if (selection.length !== 1) return 'none';

    const node = selection[0];
    if (node.type !== 'TEXT') return `node:${node.id}:${node.type}`;
    if (node.fontName === figma.mixed) return `text:${node.id}:mixed`;

    const range = figma.currentPage.selectedTextRange;
    const rangeKey = range && range.node === node ? `${range.start}-${range.end}` : 'na';
    return `text:${node.id}:${node.fontName.family}:${node.fontName.style}:${rangeKey}`;
}

figma.on('selectionchange', queueSelectionSync);

let lastSelectionSignature = '';
const selectionPollIntervalMs = 250;
const selectionPoller = setInterval(() => {
    const nextSignature = getSelectionSignature();
    if (nextSignature !== lastSelectionSignature) {
        lastSelectionSignature = nextSignature;
        queueSelectionSync();
    }
}, selectionPollIntervalMs);

figma.on('close', () => {
    clearInterval(selectionPoller);
});

checkSelection();
lastSelectionSignature = getSelectionSignature();

function formatStylisticSetDisplay(ssTag, ssLabel) {
    const cleanTag = typeof ssTag === 'string' ? ssTag.toLowerCase() : '';
    const cleanLabel = typeof ssLabel === 'string' ? ssLabel.trim() : '';
    if (/^ss\d{2}$/.test(cleanTag)) {
        const setNumber = Number.parseInt(cleanTag.slice(2), 10);
        const normalizedSet = `set ${setNumber}`;
        const normalizedLabel = cleanLabel.toLowerCase().replace(/[.\s]+/g, ' ').trim();
        if (cleanLabel) {
            if (
                normalizedLabel === normalizedSet ||
                normalizedLabel === `set${setNumber}` ||
                normalizedLabel === cleanTag
            ) {
                return `Set ${setNumber}`;
            }
            return `Set ${setNumber}. ${cleanLabel}`;
        }
        return `Set ${setNumber} (${cleanTag.toUpperCase()})`;
    }
    if (cleanLabel) return cleanLabel;
    if (cleanTag) return cleanTag.toUpperCase();
    return 'stylistic set';
}

function notifyStylisticSetHint(ssTag, ssLabel) {
    const display = formatStylisticSetDisplay(ssTag, ssLabel);
    const message = `Enable ${display} in Text > Type to view this alternate.`;
    figma.ui.postMessage({
        type: 'stylistic-set-hint',
        message,
        ssTag,
        ssLabel,
        enableLabel: display
    });
}

// 2. Listen for User Clicks and insert glyphs into the selected text layer
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'request-runtime-config') {
        postRuntimeConfig();
        return;
    }

    // --- NEW: Listen for the Smart Boot-up size ---
    if (msg.type === 'smart-resize') {
        figma.ui.resize(msg.width, msg.height);
        return;
    }

    if (msg.type === 'insert-glyph') {
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
            figma.notify('Please select a text layer.');
            return;
        }

        const node = selection[0];
        if (node.type !== 'TEXT') {
            figma.notify('Selection is not a text layer.');
            return;
        }
        if (node.fontName === figma.mixed) {
            figma.notify('Selected text layer has mixed fonts; cannot safely insert glyph.');
            return;
        }

        if (msg.unicode == null || !Number.isFinite(msg.unicode)) {
            figma.notify('Invalid glyph code provided.');
            return;
        }

        // Ensure the node's font is loaded
        await figma.loadFontAsync(node.fontName);

        const glyphChar = String.fromCodePoint(msg.unicode);
        const textRange = figma.currentPage.selectedTextRange;

        if (textRange && textRange.node === node) {
            const { start, end } = textRange;
            const before = node.characters.substring(0, start);
            const after = node.characters.substring(end);
            node.characters = before + glyphChar + after;

            const newPos = start + glyphChar.length;
            figma.currentPage.selectedTextRange = {
                node,
                start: newPos,
                end: newPos
            };
            figma.currentPage.selection = [node];
        } else {
            // Non-edit mode: append at end (existing behavior)
            node.characters = node.characters + glyphChar;
            figma.currentPage.selection = [node];
        }
    }

    if (msg.type === 'replace-glyph') {
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
            figma.notify('Please select a text layer.');
            return;
        }

        const node = selection[0];
        if (node.type !== 'TEXT') {
            figma.notify('Selection is not a text layer.');
            return;
        }
        if (node.fontName === figma.mixed) {
            figma.notify('Selected text layer has mixed fonts; cannot safely insert glyph.');
            return;
        }

        await figma.loadFontAsync(node.fontName);

        if (msg.unicode == null || !Number.isFinite(msg.unicode)) {
            figma.notify('Invalid glyph code provided.');
            return;
        }

        const glyphChar = String.fromCodePoint(msg.unicode);
        const textRange = figma.currentPage.selectedTextRange;

        let start = msg.start;
        let end = msg.end;

        if (typeof msg.position === 'number') {
            start = msg.position;
            end = msg.position;
        } else if ((start === undefined || end === undefined) && textRange && textRange.node === node) {
            start = textRange.start;
            end = textRange.end;
        }

        if (typeof start !== 'number' || typeof end !== 'number') {
            // Fallback: append at end
            node.characters = node.characters + glyphChar;
            figma.currentPage.selection = [node];
            if (msg.isStylisticAlternate) {
                notifyStylisticSetHint(msg.ssTag, msg.ssLabel);
            }
            return;
        }

        const before = node.characters.substring(0, start);
        const after = node.characters.substring(end);
        node.characters = before + glyphChar + after;

        const newPos = start + glyphChar.length;
        figma.currentPage.selectedTextRange = {
            node,
            start: newPos,
            end: newPos
        };
        figma.currentPage.selection = [node];

        if (msg.isStylisticAlternate) {
            notifyStylisticSetHint(msg.ssTag, msg.ssLabel);
        }
    }
};