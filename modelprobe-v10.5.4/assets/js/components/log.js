// log.js — request log grouped by session (V7)
import { S } from '../state.js';
import { $, esc, ts, ms2s, toast, dl, confirmBtn } from '../utils.js';
import { persist, isServerLinked } from '../storage.js';
import { exportSession } from './chat.js';

export function renderLog() {
  const lc = $('lc'); if(lc) lc.textContent = '(' + S.logs.length + ')';
  const search = ($('lsearch')?.value||'').toLowerCase();
  const el = $('lentries'); if(!el) return;

  // ── Logging toggle + server status ───────────────────────────────────
  const serverOn = isServerLinked();
  const toggleEl = $('log-toggle');
  if (toggleEl) {
    toggleEl.textContent  = S.loggingEnabled ? '⏺ logging on' : '⏸ logging off';
    toggleEl.className    = 'btn xs' + (S.loggingEnabled && serverOn ? ' active' : '');
    toggleEl.title        = serverOn ? 'Toggle request file logging' : 'Start serve.py to enable file logging';
    toggleEl.disabled     = false;
    toggleEl.style.opacity = serverOn ? '1' : '0.45';
  }
  const warnEl = $('log-server-warn');
  if (warnEl) {
    warnEl.style.display = (!serverOn && S.loggingEnabled) ? '' : 'none';
  }

  // Build session map for quick lookup
  const sessMap = {};
  S.sessions.forEach(s => sessMap[s.id] = s);

  // Group logs by sessionId
  const grouped = {};
  const order   = [];
  S.logs.forEach(l => {
    const sid = l.sessionId || '_orphaned';
    if (!grouped[sid]) { grouped[sid] = []; order.push(sid); }
    grouped[sid].push(l);
  });

  // Filter
  const filteredOrder = order.filter(sid => {
    if (!search) return true;
    const s = sessMap[sid];
    if ((s?.name||'').toLowerCase().includes(search)) return true;
    if ((s?.model||'').toLowerCase().includes(search)) return true;
    if ((s?.provider||'').toLowerCase().includes(search)) return true;
    return grouped[sid].some(l =>
      l.prompt.toLowerCase().includes(search) ||
      (l.response||'').toLowerCase().includes(search)
    );
  });

  if (!filteredOrder.length) {
    el.innerHTML = '<div class="empty"><div class="empty-i">◉</div><p>No log entries.</p></div>';
    return;
  }

  el.innerHTML = filteredOrder.map(sid => {
    const sess  = sessMap[sid];
    const logs  = grouped[sid];
    const name  = sess?.name || (sid==='_orphaned'?'Imported (pre-V7)':'Unknown session');
    const model = sess?.model || logs[0]?.model || '—';
    const prov  = sess?.provider || logs[0]?.provider || '—';
    const isOpen = S.logExpandedSessions[sid] !== false; // default open

    const logRows = logs.map(l => {
      const stats = [];
      if(l.meta?.latency)      stats.push(`<span class="sp2 hi">⏱ ${ms2s(l.meta.latency)}</span>`);
      if(l.meta?.inputTokens)  stats.push(`<span class="sp2">↑${l.meta.inputTokens}</span>`);
      if(l.meta?.outputTokens) stats.push(`<span class="sp2">↓${l.meta.outputTokens}</span>`);
      if(l.meta?.wordCount)    stats.push(`<span class="sp2">${l.meta.wordCount}w</span>`);
      if(l.error)  stats.push('<span class="sp2" style="color:var(--red)">ERR</span>');
      if(l.thinking) stats.push('<span class="sp2" style="color:var(--pu)">THINK</span>');
      return `<div class="lent${l.id===S.activeLogId?' on':''}${l.error?' er':''}"
                   onclick="viewLog('${l.id}')" style="margin-left:10px;border-left-width:2px">
        <div class="le-top">
          <span class="le-m">${esc(l.prompt)}</span>
          <span class="le-t">${ts(l.ts||l.timestamp)}</span>
        </div>
        <div class="le-s">${stats.join('')}</div>
      </div>`;
    }).join('');

    return `<div class="log-group" style="margin-bottom:8px">
      <div class="log-group-hdr" onclick="toggleLogGroup('${sid}')">
        <span class="lg-chevron">${isOpen?'▼':'▶'}</span>
        <span class="lg-name">${esc(name)}</span>
        <span class="lg-meta">${esc(prov)} → ${esc(model)}</span>
        <span class="lg-count">${logs.length} req</span>
        <div class="lg-actions" onclick="event.stopPropagation()">
          ${sid!=='_orphaned'?`<button class="btn xs" onclick="loadSessionFromLog('${sid}')">view</button>`:'' }
          <button class="btn xs" onclick="exportSessionLogs('${sid}')">export</button>
        </div>
      </div>
      ${isOpen ? `<div class="log-group-body">${logRows}</div>` : ''}
    </div>`;
  }).join('');
}

export function toggleLogGroup(sid) {
  S.logExpandedSessions[sid] = S.logExpandedSessions[sid] === false ? true : false;
  renderLog(); persist();
}

export function loadSessionFromLog(sid) {
  window.loadSession?.(sid);
  window.rt?.('hist', document.querySelector('.panel.r .tab:nth-child(2)'));
}

export function exportSessionLogs(sid) {
  const logs = S.logs.filter(l=>l.sessionId===sid);
  const sess = S.sessions.find(s=>s.id===sid);
  dl('logs-'+sid+'.json', JSON.stringify({
    exportedAt:new Date().toISOString(), session:sess||{id:sid}, logs
  },null,2));
  toast('Session logs exported','ok');
}

export function viewLog(id) {
  S.activeLogId = S.activeLogId===id ? null : id;
  const l = S.logs.find(x=>x.id===id);
  const det = $('ldet');
  if (!l||!S.activeLogId) { det?.classList.remove('open'); renderLog(); return; }
  det.classList.add('open');
  const m = l.meta||{};
  det.innerHTML = `
    <div class="ld-h">
      <span style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3)">
        ${esc(l.alias||l.model)} · ${ts(l.ts||l.timestamp)}
      </span>
      <button class="btn xs ghost"
        onclick="S.activeLogId=null;document.getElementById('ldet').classList.remove('open');renderLog()">✕</button>
    </div>
    <div class="ld-s"><div class="ld-l">Model</div>
      <div class="ld-v" style="color:var(--ac)">${esc(l.model)} via ${esc(l.provider||'?')}</div></div>
    <div class="ld-s"><div class="ld-l">Prompt</div><div class="ld-v">${esc(l.prompt)}</div></div>
    ${l.sys?`<div class="ld-s"><div class="ld-l">System</div>
      <div class="ld-v" style="color:var(--text3)">${esc(l.sys)}</div></div>`:''}
    ${l.thinking?`<div class="ld-s"><div class="ld-l">Thinking</div>
      <div class="ld-v" style="color:var(--pu)">${esc(l.thinking)}</div></div>`:''}
    ${l.response?`<div class="ld-s"><div class="ld-l">Response</div>
      <div class="ld-v"><pre class="log-response-pre">${esc(l.response.trim())}</pre></div></div>`:''}
    ${l.error?`<div class="ld-s"><div class="ld-l">Error</div>
      <div class="ld-v er">${esc(l.error.code)}: ${esc(l.error.message)}
${esc(l.error.analysis)}
${(l.error.tips||[]).map((t,i)=>`${i+1}. ${t}`).join('\n')}</div></div>`:''}
    <div class="ld-s"><div class="ld-l">Stats</div>
      <div class="sgrid">
        <span class="k">Latency</span><span>${ms2s(m.latency||0)}</span>
        <span class="k">TTFT</span><span>${ms2s(m.ttft||0)}</span>
        <span class="k">Gen time</span><span>${ms2s(m.genTime||0)}</span>
        <span class="k">Input tok</span><span>${m.inputTokens||'—'}</span>
        <span class="k">Output tok</span><span>${m.outputTokens||'—'}</span>
        <span class="k">Words</span><span>${m.wordCount||'—'}</span>
        <span class="k">Temp</span><span>${l.params?.temp??'—'}</span>
        <span class="k">Max tok</span><span>${l.params?.maxTok??'—'}</span>
      </div>
    </div>`;
  renderLog();
}

export function clearLogs(btn) {
  if (!S.logs.length) return;
  confirmBtn(btn, () => {
    S.logs = []; S.activeLogId = null;
    $('ldet')?.classList.remove('open');
    renderLog(); persist(); toast('Logs cleared','ok');
  });
}

export function exportLogs() {
  if (!S.logs.length) { toast('No logs','warn'); return; }
  dl('modelprobe-logs-'+new Date().toISOString().slice(0,10)+'.json',
    JSON.stringify({exportedAt:new Date().toISOString(),
                    totalEntries:S.logs.length, logs:S.logs},null,2));
  toast('Logs exported','ok');
}

export function exportGlobal() {
  dl('modelprobe-export-'+new Date().toISOString().slice(0,10)+'.json',
    JSON.stringify({
      exportedAt: new Date().toISOString(),
      sessions:   S.sessions,
      logs:       S.logs,
      providers:  S.providers,
      models:     S.models,
    },null,2));
  toast('Full export done','ok');
}

export function clearAll(btn) {
  confirmBtn(btn, () => {
    S.sessions=[]; S.logs=[]; S.activeSessionId=null; S.activeLogId=null;
    $('ldet')?.classList.remove('open');
    renderLog(); window.renderHist?.(); window.renderCtx?.(); persist();
    const msgs=$('msgs');
    if(msgs)msgs.innerHTML='<div class="empty"><div class="empty-i">⬡</div><p>All data cleared.</p></div>';
    const sl=$('sess-lbl'); if(sl)sl.textContent='No session';
    toast('All data cleared','ok');
  });
}

export function toggleLogging() {
  S.loggingEnabled = !S.loggingEnabled;
  persist();
  renderLog();
  toast(S.loggingEnabled ? 'Request logging enabled' : 'Request logging paused', 'ok');
}
