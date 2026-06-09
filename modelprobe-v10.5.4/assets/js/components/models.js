// models.js — model alias CRUD, resolver, provider filter  V8.1
import { S } from '../state.js';
import { $, esc, ftag, toast, dl } from '../utils.js';
import { markDirty, clearDirty, saveConfigFile, loadConfigFile, persist,
         saveConfigDirectly, loadConfigViaPicker } from '../storage.js';
import { renderProvList } from './providers.js';

export function resolveModel(alias) {
  if (!alias) return null;
  const m = S.models[alias]; if (!m) return null;
  const p = S.providers[m.provider]; if (!p) return null;
  return { alias, baseUrl:(p.base_url||'').replace(/\/$/,''), apiKey:p.api_key||'', modelId:m.model, providerId:m.provider };
}

export function updateModelSel() {
  const filter = S.modelProvFilter;
  const sel    = $('model-sel'); if (!sel) return;
  let entries  = Object.entries(S.models);
  if (filter) entries = entries.filter(([, m]) => m.provider === filter);
  sel.innerHTML = '<option value="">&#8212; select model alias &#8212;</option>' +
    entries.map(([a]) =>
      `<option value="${esc(a)}"${S.activeAlias === a ? ' selected' : ''}>${esc(a)}</option>`
    ).join('');
  renderProvFilterSel();
}

export function filterModelsByProv(providerId) {
  S.modelProvFilter = providerId || null;
  updateModelSel();
  persist();
}

export function renderProvFilterSel() {
  const sel = $('model-prov-filter'); if (!sel) return;
  const provIds = [...new Set(Object.values(S.models).map(m => m.provider))]
    .filter(Boolean).sort();
  sel.innerHTML = '<option value="">All providers</option>' +
    provIds.map(p =>
      `<option value="${esc(p)}"${S.modelProvFilter === p ? ' selected' : ''}>${esc(p)}</option>`
    ).join('');
}

export function updateActiveModel() {
  const r = resolveModel(S.activeAlias);
  const ml = $('ml'); if (ml) ml.textContent = S.activeAlias || 'no model';
  const det = $('mdl-detail'); if (!det) return;
  if (r) det.innerHTML = `<span style="color:var(--ac)">${esc(r.modelId)}</span> <span style="color:var(--text3)">via</span> <span style="color:var(--text2)">${esc(r.providerId)}</span>`;
  else if (S.activeAlias) det.textContent = 'Provider not loaded';
  else det.textContent = '';
}

export function setAlias(alias) {
  S.activeAlias = alias;
  const sel = $('model-sel'); if (sel) sel.value = alias;
  updateActiveModel(); renderProvList();
  window.renderHist?.();
  persist();
  toast('Active: ' + alias, 'ok');
}

export function addModelToProv(provId) {
  const safe    = provId.replace(/[^a-z0-9]/gi, '_');
  const aliasEl = $('nm-alias-' + safe);
  const midEl   = $('nm-mid-' + safe);
  if (!aliasEl || !midEl) return;
  const alias = aliasEl.value.trim(), mid = midEl.value.trim();
  if (!alias || !mid) { toast('Alias and model ID required', 'warn'); return; }
  S.models[alias] = { provider: provId, model: mid };
  aliasEl.value = ''; midEl.value = '';
  markDirty('models');
  renderProvList(); updateModelSel();
  toast('Model added: ' + alias, 'ok');
}

export function delModel(alias) {
  delete S.models[alias];
  if (S.activeAlias === alias) { S.activeAlias = null; updateActiveModel(); }
  markDirty('models');
  renderProvList(); updateModelSel();
}

export async function loadMdlFile() {
  await loadConfigViaPicker('models');
}

export async function saveMdlFile() {
  await saveConfigDirectly('models');
}

export async function reloadModels() {
  if (S.dirtyFlags.models) {
    if (!confirm('models has unsaved changes. Reload from CONFIGS/models.json anyway?')) return;
  }
  const data = await loadConfigFile('models.json', null);
  if (!data) { toast('CONFIGS/models.json not found', 'warn'); return; }
  S.models = data;
  clearDirty('models');
  renderProvList(); updateModelSel();
  toast('Models reloaded from CONFIGS/', 'ok');
}
