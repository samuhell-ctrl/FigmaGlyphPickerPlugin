const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { startServer, stopServer } = require('./server');
const { autoUpdater } = require('electron-updater');

let tray = null;
let serverStarted = false;
let quitting = false;

async function createTrayAndServer() {
  try {
    await startServer();
    serverStarted = true;
  } catch (err) {
    console.error('Failed to start Express server:', err);
  }

  // 1. Load the image
  const iconPath = path.join(__dirname, 'icon.png'); 
  let icon = nativeImage.createFromPath(iconPath);

  // 2. Resize and crop so the tray icon is a compact square that matches the menu bar height.
  const targetSize = 18; // roughly the macOS menu bar icon height
  icon = icon.resize({ height: targetSize });

  // If the source image is wide, crop it to a centered square so it doesn't take extra width
  const size = icon.getSize();
  if (size.width > size.height) {
    const x = Math.floor((size.width - size.height) / 2);
    icon = icon.crop({ x, y: 0, width: size.height, height: size.height });
  }

  // 'isTemplate: true' lets macOS handle dark/light mode automatically
  icon.setTemplateImage(true);

  try {
    // 3. Create the tray with the resized icon
    tray = new Tray(icon);
  } catch (e) {
    console.warn('Tray icon could not be created', e);
    return;
  }

  // ... rest of your contextMenu code
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Status: Running on Port 3000', enabled: false },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.setToolTip('Figma Glyph Font Server');
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  // --- NEW: Auto-Launch at Login ---
  // This tells macOS (and Windows) to open the app automatically on startup
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe') // Ensures the correct app path is registered
  });

  createTrayAndServer();
});

// Keep the app alive even though there are no windows; tray keeps it running.
app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', async (event) => {
  if (quitting) {
    return;
  }

  if (serverStarted) {
    event.preventDefault();
    quitting = true;
    try {
      await stopServer();
    } catch (err) {
      console.error('Error while stopping server on before-quit:', err);
    } finally {
      app.exit(0);
    }
  }
});

