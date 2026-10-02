const { app, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { startServer, stopServer } = require('./server');
const { autoUpdater } = require('electron-updater');

const RELEASES_URL = 'https://github.com/samuhell-ctrl/FigmaGlyphPickerPlugin/releases/latest';

// Squirrel.Mac refuses to apply an update to an unsigned app, and the mac
// builds run with CSC_IDENTITY_AUTO_DISCOVERY disabled. Until the app is
// signed, macOS gets a link to the release page instead of a silent update.
const CAN_SELF_UPDATE = process.platform === 'win32' && app.isPackaged;

let tray = null;
let serverStarted = false;
let quitting = false;

// idle | checking | downloading | downloaded | error
let updateState = 'idle';
let updateDetail = '';

function buildMenuTemplate() {
  const items = [
    { label: `Figma Glyph Font Server ${app.getVersion()}`, enabled: false },
    {
      label: serverStarted ? 'Status: Running on port 3000' : 'Status: NOT running',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Rescan fonts',
      click: async () => {
        // Same endpoint the plugin hits on a lookup miss.
        try {
          const res = await fetch('http://localhost:3000/rescan');
          const data = await res.json();
          updateDetail = `Rescan added ${data.added} style(s)`;
        } catch {
          updateDetail = 'Rescan failed - is the server running?';
        }
        rebuildMenu();
      }
    },
    { type: 'separator' }
  ];

  if (updateState === 'checking') {
    items.push({ label: 'Checking for updates...', enabled: false });
  } else if (updateState === 'downloading') {
    items.push({ label: `Downloading update ${updateDetail}`, enabled: false });
  } else if (updateState === 'downloaded') {
    items.push({
      label: `Restart to install ${updateDetail}`,
      click: () => restartAndInstall()
    });
  } else {
    items.push({
      label: 'Check for updates',
      click: () => checkForUpdates(true)
    });
    if (updateState === 'error' && updateDetail) {
      items.push({ label: updateDetail, enabled: false });
    }
  }

  items.push({ type: 'separator' });
  items.push({ label: 'Quit', click: () => app.quit() });
  return items;
}

function rebuildMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
}

function setUpdateState(state, detail = '') {
  updateState = state;
  updateDetail = detail;
  rebuildMenu();
}

function checkForUpdates(userInitiated) {
  if (!CAN_SELF_UPDATE) {
    // Unsigned mac build, or running unpackaged in development.
    if (userInitiated) shell.openExternal(RELEASES_URL);
    return;
  }

  setUpdateState('checking');
  autoUpdater.checkForUpdates().catch((err) => {
    setUpdateState('error', `Update check failed: ${err.message}`);
  });
}

async function restartAndInstall() {
  // before-quit would normally stop the server and call app.exit(), which
  // would skip the installer. Shut down first, then hand over to Squirrel.
  if (serverStarted) {
    try {
      await stopServer();
    } catch (err) {
      console.error('Error stopping server before update install:', err);
    }
    serverStarted = false;
  }
  quitting = true;
  autoUpdater.quitAndInstall();
}

function wireAutoUpdater() {
  if (!CAN_SELF_UPDATE) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    setUpdateState('downloading', `v${info.version}`);
  });
  autoUpdater.on('update-not-available', () => {
    setUpdateState('idle');
  });
  autoUpdater.on('download-progress', (p) => {
    setUpdateState('downloading', `${Math.round(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState('downloaded', `v${info.version}`);
  });
  autoUpdater.on('error', (err) => {
    setUpdateState('error', `Update failed: ${err.message}`);
  });

  checkForUpdates(false);
  // A tray app can run for weeks, so keep checking.
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
}

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

  tray.setToolTip(`Figma Glyph Font Server ${app.getVersion()}`);
  rebuildMenu();

  wireAutoUpdater();
}

app.whenReady().then(() => {
  // Auto-launch at login. On macOS the login item must point at the .app
  // bundle, and Electron resolves that itself - passing app.getPath('exe')
  // registers the inner Mach-O binary instead, which does not work.
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: true });
  } else {
    app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe') });
  }

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
