/* NGN 112 PyLab: a Colab-style notebook that runs Python in the browser via Pyodide. */
'use strict';
(() => {
  const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';
  const HOME = '/home/pyodide';
  const SLOT_PREFIX = 'pylab.nb.';
  const CURRENT_KEY = 'pylab.current';
  const SETTINGS_KEY = 'pylab.settings.v1';
  const FIG_DPI = 150;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const readJSON = (k, fallback) => { try { return JSON.parse(store.get(k)) ?? fallback; } catch { return fallback; } };

  const settings = Object.assign({ timeLimit: 60, theme: 'auto', lineNumbers: true }, readJSON(SETTINGS_KEY, {}));
  const saveSettings = () => store.set(SETTINGS_KEY, JSON.stringify(settings));

  const state = {
    slot: 'default', title: 'Untitled', cells: [], selected: null,
    py: null, runner: null, runnerDict: null, gen: 0, ready: null, jspi: false, booted: false,
    queue: [], pumping: false, running: null, stopFlag: false, execCounter: 0,
    pendingInput: null, wakeSleep: null,
    uploads: new Map(), deletedBundled: new Set(),
    lastDeleted: null, saveTimer: null,
  };

  let uidCounter = 0;
  const newId = () => 'c' + Date.now().toString(36) + (uidCounter++).toString(36);
  const ICON = {
    play: '<svg class="ic-play" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
    stop: '<svg class="ic-stop" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
    swap: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6.99 11 3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
    file: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>',
  };

  // ------------------------------------------------------------------ helpers
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const joinText = (v) => (Array.isArray(v) ? v.join('') : (v ?? ''));
  // Let the browser repaint; rAF never fires in a background tab, so cap the wait.
  const nextPaint = () => new Promise((r) => {
    const done = () => { clearTimeout(t); r(); };
    const t = setTimeout(done, 60);
    requestAnimationFrame(() => setTimeout(done, 0));
  });
  const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const sanitize = (html) => (window.DOMPurify ? DOMPurify.sanitize(html, { ADD_TAGS: ['style'], FORCE_BODY: true }) : escapeHtml(html));

  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = '';
    t.append(document.createTextNode(msg));
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.style.cssText = 'margin-left:14px;background:none;border:0;color:#f8b26a;font-weight:600;cursor:pointer';
      b.onclick = () => { t.hidden = true; action.run(); };
      t.append(b);
    }
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 2600);
  }

  function showModal(html, actions = [{ label: 'Close', primary: true }]) {
    const modal = $('#modal');
    $('#modal-body').innerHTML = html;
    const bar = $('#modal-actions');
    bar.innerHTML = '';
    return new Promise((resolve) => {
      const close = (val) => { modal.hidden = true; resolve(val); };
      actions.forEach((a) => {
        const b = document.createElement('button');
        b.className = 'btn' + (a.primary ? ' primary' : '');
        b.textContent = a.label;
        b.onclick = () => { const v = a.onClick ? a.onClick() : a.value; if (v !== false) close(v ?? a.label); };
        bar.append(b);
      });
      modal.onclick = (e) => { if (e.target === modal) close(null); };
      modal.hidden = false;
      const primary = bar.querySelector('.primary');
      if (primary) primary.focus();
    });
  }
  const confirmModal = async (html, okLabel = 'OK') =>
    (await showModal(html, [{ label: 'Cancel', value: false }, { label: okLabel, primary: true, value: true }])) === true;

  function setStatus(kind, text) {
    const el = $('#status');
    el.className = 'status ' + kind;
    $('.status-text', el).textContent = text;
  }
  function refreshStatus() {
    if (!state.booted) return;
    if (state.running) setStatus('busy', 'Running');
    else if (state.queue.length || state.pumping) setStatus('busy', 'Busy');
    else setStatus('ready', 'Ready');
    $('#stop-btn').disabled = !(state.running || state.queue.length);
  }

  // ------------------------------------------------------------- markdown
  function renderMarkdownTo(el, src) {
    const math = [];
    const protectedSrc = src.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/g, (m) => {
      math.push(m);
      return `@@MATH${math.length - 1}@@`;
    });
    let html = window.marked ? marked.parse(protectedSrc) : `<pre>${escapeHtml(protectedSrc)}</pre>`;
    html = sanitize(html).replace(/@@MATH(\d+)@@/g, (_, i) => escapeHtml(math[+i]));
    el.innerHTML = html;
    if (window.renderMathInElement) {
      try {
        renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false },
          ],
          throwOnError: false,
        });
      } catch { /* leave raw */ }
    }
    $$('a', el).forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  }

  // --------------------------------------------------------------- cells
  function makeCell(type, source = '', extra = {}) {
    return {
      id: extra.id || newId(), type, source,
      outputs: extra.outputs || [], execution_count: extra.execution_count ?? null,
      status: 'idle', el: null, cm: null,
    };
  }

  function buildCell(cell) {
    const el = document.createElement('div');
    el.className = `cell ${cell.type}`;
    el.dataset.id = cell.id;
    el.innerHTML = `
      <div class="cell-gutter">${cell.type === 'code'
        ? `<button class="run-btn" title="Run cell (Shift+Enter)">${ICON.play}${ICON.stop}</button><div class="exec-count"></div>`
        : ''}</div>
      <div class="cell-body">
        <div class="editor-wrap"></div>
        ${cell.type === 'markdown' ? '<div class="md-view"></div>' : ''}
        <div class="cell-status"></div>
        <div class="outputs"></div>
        <div class="out-tools"><button class="out-clear" hidden>Clear output</button></div>
      </div>
      <div class="cell-tools">
        <button data-act="up" title="Move up">${ICON.up}</button>
        <button data-act="down" title="Move down">${ICON.down}</button>
        <button data-act="swap" title="${cell.type === 'code' ? 'Convert to text cell' : 'Convert to code cell'}">${ICON.swap}</button>
        <button data-act="delete" title="Delete cell">${ICON.trash}</button>
      </div>`;
    cell.el = el;

    const cm = CodeMirror($('.editor-wrap', el), {
      value: cell.source,
      mode: cell.type === 'code' ? 'python' : 'markdown',
      lineNumbers: cell.type === 'code' && settings.lineNumbers,
      indentUnit: 4, tabSize: 4, indentWithTabs: false,
      matchBrackets: true, autoCloseBrackets: true,
      lineWrapping: cell.type === 'markdown',
      viewportMargin: Infinity,
      extraKeys: {
        'Shift-Enter': () => (cell.type === 'code' ? runAndAdvance(cell) : finishMarkdown(cell, true)),
        'Ctrl-Enter': () => (cell.type === 'code' ? enqueueCell(cell) : finishMarkdown(cell, false)),
        'Cmd-Enter': () => (cell.type === 'code' ? enqueueCell(cell) : finishMarkdown(cell, false)),
        'Alt-Enter': () => { if (cell.type === 'code') enqueueCell(cell); else finishMarkdown(cell, false); insertCell('code', indexOf(cell) + 1); },
        Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ')),
        'Shift-Tab': (c) => c.indentSelection('subtract'),
        'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
        'Ctrl-M B': () => insertCell('code', indexOf(cell) + 1),
        'Ctrl-M A': () => insertCell('code', indexOf(cell)),
        'Ctrl-M D': () => deleteCell(cell),
        'Ctrl-M M': () => { if (cell.type === 'code') convertCell(cell); },
        'Ctrl-M Y': () => { if (cell.type === 'markdown') convertCell(cell); },
        Esc: (c) => c.getInputField().blur(),
      },
    });
    cell.cm = cm;
    cm.on('change', () => { cell.source = cm.getValue(); scheduleSave(); });
    cm.on('focus', () => { selectCell(cell); $('.editor-wrap', el).classList.add('focused'); });
    cm.on('blur', () => {
      $('.editor-wrap', el).classList.remove('focused');
      if (cell.type === 'markdown') {
        setTimeout(() => { if (!el.contains(document.activeElement)) finishMarkdown(cell, false, true); }, 120);
      }
    });

    el.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.cell-tools')) selectCell(cell);
    });
    $$('.cell-tools button', el).forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'up') moveCell(cell, -1);
      else if (act === 'down') moveCell(cell, 1);
      else if (act === 'swap') convertCell(cell);
      else if (act === 'delete') deleteCell(cell);
    }));
    $('.out-clear', el).addEventListener('click', () => { cell.outputs = []; renderOutputs(cell); scheduleSave(); });

    if (cell.type === 'code') {
      $('.run-btn', el).addEventListener('click', () => {
        if (cell.status === 'running' || cell.status === 'queued') stopExecution();
        else enqueueCell(cell);
      });
    } else {
      const view = $('.md-view', el);
      view.addEventListener('dblclick', () => editMarkdown(cell));
      renderMarkdownTo(view, cell.source);
      view.classList.toggle('empty', !cell.source.trim());
    }
    renderOutputs(cell);
    updateGutter(cell);
    return el;
  }

  function editMarkdown(cell) {
    cell.el.classList.add('editing');
    cell.cm.refresh();
    cell.cm.focus();
    cell.cm.setCursor(cell.cm.lineCount(), 0);
  }

  function finishMarkdown(cell, advance, fromBlur = false) {
    if (!cell.el.classList.contains('editing')) return;
    const view = $('.md-view', cell.el);
    renderMarkdownTo(view, cell.source);
    view.classList.toggle('empty', !cell.source.trim());
    cell.el.classList.remove('editing');
    if (advance && !fromBlur) advanceFrom(cell);
  }

  function updateGutter(cell) {
    if (!cell.el) return;
    cell.el.classList.toggle('running', cell.status === 'running');
    cell.el.classList.toggle('queued', cell.status === 'queued');
    const ec = $('.exec-count', cell.el);
    if (ec) {
      ec.textContent = cell.status === 'queued' ? '[*]' : cell.execution_count != null ? `[${cell.execution_count}]` : '[ ]';
      ec.title = cell.lastDuration != null ? `Took ${cell.lastDuration.toFixed(2)} s` : '';
    }
    const rb = $('.run-btn', cell.el);
    if (rb) rb.title = cell.status === 'idle' ? 'Run cell (Shift+Enter)' : 'Interrupt execution';
  }

  function setCellStatus(cell, text) {
    const s = cell.el && $('.cell-status', cell.el);
    if (s) s.textContent = text || '';
  }

  const indexOf = (cell) => state.cells.indexOf(cell);

  function renderCellList() {
    const box = $('#cells');
    const frag = document.createDocumentFragment();
    state.cells.forEach((cell, i) => {
      const add = document.createElement('div');
      add.className = 'add-between';
      add.innerHTML = '<button data-type="code">+ Code</button><button data-type="markdown">+ Text</button>';
      $$('button', add).forEach((b) => b.addEventListener('click', () => insertCell(b.dataset.type, i)));
      frag.append(add);
      if (!cell.el) buildCell(cell);
      frag.append(cell.el);
    });
    box.innerHTML = '';
    box.append(frag);
    state.cells.forEach((c) => c.cm && c.cm.refresh());
  }

  function selectCell(cell) {
    if (state.selected === cell) return;
    if (state.selected && state.selected.el) state.selected.el.classList.remove('selected');
    state.selected = cell;
    if (cell && cell.el) cell.el.classList.add('selected');
  }

  function insertCell(type, index, source = '', focus = true) {
    const cell = makeCell(type, source);
    index = Math.max(0, Math.min(index ?? state.cells.length, state.cells.length));
    state.cells.splice(index, 0, cell);
    renderCellList();
    selectCell(cell);
    if (focus) {
      if (type === 'markdown') editMarkdown(cell);
      else cell.cm.focus();
      cell.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    scheduleSave();
    return cell;
  }

  function deleteCell(cell) {
    const i = indexOf(cell);
    if (i < 0) return;
    if (cell.status === 'running') { toast('Stop the cell before deleting it.'); return; }
    state.queue = state.queue.filter((t) => t.cell !== cell);
    state.cells.splice(i, 1);
    state.lastDeleted = { cell, index: i };
    cell.el.remove();
    if (!state.cells.length) insertCell('code', 0, '', false);
    renderCellList();
    selectCell(state.cells[Math.min(i, state.cells.length - 1)]);
    scheduleSave();
    toast('Cell deleted', { label: 'Undo', run: undoDelete });
  }

  function undoDelete() {
    const d = state.lastDeleted;
    if (!d) return;
    state.lastDeleted = null;
    d.cell.status = 'idle';
    state.cells.splice(Math.min(d.index, state.cells.length), 0, d.cell);
    renderCellList();
    selectCell(d.cell);
    scheduleSave();
  }

  function moveCell(cell, delta) {
    const i = indexOf(cell);
    const j = i + delta;
    if (j < 0 || j >= state.cells.length) return;
    [state.cells[i], state.cells[j]] = [state.cells[j], state.cells[i]];
    renderCellList();
    cell.el.scrollIntoView({ block: 'nearest' });
    scheduleSave();
  }

  function convertCell(cell) {
    if (cell.status !== 'idle') return;
    const i = indexOf(cell);
    const fresh = makeCell(cell.type === 'code' ? 'markdown' : 'code', cell.source);
    state.cells[i] = fresh;
    cell.el.remove();
    renderCellList();
    selectCell(fresh);
    if (fresh.type === 'markdown') editMarkdown(fresh); else fresh.cm.focus();
    scheduleSave();
  }

  function advanceFrom(cell) {
    const next = state.cells[indexOf(cell) + 1];
    if (next) {
      selectCell(next);
      if (next.type === 'code') next.cm.focus();
      else next.el.focus?.();
      next.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      insertCell('code', state.cells.length);
    }
  }

  function runAndAdvance(cell) {
    enqueueCell(cell);
    advanceFrom(cell);
  }

  // -------------------------------------------------------------- outputs
  function renderOutputs(cell) {
    if (!cell.el) return;
    const box = $('.outputs', cell.el);
    box.innerHTML = '';
    cell.outputs.forEach((o) => box.append(renderOutput(o)));
    $('.out-clear', cell.el).hidden = !cell.outputs.length;
  }

  function renderOutput(o) {
    const div = document.createElement('div');
    div.className = 'output ' + o.output_type;
    if (o.output_type === 'stream') {
      const pre = document.createElement('pre');
      pre.className = o.name === 'stderr' ? 'stderr' : 'stdout';
      pre.textContent = o.text;
      Object.defineProperty(o, '_pre', { value: pre, enumerable: false, writable: true, configurable: true });
      div.append(pre);
    } else if (o.output_type === 'error') {
      const pre = document.createElement('pre');
      const tb = (o.traceback || []).map(stripAnsi).join('\n').trimEnd();
      const head = `${o.ename}: ${o.evalue}`;
      if (tb) {
        const idx = tb.lastIndexOf(o.ename);
        if (idx >= 0) {
          pre.append(document.createTextNode(tb.slice(0, idx)));
          const s = document.createElement('span');
          s.className = 'ename';
          s.textContent = o.ename;
          pre.append(s, document.createTextNode(tb.slice(idx + o.ename.length)));
        } else pre.textContent = tb;
      } else {
        pre.innerHTML = `<span class="ename">${escapeHtml(o.ename)}</span>${escapeHtml(head.slice(o.ename.length))}`;
      }
      div.append(pre);
    } else {
      renderMime(div, o.data || {}, o.metadata || {});
    }
    return div;
  }

  function renderMime(div, data, metadata) {
    const png = joinText(data['image/png']);
    const jpg = joinText(data['image/jpeg']);
    if (png || jpg) {
      const img = document.createElement('img');
      img.src = png ? `data:image/png;base64,${png.replace(/\s/g, '')}` : `data:image/jpeg;base64,${jpg.replace(/\s/g, '')}`;
      const meta = metadata[png ? 'image/png' : 'image/jpeg'];
      if (meta && meta.width) img.style.width = `${meta.width}px`;
      img.alt = joinText(data['text/plain']) || 'figure';
      div.append(img);
    } else if (data['image/svg+xml']) {
      const box = document.createElement('div');
      box.innerHTML = sanitize(joinText(data['image/svg+xml']));
      div.append(box);
    } else if (data['text/html']) {
      const box = document.createElement('div');
      box.className = 'html-out';
      box.innerHTML = sanitize(joinText(data['text/html']));
      div.append(box);
    } else if (data['text/markdown']) {
      const box = document.createElement('div');
      box.className = 'md-view';
      renderMarkdownTo(box, joinText(data['text/markdown']));
      div.append(box);
    } else if (data['text/plain'] != null) {
      const pre = document.createElement('pre');
      pre.textContent = stripAnsi(joinText(data['text/plain']));
      div.append(pre);
    }
  }

  function pushOutput(cell, o) {
    cell.outputs.push(o);
    if (!cell.el) return;
    $('.outputs', cell.el).append(renderOutput(o));
    $('.out-clear', cell.el).hidden = false;
  }

  function addStream(cell, name, text) {
    text = stripAnsi(text);
    const last = cell.outputs[cell.outputs.length - 1];
    if (last && last.output_type === 'stream' && last.name === name && last._pre) {
      last.text += text;
      last._pre.append(document.createTextNode(text));
      const pre = last._pre;
      if (pre.scrollHeight > pre.clientHeight) pre.scrollTop = pre.scrollHeight;
    } else {
      pushOutput(cell, { output_type: 'stream', name, text });
    }
  }

  function pngDisplayWidth(b64) {
    try {
      const bytes = atob(b64.slice(0, 44));
      const w = ((bytes.charCodeAt(16) << 24) | (bytes.charCodeAt(17) << 16) | (bytes.charCodeAt(18) << 8) | bytes.charCodeAt(19)) >>> 0;
      return w ? Math.round((w * 100) / FIG_DPI) : null;
    } catch { return null; }
  }

  // ------------------------------------------------- bridge used by Python
  function makeBridge(gen) {
    const live = () => gen === state.gen && state.running;
    const cell = () => state.running && state.running.cell;
    return {
      stream(name, text) { if (live()) addStream(cell(), name, text); },
      display(json, isResult) {
        if (!live()) return;
        const data = JSON.parse(json);
        const metadata = {};
        if (data['image/png']) {
          const w = pngDisplayWidth(data['image/png']);
          if (w) metadata['image/png'] = { width: w };
        }
        const o = isResult
          ? { output_type: 'execute_result', execution_count: state.running.n, data, metadata }
          : { output_type: 'display_data', data, metadata };
        pushOutput(cell(), o);
      },
      error(ename, evalue, tb) {
        if (!live()) return;
        pushOutput(cell(), { output_type: 'error', ename, evalue, traceback: String(tb).split('\n') });
      },
      clearOutput() { if (live()) { cell().outputs = []; renderOutputs(cell()); } },
      requestInput(prompt) {
        return new Promise((resolve) => {
          if (!live() || state.stopFlag) { resolve(null); return; }
          const c = cell();
          const line = document.createElement('div');
          line.className = 'input-line';
          line.innerHTML = '<span class="prompt"></span><input type="text" spellcheck="false" autocomplete="off" aria-label="Program input">';
          $('.prompt', line).textContent = prompt;
          $('.outputs', c.el).append(line);
          const inp = $('input', line);
          state.pendingInput = (value) => { state.pendingInput = null; line.remove(); resolve(value); };
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); state.pendingInput && state.pendingInput(inp.value); }
          });
          inp.focus();
          line.scrollIntoView({ block: 'nearest' });
        });
      },
      promptInput(recent, prompt) {
        const msg = (recent && recent.trim() ? recent.trimEnd() + '\n\n' : '') + (prompt || 'Input:');
        return window.prompt(msg, '');
      },
      yieldNow() {
        // A message task (unlike setTimeout) is not throttled in background tabs.
        return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
      },
      sleep(ms) {
        return new Promise((resolve) => {
          const t = setTimeout(() => { state.wakeSleep = null; resolve(); }, ms);
          state.wakeSleep = () => { clearTimeout(t); state.wakeSleep = null; resolve(); };
        });
      },
      stopRequested() { return state.stopFlag || gen !== state.gen; },
    };
  }

  // ------------------------------------------------------------- runtime
  async function bootPython() {
    const gen = ++state.gen;
    state.booted = false;
    setStatus('loading', 'Starting Python…');
    $('#stop-btn').disabled = true;
    if (!window.loadPyodide) {
      setStatus('error', 'Python failed to load');
      showModal('<h2>Python could not be loaded</h2><p>PyLab downloads Python (Pyodide) from the internet the first time it starts. Check your internet connection and reload the page.</p>');
      throw new Error('pyodide.js not loaded');
    }
    const py = await loadPyodide({ indexURL: PYODIDE_URL });
    if (gen !== state.gen) return;
    setStatus('loading', 'Preparing runtime…');
    await py.loadPackage(['micropip', 'pyodide-http'], { messageCallback: () => {} });
    window.pylabBridge = makeBridge(gen);
    py.FS.mkdirTree('/pylab/data');
    py.FS.writeFile('/pylab/_pylab.py', window.PYLAB_RUNNER_PY);
    const bundled = (window.PYLAB_DATASETS && window.PYLAB_DATASETS.files) || {};
    for (const [name, text] of Object.entries(bundled)) {
      py.FS.writeFile(`/pylab/data/${name}`, text);
      if (!state.deletedBundled.has(name)) py.FS.writeFile(`${HOME}/${name}`, text);
    }
    for (const [name, bytes] of state.uploads) writeHomeFile(py, name, bytes);
    py.runPython('import sys\nif "/pylab" not in sys.path: sys.path.insert(0, "/pylab")\nimport _pylab');
    state.py = py;
    state.runner = py.pyimport('_pylab');
    state.runnerDict = py.runPython('import _pylab; _pylab.__dict__');
    state.jspi = !!(await py.runPythonAsync('detect_jspi()', { globals: state.runnerDict }));
    state.execCounter = 0;
    state.booted = true;
    showModeBadge();
    refreshStatus();
    refreshFiles();
    refreshVars();
  }

  function writeHomeFile(py, name, bytes) {
    const parts = name.split('/');
    if (parts.length > 1) py.FS.mkdirTree(`${HOME}/${parts.slice(0, -1).join('/')}`);
    py.FS.writeFile(`${HOME}/${name}`, bytes);
  }

  function showModeBadge() {
    const b = $('#mode-badge');
    b.hidden = false;
    if (state.jspi) {
      b.textContent = 'Interactive';
      b.title = 'Live output, inline input() boxes and the Stop button are available.';
    } else {
      b.textContent = 'Compatibility mode';
      b.title = `This browser cannot pause Python, so output appears when a cell finishes, input() uses a pop-up window, and cells are stopped after ${settings.timeLimit} s. Use a recent Chrome or Edge for the full experience.`;
    }
  }

  async function micropipInstall(pkgs) {
    const d = state.runnerDict;
    d.set('_pkgs', state.py.toPy(pkgs));
    const res = await state.py.runPythonAsync(
      'import micropip\n_fails = []\nfor _p in _pkgs:\n    try:\n        await micropip.install(pinned(_p))\n    except Exception as _e:\n        _fails.append(_p + ": " + str(_e).splitlines()[0])\n_fails',
      { globals: d });
    const fails = res && res.toJs ? res.toJs() : [];
    if (res && res.destroy) res.destroy();
    return fails;
  }

  function missingModules(code) {
    try {
      const r = state.runner.missing_modules(code);
      const list = r.toJs();
      r.destroy();
      return list;
    } catch { return []; }
  }

  // Translate Colab-style "!pip install" / "%matplotlib" lines, then load libraries.
  async function preparePackages(source, cell) {
    const pip = [];
    const code = source.split('\n').map((line) => {
      const m = line.match(/^(\s*)([!%])(.*)$/);
      if (!m) return line;
      const [, indent, sigil, rest] = m;
      const cmd = rest.trim();
      const pm = cmd.match(/^(?:pip3?|python3?\s+-m\s+pip)\s+install\s+(.+)$/);
      if (pm) {
        pip.push(...pm[1].split(/\s+/).filter((t) => t && !t.startsWith('-')).map((t) => t.replace(/^["']|["']$/g, '')));
        return indent + 'pass';
      }
      if (sigil === '%') return indent + 'pass';   // %matplotlib inline, %%time, ...
      return indent + `print(${JSON.stringify('PyLab: shell commands are not available in the browser: !' + cmd)})`;
    }).join('\n');

    const py = state.py;
    try {
      await py.loadPackagesFromImports(code, {
        messageCallback: (msg) => { if (/^Loading/.test(msg)) setCellStatus(cell, msg.replace(/^Loading/, 'Loading library:') + '…'); },
        errorCallback: (msg) => console.warn(msg),
      });
    } catch (e) { console.warn(e); }
    const wanted = [...pip];
    for (const mod of missingModules(code)) wanted.push(state.runner.pypi_name(mod));
    if (/read_excel|to_excel|ExcelWriter|ExcelFile/.test(code) && !missingImportable('openpyxl')) wanted.push('openpyxl');
    let fails = [];
    if (wanted.length) {
      setCellStatus(cell, `Installing ${[...new Set(wanted)].join(', ')}…`);
      fails = await micropipInstall([...new Set(wanted)]);
    }
    setCellStatus(cell, '');
    return { code, fails };
  }

  function missingImportable(mod) {
    try { return state.py.runPython(`import importlib.util; importlib.util.find_spec(${JSON.stringify(mod)}) is not None`); } catch { return false; }
  }

  async function executeCell(cell) {
    const started = performance.now();
    cell.status = 'running';
    cell.outputs = [];
    renderOutputs(cell);
    updateGutter(cell);
    state.stopFlag = false;
    refreshStatus();
    const n = ++state.execCounter;
    const gen = state.gen;
    let status = 'ok';
    try {
      const { code, fails } = await preparePackages(cell.source, cell);
      state.running = { cell, n };
      fails.forEach((f) => addStream(cell, 'stderr', `PyLab: could not install ${f}\n`));
      refreshStatus();
      await nextPaint();
      if (state.stopFlag) throw new Error('interrupted');
      const d = state.runnerDict;
      d.set('_code', code);
      d.set('_n', n);
      d.set('_limit', state.jspi ? 0 : settings.timeLimit);
      let abort;
      state.abortRun = new Promise((r) => { abort = r; });
      state.abortRun.fire = abort;
      const res = await Promise.race([
        state.py.runPythonAsync('run_cell(_code, _n, _limit)', { globals: d }),
        state.abortRun.then(() => 'aborted'),
      ]);
      status = typeof res === 'string' ? res : 'ok';
    } catch (e) {
      status = 'error';
      if (gen === state.gen && String(e && e.message) !== 'interrupted') {
        state.running = state.running || { cell, n };
        pushOutput(cell, { output_type: 'error', ename: 'PyLabError', evalue: String(e && e.message || e), traceback: [String(e && e.message || e)] });
      } else if (String(e && e.message) === 'interrupted') {
        pushOutput(cell, { output_type: 'error', ename: 'KeyboardInterrupt', evalue: '', traceback: ['KeyboardInterrupt'] });
      }
    } finally {
      state.running = null;
      state.abortRun = null;
      if (state.pendingInput) state.pendingInput(null);
      cell.status = 'idle';
      cell.execution_count = n;
      cell.lastDuration = (performance.now() - started) / 1000;
      setCellStatus(cell, '');
      updateGutter(cell);
      refreshStatus();
      scheduleSave();
      if (gen === state.gen) { refreshFiles(); refreshVars(); }
    }
    return status;
  }

  function enqueueCell(cell) {
    if (cell.type !== 'code' || cell.status !== 'idle') return;
    cell.status = 'queued';
    updateGutter(cell);
    state.queue.push({ cell });
    refreshStatus();
    pump();
  }

  function enqueueTask(fn) {
    state.queue.push({ fn });
    pump();
  }

  async function pump() {
    if (state.pumping) return;
    state.pumping = true;
    try {
      while (state.queue.length) {
        try { await state.ready; } catch { cancelQueue(); break; }
        const task = state.queue.shift();
        if (!task) break;
        if (task.fn) { await task.fn(); continue; }
        if (!state.cells.includes(task.cell) || task.cell.status !== 'queued') continue;
        const status = await executeCell(task.cell);
        if (status !== 'ok') cancelQueue();
      }
    } finally {
      state.pumping = false;
      refreshStatus();
    }
  }

  function cancelQueue() {
    for (const t of state.queue) {
      if (t.cell && t.cell.status === 'queued') { t.cell.status = 'idle'; updateGutter(t.cell); }
    }
    state.queue = state.queue.filter((t) => t.fn && t.keep);
    refreshStatus();
  }

  function stopExecution() {
    cancelQueue();
    if (state.running) {
      state.stopFlag = true;
      if (state.pendingInput) state.pendingInput(null);
      if (state.wakeSleep) state.wakeSleep();
    }
  }

  async function restartRuntime(runAllAfter = false) {
    cancelQueue();
    if (state.running) {
      // Python is busy (or waiting): give it a moment to stop, else start a fresh runtime.
      stopExecution();
      const t0 = performance.now();
      while (state.running && performance.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 50));
    }
    if (state.running || !state.booted) {
      if (state.abortRun) state.abortRun.fire();
      state.ready = bootPython();
      try { await state.ready; } catch { return; }
    } else {
      try { state.runner.reset_namespace(); } catch (e) { console.warn(e); }
      state.execCounter = 0;
    }
    refreshVars();
    toast('Runtime restarted: all variables were cleared.');
    if (runAllAfter) runAll();
  }

  // Pre-load the libraries this notebook imports so the first run is fast.
  function warmup() {
    enqueueTask(async () => {
      if (!state.booted) return;
      const sources = state.cells.filter((c) => c.type === 'code').map((c) => c.source);
      if (!sources.some((s) => /\bimport\b/.test(s))) return;
      setStatus('busy', 'Loading libraries…');
      for (const src of sources) {
        try { await state.py.loadPackagesFromImports(src, { messageCallback: (m) => { if (/^Loading/.test(m)) setStatus('busy', m.slice(0, 60) + '…'); } }); } catch { /* syntax errors etc. */ }
      }
      const extra = new Set();
      sources.forEach((s) => missingModules(s).forEach((m) => extra.add(state.runner.pypi_name(m))));
      if (extra.size) {
        setStatus('busy', `Installing ${[...extra].join(', ')}…`);
        await micropipInstall([...extra]);
      }
      // Import the heavy modules now, while the student reads.
      const mods = ['numpy', 'pandas', 'matplotlib.pyplot', 'seaborn', 'sklearn'];
      for (const m of mods) {
        if (!sources.some((s) => s.includes(m.split('.')[0]))) continue;
        setStatus('busy', `Importing ${m}…`);
        await nextPaint();
        try { state.py.runPython(`try:\n    import ${m}\nexcept Exception:\n    pass`); } catch { /* ignore */ }
      }
      try { state.runner._prepare(''); } catch { /* ignore */ }
    });
  }

  function runAll() { state.cells.forEach(enqueueCell); }
  function runBefore() {
    const i = indexOf(state.selected);
    state.cells.slice(0, Math.max(i, 0)).forEach(enqueueCell);
  }
  function runAfter() {
    const i = Math.max(indexOf(state.selected), 0);
    state.cells.slice(i).forEach(enqueueCell);
  }

  // ---------------------------------------------------------------- files
  function listHomeFiles() {
    const FS = state.py.FS;
    const out = [];
    const walk = (dir, rel, depth) => {
      let names = [];
      try { names = FS.readdir(dir); } catch { return; }
      names.sort((a, b) => a.localeCompare(b));
      for (const name of names) {
        if (name === '.' || name === '..' || name.startsWith('.') || name === '__pycache__') continue;
        const path = `${dir}/${name}`;
        const st = FS.stat(path);
        if (FS.isDir(st.mode)) { if (depth < 3) walk(path, rel + name + '/', depth + 1); } else out.push({ path, rel: rel + name, size: st.size });
      }
    };
    walk(HOME, '', 0);
    return out;
  }

  function refreshFiles() {
    const ul = $('#file-list');
    if (!state.py || !state.booted) { ul.innerHTML = '<li class="empty">Starting Python…</li>'; return; }
    const files = listHomeFiles();
    ul.innerHTML = files.length ? '' : '<li class="empty">No files yet</li>';
    for (const f of files) {
      const li = document.createElement('li');
      li.innerHTML = `${ICON.file}<span class="fname"></span><span class="fsize">${fmtSize(f.size)}</span>
        <button title="Download">${ICON.download}</button><button title="Delete">${ICON.trash}</button>`;
      $('.fname', li).textContent = f.rel;
      $('.fname', li).title = `${f.rel}  (click to copy the name)`;
      $('.fname', li).style.cursor = 'pointer';
      $('.fname', li).onclick = () => { navigator.clipboard?.writeText(`'${f.rel}'`).then(() => toast(`Copied '${f.rel}'`)).catch(() => {}); };
      const [dl, del] = $$('button', li);
      dl.onclick = () => downloadBlob(new Blob([state.py.FS.readFile(f.path)]), f.rel.split('/').pop());
      del.onclick = async () => {
        if (!(await confirmModal(`<h2>Delete file?</h2><p><code>${escapeHtml(f.rel)}</code> will be removed from this session.</p>`, 'Delete'))) return;
        try { state.py.FS.unlink(f.path); } catch { /* gone */ }
        state.uploads.delete(f.rel);
        if (window.PYLAB_DATASETS?.files?.[f.rel] != null) state.deletedBundled.add(f.rel);
        refreshFiles();
      };
      ul.append(li);
    }
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      state.uploads.set(file.name, bytes);
      state.deletedBundled.delete(file.name);
      if (state.py && state.booted) writeHomeFile(state.py, file.name, bytes);
    }
    if (files.length) toast(files.length === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${files.length} files`);
    refreshFiles();
  }

  function refreshVars() {
    const box = $('#var-list');
    if ($('#panel-vars').hidden) return;
    if (!state.booted || state.running) { if (!state.booted) box.innerHTML = '<p class="empty">Starting Python…</p>'; return; }
    let rows = [];
    try { rows = JSON.parse(state.runner.list_variables()); } catch { /* ignore */ }
    if (!rows.length) { box.innerHTML = '<p class="empty">No variables yet. Run a cell to create some.</p>'; return; }
    box.innerHTML = '<table><thead><tr><th style="width:30%">Name</th><th style="width:24%">Type</th><th>Value</th></tr></thead><tbody></tbody></table>';
    const tb = $('tbody', box);
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="vname"></td><td></td><td></td>';
      const [a, b, c] = $$('td', tr);
      a.textContent = r.name; a.title = r.name;
      b.textContent = r.type + (r.size ? ` [${r.size}]` : ''); b.title = b.textContent;
      c.textContent = r.value; c.title = r.value;
      tb.append(tr);
    }
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ------------------------------------------------- notebook persistence
  const cleanOutput = (o) => {
    const c = {};
    for (const k of Object.keys(o)) if (!k.startsWith('_')) c[k] = o[k];
    return c;
  };
  const serialize = (withOutputs = true) => ({
    title: state.title,
    cells: state.cells.map((c) => ({
      id: c.id, type: c.type, source: c.source,
      execution_count: withOutputs ? c.execution_count : null,
      outputs: withOutputs && c.type === 'code' ? c.outputs.map(cleanOutput) : [],
    })),
  });

  function scheduleSave() {
    $('#save-state').textContent = 'Saving…';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 700);
  }

  function saveNow() {
    clearTimeout(state.saveTimer);
    const key = SLOT_PREFIX + state.slot;
    let ok = store.set(key, JSON.stringify(serialize(true)));
    let note = 'All changes saved in this browser';
    if (!ok) {
      ok = store.set(key, JSON.stringify(serialize(false)));
      note = 'Saved in this browser (outputs too large to keep)';
    }
    store.set(CURRENT_KEY, state.slot);
    $('#save-state').textContent = ok ? note : 'Could not save in this browser: download your notebook';
  }

  function loadNotebookData(data, slot) {
    state.cells.forEach((c) => c.el && c.el.remove());
    if (state.booted && !state.running) {
      // Each notebook starts with a clean runtime, as in Colab.
      try { state.runner.reset_namespace(); } catch { /* ignore */ }
      state.execCounter = 0;
      refreshVars();
    }
    state.slot = slot;
    state.title = data.title || 'Untitled';
    $('#nb-title').value = state.title;
    state.cells = (data.cells || []).map((c) => makeCell(c.type === 'markdown' ? 'markdown' : 'code', c.source || '', {
      outputs: c.outputs || [], execution_count: c.execution_count ?? null,
    }));
    if (!state.cells.length) state.cells.push(makeCell('code'));
    state.selected = null;
    renderCellList();
    selectCell(state.cells[0]);
    document.title = `${state.title} · NGN 112 PyLab`;
    $('#notebook').scrollTop = 0;
    renderExamplesMenu();
    saveNow();
  }

  function exampleData(key) {
    const ex = (window.PYLAB_EXAMPLES || []).find((e) => e.key === key);
    return ex ? { title: ex.title, cells: ex.cells.map((c) => ({ ...c })) } : null;
  }

  function openSlot(slot) {
    if (state.running) { toast('Wait for the running cell to finish (or press Stop) first.'); return; }
    if (state.cells.length) saveNow();
    cancelQueue();
    const saved = readJSON(SLOT_PREFIX + slot, null);
    if (saved && saved.cells) { loadNotebookData(saved, slot); return; }
    const ex = slot.startsWith('example:') ? exampleData(slot.slice(8)) : null;
    loadNotebookData(ex || exampleData('welcome') || { title: 'Untitled', cells: [] }, slot);
    warmup();
  }

  // ------------------------------------------------------------- ipynb I/O
  const toLines = (text) => {
    const parts = String(text).split('\n');
    return parts.map((l, i) => (i < parts.length - 1 ? l + '\n' : l)).filter((l, i, a) => !(i === a.length - 1 && l === ''));
  };

  function toIpynb() {
    return {
      cells: state.cells.map((c) => {
        const base = { cell_type: c.type, id: c.id.slice(0, 64), metadata: {}, source: toLines(c.source) };
        if (c.type !== 'code') return base;
        return {
          ...base,
          execution_count: c.execution_count,
          outputs: c.outputs.map((o) => {
            const x = cleanOutput(o);
            if (x.output_type === 'stream') x.text = toLines(x.text);
            if (x.data) {
              x.data = { ...x.data };
              for (const k of ['text/plain', 'text/html', 'text/markdown']) if (typeof x.data[k] === 'string') x.data[k] = toLines(x.data[k]);
            }
            return x;
          }),
        };
      }),
      metadata: {
        kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
        language_info: { name: 'python' },
        colab: { name: `${state.title}.ipynb`, provenance: [] },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
  }

  function fromIpynb(nb, fallbackTitle) {
    const cells = (nb.cells || []).map((c) => {
      const type = c.cell_type === 'code' ? 'code' : 'markdown';
      const outputs = type === 'code' ? (c.outputs || []).map((o) => {
        const x = { ...o };
        if (x.output_type === 'stream') x.text = joinText(x.text);
        if (x.output_type === 'pyout') x.output_type = 'execute_result';
        if (x.data) { x.data = { ...x.data }; for (const k of Object.keys(x.data)) if (Array.isArray(x.data[k])) x.data[k] = x.data[k].join(''); }
        if (x.output_type === 'error' && !Array.isArray(x.traceback)) x.traceback = [String(x.traceback || '')];
        return x;
      }) : [];
      return { type, source: joinText(c.source), outputs, execution_count: c.execution_count ?? null };
    });
    const title = (nb.metadata && nb.metadata.colab && nb.metadata.colab.name || fallbackTitle || 'Untitled').replace(/\.ipynb$/i, '');
    return { title, cells };
  }

  const safeName = () => (state.title || 'notebook').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'notebook';

  function downloadPy() {
    const parts = state.cells.map((c) => (c.type === 'code'
      ? `# %%\n${c.source}`
      : `# %% [markdown]\n${c.source.split('\n').map((l) => '# ' + l).join('\n')}`));
    downloadBlob(new Blob([parts.join('\n\n') + '\n'], { type: 'text/x-python' }), `${safeName()}.py`);
  }

  async function openIpynbFile(file) {
    try {
      const nb = JSON.parse(await file.text());
      const data = fromIpynb(nb, file.name);
      if (state.slot !== 'default' || hasContent()) {
        if (!(await confirmModal(`<h2>Open “${escapeHtml(file.name)}”?</h2><p>It will replace <b>My notebook</b>. Download your current work first if you want to keep it.</p>`, 'Open'))) return;
      }
      loadNotebookData(data, 'default');
      warmup();
      toast(`Opened ${file.name}`);
    } catch (e) {
      showModal(`<h2>Could not open the file</h2><p>${escapeHtml(e.message || e)}</p>`);
    }
  }

  const hasContent = () => {
    const saved = readJSON(SLOT_PREFIX + 'default', null);
    return !!(saved && saved.cells && saved.cells.some((c) => (c.source || '').trim()));
  };

  // -------------------------------------------------------------- menus
  function renderExamplesMenu() {
    const box = $('#examples-menu');
    const items = [['default', 'My notebook', 'Your own scratch notebook']]
      .concat((window.PYLAB_EXAMPLES || []).filter((e) => e.key !== 'welcome').map((e) => [`example:${e.key}`, e.title, e.subtitle || '']));
    box.innerHTML = '';
    items.forEach(([slot, title, sub], i) => {
      const b = document.createElement('button');
      b.innerHTML = `<span>${slot === state.slot ? '● ' : ''}${escapeHtml(title)}<span class="menu-sub">${escapeHtml(sub)}</span></span>`;
      b.onclick = () => { closeMenus(); openSlot(slot); };
      box.append(b);
      if (i === 0) box.append(document.createElement('hr'));
    });
    box.append(document.createElement('hr'));
    const reset = document.createElement('button');
    reset.textContent = 'Reset this notebook to its original';
    reset.onclick = async () => {
      closeMenus();
      const key = state.slot.startsWith('example:') ? state.slot.slice(8) : 'welcome';
      if (!(await confirmModal('<h2>Reset notebook?</h2><p>Your edits and outputs in this notebook will be replaced by the original version.</p>', 'Reset'))) return;
      store.del(SLOT_PREFIX + state.slot);
      loadNotebookData(exampleData(key), state.slot);
      warmup();
    };
    box.append(reset);
  }

  function closeMenus() { $$('.menu.open').forEach((m) => m.classList.remove('open')); }

  const commands = {
    'new': async () => {
      if (!(await confirmModal('<h2>Start a new notebook?</h2><p><b>My notebook</b> will be replaced with an empty notebook. Download it first if you want to keep it.</p>', 'New notebook'))) return;
      if (state.slot !== 'default') { saveNow(); }
      loadNotebookData({ title: 'Untitled', cells: [{ type: 'code', source: '' }] }, 'default');
    },
    'open': () => $('#open-input').click(),
    'download-ipynb': () => downloadBlob(new Blob([JSON.stringify(toIpynb(), null, 1)], { type: 'application/json' }), `${safeName()}.ipynb`),
    'download-py': downloadPy,
    'add-code': () => insertCell('code', state.selected ? indexOf(state.selected) + 1 : state.cells.length),
    'add-text': () => insertCell('markdown', state.selected ? indexOf(state.selected) + 1 : state.cells.length),
    'add-code-end': () => insertCell('code', state.cells.length),
    'add-text-end': () => insertCell('markdown', state.cells.length),
    'delete-cell': () => state.selected && deleteCell(state.selected),
    'clear-outputs': () => { state.cells.forEach((c) => { if (c.status === 'idle') { c.outputs = []; c.execution_count = null; renderOutputs(c); updateGutter(c); } }); scheduleSave(); },
    'run-all': runAll,
    'run-before': runBefore,
    'run-after': runAfter,
    'stop': stopExecution,
    'restart': () => restartRuntime(false),
    'restart-run-all': () => restartRuntime(true),
    'settings': openSettings,
    'help': openHelp,
    'libraries': openLibraries,
    'toggle-sidebar': () => $('#sidebar').classList.toggle('collapsed'),
  };

  function openSettings() {
    showModal(`<h2>Settings</h2>
      <label for="set-limit">Time limit for a cell in compatibility mode (seconds)</label>
      <input type="number" id="set-limit" min="0" step="10" value="${settings.timeLimit}">
      <p class="hint">Stops runaway loops such as <code>while True:</code>. 0 means no limit. In interactive mode (Chrome/Edge) use the Stop button instead.</p>
      <label><input type="checkbox" id="set-lines" ${settings.lineNumbers ? 'checked' : ''}> Show line numbers in code cells</label>`,
    [{ label: 'Cancel', value: false }, {
      label: 'Save', primary: true,
      onClick: () => {
        settings.timeLimit = Math.max(0, Number($('#set-limit').value) || 0);
        const ln = $('#set-lines').checked;
        if (ln !== settings.lineNumbers) {
          settings.lineNumbers = ln;
          state.cells.forEach((c) => c.type === 'code' && c.cm.setOption('lineNumbers', ln));
        }
        saveSettings();
        if (state.booted) showModeBadge();
        return true;
      },
    }]);
  }

  function openHelp() {
    showModal(`<h2>Keyboard shortcuts &amp; tips</h2>
      <table>
        <tr><td><kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>Run cell and move to the next one</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td>Run cell and stay</td></tr>
        <tr><td><kbd>Alt</kbd>+<kbd>Enter</kbd></td><td>Run cell and insert a new cell below</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>F9</kbd></td><td>Run all cells</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>M</kbd> <kbd>B</kbd> / <kbd>A</kbd></td><td>Insert code cell below / above</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>M</kbd> <kbd>D</kbd></td><td>Delete cell</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>M</kbd> <kbd>M</kbd> / <kbd>Y</kbd></td><td>Convert to text / code cell</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>/</kbd></td><td>Comment / uncomment lines</td></tr>
        <tr><td><kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd></td><td>Indent / unindent</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>Save now (also saves automatically)</td></tr>
      </table>
      <h2 style="margin-top:18px">Good to know</h2>
      <ul>
        <li>Python runs <b>inside your browser</b>: nothing is installed and your code never leaves your computer.</li>
        <li>Variables are shared between cells, like in Colab. <b>Restart</b> clears them.</li>
        <li>The last line of a cell is displayed automatically (e.g. a DataFrame shows as a table).</li>
        <li><code>input()</code> shows a box under the cell. Type your answer and press Enter.</li>
        <li>Charts from matplotlib / seaborn appear under the cell. <code>plt.show()</code> is optional.</li>
        <li>Your notebook is saved in this browser automatically. Use <b>File → Download .ipynb</b> to submit it or open it in Google Colab.</li>
        <li><code>iris.data</code> and <code>student_scores.csv</code> are already in the Files panel. Upload your own files there; they disappear when the page is closed.</li>
        <li>Lines such as <code>!pip install seaborn</code> work for pure-Python packages.</li>
      </ul>`);
  }

  function openLibraries() {
    const rows = [
      ['numpy', 'Arrays, statistics (np.mean, np.percentile, …)', 'Built in'],
      ['pandas', 'DataFrames, read_csv, describe, groupby', 'Built in'],
      ['matplotlib', 'pyplot charts (plot, scatter, hist, …)', 'Built in'],
      ['seaborn', 'histplot, boxplot, scatterplot, pairplot, heatmap…', 'Installed on first use'],
      ['scikit-learn', 'preprocessing, train_test_split, LinearRegression, SVR/SVC, KNN, Naive Bayes, Decision Trees, MLP, metrics, datasets', 'Built in'],
      ['mlxtend', 'plot_decision_regions', 'Installed on first use'],
      ['scipy', 'Scientific computing (used by scikit-learn)', 'Built in'],
      ['math, statistics, random, time', 'Python standard library', 'Built in'],
      ['openpyxl', 'pd.read_excel / to_excel', 'Installed on first use'],
    ];
    showModal(`<h2>Libraries used in the NGN 112 slides</h2>
      <table><tr><th>Library</th><th>Used for</th><th>Status</th></tr>
      ${rows.map((r) => `<tr><td><code>${r[0]}</code></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table>
      <p class="hint" style="margin-top:12px">Datasets: <code>iris.data</code>, <code>student_scores.csv</code>, <code>load_iris</code>, <code>load_diabetes</code>, <code>make_classification</code>, <code>make_regression</code> and <code>fetch_california_housing</code> all work offline. The UCI iris URL in the slides is redirected to the bundled copy.</p>`);
  }

  // ---------------------------------------------------------------- wiring
  function applyTheme() {
    if (settings.theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  }

  function wireUi() {
    applyTheme();
    $('#theme-btn').onclick = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      settings.theme = dark ? 'light' : 'dark';
      saveSettings();
      applyTheme();
    };
    $('#nb-title').addEventListener('input', (e) => { state.title = e.target.value || 'Untitled'; document.title = `${state.title} · NGN 112 PyLab`; scheduleSave(); });

    document.addEventListener('click', (e) => {
      const cmdEl = e.target.closest('[data-cmd]');
      const menuBtn = e.target.closest('.menu-btn');
      if (menuBtn) {
        const menu = menuBtn.parentElement;
        const wasOpen = menu.classList.contains('open');
        closeMenus();
        if (!wasOpen) menu.classList.add('open');
        return;
      }
      if (!e.target.closest('.menu-list')) closeMenus();
      if (cmdEl && commands[cmdEl.dataset.cmd]) { closeMenus(); commands[cmdEl.dataset.cmd](); }
    });
    $$('.menu').forEach((m) => m.addEventListener('mouseenter', () => {
      if ($('.menu.open') && !m.classList.contains('open')) { closeMenus(); m.classList.add('open'); }
    }));

    let ctrlM = 0;
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); toast('Notebook saved in this browser'); return; }
      if (mod && e.key === 'F9') { e.preventDefault(); runAll(); return; }
      if (e.key === 'Escape') { closeMenus(); if (!$('#modal').hidden) $('#modal').hidden = true; return; }
      const inEditor = e.target.closest && e.target.closest('.CodeMirror, input, textarea');
      if (inEditor) return;
      if (mod && e.key.toLowerCase() === 'm') { ctrlM = Date.now(); e.preventDefault(); return; }
      if (ctrlM && Date.now() - ctrlM < 1500 && state.selected) {
        const k = e.key.toLowerCase();
        ctrlM = 0;
        if (k === 'b') commands['add-code']();
        else if (k === 'a') insertCell('code', indexOf(state.selected));
        else if (k === 'd') deleteCell(state.selected);
        else if (k === 'z') undoDelete();
      }
    });

    $('#open-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openIpynbFile(f); });
    $('#upload-btn').onclick = () => $('#upload-input').click();
    $('#upload-input').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = ''; });
    $('#refresh-files').onclick = refreshFiles;
    const dz = $('#sidebar');
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); $('#drop-zone').classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || !dz.contains(e.relatedTarget)) $('#drop-zone').classList.remove('over'); }));
    dz.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));
    $('#notebook').addEventListener('dragover', (e) => e.preventDefault());
    $('#notebook').addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      const nb = files.find((f) => /\.ipynb$/i.test(f.name));
      if (nb) openIpynbFile(nb); else if (files.length) uploadFiles(files);
    });

    $$('.side-tab').forEach((t) => t.addEventListener('click', () => {
      $$('.side-tab').forEach((x) => x.classList.toggle('active', x === t));
      $('#panel-files').hidden = t.dataset.tab !== 'files';
      $('#panel-vars').hidden = t.dataset.tab !== 'vars';
      if (t.dataset.tab === 'vars') refreshVars(); else refreshFiles();
    }));
    if (window.innerWidth < 760) $('#sidebar').classList.add('collapsed');
    window.addEventListener('beforeunload', () => saveNow());
  }

  async function initialNotebook() {
    const params = new URLSearchParams(location.search);
    const ex = params.get('example');
    const nbUrl = params.get('nb');
    if (nbUrl) {
      const slot = 'url:' + nbUrl;
      const saved = readJSON(SLOT_PREFIX + slot, null);
      if (saved && saved.cells) { loadNotebookData(saved, slot); return; }
      try {
        const res = await fetch(nbUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        loadNotebookData(fromIpynb(await res.json(), nbUrl.split('/').pop()), slot);
        return;
      } catch (e) {
        toast(`Could not load the notebook from the link (${e.message}).`);
      }
    }
    if (ex && exampleData(ex)) { openSlot(`example:${ex}`); return; }
    openSlot(store.get(CURRENT_KEY) || 'default');
  }

  async function main() {
    wireUi();
    refreshFiles();
    await initialNotebook();
    state.ready = bootPython();
    state.ready.catch((e) => { console.error(e); setStatus('error', 'Python failed to start'); });
    warmup();
  }

  main();
})();
