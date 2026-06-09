
// api.js — fetch wrapper, streaming, connection test (V7: sessionId on every log)
import { S } from './state.js';
import { $, toast, ms2s, analyzeErr, ctxW, estTok } from './utils.js';
import { persist, appendLog } from './storage.js';
import { resolveModel } from './components/models.js';
import { getSystemPrompt } from './components/rules.js';
import { getActSess, newSession, renderChat, renderMsg, maybeAutoName,
         showLoadingBubble, hideLoadingBubble, bindCopyButtons } from './components/chat.js';
import { renderLog } from './components/log.js';
import { renderHist } from './components/history.js';
import { renderCtx, buildContextMessages, summariseOldMessages } from './components/context.js';

export function stopStream() { if (S.abortCtrl) S.abortCtrl.abort(); }

export async function testConn() {
  const r = resolveModel(S.activeAlias);
  if (!r) { toast('No model selected','err'); return; }
  const el=$('conn-res');
  if(el){el.style.display='block';el.textContent='Testing…';el.style.color='var(--text3)';}
  const t0=Date.now();
  try{
    const h={'Content-Type':'application/json'};
    if(r.apiKey)h['Authorization']='Bearer '+r.apiKey;
    const res=await fetch(r.baseUrl+'/chat/completions',{method:'POST',headers:h,
      body:JSON.stringify({model:r.modelId,messages:[{role:'user',content:'hi'}],max_tokens:1,stream:false})});
    const ms=Date.now()-t0;
    const dot=$('dot');
    if(res.ok){if(el){el.style.color='var(--ac)';el.textContent=`✓ OK · ${ms}ms · HTTP ${res.status}`;}if(dot)dot.className='dot ok';}
    else{let raw=await res.text(),m=raw;try{const j=JSON.parse(raw);m=j.error?.message||raw;}catch(_){}
      if(el){el.style.color='var(--red)';el.textContent=`✗ HTTP ${res.status}: ${m.slice(0,100)}`;}if(dot)dot.className='dot err';}
  }catch(e){if(el){el.style.color='var(--red)';el.textContent='✗ '+e.message;}
    const d=$('dot');if(d)d.className='dot err';}
}

// testFreeModel — lightweight connection probe used by free-providers panel.
// Pure function: no UI side effects, no S.* writes.
// Returns { ok: bool, ms: number, msg: string }
export async function testFreeModel(baseUrl, apiKey, modelId) {
  const t0 = Date.now();
  try {
    const h = { 'Content-Type': 'application/json' };
    if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
    });
    const ms = Date.now() - t0;
    if (res.ok) return { ok: true, ms, msg: `OK · ${ms}ms` };
    let raw = await res.text(), em = raw;
    try { const j = JSON.parse(raw); em = j.error?.message || raw; } catch (_) {}
    return { ok: false, ms, msg: `HTTP ${res.status}: ${em.slice(0, 120)}` };
  } catch (e) {
    const ms = Date.now() - t0;
    return { ok: false, ms, msg: e.message || 'Network error' };
  }
}

export async function sendMsg() {
  if(S.running)return;
  const r=resolveModel(S.activeAlias);
  if(!r){toast('No model — select one in Config','err');return;}
  const pinput=$('pinput');
  const prompt=pinput?.value.trim();
  if(!prompt){toast('Empty prompt','warn');return;}

  // Ensure active session exists
  if(!S.activeSessionId||!getActSess()) newSession();
  const sess=getActSess();
  sess.alias=S.activeAlias;

  // V7: auto-name on first message + stamp provider/model
  const isFirstMsg = sess.messages.length === 0;

  const role=$('prole')?.value||'user';
  const umsg={id:Date.now().toString(36)+Math.random().toString(36).slice(2,4),
               role,content:prompt,timestamp:new Date().toISOString()};
  sess.messages.push(umsg);
  if(pinput){ pinput.value=''; pinput.style.height=''; }
  const cci=$('cci');if(cci)cci.textContent='0 ch';

  if(isFirstMsg) maybeAutoName(sess,prompt);

  // Render existing messages + show loading bubble
  const area=$('msgs');
  if(area){
    area.innerHTML=sess.messages.map(renderMsg).join('');
    bindCopyButtons();
  }
  showLoadingBubble();

  // Params
  const temp=parseFloat($('s-t')?.value||'0.7'),maxTok=Math.max(1,parseInt($('s-m')?.value||'2048')||2048);
  const topP=parseFloat($('s-p')?.value||'1'),freqP=parseFloat($('s-f')?.value||'0');
  const doStr=$('str-on')?.checked??true,doThk=$('thk-on')?.checked??false;
  const sys=getSystemPrompt();

  // T2-B: Auto-summarise pre-step — token-percentage threshold replaces message count
  if (S.autoSummarise) {
    const history = (sess.messages || []).filter(m => !m.error && m.content && !m.partial);
    const winTokens = S.contextWindowSize || (r ? ctxW(r.modelId) : null);
    const historyTok = history.reduce((s, m) => s + estTok(m.content), 0);
    const pct = winTokens ? Math.round(historyTok / winTokens * 100) : null;
    const summaryTokenPct = S.summaryTokenPct ?? 65;
    const overThreshold = pct !== null
      ? pct >= summaryTokenPct
      : history.length >= 10;  // fallback when window size unknown

    const msgsSinceSummary = sess.summaryAt
      ? history.filter(m => m.timestamp > sess.summaryAt).length
      : history.length;

    const needsSummary = !sess.summary || (overThreshold && msgsSinceSummary >= 4);
    if (needsSummary && history.length > 0) {
      const summary = await summariseOldMessages(history, r);
      if (summary) {
        sess.summary = summary;
        // FIX: use the last summarised message's timestamp, not wall-clock time.
        // If set to now, summaryAt > all existing message timestamps → temporal
        // filter in buildContextMessages drops every history message from context.
        const lastSummarisedMsg = history[history.length - 1];
        sess.summaryAt = lastSummarisedMsg?.timestamp ?? new Date().toISOString();
      }
    }
  }

  const { msgs, trimmed } = buildContextMessages(sess, sys, role, prompt, r, maxTok);
  if (trimmed) toast('Older messages trimmed to fit context window', 'warn');

  // Capture the exact payload that will be sent — local variable only, never persisted to localStorage.
  // Passed to appendLog() after response and then GC'd.
  const _rawReq = {
    messages: msgs,
    body: { model: r.modelId, temperature: temp, max_tokens: maxTok,
            top_p: topP, frequency_penalty: freqP, stream: doStr },
    headers: { 'Content-Type': 'application/json',
               Authorization: r.apiKey ? '[redacted]' : 'none' },
  };

  const headers={'Content-Type':'application/json'};
  if(r.apiKey)headers['Authorization']='Bearer '+r.apiKey;
  const body={model:r.modelId,messages:msgs,temperature:temp,max_tokens:maxTok,
               top_p:topP,frequency_penalty:freqP,stream:doStr};
  if(doThk)body.thinking={type:'enabled',budget_tokens:Math.min(maxTok,4096)};

  S.running=true;S.abortCtrl=new AbortController();
  const sbtn=$('sbtn'),abtn=$('abtn'),dot=$('dot');
  if(sbtn)sbtn.style.display='none';if(abtn)abtn.style.display='';if(dot)dot.className='dot busy';

  // V7: always stamp sessionId on log
  const logId=Date.now().toString(36)+Math.random().toString(36).slice(2,4);
  const log={
    id:logId, sessionId:sess.id,              // ← required V7 field
    ts:new Date().toISOString(),
    alias:S.activeAlias, model:r.modelId, provider:r.providerId,
    prompt, sys:sys||'', role,
    params:{temp,maxTok,topP,freqP,stream:doStr,think:doThk},
    thinking:'',response:'',error:null,
    meta:{latency:0,ttft:0,genTime:0,inputTokens:0,outputTokens:0,wordCount:0,charCount:0},
  };
  const t0=Date.now();let ttft=0,thkBuf='',rspBuf='',sc=0,streamToks=0;

  try{
    const res=await fetch(r.baseUrl+'/chat/completions',
      {method:'POST',headers,body:JSON.stringify(body),signal:S.abortCtrl.signal});
    sc=res.status;
    if(!res.ok){
      let raw=await res.text(),em=raw;
      try{const j=JSON.parse(raw);em=j.error?.message||j.message||raw;}catch(_){}
      throw Object.assign(new Error(em),{status:res.status});
    }

    if(doStr){
      const rd=res.body.getReader(),dc=new TextDecoder();

      // ── Auto-scroll guard: pause when user scrolls up, resume at bottom ──
      let userScrolledUp=false;
      function _onScroll(){
        if(!area)return;
        const atBottom=area.scrollHeight-area.scrollTop-area.clientHeight<40;
        userScrolledUp=!atBottom;
      }
      area?.addEventListener('scroll',_onScroll);

      // ── Status bar: replaces the obnoxious loading bubble ────────────────
      hideLoadingBubble();
      const statusEl=$('stream-status'),statusTxt=$('stream-status-txt');
      if(statusEl)statusEl.classList.add('active');

      // ── Live streaming stats ──────────────────────────────────────────────
      // (streamToks hoisted to outer scope — also used by non-streaming fallback at line ~230)
      function _updateStatusBar(){
        if(!statusTxt)return;
        const elapsed=(Date.now()-t0)/1000;
        const tps=elapsed>0?(streamToks/elapsed):0;
        statusTxt.textContent=
          `↓\u202f${streamToks}\u202ftok\u2002·\u2002${elapsed.toFixed(1)}s\u2002·\u2002${tps.toFixed(1)}\u202ftok/s`;
      }
      const _statsInterval=setInterval(_updateStatusBar,250);

      // ── Track whether user manually opened/closed the stream collapsible ─
      let streamDetailsOpen=true;

      while(true){
        const{done,value}=await rd.read();if(done)break;
        const chunk=dc.decode(value,{stream:true});
        for(const line of chunk.split('\n')){
          if(!line.startsWith('data:'))continue;
          const d=line.slice(5).trim();if(d==='[DONE]')continue;
          try{
            const j=JSON.parse(d);
            if(j.usage){log.meta.inputTokens=j.usage.prompt_tokens||0;log.meta.outputTokens=j.usage.completion_tokens||0;}
            const dl=j.choices?.[0]?.delta;if(!dl)continue;
            if((dl.thinking||dl.reasoning_content)&&!ttft)ttft=Date.now()-t0;
            if(dl.content&&!ttft)ttft=Date.now()-t0;
            if(dl.thinking)          thkBuf+=dl.thinking;
            if(dl.reasoning_content) thkBuf+=dl.reasoning_content;
            if(dl.content){
              rspBuf+=dl.content;
              // Estimate tokens from content delta (chars ÷ 4)
              streamToks+=Math.max(1,Math.round(dl.content.length/4));
            }
          }catch(_){}
        }
        if(!area)continue;

        // Sync open state from existing details so user toggle is preserved
        const existingEl=area.querySelector('.msg-streaming');
        if(existingEl){
          const det=existingEl.querySelector('details.stream-wrap');
          if(det)streamDetailsOpen=det.open;
        }

        // Build collapsible streaming bubble with inline text cursor
        const wc=rspBuf.trim().split(/\s+/).filter(Boolean).length;
        const bodyContent=_esc(rspBuf)+'<span class="stream-cur"></span>';
        const openAttr=streamDetailsOpen?' open':'';
        const wrapHtml=`<details class="stream-wrap"${openAttr}><summary>Response <span style="color:var(--text3);font-size:9px">${wc}w</span></summary><div class="stream-body">${bodyContent}</div></details>`;
        const outerHtml=thkBuf
          ? `<details class="thkwrap"><summary>Thinking</summary><div class="thkbody">${_esc(thkBuf)}</div></details>${wrapHtml}`
          : wrapHtml;

        if(existingEl){
          existingEl.innerHTML=outerHtml;
        }else{
          const d=document.createElement('div');
          d.className='msg assistant msg-streaming';
          d.innerHTML=outerHtml;
          area.appendChild(d);
        }

        // Auto-scroll only when user hasn't scrolled up
        if(!userScrolledUp)area.scrollTop=area.scrollHeight;
      }

      area?.removeEventListener('scroll',_onScroll);
      clearInterval(_statsInterval);
      if(statusEl)statusEl.classList.remove('active');
      if(statusTxt)statusTxt.textContent='ready';
    }else{
      const data=await res.json();ttft=Date.now()-t0;
      const ch=data.choices?.[0];
      rspBuf=ch?.message?.content||JSON.stringify(data,null,2);
      thkBuf=ch?.message?.reasoning_content||data.thinking||'';
      if(data.usage){log.meta.inputTokens=data.usage.prompt_tokens||0;log.meta.outputTokens=data.usage.completion_tokens||0;}
    }

    log.thinking=thkBuf;log.response=rspBuf;
    log.meta.latency=Date.now()-t0;log.meta.ttft=ttft;log.meta.genTime=log.meta.latency-ttft;
    log.meta.wordCount=rspBuf.trim().split(/\s+/).filter(Boolean).length;
    log.meta.charCount=rspBuf.length;
    const genSec=log.meta.genTime/1000;
    // Fix 5: fall back to streamToks estimate when provider returns no usage data
    // (e.g. local proxies like player2, Ollama). streamToks uses chars÷4 heuristic
    // accumulated during streaming — less accurate than API-reported but better than 0.
    if(log.meta.outputTokens===0&&streamToks>0){
      log.meta.outputTokens=streamToks;
    }
    log.meta.tokensPerSec=genSec>0&&log.meta.outputTokens>0
      ? Math.round(log.meta.outputTokens/genSec)
      : 0;
    sess.messages.push({id:Date.now().toString(36),role:'assistant',content:rspBuf,
      thinking:thkBuf,timestamp:new Date().toISOString(),meta:{...log.meta}});
    if(dot)dot.className='dot ok';

  }catch(err){
    if(err.name==='AbortError'){
      if(rspBuf)sess.messages.push({id:Date.now().toString(36),role:'assistant',content:rspBuf,
        thinking:thkBuf,partial:true,timestamp:new Date().toISOString(),meta:{latency:Date.now()-t0,ttft,wordCount:0}});
      toast('Stopped','warn');
    }else{
      const eo=analyzeErr(err.status||sc,err.message);log.error=eo;
      sess.messages.push({id:Date.now().toString(36),role:'error',content:'',
        error:eo,timestamp:new Date().toISOString()});
      if(dot)dot.className='dot err';
    }
    // Always clean up streaming UI state — prevents timer leak on error or abort
    if(typeof _statsInterval!=='undefined')clearInterval(_statsInterval);
    const _sEl=$('stream-status'),_sTxt=$('stream-status-txt');
    if(_sEl)_sEl.classList.remove('active');
    if(_sTxt)_sTxt.textContent='ready';
    log.meta.latency=Date.now()-t0;
  }

  S.logs.unshift(log);
  hideLoadingBubble();
  renderChat();renderLog();renderHist();
  if(S.contextSessionId===sess.id||!S.contextSessionId)renderCtx();
  if(typeof renderCtxPreview==='function')renderCtxPreview();
  // Write full request/response payload to LOGS/{date}-{sessionId}.log (serve.py only).
  // _rawReq is a local variable — this call is the only consumer; payload is GC'd after.
  await appendLog(sess.id, {
    ...log,
    req: { ..._rawReq },
    res: { response: rspBuf, thinking: thkBuf },
    status: log.error ? 'error' : (S.abortCtrl === null && rspBuf && !log.error ? 'complete' : 'aborted'),
  });
  persist();
  S.running=false;S.abortCtrl=null;
  if(sbtn)sbtn.style.display='';if(abtn)abtn.style.display='none';
}

function _esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
