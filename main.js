const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const chardet = require('chardet');
const iconv = require('iconv-lite');

const LARGE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

let mainWindow;
let lastFileBuffer = null; // kept for re-decode when user changes encoding

function detectLineEnding(text) {
  if (text.includes('\r\n')) return 'CRLF';
  if (text.includes('\r'))   return 'CR';
  return 'LF';
}

function normalizeToLF(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function applyLineEnding(text, ending) {
  const lf = normalizeToLF(text);
  if (ending === 'CRLF') return lf.replace(/\n/g, '\r\n');
  if (ending === 'CR')   return lf.replace(/\n/g, '\r');
  return lf;
}

function fileTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt') return 'txt';
  return 'md';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile('index.html');
  if (!app.isPackaged) mainWindow.webContents.openDevTools();

  // Intercept Ctrl+M before it reaches the renderer or native menu.
  // Menu accelerators can fail when contenteditable (ProseMirror) has focus;
  // before-input-event fires reliably regardless of focused element.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'm') {
      event.preventDefault();
      mainWindow.webContents.send('menu-toggle-view');
    }
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: openFile },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu-save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-save-as') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Raw / WYSIWYG',
          accelerator: 'CmdOrCtrl+M',
          registerAccelerator: false,
          click: () => mainWindow.webContents.send('menu-toggle-view'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Supported Files', extensions: ['md', 'markdown', 'txt'] },
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) return;

  const filePath = result.filePaths[0];
  try {
    const buffer = fs.readFileSync(filePath);

    // Large file warning
    if (buffer.length > LARGE_FILE_BYTES) {
      const mb = (buffer.length / (1024 * 1024)).toFixed(1);
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Open Anyway', 'Cancel'],
        defaultId: 1,
        title: 'Large File',
        message: `This file is ${mb} MB. Large files may slow down the editor. Open anyway?`,
      });
      if (response === 1) return;
    }

    const encoding = chardet.detect(buffer) || 'UTF-8';
    const content = iconv.decode(buffer, encoding);
    lastFileBuffer = buffer;
    const lineEnding = detectLineEnding(content);
    const fileType = fileTypeFromPath(filePath);
    mainWindow.webContents.send('file-opened', { content: normalizeToLF(content), filePath, encoding, lineEnding, fileType });
  } catch (err) {
    lastFileBuffer = null;
    dialog.showErrorBox('Open Error', `Could not open file:\n${err.message}`);
  }
}

// Re-decode the last opened file with a different encoding
ipcMain.handle('re-decode-file', async (_event, { encoding }) => {
  if (!lastFileBuffer) return { success: false, error: 'No file buffer available' };
  try {
    const content = iconv.decode(lastFileBuffer, encoding);
    const lineEnding = detectLineEnding(content);
    return { success: true, content: normalizeToLF(content), lineEnding };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-file', async (_event, { content, filePath, encoding, lineEnding }) => {
  try {
    const finalContent = applyLineEnding(content, lineEnding || 'LF');
    const enc = encoding || 'UTF-8';
    const buffer = iconv.encode(finalContent, enc);
    fs.writeFileSync(filePath, buffer);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-file-as', async (_event, { content, encoding, lineEnding, fileType }) => {
  const mdFirst = fileType !== 'txt';
  const filters = mdFirst
    ? [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'Text', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ]
    : [
        { name: 'Text', extensions: ['txt'] },
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] },
      ];

  const result = await dialog.showSaveDialog(mainWindow, { filters });

  if (result.canceled) return { success: false, canceled: true };

  try {
    const finalContent = applyLineEnding(content, lineEnding || 'LF');
    const enc = encoding || 'UTF-8';
    const buffer = iconv.encode(finalContent, enc);
    fs.writeFileSync(result.filePath, buffer);
    const newFileType = fileTypeFromPath(result.filePath);
    return { success: true, filePath: result.filePath, fileType: newFileType };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
