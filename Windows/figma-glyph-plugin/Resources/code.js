// Phase 3: Dynamic Sandbox and Text Insertion
// Define your base rem size (usually 16px)
const rem = 16; 

// Now you can do the math right in the function call!
// E.g., 25rem wide and 37.5rem tall
figma.showUI(__html__, { width: 30 * rem, height: 42.5 * rem });

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

    figma.ui.postMessage({
        type: 'font-selected',
        family: node.fontName.family,
        style: node.fontName.style
    });
}

figma.on('selectionchange', () => {
    checkSelection();
});
checkSelection();

// 2. Listen for User Clicks and insert glyphs into the selected text layer
figma.ui.onmessage = async (msg) => {
    // --- NEW: Listen for the Smart Boot-up size ---
    if (msg.type === 'smart-resize') {
        figma.ui.resize(msg.width, msg.height);
        return;
    }

    if (msg.type === 'insert-glyph') {
        const selection = figma.currentPage.selection;
        // ... (the rest of your insert-glyph code stays the same)

        const node = selection[0];
        if (node.type !== 'TEXT') {
            figma.notify('Selection is not a text layer.');
            return;
        }
        if (node.fontName === figma.mixed) {
            figma.notify('Selected text layer has mixed fonts; cannot safely insert glyph.');
            return;
        }

        // Ensure the node's font is loaded, then append the glyph
        await figma.loadFontAsync(node.fontName);

        const glyphChar = String.fromCodePoint(msg.unicode);
        node.characters = node.characters + glyphChar;

        figma.currentPage.selection = [node];
    }
};