// rules.js — V8.1: all rules equal, no type enforcement, CONFIGS/rules.json source
import { S } from '../state.js';
import { $, esc, ftag, toast, dl, confirmBtn } from '../utils.js';
import { markDirty, clearDirty, saveConfigFile, loadConfigFile,
         normalizeRulesData, persist,
         saveConfigDirectly, loadConfigViaPicker } from '../storage.js';

// ─── ORDERING ─────────────────────────────────────────────────────────────

function getOrderedRules() {
  if (!S.ruleOrder.length) return [...S.rules];
  const pos = {};
  S.ruleOrder.forEach((id, i) => { pos[id] = i; });
  return [...S.rules].sort((a, b) => {
    const ai = pos[a.id] != null ? pos[a.id] : 9999;
    const bi = pos[b.id] != null ? pos[b.id] : 9999;
    return ai - bi;
  });
}

function onRuleReorder(fromId, toId) {
  const ordered = getOrderedRules();
  const fi = ordered.findIndex(r => r.id === fromId);
  const ti = ordered.findIndex(r => r.id === toId);
  if (fi < 0 || ti < 0) return;
  const [moved] = ordered.splice(fi, 1);
  ordered.splice(ti, 0, moved);
  S.ruleOrder = ordered.map(r => r.id);
  persist(); renderAllRules();
}

// ─── RENDERING ────────────────────────────────────────────────────────────

export function renderAllRules() {
  const el = $('all-rules-list'); if (!el) return;

  const searchVal  = ($('rules-search')?.value || '').toLowerCase();
  const showAll    = $('show-sys-rules')?.checked ?? S.showSystemRules;
  S.showSystemRules = showAll;

  let rules = getOrderedRules();
  if (!showAll)           rules = rules.filter(r => !r.hidden);
  if (S.activeTagFilter)  rules = rules.filter(r => (r.tags || []).includes(S.activeTagFilter));
  if (searchVal)          rules = rules.filter(r =>
    (r.name   || '').toLowerCase().includes(searchVal) ||
    (r.desc   || '').toLowerCase().includes(searchVal) ||
    (r.prompt || '').toLowerCase().includes(searchVal)
  );

  if (!rules.length) {
    el.innerHTML = '<div style="font-size:10px;color:var(--text3);padding:6px 0">No rules match filters.</div>';
    renderTagFilters(); return;
  }

  const compact = S.ruleViewMode === 'compact';
  el.innerHTML = rules.map(r => compact ? _cardCompact(r) : _cardDetailed(r)).join('');
  renderTagFilters();
  ddSetOnDrop(onRuleReorder);

  const btn = $('view-toggle-btn');
  if (btn) btn.textContent = compact ? '\u229e' : '\u2261';
}

function _ddAttrs(id) {
  return `draggable="true"
    ondragstart="ddHandleDragStart(event,'${id}')"
    ondragend="ddHandleDragEnd(event)"
    ondragover="ddHandleDragOver(event,'${id}')"
    ondragleave="ddHandleDragLeave(event)"
    ondrop="ddHandleDrop(event,'${id}')"`;
}

function _cardCompact(r) {
  const active = S.activeRuleId === r.id;
  const tags   = (r.tags || []).slice(0, 2).map(t => renderTagBadge(t)).join('');
  return `<div class="rcard compact${active ? ' on' : ''}${r.hidden ? ' r-hidden' : ''}"
    onclick="selectRule('${r.id}')" ${_ddAttrs(r.id)}>
    <span class="drag-handle" title="Drag to reorder">&#x2807;</span>
    <span class="rcard-cn">${esc(r.name)}</span>
    <span class="rcard-tags">${tags}</span>
    <div class="rcard-actions">
      <button class="btn xs" onclick="event.stopPropagation();openEditor('${r.id}')" title="Edit">edit</button>
      <button class="btn xs ghost" onclick="event.stopPropagation();hideRule('${r.id}',${!r.hidden})"
        title="${r.hidden ? 'Show rule' : 'Hide rule'}">${r.hidden ? 'show' : 'hide'}</button>
      <button class="btn xs dn" onclick="event.stopPropagation();delRule(this,'${r.id}')" title="Delete">&#x2715;</button>
    </div>
  </div>`;
}

function _cardDetailed(r) {
  const active = S.activeRuleId === r.id;
  const tags   = (r.tags || []).map(t => renderTagBadge(t)).join('');
  return `<div class="rcard${active ? ' on' : ''}${r.hidden ? ' r-hidden' : ''}"
    onclick="selectRule('${r.id}')" ${_ddAttrs(r.id)}>
    <div class="rcard-n">
      <span class="drag-handle" style="margin-right:4px">&#x2807;</span>
      ${esc(r.name)}
      ${r.badge ? `<span class="bdg ${r.cls || 'b-df'}">${esc(r.badge)}</span>` : ''}
      ${tags ? `<span class="rcard-tags-inline">${tags}</span>` : ''}
    </div>
    <div class="rcard-d">${esc(r.desc || r.prompt.slice(0, 60) + '…')}</div>
    <div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap">
      <button class="btn xs" onclick="event.stopPropagation();openEditor('${r.id}')">edit</button>
      <button class="btn xs ghost" onclick="event.stopPropagation();hideRule('${r.id}',${!r.hidden})">${r.hidden ? 'show' : 'hide'}</button>
      <button class="btn xs dn" onclick="event.stopPropagation();delRule(this,'${r.id}')">&#x2715;</button>
    </div>
  </div>`;
}

export function renderTagFilters() {
  const el = $('rules-tag-filters'); if (!el) return;
  const entries  = Object.entries(S.ruleTags);
  const allStyle = !S.activeTagFilter
    ? 'background:var(--ac)22;color:var(--ac);border-color:var(--ac);cursor:pointer'
    : 'background:var(--bg3);color:var(--text3);border-color:var(--border);cursor:pointer';
  el.innerHTML =
    `<span class="tag-pill" style="${allStyle}" onclick="setRuleTagFilter(null)">All</span>` +
    entries.map(([tid, tag]) => {
      const active = S.activeTagFilter === tid;
      const c = tag.color || '#888';
      const style = active
        ? `background:${c}33;color:${c};border-color:${c};cursor:pointer`
        : 'background:var(--bg3);color:var(--text3);border-color:var(--border);cursor:pointer';
      return `<span class="tag-pill" style="${style}" onclick="setRuleTagFilter('${esc(tid)}')">${esc(tag.name)}</span>`;
    }).join('');
}

export function renderQuickRules() {
  const el = $('quick-rules'); if (!el) return;
  if (!S.rules.length) {
    el.innerHTML = '<div style="font-size:10px;color:var(--text3)">No rules loaded.</div>';
    return;
  }
  el.innerHTML = S.rules.map(r =>
    `<div class="rcard${S.editRuleId === r.id ? ' on' : ''}" onclick="openEditor('${r.id}')">
      <div class="rcard-n">${esc(r.name)}${(r.tags || []).slice(0, 1).map(t => renderTagBadge(t)).join('')}</div>
    </div>`
  ).join('');
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────

export function selectRule(id) {
  S.activeRuleId = S.activeRuleId === id ? null : id;
  renderAllRules(); updateSysPrev(); persist();
}

export function clearActiveRule() {
  S.activeRuleId = null; renderAllRules(); updateSysPrev(); persist();
}

export function setRuleTagFilter(tagId) {
  S.activeTagFilter = tagId || null; renderAllRules();
}

export function toggleRulesView() {
  S.ruleViewMode = S.ruleViewMode === 'compact' ? 'detailed' : 'compact';
  renderAllRules();
}

// All rules are hideable — no type check
export function hideRule(id, shouldHide) {
  const r = S.rules.find(x => x.id === id); if (!r) return;
  r.hidden = shouldHide;
  markDirty('rules'); renderAllRules();
  toast(shouldHide ? 'Rule hidden' : 'Rule visible', 'ok');
}

// All rules are deletable — no type guard
export function delRule(btn, id) {
  const r = S.rules.find(x => x.id === id); if (!r) return;
  confirmBtn(btn, () => {
    S.rules     = S.rules.filter(x => x.id !== id);
    S.ruleOrder = S.ruleOrder.filter(x => x !== id);
    if (S.activeRuleId === id) { S.activeRuleId = null; updateSysPrev(); }
    if (S.editRuleId   === id) newRuleEditor();
    markDirty('rules');
    renderAllRules(); renderQuickRules();
  });
}

export const delCustRule = delRule; // backward-compat alias

export function getSystemPrompt() {
  if (!$('sys-on')?.checked || !S.activeRuleId) return null;
  const r = S.rules.find(x => x.id === S.activeRuleId);
  return (r && !r.hidden) ? r.prompt : null;
}

export function updateSysPrev() {
  const s = getSystemPrompt();
  const e = $('sys-prev'); if (!e) return;
  if (s) { e.textContent = s; e.classList.remove('empty'); }
  else   { e.textContent = 'None selected'; e.classList.add('empty'); }
}

export function copyRule() {
  const s = getSystemPrompt();
  if (!s) { toast('No rule active', 'warn'); return; }
  navigator.clipboard.writeText(s); toast('Copied', 'ok');
}

// ─── EDITOR ───────────────────────────────────────────────────────────────

export function openEditor(id) {
  const r = S.rules.find(x => x.id === id); if (!r) return;
  const rn = $('rule-name'), rb = $('rule-body'), ind = $('edit-ind');
  if (rn) rn.value = r.name;
  if (rb) rb.value = r.prompt;
  if (ind) ind.textContent = '\u00b7 ' + r.name;
  S.editRuleId = id;
  renderTagPicker?.(id);
  // Switch to Edit tab
  document.querySelector('.panel:not(.r) .tab:nth-child(3)')?.click();
}

export function saveRule() {
  const name = $('rule-name')?.value.trim();
  const body = $('rule-body')?.value.trim();
  if (!name || !body) { toast('Name and prompt required', 'warn'); return; }
  if (S.editRuleId) {
    const r = S.rules.find(x => x.id === S.editRuleId);
    if (r) { r.name = name; r.prompt = body; toast('Rule updated', 'ok'); }
    else {
      const id = 'u-' + Date.now().toString(36);
      S.rules.push({ id, name, prompt:body, desc:'', tags:['custom'], hidden:false });
      S.editRuleId = id; toast('Rule saved', 'ok');
    }
  } else {
    const id = 'u-' + Date.now().toString(36);
    S.rules.push({ id, name, prompt:body, desc:'', tags:['custom'], hidden:false });
    S.editRuleId = id; toast('Rule saved', 'ok');
  }
  markDirty('rules');
  renderAllRules(); renderQuickRules(); updateSysPrev();
}

export function applyRule() {
  const body = $('rule-body')?.value.trim();
  const name = $('rule-name')?.value.trim() || 'Draft';
  if (!body) { toast('Prompt is empty', 'warn'); return; }
  let id = S.editRuleId;
  if (id) {
    const r = S.rules.find(x => x.id === id);
    if (r) { r.name = name; r.prompt = body; }
  } else {
    id = 'u-' + Date.now().toString(36);
    S.rules.push({ id, name, prompt:body, desc:'', tags:['custom'], hidden:false });
    S.editRuleId = id; renderQuickRules();
  }
  S.activeRuleId = id;
  markDirty('rules');
  renderAllRules(); updateSysPrev();
  toast('Rule applied', 'ok');
}

export function newRuleEditor() {
  const rn = $('rule-name'), rb = $('rule-body'), ind = $('edit-ind');
  if (rn) rn.value = ''; if (rb) rb.value = ''; if (ind) ind.textContent = '';
  const picker = $('rule-tag-picker'); if (picker) picker.innerHTML = '';
  S.editRuleId = null;
}
export const clearEditor = newRuleEditor;

// ─── FILE I/O ─────────────────────────────────────────────────────────────

// Save as CONFIGS/rules.json via FSA (falls back to download)
export async function saveRulesFile() {
  await saveConfigDirectly('rules');
}

// Load via file picker (falls back to file input) — accepts flat [], {templates,custom}, {tags,rules}
export async function loadRulesFile() {
  await loadConfigViaPicker('rules');
}

// Reload from CONFIGS/rules.json (fetch)
export async function reloadRules() {
  if (S.dirtyFlags.rules) {
    if (!confirm('Rules have unsaved changes. Reload from CONFIGS/rules.json anyway?')) return;
  }
  const raw = await loadConfigFile('rules.json', null);
  if (!raw) { toast('CONFIGS/rules.json not found', 'warn'); return; }
  const { rules, tags } = normalizeRulesData(raw);
  S.rules = rules; S.ruleOrder = [];
  if (Object.keys(tags).length) S.ruleTags = tags;
  S.activeRuleId = null;
  clearDirty('rules');
  renderAllRules(); renderQuickRules(); updateSysPrev();
  toast('Rules reloaded from CONFIGS/', 'ok');
}
