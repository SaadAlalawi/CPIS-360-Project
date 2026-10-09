/* ════════════════════════════════════════════════════════════
   التعرّف التقريبي على الحجر من صورة — ميزة تجريبية تعليمية
   ────────────────────────────────────────────────────────────
   • الصورة تُحلَّل داخل المتصفح فقط: لا تُرفع ولا تُحفظ.
   • النتيجة مقارنة بسيطة للّون مع إجابات المستخدم، وليست فحصاً
     ولا توثيقاً ولا تقييماً، ولا يُعتمد عليها في أي قرار.
   ════════════════════════════════════════════════════════════ */
import { GEMS, ID_TRAITS, gemIcon } from './gems.js';

const ACK_KEY='gems-ar-id-ack-v1';
const $=(id)=>document.getElementById(id);

/* ── colour maths: sRGB → CIELAB (D65) ── */
function rgb2lab(r,g,b){
  const lin=(v)=>{v/=255; return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;};
  const R=lin(r),G=lin(g),B=lin(b);
  const f=(t)=>t>0.008856?Math.cbrt(t):7.787*t+16/116;
  const x=f((R*0.4124+G*0.3576+B*0.1805)/0.95047),
        y=f( R*0.2126+G*0.7152+B*0.0722),
        z=f((R*0.0193+G*0.1192+B*0.9505)/1.08883);
  return [116*y-16, 500*(x-y), 200*(y-z)];
}
const hex2lab=(h)=>rgb2lab(parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16));
const dE=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const TRAIT_LAB=Object.fromEntries(Object.entries(ID_TRAITS).map(([id,t])=>[id,t.c.map(hex2lab)]));

/* ── state ── */
const state={img:null,pt:null,lab:null,rgb:null,answers:{t:'?',m:'?',p:'?'}};
let onShowGem=()=>{};

/* ── sampling: robust average colour inside a circle ── */
function sampleAt(x,y){
  const cv=$('id-canvas'), ctx=cv.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(state.img,0,0,cv.width,cv.height);   // fresh pixels, without the previous ring
  const r=Math.max(6,Math.round(Math.min(cv.width,cv.height)*0.07));
  const x0=Math.max(0,x-r), y0=Math.max(0,y-r), w=Math.min(cv.width,x+r)-x0, h=Math.min(cv.height,y+r)-y0;
  const data=ctx.getImageData(x0,y0,w,h).data, px=[];
  for(let j=0;j<h;j++) for(let i=0;i<w;i++){
    if((x0+i-x)**2+(y0+j-y)**2>r*r) continue;
    const k=(j*w+i)*4; px.push([data[k],data[k+1],data[k+2]]);
  }
  if(!px.length) return;
  // drop highlights and deep shadows so reflections don't dominate
  const labs=px.map(p=>({rgb:p,lab:rgb2lab(...p)})).sort((a,b)=>a.lab[0]-b.lab[0]);
  const keep=labs.slice(Math.floor(labs.length*0.1),Math.ceil(labs.length*0.85));
  const use=keep.length?keep:labs;
  const avg=(arr,f)=>arr.reduce((s,v)=>s+f(v),0)/arr.length;
  state.lab=[0,1,2].map(i=>avg(use,v=>v.lab[i]));
  state.rgb=[0,1,2].map(i=>Math.round(avg(use,v=>v.rgb[i])));
  state.pt={x,y,r};
  drawCanvas();
  const sw=$('id-swatch');
  sw.style.background=`rgb(${state.rgb.join(',')})`;
  $('id-color-row').hidden=false;
  updateGo();
}

function drawCanvas(){
  const cv=$('id-canvas'), ctx=cv.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(state.img,0,0,cv.width,cv.height);
  if(!state.pt) return;
  const {x,y,r}=state.pt;
  ctx.lineWidth=Math.max(2,r*0.12);
  ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(x,y,r+ctx.lineWidth,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle='#F5D76E'; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.stroke();
}

async function loadFile(file){
  if(!file||!file.type.startsWith('image/')){ showMsg('الملف ليس صورة.'); return; }
  try{
    const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
    const MAX=640, s=Math.min(1,MAX/Math.max(bmp.width,bmp.height));
    const cv=$('id-canvas'); cv.width=Math.round(bmp.width*s); cv.height=Math.round(bmp.height*s);
    state.img=bmp; state.pt=null;
    $('id-photo-wrap').hidden=false; $('id-pick-lbl').textContent='صورة أخرى';
    clearResults();
    sampleAt(Math.round(cv.width/2),Math.round(cv.height/2));
  }catch(e){ console.warn(e); showMsg('تعذّر فتح الصورة. جرّب صورة أخرى.'); }
}

/* ── scoring ── */
const T_ORDER=['clear','trans','opaque'];
function score(id){
  const tr=ID_TRAITS[id], a=state.answers;
  const d=Math.min(...TRAIT_LAB[id].map(l=>dE(l,state.lab)));
  let s=Math.exp(-d/22);
  const why=[d<18?'اللون قريب':d<35?'اللون متقارب':'اللون مختلف'];
  if(a.t!=='?'){
    const diff=Math.abs(T_ORDER.indexOf(a.t)-T_ORDER.indexOf(tr.t));
    s*=[1,0.45,0.12][diff]; if(diff===0) why.push({clear:'شفاف',trans:'شبه شفاف',opaque:'معتم'}[tr.t]);
  }
  if(a.m!=='?'){ const ok=(a.m==='yes')===!!tr.m; s*=ok?1:0.08; if(ok&&tr.m) why.push('لمعة معدنية'); }
  if(a.p!=='?'){ const ok=tr.p.includes(a.p); s*=ok?1:0.3; if(ok&&a.p!=='solid') why.push({bands:'فيه خطوط',flecks:'فيه نقاط',play:'وميض ألوان'}[a.p]); }
  return {id,s,why};
}

function identify(){
  if(!state.lab) return;
  const ranked=GEMS.map(g=>score(g.id)).sort((a,b)=>b.s-a.s).slice(0,3);
  // only the top match can be called "closest"; never more confident than that
  const label=(s,i)=>i===0&&s>=0.45?['الأقرب','hi']:s>=0.18?['محتمل','mid']:['بعيد','lo'];
  const list=$('id-results-list');
  list.innerHTML='';
  ranked.forEach((r,i)=>{
    const gem=GEMS.find(g=>g.id===r.id), [lbl,cls]=label(r.s,i);
    const row=document.createElement('div'); row.className='id-cand';
    row.innerHTML=`<span class="id-cand-ic">${gemIcon(gem)}</span>
      <div class="id-cand-txt"><div class="id-cand-name">${gem.nameAR} <span class="id-cand-en">${gem.nameEN}</span></div>
      <div class="id-cand-why">${r.why.join(' • ')}</div></div>
      <span class="id-tag ${cls}">${lbl}</span>`;
    const b=document.createElement('button'); b.type='button'; b.className='btn id-view'; b.textContent='اعرض النموذج';
    b.addEventListener('click',()=>{closeIdentify(); onShowGem(GEMS.indexOf(gem));});
    row.appendChild(b); list.appendChild(row);
  });
  $('id-weak').hidden=ranked[0].s>=0.18;
  $('id-results').hidden=false;
  $('id-results').scrollIntoView({behavior:'smooth',block:'start'});
}

function clearResults(){ $('id-results').hidden=true; }
function updateGo(){ $('id-go').disabled=!state.lab; }
function showMsg(m){ const el=$('id-msg'); el.textContent=m; el.hidden=!m; }

/* ── open / close / disclaimer gate ── */
let acked=false;
try{ acked=localStorage.getItem(ACK_KEY)==='1'; }catch{}
function renderGate(){ $('id-gate').hidden=acked; $('id-body').hidden=!acked; }

function openIdentify(){ renderGate(); showMsg(''); $('id-panel').classList.add('show'); $('id-panel').scrollTop=0; }
function closeIdentify(){ $('id-panel').classList.remove('show'); }

export function initIdentify({showGem}){
  onShowGem=showGem;
  $('id-open').addEventListener('click',openIdentify);
  $('id-close').addEventListener('click',closeIdentify);
  $('id-ack').addEventListener('change',(e)=>{$('id-ack-go').disabled=!e.target.checked;});
  $('id-ack-go').addEventListener('click',()=>{
    acked=true; try{ localStorage.setItem(ACK_KEY,'1'); }catch{}
    renderGate();
  });
  $('id-file').addEventListener('change',(e)=>{ loadFile(e.target.files[0]); e.target.value=''; });
  $('id-canvas').addEventListener('click',(e)=>{
    if(!state.img) return;
    const cv=e.currentTarget, r=cv.getBoundingClientRect();
    sampleAt(Math.round((e.clientX-r.left)*cv.width/r.width),Math.round((e.clientY-r.top)*cv.height/r.height));
    clearResults();
  });
  document.querySelectorAll('#id-panel .id-opts').forEach(group=>{
    group.addEventListener('click',(e)=>{
      const b=e.target.closest('button'); if(!b) return;
      group.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
      state.answers[group.dataset.q]=b.dataset.v;
      clearResults();
    });
  });
  $('id-go').addEventListener('click',identify);
  $('id-reset').addEventListener('click',()=>{
    state.img=null; state.pt=null; state.lab=null; state.answers={t:'?',m:'?',p:'?'};
    document.querySelectorAll('#id-panel .id-opts button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v==='?')));
    $('id-photo-wrap').hidden=true; $('id-color-row').hidden=true; $('id-pick-lbl').textContent='التقط أو اختر صورة';
    clearResults(); updateGo(); $('id-panel').scrollTop=0;
  });
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&$('id-panel').classList.contains('show')) closeIdentify(); });
}
