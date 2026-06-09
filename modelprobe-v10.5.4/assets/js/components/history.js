// history.js — session history with filters, inline rename, per-session actions (V7)
import { S } from '../state.js';
import { $, esc, ts, toast, confirmBtn } from '../utils.js';
import { persist, deleteAllLogs } from '../storage.js';
import { loadSession, deleteSession, renameSession, exportSession } from './chat.js';

export function renderHist() {
  const hc = $('hc'); if(hc) hc.textContent = '(' + S.sessions.length + ')';
  _syncFilterUI();

  const { provider, model, search } = S.histFilter;
  let list = S.sessions.filter(s => s.id !== '_orphaned');

  if (provider) list = list.filter(s => (s.provider||'').toLowerCase().includes(provider.toLowerCase()));
  if (model)    list = list.filter(s => (s.model||s.alias||'').toLowerCase().includes(model.toLowerCase()));
  if (search)   list = list.filter(s =>
    (s.name||'').toLowerCase().includes(search.toLowerCase()) ||
    s.messages.some(m => m.content && m.content.toLowerCase().includes(search.toLowerCase()))
  );

  const el = $('hlist'); if(!el) return;
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="empty-i">◎</div>
      <p>${S.sessions.length ? 'No sessions match filters.' : 'No sessions yet.'}</p></div>`;
    return;
  }

  el.innerHTML = list.map(s => {
    const logCount  = S.logs.filter(l=>l.sessionId===s.id).length;
    const msgCount  = (s.messages||[]).length;
    const isActive  = s.id === S.activeSessionId;
    const isRename  = S.renamingSessionId === s.id;

    return `<div class="hrow${isActive?' hrow-active':''}">
      <div class="hrow-name">
        ${isRename
          ? `<input class="hrow-rename-input" id="rename-${s.id}"
               value="${esc(s.name||'')}"
               onkeydown="commitRename(event,'${s.id}')"
               onblur="commitRename(event,'${s.id}')">`
          : `<span class="hrow-title" onclick="loadSession('${s.id}')"
               title="${esc(s.name||ts(s.createdAt))}">${esc(s.name||'(unnamed)')}</span>`
        }
      </div>
      <div class="hrow-meta">
        <span class="hrow-prov" title="${esc(s.provider)}">${esc(s.provider||'—')}</span>
        <span class="hrow-model" title="${esc(s.model)}">${esc((s.model||s.alias||'—').split('/').pop())}</span>
        <span class="hrow-msgs">${msgCount}m ${logCount}r</span>
        <span class="hrow-date">${_relTime(s.createdAt)}</span>
      </div>
      <div class="hrow-actions">
        <button class="btn xs" onclick="loadSession('${s.id}')">load</button>
        <button class="btn xs" onclick="startRename('${s.id}')">rename</button>
        <button class="btn xs" onclick="exportSession('${s.id}')">export</button>
        <button class="btn xs dn" onclick="deleteSession(this,'${s.id}')">del</button>
      </div>
    </div>`;
  }).join('');

  // Auto-focus rename input if active
  if (S.renamingSessionId) {
    const inp = $('rename-'+S.renamingSessionId);
    if (inp) { inp.focus(); inp.select(); }
  }
}

export function startRename(id) {
  S.renamingSessionId = id;
  renderHist();
}

export function commitRename(event, id) {
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== 'Escape') return;
  const inp = $('rename-'+id);
  const val = inp ? inp.value.trim() : '';
  if (event.key !== 'Escape' && val) renameSession(id, val);
  S.renamingSessionId = null;
  renderHist();
}

export function setHistFilter(field, value) {
  S.histFilter[field] = value;
  renderHist(); persist();
}

export function clearHistFilters() {
  S.histFilter = { provider:'', model:'', search:'' };
  _syncFilterUI(); renderHist(); persist();
}

function _syncFilterUI() {
  const sp=$('hf-provider'), sm=$('hf-model'), ss=$('hf-search');
  if(sp && sp.value !== S.histFilter.provider) sp.value = S.histFilter.provider;
  if(sm && sm.value !== S.histFilter.model)    sm.value = S.histFilter.model;
  if(ss && ss.value !== S.histFilter.search)   ss.value = S.histFilter.search;
}

function _relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff/60000);
  if (m <  1)  return 'just now';
  if (m <  60) return m+'m ago';
  const h = Math.floor(m/60);
  if (h <  24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}

export function exportAllSessions() {
  const { dl } = window;
  if (!S.sessions.length) { toast('No sessions','warn'); return; }
  dl('sessions-'+new Date().toISOString().slice(0,10)+'.json',
    JSON.stringify({exportedAt:new Date().toISOString(), sessions:S.sessions},null,2));
  toast('Sessions exported','ok');
}

export function clearHist(btn) {
  confirmBtn(btn, () => {
    // Capture before wipe so deleteAllLogs has the session list
    const toDelete = S.sessions.map(s => ({ id: s.id, createdAt: s.createdAt }));
    S.sessions=[]; S.activeSessionId=null;
    S.logs = S.logs.filter(l=>!l.sessionId || l.sessionId==='_orphaned');
    renderHist(); window.renderLog?.(); window.renderCtx?.(); persist();
    const msgs=$('msgs');
    if(msgs)msgs.innerHTML='<div class="empty"><div class="empty-i">⬡</div><p>History cleared.</p></div>';
    const sl=$('sess-lbl'); if(sl)sl.textContent='No session';
    toast('History cleared','ok');
    // Best-effort: delete all .log files on disk (silent if server offline)
    deleteAllLogs(toDelete);
  });
}
