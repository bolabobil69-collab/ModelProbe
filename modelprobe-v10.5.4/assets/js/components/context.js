// context.js — context viewer with session selector + V10 token heuristic
import { S } from '../state.js';
import { $, esc, ctxW, toast, dl, estTok, confirmBtn } from '../utils.js';
import { persist, lsGet, lsSet, LS } from '../storage.js';
import { getActSess, renderChat } from './chat.js';
import { getSystemPrompt } from './rules.js';
import { resolveModel } from './models.js';

/**
 * Keep the last `k` user+assistant pairs from history.
 * Pinned messages (by id) always survive regardless of position.
 */
function trimToWindow(history, k, pinnedIds = []) {
  const pinSet = new Set(pinnedIds);
  const pinned = history.filter(m => pinSet.has(m.id));
  const unpinned = history.filter(m => !pinSet.has(m.id));

  const pairs = [];
  for (let i = 0; i < unpinned.length; i++) {
    if (unpinned[i].role === 'user') {
      const pair = [unpinned[i]];
      if (i + 1 < unpinned.length && unpinned[i + 1].role === 'assistant') {
        pair.push(unpinned[i + 1]);
        i++;
      }
      pairs.push(pair);
    }
  }

  const kept = pairs.slice(-k).flat();
  const seen = new Set();
  return [...pinned, ...kept].filter(m => !seen.has(m.id) && seen.add(m.id));
}

// ── T3-A: Significance classifier ─────────────────────────────────────────
/**
 * Returns true if a message is significant (long, has code, or is a system msg).
 * Used by trimToBudget to prefer dropping filler first.
 */
function isSignificant(msg) {
  if (!msg.content) return false;
  if (msg.content.length > 500) return true;
  if (/```|~~~/.test(msg.content)) return true;
  if (msg.role === 'system') return true;
  return false;
}

/**
 * Drop oldest non-pinned user+assistant pairs until total estimated
 * tokens fits within `budget`. Always drops pairs together (role-aware).
 * T3-A: Drops filler pairs first (oldest→newest), then significant pairs.
 */
function trimToBudget(history, budget, pinnedIds = []) {
  const pinSet = new Set(pinnedIds);

  // Build pairs from unpinned messages
  function buildPairs(unpinned) {
    const pairs = [];
    for (let i = 0; i < unpinned.length; i++) {
      if (unpinned[i].role === 'user') {
        const pair = [unpinned[i]];
        if (i + 1 < unpinned.length && unpinned[i + 1].role === 'assistant') {
          pair.push(unpinned[i + 1]);
          i++;
        }
        pairs.push(pair);
      }
    }
    return pairs;
  }

  const pinned   = history.filter(m => pinSet.has(m.id));
  const unpinned = history.filter(m => !pinSet.has(m.id));
  const pairs    = buildPairs(unpinned);

  // Separate into filler and significant, preserving original order
  const fillerPairs  = pairs.filter(p => !p.some(isSignificant));
  const sigPairs     = pairs.filter(p =>  p.some(isSignificant));

  // Drop order: filler oldest→newest, then significant oldest→newest
  const dropOrder = [...fillerPairs, ...sigPairs];

  let kept = new Set(pairs.map((_, i) => i));
  const pairTok = pairs.map(p => p.reduce((s, m) => s + estTok(m.content), 0));
  const pinnedTok = pinned.reduce((s, m) => s + estTok(m.content), 0);

  let total = pairs.reduce((s, p, i) => s + pairTok[i], 0) + pinnedTok;

  for (const dropPair of dropOrder) {
    if (total <= budget) break;
    const idx = pairs.indexOf(dropPair);
    if (idx !== -1 && kept.has(idx)) {
      kept.delete(idx);
      total -= pairTok[idx];
    }
  }

  const keptMsgs = pairs.filter((_, i) => kept.has(i)).flat();
  const seen = new Set();
  return [...pinned, ...keptMsgs].filter(m => !seen.has(m.id) && seen.add(m.id));
}

/**
 * Builds the final msgs[] array to send to the API.
 * Exported and called by api.js instead of the inline block.
 * T1-B: accepts maxTok param so budget reserve is accurate.
 */
export function buildContextMessages(sess, sys, role, prompt, r, maxTok = 1024) {
  const strategy   = S.contextStrategy   ?? 'budget';
  // T1-A: use contextTurns (turn count) not contextWindowSize (tokens) for window strategy
  const windowSize = S.contextTurns      ?? 20;
  const pinnedIds  = sess.pinnedIds      ?? [];

  // Build history from previous completed exchanges only.
  // The current outgoing message (role + prompt) is appended at the end of msgs[] separately.
  // If we include it in history too, it ends up in the API payload twice — once from the
  // history loop and once from the final msgs.push({role, content:prompt}).
  // We detect it as the last message in sess.messages matching role+content (just pushed in api.js).
  const allMsgs = (sess.messages || []).filter(m => !m.error && m.content && !m.partial);
  const lastMsg = allMsgs[allMsgs.length - 1];
  const isCurrentMsg = lastMsg && lastMsg.role === role && lastMsg.content === prompt;
  const history = isCurrentMsg ? allMsgs.slice(0, -1) : allMsgs;

  let trimmedHistory = history;
  let trimmed = false;

  if (strategy === 'window') {
    trimmedHistory = trimToWindow(history, windowSize, pinnedIds);
    trimmed = trimmedHistory.length < history.length;

  } else if (strategy === 'budget') {
    const winTokens = S.contextWindowSize || (r ? ctxW(r.modelId) : null);
    const sysTok    = sys ? estTok(sys) : 0;
    const promptTok = estTok(prompt);
    // T1-B: use 0.85 ceiling and subtract actual maxTok for proper reserve
    const budget = winTokens
      ? Math.floor(winTokens * 0.85) - sysTok - promptTok - maxTok
      : null;

    if (budget && budget > 0) {
      trimmedHistory = trimToBudget(history, budget, pinnedIds);
      trimmed = trimmedHistory.length < history.length;
    }
  }

  const msgs = [];

  // ── T2-A: Decouple summary injection from trimmed flag ──────────────────
  // Inject summary when it exists and covers messages in history,
  // regardless of whether trimming occurred.
  const hasSummary = S.autoSummarise && sess.summary;

  // T3-B: Staleness guard — skip injection if summary covers too few recent messages
  // FIX: msgsSinceSummary counts messages whose timestamp is strictly after summaryAt.
  // summaryAt is now set to the last summarised message's timestamp (not wall-clock),
  // so this count is accurate.
  const msgsSinceSummary = sess.summaryAt
    ? history.filter(m => m.timestamp && m.timestamp > sess.summaryAt).length
    : null;
  const summaryIsFresh = msgsSinceSummary === null || msgsSinceSummary <= 15;

  const summaryCoversDropped  = trimmed && sess.summaryAt;
  const summaryCoversHistory  = !trimmed && sess.summaryAt && history.some(
    m => m.timestamp && m.timestamp <= sess.summaryAt
  );

  if (hasSummary && summaryIsFresh && (summaryCoversDropped || summaryCoversHistory)) {
    // FIX: Only apply temporal filter when budget-trimming actually removed messages.
    // When history fits in budget (trimmed=false), all recent messages survive as-is —
    // injecting the summary without dropping them gives the model full context + summary.
    // When trimming did occur, filter to post-summary messages to avoid overlap with
    // messages the summary already compressed.
    if (trimmed) {
      trimmedHistory = trimmedHistory.filter(
        m => !m.timestamp || m.timestamp > sess.summaryAt
      );
    }
    const anchor = `[Context summary — covers the conversation up to this point. `
      + `The session is ongoing; messages below are the most recent exchanges.]\n\n`
      + sess.summary;
    msgs.push({ role: 'system', content: anchor });
  } else if (hasSummary && summaryIsFresh && sess.summary && !sess.summaryAt) {
    // summaryAt missing — inject without temporal filter but still with anchor
    msgs.push({
      role: 'system',
      content: `[Context summary — earlier conversation compressed for brevity.`
        + ` Session is ongoing.]\n\n${sess.summary}`,
    });
  }

  if (sys && role !== 'system') msgs.push({ role: 'system', content: sys });
  for (const m of trimmedHistory) msgs.push({ role: m.role, content: m.content });
  msgs.push({ role, content: prompt });

  const estTokens2 = msgs.reduce((s, m) => s + estTok(m.content), 0);

  const winTokens = S.contextWindowSize || (r ? ctxW(r.modelId) : null);
  if (winTokens && estTokens2 > winTokens * 0.92) {
    toast('⚠ Context near limit — consider starting a new session', 'warn');
  }

  return { msgs, trimmed, estTokens: estTokens2 };
}

/** Plain-language strategy metadata */
const CTX_STRATEGIES = {
  budget: {
    label: 'Smart trim',
    badge: 'recommended',
    desc:  'Keeps as many recent messages as fit within the model\'s context window. Best for long conversations.',
  },
  window: {
    label: 'Fixed window',
    badge: null,
    desc:  'Always sends the last N exchanges. Predictable, but may cut off important earlier context.',
  },
  full: {
    label: 'Send everything',
    badge: null,
    desc:  'Sends the entire session history. Use only for short sessions — may exceed model limits.',
  },
};

/**
 * Dynamically renders the Context Strategy sub-section into the Params tab.
 */
export function renderCtxParams() {
  const el = $('ctx-params-mount');
  if (!el) return;

  const strategy   = S.contextStrategy ?? 'budget';
  const r          = resolveModel(S.activeAlias);
  const modelCtx   = r ? (ctxW(r.modelId) ?? null) : null;
  const manualCtx  = S.contextWindowSize ?? null;
  const turnWindow = S.contextTurns ?? 20;

  // ── Strategy selector options ──────────────────────────────────────────
  const optionsHtml = Object.entries(CTX_STRATEGIES).map(([val, meta]) => {
    const badge = meta.badge ? ` (${meta.badge})` : '';
    return `<option value="${val}" ${strategy === val ? 'selected' : ''}>${meta.label}${badge}</option>`;
  }).join('');

  // ── Context window placeholder ─────────────────────────────────────────
  const placeholderTxt = modelCtx
    ? `auto (model default: ${modelCtx.toLocaleString()})`
    : 'auto (model default)';

  // ── Turn window row (window strategy only) ────────────────────────────
  const windowRowHtml = strategy === 'window' ? `
    <div class="param-row">
      <label class="param-label">Turn window: <span id="ctx-turns-lbl">${turnWindow}</span> exchanges</label>
      <input type="range" min="4" max="40"
             value="${turnWindow}"
             oninput="setCtxTurns(+this.value)">
    </div>` : '';

  // T2-B: Auto-summarise advanced block — token% slider replaces message-count slider
  const summaryTokenPct = S.summaryTokenPct ?? 65;
  const advHtml = S.autoSummarise ? `
    <details class="ctx-adv-wrap">
      <summary class="ctx-adv-toggle">Advanced</summary>
      <div class="param-row" style="margin-top:6px">
        <label class="param-label">
          Summarise at <span id="ctx-summ-pct-lbl">${summaryTokenPct}</span>% context usage
        </label>
        <input type="range" min="40" max="90"
               value="${summaryTokenPct}"
               oninput="setSummaryTokenPct(+this.value)">
      </div>
      <div class="param-row">
        <button class="btn xs" onclick="manualResummarise()">Re-summarise now</button>
      </div>
    </details>` : '';

  el.innerHTML = `
    <div class="ctx-params-sep">Context</div>

    <div class="param-row">
      <label class="param-label">Strategy</label>
      <select id="ctx-strategy-sel" onchange="setCtxStrategy(this.value)">
        ${optionsHtml}
      </select>
      <div class="ctx-strategy-desc">${CTX_STRATEGIES[strategy].desc}</div>
      <div id="ctx-warnings-mount"></div>
    </div>

    ${windowRowHtml}

    <div class="param-row">
      <label class="param-label">
        Context window override
        <span class="param-hint">(tokens — leave blank to use model default)</span>
      </label>
      <input id="ctx-window-input" type="number" min="1000" step="1000"
             placeholder="${placeholderTxt}"
             value="${manualCtx ?? ''}"
             oninput="setCtxWindowSize(+this.value || null)">
      <div id="ctx-input-hint-mount"></div>
    </div>

    <div class="param-row">
      <label class="param-label" style="flex-direction:row;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="ctx-autosumm-chk"
               ${S.autoSummarise ? 'checked' : ''}
               onchange="setAutoSummarise(this.checked)">
        Auto-summarise old messages
      </label>
    </div>
    ${advHtml}

    <details id="ctx-preview-mount" class="ctx-preview-wrap" open>
      <summary class="ctx-adv-toggle">Preview what gets sent</summary>
      <div id="ctx-preview-body"></div>
    </details>
  `;

  _renderCtxWarnings();
  _renderCtxInputHint();
  renderCtxPreview();
}

/** Update only the warnings block — avoids full DOM rebuild that loses input focus. */
function _renderCtxWarnings() {
  const el = $('ctx-warnings-mount');
  if (!el) return;

  const strategy     = S.contextStrategy ?? 'budget';
  const r            = resolveModel(S.activeAlias);
  const modelCtx     = r ? (ctxW(r.modelId) ?? null) : null;
  const manualCtx    = S.contextWindowSize ?? null;
  const effectiveCtx = manualCtx || modelCtx;
  const warnings     = [];

  if (strategy === 'budget' && !r) {
    warnings.push('Select a model so budget can be calculated.');
  }
  if (strategy === 'window') {
    const turns    = S.contextTurns ?? 20;
    const sess     = getActSess();
    const msgCount = sess ? (sess.messages || []).filter(m => !m.error && m.content).length : 0;
    if (msgCount > 0 && turns * 2 < msgCount)
      warnings.push(`Window (${turns} turns) is smaller than this session — early messages will be dropped.`);
  }
  if (strategy === 'full' && effectiveCtx) {
    const sess       = getActSess();
    const sessTokens = sess
      ? (sess.messages || []).filter(m => !m.error && m.content && !m.partial)
          .reduce((s, m) => s + estTok(m.content), 0) : 0;
    if (sessTokens > effectiveCtx * 0.8)
      warnings.push(`Session (~${sessTokens.toLocaleString()} tok) may exceed model context limit (${effectiveCtx.toLocaleString()} tok).`);
    else if (sessTokens > effectiveCtx * 0.5)
      warnings.push(`Session is over 50% of the model context window — monitor usage.`);
  }

  el.innerHTML = warnings.map(w => `<div class="ctx-warning">⚠ ${w}</div>`).join('');
}

/** Update only the hint below ctx-window-input — avoids losing focus on the field. */
function _renderCtxInputHint() {
  const el = $('ctx-input-hint-mount');
  if (!el) return;

  const r         = resolveModel(S.activeAlias);
  const modelCtx  = r ? (ctxW(r.modelId) ?? null) : null;
  const manualCtx = S.contextWindowSize ?? null;

  if (!manualCtx) {
    el.innerHTML = `<div class="ctx-hint-ok">using model default${modelCtx ? ` (${modelCtx.toLocaleString()} tokens)` : ''}</div>`;
  } else if (manualCtx < 2000) {
    el.innerHTML = `<div class="ctx-warning">Value too low — minimum recommended is 2,000 tokens.</div>`;
  } else {
    el.innerHTML = '';
  }
}

export function setCtxStrategy(val) {
  S.contextStrategy = val;
  renderCtxParams();
  persist();
}

export function setCtxWindowSize(val) {
  S.contextWindowSize = val;
  _renderCtxWarnings();
  _renderCtxInputHint();
  renderCtxPreview();
  persist();
}

export function setCtxTurns(val) {
  S.contextTurns = val;
  const lbl = $('ctx-turns-lbl');
  if (lbl) lbl.textContent = val;
  _renderCtxWarnings();
  renderCtxPreview();
  persist();
}

export function setAutoSummarise(val) {
  S.autoSummarise = val;
  renderCtxParams();
  persist();
}

// T2-B: replaces setSummaryThreshold
export function setSummaryTokenPct(val) {
  S.summaryTokenPct = val;
  const lbl = $('ctx-summ-pct-lbl');
  if (lbl) lbl.textContent = val;
  persist();
}

/**
 * Renders the body of the "Preview what gets sent" section into #ctx-preview-body.
 * T1-B: passes default maxTok=1024 to buildContextMessages for accurate preview.
 */
export function renderCtxPreview() {
  const el = $('ctx-preview-body');
  if (!el) return;

  const sess = getActSess();
  const r    = resolveModel(S.activeAlias);
  const sys  = getSystemPrompt();

  const placeholder = '…';
  let previewData = null;
  if (sess) {
    try {
      previewData = buildContextMessages(sess, sys, 'user', placeholder, r, 1024);
    } catch (_) {}
  }

  if (!previewData) {
    el.innerHTML = '<div class="ctx-preview-row" style="color:var(--text3);font-size:10px">No active session.</div>';
    return;
  }

  const { msgs, trimmed, estTokens: totalEst } = previewData;

  const sessionHistory = (sess.messages || []).filter(m => !m.error && m.content && !m.partial);
  const sentHistory    = msgs.filter(m => m.role !== 'system' && m.content !== placeholder);
  const totalSession   = sessionHistory.length;
  const totalSent      = sentHistory.length;
  const dropped        = totalSession - totalSent;

  // Distinguish summary-covered from budget-trimmed in the preview label.
  // summaryCovered = messages intentionally excluded because the summary covers them (not budget pressure).
  // budgetDropped  = messages removed by trimToBudget/trimToWindow due to size constraints.
  const summaryCovered = S.autoSummarise && sess.summary && sess.summaryAt && !trimmed
    ? sessionHistory.filter(m => m.timestamp && m.timestamp <= sess.summaryAt).length
    : 0;
  const budgetDropped = Math.max(0, dropped - summaryCovered);

  const winTokens  = S.contextWindowSize || (r ? ctxW(r.modelId) : null);
  const sysTok     = sys ? estTok(sys) : 0;
  const histTok    = sentHistory.reduce((s, m) => s + estTok(m.content), 0);
  const displayTot = sysTok + histTok;

  const pct    = winTokens ? Math.min(100, Math.round(displayTot / winTokens * 100)) : null;
  const barCls = pct ? (pct > 85 ? 'crit' : pct > 60 ? 'warn' : '') : '';

  const droppedNote = budgetDropped > 0
    ? `<span class="ctx-preview-trimmed">✂ ${budgetDropped} trimmed</span>`
    : summaryCovered > 0
    ? `<span class="ctx-preview-trimmed" style="color:var(--text3)">📋 ${summaryCovered} in summary</span>`
    : '';

  const barHtml = winTokens && pct !== null ? `
    <div class="ctxbar-w ctx-preview-bar">
      <div class="ctxbar ${barCls}" style="width:${pct}%"></div>
    </div>` : '';

  el.innerHTML = `
    <div class="ctx-preview">
      <div class="ctx-preview-row">
        <span class="ctx-preview-lbl">Messages</span>
        <span class="ctx-preview-val">${totalSent} of ${totalSession} ${droppedNote}</span>
      </div>
      <div class="ctx-preview-row">
        <span class="ctx-preview-lbl">System prompt</span>
        <span class="ctx-preview-val">~${sysTok} tok</span>
      </div>
      <div class="ctx-preview-row">
        <span class="ctx-preview-lbl">History</span>
        <span class="ctx-preview-val">~${histTok} tok</span>
      </div>
      <div class="ctx-preview-row ctx-preview-total">
        <span class="ctx-preview-lbl">Total (excl. prompt)</span>
        <span class="ctx-preview-val">~${displayTot.toLocaleString()} tok${winTokens ? ` / ${winTokens.toLocaleString()}` : ''}</span>
      </div>
      ${barHtml}
    </div>`;
}

/**
 * Renders the mini token-fill bar above #msgs.
 * Called at the end of renderChat() in chat.js.
 */
export function renderChatCtxBar() {
  const bar = $('chat-ctx-bar');
  if (!bar) return;

  const s = getActSess();
  const r = resolveModel(S.activeAlias);
  const win = S.contextWindowSize || (r ? ctxW(r.modelId) : null);

  if (!s || !win) {
    bar.style.display = 'none';
    return;
  }

  const total = (s.messages || [])
    .filter(m => !m.error && m.content && !m.partial)
    .reduce((sum, m) => sum + estTok(m.content), 0);

  const pct    = Math.min(100, Math.round(total / win * 100));
  const barCls = pct > 85 ? 'crit' : pct > 60 ? 'warn' : '';
  const hidden = lsGet(LS.ui)?.ctxBarHidden ?? false;

  bar.style.display = '';
  bar.innerHTML = `
    <div class="chat-ctx-bar-inner ${hidden ? 'hidden' : ''}">
      <div class="ctxbar-w">
        <div class="ctxbar ${barCls}" style="width:${pct}%"></div>
      </div>
      <span class="ctx-bar-label">~${total.toLocaleString()} / ${win.toLocaleString()} tokens (${pct}%)</span>
      <button class="btn xs ghost ctx-bar-toggle" onclick="toggleCtxBar()">
        ${hidden ? 'show' : 'hide'}
      </button>
    </div>`;
}

export function toggleCtxBar() {
  const ui = lsGet(LS.ui) || {};
  ui.ctxBarHidden = !ui.ctxBarHidden;
  lsSet(LS.ui, ui);
  renderChatCtxBar();
}

// ── Phase 2 — Auto-summarise ──────────────────────────────────────────────

export async function summariseOldMessages(msgsToSummarise, r) {
  toast('Summarising context…', '');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (r.apiKey) headers['Authorization'] = 'Bearer ' + r.apiKey;

    const res = await fetch(r.baseUrl + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: r.modelId,
        max_tokens: 500,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'You are compressing a conversation that is STILL IN PROGRESS. '
              + 'Write 3–5 concise bullet points covering the key facts, decisions, entities, '
              + 'and unresolved threads so far. '
              + 'Do NOT treat this as a closing summary — the conversation will continue after this. '
              + 'Do NOT write phrases like "the conversation concluded" or "ended with". '
              + 'Write in present-tense where possible. Include any open questions or ongoing threads.',
          },
          ...msgsToSummarise.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: 'Provide the summary now.' },
        ],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;

  } catch (_) {
    return null;
  }
}

export async function manualResummarise() {
  const s = getActSess();
  const r = resolveModel(S.activeAlias);
  if (!s || !r) { toast('No active session or model', 'warn'); return; }
  const history = (s.messages || []).filter(m => !m.error && m.content && !m.partial);
  const summary = await summariseOldMessages(history, r);
  if (summary) {
    s.summary = summary;
    // FIX: summaryAt must be the timestamp of the last message that was summarised,
    // NOT the current wall-clock time. Setting it to now would make it newer than
    // all existing history messages, causing the temporal filter in buildContextMessages
    // to drop every message from the sent context (since none have timestamp > summaryAt).
    const lastMsg = history[history.length - 1];
    s.summaryAt = lastMsg?.timestamp ?? new Date().toISOString();
    persist();
    toast('Summary updated', 'ok');
  } else {
    toast('Summarise failed — check model connection', 'err');
  }
}



function getViewedSession() {
  const id = S.contextSessionId || S.activeSessionId;
  return S.sessions.find(s => s.id === id) || getActSess();
}

export function clearCtx(btn) {
  const s = getViewedSession();
  if (!s || !s.messages.length) { toast('Nothing to clear','warn'); return; }
  confirmBtn(btn, () => {
    s.messages = [];
    if (s.id === S.activeSessionId) renderChat();
    renderCtx(); persist();
    toast('Context cleared','ok');
  });
}

export function renderCtx() {
  _syncSessionSelector();
  const s   = getViewedSession();
  const el  = $('ctx-body'); if (!el) return;
  const isLive = s?.id === S.activeSessionId;

  if (!s || !s.messages.length) {
    el.innerHTML = `<div class="empty"><div class="empty-i">◎</div>
      <p>${s ? 'No messages in this session.' : 'Select a session above.'}</p></div>`;
    return;
  }

  const r       = resolveModel(s.alias||'');
  const modelId = r ? r.modelId : (s.model||s.alias||'');
  const sys     = getSystemPrompt();
  const sysTok  = sys ? estTok(sys) : 0;

  const msgs    = s.messages.filter(m => !m.error);
  const msgRows = msgs.map(m => {
    // T1-C: use centralised estTok for renderCtx rows
    const tok     = estTok(m.content);
    const wc      = (m.content||'').trim().split(/\s+/).filter(Boolean).length;
    const rc      = m.role==='user' ? 'var(--bl)' : m.role==='assistant' ? 'var(--ac)' : 'var(--text3)';
    const preview = (m.content||'').replace(/\n/g,' ').slice(0,55);
    return `<div class="ctx-mrow">
      <span class="ctx-role" style="color:${rc}">${esc(m.role)}</span>
      <span class="ctx-prev">${esc(preview)}${(m.content||'').length>55?'…':''}</span>
      <span class="ctx-wc">${wc}w</span>
      <span class="ctx-tok">~${tok}</span>
    </div>`;
  }).join('');

  // T1-C: use centralised estTok for totals
  const msgTok  = msgs.reduce((a,m) => a + estTok(m.content), 0);
  const total   = sysTok + msgTok;
  const win     = ctxW(modelId);
  const pct     = win ? Math.min(100, Math.round(total/win*100)) : null;
  const barCls  = pct ? (pct>85?'crit':pct>60?'warn':'') : '';

  let h = `
  <div style="margin-bottom:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <span style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3)">
        ${esc(s.name||s.alias||'Session')}${isLive?' <span style="color:var(--ac)">● live</span>':''}
      </span>
      <button class="btn xs" onclick="exportCtxSnapshot()">export snapshot</button>
    </div>
    <div style="font-size:11px;margin-bottom:4px">
      <span style="color:var(--ac);font-weight:600">~${total.toLocaleString()}</span>
      <span style="color:var(--text3)"> est. tokens</span>
      ${win
        ? `<span style="color:var(--text3)"> / ${win.toLocaleString()} (${pct}%)</span>`
        : '<span style="color:var(--text3)"> — window size unknown</span>'}
    </div>
    ${win&&pct!==null ? `<div class="ctxbar-w"><div class="ctxbar ${barCls}" style="width:${pct}%"></div></div>
      ${pct>85?'<div style="font-size:10px;color:var(--red);margin-top:2px">⚠ Near context limit</div>':''}` : ''}
  </div>`;

  if (sys) h += `
  <div style="margin-bottom:8px">
    <div style="font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text3);margin-bottom:3px">
      System Prompt</div>
    <div class="ctx-mrow" style="background:var(--pud)">
      <span class="ctx-role"><span class="bdg b-rp" style="font-size:8px">sys</span></span>
      <span class="ctx-prev">${esc(sys.slice(0,55))}${sys.length>55?'…':''}</span>
      <span class="ctx-wc">${(sys.split(/\s+/).filter(Boolean).length)}w</span>
      <span class="ctx-tok">~${sysTok}</span>
    </div>
  </div>`;

  h += `
  <div>
    <div style="font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text3);margin-bottom:3px">
      Messages (${msgs.length})</div>
    <div style="font-size:9px;color:var(--text3);margin-bottom:5px">
      word count &nbsp;·&nbsp; ~tokens = max(chars÷3.5, words×1.3)
    </div>
    ${msgRows}
  </div>
  <div style="font-size:9px;color:var(--text3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
    sys: ~${sysTok} · msgs: ~${msgTok} · total: ~${total}
    ${win ? ` · remaining: ~${(win-total).toLocaleString()}` : ''}
  </div>`;

  el.innerHTML = h;
}

function _syncSessionSelector() {
  const sel = $('ctx-session-sel'); if (!sel) return;
  sel.innerHTML = '<option value="">● Active session</option>' +
    S.sessions.map(s =>
      `<option value="${esc(s.id)}"${S.contextSessionId===s.id?' selected':''}>${esc(s.name||ts2(s.createdAt))}</option>`
    ).join('');
  if (S.contextSessionId) sel.value = S.contextSessionId;
}

function ts2(iso) {
  try { return new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
  catch(_){ return '—'; }
}

export function setCtxSession(id) {
  S.contextSessionId = id || null;
  renderCtx(); persist();
}

export function exportCtxSnapshot() {
  const s = getViewedSession();
  if (!s) { toast('No session','warn'); return; }
  const sys = getSystemPrompt();
  const msgs = s.messages.filter(m=>!m.error);
  const snap = {
    exportedAt: new Date().toISOString(),
    session: { id:s.id, name:s.name, provider:s.provider, model:s.model },
    systemPrompt: sys||null,
    messages: msgs.map(m=>({
      role:m.role, content:m.content,
      wordCount: (m.content||'').trim().split(/\s+/).filter(Boolean).length,
      estTokens: estTok(m.content),
    })),
    totals: {
      sysTokens: sys ? estTok(sys) : 0,
      msgTokens: msgs.reduce((a,m) => a + estTok(m.content), 0),
    },
  };
  snap.totals.total = snap.totals.sysTokens + snap.totals.msgTokens;
  dl('context-'+s.id+'.json', JSON.stringify(snap,null,2));
  toast('Context snapshot exported','ok');
}
