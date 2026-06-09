// views.js — top-level view and tab switching
import { $ } from './utils.js';

export function sv(v) {
  document.getElementById('v-chat') .classList.toggle('hidden', v!=='chat');
  document.getElementById('v-batch').classList.toggle('hidden', v!=='batch');
  document.getElementById('v-free') .classList.toggle('hidden', v!=='free');
  document.getElementById('nv-chat') .classList.toggle('on', v==='chat');
  document.getElementById('nv-batch').classList.toggle('on', v==='batch');
  document.getElementById('nv-free') .classList.toggle('on', v==='free');
  if (v==='batch') {
    window._onBatchView?.();
  }
  if (v==='free') {
    window._onFreeView?.();
  }
}

export function lt(name, el) {
  document.querySelectorAll('.panel:not(.r) .tab').forEach(t => t.classList.remove('on'));
  if (el) el.classList.add('on');
  ['cfg','rules','edit','params'].forEach(n =>
    document.getElementById('lt-'+n)?.classList.toggle('hidden', n!==name)
  );
  window._onLeftTab?.(name);
}

export function rt(name, el) {
  document.querySelectorAll('.panel.r .tab').forEach(t => t.classList.remove('on'));
  if (el) el.classList.add('on');
  const map = {log:'rt-log', hist:'rt-hist', ctx:'rt-ctx'};
  Object.entries(map).forEach(([k,id]) => {
    const e = document.getElementById(id);
    if (e) e.style.display = k===name ? 'flex' : 'none';
  });
  window._onRightTab?.(name);
}

export function pv(id, el, d) {
  const e = $(id); if (e) e.textContent = parseFloat(el.value).toFixed(d);
}
