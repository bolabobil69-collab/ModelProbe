// batch.js — batch testing panel
import { S } from '../state.js';
import { $, esc, ms2s, toast, dl, ftag } from '../utils.js';
import { resolveModel } from './models.js';

export function renderPTList() {
  const el=$('ptlist'); if(!el)return;
  if(!S.promptTemplates.length){
    el.innerHTML='<div class="empty" style="padding:11px"><p>No templates. Add one below.</p></div>';
    return;
  }
  el.innerHTML=S.promptTemplates.map(t=>`
    <div class="ptcard${S.activePT===t.id?' on':''}" onclick="selPT('${t.id}')">
      <div class="ptcard-n">${esc(t.name)}<span style="float:right;font-size:9px;color:var(--text3)">${esc(t.cat||'')}</span></div>
      <div class="ptcard-p">${esc(t.prompt)}</div>
    </div>`).join('');
}

export function selPT(id) {
  S.activePT=id;
  const t=S.promptTemplates.find(x=>x.id===id);
  const ap=$('bat-ap');
  if(ap) ap.textContent=t?`[${t.name}] ${t.prompt}`:'Select a template';
  renderPTList();
}

export function savePTform() {
  const name=$('bt-name')?.value.trim();
  const prompt=$('bt-prompt')?.value.trim();
  const sys=$('bt-sys')?.value.trim()||'';
  if(!name||!prompt){toast('Name and prompt required','warn');return;}
  const id=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  S.promptTemplates.push({id,name,cat:'custom',sys,prompt});
  ftag('pt-ftag','modified','d');
  renderPTList();
  const n=$('bt-name'),p=$('bt-prompt'),s=$('bt-sys');
  if(n)n.value=''; if(p)p.value=''; if(s)s.value='';
  toast('Template saved','ok');
}

export function loadPT() {
  const fi=$('fi-pt');
  fi.onchange=async()=>{
    const f=fi.files[0]; if(!f)return;
    try{
      const d=JSON.parse(await f.text());
      S.promptTemplates=d.prompts||[];
      ftag('pt-ftag',f.name,'l'); renderPTList();
      toast('Loaded','ok');
    }catch(e){toast('Invalid JSON: '+e.message,'err');}
    fi.value='';
  }; fi.click();
}

export function savePT() {
  dl('prompts_template.json',JSON.stringify({_note:'ModelProbe v6 prompt templates',prompts:S.promptTemplates},null,2));
  ftag('pt-ftag','prompts_template.json','l'); toast('Saved','ok');
}

export function renderBMdl() {
  const el=$('bmdl-list'); if(!el)return;
  const aliases=Object.keys(S.models);
  if(!aliases.length){
    el.innerHTML='<div class="empty" style="padding:10px"><p>Load models.json first.</p></div>';
    const c=$('bmc'); if(c)c.textContent=''; return;
  }
  const c=$('bmc'); if(c)c.textContent=aliases.length+' models';
  el.innerHTML=aliases.map(a=>{
    const m=S.models[a]; const safe=a.replace(/[^a-z0-9]/gi,'_');
    return `<div class="mci">
      <input type="checkbox" id="bc-${safe}" data-alias="${esc(a)}" checked>
      <label for="bc-${safe}">${esc(a)}</label>
      <span class="mcp">${esc(m.provider||'?')}</span>
    </div>`;
  }).join('');
}

export function chkAll(state) {
  document.querySelectorAll('#bmdl-list input[type=checkbox]').forEach(cb=>cb.checked=state);
}

function getChecked() {
  const res=[];
  document.querySelectorAll('#bmdl-list input[type=checkbox]:checked').forEach(cb=>{
    const alias=cb.dataset.alias;
    const r=resolveModel(alias);
    if(r) res.push({alias,...r});
    else  res.push({alias,missing:true,provider:(S.models[alias]||{}).provider||'?'});
  });
  return res;
}

export async function runBatch() {
  if(S.batchRunning)return;
  const tpl=S.promptTemplates.find(x=>x.id===S.activePT);
  if(!tpl){toast('Select a prompt template','warn');return;}
  const models=getChecked();
  if(!models.length){toast('Select at least one model','warn');return;}
  const maxTok=Math.max(1,parseInt($('bt-maxtok')?.value)||512);
  const temp=parseFloat($('bt-temp')?.value)||0.7;
  const toMs=(parseInt($('bt-timeout')?.value)||30)*1000;

  S.batchRunning=true; S.batchResults=[];
  const runBtn=$('brun-btn'), stopBtn=$('bstop-btn'), bsum=$('bsum');
  if(runBtn)runBtn.style.display='none';
  if(stopBtn)stopBtn.style.display='';
  if(bsum)bsum.style.display='flex';

  const el=$('bresults');
  if(el)el.innerHTML=`<div style="font-size:11px;color:var(--text3);padding:8px">Running ${models.length} model(s)…</div>`;
  let okC=0,erC=0,totLat=0;

  for(let i=0;i<models.length;i++){
    if(!S.batchRunning)break;
    const m=models[i]; const cid='bc'+Date.now().toString(36);
    if(m.missing){
      if(el)el.innerHTML+=`<div class="bcard">
        <div class="bcard-h"><span class="bcard-m">${esc(m.alias)}</span><span class="bdg b-er">NO PROVIDER</span></div>
        <div class="bcard-b"><div class="bcard-r" style="color:var(--red)">Provider "${esc(m.provider)}" not in providers.json</div></div>
      </div>`;
      erC++;
      const bse=$('bs-er'),bst=$('bs-tot');
      if(bse)bse.textContent=erC; if(bst)bst.textContent=i+1;
      continue;
    }
    if(el)el.innerHTML+=`<div class="bcard" id="${cid}">
      <div class="bcard-h">
        <span class="bcard-m">${esc(m.alias)}</span>
        <span style="font-size:10px;color:var(--text3)">${esc(m.providerId)}</span>
        <span class="bdg b-rn">RUNNING</span>
      </div>
      <div class="bcard-b"><div style="font-size:11px;color:var(--text3)">Requesting…</div></div>
    </div>`;
    if(el)el.scrollTop=el.scrollHeight;

    const t0=Date.now();
    let st='ok',resp='',lat=0,iTok=0,oTok=0,errMsg='';
    try{
      const h={'Content-Type':'application/json'};
      if(m.apiKey)h['Authorization']='Bearer '+m.apiKey;
      const msgs=[];
      if(tpl.sys)msgs.push({role:'system',content:tpl.sys});
      msgs.push({role:'user',content:tpl.prompt});
      const body={model:m.modelId,messages:msgs,temperature:temp,max_tokens:maxTok,stream:false};
      const ctrl=new AbortController();
      const tid=setTimeout(()=>ctrl.abort(),toMs);
      const res=await fetch(m.baseUrl+'/chat/completions',{method:'POST',headers:h,body:JSON.stringify(body),signal:ctrl.signal});
      clearTimeout(tid); lat=Date.now()-t0;
      if(!res.ok){
        let raw=await res.text(),em=raw;
        try{const j=JSON.parse(raw);em=j.error?.message||raw;}catch(_){}
        throw Object.assign(new Error(em),{status:res.status});
      }
      const data=await res.json();
      resp=data.choices?.[0]?.message?.content||JSON.stringify(data,null,2);
      iTok=data.usage?.prompt_tokens||0; oTok=data.usage?.completion_tokens||0;
      okC++; totLat+=lat;
    }catch(e){
      lat=Date.now()-t0; st='err';
      errMsg=e.name==='AbortError'?`Timeout (${Math.round(lat/1000)}s)`:e.message;
      erC++;
    }
    S.batchResults.push({alias:m.alias,modelId:m.modelId,providerId:m.providerId,
      st,resp,errMsg,lat,iTok,oTok,tpl:tpl.name,ts:new Date().toISOString()});

    const card=document.getElementById(cid);
    if(card){
      const wc=resp?resp.trim().split(/\s+/).length:0;
      const stats=`<span class="sp2 hi">${ms2s(lat)}</span>`
        +(iTok?`<span class="sp2">↑${iTok}</span>`:'')
        +(oTok?`<span class="sp2">↓${oTok}</span>`:'')
        +(wc?`<span class="sp2">${wc}w</span>`:'');
      card.innerHTML=`<div class="bcard-h">
          <span class="bcard-m">${esc(m.alias)}</span>
          <span style="font-size:10px;color:var(--text3)">${esc(m.providerId)}</span>
          <span class="bdg ${st==='ok'?'b-ok':'b-er'}">${st==='ok'?'OK':'ERR'}</span>
        </div>
        <div class="bcard-b">
          <div class="bcard-r">${esc(st==='ok'?resp:errMsg)}</div>
          <div class="bcard-s">${stats}</div>
        </div>`;
    }
    const bst2=$('bs-tot'),bsok=$('bs-ok'),bser=$('bs-er'),bsav=$('bs-avg');
    if(bst2)bst2.textContent=i+1;
    if(bsok)bsok.textContent=okC;
    if(bser)bser.textContent=erC;
    if(bsav)bsav.textContent=okC?ms2s(Math.round(totLat/okC)):'—';
  }
  S.batchRunning=false;
  if(runBtn)runBtn.style.display=''; if(stopBtn)stopBtn.style.display='none';
  toast(`Batch done · ${okC}✓ ${erC}✗`,'ok');
}

export function stopBatch(){
  S.batchRunning=false;
  const r=$('brun-btn'),s=$('bstop-btn');
  if(r)r.style.display=''; if(s)s.style.display='none';
  toast('Stopped','warn');
}

export function exportBatch(){
  if(!S.batchResults.length){toast('No results','warn');return;}
  dl('modelprobe-batch-'+new Date().toISOString().slice(0,10)+'.json',
    JSON.stringify({exportedAt:new Date().toISOString(),results:S.batchResults},null,2));
  toast('Exported','ok');
}

export function clearBatch(){
  S.batchResults=[];
  const el=$('bresults');
  if(el)el.innerHTML='<div class="empty"><div class="empty-i">⬡</div><p>Results cleared.</p></div>';
  const bs=$('bsum'); if(bs)bs.style.display='none';
}
