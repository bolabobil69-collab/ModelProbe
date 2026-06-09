// storage.js — V8.1
// Config files (providers/models/rules) live in CONFIGS/ on disk.
// localStorage only holds sessions, logs, and UI state.
import { S, MIGRATION_VERSION, FALLBACK_TAGS } from './state.js';
import { toast, dl } from './utils.js';

// ── localStorage keys ─────────────────────────────────────────────────────
export const LS = {
  sessions: 'mp7_sessions',
  logs:     'mp7_logs',
  ui:       'mp7_ui',
  params:   'mp7_params',
  // Legacy V8.0 keys — read-once for migration, never written again
  _prov:    'mp7_providers',
  _models:  'mp7_models',
  _tags:    'mp7_ruletags',
  _order:   'mp7_ruleorder',
  // Migration flag — set after user dismisses the one-time modal
  _migrated:'mp81_migrated',
};

const MSG_LIMIT    = 12000;
const MAX_SESSIONS = 30;
const MAX_LOGS     = 200;
const CONFIGS_PATH = './CONFIGS';

// ── Low-level localStorage helpers ───────────────────────────────────────

export function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch(e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      if (key === LS.sessions && Array.isArray(value)) {
        try {
          localStorage.setItem(key, JSON.stringify(value.slice(0, Math.floor(value.length / 2))));
          toast('Storage full — older sessions trimmed', 'warn');
          return true;
        } catch(_) {}
      }
      toast('localStorage quota exceeded', 'warn');
    }
    return false;
  }
}

export function lsGet(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
  catch(e) { console.warn('lsGet', key, e); return null; }
}

// ── Config file I/O ───────────────────────────────────────────────────────

// Fetch a file from CONFIGS/. Returns parsed JSON or `fallback` on any error.
// Note: tags.json will always 404 on fresh installs — tags are embedded in
// rules.json as { tags, rules }. The 404 is expected and handled silently here.
export async function loadConfigFile(filename, fallback = null) {
  try {
    const r = await fetch(`${CONFIGS_PATH}/${filename}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch(e) {
    console.info(`CONFIGS/${filename} unavailable (${e.message}) — using fallback`);
    return fallback;
  }
}

// Trigger a browser download of a config file.
// User manually saves it into their CONFIGS/ folder to make it permanent.
export function saveConfigFile(filename, data) {
  dl(filename, JSON.stringify(data, null, 2));
}

// ── Dirty flag management ─────────────────────────────────────────────────

const DIRTY_FTAG_IDS = {
  providers: 'prov-ftag',
  models:    'mdl-ftag',
  rules:     'rules-ftag',
};

export function markDirty(scope) {
  S.dirtyFlags[scope] = true;
  const id = DIRTY_FTAG_IDS[scope];
  if (id) window.ftag?.(id, '* unsaved', 'd');
}

export function clearDirty(scope) {
  S.dirtyFlags[scope] = false;
  const id = DIRTY_FTAG_IDS[scope];
  if (id) window.ftag?.(id, 'saved \u2713', 'l');
}

// ── Rules normalisation ───────────────────────────────────────────────────
// Accepts: flat [], V7 {templates,custom}, or V8.1 {tags,rules}
export function normalizeRulesData(raw) {
  if (!raw) return { rules: [], tags: {} };

  // V8.1 format: { tags, rules }
  if (raw.rules && Array.isArray(raw.rules)) {
    return { rules: raw.rules, tags: raw.tags || {} };
  }

  // Flat array (V8.0 default-rules.json format)
  if (Array.isArray(raw)) {
    return { rules: raw, tags: {} };
  }

  // V7 format: { templates, custom }
  if (raw.templates || raw.custom) {
    const rules = [];
    (raw.templates || []).forEach(t => rules.push({ ...t, hidden: false }));
    (raw.custom    || []).forEach(c => rules.push({ ...c, hidden: false }));
    return { rules, tags: {} };
  }

  return { rules: [], tags: {} };
}

// ── Session + UI persistence (localStorage only) ──────────────────────────

function trimMsg(m) {
  const o = { id: m.id, role: m.role, timestamp: m.timestamp };
  if (m.content) o.content = m.content.slice(0, MSG_LIMIT) + (m.content.length > MSG_LIMIT ? '\n…' : '');
  if (m.error)   o.error   = m.error;
  if (m.meta)    o.meta    = m.meta;
  if (m.partial) o.partial = true;
  return o;
}

// ── PARAMS persistence (localStorage) ────────────────────────────────────

/** Read current slider/checkbox values from the DOM and save to localStorage. */
export function saveParams() {
  const get = id => document.getElementById(id);
  const p = {
    temp:    parseFloat(get('s-t')?.value  ?? '0.7'),
    maxTok:  parseInt(get('s-m')?.value    ?? '2048'),
    topP:    parseFloat(get('s-p')?.value  ?? '1.0'),
    freqP:   parseFloat(get('s-f')?.value  ?? '0.0'),
    stream:  get('str-on')?.checked  ?? true,
    think:   get('thk-on')?.checked  ?? false,
    sysOn:   get('sys-on')?.checked  ?? true,
  };
  lsSet(LS.params, p);
}

/** Restore slider/checkbox values from localStorage into the DOM. */
export function restoreParams() {
  const p = lsGet(LS.params);
  if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setV = (id, val, dec) => {
    const el = document.getElementById(id);
    if (el) el.textContent = dec != null ? Number(val).toFixed(dec) : val;
  };
  const setC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

  if (p.temp    != null) { set('s-t', p.temp);   setV('v-t', p.temp,   2); }
  if (p.maxTok  != null) { set('s-m', p.maxTok);  setV('v-m', p.maxTok, 0); }
  if (p.topP    != null) { set('s-p', p.topP);    setV('v-p', p.topP,   2); }
  if (p.freqP   != null) { set('s-f', p.freqP);   setV('v-f', p.freqP,  1); }
  if (p.stream  != null) setC('str-on', p.stream);
  if (p.think   != null) setC('thk-on', p.think);
  if (p.sysOn   != null) setC('sys-on',  p.sysOn);
}

export function persist() {
  lsSet(LS.sessions, S.sessions.slice(0, MAX_SESSIONS).map(s => ({
    id: s.id, name: s.name || '', provider: s.provider || '', model: s.model || '',
    alias: s.alias || '', createdAt: s.createdAt,
    summary: s.summary || null, summaryAt: s.summaryAt || null,
    pinnedIds: s.pinnedIds || [],
    messages: (s.messages || []).map(trimMsg),
  })));
  lsSet(LS.logs, S.logs.slice(0, MAX_LOGS).map(l => ({
    ...l, thinking: '', response: (l.response || '').slice(0, MSG_LIMIT),
    _rawReq: undefined, _rawRes: undefined,
  })));
  lsSet(LS.ui, {
    activeSessionId:     S.activeSessionId,
    activeAlias:         S.activeAlias,
    activeRuleId:        S.activeRuleId,
    contextSessionId:    S.contextSessionId,
    logExpandedSessions: S.logExpandedSessions,
    histFilter:          S.histFilter,
    ruleViewMode:        S.ruleViewMode,
    showSystemRules:     S.showSystemRules,
    modelProvFilter:     S.modelProvFilter,
    activeTagFilter:     S.activeTagFilter,
    ruleOrder:           S.ruleOrder,
    contextStrategy:     S.contextStrategy,
    contextWindowSize:   S.contextWindowSize,
    contextTurns:        S.contextTurns,
    autoSummarise:       S.autoSummarise,
    summaryTokenPct:     S.summaryTokenPct,
    ctxBarHidden:        lsGet(LS.ui)?.ctxBarHidden ?? false,
    loggingEnabled:      S.loggingEnabled,
  });
}

export function restoreAll() {
  const sessions = lsGet(LS.sessions);
  if (Array.isArray(sessions) && sessions.length) S.sessions = sessions;

  const logs = lsGet(LS.logs);
  if (Array.isArray(logs) && logs.length) S.logs = logs;

  const ui = lsGet(LS.ui) || {};
  if (ui.activeSessionId)      S.activeSessionId      = ui.activeSessionId;
  if (ui.activeAlias)          S.activeAlias          = ui.activeAlias;
  if (ui.activeRuleId)         S.activeRuleId         = ui.activeRuleId;
  if (ui.contextSessionId)     S.contextSessionId     = ui.contextSessionId;
  if (ui.logExpandedSessions)  S.logExpandedSessions  = ui.logExpandedSessions;
  if (ui.histFilter)           S.histFilter           = { ...S.histFilter, ...ui.histFilter };
  if (ui.ruleViewMode)         S.ruleViewMode         = ui.ruleViewMode;
  if (ui.showSystemRules != null) S.showSystemRules   = ui.showSystemRules;
  if (ui.modelProvFilter != null) S.modelProvFilter   = ui.modelProvFilter;
  if (ui.activeTagFilter != null) S.activeTagFilter   = ui.activeTagFilter;
  if (Array.isArray(ui.ruleOrder)) S.ruleOrder        = ui.ruleOrder;
  if (ui.contextStrategy)         S.contextStrategy   = ui.contextStrategy;
  if (ui.contextWindowSize)       S.contextWindowSize = ui.contextWindowSize;
  if (ui.contextTurns)            S.contextTurns      = ui.contextTurns;
  if (ui.autoSummarise != null)   S.autoSummarise     = ui.autoSummarise;
  // summaryTokenPct replaces summaryThreshold as of v10.0.0
  // Migration shim: if old key present and new key absent, map old value to pct
  if (ui.summaryTokenPct)         S.summaryTokenPct   = ui.summaryTokenPct;
  else if (ui.summaryThreshold)   S.summaryTokenPct   = 65; // legacy → use new default
  if (ui.loggingEnabled != null)  S.loggingEnabled    = ui.loggingEnabled;

  _fixOrphanedLogs();
}

function _fixOrphanedLogs() {
  S.sessions.forEach(s => {
    if (!s.name) {
      const first = (s.messages || []).find(m => m.role === 'user');
      const raw   = first?.content || '';
      s.name = raw.slice(0, 40) + (raw.length > 40 ? '…' : '') || 'Session';
    }
  });
  const orphaned = S.logs.filter(l => !l.sessionId);
  if (!orphaned.length) return;
  let os = S.sessions.find(s => s.id === '_orphaned');
  if (!os) {
    os = { id:'_orphaned', name:'Imported (pre-V7)', provider:'', model:'', alias:'', createdAt:new Date().toISOString(), messages:[] };
    S.sessions.push(os);
  }
  orphaned.forEach(l => { l.sessionId = '_orphaned'; });
}

// ── V8.0 → V8.1 Migration ────────────────────────────────────────────────

// Returns { providers, models, rules, tags } from V8.0 localStorage, or null.
export function detectV8Migration() {
  if (lsGet(LS._migrated)) return null;             // already done
  const prov = lsGet(LS._prov);
  if (!prov || !Object.keys(prov).length) return null; // nothing to migrate
  const mdl   = lsGet(LS._models) || {};
  const tags  = lsGet(LS._tags)   || {};
  const rules = []; // rules were in DEFAULT_RULES, not user-authored → skip migration
  return { providers: prov, models: mdl, tags, rules };
}

export function dismissMigration() {
  lsSet(LS._migrated, true);
}

// Download the three config files from migrated LS data

// ── File-based request logging (requires serve.py) ────────────────────────────
//
// appendLog()      — called after each completed request in api.js
// deleteLog()      — called from deleteSession() in chat.js
// deleteAllLogs()  — called from clearHist() in history.js
//
// All three are fire-and-forget when server is available; silent no-ops when not.
// Raw payloads (_rawReq/_rawRes) are never stored in localStorage — they live only
// as local variables in sendMsg() and are passed directly here, then GC'd.
// ─────────────────────────────────────────────────────────────────────────────────

export async function appendLog(sessionId, entry) {
  if (!_serverAvailable || !S.loggingEnabled) return;
  const date = (entry.ts || new Date().toISOString()).slice(0, 10);
  const filename = date + '-' + sessionId + '.log';
  const line = JSON.stringify(entry);
  try {
    await fetch('/api/log', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filename, entry: line }),
    });
  } catch(e) {
    console.warn('[modelprobe] log write failed:', e);
  }
}

export function deleteLog(sessionId, createdAt) {
  if (!_serverAvailable) return;
  const date = (createdAt || '').slice(0, 10);
  fetch('/api/log-delete', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId, date }),
  }).catch(e => console.warn('[modelprobe] log-delete failed:', e));
}

export function deleteAllLogs(sessions) {
  if (!_serverAvailable || !sessions.length) return;
  fetch('/api/log-delete-all', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessions }),
  }).catch(e => console.warn('[modelprobe] log-delete-all failed:', e));
}

export function exportMigrationFiles(data) {
  saveConfigFile('providers.json', data.providers);
  saveConfigFile('models.json',    data.models);
  const tagsToSave = Object.keys(data.tags).length ? data.tags : FALLBACK_TAGS;
  saveConfigFile('rules.json', { tags: tagsToSave, rules: S.rules });
  toast('3 files downloaded — place them in your CONFIGS/ folder', 'ok');
}

// ── Dev helpers ───────────────────────────────────────────────────────────
window.mpStorageInfo = () => {
  const keys = Object.keys(localStorage).filter(k => k.match(/^mp[0-9]/));
  const info = {}; keys.forEach(k => info[k] = (localStorage.getItem(k) || '').length + ' chars');
  console.table(info);
  const tot = keys.reduce((a, k) => a + (localStorage.getItem(k) || '').length, 0);
  console.log('Total:', Math.round(tot / 1024) + 'KB');
};
window.mpClearStorage = () => {
  Object.keys(localStorage).filter(k => k.match(/^mp[0-9]/)).forEach(k => localStorage.removeItem(k));
  console.log('ModelProbe storage cleared. Reload.');
};

// ── Config save / load — server-first, FSA fallback, dl() last resort ────────
//
// Save priority (per saveConfigDirectly):
//   1. POST /api/save  — local dev server (serve.py); works on ALL browsers
//   2. FileSystemDirectoryHandle (FSA) — Chrome/Edge only, non-local deployments
//   3. dl() browser download — absolute last resort
//
// Load priority (per loadConfigViaPicker):
//   1. Cached FSA directory handle (if linked)
//   2. showOpenFilePicker (FSA, Chrome/Edge)
//   3. <input type="file"> fallback (all browsers)
//
// On init, autoLinkConfigs() pings /api/ping to detect local server and
// sets _serverAvailable = true so saves go straight to path 1.
// ─────────────────────────────────────────────────────────────────────────────

export const FILE_SCOPE = {
  providers: { filename: 'providers.json' },
  models:    { filename: 'models.json'    },
  rules:     { filename: 'rules.json'     },
};

// ── Save-path state ───────────────────────────────────────────────────────────
let _serverAvailable  = false;   // true after /api/ping succeeds
let _configsDirHandle = null;    // FileSystemDirectoryHandle (FSA, Chrome/Edge only)

function _dirPickerSupported() {
  return typeof window.showDirectoryPicker === 'function';
}
function _openFsaSupported() {
  return typeof window.showOpenFilePicker === 'function';
}

// Serialise scope data to JSON string
function _serialise(scope) {
  if (scope === 'rules')     return JSON.stringify({ tags: S.ruleTags, rules: S.rules }, null, 2);
  if (scope === 'providers') return JSON.stringify(S.providers, null, 2);
  if (scope === 'models')    return JSON.stringify(S.models,    null, 2);
  return null;
}

// Exposed so UI can check linked state
export function getCachedDirHandle()  { return _configsDirHandle; }
export function isServerLinked()      { return _serverAvailable;  }

// ── Badge update ──────────────────────────────────────────────────────────────
function _updateDirBadge(linked, label) {
  const text = linked ? ('\u2713 ' + (label || 'CONFIGS/ linked')) : 'CONFIGS/ not linked';
  const cls  = 'ftag ' + (linked ? 'l' : 'n');
  const el   = document.getElementById('configs-link-badge');
  if (el) { el.textContent = text; el.className = cls; }
  const hint = document.getElementById('cfg-link-status-hint');
  if (hint)   { hint.textContent = text; }
}

// ── Auto-link: ping local server on startup ───────────────────────────────────
/**
 * autoLinkConfigs()
 * Called once from main.js init(). Pings /api/ping on the current origin.
 * If the local dev server (serve.py) is running, marks _serverAvailable = true
 * and updates the badge automatically — no user action required.
 */
export async function autoLinkConfigs() {
  try {
    const r = await fetch('/api/ping', { method: 'GET', cache: 'no-store' });
    if (r.ok) {
      _serverAvailable = true;
      _updateDirBadge(true, 'Local server linked');
      return true;
    }
  } catch(_) { /* not running locally — fall through */ }
  _serverAvailable = false;
  _updateDirBadge(false);
  return false;
}

// ── Manual FSA link (Chrome/Edge, non-local deployments) ─────────────────────
/**
 * requestConfigsDir()
 * Opens showDirectoryPicker(), caches the handle, updates the status badge.
 * Only needed when NOT running via serve.py (e.g. deployed to a static host).
 * Returns the handle, or null if cancelled / unsupported.
 */
export async function requestConfigsDir() {
  if (!_dirPickerSupported()) {
    toast('Directory picker not supported in this browser. Run via start.bat / start.sh for direct saves.', 'warn');
    return null;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    _configsDirHandle = handle;
    _updateDirBadge(true, 'CONFIGS/ linked');
    toast('CONFIGS/ folder linked \u2713 — saves will overwrite directly', 'ok');
    return handle;
  } catch(e) {
    if (e.name === 'AbortError') return null;
    toast('Could not open directory: ' + e.message, 'err');
    return null;
  }
}

// ── Server-side save (path 1) ─────────────────────────────────────────────────
async function _saveViaServer(filename, json) {
  const r = await fetch('/api/save', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ filename, content: json }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
  }
  return true;
}

// ── FSA directory-handle save (path 2) ───────────────────────────────────────
async function _saveViaFSA(filename, json) {
  const fileHandle = await _configsDirHandle.getFileHandle(filename, { create: true });
  const writable   = await fileHandle.createWritable();
  await writable.write(json);
  await writable.close();
}

// ── Main save entry point ─────────────────────────────────────────────────────
/**
 * saveConfigDirectly(scope)
 * Tries save paths in order, stopping at first success:
 *   1. POST /api/save  (local serve.py — all browsers)
 *   2. FSA directory handle (Chrome/Edge, must be linked first)
 *   3. dl() browser download (fallback)
 */
export async function saveConfigDirectly(scope) {
  const meta = FILE_SCOPE[scope];
  if (!meta) { toast('Unknown scope: ' + scope, 'err'); return; }

  const json = _serialise(scope);
  if (json === null) { toast('Nothing to save', 'warn'); return; }

  // ── Path 1: local dev server ──────────────────────────────────────────
  if (_serverAvailable) {
    try {
      await _saveViaServer(meta.filename, json);
      clearDirty(scope);
      toast(meta.filename + ' saved \u2713', 'ok');
      return;
    } catch(e) {
      console.warn('Server save failed:', e);
      // Server may have been stopped — re-check and fall through
      _serverAvailable = false;
      _updateDirBadge(false);
      toast('Server save failed (' + e.message + ') — trying fallback\u2026', 'warn');
    }
  }

  // ── Path 2: FSA directory handle (Chrome/Edge) ────────────────────────
  if (_configsDirHandle) {
    try {
      await _saveViaFSA(meta.filename, json);
      clearDirty(scope);
      toast(meta.filename + ' saved \u2713', 'ok');
      return;
    } catch(e) {
      if (e.name === 'AbortError') return;
      console.warn('FSA write failed:', e);
      _configsDirHandle = null;
      _updateDirBadge(false);
      toast('CONFIGS/ write failed (' + e.message + ') — downloading instead', 'warn');
      // fall through
    }
  }

  // ── Path 3: browser download (last resort) ────────────────────────────
  dl(meta.filename, json);
  clearDirty(scope);
  toast(meta.filename + ' downloaded \u2014 place in dist/CONFIGS/ to make it permanent', 'ok');
}

// ── Load via picker ───────────────────────────────────────────────────────────
/**
 * loadConfigViaPicker(scope)
 * If FSA directory handle cached: reads file directly (no picker shown).
 * Else: showOpenFilePicker (Chrome/Edge) or <input type="file"> fallback.
 * Note: reload (↺ button) always uses fetch('./CONFIGS/...') — see loadConfigFile().
 */
export async function loadConfigViaPicker(scope) {
  const meta = FILE_SCOPE[scope];
  if (!meta) { toast('Unknown scope: ' + scope, 'err'); return null; }

  if (S.dirtyFlags[scope]) {
    if (!confirm(scope + ' has unsaved changes. Load new file and discard them?')) return null;
  }

  // ── Use cached FSA directory handle if available ──────────────────────
  if (_configsDirHandle) {
    try {
      const fileHandle = await _configsDirHandle.getFileHandle(meta.filename);
      const file       = await fileHandle.getFile();
      return await _parseAndApply(scope, file, meta.filename);
    } catch(e) {
      if (e.name !== 'NotFoundError') {
        console.warn('FSA dir handle read failed:', e);
        _configsDirHandle = null;
        _updateDirBadge(false);
      }
      // File not in dir or handle stale → fall through to picker
    }
  }

  // ── FSA open file picker (Chrome/Edge) ───────────────────────────────
  if (_openFsaSupported()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types:    [{ description: 'JSON config', accept: { 'application/json': ['.json'] } }],
        multiple: false,
      });
      const file = await handle.getFile();
      return await _parseAndApply(scope, file, handle.name);
    } catch(e) {
      if (e.name === 'AbortError') return null;
      toast('File picker error: ' + e.message, 'err');
      return null;
    }
  }

  // ── Fallback: <input type="file"> (all browsers) ──────────────────────
  return new Promise(resolve => {
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = '.json';
    fi.onchange = async () => {
      const f = fi.files[0];
      resolve(f ? await _parseAndApply(scope, f, f.name) : null);
    };
    fi.click();
  });
}

async function _parseAndApply(scope, file, name) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch(e) {
    toast('Invalid JSON in ' + name + ': ' + e.message, 'err');
    return null;
  }

  if (scope === 'providers') {
    if (typeof raw !== 'object' || Array.isArray(raw))
      { toast('providers.json must be an object { id: { api_key, base_url } }', 'err'); return null; }
    S.providers = raw;
    clearDirty('providers');
    ftag('prov-ftag', name, 'l');
    window.renderProvList?.(); window.updateModelSel?.();
    toast('providers.json loaded', 'ok');
    return raw;
  }

  if (scope === 'models') {
    if (typeof raw !== 'object' || Array.isArray(raw))
      { toast('models.json must be an object { alias: { provider, model } }', 'err'); return null; }
    S.models = raw;
    clearDirty('models');
    ftag('mdl-ftag', name, 'l');
    window.renderProvList?.(); window.updateModelSel?.();
    toast('models.json loaded', 'ok');
    return raw;
  }

  if (scope === 'rules') {
    const { rules, tags } = normalizeRulesData(raw);
    if (!Array.isArray(rules))
      { toast('rules.json: could not parse rules array', 'err'); return null; }
    S.rules     = rules;
    S.ruleOrder = [];
    if (Object.keys(tags).length) S.ruleTags = tags;
    S.activeRuleId = null;
    clearDirty('rules');
    ftag('rules-ftag', name, 'l');
    window.renderAllRules?.(); window.renderQuickRules?.(); window.updateSysPrev?.();
    toast('rules.json loaded', 'ok');
    return raw;
  }

  return null;
}
