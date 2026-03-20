const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const fontSelect = document.getElementById('font-select');
const fileName = document.getElementById('file-name');
const modeBadge = document.getElementById('mode-badge');
const encodingSelect = document.getElementById('encoding-select');
const lineEndingSelect = document.getElementById('line-ending-select');
const fileTypeLabel = document.getElementById('file-type-label');
const modifiedLabel = document.getElementById('modified-label');

let currentFilePath = null;
let currentFileType = 'md';
let currentEncoding = 'UTF-8';
let isModified = false;
let isPreview = false;
let savedSelectionStart = 0;
let savedScrollTop = 0;

// --- Font switching ---

const fontFamilies = {
  sans: 'var(--font-sans)',
  serif: 'var(--font-serif)',
  mono: 'var(--font-mono)',
};

fontSelect.addEventListener('change', () => {
  const family = fontFamilies[fontSelect.value];
  editor.style.fontFamily = family;
  preview.style.fontFamily = family;
});

// --- View toggle ---

function toggleView() {
  // WYSIWYG is only available for Markdown files
  if (currentFileType === 'txt') return;

  isPreview = !isPreview;
  if (isPreview) {
    savedSelectionStart = editor.selectionStart;
    savedScrollTop = editor.scrollTop;
    window.api.setEditorContent(editor.value);
    editor.style.display = 'none';
    preview.style.display = '';
    modeBadge.textContent = 'WYSIWYG';
    modeBadge.classList.add('preview-mode');
    window.api.focusPMEditor();
  } else {
    editor.value = window.api.getEditorContent();
    preview.style.display = 'none';
    editor.style.display = '';
    const pos = Math.min(savedSelectionStart, editor.value.length);
    editor.setSelectionRange(pos, pos);
    editor.scrollTop = savedScrollTop;
    modeBadge.textContent = 'RAW';
    modeBadge.classList.remove('preview-mode');
    editor.focus();
  }
}

window.api.onMenuToggleView(toggleView);

// --- Modified tracking ---

editor.addEventListener('input', () => {
  if (!isModified) {
    isModified = true;
    modifiedLabel.textContent = 'Modified';
  }
});

window.api.onPMChange(() => {
  if (!isModified) {
    isModified = true;
    modifiedLabel.textContent = 'Modified';
  }
});

function setClean() {
  isModified = false;
  modifiedLabel.textContent = '';
}

// --- File type helpers ---

function setFileType(type) {
  currentFileType = type;
  fileTypeLabel.textContent = type === 'txt' ? 'TXT' : 'MD';

  // Force back to raw mode when switching to plaintext
  if (type === 'txt' && isPreview) {
    editor.value = window.api.getEditorContent();
    preview.style.display = 'none';
    editor.style.display = '';
    isPreview = false;
    modeBadge.textContent = 'RAW';
    modeBadge.classList.remove('preview-mode');
  }

  // Hide the mode badge for plaintext since WYSIWYG is unavailable
  modeBadge.style.display = type === 'txt' ? 'none' : '';
}

// --- Encoding re-decode ---

encodingSelect.addEventListener('change', async () => {
  if (!currentFilePath) return;

  // Force back to raw mode before re-decoding — Markdown round-tripping
  // through ProseMirror can drop characters that don't survive serialization.
  if (isPreview) {
    editor.value = window.api.getEditorContent();
    preview.style.display = 'none';
    editor.style.display = '';
    isPreview = false;
    modeBadge.textContent = 'RAW';
    modeBadge.classList.remove('preview-mode');
  }

  const result = await window.api.reDecodeFile(encodingSelect.value);
  if (result.success) {
    currentEncoding = encodingSelect.value;
    editor.value = result.content;
    lineEndingSelect.value = result.lineEnding;
    setClean();
  } else {
    alert(`Re-decode failed:\n${result.error}`);
    encodingSelect.value = currentEncoding;
  }
});

// --- File open ---

window.api.onFileOpened(({ content, filePath, encoding, lineEnding, fileType }) => {
  editor.value = content;
  currentFilePath = filePath;
  fileName.textContent = filePath.split(/[\\/]/).pop();
  setClean();

  // Set encoding dropdown — add option if not already present
  const encodingExists = Array.from(encodingSelect.options).some(o => o.value === encoding);
  if (!encodingExists) {
    const opt = document.createElement('option');
    opt.value = encoding;
    opt.textContent = encoding;
    encodingSelect.appendChild(opt);
  }
  encodingSelect.value = encoding;
  currentEncoding = encoding;

  lineEndingSelect.value = lineEnding || 'LF';
  setFileType(fileType || 'md');

  if (isPreview && currentFileType === 'md') {
    window.api.setEditorContent(content);
  }
});

// --- Save ---

function getContent() {
  return isPreview ? window.api.getEditorContent() : editor.value;
}

async function save() {
  if (!currentFilePath) {
    await saveAs();
    return;
  }
  const result = await window.api.saveFile(
    getContent(),
    currentFilePath,
    encodingSelect.value,
    lineEndingSelect.value,
  );
  if (result.success) {
    setClean();
  } else {
    alert(`Save failed:\n${result.error}`);
  }
}

async function saveAs() {
  const result = await window.api.saveFileAs(
    getContent(),
    encodingSelect.value,
    lineEndingSelect.value,
    currentFileType,
  );
  if (result.success) {
    currentFilePath = result.filePath;
    fileName.textContent = result.filePath.split(/[\\/]/).pop();
    setFileType(result.fileType || 'md');
    setClean();
  } else if (!result.canceled) {
    alert(`Save failed:\n${result.error}`);
  }
}

window.api.onMenuSave(save);
window.api.onMenuSaveAs(saveAs);
