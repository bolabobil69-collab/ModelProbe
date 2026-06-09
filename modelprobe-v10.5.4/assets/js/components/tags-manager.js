// tags-manager.js — V8.1: all tags deletable, stored in rules.json
import { S } from '../state.js';
import { $, esc, toast, confirmBtn } from '../utils.js';
import { markDirty } from '../storage.js';

// ─── BADGE ────────────────────────────────────────────────────────────────

export function renderTagBadge(tagId) {
  const tag = S.ruleTags[tagId];
  if (!tag) return '';
  const c = tag.color || '#888';
  return `<span class="tag-pill" style="background:${c}22;color:${c};border-color:${c}55">${esc(tag.name)}</span>`;
}

// ─── TAG MANAGER UI ───────────────────────────────────────────────────────

export function toggleTagManager() {
  const body   = $('tag-manager-body');
  const toggle = $('tag-manager-toggle');
  if (!body) return;
  const opening = body.style.display === 'none';
  body.style.display = opening ? 'block' : 'none';
  if (toggle) toggle.textContent = opening ? '\u25b2 manage' : '\u25bc manage';
  if (opening) renderTagsList();
}

export function renderTagsList() {
  const el = $('tags-list'); if (!el) return;
  const ids = Object.keys(S.ruleTags);
  if (!ids.length) {
    el.innerHTML = '<div style="font-size:10px;color:var(--text3)">No tags defined.</div>';
    return;
  }
  el.innerHTML = ids.map(tid => {
    const t = S.ruleTags[tid];
    const c = t.color || '#888';
    // Count rules using this tag
    const usage = S.rules.filter(r => (r.tags || []).includes(tid)).length;
    return `<div class="tag-mgr-row">
      <span class="tag-pill" style="background:${c}22;color:${c};border-color:${c}55;flex-shrink:0">${esc(t.name)}</span>
      <span style="font-size:9px;color:var(--text3);flex:1">${usage} rule${usage !== 1 ? 's' : ''}</span>
      <input type="color" value="${esc(c)}" title="Change colour"
        onchange="updateTagColor('${esc(tid)}',this.value)"
        style="width:22px;height:22px;padding:1px;cursor:pointer;border:none;background:none;flex-shrink:0">
      <button class="btn xs dn" onclick="deleteTag(this,'${esc(tid)}')" title="Delete tag">&#x2715;</button>
    </div>`;
  }).join('');
}

export function updateTagColor(tagId, color) {
  if (!S.ruleTags[tagId]) return;
  S.ruleTags[tagId].color = color;
  markDirty('rules');
  renderTagsList(); renderAllRules?.(); renderTagFilters?.();
}

export function addNewTag() {
  const nameEl  = $('new-tag-name');
  const colorEl = $('new-tag-color');
  const name    = nameEl?.value.trim();
  if (!name) { toast('Tag name required', 'warn'); return; }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18);
  const id   = (slug || 'tag') + '-' + Date.now().toString(36).slice(-4);
  const color = colorEl?.value || '#6366f1';
  S.ruleTags[id] = { name, color };
  if (nameEl) nameEl.value = '';
  markDirty('rules');
  renderTagsList(); renderTagFilters?.();
  toast('Tag added: ' + name, 'ok');
}

// All tags deletable — no built-in guard in V8.1
export function deleteTag(btn, tagId) {
  const tag = S.ruleTags[tagId];
  if (!tag) return;
  confirmBtn(btn, () => {
    delete S.ruleTags[tagId];
    S.rules.forEach(r => {
      if (Array.isArray(r.tags)) r.tags = r.tags.filter(t => t !== tagId);
    });
    if (S.activeTagFilter === tagId) S.activeTagFilter = null;
    markDirty('rules');
    renderTagsList(); renderAllRules?.(); renderTagFilters?.();
  });
}

// ─── TAG PICKER (rule editor) ─────────────────────────────────────────────

export function renderTagPicker(ruleId) {
  const el = $('rule-tag-picker'); if (!el) return;
  const rule       = S.rules.find(r => r.id === ruleId);
  const activeTags = rule?.tags || [];
  const entries    = Object.entries(S.ruleTags);
  if (!entries.length) {
    el.innerHTML = '<span style="font-size:10px;color:var(--text3)">No tags defined.</span>';
    return;
  }
  el.innerHTML = entries.map(([tid, tag]) => {
    const active = activeTags.includes(tid);
    const c = tag.color || '#888';
    const style = active
      ? `background:${c}33;color:${c};border-color:${c};cursor:pointer`
      : 'background:var(--bg3);color:var(--text3);border-color:var(--border);cursor:pointer';
    return `<span class="tag-pill" style="${style}"
      onclick="toggleRuleTag('${esc(ruleId)}','${esc(tid)}')"
      title="${active ? 'Remove' : 'Add'} tag">${esc(tag.name)}</span>`;
  }).join('');
}

export function toggleRuleTag(ruleId, tagId) {
  const rule = S.rules.find(r => r.id === ruleId); if (!rule) return;
  if (!Array.isArray(rule.tags)) rule.tags = [];
  const idx = rule.tags.indexOf(tagId);
  if (idx >= 0) rule.tags.splice(idx, 1);
  else          rule.tags.push(tagId);
  markDirty('rules');
  renderTagPicker(ruleId); renderAllRules?.();
}
