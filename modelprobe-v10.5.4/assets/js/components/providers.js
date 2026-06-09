// providers.js — provider CRUD + rendering  V8.1
import { S } from '../state.js';
import { $, esc, ftag, toast, confirmBtn } from '../utils.js';
import { markDirty, clearDirty, saveConfigFile, loadConfigFile, persist,
         saveConfigDirectly, loadConfigViaPicker } from '../storage.js';

export function renderProvList() {
  const el = $('prov-list');
  const ids = Object.keys(S.providers);
  if (!ids.length) {
    el.innerHTML = '<div class="empty" style="padding:10px"><p>No providers loaded.<br>Place providers.json in CONFIGS/ and reload, or add one manually.</p></div>';
    return;
  }
  el.innerHTML = ids.map(pid => {
    const p    = S.providers[pid];
    const exp  = S.expandedProv === pid;
    const safe = pid.replace(/[^a-z0-9]/gi, '_');
    const mdls = Object.entries(S.models).filter(([, m]) => m.provider === pid);
    const mdlRows = mdls.map(([alias, m]) => {
      const act = S.activeAlias === alias;
      return `<div class="model-row${act ? ' act' : ''}">
        <span class="mr-alias" style="${act ? 'color:var(--ac)' : ''}" title="${esc(alias)}">${esc(alias)}</span>
        <span class="mr-id"    title="${esc(m.model)}">${esc(m.model)}</span>
        ${act
          ? '<span class="bdg b-ok" style="font-size:8px;flex-shrink:0">ACT</span>'
          : `<button class="btn xs" onclick="setAlias('${esc(alias)}')" style="flex-shrink:0">set</button>`}
        <button class="btn xs dn" onclick="delModel('${esc(alias)}')" style="flex-shrink:0">&#x2715;</button>
      </div>`;
    }).join('');

    return `<div class="pcard">
      <div class="pcard-h${exp ? ' open' : ''}" onclick="toggleProv('${esc(pid)}')">
        <span class="pcard-id">${esc(pid)}</span>
        <span class="pcard-url">${esc((p.base_url || '').replace(/https?:\/\//, ''))}</span>
        <span style="color:var(--text3);font-size:10px">${exp ? '▲' : '▼'}</span>
      </div>
      <div class="pcard-body${exp ? ' open' : ''}">
        <div class="ig"><label>Base URL</label>
          <input type="text" value="${esc(p.base_url || '')}"
            oninput="updateProvField('${esc(pid)}','base_url',this.value)" placeholder="https://...">
        </div>
        <div class="ig"><label>API Key</label>
          <div style="position:relative">
            <input type="password" id="pk-${safe}" value="${esc(p.api_key || '')}"
              oninput="updateProvField('${esc(pid)}','api_key',this.value)" placeholder="sk-...">
            <button id="pkb-${safe}" onclick="toggleProvKey('${safe}')"
              style="position:absolute;right:7px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text3);font-family:var(--mono);font-size:10px;cursor:pointer">show</button>
          </div>
        </div>
        <div style="margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text3)">
            Models (${mdls.length})
          </span>
          <button class="btn xs dn" onclick="delProv(this,'${esc(pid)}')">remove provider</button>
        </div>
        ${mdlRows || '<div style="font-size:10px;color:var(--text3);margin-bottom:6px">No models linked.</div>'}
        <div class="add-form">
          <div class="add-form-title">+ Add Model</div>
          <div class="irow">
            <input type="text" id="nm-alias-${safe}" placeholder="alias"    style="font-size:10px;padding:4px 6px">
            <input type="text" id="nm-mid-${safe}"   placeholder="model id" style="font-size:10px;padding:4px 6px">
            <button class="btn xs ac" onclick="addModelToProv('${esc(pid)}')">+</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Unlinked models warning
  const unlinked = Object.entries(S.models).filter(([, m]) => !S.providers[m.provider]);
  if (unlinked.length) {
    el.innerHTML += `<div style="margin-top:8px">
      <div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--yw);margin-bottom:5px">
        &#x26A0; Unlinked Models (provider not loaded)
      </div>
      ${unlinked.map(([alias, m]) => `<div class="model-row">
        <span class="mr-alias">${esc(alias)}</span>
        <span class="mr-id" style="color:var(--yw)">${esc(m.provider)} &#x2192; ${esc(m.model)}</span>
        <button class="btn xs dn" onclick="delModel('${esc(alias)}')">&#x2715;</button>
      </div>`).join('')}
    </div>`;
  }
}

export function toggleProv(id) {
  S.expandedProv = S.expandedProv === id ? null : id;
  renderProvList();
}

export function addProv() {
  const id  = $('np-id')?.value.trim();
  const url = $('np-url')?.value.trim();
  const key = $('np-key')?.value.trim();
  if (!id) { toast('Provider ID required', 'warn'); return; }
  S.providers[id] = { api_key: key || '', base_url: url || '' };
  $('np-id').value = ''; $('np-url').value = ''; $('np-key').value = '';
  S.expandedProv = id;
  markDirty('providers');
  renderProvList(); _syncModelSel();
  toast('Provider added: ' + id, 'ok');
}

export function delProv(btn, id) {
  confirmBtn(btn, () => {
    delete S.providers[id];
    markDirty('providers');
    renderProvList(); _syncModelSel();
  });
}

export function updateProvField(id, field, val) {
  if (!S.providers[id]) return;
  S.providers[id][field] = val;
  markDirty('providers');
}

export function toggleProvKey(safe) {
  const e = $('pk-' + safe); if (!e) return;
  e.type = e.type === 'password' ? 'text' : 'password';
  const b = $('pkb-' + safe); if (b) b.textContent = e.type === 'password' ? 'show' : 'hide';
}

export async function loadProvFile() {
  await loadConfigViaPicker('providers');
}

export async function saveProvFile() {
  await saveConfigDirectly('providers');
}

export async function reloadProviders() {
  if (S.dirtyFlags.providers) {
    if (!confirm('providers has unsaved changes. Reload from CONFIGS/providers.json anyway?')) return;
  }
  toast('Reloading providers…', 'ok');
  const data = await loadConfigFile('providers.json', null);
  if (!data) { toast('CONFIGS/providers.json not found', 'warn'); return; }
  S.providers = data;
  clearDirty('providers');
  renderProvList(); _syncModelSel();
  toast('Providers reloaded from CONFIGS/', 'ok');
}

function _syncModelSel() { window.updateModelSel?.(); }
