// chat.js — session CRUD, auto-naming, message rendering (v9.5.0)
import { S } from '../state.js';
import { $, esc, ts, ms2s, estTok, toast } from '../utils.js';
import { persist, deleteLog } from '../storage.js';
import { resolveModel, updateActiveModel, updateModelSel } from './models.js';
import { renderProvList } from './providers.js';
import { updateSysPrev, renderAllRules } from './rules.js';

export function getActSess() {
  return S.sessions.find(s => s.id === S.activeSessionId) || null;
}

export function updateSessLbl() {
  const s = getActSess();
  const e = $('sess-lbl');
  if (e) e.textContent = s ? (s.name || ts(s.createdAt)) + ' · ' + (s.alias||'?') : 'No session';
}

/** Derive auto-name from first user message */
export function autoName(prompt) {
  const t = (prompt||'').trim().replace(/\s+/g,' ');
  return t.slice(0,40) + (t.length>40?'…':'');
}

export function newSession() {
  const r = resolveModel(S.activeAlias);
  const id = Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  const s  = {
    id, name:'', alias:S.activeAlias||'',
    provider: r?.providerId||'', model: r?.modelId||'',
    createdAt: new Date().toISOString(), messages:[],
    summary:   null,   // string | null — cached summary text (Phase 2)
    summaryAt: null,   // ISO timestamp — when summary was last generated
    pinnedIds: [],     // string[] — message ids that always survive trimming
    ruleId:    S.activeRuleId || null,  // snapshot active rule at session creation
  };
  S.sessions.unshift(s);
  S.activeSessionId = id;
  renderChat(); window.renderHist?.(); updateSessLbl(); persist();
}

export function clearSession(btn) {
  const s = getActSess(); if(!s||!s.messages.length) return;
  confirmBtn(btn, () => { s.messages = []; renderChat(); persist(); });
}

export function loadSession(id) {
  const s = S.sessions.find(x=>x.id===id); if(!s) return;
  S.activeSessionId = id;
  if (s.alias && S.models[s.alias]) {
    S.activeAlias = s.alias;
    const sel=$('model-sel'); if(sel) sel.value=s.alias;
    updateActiveModel(); renderProvList();
  }
  // Restore per-session rule — only if the session has a saved ruleId
  if (s.ruleId != null) {
    const ruleExists = S.rules.some(r => r.id === s.ruleId);
    if (ruleExists) {
      S.activeRuleId = s.ruleId;
    } else {
      toast('Session rule not found, using current rule', 'warn');
      // Leave S.activeRuleId unchanged
    }
    updateSysPrev(); renderAllRules();
  }
  renderChat(); window.renderHist?.(); updateSessLbl();
  window.renderCtx?.(); persist();
}

/** Called after first user message is sent */
export function maybeAutoName(sess, prompt) {
  if (!sess.name) {
    sess.name = autoName(prompt);
    updateSessLbl();
  }
  // Keep provider/model in sync with current alias
  const r = resolveModel(sess.alias);
  if (r) { sess.provider = r.providerId; sess.model = r.modelId; }
}

export function renameSession(id, newName) {
  const s = S.sessions.find(x=>x.id===id); if(!s) return;
  s.name = newName.trim() || autoName(s.messages.find(m=>m.role==='user')?.content||'Session');
  updateSessLbl(); window.renderHist?.(); persist();
}

export function deleteSession(btn, id) {
  confirmBtn(btn, () => { _doDeleteSession(id); });
}
function _doDeleteSession(id) {
  const sess = S.sessions.find(s => s.id === id);
  S.sessions = S.sessions.filter(s=>s.id!==id);
  // Cascade: remove logs belonging to this session
  S.logs = S.logs.filter(l=>l.sessionId!==id);
  // Best-effort: delete the .log file on disk (silent if server offline)
  if (sess) deleteLog(sess.id, sess.createdAt);
  if (S.activeSessionId===id) {
    S.activeSessionId = S.sessions[0]?.id||null;
    if (S.activeSessionId) { updateSessLbl(); renderChat(); }
    else {
      const m=$('msgs');
      if(m) m.innerHTML='<div class="empty"><div class="empty-i">⬡</div><p>No session. Start a new chat.</p></div>';
      const sl=$('sess-lbl'); if(sl) sl.textContent='No session';
    }
  }
  window.renderHist?.(); window.renderLog?.(); persist();
}

/**
 * Detect and wrap XML-like custom tag blocks before passing to marked.
 *
 * marked.js (gfm:true) passes unknown HTML-like tags verbatim to the browser,
 * which silently discards them and collapses their content into unstyled
 * flowing text. This affects any tag that isn't a valid HTML element — e.g.
 * <PLOT>, <STYLE>, <SETTING>, <role>, <npc_behavior>, <factions>, etc.
 *
 * Strategy: detect the ROOT-level opening tag of an XML block (optionally
 * indented), collect every line through its matching close tag, and wrap the
 * whole region in a fenced ```xml-block code block. marked renders it as
 * <pre><code class="language-xml-block"> — opaque, copyable, never misread
 * as HTML.
 *
 * A tag is treated as custom XML (not HTML) when EITHER:
 *   (a) its name contains at least one uppercase letter — real HTML elements
 *       are always lowercase, so <PLOT>, <STYLE>, <SETTING> can never be HTML
 *       regardless of what names the HTML spec defines, OR
 *   (b) its lowercase name is absent from the HTML_ELEMENTS allowlist.
 *
 * Rule (a) is the critical addition: without it, <STYLE>, <TITLE>, <SCRIPT>
 * etc. are wrongly treated as HTML and passed through unguarded.
 */
const HTML_ELEMENTS = new Set([
  'a','abbr','address','area','article','aside','audio','b','base','bdi',
  'bdo','blockquote','body','br','button','canvas','caption','cite','code',
  'col','colgroup','data','datalist','dd','del','details','dfn','dialog',
  'div','dl','dt','em','embed','fieldset','figcaption','figure','footer',
  'form','h1','h2','h3','h4','h5','h6','head','header','hgroup','hr',
  'html','i','iframe','img','input','ins','kbd','label','legend','li',
  'link','main','map','mark','menu','meta','meter','nav','noscript',
  'object','ol','optgroup','option','output','p','picture','pre',
  'progress','q','rp','rt','ruby','s','samp','script','search','section',
  'select','small','source','span','strong','style','sub','summary','sup',
  'table','tbody','td','template','textarea','tfoot','th','thead','time',
  'title','tr','track','u','ul','var','video','wbr'
]);

// Returns true when a tag name should be treated as a custom XML tag.
function isCustomXmlTag(name) {
  // Rule (a): any uppercase letter → cannot be a real HTML element.
  if (name !== name.toLowerCase()) return true;
  // Rule (b): lowercase name not in the HTML spec set.
  return !HTML_ELEMENTS.has(name.toLowerCase());
}

function wrapXmlBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;

  // Matches an opening (or self-closing) tag, optionally preceded by whitespace.
  // Group 1 = tag name.
  const OPEN_TAG_RE = /^\s*<([A-Za-z][A-Za-z0-9_:-]*)[\s/>]/;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(OPEN_TAG_RE);

    if (m && isCustomXmlTag(m[1])) {
      const tagName = m[1];
      const closeTag = `</${tagName}>`;
      const regionLines = [line];
      i++;
      // Consume all lines through the matching close tag.
      while (i < lines.length) {
        regionLines.push(lines[i]);
        if (lines[i].includes(closeTag)) { i++; break; }
        i++;
      }
      // Wrap the entire region so marked renders it as a preformatted block.
      out.push('```xml-block\n' + regionLines.join('\n') + '\n```');
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
}

/** Safely render markdown, falling back to escaped plain text */
function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && marked.parse) {
    try {
      // Normalise excessive blank lines (3+ newlines → 2) before parsing
      // to prevent compounded spacing when marked converts \n to <br>.
      // breaks:false lets markdown handle paragraph spacing via <p> tags
      // naturally, avoiding double-spacing from \n\n + <p> margin stacking.
      let normalised = (text || '').replace(/\n{3,}/g, '\n\n').trim();
      // Wrap XML-like custom tag blocks so marked doesn't pass them through
      // as raw HTML (which the browser collapses by discarding unknown tags).
      normalised = wrapXmlBlocks(normalised);
      marked.setOptions({ breaks: false, gfm: true });
      return marked.parse(normalised);
    } catch(e) { /* fall through */ }
  }
  // Fallback: plain text with line breaks preserved
  return '<p>' + esc(text||'').replace(/\n/g,'<br>') + '</p>';
}

/**
 * Post-process marked HTML: inject a "Copy" button into every <pre> block.
 * The button is absolutely positioned top-right inside the <pre> wrapper.
 * Binding happens later in bindCopyButtons().
 */
function injectCodeCopyButtons(html) {
  return html.replace(/(<pre[^>]*>)/g,
    '$1<button class="code-copy-btn" title="Copy code">Copy</button>'
  );
}

/** Copy text to clipboard, show brief feedback on the button */
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

/** Attach copy button handlers after render (called from renderChat) */
export function bindCopyButtons() {
  // Per-message copy buttons (Copy text / Copy MD)
  document.querySelectorAll('.msg-copy-btn').forEach(btn => {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => {
      const msgEl  = btn.closest('.msg');
      const mode   = btn.dataset.copy;
      const raw    = msgEl?.dataset.rawContent || '';
      if (mode === 'md') {
        copyToClipboard(raw, btn);
      } else {
        // plain: strip markdown, get text content of bubble
        const bubble = msgEl?.querySelector('.bubble');
        copyToClipboard(bubble ? bubble.innerText : raw, btn);
      }
    });
  });

  // Per-block copy buttons injected into <pre> elements
  document.querySelectorAll('.code-copy-btn').forEach(btn => {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const pre  = btn.closest('pre');
      const code = pre?.querySelector('code');
      const text = code ? code.innerText : (pre?.innerText || '');
      copyToClipboard(text, btn);
    });
  });
}

export function renderSummaryPill() {
  const hdr = document.querySelector('.chat-hdr');
  let mount = document.getElementById('chat-summary-mount');

  const s = getActSess();
  if (!s || !s.summary || !S.autoSummarise) {
    if (mount) mount.remove();
    return;
  }

  // Create mount point below the buttons row if it doesn't exist
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'chat-summary-mount';
    hdr.appendChild(mount);
  }

  const summTime = s.summaryAt
    ? new Date(s.summaryAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    : null;
  const timeLabel = summTime ? ` · summarised at ${summTime}` : '';

  const newerCount = s.summaryAt
    ? s.messages.filter(m => m.timestamp && m.timestamp > s.summaryAt && !m.error).length
    : 0;
  const isStale = newerCount > 0;

  const staleHtml = isStale
    ? `<div class="ctx-summary-warn">⚠ summary may be outdated (${newerCount} new message${newerCount!==1?'s':''}) — <button class="btn xs ghost" onclick="manualResummarise()">re-summarise</button></div>`
    : '';

  const summarisedCount = s.summaryAt
    ? s.messages.filter(m => m.timestamp && m.timestamp <= s.summaryAt && !m.error).length
    : s.messages.length;

  mount.innerHTML = `
    <div class="ctx-summary-pill">
      <div class="ctx-summary-divider">
        <span class="ctx-summary-label">── ${summarisedCount} earlier message${summarisedCount!==1?'s':''} summarised${timeLabel} ──</span>
        <button class="btn xs ghost ctx-summary-toggle" onclick="this.closest('.ctx-summary-pill').querySelector('.ctx-summary-body').classList.toggle('open')">▾ show summary</button>
      </div>
      ${staleHtml}
      <div class="ctx-summary-body">
        <div class="ctx-summary-text">${esc(s.summary)}</div>
      </div>
    </div>`;
}

export function renderChat() {
  const s = getActSess(), area=$('msgs'); if(!area) return;
  if (!s||!s.messages.length) {
    area.innerHTML='<div class="empty"><div class="empty-i">⬡</div><p>Load providers.json + models.json,<br>select a model, then type below.</p></div>';
    renderSummaryPill();
    return;
  }

  area.innerHTML = s.messages.map(renderMsg).join('');
  area.scrollTop = area.scrollHeight;
  bindCopyButtons();
  renderSummaryPill();
  window.renderChatCtxBar?.();
}

/** Show an animated "thinking" bubble while waiting for API */
export function showLoadingBubble() {
  const area = $('msgs'); if(!area) return;
  const existing = area.querySelector('.msg-loading');
  if (existing) return; // already showing
  const div = document.createElement('div');
  div.className = 'msg assistant msg-loading';
  div.innerHTML = '<div class="bubble loading-bubble"><span class="ldot"></span><span class="ldot"></span><span class="ldot"></span></div>';
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

export function hideLoadingBubble() {
  $('msgs')?.querySelector('.msg-loading')?.remove();
}

export function renderMsg(m) {
  const rawContent = (m.content || '').replace(/"/g, '&quot;');
  let h = `<div class="msg ${m.role}" data-raw-content="${rawContent}">`;

  if (m.thinking)
    h += `<details class="thkwrap"><summary>Thinking (~${estTok(m.thinking)} tok)</summary><div class="thkbody">${esc(m.thinking)}</div></details>`;

  if (m.error) {
    h += `<div class="errbub">
      <div class="err-code">${esc(m.error.code)}</div>
      <div class="err-ana">${esc(m.error.message)}</div>
      ${m.error.analysis?`<div class="err-ana" style="color:var(--text3)">${esc(m.error.analysis)}</div>`:''}
      ${(m.error.tips||[]).length?`<ul class="err-tips">${m.error.tips.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}
    </div>`;
  } else {
    // Markdown for assistant, plain (escaped) for user
    const bodyHtml = m.role === 'assistant'
      ? injectCodeCopyButtons(renderMarkdown(m.content || ''))
      : '<p>' + esc(m.content || '').replace(/\n/g,'<br>') + '</p>';
    if (m.role === 'user') {
      h += `<div class="bubble md-body" data-msg-id="${m.id}" ondblclick="startEditMsg('${m.id}')" title="Double-click to edit">${bodyHtml}</div>`;
    } else {
      h += `<div class="bubble md-body">${bodyHtml}</div>`;
    }

    // Hover toolbar — copy actions (assistant only) + pin (all non-error)
    const isPinned = (getActSess()?.pinnedIds || []).includes(m.id);
    h += `<div class="msg-toolbar">`;
    if (m.role === 'assistant' && m.content) {
      h += `<button class="btn xs ghost msg-copy-btn" data-copy="plain" title="Copy as plain text">Copy text</button>
        <button class="btn xs ghost msg-copy-btn" data-copy="md" title="Copy raw Markdown">Copy MD</button>`;
    }
    h += `<button class="btn xs ghost msg-pin-btn ${isPinned ? 'active' : ''}"
               onclick="togglePin('${m.id}')"
               title="${isPinned ? 'Unpin' : 'Pin message'}">📌</button>`;
    h += `</div>`;
  }

  if (m.meta) {
    const p=[];
    if(m.meta.latency)     p.push('⏱ '+ms2s(m.meta.latency));
    if(m.meta.ttft)        p.push('ttft '+ms2s(m.meta.ttft));
    if(m.meta.inputTokens) p.push('↑'+m.meta.inputTokens+'t');
    if(m.meta.outputTokens)p.push('↓'+m.meta.outputTokens+'t');
    if(m.meta.tokensPerSec) p.push(m.meta.tokensPerSec+'tok/s');
    if(m.meta.wordCount)    p.push(m.meta.wordCount+'w');
    if(p.length) h+=`<div class="msg-meta">${p.join(' · ')}</div>`;
  }
  return h+'</div>';
}

export function togglePin(msgId) {
  const s = getActSess();
  if (!s) return;
  const idx = s.pinnedIds.indexOf(msgId);
  if (idx === -1) s.pinnedIds.push(msgId);
  else s.pinnedIds.splice(idx, 1);
  renderChat();
  persist();
}

/** Export a single session as JSON (chat + its logs + context snapshot) */
export function exportSession(id) {
  const s = S.sessions.find(x=>x.id===id); if(!s){window.toast?.('Session not found','err');return;}
  const logs = S.logs.filter(l=>l.sessionId===id);
  const snap = {
    exportedAt: new Date().toISOString(),
    session: s,
    logs,
    contextSnapshot: {
      systemPrompt: window.getSystemPrompt?.()|| null,
      messageCount: s.messages.length,
      estimatedTokens: s.messages.reduce((a,m)=>a+Math.ceil(((m.content||'').split(/\s+/).filter(Boolean).length)*1.3),0),
    },
  };
  window.dl?.('session-'+id+'.json', JSON.stringify(snap,null,2));
  window.toast?.('Session exported','ok');
}

// ─── MESSAGE EDITING ──────────────────────────────────────────────────────

/**
 * Replace a user message bubble with an inline textarea for editing.
 * Triggered by double-click on a user bubble.
 */
export function startEditMsg(msgId) {
  const s = getActSess(); if (!s) return;
  const m = s.messages.find(x => x.id === msgId);
  if (!m || m.role !== 'user') return;

  // Find the rendered bubble element
  const bubbleEl = document.querySelector(`.bubble[data-msg-id="${msgId}"]`);
  if (!bubbleEl) return;

  // Replace bubble with textarea + confirm/cancel UI
  const escaped = (m.content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  bubbleEl.outerHTML = `
    <div class="msg-edit-wrap" data-edit-id="${msgId}">
      <textarea class="msg-edit-ta" id="edit-ta-${msgId}" rows="3">${esc(m.content || '')}</textarea>
      <div class="msg-edit-actions">
        <button class="btn xs" onclick="commitEditMsg('${msgId}')" title="Confirm (Enter)">✓</button>
        <button class="btn xs ghost" onclick="cancelEditMsg('${msgId}')" title="Cancel (Esc)">✕</button>
      </div>
    </div>`;

  // Focus and set up keyboard handlers
  const ta = document.getElementById('edit-ta-' + msgId);
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEditMsg(msgId); }
      if (e.key === 'Escape') { e.preventDefault(); cancelEditMsg(msgId); }
    });
    // Auto-grow
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }
}

/**
 * Confirm edit: truncate messages from edited message onward, re-send via sendMsg().
 */
export function commitEditMsg(msgId) {
  const s = getActSess(); if (!s) return;
  const ta = document.getElementById('edit-ta-' + msgId);
  if (!ta) return;
  const newContent = ta.value.trim();
  if (!newContent) { toast('Message cannot be empty', 'warn'); return; }

  // Find index of the edited message
  const idx = s.messages.findIndex(x => x.id === msgId);
  if (idx === -1) { renderChat(); return; }

  // Truncate from the edited message onward (removes it + all following)
  s.messages.splice(idx);
  persist();

  // Re-send as fresh prompt via sendMsg()
  const pinput = document.getElementById('pinput');
  if (pinput) {
    pinput.value = newContent;
    // Trigger sendMsg — uses window reference to avoid import cycle
    window.sendMsg?.();
  }
}

/**
 * Cancel edit: restore the original rendered message.
 */
export function cancelEditMsg(msgId) {
  renderChat();
}
