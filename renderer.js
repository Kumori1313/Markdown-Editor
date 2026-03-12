const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const fontSelect = document.getElementById('font-select');
const fileName = document.getElementById('file-name');
const modeBadge = document.getElementById('mode-badge');
const encodingLabel = document.getElementById('encoding-label');
const modifiedLabel = document.getElementById('modified-label');

let currentFilePath = null;
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

// --- File open ---

window.api.onFileOpened(({ content, filePath, encoding }) => {
  editor.value = content;
  currentFilePath = filePath;
  fileName.textContent = filePath.split(/[\\/]/).pop();
  encodingLabel.textContent = encoding;
  setClean();
  if (isPreview) {
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
  const result = await window.api.saveFile(getContent(), currentFilePath);
  if (result.success) {
    setClean();
  } else {
    alert(`Save failed:\n${result.error}`);
  }
}

async function saveAs() {
  const result = await window.api.saveFileAs(getContent());
  if (result.success) {
    currentFilePath = result.filePath;
    fileName.textContent = result.filePath.split(/[\\/]/).pop();
    setClean();
  } else if (!result.canceled) {
    alert(`Save failed:\n${result.error}`);
  }
}

window.api.onMenuSave(save);
window.api.onMenuSaveAs(saveAs);
