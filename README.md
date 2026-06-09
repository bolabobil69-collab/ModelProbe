# ModelProbe

A modular, file-separated AI model testing interface. Chat, batch-test, and compare models across multiple providers — with context management, rules/system-prompt templates, and a Free Providers discovery tab.

---

## Running

> ⚠️ **ES modules + `fetch()` require a local HTTP server.** Opening `index.html` directly via `file://` will fail due to CORS restrictions.

### Quickstart (recommended)

```bash
# macOS / Linux
bash start.sh          # builds → serves on :8080
bash start.sh 9000     # custom port

# Windows
start.bat
start.bat 9000
```

Then open `http://localhost:8080`.

### Manual steps

```bash
python3 build.py          # produce dist/index.html
python3 serve.py          # serve dist/ on :8080
python3 serve.py 9000     # custom port
```

`build.py --watch` rebuilds automatically every 2 s on file change.

### Alternative (no build step, dev only)

```bash
python3 -m http.server 8080   # Python
npx serve .                   # Node
# or: VS Code Live Server extension → right-click index.html
```

---

## Project Structure

```
modelprobe/
├── index.html                        # Shell (~200 lines, no inline JS/CSS)
├── build.py                          # Bundler → dist/index.html
├── serve.py                          # Dev server with /api/ping + /api/save endpoints
├── start.sh / start.bat              # One-shot build + serve
├── package.json
├── CHANGELOG.md
├── CONFIGS/                          # Runtime config (auto-created on first run)
│   ├── providers.json
│   ├── models.json
│   ├── rules.json
│   └── prompts_template.json
└── assets/
    ├── css/
    │   └── style.css
    ├── data/
    │   ├── default-providers.json    # Shipped provider templates
    │   ├── default-models.json       # Shipped model alias templates
    │   ├── default-rules.json        # Built-in rule templates
    │   └── default-prompts.json      # Batch prompt templates
    └── js/
        ├── main.js                   # Entry point
        ├── state.js                  # S — single source of truth
        ├── storage.js                # localStorage + CONFIGS/ file I/O + migration
        ├── utils.js                  # Pure helpers: $, toast, uid, dl, ftag …
        ├── views.js                  # sv / lt / rt / pv — view and tab switching
        ├── api.js                    # sendMsg, stopStream, testConn, testFreeModel
        ├── dragdrop.js               # Drag-and-drop utilities
        └── components/
            ├── providers.js          # Provider CRUD + renderProvList
            ├── models.js             # Model alias CRUD + resolveModel
            ├── rules.js              # Rule selection + system-prompt editor
            ├── tags-manager.js       # Tag CRUD, color picker, tag picker
            ├── chat.js               # Session CRUD + message rendering + streaming
            ├── log.js                # Request log panel
            ├── history.js            # Session history panel
            ├── context.js            # Context window management + auto-summarise
            ├── batch.js              # Batch testing panel
            └── free-providers.js     # Free Providers discovery + test tab
```

---

## Config Files

Config files live in `CONFIGS/` (created automatically). You can also load/save them manually from within the app.

### providers.json

Keys are your provider names — they can be anything, but must match the `provider` field in `models.json`. Matching is **case-insensitive** (e.g. `"Huggingface"` matches a Free Providers source configured as `"huggingface"`).

```json
{
  "openrouter": {
    "api_key": "sk-or-...",
    "base_url": "https://openrouter.ai/api/v1"
  },
  "ollama": {
    "api_key": "ollama",
    "base_url": "http://localhost:11434/v1"
  }
}
```

**Shipped templates** (replace placeholder keys):

| Provider | Default base_url |
|---|---|
| openrouter | `https://openrouter.ai/api/v1` |
| openai | `https://api.openai.com/v1` |
| anthropic | `https://api.anthropic.com/v1` |
| groq | `https://api.groq.com/openai/v1` |
| together | `https://api.together.xyz/v1` |
| mistral | `https://api.mistral.ai/v1` |
| huggingface | `https://router.huggingface.co/v1` |
| google | `https://generativelanguage.googleapis.com/v1beta/openai` |
| ollama | `http://localhost:11434/v1` |
| lmstudio | `http://localhost:1234/v1` |

### models.json

```json
{
  "gpt-4o-mini": {
    "provider": "openai",
    "model": "gpt-4o-mini"
  },
  "claude-3-haiku": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001"
  }
}
```

`provider` must match a key in `providers.json` (case-insensitive). `model` is the raw model ID sent to the API.

### rules.json

Exported from the **Rules** tab. Contains `templates` (built-in) and `custom` (user-defined) arrays of system-prompt rule objects.

### prompts_template.json

Batch prompt templates. Exported from the **Batch** view.

---

## Views & Tabs

| Location | Name | Description |
|---|---|---|
| Left tab | **Providers** | Add, edit, test provider connections |
| Left tab | **Models** | Define model aliases (provider + model ID pairs) |
| Left tab | **Rules** | System-prompt templates with tag filtering |
| Left tab | **Tags** | Tag management for rules (colors, CRUD) |
| Main view | **Chat** | Streaming chat with active model + rule |
| Right panel | **Log** | Per-request log with timing and token counts |
| Right panel | **History** | Session history, rename, pin, export |
| Right panel | **Context** | Context window visualiser + auto-summarise settings |
| Main view | **Batch** | Run a prompt set across multiple models simultaneously |
| Main view | **Free Providers** | Discover and test free-tier models from OpenRouter, Groq, Cerebras, Mistral, Together, HuggingFace, and Google |

---

## Free Providers Tab

Discovers free/open models from seven sources without leaving the app.

| Source | Needs Key | Auto-discovers |
|---|---|---|
| OpenRouter | No | Yes |
| Cerebras | No | Yes |
| Groq | Yes | No |
| Mistral | Yes | No |
| Together | Yes | No |
| HuggingFace | Yes | No |
| Google AI Studio | Yes | No |

**Key lookup is case-insensitive** — a provider saved as `"Huggingface"` or `"Google"` in `providers.json` will be found correctly.

For sources that need a key, add the provider to `providers.json` first, then click **Fetch** or **⚡ Test** on any discovered model. Click **+ Add** to register a model into your `models.json` directly from the discovery results.

---

## Storage

State is split across two layers:

- **`localStorage`** — chat sessions, request logs, UI state, and last-used parameters. Keys prefixed `mp7_`.
- **`CONFIGS/` files** — `providers.json`, `models.json`, `rules.json`, `prompts_template.json`. Loaded on startup via `fetch()`. Saved via the `/api/save` endpoint (when `serve.py` is running), the browser File System Access API (Chrome/Edge), or manual download (Firefox/Safari).

`serve.py` exposes two extra endpoints:

```
GET  /api/ping   → { "ok": true }   — client detects local server presence
POST /api/save   → writes CONFIGS/<filename> on disk
```

This lets Firefox and Safari users save config changes to disk without needing the File System Access API.

---

## Module Dependency Graph

```
utils.js        ← (nothing)
state.js        ← (nothing)
storage.js      ← utils, state
views.js        ← utils
dragdrop.js     ← utils
providers       ← utils, state, storage
models          ← utils, state, storage, providers
rules           ← utils, state, storage
tags-manager    ← utils, state, storage
chat            ← utils, state, storage, models, providers, history, context
log             ← utils, state, storage
history         ← utils, state, chat
context         ← utils, state, chat, rules, models
batch           ← utils, state, models
free-providers  ← utils, state, storage, api
api             ← utils, state, storage, chat, log, history, context, rules, models
main            ← everything (entry point)
```

No circular dependencies.

---

## Browser Console Helpers

```js
mpStorageInfo()    // list localStorage keys and their sizes
mpClearStorage()   // wipe all mp7_ keys (reload required)
```

---

## Requirements

- Python 3.8+ (for `build.py` and `serve.py`)
- A modern browser (Chrome, Firefox, Safari, Edge)
- No npm install required to run — only needed if extending the build tooling
