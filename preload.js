const { contextBridge, ipcRenderer } = require('electron');
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({ linkify: true, typographer: true });

contextBridge.exposeInMainWorld('api', {
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (_e, data) => cb(data)),
  onMenuSave: (cb) => ipcRenderer.on('menu-save', () => cb()),
  onMenuSaveAs: (cb) => ipcRenderer.on('menu-save-as', () => cb()),
  onMenuToggleView: (cb) => ipcRenderer.on('menu-toggle-view', () => cb()),
  saveFile: (content, filePath) => ipcRenderer.invoke('save-file', { content, filePath }),
  saveFileAs: (content) => ipcRenderer.invoke('save-file-as', { content }),
  renderMarkdown: (text) => md.render(text),
});
