const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const chardet = require('chardet');
const iconv = require('iconv-lite');

let mainWindow;

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
  mainWindow.webContents.openDevTools();
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
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) return;

  const filePath = result.filePaths[0];
  try {
    const buffer = fs.readFileSync(filePath);
    const encoding = chardet.detect(buffer) || 'UTF-8';
    const content = iconv.decode(buffer, encoding);
    mainWindow.webContents.send('file-opened', { content, filePath, encoding });
  } catch (err) {
    dialog.showErrorBox('Open Error', `Could not open file:\n${err.message}`);
  }
}

ipcMain.handle('save-file', async (_event, { content, filePath }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-file-as', async (_event, { content }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled) return { success: false, canceled: true };

  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { success: true, filePath: result.filePath };
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
