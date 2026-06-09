# ModelProbe v7

A modular, file-separated AI model testing interface.

## Project Structure

```
modelprobe-v7/
├── index.html                      # Minimal shell (~200 lines, no inline JS or CSS)
├── assets/
│   ├── css/
│   │   └── style.css               # All styles (extracted from v5)
│   ├── data/
│   │   ├── default-providers.json  # Default provider templates
│   │   ├── default-models.json     # Default model alias templates
│   │   ├── default-rules.json      # Built-in rule templates
│   │   └── default-prompts.json    # Batch prompt templates
│   └── js/
│       ├── main.js                 # Entry point — loads data, inits UI, exposes window globals
│       ├── state.js                # S object (single source of truth)
│       ├── storage.js              # localStorage helpers + persist/restore
│       ├── utils.js                # Pure helpers: $, esc, uid, toast, analyzeErr …
│       ├── views.js                # sv/lt/rt — view and tab switching
│       ├── api.js                  # sendMsg, stopStream, testConn
│       └── components/
│           ├── providers.js        # Provider CRUD + renderProvList
│           ├── models.js           # Model alias CRUD + resolveModel
│           ├── rules.js            # Rule selection + editor logic
│           ├── chat.js             # Session CRUD + message rendering
│           ├── log.js              # Request log panel
│           ├── history.js          # Session history panel
│           ├── context.js          # Context window viewer
│           └── batch.js            # Batch testing panel
```

## Running

> ⚠️ **ES modules + `fetch()` require a local HTTP server.** Opening `index.html`
> directly via `file://` will fail in Chrome/Edge due to CORS restrictions.

**Quickstart (pick any one):**

```bash
# Python
python3 -m http.server 8080

# Node (npx)
npx serve .

# VS Code
# Install "Live Server" extension → right-click index.html → Open with Live Server
```

Then open `http://localhost:8080` in your browser.

## Config Files

### providers.json
```json
{
  "openrouter": {
    "api_key": "sk-or-YOUR_KEY",
    "base_url": "https://openrouter.ai/api/v1"
  }
}
```

### models.json
```json
{
  "gpt-4o-mini": {
    "provider": "openai",
    "model": "gpt-4o-mini"
  }
}
```
The `provider` key must match a key in `providers.json`.  
The `model` value is the actual model ID sent to the API.

### rules.json
Exported from the Rules tab inside the app. Contains `templates` and `custom` arrays.

### prompts_template.json
Batch prompt templates. Exported from the Batch view.

## Browser Console Helpers

```js
mpStorageInfo()    // show localStorage keys and sizes
mpClearStorage()   // wipe all mp6_ keys (reload required)
```

## Module Dependency Graph

```
utils.js   ←── (nothing)
state.js   ←── (nothing)
storage.js ←── utils, state
views.js   ←── utils
providers  ←── utils, state, storage
models     ←── utils, state, storage, providers
rules      ←── utils, state, storage
chat       ←── utils, state, storage, models, providers, history, context
log        ←── utils, state, storage
history    ←── utils, state, chat
context    ←── utils, state, chat, rules, models
batch      ←── utils, state, models
api        ←── utils, state, storage, chat, log, history, context, rules, models
main       ←── everything (entry point)
```

No circular dependencies.

## Phase 2 Notes (not yet implemented)

- Convert dynamic `onclick="fn()"` handlers to event delegation with `data-*` attributes
- Add Vite/Parcel for bundling, minification, source maps, and hot reload
- Unit tests for `utils.js`, `storage.js`, and `api.js` (Vitest)
