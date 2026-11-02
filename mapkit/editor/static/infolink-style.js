export const DEFAULT_STYLE = Object.freeze({enabled:false,font:'terminal',size:'normal',background:null,text:null});
const esc = s => String(s ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function effectiveStyle(project,local) {
  const base={...DEFAULT_STYLE,...project};
  return local == null ? base : {...base,...local,enabled:local.enabled ?? true};
}
export function mountInfoLinkStyle(el,{style,project={},local=false,onChange,onProject,sample=()=>'',speaker=()=>''}) {
  let value=style == null ? null : {...style};
  el.classList.add('st-infolink-style');
  const emit = next => {value=next;onChange(next);render();};
  const change = (key,v) => emit({...effectiveStyle(project,value),[key]:v,enabled:true});
  function preview() {
    const s=effectiveStyle(project,local ? value : value || DEFAULT_STYLE),box=el.querySelector('.st-il-preview');
    const font=s.enabled ? s.font : 'terminal',large=s.enabled && s.size==='large';
    box.dataset.font=font;box.dataset.size=large?'large':'normal';
    box.style.background=s.enabled && s.background || 'var(--field)';
    box.style.color=s.enabled && s.text || 'var(--text)';
    box.querySelector('b').textContent=speaker() || 'Incoming transmission';
    box.querySelector('p').textContent=sample() || 'Your contact is waiting on the next rooftop. Land and speak to them.';
  }
  function render() {
    const s=effectiveStyle(project,local ? value : value || DEFAULT_STYLE),active=local ? value!=null : !!s.enabled;
    el.innerHTML=`<div class="st-il-mode"><label><input type="checkbox" data-mode ${local ? value==null?'checked':'' : s.enabled?'checked':''}> ${local?'Use project style':'Custom InfoLink style'}</label>
      ${local?'<button type="button" data-project title="Edit the defaults for all InfoLinks created in this project">Project style…</button>':''}</div>
      <fieldset ${active?'':'disabled'}>
        <label class="st-il-row"><span>Font</span><select data-font><option value="terminal">Terminal</option><option value="dialogue">Dialogue</option><option value="bold">Dialogue bold</option></select></label>
        <label class="st-il-row"><span>Text size</span><select data-size title="Uses the game's original bitmap fonts at their native sizes"><option value="normal">Standard</option><option value="large">Large</option></select></label>
        ${['background','text'].map(key=>`<div class="st-il-row"><span>${key==='background'?'Background':'Text color'}</span><label class="st-il-theme"><input type="checkbox" data-theme="${key}" ${s[key]==null?'checked':''}> Game theme</label><input type="color" data-color="${key}" value="${esc(s[key] || (key==='background'?'#101d2e':'#dce6f1'))}" title="${key==='background'?'Background':'Text'} color" ${s[key]==null?'disabled':''}></div>`).join('')}
      </fieldset><div class="st-il-preview" role="img" aria-label="InfoLink appearance preview" title="Layout preview; the game uses its original bitmap fonts"><b></b><p></p></div>`;
    el.querySelector('[data-mode]').onchange=e=>emit(local ? e.target.checked ? null : {...s,enabled:true} : {...s,enabled:e.target.checked});
    const font=el.querySelector('[data-font]'),size=el.querySelector('[data-size]');
    font.value=s.font;size.value=s.size;
    font.onchange=()=>change('font',font.value);size.onchange=()=>change('size',size.value);
    for(const key of ['background','text']) {
      el.querySelector(`[data-theme="${key}"]`).onchange=e=>change(key,e.target.checked ? null : key==='background'?'#101d2e':'#dce6f1');
      const color=el.querySelector(`[data-color="${key}"]`);
      color.oninput=()=>{const box=el.querySelector('.st-il-preview');box.style[key==='background'?'background':'color']=color.value;};
      color.onchange=()=>change(key,color.value);
    }
    const projectButton=el.querySelector('[data-project]');if(projectButton)projectButton.onclick=onProject;
    preview();
  }
  render();return {refresh:preview};
}
