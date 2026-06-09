// utils.js — pure helper functions, no state dependencies
export const $ = id => document.getElementById(id);
export const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
export const ts  = iso => new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
export const ms2s = ms => ms < 1000 ? ms+'ms' : (ms/1000).toFixed(1)+'s';
export function estTok(text) {
  const t = (text || '').trim();
  if (!t) return 0;
  const byChars = Math.ceil(t.length / 3.5);
  const byWords = Math.ceil(t.split(/\s+/).filter(Boolean).length * 1.3);
  return Math.max(byChars, byWords);
}
export const ftag = (id,txt,cls) => { const e=$(id); if(e){e.textContent=txt; e.className='ftag '+cls;} };
export const ucc  = () => { const e=$('cci'); if(e) e.textContent = $('pinput').value.length+' ch'; };
export const dl   = (name,text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text],{type:'application/json'}));
  a.download = name; a.click();
};

export function toast(msg, type='') {
  const e = document.createElement('div');
  e.className = 'toast '+(type==='ok'?'ok':type==='err'?'er':type==='warn'?'wn':'');
  e.textContent = msg;
  $('toasts').appendChild(e);
  setTimeout(() => e.remove(), 2600);
}

// Context-window sizes (tokens) keyed by partial model-name substring
export const CTX_WIN = {
  // OpenAI
  'gpt-4o': 128000, 'gpt-4-turbo': 128000, 'gpt-3.5': 16385,
  'o1': 128000, 'o3': 200000, 'o4': 200000,
  // Anthropic
  'claude-3-5': 200000, 'claude-3': 200000, 'claude-2': 100000,
  'claude-sonnet-4': 200000, 'claude-opus-4': 200000,
  // Meta
  'llama-3': 128000, 'llama3': 128000,
  // Mistral
  'mistral-large': 128000, 'mistral-small': 32000, 'mistral': 32768, 'mixtral': 32768,
  // Google
  'gemini': 1000000, 'gemma-3': 128000, 'gemma2': 8192, 'gemma': 8192,
  // xAI
  'grok-3': 131072, 'grok-2': 131072, 'grok': 128000,
  // Other
  'deepseek': 64000, 'phi': 128000, 'qwen': 128000,
  'nemotron': 128000, 'glm': 128000, 'kimi': 128000,
};
export const ctxW = modelId => {
  const l = (modelId||'').toLowerCase();
  for (const [k,v] of Object.entries(CTX_WIN)) if (l.includes(k)) return v;
  return null;
};

export function analyzeErr(status, msg) {
  const e = {code:`Error ${status||0}`, message:msg||'Unknown error', analysis:'', tips:[]};
  if (status===401) {
    e.analysis='Authentication failed — token invalid, expired, or missing.';
    e.tips=['Check token format (sk-... prefix for most providers).','No extra whitespace in the key value.','OpenRouter may need an HTTP-Referer header.'];
  } else if (status===403) {
    e.analysis='Forbidden — account lacks permission for this model.';
    e.tips=['Check plan tier — some models need paid access.','Verify model ID is accessible with your account.'];
  } else if (status===404) {
    e.analysis='Not found — endpoint URL or model ID is wrong.';
    e.tips=['No trailing slash on base_url.','Model ID is case-sensitive.','OpenRouter: format is provider/model-name.'];
  } else if (status===429) {
    e.analysis='Rate limited — too many requests.';
    e.tips=['Wait before retrying.','Check quota on provider dashboard.'];
  } else if (status===400) {
    if ((msg||'').toLowerCase().match(/context|token|length/)) {
      e.analysis='Context overflow — prompt+response exceeds model token limit.';
      e.tips=['Reduce max_tokens.','Start a new session.'];
    } else {
      e.analysis='Bad request — invalid parameter value.';
      e.tips=['Check temperature (0–2).','Check max_tokens within model limit.'];
    }
  } else if (status>=500) {
    e.analysis='Provider server error — usually temporary.';
    e.tips=['Retry in a few seconds.','Try a different model.'];
  } else if (!status) {
    e.code='Network Error';
    e.analysis='Cannot reach endpoint.';
    e.tips=['Verify base_url in providers.json.','Ollama: set OLLAMA_ORIGINS=* env var.','Check internet connection.'];
  }
  return e;
}

/**
 * Double-confirm helper for destructive buttons.
 * First click: turns button red, changes label to "sure?".
 * Second click within 2.5s: calls onConfirm().
 * Clicking elsewhere or waiting resets to original state.
 */
export function confirmBtn(btn, onConfirm) {
  if (btn._confirming) {
    // Second click — confirmed
    clearTimeout(btn._confirmTimer);
    btn._confirming = false;
    btn.textContent = btn._origLabel;
    btn.classList.remove('confirm-armed');
    onConfirm();
    return;
  }
  // First click — arm
  btn._origLabel = btn.textContent;
  btn._confirming = true;
  btn.textContent = 'sure?';
  btn.classList.add('confirm-armed');
  // Reset on outside click
  function reset(e) {
    if (e && e.target === btn) return;
    clearTimeout(btn._confirmTimer);
    btn._confirming = false;
    btn.textContent = btn._origLabel;
    btn.classList.remove('confirm-armed');
    document.removeEventListener('click', reset);
  }
  btn._confirmTimer = setTimeout(() => reset(), 2500);
  document.addEventListener('click', reset);
}
