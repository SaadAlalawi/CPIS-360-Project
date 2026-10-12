/* ════════════════════════════════════════════════════════════
   GEMS AR — معرض الأحجار الكريمة
   ════════════════════════════════════════════════════════════ */

import { GEMS, CATEGORIES, gemIcon, normAr } from './gems.js';
import { initIdentify } from './identify.js';
import { statsHTML, badgesHTML, similarHTML, mohsOf } from './cards.js';
import { initCompare, openCompare } from './compare.js';
const gemById=(id)=>GEMS.find(g=>g.id===id);
const modelURL=(id)=>`models/${id}.glb`;

const AR_MODES_SINGLE='webxr scene-viewer quick-look';
// Scene Viewer (Android) needs a real file URL; the merged scene is built in memory.
const AR_MODES_MERGED='webxr quick-look';
const MERGE_SPACING=0.32;   // metres between gems in the merged scene
const MERGE_SIZE=0.22;      // longest side of each gem in the merged scene

/* ── three.js is only needed for merging, so load it on demand ── */
let _threeP=null;
function loadThree(){
  if(!_threeP){
    _threeP=Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/exporters/GLTFExporter.js'),
    ]).then(([THREE,{GLTFLoader},{GLTFExporter}])=>({THREE,GLTFLoader,GLTFExporter}));
    _threeP.catch(()=>{_threeP=null});
  }
  return _threeP;
}

/* ── Merge selected gems into one side-by-side GLB ── */
let mergedObjectURL=null;
async function buildMergedGLB(ids){
  const {THREE,GLTFLoader,GLTFExporter}=await loadThree();
  const loader=new GLTFLoader();
  const root=new THREE.Group();
  const layout=[];

  for(let i=0;i<ids.length;i++){
    const id=ids[i];
    let scene;
    try{ scene=(await loader.loadAsync(modelURL(id))).scene; }
    catch(err){ console.warn('skip',id,err); continue; }

    const box=new THREE.Box3().setFromObject(scene);
    const size=box.getSize(new THREE.Vector3());
    scene.scale.multiplyScalar(MERGE_SIZE/(Math.max(size.x,size.y,size.z)||1));

    const nbox=new THREE.Box3().setFromObject(scene);
    const center=nbox.getCenter(new THREE.Vector3());
    scene.position.sub(center);
    // first pick on the right, matching the Arabic reading order
    const x=((ids.length-1)/2-i)*MERGE_SPACING;
    scene.position.x+=x;
    scene.name='gem_'+id;
    root.add(scene);
    layout.push({id,x,top:nbox.max.y-center.y});
  }
  if(!layout.length) throw new Error('no models loaded');

  const glb=await new GLTFExporter().parseAsync(root,{binary:true});
  if(mergedObjectURL) URL.revokeObjectURL(mergedObjectURL);
  mergedObjectURL=URL.createObjectURL(new Blob([glb],{type:'model/gltf-binary'}));
  return {url:mergedObjectURL,layout};
}

/* ── ELEMENTS ── */
const $=(id)=>document.getElementById(id);
const mv=$('mv'),mvLoader=$('mv-loader'),loaderTxt=$('loader-txt'),progressBar=$('progress-bar'),
      flEN=$('fl-en'),flAR=$('fl-ar'),arBtn=$('ar-btn'),arBtnTxt=$('ar-btn-txt'),
      statusBadge=$('status-badge'),arHud=$('ar-hud'),hudLabel=$('hud-label'),
      mergeOverlay=$('merge-overlay'),mergeIcons=$('merge-icons'),mergeSub=$('merge-sub'),
      mergeActions=$('merge-actions'),mergeStart=$('merge-start'),
      arInfoCard=$('ar-info-card'),quizCard=$('quiz-card');
const genericHotspots=['hotspot-info','hotspot-cycle','hotspot-glow']
  .map(s=>document.querySelector(`[slot="${s}"]`));
const [hsInfo,hsCycle,hsGlow]=genericHotspots;

/* model-viewer's inner container can be scrolled sideways when a button inside it
   gets focus, which pushes the AR cards off-screen — keep it pinned. */
customElements.whenDefined('model-viewer').then(()=>{
  const box=mv.shadowRoot?.querySelector('.container');
  box?.addEventListener('scroll',()=>{ if(box.scrollLeft||box.scrollTop){ box.scrollLeft=0; box.scrollTop=0; } });
});

/* ── STATE ── */
let activeIdx=0, modelLoaded=false;
let mode='single';          // 'single' | 'merged'
let mergedIds=[];           // gem ids in the merged scene
let mergedIdx=0;            // focused gem in the merged scene
const multiSelected=new Set();

/** The gem the hotspots / HUD currently act on. */
function currentGem(){
  return mode==='merged' ? gemById(mergedIds[mergedIdx]) : GEMS[activeIdx];
}

/* HTTPS check */
(function(){
  const ok=location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1';
  if(!ok){const w=$('https-warn');w.style.display='block';
    w.innerHTML='⚠️ AR يحتاج <strong>HTTPS</strong> — ارفع على <a href="https://pages.github.com" target="_blank" rel="noopener">GitHub Pages</a>';}
})();

let _st;
function showStatus(msg){statusBadge.textContent=msg;statusBadge.classList.add('show');
  clearTimeout(_st);_st=setTimeout(()=>statusBadge.classList.remove('show'),5000)}

/* ── BUILD MENUS ── */
let activeCat='all';
/* ── favourites (kept on this device only) ── */
const FAV_KEY='gems-ar-favs-v1';
let favs=new Set();
try{ favs=new Set(JSON.parse(localStorage.getItem(FAV_KEY)||'[]')); }catch{}
const saveFavs=()=>{ try{ localStorage.setItem(FAV_KEY,JSON.stringify([...favs])); }catch{} };

const inCat=(gem)=>activeCat==='all'||(activeCat==='fav'?favs.has(gem.id):gem.cat===activeCat);
const catLabel=(id)=>CATEGORIES.find(c=>c.id===id)?.label||'';

function buildMenu(){
  const cats=$('cat-scroll');
  CATEGORIES.forEach(cat=>{
    const n=cat.id==='all'?GEMS.length:GEMS.filter(g=>g.cat===cat.id).length;
    const b=document.createElement('button');
    b.type='button'; b.className='cat-pill'; b.dataset.cat=cat.id;
    b.setAttribute('aria-pressed',String(cat.id===activeCat));
    b.innerHTML=`${cat.label}<span class="cat-n">${n}</span>`;
    b.addEventListener('click',()=>setCategory(cat.id));
    cats.appendChild(b);
  });
  const fb=document.createElement('button');
  fb.type='button'; fb.className='cat-pill cat-fav'; fb.dataset.cat='fav'; fb.setAttribute('aria-pressed','false');
  fb.innerHTML='★ المفضلة<span class="cat-n" id="fav-n">0</span>';
  fb.addEventListener('click',()=>setCategory('fav'));
  cats.appendChild(fb);
  const s=$('menu-scroll');
  GEMS.forEach((gem,i)=>{
    const c=document.createElement('button');
    c.type='button';
    c.className='gem-chip';
    c.dataset.cat=gem.cat;
    c.setAttribute('aria-label',gem.nameAR);
    c.style.setProperty('--chip-color',gem.color);
    c.dataset.id=gem.id;
    c.innerHTML=`<span class="chip-em">${gemIcon(gem)}</span><span class="chip-lbl">${gem.nameEN}</span><span class="chip-dot"></span><span class="chip-fav" aria-hidden="true">★</span>`;
    c.addEventListener('click',()=>selectGem(i));
    s.appendChild(c);
  });
}

function applyMenuFilter(){
  let shown=0;
  document.querySelectorAll('.gem-chip').forEach((c,i)=>{
    const on=inCat(GEMS[i]); c.hidden=!on; shown+=on;
    c.classList.toggle('is-fav',favs.has(GEMS[i].id));
  });
  $('menu-empty').hidden=shown>0;
  $('fav-n').textContent=favs.size;
}

function toggleFav(gem){
  if(favs.has(gem.id)){ favs.delete(gem.id); toast('أُزيل من المفضلة'); }
  else { favs.add(gem.id); toast('★ أُضيف إلى المفضلة','ok'); }
  saveFavs();
  $('c-fav').setAttribute('aria-pressed',String(favs.has(gem.id)));
  applyMenuFilter();
}

/* ── SEARCH BAR ──
   Matches every word typed against the gem's names first, then its
   category, origin and description — so "أحمر" or "البرازيل" work too. */
const SEARCH_INDEX=GEMS.map((g,i)=>({i,
  name:normAr(`${g.nameAR} ${g.nameEN}`),
  more:normAr(`${catLabel(g.cat)} ${g.origin} ${g.desc}`)}));
const sInput=$('gem-search'), sList=$('search-list'), sClear=$('search-clear');
let sResults=[], sActive=-1;

function searchGems(q){
  const words=normAr(q).split(/\s+/).filter(Boolean);
  if(!words.length) return [];
  const out=[];
  for(const e of SEARCH_INDEX){
    let score=0, viaMore=false;
    for(const w of words){
      if(e.name.split(' ').some(p=>p.startsWith(w))) score+=3;
      else if(e.name.includes(w)) score+=2;
      else if(e.more.includes(w)){ score+=1; viaMore=true; }
      else { score=-1; break; }
    }
    if(score>0) out.push({i:e.i,score,viaMore});
  }
  return out.sort((a,b)=>b.score-a.score||a.i-b.i);
}

function renderSearch(){
  const q=sInput.value.trim();
  sClear.hidden=!q;
  sResults=searchGems(q); sActive=sResults.length?0:-1;
  if(!q){ closeSearch(); return; }
  sList.innerHTML = sResults.length
    ? sResults.slice(0,40).map((r,k)=>{
        const g=GEMS[r.i];
        const sub=r.viaMore?`${catLabel(g.cat)} • ${g.origin}`:catLabel(g.cat);
        return `<li role="option" id="sr-${k}" data-k="${k}" aria-selected="${k===sActive}">
          <span class="sr-ic">${gemIcon(g)}</span>
          <span class="sr-txt"><span class="sr-ar">${g.nameAR}</span><span class="sr-sub">${sub}</span></span>
          <span class="sr-en">${g.nameEN}</span></li>`;
      }).join('') + (sResults.length>40?`<li class="sr-more">و${sResults.length-40} نتيجة أخرى — اكتب أكثر لتضييق البحث</li>`:'')
    : '<li class="sr-none">لا يوجد حجر يطابق البحث</li>';
  sList.hidden=false; sInput.setAttribute('aria-expanded','true');
  sInput.setAttribute('aria-activedescendant',sActive>=0?`sr-${sActive}`:'');
}
function moveActive(d){
  if(!sResults.length) return;
  const n=Math.min(sResults.length,40);
  sActive=(sActive+d+n)%n;
  sList.querySelectorAll('[role="option"]').forEach(li=>li.setAttribute('aria-selected',String(+li.dataset.k===sActive)));
  sList.querySelector(`#sr-${sActive}`)?.scrollIntoView({block:'nearest'});
  sInput.setAttribute('aria-activedescendant',`sr-${sActive}`);
}
function closeSearch(){ sList.hidden=true; sInput.setAttribute('aria-expanded','false'); }
function pickResult(k){
  const r=sResults[k]; if(!r) return;
  sInput.value=''; sClear.hidden=true; closeSearch(); sInput.blur();
  if(!inCat(GEMS[r.i])) setCategory('all',{jump:false});
  selectGem(r.i);
}
sInput.addEventListener('input',renderSearch);
sInput.addEventListener('focus',()=>{ if(sInput.value.trim()) renderSearch(); });
sInput.addEventListener('keydown',(e)=>{
  if(e.key==='ArrowDown'){ e.preventDefault(); moveActive(1); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); moveActive(-1); }
  else if(e.key==='Enter'){ e.preventDefault(); pickResult(Math.max(0,sActive)); }
  else if(e.key==='Escape'){ if(!sList.hidden) closeSearch(); else { sInput.value=''; sClear.hidden=true; sInput.blur(); } }
});
// pointerdown (not click) so the choice registers before the input loses focus
sList.addEventListener('pointerdown',(e)=>{
  const li=e.target.closest('[role="option"]'); if(!li) return;
  e.preventDefault(); pickResult(+li.dataset.k);
});
sClear.addEventListener('click',()=>{ sInput.value=''; sClear.hidden=true; closeSearch(); sInput.focus(); });
document.addEventListener('pointerdown',(e)=>{ if(!e.target.closest('#search-wrap')) closeSearch(); });
document.addEventListener('keydown',(e)=>{
  if(e.key==='/'&&!/input|textarea/i.test(document.activeElement?.tagName||'')){ e.preventDefault(); sInput.focus(); }
});

function setCategory(id,{jump=true}={}){
  activeCat=id;
  document.querySelectorAll('.cat-pill').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cat===id)));
  applyMenuFilter();
  if(!jump) return;
  $('menu-scroll').scrollTo({left:0,behavior:'smooth'});
  // jump to the first gem of the category unless the current one already belongs to it
  const first=GEMS.findIndex(inCat);
  if(first>=0&&(mode!=='single'||!inCat(GEMS[activeIdx]))) selectGem(first);
}

function buildMultiGrid(){
  const g=$('mp-grid');
  GEMS.forEach(gem=>{
    const c=document.createElement('button');
    c.type='button';
    c.className='mp-chip';
    c.id=`mp-${gem.id}`;
    c.setAttribute('aria-pressed','false');
    c.setAttribute('aria-label',gem.nameAR);
    c.dataset.search=normAr(`${gem.nameAR} ${gem.nameEN} ${catLabel(gem.cat)}`);
    c.innerHTML=`<span class="mp-em">${gemIcon(gem)}</span><span class="mp-lbl">${gem.nameAR}</span>`;
    c.addEventListener('click',()=>toggleMultiSelect(gem.id));
    g.appendChild(c);
  });
  $('mp-search').addEventListener('input',(e)=>{
    const q=normAr(e.target.value); let shown=0;
    document.querySelectorAll('.mp-chip').forEach(c=>{
      const hit=!q||c.dataset.search.includes(q);
      c.hidden=!hit; shown+=hit;
    });
    $('mp-empty').hidden=shown>0;
  });
}

/* ── HOTSPOTS ── */
/** Place the 3 generic hotspots just outside the loaded model's bounds. */
function placeGenericHotspots(){
  const d=mv.getDimensions(), c=mv.getBoundingBoxCenter();
  const pad=0.03;
  const set=(name,x,y,z)=>mv.updateHotspot({name,position:`${x}m ${y}m ${z}m`});
  set('hotspot-info',  c.x,               c.y+d.y/2+pad, c.z);
  set('hotspot-cycle', c.x+d.x/2+pad,     c.y,           c.z);
  set('hotspot-glow',  c.x-d.x/2-pad,     c.y,           c.z);
}

function setHotspotsForMode(layout=[]){
  document.querySelectorAll('.hotspot.gem-tag').forEach(el=>el.remove());
  // In the merged scene each gem gets its own tag; the generic ones would sit on top of the gems.
  genericHotspots.forEach(h=>{h.hidden=(mode==='merged')});
  if(mode!=='merged') return;
  layout.forEach((item,i)=>{
    const gem=gemById(item.id); if(!gem) return;
    const btn=document.createElement('button');
    btn.className='hotspot gem-tag';
    btn.setAttribute('slot',`hotspot-gem-${i}`);
    btn.setAttribute('data-position',`${item.x.toFixed(3)}m ${(item.top+0.07).toFixed(3)}m 0m`);
    btn.setAttribute('data-normal','0 1 0');
    btn.setAttribute('aria-label',`معلومات ${gem.nameAR}`);
    btn.style.setProperty('--chip',gem.color);
    btn.style.setProperty('--chip-glow',gem.color+'66');
    btn.innerHTML=`<span class="hs-icon">${gemIcon(gem)}</span><span class="hs-lbl">${gem.nameEN}</span>`;
    btn.addEventListener('click',()=>{focusMerged(i); showInfoCard(gem);});
    mv.appendChild(btn);
  });
}

/* ── INFO PANEL (bottom) ── */
function fillInfoPanel(gem){
  const em=$('c-emoji');
  em.innerHTML=gemIcon(gem); em.style.background=gem.color+'22'; em.style.boxShadow=`0 0 18px ${gem.color}44`;
  $('c-en').textContent=gem.nameEN;
  $('c-ar').textContent=gem.nameAR;
  $('c-badges').innerHTML=badgesHTML(gem);
  $('c-desc').textContent=gem.desc;
  $('c-stats').innerHTML=statsHTML(gem);
  $('c-similar').innerHTML=similarHTML(gem);
  $('c-fav').setAttribute('aria-pressed',String(favs.has(gem.id)));
  ['c-stats','c-similar','c-badges','c-actions'].forEach(id=>$(id).hidden=false);
  $('info-card').style.borderTopColor=gem.color+'50';
  $('info-card').scrollTop=0;
}
$('c-similar').addEventListener('click',(e)=>{
  const b=e.target.closest('.sim'); if(b) showGemById(b.dataset.id);
});
$('c-fav').addEventListener('click',()=>{ if(mode==='single') toggleFav(GEMS[activeIdx]); });
$('c-cmp').addEventListener('click',()=>{ if(mode==='single') openCompare(GEMS[activeIdx]); });
$('c-share').addEventListener('click',()=>shareGem(GEMS[activeIdx]));

/* ── share & deep links: index.html#ruby opens the ruby ── */
const gemURL=(gem)=>location.href.split('#')[0]+'#'+gem.id;
async function shareGem(gem){
  const url=gemURL(gem), text=`${gem.nameAR} (${gem.nameEN}) — ${gem.desc}`;
  try{
    if(navigator.share){ await navigator.share({title:`${gem.nameAR} — GEMS AR`,text,url}); return; }
    await navigator.clipboard.writeText(url); toast('✓ نُسخ رابط الحجر','ok');
  }catch(err){
    if(err?.name!=='AbortError') toast('تعذّرت المشاركة — انسخ الرابط من شريط العنوان','err');
  }
}
function showGemById(id){
  const i=GEMS.findIndex(g=>g.id===id); if(i<0) return;
  if(!inCat(GEMS[i])) setCategory('all',{jump:false});
  selectGem(i);
}
window.addEventListener('hashchange',()=>{
  const id=decodeURIComponent(location.hash.slice(1));
  if(id&&(mode!=='single'||GEMS[activeIdx]?.id!==id)) showGemById(id);
});

function setFloatLabel(en,ar,color){
  flEN.textContent=en; flEN.style.color=color;
  flEN.style.textShadow=`0 0 28px ${color}66`; flAR.textContent=ar;
}

function setLoading(text,pct){
  modelLoaded=false;
  arBtn.disabled=true; arBtnTxt.textContent='جارٍ التحميل…';
  mvLoader.classList.remove('hidden'); loaderTxt.textContent=text; progressBar.style.width=pct+'%';
}

/* ── SELECT GEM (single mode) ── */
function selectGem(idx){
  if(mode==='single' && idx===activeIdx && modelLoaded) return;
  arInfoCard.classList.remove('show');
  quizCard.classList.remove('show');
  mode='single'; mergedIds=[];
  activeIdx=idx;
  const gem=GEMS[idx];
  document.querySelectorAll('.gem-chip').forEach((c,i)=>{
    c.classList.toggle('active',i===idx);
    c.setAttribute('aria-pressed',String(i===idx));
  });
  if(!inCat(gem)) setCategory('all',{jump:false});
  $('menu-scroll').children[idx].scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
  setLoading(gem.nameAR,10);
  setFloatLabel(gem.nameEN,gem.nameAR,gem.color);
  fillInfoPanel(gem);
  try{ history.replaceState(null,'','#'+gem.id); }catch{}
  mv.setAttribute('ar-modes',AR_MODES_SINGLE);
  mv.autoRotate=true;
  mv.src=modelURL(gem.id);
  setHotspotsForMode();
  hudLabel.textContent=gem.nameAR;
  toast('✦ '+gem.nameAR);
  const h=$('hint');
  h.style.animation='none'; void h.offsetWidth;
  h.style.animation='hintFade 3s ease 0.5s forwards';
}

/** Focus gem i inside the merged scene. */
function focusMerged(i){
  if(!mergedIds.length) return;
  mergedIdx=(i+mergedIds.length)%mergedIds.length;
  const gem=currentGem();
  hudLabel.textContent=gem.nameAR;
  flashGlow(gem.color);
}

/* ── AR INFO CARD ── */
function showInfoCard(gem){
  if(!gem) return;
  quizCard.classList.remove('show');
  const em=$('ar-info-emoji');
  em.innerHTML=gemIcon(gem); em.style.color=gem.color;
  $('ar-info-en').textContent=gem.nameEN; $('ar-info-en').style.color=gem.color;
  $('ar-info-ar').textContent=gem.nameAR;
  $('ar-info-desc').textContent=gem.desc; $('ar-info-desc').style.borderRightColor=gem.color;
  $('ar-info-stats').innerHTML=statsHTML(gem,{compact:true});
  arInfoCard.style.borderColor=gem.color;
  arInfoCard.style.boxShadow=`0 12px 60px rgba(0,0,0,0.75), 0 0 36px ${gem.color}55`;
  arInfoCard.classList.add('show');
}
$('ar-info-close').addEventListener('click',()=>arInfoCard.classList.remove('show'));

/* ── SHARED ACTIONS (hotspots + HUD) ── */
function actInfo(){ showInfoCard(currentGem()); }
function actGlow(){ flashGlow(currentGem()?.color||'#D4AF37'); }
function actStep(dir){
  if(mode==='merged') focusMerged(mergedIdx+dir);
  else {
    let list=GEMS.map((g,i)=>i).filter(i=>inCat(GEMS[i]));
    if(!list.length) list=GEMS.map((g,i)=>i);
    const at=Math.max(0,list.indexOf(activeIdx));
    selectGem(list[(at+dir+list.length)%list.length]);
  }
}
hsInfo.addEventListener('click',actInfo);
hsCycle.addEventListener('click',()=>actStep(1));
hsGlow.addEventListener('click',actGlow);
$('hud-prev').addEventListener('click',()=>actStep(-1));
$('hud-next').addEventListener('click',()=>actStep(1));
$('hud-glow').addEventListener('click',actGlow);
$('hud-info').addEventListener('click',actInfo);
$('hud-quiz').addEventListener('click',()=>openQuiz());

/* ── GLOW EFFECT: pulse exposure + label ── */
let _glowing=false;
const BASE_EXPOSURE=parseFloat(mv.getAttribute('exposure')||'1.2');
function flashGlow(color){
  if(_glowing) return; _glowing=true;
  const start=performance.now(); const DUR=1100;
  function tick(now){
    const t=(now-start)/DUR;
    if(t>=1){ mv.exposure=BASE_EXPOSURE; _glowing=false; return; }
    mv.exposure=BASE_EXPOSURE+Math.sin(t*Math.PI)*1.5;   // 0→1→0
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  flEN.classList.remove('glowing'); void flEN.offsetWidth; flEN.classList.add('glowing');
  flEN.style.color=color;
  flEN.style.textShadow=`0 0 28px ${color}, 0 0 60px ${color}88`;
}

/* ── MODEL VIEWER EVENTS ── */
mv.addEventListener('progress',(e)=>{progressBar.style.width=Math.max(10,Math.round(e.detail.totalProgress*100))+'%'});
mv.addEventListener('load',()=>{
  modelLoaded=true; mvLoader.classList.add('hidden'); progressBar.style.width='100%';
  if(mode==='single') placeGenericHotspots();
  if(mv.canActivateAR){arBtn.disabled=false;arBtnTxt.textContent='وضع AR';showStatus('✓ جاهز — AR متاح')}
  else{arBtn.disabled=true;arBtnTxt.textContent='AR غير مدعوم';showStatus('⚠️ AR يحتاج HTTPS وجهاز جوال')}
});
mv.addEventListener('error',()=>{mvLoader.classList.add('hidden');arBtn.disabled=true;arBtnTxt.textContent='خطأ';toast('⚠️ خطأ في التحميل','err')});
function arEnded(){
  arBtn.disabled=!mv.canActivateAR; arBtnTxt.textContent='وضع AR';
  arHud.classList.remove('show'); arInfoCard.classList.remove('show'); quizCard.classList.remove('show');
  document.body.classList.remove('ar-active');
}
mv.addEventListener('ar-status',(e)=>{
  const st=e.detail.status;
  if(st==='session-started'){toast('✓ وضع AR نشط','ok'); arHud.classList.add('show'); document.body.classList.add('ar-active')}
  if(st==='not-presenting') arEnded();
  if(st==='failed'){toast('⚠️ فشل AR','err'); arEnded()}
});

/* ── QUIZ ──
   Three kinds of question, picked at random:
   • name   — identify a gem from its properties
   • harder — which of four gems is hardest (Mohs)
   • cat    — which category a gem belongs to                     */
const BEST_KEY='gems-ar-quiz-best';
let quizCurrent=null, quizLastId=null;
let quizScore={right:0,total:0,streak:0};
let quizBest=0; try{ quizBest=+localStorage.getItem(BEST_KEY)||0; }catch{}

function openQuiz(){
  arInfoCard.classList.remove('show');
  quizScore={right:0,total:0,streak:0};
  newQuizQuestion();
  quizCard.classList.add('show');
}
function closeQuiz(){ quizCard.classList.remove('show'); quizCurrent=null; }
$('quiz-close').addEventListener('click',closeQuiz);

function shuffle(arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
const pickGem=()=>{ const pool=GEMS.filter(g=>g.id!==quizLastId); const g=pool[Math.floor(Math.random()*pool.length)]; quizLastId=g.id; return g; };

function qName(){
  const correct=pickGem();
  const opts=shuffle([correct,...shuffle(GEMS.filter(g=>g.id!==correct.id)).slice(0,3)]);
  return {
    // a neutral symbol tinted with the gem colour — its icon would give the answer away
    html:`<span class="quiz-em" style="color:${correct.color}" aria-hidden="true">◆</span>
      <div>ما اسم هذا الحجر؟</div>
      <div class="quiz-clue">صلابة <bdi dir="ltr">${correct.hardness}</bdi> • كثافة <bdi dir="ltr">${correct.density}</bdi><br>المنشأ: ${correct.origin}</div>`,
    options:opts.map(g=>({id:g.id,label:g.nameAR})),
    correct:correct.id, color:correct.color, answer:correct.nameAR, gem:correct,
  };
}
function qHarder(){
  // four gems whose hardest one is clearly (≥0.5) harder than the rest
  for(let tries=0;tries<200;tries++){
    const four=shuffle(GEMS).slice(0,4);
    const m=four.map(mohsOf), sorted=[...m].sort((a,b)=>b-a);
    if(sorted[0]-sorted[1]<0.5) continue;
    const best=four[m.indexOf(sorted[0])];
    return {
      html:`<span class="quiz-em" aria-hidden="true">⚒️</span><div>أيّ هذه الأحجار أصلب؟</div>
        <div class="quiz-clue">الأصلب يستطيع أن يخدش الأطرى منه</div>`,
      options:four.map(g=>({id:g.id,label:g.nameAR,after:g.hardness})),
      correct:best.id, color:best.color, answer:`${best.nameAR} (\u2066${best.hardness}\u2069)`, gem:best,
    };
  }
  return qName();
}
function qCat(){
  const gem=pickGem();
  const cats=CATEGORIES.filter(c=>c.id!=='all');
  const opts=shuffle([cats.find(c=>c.id===gem.cat),...shuffle(cats.filter(c=>c.id!==gem.cat)).slice(0,3)]);
  return {
    html:`<span class="quiz-em" aria-hidden="true">${gemIcon(gem)}</span>
      <div>إلى أي تصنيف ينتمي <b>${gem.nameAR}</b>؟</div>`,
    options:opts.map(c=>({id:c.id,label:c.label})),
    correct:gem.cat, color:gem.color, answer:catLabel(gem.cat), gem,
  };
}

function newQuizQuestion(){
  const r=Math.random();
  quizCurrent = r<0.5 ? qName() : r<0.8 ? qHarder() : qCat();
  $('quiz-question').innerHTML=quizCurrent.html;
  const optsEl=$('quiz-options');
  optsEl.innerHTML='';
  quizCurrent.options.forEach(o=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='quiz-opt';
    btn.textContent=o.label;
    btn.dataset.id=o.id;
    btn.addEventListener('click',()=>submitAnswer(o.id));
    optsEl.appendChild(btn);
  });
  const res=$('quiz-result');
  res.textContent=''; res.className='quiz-result';
  $('quiz-next').classList.remove('show');
  $('quiz-view').hidden=true;
  updateQuizScore();
}

function submitAnswer(id){
  if(!quizCurrent) return;
  const optBtns=[...document.querySelectorAll('.quiz-opt')];
  if(optBtns.some(b=>b.disabled)) return;
  const q=quizCurrent, ok=id===q.correct;
  quizScore.total++;
  optBtns.forEach(b=>{
    b.disabled=true;
    const o=q.options.find(x=>x.id===b.dataset.id);
    if(o?.after){ const s=document.createElement('small'); s.dir='ltr'; s.textContent=o.after; b.appendChild(s); }
    if(b.dataset.id===q.correct) b.classList.add('correct');
    if(b.dataset.id===id && !ok) b.classList.add('wrong');
  });
  const res=$('quiz-result');
  if(ok){
    quizScore.right++; quizScore.streak++;
    if(quizScore.streak>quizBest){ quizBest=quizScore.streak; try{ localStorage.setItem(BEST_KEY,String(quizBest)); }catch{} }
    res.textContent=`✓ أحسنت! ${q.answer}`;
    res.className='quiz-result ok';
    flashGlow(q.color);
  } else {
    quizScore.streak=0;
    res.textContent=`✗ الإجابة الصحيحة: ${q.answer}`;
    res.className='quiz-result err';
  }
  $('quiz-next').classList.add('show');
  $('quiz-view').hidden=mode!=='single'||!q.gem||GEMS[activeIdx]?.id===q.gem.id;
  updateQuizScore();
}

function updateQuizScore(){
  $('quiz-score').innerHTML=
    `النتيجة: <b>${quizScore.right} / ${quizScore.total}</b>`+
    ` • متتالية: <b>${quizScore.streak}</b>${quizScore.streak>=3?' 🔥':''}`+
    ` • أفضل: <b>${quizBest}</b>`;
}
$('quiz-view').addEventListener('click',()=>{ const g=quizCurrent?.gem; if(g){ const keep=quizCard.classList.contains('show'); showGemById(g.id); if(keep) quizCard.classList.add('show'); $('quiz-view').hidden=true; } });
$('quiz-next').addEventListener('click',newQuizQuestion);

/* ── ENTER AR ── */
function enterAR(){
  if(!modelLoaded){toast('⚠️ انتظر التحميل','err');return}
  if(!mv.canActivateAR){
    if(location.protocol!=='https:'&&location.hostname!=='localhost')toast('⚠️ يحتاج HTTPS','err');
    else if(!/android|iphone|ipad/i.test(navigator.userAgent))toast('⚠️ AR على الجوال فقط','err');
    else toast('⚠️ جهازك لا يدعم ARCore/Quick Look','err');
    return;
  }
  mv.activateAR();
}

/* ── MULTI AR PANEL ── */
function openMultiPanel(){
  const s=$('mp-search'); s.value=''; s.dispatchEvent(new Event('input'));
  $('multi-panel').classList.add('show');
}
function closeMultiPanel(){$('multi-panel').classList.remove('show')}

function toggleMultiSelect(id){
  if(multiSelected.has(id)) multiSelected.delete(id);
  else if(multiSelected.size<4) multiSelected.add(id);
  else{toast('⚠️ 4 أحجار كحد أقصى','err');return}
  refreshMultiChips();
}
function refreshMultiChips(){
  document.querySelectorAll('.mp-chip').forEach(c=>{
    const on=multiSelected.has(c.id.replace('mp-',''));
    c.classList.toggle('selected',on);
    c.setAttribute('aria-pressed',String(on));
  });
  const n=multiSelected.size;
  $('mp-count').textContent = n===0 ? 'لم تختر بعد' : `${n} ${n===1?'حجر':'أحجار'} مختارة`;
  $('mp-launch-btn').disabled=(n<2);
}

function waitForLoad(){
  return new Promise((resolve,reject)=>{
    const done=(ok)=>()=>{mv.removeEventListener('load',onL);mv.removeEventListener('error',onE);ok?resolve():reject(new Error('model load failed'))};
    const onL=done(true), onE=done(false);
    mv.addEventListener('load',onL); mv.addEventListener('error',onE);
  });
}

/* ── BUILD THE MERGED SCENE ── */
async function launchMultiAR(){
  const chosen=[...multiSelected];
  if(chosen.length<2){toast('⚠️ اختر حجرين على الأقل','err');return}
  closeMultiPanel();
  arInfoCard.classList.remove('show'); quizCard.classList.remove('show');

  mergeIcons.innerHTML=chosen.map((id,i)=>
    (i>0?'<span class="plus">+</span>':'')+gemIcon(gemById(id))).join('');
  mergeSub.textContent='جارٍ دمج النماذج…';
  mergeActions.hidden=true;
  mergeOverlay.classList.add('show');

  try{
    const {url,layout}=await buildMergedGLB(chosen);
    mode='merged'; mergedIds=layout.map(l=>l.id); mergedIdx=0;

    const namesAR=mergedIds.map(id=>gemById(id).nameAR).join(' • ');
    setFloatLabel(`${mergedIds.length}× GEMS`,namesAR,'#D4AF37');
    hudLabel.textContent=`${mergedIds.length} أحجار مدموجة`;
    document.querySelectorAll('.gem-chip').forEach(c=>{c.classList.remove('active');c.setAttribute('aria-pressed','false')});

    const em=$('c-emoji');
    em.textContent='✦'; em.style.background='rgba(212,175,55,0.14)'; em.style.boxShadow='0 0 18px rgba(212,175,55,0.30)';
    $('c-en').textContent='MULTI SCENE';
    $('c-ar').textContent=namesAR;
    $('c-desc').textContent='مشهد مدموج — اضغط أيقونة أي حجر لعرض تفاصيله، أو استخدم أزرار التنقل داخل AR.';
    ['c-stats','c-similar','c-badges','c-actions'].forEach(id=>$(id).hidden=true);

    setLoading('تجهيز المشهد المدموج…',40);
    mergeSub.textContent='✓ تم الدمج — جارٍ التحميل…';
    mv.setAttribute('ar-modes',AR_MODES_MERGED);
    const loaded=waitForLoad();
    mv.src=url;
    setHotspotsForMode(layout);
    await loaded;
    // face the row head-on so every gem and its tag is readable
    mv.autoRotate=false;
    mv.cameraOrbit='0deg 72deg auto';
    mv.resetTurntableRotation(0);   // auto-rotate spins the model, not the camera
    mv.jumpCameraToGoal();

    // Browsers only start an AR session from a direct tap, and that permission
    // has expired by now — so ask the user to tap once more.
    if(mv.canActivateAR){
      mergeSub.textContent=`✓ ${mergedIds.length} أحجار جاهزة`;
      mergeActions.hidden=false;
      mergeStart.focus();
    } else {
      mergeOverlay.classList.remove('show');
      toast(`✦ ${mergedIds.length} أحجار في مشهد واحد (عرض ثلاثي الأبعاد)`,'ok');
    }
  }catch(err){
    console.error(err);
    mergeOverlay.classList.remove('show');
    toast('⚠️ فشل دمج النماذج','err');
  }
}
mergeStart.addEventListener('click',()=>{ mergeOverlay.classList.remove('show'); mv.activateAR(); });
$('merge-view').addEventListener('click',()=>mergeOverlay.classList.remove('show'));

/* ── TOGGLE INFO ── */
function toggleInfo(){
  const p=$('info-panel'); p.classList.toggle('collapsed');
  $('info-toggle').setAttribute('aria-expanded',String(!p.classList.contains('collapsed')));
}

/* ── TOAST ── */
function toast(msg,type=''){
  const el=document.createElement('div');
  el.className='toast'+(type?' '+type:'');
  el.setAttribute('role','status');
  el.textContent=msg;
  $('toast-wrap').appendChild(el);
  setTimeout(()=>el.remove(),2900);
}

/* ── INIT ── */
$('quiz-btn').addEventListener('click',openQuiz);
$('multi-btn').addEventListener('click',openMultiPanel);
$('ar-btn').addEventListener('click',enterAR);
$('mp-cancel').addEventListener('click',closeMultiPanel);
$('mp-launch-btn').addEventListener('click',launchMultiAR);
$('info-toggle').addEventListener('click',toggleInfo);
$('info-toggle').addEventListener('keydown',(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleInfo()}});

$('gem-count').textContent=`${GEMS.length} حجر`;
buildMenu();
buildMultiGrid();
initIdentify({showGem:(i)=>{ if(!inCat(GEMS[i])) setCategory('all',{jump:false}); selectGem(i); }});
initCompare({
  showGem:(i)=>{ if(!inCat(GEMS[i])) setCategory('all',{jump:false}); selectGem(i); },
  mergeTwo:(ids)=>{ multiSelected.clear(); ids.forEach(id=>multiSelected.add(id)); refreshMultiChips(); launchMultiAR(); },
});
applyMenuFilter();
{ // open the gem named in the link, e.g. index.html#emerald
  const start=GEMS.findIndex(g=>g.id===decodeURIComponent(location.hash.slice(1)));
  if(start>=0) showGemById(GEMS[start].id); else selectGem(0);
}
