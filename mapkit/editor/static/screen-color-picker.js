// The native <input type=color> popup belongs to the browser. Offer a direct
// eyedropper, including a Windows fallback for embedded WebView2 runtimes.
const attached = new WeakMap();
let active = null;
const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 5 5 5M4 15l9-9 5 5-9 9H4v-5Z"/><path d="m15 5 2-2a2.8 2.8 0 0 1 4 4l-2 2M4 20l-2 2"/></svg>';
const api = async (action, token, signal) => {
  const response = await fetch('/api/screen_color/' + action, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}), signal, keepalive:action==='cancel' });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Could not pick a screen colour.');
  return data;
};

export function commitPickedColor(input, value, original) {
  if (!/^#[0-9a-f]{6}$/i.test(value || '')) throw new Error('The picker did not return a valid colour.');
  if (!input.isConnected || input.matches(':disabled') || input.readOnly || input.value !== original) return false;
  if (input.value.toLowerCase() === value.toLowerCase() && !input.hasAttribute('data-mixed')) return true;
  input.value = value.toLowerCase();
  // Match native colour controls: texture tools preview on input, inspectors commit on change.
  input.dispatchEvent(new Event('input', { bubbles:true }));
  input.dispatchEvent(new Event('change', { bubbles:true }));
  return true;
}

function cleanup(session) {
  if (active !== session) return;
  active = null;
  session.abort.abort(); session.overlay.remove();
  session.button.removeAttribute('aria-pressed');
  if (session.button.isConnected) session.button.focus({preventScroll:true});
}

function cancel() {
  const session = active;
  if (!session) return;
  if (session.native) void api('cancel',session.token).catch(()=>{});
  cleanup(session);
}

function notice(text, bad = false) {
  document.querySelector('#screen-color-notice')?.remove();
  const n = document.createElement('div');n.id='screen-color-notice';n.setAttribute('role',bad?'alert':'status');
  n.textContent=text;document.body.append(n);
  setTimeout(()=>n.remove(),bad?7000:3000);
}

export async function pickScreenColor(input, button) {
  if (active || input.matches(':disabled') || input.readOnly || !input.isConnected) return;
  const overlay = document.createElement('div');overlay.id='screen-color-picking';overlay.tabIndex=-1;
  overlay.innerHTML='<div role="status">Click a colour on the screen · Esc to cancel</div>';
  // A popup dialog lives in the top layer: putting the shield inside it also blocks its controls.
  (input.closest('dialog[open]') || document.body).append(overlay);
  const session = {input,button,overlay,original:input.value,abort:new AbortController(),native:false,token:crypto.randomUUID().replaceAll('-','')};
  active=session;button.setAttribute('aria-pressed','true');
  overlay.addEventListener('contextmenu',event=>{event.preventDefault();cancel();});
  try {
    let result;
    if (typeof window.EyeDropper === 'function' && !window.pywebview?.api) {
      try { result = await new window.EyeDropper().open({signal:session.abort.signal}); }
      catch(error) {
        if(error.name==='AbortError' || session.abort.signal.aborted) return;
        if(error.name==='NotAllowedError') throw new Error('Click the eyedropper again to start picking a colour.');
        // Some Chromium hosts expose the API but cannot create its native window.
      }
    }
    if (!result && active === session) { session.native=true;result=await api('pick',session.token,session.abort.signal); }
    if (active !== session || result?.cancelled) return;
    if (!commitPickedColor(input,result?.sRGBHex,session.original)) notice('The colour field changed while picking. Pick again.');
  } catch(error) {
    if(active===session && error.name!=='AbortError') notice(error.message,true);
  } finally { cleanup(session); }
}

function attach(input) {
  if (!(input instanceof HTMLInputElement) || input.type!=='color' || attached.has(input)) return;
  // The paint tool's overlapping foreground/background swatches have their own
  // placement; keep the screen picker in their surrounding toolbar.
  const paint = input.closest('.te-colors');
  const button=document.createElement('button');button.type='button';button.className='screen-color-pick';button.innerHTML=icon;
  const label=input.getAttribute('aria-label') || input.labels?.[0]?.textContent?.trim() || input.closest('.row')?.querySelector('label')?.textContent?.trim() || 'colour';
  button.title=`Pick ${label.toLowerCase()} from screen (Esc cancels)`;button.setAttribute('aria-label',button.title);
  const sync=()=>{button.disabled=input.matches(':disabled') || input.readOnly;};sync();attached.set(input,{button,sync});
  button.addEventListener('pointerdown',event=>event.stopPropagation());
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void pickScreenColor(input,button);});
  if(paint){button.classList.add('screen-color-paint');paint.after(button);}else input.after(button);
}

function scan(root) {
  if(root.nodeType!==1)return;
  if(root.matches('input[type=color]'))attach(root);
  root.querySelectorAll('input[type=color]').forEach(attach);
}

const observer=new MutationObserver(records=>{
  for(const record of records){
    if(record.type==='attributes')attached.get(record.target)?.sync();
    else{
      record.addedNodes.forEach(scan);
      // The target might have disappeared because selection or the whole map changed.
      if(active && !active.input.isConnected)cancel();
      for(const node of record.removedNodes){
        if(node.nodeType!==1)continue;
        const removed=[...(node.matches('input[type=color]')?[node]:[]),...node.querySelectorAll('input[type=color]')];
        for(const input of removed)if(!input.isConnected){attached.get(input)?.button.remove();attached.delete(input);}
      }
    }
  }
});
scan(document.body);
observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly']});
// Registered before editor shortcuts: sampling cannot move/delete the selection.
window.addEventListener('keydown',event=>{if(!active)return;event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape')cancel();},true);
window.addEventListener('pagehide',cancel);
const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./screen-color-picker.css',import.meta.url).href;document.head.append(css);
