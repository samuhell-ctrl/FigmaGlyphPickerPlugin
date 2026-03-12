const { app, Tray, Menu } = require('electron');
const path = require('path');
const { startServer, stopServer } = require('./server');

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

  const iconPath = path.join(__dirname, 'icon.png'); // Provide your own icon file
  try {
    tray = new Tray(iconPath);
  } catch (e) {
    console.warn('Tray icon could not be created, falling back to app without tray.', e);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Status: Running on Port 3000',
      enabled: false,
    },
    {
      label: 'Quit',
      click: async () => {
        if (quitting) return;
        quitting = true;
        try {
          if (serverStarted) {
            await stopServer();
          }
        } catch (err) {
          console.error('Error while stopping Express server:', err);
        } finally {
          app.quit();
        }
      },
    },
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

