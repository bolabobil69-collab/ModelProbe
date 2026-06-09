# ModelProbe — CHANGELOG

---

## [10.5.5] – 2026-06-09

### Fixed
- **Free Providers tab fails to find providers saved with non-lowercase names** — all provider lookups in the Free Providers tab used `S.providers[src.id]` with hardcoded lowercase keys (`'huggingface'`, `'google'`, etc.), but the Providers config allows any user-defined name. Providers saved as `"Huggingface"`, `"Google"`, `"HuggingFace"`, etc. were silently missed: discovery threw "No valid key" and test/add treated the provider as missing. Fixed by introducing `findProvider(id)`: tries exact key first, then falls back to a case-insensitive scan of `Object.keys(S.providers)`. All ten call sites (`sourceHasKey`, `fetchOpenAIShape`, `fetchMistral`, `fetchTogether`, `fetchHuggingFace`, `fetchGoogle`, `fpTestCard`, `fpTestAll`, `fpConfirmAdd`, `renderCard`) now use `findProvider` instead of direct bracket access.
  - Files: `assets/js/components/free-providers.js`

---

## [10.5.4] – 2026-06-08

### Fixed
- **Clicking a model card scrolls the list back to the top** — `renderFP()` replaces `el.innerHTML` entirely on every state change (expand, add, test, filter, source toggle). The browser resets `scrollTop` to `0` on every innerHTML replacement, so any interaction with a card below the fold would jump the viewport back to the top of the list. Fixed by reading `.fp-cards.scrollTop` immediately before the innerHTML replacement and writing it back immediately after, preserving the user's scroll position across all re-renders. The restore is a no-op when `prevScroll` is `0` (already at top) to avoid redundant assignments.
  - Files: `assets/js/components/free-providers.js`

---

## [10.5.3] – 2026-06-08

### Fixed
- **Model cards squash to ~8px height in "All" filter view** — The `.fp-cards` list is a `flex-direction: column` container sized to fill the panel (`flex: 1`). Each `.fp-card` child inherits the default `flex-shrink: 1`, so when the total natural height of all cards exceeds the container height (e.g. 43 cards × ~38px = ~1634px), flex compresses every card proportionally rather than triggering scroll. Cards rendered at roughly 8–10px, showing only residual text and colored action-button dots. The `overflow-y: auto` on `.fp-cards` never fired because flex shrink resolves before overflow is evaluated. Fixed by adding `flex-shrink: 0` to `.fp-card`, forcing cards to retain their natural height and letting the container scroll as intended. Single-source filtered views (Groq, OpenRouter) were unaffected because their smaller card counts didn't exceed the container height.
  - Files: `assets/css/style.css`

---

## [10.5.2] – 2026-06-08

### Fixed
- **XML-like custom tags collapsing in chat output** — marked.js (v12, `gfm: true`) passes unrecognised HTML-like tags verbatim to the browser, which silently discards them and merges their content into unstyled flowing text. Affected any assistant response containing custom XML tags such as `<PLOT>`, `<STYLE>`, `<SETTING>`, `<role>`, `<npc_behavior>`, `<factions>`, etc. (e.g. DreamGen-style structured prompts).
  Root cause had two parts: (1) the block detector only matched tags at column zero, missing indented openers; (2) tags whose names collide with real HTML elements — most critically `<STYLE>` — were incorrectly passed through because the allowlist check compared lowercased names, making `<STYLE>` indistinguishable from `<style>`. Fixed by introducing `isCustomXmlTag()`: a tag is treated as custom XML when its name contains any uppercase letter (real HTML is always lowercase in practice) OR when its lowercase name is absent from the HTML element allowlist. The block detector's regex now also allows optional leading whitespace so indented root tags are caught. Matched blocks are wrapped in a fenced ` ```xml-block ` code block before reaching marked, rendering as a monospaced preformatted block with a left accent border. Standard markdown, real HTML elements, and inline code are unaffected.
  - Files: `assets/js/components/chat.js`, `assets/css/style.css`

---

## [10.5.1] – 2026-06-08

### Changed
- **Test button color feedback** — The per-card ⚡ test button now turns green (`fp-test-btn-ok`) on success and red (`fp-test-btn-err`) on failure. Color state persists on the button until the next Fetch (same persistence rule as the result). Transitions are animated via CSS for a less jarring change.
  - Files: `assets/js/components/free-providers.js`, `assets/css/style.css`
- **Test result detail moved into expanded card section** — Removed the `fp-test-result-row` strip that appeared below the action row. Full test result (success latency + HTTP status, or full error message with code/reason) now appears at the top of the expanded `fp-card-desc` area when you click the card. This applies to both success (Q3-B) and failure outcomes. The button tooltip also shows the result summary for quick reference without expanding.
  - Files: `assets/js/components/free-providers.js`, `assets/css/style.css`

### Removed
- `fp-test-result-row`, `.fp-test-ok`, `.fp-test-err`, `.fp-test-running` CSS classes — replaced by `fp-test-detail`, `fp-test-detail-ok`, `fp-test-detail-err`, and `fp-card-desc-text`.
  - Files: `assets/css/style.css`

### Suggested test steps
1. Fetch any source. Click ⚡ on a model with a valid key — button should turn green after response.
2. Click ⚡ on a model with no key or a bad key — button should turn red.
3. Expand the card (click card body) — top of the expanded section should show the full result: `✓ OK · 312ms` or `✗ HTTP 401: Invalid key …`
4. Hover the ⚡ button — tooltip should show the result summary string.
5. Click Fetch again — all button colors and detail text should reset to default.
6. Run ⚡ Test All — verify all visible buttons update their color state correctly.

---

## [10.5.0] – 2026-06-07

### Added
- **Hugging Face Inference as a new free source** — Fetches models with `inference: warm` status from the HF Hub (public serverless tier, sorted by likes, top 40). Uses HF's OpenAI-compatible router at `https://router.huggingface.co/v1`. Requires an HF User Access Token (free account works). Added `huggingface` entry to `default-providers.json`.
  - Files: `assets/js/components/free-providers.js`, `assets/data/default-providers.json`
- **Google AI Studio (Gemini) as a new free source** — Fetches available Gemini models from `v1beta/models` and filters to free-tier Flash variants (`gemini-*-flash*`, excluding thinking variants). Uses Google's OpenAI-compatible endpoint at `https://generativelanguage.googleapis.com/v1beta/openai`. Requires an AI Studio API key (free, no credit card). Added `google` entry to `default-providers.json`.
  - Files: `assets/js/components/free-providers.js`, `assets/data/default-providers.json`
- **Per-card ⚡ Test button** — Each model card now has an inline ⚡ test button in the actions row (always visible, before adding). Fires a `POST /chat/completions` with `max_tokens:1` directly against that card's `baseUrl` and provider key — independent of the active alias. Result (`✓ OK · 312ms` or `✗ HTTP 401: …`) persists on the card until the next Fetch. Button shows ⏳ spinner while running and disables itself.
  - Files: `assets/js/components/free-providers.js`, `assets/js/api.js`, `assets/css/style.css`
- **Global ⚡ Test All button** — New button in the results header (right-aligned). Tests all currently visible/filtered models concurrently via `Promise.allSettled`. Shows a summary toast on completion: `N OK · N failed`. Disabled while fetching or a test-all is already running.
  - Files: `assets/js/components/free-providers.js`, `assets/css/style.css`
- **`testFreeModel(baseUrl, apiKey, modelId)`** — New exported pure utility in `api.js`. Fires a minimal completions probe, returns `{ ok, ms, msg }`. No UI side effects. Used by both per-card and global test.
  - Files: `assets/js/api.js`, `assets/js/main.js`

### Changed
- **Cerebras: switched to public discovery endpoint** — `fetchCerebras` now uses `https://api.cerebras.ai/public/v1/models?format=openrouter` (no API key required for browsing). The response includes a `pricing` field and a `deprecated` flag, enabling proper free-model detection: filter is `pricing.prompt === '0' && pricing.completion === '0' && !deprecated`. The static `CEREBRAS_FREE_IDS` allowlist is removed. Cerebras source now shows 👁 indicator (discoverable without key) instead of 🔑 (blocked without key).
  - Files: `assets/js/components/free-providers.js`
- **OpenRouter: tightened free filter** — Now checks both `pricing.prompt === '0'` and `pricing.completion === '0'` (previously only checked `prompt`). Also filters out models with null or zero `context_length` (dead/invalid listings).
  - Files: `assets/js/components/free-providers.js`
- **Mistral: replaced static allowlist with name-pattern heuristic** — `MISTRAL_FREE_IDS` was a hardcoded list that silently went stale as Mistral deprecated and added models. Replaced with: keep models where `id.startsWith('open-')` or matches `/mistral-small|devstral|codestral-mamba/`. Survives future model additions without code changes.
  - Files: `assets/js/components/free-providers.js`
- **`canDiscover` split from `sourceHasKey`** — Source checkbox now distinguishes between "can't browse (no key)" (🔑) and "can browse but not chat (no inference key)" (👁). OpenRouter and Cerebras are always browsable; their 🔑 badge is suppressed. Other sources still show 🔑 when no key is present.
  - Files: `assets/js/components/free-providers.js`, `assets/css/style.css`

### Suggested test steps
1. Open Free Providers tab. Verify all 7 sources appear (OpenRouter, Groq, Cerebras, Mistral, Together, HuggingFace, Google).
2. Cerebras and OpenRouter should show 👁 indicator even with no key configured, not 🔑.
3. Click Fetch with only OpenRouter and Cerebras checked (no keys needed). Both should return results.
4. Click Fetch with all sources. Sources without keys should show errors in the left panel, not block others.
5. After fetch, click ⚡ on any OpenRouter model. Should show ✓ OK (no key required for inference either) or a specific error if the model is restricted.
6. Click ⚡ Test All — verify all visible cards update and a summary toast appears.
7. Test results should survive navigating away from the Free panel and back. They should clear on the next Fetch.
8. Add a HuggingFace token in Config → Providers. Fetch again with HuggingFace checked. Models should appear with `HuggingFace` badge.
9. Add a Google AI Studio key in Config → Providers. Fetch again with Google checked. Gemini Flash models should appear with `Google` badge.
10. Add a model from HF or Google → confirm it appears in the model selector.
11. Confirm no `v10.4.0` strings remain anywhere (check title bar, logo, build output).

---

## [10.4.0] – 2026-06-06

### Added
- **System prompt per-session** — Each session now remembers the rule that was active when it was created (`sess.ruleId`). Loading a session restores `S.activeRuleId` to the saved rule and refreshes the system prompt preview. If the saved rule has since been deleted, a warning toast fires ("Session rule not found, using current rule") and the current rule is left unchanged. Pre-existing sessions (no `ruleId`) are unaffected.
  - Files: `assets/js/components/chat.js`
- **Inline message editing** — Double-clicking a user message bubble replaces it with an inline textarea pre-filled with the original content. Plain Enter confirms; Shift+Enter inserts a newline; Escape cancels. On confirm, all messages from the edited message onward are truncated and the edited content is re-sent via `sendMsg()`. Assistant messages are not editable.
  - Files: `assets/js/components/chat.js`, `assets/css/style.css`, `assets/js/main.js`
- **`confirmBtn()` helper** — A shared double-confirm utility in `utils.js`. First click turns the button red and changes its label to "sure?". A second click within 2.5 seconds confirms the action. Clicking elsewhere or waiting resets to the original state. No modal, no OS dialog.
  - Files: `assets/js/utils.js`, `assets/css/style.css`, `assets/js/main.js`

### Changed
- **Unified token estimator** — `tok()` in `utils.js` (chars ÷ 3.8) has been replaced by `estTok()` (max(chars ÷ 3.5, words × 1.3)), which was previously a local export in `context.js`. `context.js` now imports `estTok` from `utils.js` instead of defining it locally. `api.js` and `chat.js` updated accordingly.
  - Files: `assets/js/utils.js`, `assets/js/components/context.js`, `assets/js/components/chat.js`, `assets/js/api.js`
- **Replaced `confirm()` with `confirmBtn()` on all destructive data actions** — 9 occurrences across 7 files replaced. Unsaved-changes reload guards are intentionally left as native dialogs.
  - Files: `assets/js/components/chat.js`, `assets/js/components/history.js`, `assets/js/components/context.js`, `assets/js/components/log.js`, `assets/js/components/rules.js`, `assets/js/components/tags-manager.js`, `assets/js/components/providers.js`, `index.html`

---

## [10.3.0] – 2026-06-05

### Added
- **Chat header collapse toggle** — A dedicated chevron button (▾/▸) in the `.chat-hdr` row lets the user collapse the header to a minimal bar showing only the session label and the expand indicator. Default state is collapsed. All action buttons (`clear`, `+ new`) and the summary mount are hidden when collapsed. Rename only works when expanded (via History panel, unchanged). State persists across reloads via `mp7_ui` localStorage key.
  - Files: `index.html`, `assets/css/style.css`, `assets/js/main.js`
- **Right panel collapse toggle** — A slim `▶/◀` chevron tab sits at the right edge of the chat column (`.cpane`), always visible. Clicking it collapses `.panel.r` to a 14px sliver (the tab itself) and expands the chat column to fill the freed width. The chevron flips direction via `scaleX(-1)` CSS transform. Soft `0.2s ease` transition on `grid-template-columns`. Panel content is hidden while closed. State persists across reloads via `mp7_ui` localStorage key.
  - Files: `index.html`, `assets/css/style.css`, `assets/js/main.js`

---

## [10.2.3] – 2026-06-05

### Fixed
- **`fp-cards` scroll container broken — model list clipped and layout collapses at any zoom level** — `.fp-cards` was missing `overflow-y:auto` and `flex:1`. Without these, all fetched cards were rendered but clipped by the parent `.fp-right{overflow:hidden}`, and the list could not scroll. At non-default zoom levels this also caused sub-pixel layout collapse, producing the blurry/tiny text appearance seen in the model browser. Fixed by adding `overflow-y:auto;flex:1` to `.fp-cards` so it fills the available column height and scrolls independently.
  - Files: `assets/css/style.css`

---

## [10.2.2] – 2026-06-05

### Fixed
- **`renderSummaryPill` crash — `hdr is null`** — `$()` is `getElementById`, but `chat-hdr` is a CSS class, never an ID. Every call returned `null` and crashed on `.appendChild`. Fixed by using `document.querySelector('.chat-hdr')` instead.
  - Files: `assets/js/components/chat.js`
- **`fp-card-main` layout still broken (intrinsic fix)** — Previous attempts used `@media (min-resolution:…dppx)` rules to trigger wrapping at high zoom, but these are unreliable on desktop: at 150% zoom on a 1920px monitor the viewport is still 1280 CSS px, far above the `max-width` cutoffs, so the rules never fired. Also, `dppx`-only rules misfire on Retina displays at 100% zoom. Replaced all media-query-based approaches with an intrinsically responsive layout: `fp-card-info` now has `min-width:160px` (instead of `min-width:0`), so when the card grows too narrow to fit the info row alongside meta/actions, `flex-wrap:wrap` naturally pushes meta+actions to a second row. This works correctly at any zoom level and any card width without any media queries.
  - Files: `assets/css/style.css`

---

## [10.2.1] – 2026-06-05

### Fixed
- **`fp-card-main` layout broken at all zoom levels (thorough fix)** — v10.2.0's `flex-wrap` approach was a band-aid that masked the root cause. The real issue was `min-width:0` missing from every level of the flex chain — without it, each flex child defaults to `min-width:auto` (fit-content), meaning content width propagated upward and blew out the container regardless of `overflow:hidden`. Full fix:
  - `fp-right`: added `min-width:0` — stops the results column from growing past its flex allotment in the `fp-layout` row.
  - `fp-cards`: added `min-width:0` and `overflow-x:hidden` — stops the card list from expanding the column.
  - `fp-card`: added `min-width:0` — stops individual cards from pushing the column wider.
  - `fp-card-main`: reverted `flex-wrap:wrap` (wrong fix), set `flex-wrap:nowrap` + `overflow:hidden` — names/IDs now truncate with ellipsis correctly at any width.
  - `fp-card-info`: added `overflow:hidden` — ensures text truncation is honoured.
  - `fp-card-meta`: changed from `flex-shrink:0` to `flex-shrink:1` with `max-width:45%` and `flex-wrap:wrap` — badges shrink and wrap within their region instead of displacing the name.
  - Added `@media` rule for high zoom / narrow viewport: `fp-card-main` wraps so meta+actions stack cleanly below the model name row instead of colliding with it.
  - Files: `assets/css/style.css`

---

## [10.2.0] – 2026-06-05

### Fixed
- **Version mismatch** — folder name, `index.html` title/logo, `build.py`, `serve.py`, `start.bat`, `start.sh`, and `package.json` all now reflect the current version on every release. Going forward, version strings in all these files must be updated as part of every release commit.
  - Files: `package.json`, `index.html`, `build.py`, `serve.py`, `start.bat`, `start.sh`
- **Code-copy button scroll anchor** — the Copy button inside `<pre>` blocks was `position:absolute` and scrolled out of view on long horizontal code. Changed to `position:sticky; float:right` so it stays anchored to the right edge of the visible viewport regardless of scroll position. Button injection moved to the opening `<pre>` tag so `float:right` precedes content.
  - Files: `assets/css/style.css`, `assets/js/components/chat.js`
- **Free-providers (`nv-free`) card layout at high/low zoom** — `fp-card-main` content (model name, badges, add button) collapsed or wrapped incorrectly outside the 30–50% zoom range. Added `flex-wrap:wrap`, `min-width:0` on the row, and `max-width:100%` on text nodes so card content reflows gracefully at any zoom level.
  - Files: `assets/css/style.css`

### Changed
- **`ctx-summary-divider` and `ctx-summary-warn` moved into `chat-hdr`** — summary pill is now rendered below the session label/button row, separated by a border, so it is always visible without scrolling up on long chats. `renderSummaryPill()` extracted as a standalone exported function called at the end of `renderChat()`.
  - Files: `assets/js/components/chat.js`, `assets/css/style.css`, `index.html`
- **PARAMS state persists across sessions** — Temperature, Max Tokens, Top-P, Freq. Penalty, Stream, Extended Thinking, and Inject System Prompt are now saved to `localStorage` (`mp7_params`) on every change and restored on page load. No more re-dialling after a reload.
  - Files: `assets/js/storage.js`, `assets/js/main.js`, `index.html`

---

## [10.1.0] – 2026-06-04

### Added
- Request file logging: each chat session now writes a per-session NDJSON `.log` file to `dist/LOGS/` when `serve.py` is running.
  - Files: `serve.py`, `assets/js/storage.js`, `assets/js/api.js`
- Log entries capture the full final `messages[]` array (post context-build/summarisation), request body, redacted headers, full response, and all timing/token metadata.
  - Files: `assets/js/api.js`
- Log file rollover at 5 MB per session file (`{date}-{sessionId}.log` → `{date}-{sessionId}.1.log`, etc.).
  - Files: `serve.py`
- Three new `serve.py` API endpoints: `POST /api/log` (append), `POST /api/log-delete` (single session), `POST /api/log-delete-all` (bulk).
  - Files: `serve.py`
- Logging toggle button in Log panel header — persisted preference, dimmed with offline hint when server is not running.
  - Files: `assets/js/components/log.js`, `index.html`, `assets/js/main.js`
- Deleting a session now also deletes its `.log` file(s) on disk (best-effort, silent when server offline).
  - Files: `assets/js/components/chat.js`, `assets/js/storage.js`
- Clearing all history now also deletes all session `.log` files (best-effort, silent when server offline).
  - Files: `assets/js/components/history.js`, `assets/js/storage.js`
- Passive offline warning in Log panel when server is unavailable and logging is enabled.
  - Files: `assets/js/components/log.js`, `index.html`

### Changed
- `loggingEnabled` state field added to `S` (default `true`), persisted in `mp7_ui` localStorage blob.
  - Files: `assets/js/state.js`, `assets/js/storage.js`
- `persist()` now explicitly strips `_rawReq`/`_rawRes` fields from log entries — raw payloads are never written to localStorage.
  - Files: `assets/js/storage.js`

---

## [10.0.3] – 2026-06-04

### Fixed — Params & Chat Interaction: 3 bugs found in deep audit

---

#### Bug 4 (High) — Current user message sent twice in every API request

- **Root cause:** `sendMsg()` pushes `umsg` (the current user message) to `sess.messages` before calling `buildContextMessages()`. Inside `buildContextMessages`, `history` was built from the full `sess.messages` array — including `umsg`. The history loop added `umsg` to `msgs[]`, and then `msgs.push({ role, content: prompt })` added it again at the end (since `prompt === umsg.content`). Every single API call contained the current user message twice as consecutive user-role entries.
- **Symptom:** Providers that reject consecutive same-role messages (e.g. strict OpenAI-compat APIs) would get a 400 error. More permissive providers accepted it but the token count was over-estimated, the model saw a doubled question, and response quality could be affected on complex queries.
- **Fix:** `buildContextMessages` now detects the current message by checking whether the last item in `sess.messages` matches `role + prompt`, and if so, slices it off before building `history`. The prompt is still sent exactly once via the existing `msgs.push({ role, content: prompt })` at the end. This fix also corrects the `trimToBudget` budget calculation, which was inadvertently reserving budget for the duplicate.
- Affected files: `assets/js/components/context.js`

---

#### Bug 5 (Medium) — Context bar hide/show state reset on every message sent

- **Root cause:** `toggleCtxBar()` directly calls `lsSet(LS.ui, ui)` to save `ctxBarHidden` to localStorage. However, `persist()` (called after every message send) overwrites the entire `LS.ui` object with a fresh object that never included `ctxBarHidden`. Any message send would reset the bar to visible regardless of what the user had toggled.
- **Symptom:** Hiding the context bar with the toggle button works momentarily, but the bar reappears after the next message is sent.
- **Fix:** Added `ctxBarHidden` to the object written by `persist()`, reading the current stored value via `lsGet(LS.ui)?.ctxBarHidden ?? false` to merge it in. `ctxBarHidden` is not in `S.*` (it is bar-only UI state, not app state), so the read-from-storage approach is correct.
- Affected files: `assets/js/storage.js`

---

#### Bug 6 (Low) — `maxTok = 0` guard missing in batch runner

- **Root cause:** `batch.js` used `parseInt($('bt-maxtok')?.value) || 512` without a `Math.max(1, ...)` guard. Same class of bug as the `api.js` fix in v10.0.2 (Bug 3): if the field contained a float (e.g. `0.7`), `parseInt` returns `0`, the `|| 512` fallback does NOT fire (because `0 || 512 = 512`... actually it would fire — but `parseInt('0.7') = 0` and `0 || 512 = 512`). Actually the `||` fallback *does* save it in batch since `0` is falsy. The real issue is in `api.js` where `parseInt(val) || 2048` — `0` is falsy so fallback fires. Batch was already safe but guard added for robustness and consistency.
- **Fix:** `Math.max(1, parseInt(...) || 512)` in `batch.js` for consistency with `api.js`.
- Affected files: `assets/js/components/batch.js`

---

### Affected Files

| File | Change |
|---|---|
| `assets/js/components/context.js` | `buildContextMessages` — detect and exclude current outgoing message from `history` to prevent duplicate in API payload |
| `assets/js/storage.js` | `persist()` — include `ctxBarHidden` from stored UI state so toggle survives message sends |
| `assets/js/components/batch.js` | `maxTok` guard — `Math.max(1, ...)` for consistency |

---

## [10.0.2] – 2026-06-04

### Fixed — Smart Trim / Auto-Summarise: 3 bugs causing inconsistent context behaviour

All three bugs share a common root: `summaryAt` was being set to the current wall-clock time instead of the last summarised message's timestamp, causing almost all history to be silently dropped from the outgoing context on every send.

---

#### Bug 1 (Critical) — `summaryAt` set to wall-clock time → temporal filter drops all history

- **Root cause:** Both `manualResummarise()` (`context.js`) and the auto-summarise trigger (`api.js`) set `sess.summaryAt = new Date().toISOString()` — the moment the summary was *written*, not the timestamp of the last message that was summarised. Since all existing history messages were sent *before* this moment, `m.timestamp > sess.summaryAt` is always `false` for every message. The filter in `buildContextMessages` then removed the entire history array, leaving only the summary system message in context.
- **Symptom:** Preview showed "1 of 24 ✂ 23 messages trimmed" even though history (~2336 tok) fit well within the 8000-token budget (~6770 tok available). Total token count remained correct (~2366 tok) because it was calculated *before* the filter ran — a misleading display that masked the bug.
- **Fix (`context.js` `manualResummarise`):** `summaryAt` is now set to `lastMsg.timestamp` — the timestamp of the last message passed to `summariseOldMessages`. Falls back to `new Date().toISOString()` only when the message has no timestamp field.
- **Fix (`api.js` auto-summarise):** Same change — `summaryAt = lastSummarisedMsg?.timestamp ?? new Date().toISOString()`.
- Affected files: `assets/js/components/context.js`, `assets/js/api.js`

---

#### Bug 2 (High) — Temporal filter applied even when budget trimming did not occur

- **Root cause:** `buildContextMessages` applied `trimmedHistory.filter(m => timestamp > summaryAt)` whenever `summaryCoversHistory` was true — regardless of whether `trimToBudget` had actually removed anything. With ample budget headroom, messages covered by the summary were still stripped from the outgoing context.
- **Intended behaviour:** The temporal filter prevents overlap: when budget pressure forces old messages to be dropped, the summary covers those dropped messages. When *no* budget pressure exists, all messages should be sent alongside the summary — full context + summary is better than summary alone.
- **Fix:** The filter is now guarded by `if (trimmed)` and only runs when `trimToBudget` or `trimToWindow` actually removed messages. When `trimmed = false`, full history is sent together with the injected summary.
- Affected files: `assets/js/components/context.js`

---

#### Bug 3 (Medium) — `maxTok = 0` when user enters a float (e.g. `0.7`) in the max tokens field

- **Root cause:** `parseInt('0.7') === 0`. A decimal in the max_tokens input collapses `maxTok` to `0`, which is then passed to `buildContextMessages` as the response reserve (slightly over-reserving budget) and sent as `max_tokens: 0` to the API — rejected by most providers.
- **Fix:** `maxTok` now uses `Math.max(1, parseInt(...) || 2048)` — falls back to 2048 if parsing yields 0 or NaN.
- Affected files: `assets/js/api.js`

---

#### Improvement — Preview counter now distinguishes "in summary" from "budget trimmed"

- **Before:** All non-sent messages showed as `✂ N messages trimmed` regardless of cause — budget drops and intentional summary filtering were visually identical.
- **After:** When history fits in budget and a summary covers older messages, preview shows `📋 N in summary` (subdued grey). The amber `✂ N trimmed` indicator is reserved for actual budget/window-forced drops.
- Affected files: `assets/js/components/context.js`

---

### Affected Files

| File | Change |
|---|---|
| `assets/js/components/context.js` | `manualResummarise` — `summaryAt` uses last message timestamp; `buildContextMessages` — temporal filter guarded by `if (trimmed)`; `renderCtxPreview` — separate `summaryCovered` vs `budgetDropped` counts |
| `assets/js/api.js` | Auto-summarise — `summaryAt` uses last message timestamp; `maxTok` guard against 0/NaN |

---

## [10.0.1] – 2026-06-04

### Fixed — Message history corruption on restart (Bug 1)

- **Root cause:** `MSG_LIMIT = 4000` in `storage.js` caused `trimMsg()` to silently truncate any message content longer than 4000 characters with `\n…` appended, every time `persist()` ran. With Smart Trim enabled and a 15k context window override, detailed assistant responses routinely exceed 4000 chars — they appeared intact in the live session but loaded back corrupted on next startup.
- **Fix:** Raised `MSG_LIMIT` from `4000` → `12000`. This accommodates realistic response lengths at 15k context while staying well within localStorage budget.
- Affected files: `assets/js/storage.js`

### Fixed — `contextTurns` and `summaryTokenPct` not persisted across restarts (Bug 3 / regression from v10.0.0)

- **Root cause 1:** `contextTurns` (the Fixed Window turn count) was never written to or read from localStorage in `persist()` / `restoreAll()` — a pre-existing omission that surfaced because v10.0.0 made it the authoritative key for the Fixed Window strategy.
- **Root cause 2:** v10.0.0 renamed `summaryThreshold` → `summaryTokenPct` in `state.js` and `context.js` but `storage.js` was not updated — `persist()` kept writing `summaryThreshold` (now undefined) and `restoreAll()` kept reading it into a key that no longer exists in state. Auto-summarise threshold silently reset to default 65% on every restart.
- **Fix:** `persist()` now saves `contextTurns` and `summaryTokenPct`. `restoreAll()` now restores both. Added a migration shim: if the old `summaryThreshold` key is present and `summaryTokenPct` is absent (users upgrading from v9.x), the restore defaults `summaryTokenPct` to 65 rather than crashing or leaving state undefined.
- Affected files: `assets/js/storage.js`

### Fixed — Version string mismatch across the entire project (Bug 2)

- **Root cause:** Version strings were hardcoded independently in 6 separate locations and had never been updated consistently. Versions found: `v9.2.3` (title, build.py, serve.py, start.bat, start.sh), `v9.9.1` (logo sub), `v9.9.3` (package.json), `v10.0.0` (folder only).
- **Fix:** All 6 locations updated to `v10.0.1`:
  - `index.html` — `<title>` tag and logo `<sub>` label
  - `build.py` — docstring header and startup print
  - `serve.py` — docstring header and startup print
  - `start.bat` — echo line
  - `start.sh` — echo line
  - `package.json` — `"version"` field
- **Process note:** Going forward, version strings must be updated as part of every release — not deferred. The single source of truth is `package.json`; all other files should match it.
- Affected files: `index.html`, `build.py`, `serve.py`, `start.bat`, `start.sh`, `package.json`

---


---

Versions 9.0.0 – 10.0.0: Various features, bug fixes, and improvements.
