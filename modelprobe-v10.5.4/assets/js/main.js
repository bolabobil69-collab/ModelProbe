// main.js — entry point V8.1
import { S, FALLBACK_RULES, FALLBACK_TAGS, FALLBACK_PROMPTS, MIGRATION_VERSION } from './state.js';
import { restoreAll, persist, lsGet, lsSet, LS,
         saveParams, restoreParams,
         loadConfigFile, saveConfigFile, markDirty, clearDirty,
         normalizeRulesData, detectV8Migration, dismissMigration,
         exportMigrationFiles, saveConfigDirectly, loadConfigViaPicker,
         requestConfigsDir, getCachedDirHandle,
         autoLinkConfigs, isServerLinked } from './storage.js';
import { $, ftag, toast, dl, confirmBtn } from './utils.js';
import { sv, lt, rt, pv } from './views.js';

import { renderProvList, toggleProv, addProv, delProv,
         updateProvField, toggleProvKey, loadProvFile, saveProvFile,
         reloadProviders } from './components/providers.js';
import { resolveModel, updateModelSel, updateActiveModel, setAlias,
         addModelToProv, delModel, loadMdlFile, saveMdlFile,
         filterModelsByProv, renderProvFilterSel, reloadModels } from './components/models.js';
import { renderAllRules, renderQuickRules, renderTagFilters,
         selectRule, clearActiveRule, setRuleTagFilter, toggleRulesView, hideRule,
         getSystemPrompt, updateSysPrev, copyRule, openEditor, saveRule,
         applyRule, newRuleEditor, clearEditor, delRule, delCustRule,
         loadRulesFile, saveRulesFile, reloadRules } from './components/rules.js';
import { renderTagsList, toggleTagManager, addNewTag, deleteTag, updateTagColor,
         renderTagPicker, toggleRuleTag, renderTagBadge } from './components/tags-manager.js';
import { ddSetOnDrop, ddHandleDragStart, ddHandleDragEnd,
         ddHandleDragOver, ddHandleDragLeave, ddHandleDrop } from './utils/dragdrop.js';
import { newSession, clearSession, loadSession, deleteSession,
         startEditMsg, commitEditMsg, cancelEditMsg,
         renameSession, getActSess, updateSessLbl, renderChat, renderSummaryPill,
         exportSession, showLoadingBubble, hideLoadingBubble, bindCopyButtons,
         togglePin } from './components/chat.js';
import { renderLog, viewLog, clearLogs, exportLogs, exportGlobal, clearAll,
         toggleLogGroup, loadSessionFromLog, exportSessionLogs, toggleLogging } from './components/log.js';
import { renderHist, clearHist, startRename, commitRename,
         setHistFilter, clearHistFilters, exportAllSessions } from './components/history.js';
import { renderCtx, clearCtx, setCtxSession, exportCtxSnapshot,
         renderCtxParams, setCtxStrategy, setCtxWindowSize, setCtxTurns,
         setAutoSummarise, setSummaryTokenPct, renderChatCtxBar, toggleCtxBar,
         manualResummarise, renderCtxPreview } from './components/context.js';
import { renderPTList, renderBMdl, selPT, savePTform, loadPT, savePT,
         runBatch, stopBatch, exportBatch, clearBatch, chkAll } from './components/batch.js';
import { sendMsg, stopStream, testConn, testFreeModel } from './api.js';
import { renderFP, fetchFreeProviders, fpToggleSource, fpSetSourceFilter,
         fpSetSearch, fpStartAdd, fpCancelAdd, fpAliasInput, fpConfirmAdd,
         fpToggleExpand, fpTestCard, fpTestAll } from './components/free-providers.js';

// ── Window exposure ───────────────────────────────────────────────────────
Object.assign(window, {
  S, sv, lt, rt, pv, dl, toast, ftag,
  renderLog, renderHist, renderCtx, getSystemPrompt,
  // providers
  toggleProv, addProv, delProv, updateProvField, toggleProvKey,
  loadProvFile, saveProvFile, reloadProviders,
  // models
  updateModelSel, setAlias, addModelToProv, delModel, loadMdlFile, saveMdlFile,
  filterModelsByProv, renderProvFilterSel, reloadModels,
  // rules
  selectRule, clearActiveRule, setRuleTagFilter, toggleRulesView, hideRule,
  copyRule, openEditor, saveRule, applyRule, newRuleEditor, clearEditor,
  delRule, delCustRule, loadRulesFile, saveRulesFile, reloadRules,
  renderTagFilters,
  // tags
  renderTagsList, toggleTagManager, addNewTag, deleteTag, updateTagColor,
  renderTagPicker, toggleRuleTag, renderTagBadge,
  // drag-drop
  ddSetOnDrop, ddHandleDragStart, ddHandleDragEnd,
  ddHandleDragOver, ddHandleDragLeave, ddHandleDrop,
  // chat hdr + rpanel toggles
  toggleChatHdr, toggleRPanel,
  showLoadingBubble, hideLoadingBubble, bindCopyButtons, renderSummaryPill,
  // log
  viewLog, clearLogs, exportLogs, exportGlobal, clearAll,
  toggleLogGroup, loadSessionFromLog, exportSessionLogs, toggleLogging,
  // history
  clearHist, startRename, commitRename, setHistFilter, clearHistFilters,
  exportAllSessions,
  // context
  clearCtx, setCtxSession, exportCtxSnapshot,
  renderCtxParams, setCtxStrategy, setCtxWindowSize, setCtxTurns,
  setAutoSummarise, setSummaryTokenPct, renderChatCtxBar, toggleCtxBar,
  manualResummarise, renderCtxPreview,
  // pin (chat)
  togglePin,
  exportSession,
  startEditMsg, commitEditMsg, cancelEditMsg,
  // batch
  selPT, savePTform, loadPT, savePT, runBatch, stopBatch,
  exportBatch, clearBatch, chkAll,
  // api
  confirmBtn,
  sendMsg, stopStream, testConn,
  // free providers
  renderFP, fetchFreeProviders, fpToggleSource, fpSetSourceFilter,
  fpSetSearch, fpStartAdd, fpCancelAdd, fpAliasInput, fpConfirmAdd,
  fpToggleExpand, fpTestCard, fpTestAll,
  // storage — CONFIGS/ link
  requestConfigsDir, getCachedDirHandle, autoLinkConfigs, isServerLinked,
  // params persistence
  saveParams,
});

// ── Tab-switch hooks ──────────────────────────────────────────────────────
window._onBatchView = () => { renderBMdl(); renderPTList(); };
window._onFreeView  = () => { renderFP(); };
window._onLeftTab   = name => {
  if (name === 'rules')  { renderAllRules(); updateSysPrev(); }
  if (name === 'edit')   renderQuickRules();
  if (name === 'params') { renderCtxParams(); renderCtxPreview(); }
};
window._onRightTab  = name => {
  if (name === 'ctx')    renderCtx();
  if (name === 'hist')   renderHist();
  if (name === 'log')    renderLog();
};

// ── Prompt dock ───────────────────────────────────────────────────────────
function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 480) + 'px';
}

function initPromptDock() {
  const inp = $('pinput');
  if (inp) {
    // Shift+Enter = send; Enter = newline
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
    inp.addEventListener('input', () => {
      const c = $('cci'); if (c) c.textContent = (inp.value || '').length + ' ch';
      autoResizeTextarea(inp);
    });
    // Also handle paste (may change height without firing input)
    inp.addEventListener('paste', () => setTimeout(() => autoResizeTextarea(inp), 0));
  }
}

function initRulesToolbar() {
  $('rules-search')?.addEventListener('input', () => renderAllRules());
  $('show-sys-rules')?.addEventListener('change', e => {
    S.showSystemRules = e.target.checked; renderAllRules(); persist();
  });

  // Batch textareas: Shift+Enter = run batch, Enter = newline
  ['bt-prompt','bt-sys'].forEach(id => {
    $(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); runBatch(); }
    });
  });
}

// ── Config loading from CONFIGS/ (with bundled DEFAULT_* fallback) ────────
//
// In the bundle, build.py inlines:
//   const DEFAULT_PROVIDERS = {...};
//   const DEFAULT_MODELS    = {...};
//   const DEFAULT_RULES     = [...];
//   const DEFAULT_PROMPTS   = {...};
//   const DEFAULT_TAGS      = {...};
// In dev (source), these are undefined — loadConfigFile returns null and we
// use the JS-level FALLBACK_* constants from state.js instead.

async function loadDefaultData() {
  // Bundled constants or undefined in dev source
  const bProv   = typeof DEFAULT_PROVIDERS !== 'undefined' ? DEFAULT_PROVIDERS : null;
  const bModels = typeof DEFAULT_MODELS    !== 'undefined' ? DEFAULT_MODELS    : null;
  const bRules  = typeof DEFAULT_RULES     !== 'undefined' ? DEFAULT_RULES     : null;
  const bTags   = typeof DEFAULT_TAGS      !== 'undefined' ? DEFAULT_TAGS      : null;
  const bPrompts= typeof DEFAULT_PROMPTS   !== 'undefined' ? DEFAULT_PROMPTS   : null;

  // Try CONFIGS/ first; fall back to bundled constants; then JS fallbacks
  const [prov, mdl, rulesRaw, tagsRaw, promptsRaw] = await Promise.all([
    loadConfigFile('providers.json', bProv  || {}),
    loadConfigFile('models.json',    bModels || {}),
    loadConfigFile('rules.json',     bRules  ? { rules: bRules } : null),
    loadConfigFile('tags.json',      bTags   || null),
    loadConfigFile('prompts.json',   bPrompts || { prompts: [] }),
  ]);

  // Providers + models
  if (prov  && typeof prov  === 'object' && !Array.isArray(prov))  S.providers = prov;
  if (mdl   && typeof mdl   === 'object' && !Array.isArray(mdl))   S.models    = mdl;

  // Rules: normalise + tags embedded in rules.json take priority over tags.json
  const { rules, tags: embeddedTags } = normalizeRulesData(rulesRaw);
  S.rules = rules.length ? rules : (bRules ? [...bRules] : [...FALLBACK_RULES]);

  // Tags: embedded in rules.json > standalone tags.json > bundled DEFAULT_TAGS > JS fallback
  const resolvedTags = Object.keys(embeddedTags).length ? embeddedTags
    : (tagsRaw && typeof tagsRaw === 'object' ? tagsRaw
    : (bTags || FALLBACK_TAGS));
  S.ruleTags = Object.keys(resolvedTags).length ? resolvedTags : { ...FALLBACK_TAGS };

  // Prompts
  const promptArr = promptsRaw?.prompts || (Array.isArray(promptsRaw) ? promptsRaw : []);
  S.promptTemplates = promptArr.length ? promptArr : [...FALLBACK_PROMPTS];

  // Store bundled originals for reset
  window._DEF_PROVIDERS = bProv   || {};
  window._DEF_MODELS    = bModels || {};
  window._DEF_RULES_RAW = bRules  || FALLBACK_RULES;
  window._DEF_TAGS      = bTags   || FALLBACK_TAGS;

  // Set ftag state based on whether CONFIGS/ files were loaded
  const configsLoaded = Object.keys(S.providers).length || S.rules.length;
  if (configsLoaded) {
    ftag('prov-ftag',  'CONFIGS/', 'l');
    ftag('mdl-ftag',   'CONFIGS/', 'l');
    ftag('rules-ftag', 'CONFIGS/', 'l');
  }
}

// ── Reset to bundled defaults ─────────────────────────────────────────────
window.resetRules = function() {
  if (!confirm('Reset ALL rules to bundled defaults? All custom rules will be lost.')) return;
  S.rules    = (window._DEF_RULES_RAW || FALLBACK_RULES).map(r => ({ ...r }));
  S.ruleTags = Object.assign({}, window._DEF_TAGS || FALLBACK_TAGS);
  S.ruleOrder = []; S.activeRuleId = null;
  markDirty('rules');
  renderAllRules(); updateSysPrev(); renderTagsList(); renderTagFilters();
  toast('Rules reset to bundled defaults', 'ok');
};

window.resetProviders = function() {
  if (!confirm('Reset providers to bundled defaults?')) return;
  S.providers = Object.assign({}, window._DEF_PROVIDERS || {});
  markDirty('providers');
  renderProvList(); updateModelSel();
  toast('Providers reset to defaults', 'ok');
};

// ── Migration modal ───────────────────────────────────────────────────────
function showMigrationModal(data) {
  // Build modal DOM
  const overlay = document.createElement('div');
  overlay.id = 'mp-migrate-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center';

  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:24px;max-width:440px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.4)">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">
        &#x1F4BE; V8 Config Data Detected
      </div>
      <div style="font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:16px">
        ModelProbe V8.1 stores <strong>providers, models,</strong> and <strong>rules</strong>
        as files in <code style="font-family:var(--mono);color:var(--ac)">CONFIGS/</code>
        instead of localStorage.<br><br>
        V8.0 config data was found in localStorage
        (${Object.keys(data.providers).length} provider(s),
         ${Object.keys(data.models).length} model alias(es)).<br><br>
        Click <strong>Export Files</strong> to download them, then place them in your
        <code style="font-family:var(--mono);color:var(--ac)">CONFIGS/</code> folder
        next to <code style="font-family:var(--mono)">index.html</code> and reload.
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn sm ghost" id="mp-migrate-skip">Skip (use CONFIGS/ files)</button>
        <button class="btn sm ac"    id="mp-migrate-export">&#x2B07; Export Files</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('mp-migrate-export').onclick = () => {
    exportMigrationFiles(data);
    dismissMigration();
    document.body.removeChild(overlay);
  };
  document.getElementById('mp-migrate-skip').onclick = () => {
    dismissMigration();
    document.body.removeChild(overlay);
  };
}

// ── Init ──────────────────────────────────────────────────────────────────
// ── UI toggle: chat header collapse ──────────────────────────────────────
function toggleChatHdr() {
  const hdr = document.getElementById('chat-hdr');
  if (!hdr) return;
  const collapsed = hdr.classList.toggle('collapsed');
  const ui = lsGet(LS.ui) || {};
  ui.chatHdrCollapsed = collapsed;
  lsSet(LS.ui, ui);
}

// ── UI toggle: right panel collapse ──────────────────────────────────────
function toggleRPanel() {
  const view = document.querySelector('.v-chat');
  if (!view) return;
  const closed = view.classList.toggle('rpanel-closed');
  const ui = lsGet(LS.ui) || {};
  ui.rPanelClosed = closed;
  lsSet(LS.ui, ui);
}

async function init() {
  // Auto-detect local dev server — sets badge + enables direct save (all browsers)
  autoLinkConfigs(); // fire-and-forget; badge updates asynchronously

  await loadDefaultData();

  restoreAll(); // restores sessions, logs, UI state from localStorage
  restoreParams(); // restores slider/checkbox values from localStorage

  // Restore UI toggle states
  const _ui = lsGet(LS.ui) || {};
  if (_ui.chatHdrCollapsed) {
    const hdr = document.getElementById('chat-hdr');
    if (hdr) hdr.classList.add('collapsed');
  }
  if (_ui.rPanelClosed) {
    const view = document.querySelector('.v-chat');
    if (view) view.classList.add('rpanel-closed');
  }


  // V8.0 migration check (runs after configs loaded so we show migration modal with real data)
  const migrationData = detectV8Migration();
  if (migrationData) showMigrationModal(migrationData);

  // Config UI
  renderProvList(); updateModelSel(); updateActiveModel();

  // Rules UI
  if (!S.rules.length) S.rules = [...FALLBACK_RULES];
  if (!Object.keys(S.ruleTags).length) S.ruleTags = { ...FALLBACK_TAGS };
  renderAllRules(); updateSysPrev(); renderQuickRules(); renderTagsList(); renderTagFilters();

  // Log + batch
  renderLog(); renderPTList();

  // Active session
  if (S.activeSessionId && !S.sessions.find(s => s.id === S.activeSessionId))
    S.activeSessionId = null;
  if (!S.activeSessionId && S.sessions.length)
    S.activeSessionId = S.sessions[0].id;

  if (S.activeSessionId) { updateSessLbl(); renderChat(); }
  else {
    const m = $('msgs');
    if (m) m.innerHTML = '<div class="empty"><div class="empty-i">&#x2B21;</div><p>Place providers.json + models.json in CONFIGS/,<br>select a model, then type below.</p></div>';
  }

  renderHist();

  $('rt-log') .style.display = 'flex';
  $('rt-hist').style.display = 'none';
  $('rt-ctx') .style.display = 'none';

  // Sync checkbox + selects
  const sysCb = $('show-sys-rules');
  if (sysCb) sysCb.checked = S.showSystemRules;
  const filterSel = $('model-prov-filter');
  if (filterSel && S.modelProvFilter) filterSel.value = S.modelProvFilter;

  initPromptDock();
  initRulesToolbar();

  if (S.sessions.length) {
    const sess = S.sessions.find(s => s.id === S.activeSessionId);
    const mc   = sess?.messages.length || 0;
    toast(`Restored · ${S.sessions.length} session(s) · ${S.logs.length} log(s)${mc ? ' · ' + mc + ' msgs' : ''}`, 'ok');
  }
}

init();
