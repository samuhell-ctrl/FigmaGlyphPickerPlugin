/* =============================================================================
   PLUGIN MAIN THREAD — STARTER
   Pairs with templates/ui.src.html. Handles the kit's built-in messages
   (settings persistence + resize) plus your own.
   ============================================================================= */

const UI = { width: 300, height: 480 };

// themeColors: true makes Figma add .figma-light / .figma-dark to <html> and
// inject --figma-color-* variables. The kit reads both.
figma.showUI(__html__, { ...UI, themeColors: true });

/* ---------------------------- kit plumbing -------------------------------- */

async function readSettings(keys = []) {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await figma.clientStorage.getAsync(key)])
  );
  return Object.fromEntries(entries.filter(([, v]) => v !== undefined));
}

/* ---------------------------- message router ------------------------------ */

figma.ui.onmessage = async (msg) => {
  const { type, payload = {} } = msg ?? {};

  switch (type) {
    case "kit:get-settings":
      figma.ui.postMessage({ type: "kit:settings", payload: await readSettings(payload.keys) });
      return;

    case "kit:set-setting":
      await figma.clientStorage.setAsync(payload.key, payload.value);
      return;

    case "kit:resize":
      figma.ui.resize(
        Math.max(240, Math.round(payload.width)),
        Math.max(120, Math.min(1000, Math.round(payload.height)))
      );
      return;

    /* ------------------------- your handlers --------------------------- */

    case "item:pick":
      // insert / apply the picked item
      return;

    case "apply":
      try {
        // await doWork(payload);
        figma.ui.postMessage({ type: "done", payload: { message: "Applied" } });
      } catch (error) {
        figma.ui.postMessage({ type: "error", payload: { message: String(error?.message ?? error) } });
      }
      return;

    case "close":
      figma.closePlugin();
      return;
  }
};

/* ---------------------------- selection sync ------------------------------ */

function pushSelection() {
  const nodes = figma.currentPage.selection;
  figma.ui.postMessage({
    type: "status",
    payload: { text: nodes.length ? `${nodes.length} layer${nodes.length > 1 ? "s" : ""} selected` : "" }
  });
}

figma.on("selectionchange", pushSelection);
pushSelection();

/* Writing text on canvas always needs the font loaded first — this is
   unrelated to the UI font and needs no manifest entry:

   const node = figma.createText();
   await figma.loadFontAsync({ family: "Inter", style: "Regular" });
   node.fontName = { family: "Inter", style: "Regular" };
   node.characters = "Hello";
*/
