/* ════════════════════════════════════════════════════════════
   مقارنة حجرين جنباً إلى جنب
   ════════════════════════════════════════════════════════════ */
import { GEMS, ID_TRAITS, gemIcon, normAr } from './gems.js';
import { mohsOf, densOf, catLabel, similarGems } from './cards.js';

const $=(id)=>document.getElementById(id);
const esc=(s)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(x)=>(Math.round(x*10)/10).toString();
const T_WORD={clear:'شفاف',trans:'شبه شفاف',opaque:'معتم'};

let A=null, B=null, hooks={};

function bar(v,max,color){
  return `<span class="cmp-bar"><span style="width:${Math.max(4,v/max*100).toFixed(1)}%;background:${color}"></span></span>`;
}
function head(g,side){
  if(!g) return `<div class="cmp-head empty">اختر حجراً للمقارنة</div>`;
  return `<div class="cmp-head"><span class="cmp-ic">${gemIcon(g)}</span>
    <div><div class="cmp-ar">${esc(g.nameAR)}</div><div class="cmp-en">${esc(g.nameEN)}</div></div>
    ${side==='b'?'<button type="button" class="cmp-swap" id="cmp-change">تغيير</button>':''}</div>`;
}

function verdicts(a,b){
  const out=[], ma=mohsOf(a), mb=mohsOf(b), da=densOf(a), db=densOf(b);
  if(Math.abs(ma-mb)<0.3) out.push(`صلابتهما متقاربة (نحو ${fmt(ma)} على مقياس موس).`);
  else { const [h,s]=ma>mb?[a,b]:[b,a]; out.push(`<b>${esc(h.nameAR)}</b> أصلب، ويستطيع أن يخدش ${esc(s.nameAR)}.`); }
  if(Math.abs(da-db)/Math.max(da,db)<0.06) out.push('كثافتهما متقاربة؛ فقطعتان بالحجم نفسه تزنان تقريباً الشيء نفسه.');
  else { const [h,l]=da>db?[a,b]:[b,a]; out.push(`<b>${esc(h.nameAR)}</b> أثقل بنحو ${fmt(Math.max(da,db)/Math.min(da,db))} مرة من ${esc(l.nameAR)} بالحجم نفسه.`); }
  if(a.cat===b.cat) out.push(`كلاهما من تصنيف «${catLabel(a.cat)}».`);
  return out.map(v=>`<li>${v}</li>`).join('');
}

function render(){
  $('cmp-a').innerHTML=head(A,'a');
  $('cmp-b').innerHTML=head(B,'b');
  const pick=$('cmp-pick'), body=$('cmp-body');
  pick.hidden=!!B; body.hidden=!B;
  if(!B){
    $('cmp-sugg').innerHTML=similarGems(A,6).map(g=>
      `<button type="button" class="sim" data-id="${g.id}">${gemIcon(g)}<span>${esc(g.nameAR)}</span></button>`).join('');
    return;
  }
  $('cmp-change')?.addEventListener('click',()=>{ B=null; render(); $('cmp-search').focus(); });
  const ma=mohsOf(A), mb=mohsOf(B), da=densOf(A), db=densOf(B), dmax=Math.max(da,db);
  const ta=ID_TRAITS[A.id]||{}, tb=ID_TRAITS[B.id]||{};
  const row=(lbl,va,vb)=>`<div class="cmp-row"><div class="cmp-lbl">${lbl}</div><div class="cmp-cell">${va}</div><div class="cmp-cell">${vb}</div></div>`;
  $('cmp-table').innerHTML=
    row('صلابة موس', `<b dir="ltr">${esc(A.hardness)}</b>${bar(ma,10,A.color)}`, `<b dir="ltr">${esc(B.hardness)}</b>${bar(mb,10,B.color)}`)+
    row('الكثافة', `<b dir="ltr">${esc(A.density)}</b>${bar(da,dmax,A.color)}`, `<b dir="ltr">${esc(B.density)}</b>${bar(db,dmax,B.color)}`)+
    row('الشفافية', T_WORD[ta.t]||'—', T_WORD[tb.t]||'—')+
    row('التصنيف', catLabel(A.cat), catLabel(B.cat))+
    row('المنشأ', esc(A.origin), esc(B.origin));
  $('cmp-verdict').innerHTML=verdicts(A,B);
}

function renderSearch(){
  const q=normAr($('cmp-search').value.trim());
  const list=$('cmp-results');
  if(!q){ list.innerHTML=''; return; }
  const hits=GEMS.filter(g=>g.id!==A.id&&normAr(`${g.nameAR} ${g.nameEN}`).includes(q)).slice(0,6);
  list.innerHTML=hits.length
    ? hits.map(g=>`<button type="button" class="sim" data-id="${g.id}">${gemIcon(g)}<span>${esc(g.nameAR)}</span></button>`).join('')
    : '<div class="cmp-none">لا يوجد حجر بهذا الاسم</div>';
}

function choose(id){ B=GEMS.find(g=>g.id===id)||null; $('cmp-search').value=''; $('cmp-results').innerHTML=''; render(); }

export function openCompare(gem){
  A=gem; B=null; render();
  $('cmp-panel').classList.add('show'); $('cmp-panel').scrollTop=0;
}
function closeCompare(){ $('cmp-panel').classList.remove('show'); }

export function initCompare({showGem,mergeTwo}){
  hooks={showGem,mergeTwo};
  $('cmp-close').addEventListener('click',closeCompare);
  $('cmp-search').addEventListener('input',renderSearch);
  $('cmp-search').addEventListener('keydown',(e)=>{
    if(e.key==='Enter'){ const first=$('cmp-results').querySelector('[data-id]'); if(first) choose(first.dataset.id); }
  });
  $('cmp-panel').addEventListener('click',(e)=>{
    const s=e.target.closest('#cmp-pick .sim'); if(s) choose(s.dataset.id);
  });
  $('cmp-show-b').addEventListener('click',()=>{ if(B){ closeCompare(); hooks.showGem(GEMS.indexOf(B)); } });
  $('cmp-merge').addEventListener('click',()=>{ if(B){ closeCompare(); hooks.mergeTwo([A.id,B.id]); } });
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&$('cmp-panel').classList.contains('show')) closeCompare(); });
}
