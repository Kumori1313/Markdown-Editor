const { contextBridge, ipcRenderer } = require('electron');
// prosemirror-view AND prosemirror-tables both access the DOM at module-load
// time, so they (and everything that depends on them) must be required lazily
// inside initProseMirror, which is called from DOMContentLoaded.
const { EditorState }    = require('prosemirror-state');
const { Schema }         = require('prosemirror-model');
const { schema: basicSchema, marks: basicMarks } = require('prosemirror-schema-basic');
const { addListNodes }   = require('prosemirror-schema-list');
const { MarkdownParser, MarkdownSerializer, defaultMarkdownSerializer } = require('prosemirror-markdown');
const { history, undo, redo } = require('prosemirror-history');
const { keymap }         = require('prosemirror-keymap');
const { baseKeymap }     = require('prosemirror-commands');
const MarkdownIt         = require('markdown-it');

let mdSchema     = null;
let mdParser     = null;
let mdSerializer = null;
let pmView          = null;
let pmChangeCallback = null;

function initProseMirror(container) {
  // Lazy: DOM (and document.body) is guaranteed to exist here.
  const { EditorView }                          = require('prosemirror-view');
  const { tableNodes, tableEditing, goToNextCell } = require('prosemirror-tables');

  // ---------------------------------------------------------------------------
  // Schema: basic nodes + GFM table nodes
  // ---------------------------------------------------------------------------
  const nodesWithLists = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
  mdSchema = new Schema({
    nodes: nodesWithLists.append(
      tableNodes({ tableGroup: 'block', cellContent: 'block+' })
    ),
    marks: basicMarks,
  });

  // ---------------------------------------------------------------------------
  // Markdown parser with GFM table support
  // ---------------------------------------------------------------------------
  mdParser = new MarkdownParser(
    mdSchema,
    new MarkdownIt('commonmark', { html: false }).enable('table'),
    {
      blockquote:    { block: 'blockquote' },
      paragraph:     { block: 'paragraph' },
      list_item:     { block: 'list_item' },
      bullet_list:   { block: 'bullet_list' },
      ordered_list:  { block: 'ordered_list', getAttrs: tok => ({ order: +tok.attrGet('start') || 1 }) },
      heading:       { block: 'heading',      getAttrs: tok => ({ level: +tok.tag.slice(1) }) },
      code_block:    { block: 'code_block',   noCloseToken: true },
      fence:         { block: 'code_block',   noCloseToken: true, getAttrs: tok => ({ params: tok.info || '' }) },
      hr:            { node:  'horizontal_rule' },
      image:         { node:  'image', getAttrs: tok => ({
        src:   tok.attrGet('src'),
        alt:   (tok.children[0] && tok.children[0].content) || null,
        title: tok.attrGet('title') || null,
      }) },
      hardbreak:     { node:  'hard_break' },
      em:            { mark:  'em' },
      strong:        { mark:  'strong' },
      link:          { mark:  'link', getAttrs: tok => ({
        href:  tok.attrGet('href'),
        title: tok.attrGet('title') || null,
      }) },
      code_inline:   { mark:  'code', noCloseToken: true },
      table: { block: 'table' },
      tr:    { block: 'table_row' },
      th:    { block: 'table_header' },
      td:    { block: 'table_cell' },
    }
  );

  // prosemirror-tables cells need block+ content (a paragraph wrapper).
  mdParser.tokenHandlers['th_open']  = (s) => { s.openNode(mdSchema.nodes.table_header, {}); s.openNode(mdSchema.nodes.paragraph, {}); };
  mdParser.tokenHandlers['th_close'] = (s) => { s.closeNode(); s.closeNode(); };
  mdParser.tokenHandlers['td_open']  = (s) => { s.openNode(mdSchema.nodes.table_cell, {});   s.openNode(mdSchema.nodes.paragraph, {}); };
  mdParser.tokenHandlers['td_close'] = (s) => { s.closeNode(); s.closeNode(); };
  ['thead_open','thead_close','tbody_open','tbody_close'].forEach(t => {
    mdParser.tokenHandlers[t] = () => {};
  });

  // ---------------------------------------------------------------------------
  // Markdown serializer with GFM table support
  // ---------------------------------------------------------------------------
  mdSerializer = new MarkdownSerializer(
    {
      ...defaultMarkdownSerializer.nodes,
      table(state, node) {
        let firstRow = true;
        node.forEach(row => {
          const cells = [];
          row.forEach(cell => {
            // Render cell content in isolation by saving/restoring state.out.
            // Do NOT touch state.atBlank — it is a method in modern
            // prosemirror-markdown and overwriting it corrupts the serializer.
            const savedOut = state.out;
            state.out = '';
            if (cell.firstChild) state.renderInline(cell.firstChild);
            cells.push(' ' + state.out.trim() + ' ');
            state.out = savedOut;
          });
          state.write('|' + cells.join('|') + '|\n');
          if (firstRow && row.firstChild && row.firstChild.type.name === 'table_header') {
            state.write('|' + cells.map(() => ' --- ').join('|') + '|\n');
          }
          firstRow = false;
        });
        state.closeBlock(node);
      },
      table_row:    () => {},
      table_header: () => {},
      table_cell:   () => {},
    },
    defaultMarkdownSerializer.marks
  );

  // ---------------------------------------------------------------------------
  // Build plugins and create the EditorView
  // ---------------------------------------------------------------------------
  const plugins = [
    history(),
    tableEditing(),
    keymap({
      'Mod-z':       undo,
      'Mod-y':       redo,
      'Mod-Shift-z': redo,
      'Tab':         goToNextCell(1),
      'Shift-Tab':   goToNextCell(-1),
    }),
    keymap(baseKeymap),
  ];

  const state = EditorState.create({ schema: mdSchema, plugins });
  pmView = new EditorView(container, {
    state,
    dispatchTransaction(tr) {
      const newState = pmView.state.apply(tr);
      pmView.updateState(newState);
      if (tr.docChanged && pmChangeCallback) pmChangeCallback();
    },
  });
}

window.addEventListener('DOMContentLoaded', () => {
  initProseMirror(document.getElementById('preview'));
});

// ---------------------------------------------------------------------------
// IPC bridge
// ---------------------------------------------------------------------------
contextBridge.exposeInMainWorld('api', {
  onFileOpened:     (cb) => ipcRenderer.on('file-opened',      (_e, data) => cb(data)),
  onMenuSave:       (cb) => ipcRenderer.on('menu-save',        () => cb()),
  onMenuSaveAs:     (cb) => ipcRenderer.on('menu-save-as',     () => cb()),
  onMenuToggleView: (cb) => ipcRenderer.on('menu-toggle-view', () => cb()),

  saveFile:   (content, filePath) => ipcRenderer.invoke('save-file',    { content, filePath }),
  saveFileAs: (content)           => ipcRenderer.invoke('save-file-as', { content }),

  setEditorContent: (markdown) => {
    if (!pmView) return;
    const doc = mdParser.parse(markdown);
    pmView.updateState(EditorState.create({ doc, plugins: pmView.state.plugins }));
  },
  getEditorContent: () => {
    if (!pmView) return '';
    try {
      return mdSerializer.serialize(pmView.state.doc);
    } catch (err) {
      console.error('[preload] serialize failed:', err);
      return '';
    }
  },
  onPMChange:    (cb) => { pmChangeCallback = cb; },
  focusPMEditor: ()   => { if (pmView) pmView.focus(); },
});
