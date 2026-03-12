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
    }
};