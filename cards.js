/* ════════════════════════════════════════════════════════════
   بناء محتوى البطاقات: مقياس موس، الكثافة، الشارات، الأحجار المشابهة
   ════════════════════════════════════════════════════════════ */
import { GEMS, CATEGORIES, ID_TRAITS, gemIcon } from './gems.js';

const nums=(s)=>(String(s).match(/\d+(?:\.\d+)?/g)||[]).map(Number);
/** Mohs hardness as one number: the middle of a range, ignoring the "/ 10" scale. */
export function mohsOf(gem){
  const n=nums(gem.hardness.replace(/\/\s*10/,''));
  return n.length ? n.reduce((a,b)=>a+b,0)/n.length : 0;
}
/** Density in g/cm³ (middle of a range). */
export function densOf(gem){
  const n=nums(gem.density.replace('cm³',''));
  return n.length ? n.reduce((a,b)=>a+b,0)/n.length : 0;
}
export const catLabel=(id)=>CATEGORIES.find(c=>c.id===id)?.label||'';
const fmt=(x)=>(Math.round(x*10)/10).toString();
const esc=(s)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export const GLASS=5.5;   // window glass on the Mohs scale
export function hardnessWord(m){
  return m>=8?'صلب جداً':m>=6?'صلب':m>=4?'متوسط الصلابة':'طري';
}

/** Mohs meter (1–10) with a tick for glass. */
export function mohsMeter(gem,{compact=false}={}){
  const m=mohsOf(gem);
  return `<div class="mohs${compact?' compact':''}" style="--v:${(m/10).toFixed(3)};--c:${gem.color}" role="img"
      aria-label="صلابة ${fmt(m)} من 10 على مقياس موس">
      <span class="mohs-fill"></span><span class="mohs-glass" title="الزجاج ${GLASS}"></span>
    </div>
    ${compact?'':'<div class="mohs-scale"><span>1 الطلق</span><span>5.5 الزجاج</span><span>10 الماس</span></div>'}`;
}

/** Stats block shared by the bottom card and the AR card. */
export function statsHTML(gem,{compact=false}={}){
  const m=mohsOf(gem), d=densOf(gem);
  const scratch=m>GLASS?'يخدش الزجاج':m===GLASS?'بصلابة الزجاج':'يخدشه الزجاج';
  const water=d<1?'أخف من الماء':`أثقل من الماء ${fmt(d)}×`;
  return `
    <div class="stat stat-wide">
      <div class="s-row"><span class="s-lbl">صلابة موس</span><span class="s-val" dir="ltr" style="color:${gem.color}">${esc(gem.hardness)}</span></div>
      ${mohsMeter(gem,{compact})}
      <div class="s-note">${hardnessWord(m)} • ${scratch}</div>
    </div>
    <div class="stat"><span class="s-lbl">الكثافة</span><span class="s-val" dir="ltr">${esc(gem.density)}</span><span class="s-note">${water}</span></div>
    <div class="stat"><span class="s-lbl">المنشأ</span><span class="s-val s-origin">${esc(gem.origin)}</span></div>`;
}

/** Small badges: category, transparency, lustre. */
export function badgesHTML(gem){
  const t=ID_TRAITS[gem.id]||{};
  const out=[`<span class="badge cat" style="--c:${gem.color}">${catLabel(gem.cat)}</span>`];
  if(t.t) out.push(`<span class="badge">${{clear:'شفاف',trans:'شبه شفاف',opaque:'معتم'}[t.t]}</span>`);
  if(t.m) out.push('<span class="badge">لمعة معدنية</span>');
  if(t.p?.includes('play')) out.push('<span class="badge">وميض ألوان</span>');
  if(gem.origin.includes('مصنّع')) out.push('<span class="badge warn">غالباً مصنّع</span>');
  return out.join('');
}

const rgb=(h)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
/** Gems that look alike: nearest colour, preferring the same category. */
export function similarGems(gem,n=4){
  const a=rgb(gem.color);
  return GEMS.filter(g=>g.id!==gem.id)
    .map(g=>{const b=rgb(g.color); return {g,s:Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])+(g.cat===gem.cat?0:70)};})
    .sort((x,y)=>x.s-y.s).slice(0,n).map(x=>x.g);
}

export function similarHTML(gem){
  return `<div class="c-sec-t">أحجار مشابهة</div><div class="sim-row">${
    similarGems(gem).map(g=>`<button type="button" class="sim" data-id="${g.id}">${gemIcon(g)}<span>${esc(g.nameAR)}</span></button>`).join('')
  }</div>`;
}
