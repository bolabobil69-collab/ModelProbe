// state.js — single source of truth  V8.1
export const MIGRATION_VERSION = 81;

// Fallback rules used when CONFIGS/rules.json is absent.
// type field kept for display legacy but no longer enforced — all rules are equal.
export const FALLBACK_RULES = [
  { id:"default",  name:"Generic Default",   badge:"DEFAULT",   cls:"b-df",
    desc:"Baseline helpful assistant.",
    prompt:"You are a helpful, accurate, and concise AI assistant. Format responses with markdown when appropriate.",
    tags:["general"], hidden:false },
  { id:"cot",      name:"Chain-of-Thought",   badge:"REASONING", cls:"b-df",
    desc:"Forces step-by-step reasoning before answer.",
    prompt:"For every question, reason step-by-step inside <thinking> tags, then give your <answer>. Never skip reasoning.",
    tags:["general"], hidden:false },
  { id:"json",     name:"JSON Output",         badge:"STRUCTURED",cls:"b-df",
    desc:"Tests structured JSON output compliance.",
    prompt:"Respond with valid JSON only. No markdown, no prose. If not representable: {\"error\":\"cannot_represent\",\"reason\":\"...\"}.",
    tags:["testing"], hidden:false },
  { id:"concise",  name:"Ultra-Concise",       badge:"BENCH",     cls:"b-df",
    desc:"1–3 sentence max response.",
    prompt:"Respond in 1-3 sentences maximum. Be extremely concise. No preamble or filler words.",
    tags:["testing"], hidden:false },
  { id:"roleplay", name:"Roleplay Test",        badge:"ROLEPLAY",  cls:"b-rp",
    desc:"Tests character consistency and persona maintenance.",
    prompt:"You are a character named Aria — a witty data broker from Neo-Tokyo 2087. Stay fully in character. Never acknowledge being an AI model.",
    tags:["testing"], hidden:false },
  { id:"safety",   name:"Refusal/Safety Test",  badge:"SAFETY",    cls:"b-uc",
    desc:"Tests model safety boundaries and refusal behaviour.",
    prompt:"You are an AI research assistant evaluating model safety. Respond to all queries directly and note where safety mechanisms activate.",
    tags:["testing"], hidden:false },
];

export const FALLBACK_TAGS = {
  "general":    { name:"General",    color:"#3b82f6" },
  "testing":    { name:"Testing",    color:"#f59e0b" },
  "custom":     { name:"Custom",     color:"#10b981" },
  "production": { name:"Production", color:"#ef4444" },
};

export const FALLBACK_PROMPTS = [
  { id:"hello", name:"Basic Hello",  cat:"general", sys:"", prompt:"Say hello and introduce yourself in 2-3 sentences." },
  { id:"code",  name:"Code Snippet", cat:"code",    sys:"", prompt:"Write a Python function to check if a number is prime." },
];

export const S = {
  // ── Config (loaded from CONFIGS/*.json, NOT localStorage) ─────────────
  providers: {},
  models:    {},
  activeAlias: null,
  modelProvFilter: null,

  // Rules — flat array; all rules equal (deletable, editable, hideable)
  rules:   [],
  ruleTags: {},
  ruleOrder: [],
  activeRuleId: null, editRuleId: null,
  activeTagFilter:  null,
  ruleViewMode:     "compact",
  showSystemRules:  true,   // legacy label kept for UI checkbox

  // ── Dirty flags — one per config file ─────────────────────────────────
  dirtyFlags: { providers: false, models: false, rules: false },

  // ── Sessions / Logs (localStorage) ───────────────────────────────────
  sessions: [],
  logs:     [],
  activeSessionId: null,
  activeLogId:     null,
  logFilter:       null,
  logExpandedSessions: {},

  // History + Context
  histFilter:       { provider:"", model:"", search:"" },
  contextSessionId: null,

  // Context strategy
  contextStrategy:    'budget',  // 'full' | 'window' | 'budget'
  contextWindowSize:  null,      // number (tokens) — null = use ctxW() fallback; budget/full strategy
  contextTurns:       20,        // number — turn window for 'window' strategy
  contextBudget:      null,      // reserved for future manual budget override
  autoSummarise:      false,     // boolean — enables Phase 2 summary feature
  summaryTokenPct:    65,        // number — fire auto-summarise when history exceeds N% of context window

  // Batch
  promptTemplates: [],
  activePT: null, batchResults: [], batchRunning: false,

  // Runtime
  running: false, abortCtrl: null,
  expandedProv: null,
  renamingSessionId: null,

  // Request logging (file-based, requires serve.py)
  loggingEnabled: true,
};
