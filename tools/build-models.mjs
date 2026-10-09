/* ════════════════════════════════════════════════════════════
   يولّد نماذج الأحجار ثلاثية الأبعاد (models/*.glb) برمجياً.

   التشغيل (من مجلد tools):
     npm install
     npm run build-models            → يولّد كل النماذج الناقصة
     npm run build-models -- garnet  → يعيد توليد نموذج بعينه
     npm run build-models -- --all   → يعيد توليد كل النماذج المولّدة

   النماذج الأصلية المصممة يدوياً لا يمسّها هذا السكربت.
   ════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');
const SIZE = 0.25;   // longest side in metres — matches the hand-made models

/* GLTFExporter needs FileReader, which Node lacks */
globalThis.FileReader ??= class {
  readAsArrayBuffer(b){ b.arrayBuffer().then(r=>{ this.result=r; this.onloadend?.(); }); }
  readAsDataURL(b){ b.arrayBuffer().then(r=>{ this.result='data:application/octet-stream;base64,'+Buffer.from(r).toString('base64'); this.onloadend?.(); }); }
};

/* ─────────────── outlines (girdle shape seen from above) ─────────────── */
const circle = (n=16, a=1, b=1) => Array.from({length:n},(_,i)=>{const t=i/n*Math.PI*2; return [a*Math.cos(t), b*Math.sin(t)];});
const superellipse = (n, p, a=1, b=1) => Array.from({length:n},(_,i)=>{
  const t=i/n*Math.PI*2, c=Math.cos(t), s=Math.sin(t);
  return [a*Math.sign(c)*Math.abs(c)**(2/p), b*Math.sign(s)*Math.abs(s)**(2/p)];
});
const pear = (n=18) => Array.from({length:n},(_,i)=>{const t=i/n*Math.PI*2; return [Math.cos(t), 0.72*Math.sin(t)*Math.abs(Math.sin(t/2))**1.1];});
const marquise = (n=16) => Array.from({length:n},(_,i)=>{const t=i/n*Math.PI*2; return [Math.cos(t), 0.5*Math.sin(t)*Math.abs(Math.sin(t))**0.35];});
/** rectangle w×h with corners cut by c (an octagon); c=0 → plain rectangle */
/** rounded triangle (trillion cut) */
const trillion = (n=18) => Array.from({length:n},(_,i)=>{
  const t=i/n*Math.PI*2, phi=((t%(2*Math.PI/3))+2*Math.PI/3)%(2*Math.PI/3)-Math.PI/3;
  const r=0.82*(0.5/Math.cos(phi))+0.18*0.7; return [r*Math.cos(t), r*Math.sin(t)];
});
const octRect = (w, h, c) => c>0
  ? [[w,-h+c],[w,h-c],[w-c,h],[-w+c,h],[-w,h-c],[-w,-h+c],[-w+c,-h],[w-c,-h]]
  : [[w,-h],[w,h],[-w,h],[-w,-h]];

/* ─────────────── ring-based solids ───────────────
   A solid is a stack of rings; every ring is the outline scaled by s at height y.
   half:true places the ring's vertices at edge midpoints, so neighbouring rings
   join with triangles (kite / star facets) instead of quads.                    */
function ringSolid(outline, rings, {flat=true}={}){
  const n=outline.length, pos=[];
  const ringPts = r => outline.map((p,i)=>{
    let [x,z]=p;
    if(r.half){ const q=outline[(i+1)%n]; x=(x+q[0])/2; z=(z+q[1])/2; }
    return new THREE.Vector3(x*r.s*(r.sx??1), r.y, z*r.s);
  });
  const P = rings.map(ringPts);
  const tri=(a,b,c)=>pos.push(a,b,c);
  for(let k=0;k<rings.length-1;k++){
    const A=P[k], B=P[k+1], ha=!!rings[k].half, hb=!!rings[k+1].half;
    for(let i=0;i<n;i++){
      const j=(i+1)%n;
      if(ha===hb){ tri(A[i],A[j],B[j]); tri(A[i],B[j],B[i]); }
      else if(hb){ tri(A[i],A[j],B[i]); tri(B[i],A[j],B[j]); }      // B[i] sits between A[i] and A[j]
      else       { tri(B[i],B[j],A[i]); tri(A[i],B[j],A[j]); }        // A[i] sits between B[i] and B[j]
    }
  }
  const cap=(R,y)=>{ const c=new THREE.Vector3(0,y,0); for(let i=0;i<n;i++) tri(c,R[i],R[(i+1)%n]); };
  if(rings[0].s>0) cap(P[0],rings[0].y);
  if(rings.at(-1).s>0) cap(P.at(-1),rings.at(-1).y);
  return orientedGeometry(pos,flat);
}

/** Build a geometry from triangles, dropping degenerate ones and flipping
    any whose normal points inward (all our solids are star-shaped). */
function orientedGeometry(pts,flat){
  let ymin=Infinity,ymax=-Infinity; for(const p of pts){ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y);}
  const ref=new THREE.Vector3(0,(ymin+ymax)/2,0), out=[];
  const e1=new THREE.Vector3(),e2=new THREE.Vector3(),nrm=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<pts.length;i+=3){
    const [a,b,d]=[pts[i],pts[i+1],pts[i+2]];
    nrm.crossVectors(e1.subVectors(b,a),e2.subVectors(d,a));
    if(nrm.lengthSq()<1e-12) continue;
    c.copy(a).add(b).add(d).divideScalar(3).sub(ref);
    if(nrm.dot(c)<0) out.push(a,d,b); else out.push(a,b,d);
  }
  let g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(out.flatMap(v=>[v.x,v.y,v.z]),3));
  if(!flat) g=mergeVertices(g);
  g.computeVertexNormals();
  return g;
}

/* ─────────────── cuts ─────────────── */
const BRILLIANT=[ {s:0.56,y:0.3}, {s:1,y:0,half:true}, {s:1,y:-0.05,half:true}, {s:0.5,y:-0.45}, {s:0,y:-0.8} ];
const STEP=[ {s:0.62,y:0.22}, {s:0.84,y:0.13}, {s:1,y:0}, {s:1,y:-0.05}, {s:0.74,y:-0.34}, {s:0.42,y:-0.6}, {s:0.12,y:-0.74} ];
const CUTS = {
  round:    () => ringSolid(circle(16), BRILLIANT),
  oval:     () => ringSolid(circle(16,1,0.74), BRILLIANT),
  cushion:  () => ringSolid(superellipse(16,3.2,1,0.9), BRILLIANT),
  pear:     () => ringSolid(pear(18), BRILLIANT),
  marquise: () => ringSolid(marquise(16), BRILLIANT),
  radiant:  () => ringSolid(octRect(1,0.78,0.2), BRILLIANT),
  emerald:  () => ringSolid(octRect(1,0.7,0.18), STEP),
  asscher:  () => ringSolid(octRect(1,1,0.3), STEP),
  baguette: () => ringSolid(octRect(1,0.4,0.06), STEP),
  tablet:   () => ringSolid(octRect(1,0.7,0.12), [{s:0.86,y:0.08},{s:1,y:0},{s:1,y:-0.1},{s:0.9,y:-0.14}]),
  /* hexagonal quartz point */
  crystal:  () => ringSolid(circle(6), [{s:0,y:1.05},{s:1,y:0.45},{s:1,y:-0.95},{s:0.94,y:-1}]),
  octa:     () => { const g=new THREE.OctahedronGeometry(1,0); g.scale(1,1.15,1); return g; },
  /* trapezoidal bullion bar */
  ingot:    () => ringSolid(octRect(1,0.48,0.04), [{s:0.8,y:0.24},{s:1,y:-0.24}]),
  cab:      (a=1,b=0.76,h=0.55) => cabochon(a,b,h),
  roundcab: () => cabochon(1,1,0.5),
  tumble:   (sx=1,sy=0.62,sz=0.8,seed=1) => pebble(sx,sy,sz,seed),
  drop:     () => pebble(1,0.7,0.78,7,true),
  rough:    (seed=3) => shard(seed),
  trillion: () => ringSolid(trillion(18), BRILLIANT),
  /* hexagonal prism with flat ends (beryl, selenite wand) */
  prism:    (len=1.6) => ringSolid(circle(6), [{s:1,y:len/2},{s:1,y:-len/2}]),
  /* flat bladed crystal (kyanite) */
  blade:    () => ringSolid(octRect(1,0.24,0.08), [{s:0.94,y:0.07},{s:1,y:0.04},{s:1,y:-0.04},{s:0.94,y:-0.07}]),
  /* wedge-tipped prism (danburite) */
  wedge:    () => { const g=ringSolid(octRect(0.55,0.4,0.12), [{s:0.25,y:1},{s:1,y:0.5},{s:1,y:-0.9},{s:0.96,y:-0.95}]); return g; },
  /* flat slice with a finely subdivided face, so ring/spiral patterns show */
  disc:     (h=0.32) => {
    const top=new THREE.RingGeometry(0.0001,1,72,32); top.rotateX(-Math.PI/2); top.translate(0,h/2,0);
    const bot=new THREE.RingGeometry(0.0001,1,72,32); bot.rotateX(Math.PI/2);  bot.translate(0,-h/2,0);
    const side=new THREE.CylinderGeometry(1,1,h,72,1,true);
    const parts=[top,bot,side]; parts.forEach(g=>g.deleteAttribute('uv'));
    return mergeGeometries(parts);
  },
};

function cabochon(a,b,h,seg=64,rings=24){
  const pos=[],idx=[];
  for(let k=0;k<=rings;k++){
    const phi=k/rings*Math.PI/2, s=Math.cos(phi), y=h*Math.sin(phi);
    if(k===rings){ pos.push(0,y,0); break; }
    for(let i=0;i<seg;i++){const t=i/seg*Math.PI*2; pos.push(a*s*Math.cos(t),y,b*s*Math.sin(t));}
  }
  const top=rings*seg;
  for(let k=0;k<rings;k++) for(let i=0;i<seg;i++){
    const j=(i+1)%seg, a0=k*seg+i, a1=k*seg+j;
    if(k===rings-1){ idx.push(a0,top,a1); continue; }
    const b0=(k+1)*seg+i, b1=(k+1)*seg+j; idx.push(a0,b0,a1, a1,b0,b1);
  }
  const dome=new THREE.BufferGeometry();
  dome.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); dome.setIndex(idx); dome.computeVertexNormals();
  const base=new THREE.CircleGeometry(1,seg); base.rotateX(Math.PI/2); base.scale(a,1,b);
  base.deleteAttribute('uv');
  return mergeGeometries([dome,base]);
}

/** smooth irregular pebble (tumbled stone / nugget) */
function pebble(sx,sy,sz,seed,drop=false){
  let g=new THREE.IcosahedronGeometry(1,4); g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g=mergeVertices(g);
  const p=g.attributes.position, v=new THREE.Vector3();
  for(let i=0;i<p.count;i++){
    v.fromBufferAttribute(p,i);
    const n=1+0.07*Math.sin(3.1*v.x+seed)*Math.sin(2.3*v.y+2*seed)+0.05*Math.sin(4.7*v.z+seed*1.7)*Math.cos(3.3*v.x);
    v.multiplyScalar(n);
    if(drop) v.x*=1+0.25*Math.max(0,-v.x)*(1-Math.abs(v.y));   // taper one end
    p.setXYZ(i,v.x*sx,v.y*sy,v.z*sz);
  }
  g.computeVertexNormals();
  return g;
}

/** sharp-edged rough fragment (obsidian, moldavite) */
function shard(seed){
  let g=new THREE.IcosahedronGeometry(1,1); g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g=mergeVertices(g);
  const p=g.attributes.position; let s=seed;
  const rnd=()=>{ s=(s*16807)%2147483647; return s/2147483647; };
  for(let i=0;i<p.count;i++) p.setXYZ(i,p.getX(i)*(0.75+rnd()*0.5)*1.3,p.getY(i)*(0.55+rnd()*0.35),p.getZ(i)*(0.75+rnd()*0.5));
  g=g.toNonIndexed(); g.computeVertexNormals();
  return g;
}

/** several quartz points growing from one base */
function cluster(){
  const parts=[[0,0,0,1],[0.55,-0.15,0.5,0.7],[-0.5,-0.2,0.3,0.62],[0.1,-0.3,-0.55,0.55]].map(([rz,_,rx,sc],i)=>{
    const g=CUTS.crystal(); g.scale(0.42*sc,sc,0.42*sc); g.translate(0,sc,0);
    g.rotateZ(rz); g.rotateX(rx); return g;
  });
  return mergeGeometries(parts);
}

/** two interpenetrating cubes — how pyrite usually grows */
/** stepped "hopper" crystal — nested square frames (bismuth) */
function hopper(){
  const parts=[];
  for(let k=0;k<6;k++){
    const s=1-k*0.16, w=0.13, y=-k*0.11;
    for(const [x,z,sx,sz] of [[0,s/2-w/2,s,w],[0,-s/2+w/2,s,w],[s/2-w/2,0,w,s],[-s/2+w/2,0,w,s]]){
      const b=new THREE.BoxGeometry(sx,0.12,sz); b.deleteAttribute('uv'); b.translate(x,y,z); parts.push(b);
    }
  }
  const base=new THREE.BoxGeometry(0.2,0.12,0.2); base.deleteAttribute('uv'); base.translate(0,-0.66,0); parts.push(base);
  return mergeGeometries(parts);
}

function galenaCubes(){
  const mk=(s,x,y,z,ry)=>{const b=new THREE.BoxGeometry(s,s,s); b.deleteAttribute('uv'); b.rotateY(ry); b.translate(x,y,z); return b.toNonIndexed();};
  return mergeGeometries([mk(1,0,0,0,0.2),mk(0.62,0.62,-0.19,0.25,0.6),mk(0.45,-0.55,-0.27,-0.3,-0.3)]);
}

function pyriteCubes(){
  const a=new THREE.BoxGeometry(1,1,1), b=new THREE.BoxGeometry(0.7,0.7,0.7);
  b.rotateY(0.5); b.rotateX(0.3); b.translate(0.42,0.18,0.3);
  [a,b].forEach(g=>g.deleteAttribute('uv'));
  return mergeGeometries([a.toNonIndexed(),b.toNonIndexed()]);
}

/** branching coral made of capsules */
function coralBranch(){
  const seg=(x,y,z,len,r,rx,rz)=>{const g=new THREE.CapsuleGeometry(r,len,6,12); g.deleteAttribute('uv');
    g.translate(0,len/2,0); g.rotateX(rx); g.rotateZ(rz); g.translate(x,y,z); return g;};
  return mergeGeometries([
    seg(0,0,0,1.1,0.12,0,0),
    seg(0,0.35,0,0.7,0.09,0.2,0.7), seg(0,0.5,0,0.65,0.085,-0.25,-0.65),
    seg(-0.38,0.75,0.12,0.4,0.065,0.3,-0.2), seg(0.36,0.85,-0.1,0.35,0.06,-0.2,0.35),
    seg(0,1.0,0,0.45,0.075,0.5,0.1), seg(0,1.1,0,0.35,0.065,-0.4,-0.3),
  ]);
}

/* ─────────────── surface patterns (vertex colours) ─────────────── */
const C=(hex)=>new THREE.Color(hex);
const hash=(x,y,z)=>{const h=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453; return h-Math.floor(h);};
const PATTERNS = {
  /* concentric bands around an off-centre point */
  rings:   ([c1,c2],f=22,cx=0.35,cz=0.2)=>(p)=>{const d=Math.hypot(p.x-cx,p.z-cz)+0.04*Math.sin(9*Math.atan2(p.z-cz,p.x-cx)); return mix(c1,c2,smooth(Math.sin(d*f)));},
  stripes: ([c1,c2,c3],f=14)=>(p)=>{const t=Math.sin(p.x*f+Math.sin(p.z*3.5)*1.6); return t>0.55?c3:mix(c1,c2,smooth(t));},
  zigzag:  ([c1,c2],f=18)=>(p)=>mix(c1,c2,smooth(Math.sin((p.z+0.12*Math.abs(Math.sin(p.x*7)))*f))),
  flecks:  ([c1,c2],amt=0.06)=>(p)=>hash(Math.round(p.x*40),Math.round(p.y*40),Math.round(p.z*40))<amt?c2:c1,
  mottled: ([c1,c2,c3])=>(p)=>{const n=Math.sin(p.x*7+Math.sin(p.z*5))*Math.sin(p.z*6+p.y*4)+0.4*Math.sin(p.y*11+p.x*3); return n>0.55?c3:mix(c1,c2,(n+1)/2);},
  web:     ([c1,c2])=>(p)=>{const t=Math.abs(Math.sin(p.x*8+Math.sin(p.z*5)*2)*Math.sin(p.z*7+Math.sin(p.x*4)*2)); return mix(c2,c1,Math.min(1,t*2.2));},
  streaks: ([c1,c2],f=30)=>(p)=>{const t=Math.sin(p.x*f*0.3+p.z*f+Math.sin(p.x*3)*2); return t>0.85?c2:c1;},
  /* cat's eye: one bright line across the dome */
  eye:     ([c1,c2])=>(p)=>mix(c1,c2,Math.exp(-(((p.z)/0.08)**2))*Math.max(0,p.y+0.2)),
  /* two colours meeting in the middle (ametrine) */
  bicolor: ([c1,c2])=>(p)=>mix(c1,c2,1/(1+Math.exp(-p.x*9))),
  /* tree rings + bark rim (petrified wood) */
  tree:    ([c1,c2,bark])=>(p)=>{const r=Math.hypot(p.x,p.z); if(r>0.9) return bark; return mix(c1,c2,smooth(Math.sin(r*34+Math.sin(Math.atan2(p.z,p.x)*5)*0.4)));},
  /* ammonite spiral chambers */
  spiral:  ([c1,c2,c3])=>(p)=>{const r=Math.hypot(p.x,p.z)+1e-3, a=Math.atan2(p.z,p.x); const t=Math.sin(Math.log(r)*9-a*1.43); const u=Math.sin(a*14); return t>0.3?mix(c2,c3,(u+1)/2):mix(c1,c2,(t+1)/1.3);},
  /* Widmanstätten pattern: three families of lines at 60° */
  widman:  ([c1,c2])=>(p)=>{const d=[0,Math.PI/3,2*Math.PI/3].map(a=>Math.abs(Math.sin((p.x*Math.cos(a)+p.z*Math.sin(a))*22))); return Math.min(...d)<0.18?c2:c1;},
};
const smooth=t=>{const u=(t+1)/2; return u*u*(3-2*u);};
const mix=(a,b,t)=>a.clone().lerp(b,t);

function paint(geo,fn){
  geo.computeBoundingBox(); const bb=geo.boundingBox, c=bb.getCenter(new THREE.Vector3()), s=bb.getSize(new THREE.Vector3());
  const k=2/Math.max(s.x,s.y,s.z), p=geo.attributes.position, col=[], v=new THREE.Vector3();
  for(let i=0;i<p.count;i++){ v.fromBufferAttribute(p,i).sub(c).multiplyScalar(k); const cc=fn(v); col.push(cc.r,cc.g,cc.b); }
  geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
}

/* ─────────────── materials ─────────────── */
function clear(hex,ior,{transmission=1,roughness=0,dist=0.15,thickness=0.08}={}){
  const tint=C(hex);
  return new THREE.MeshPhysicalMaterial({
    color:tint.clone().lerp(C('#ffffff'),0.35), metalness:0, roughness, transmission, ior, thickness,
    attenuationColor:tint, attenuationDistance:dist,
  });
}
const polished=(hex,o={})=>new THREE.MeshPhysicalMaterial({color:C(hex),metalness:0,roughness:0.22,clearcoat:1,clearcoatRoughness:0.08,...o});
const metal=(hex,roughness=0.14)=>new THREE.MeshStandardMaterial({color:C(hex),metalness:1,roughness});

/* ─────────────── the new gems ─────────────── */
const MODELS = {
  alexandrite: ()=>[CUTS.asscher(),  clear('#2E8B6E',1.75,{dist:0.1})],
  aquamarine:  ()=>[CUTS.emerald(),  clear('#7FD4E8',1.57,{dist:0.3})],
  garnet:      ()=>[CUTS.round(),    clear('#9B1B30',1.76,{dist:0.06})],
  peridot:     ()=>[CUTS.pear(),     clear('#9ACD32',1.67)],
  tanzanite:   ()=>[CUTS.radiant(),  clear('#5B4FC8',1.69,{dist:0.08})],
  tourmaline:  ()=>[CUTS.baguette(), clear('#E0457B',1.62)],
  spinel:      ()=>[CUTS.cushion(),  clear('#D81E5B',1.72,{dist:0.08})],
  morganite:   ()=>[CUTS.oval(),     clear('#F4A6B8',1.58,{dist:0.3})],
  zircon:      ()=>[CUTS.round(),    clear('#3FB4E0',1.93)],
  kunzite:     ()=>[CUTS.emerald(),  clear('#E8A0D8',1.66,{dist:0.3})],
  iolite:      ()=>[CUTS.marquise(), clear('#5A6FB8',1.54,{dist:0.08})],
  fluorite:    ()=>[CUTS.octa(),     clear('#9B7FD4',1.43,{dist:0.2})],
  moldavite:   ()=>[CUTS.rough(5),   clear('#5E8C31',1.49,{roughness:0.12,dist:0.1})],

  amethyst:    ()=>[CUTS.oval(),     clear('#9966CC',1.54,{dist:0.1})],
  citrine:     ()=>[CUTS.cushion(),  clear('#E4A010',1.54)],
  rockcrystal: ()=>[CUTS.crystal(),  clear('#E8F4F8',1.54,{dist:1})],
  smokyquartz: ()=>[cluster(),       clear('#7A6250',1.54,{dist:0.1})],
  rosequartz:  ()=>[CUTS.roundcab(), clear('#F7B8C8',1.54,{transmission:0.6,roughness:0.18,dist:0.05})],
  carnelian:   ()=>[CUTS.cab(),      clear('#D0501F',1.54,{transmission:0.45,roughness:0.12,dist:0.06})],
  onyx:        ()=>[CUTS.tablet(),   polished('#16161A',{roughness:0.08})],
  tigerseye:   ()=>{const g=CUTS.cab(); paint(g,PATTERNS.stripes([C('#5A3A12'),C('#C08A2E'),C('#E8C26A')])); return [g,polished('#ffffff',{vertexColors:true,roughness:0.15})];},
  jasper:      ()=>{const g=CUTS.tumble(1,0.62,0.8,2); paint(g,PATTERNS.mottled([C('#7A2418'),C('#B04030'),C('#D9A06A')])); return [g,polished('#ffffff',{vertexColors:true,roughness:0.3})];},
  aventurine:  ()=>{const g=CUTS.tumble(1,0.6,0.82,4); paint(g,PATTERNS.flecks([C('#3E9E5C'),C('#B8F0C8')],0.08)); return [g,polished('#ffffff',{vertexColors:true})];},

  lapis:       ()=>{const g=CUTS.cab(); paint(g,PATTERNS.flecks([C('#1E3A9A'),C('#E8C04A')],0.05)); return [g,polished('#ffffff',{vertexColors:true})];},
  jade:        ()=>[CUTS.cab(1,0.8,0.5), polished('#2E8B57',{roughness:0.18,transmission:0.2,ior:1.66,thickness:0.05})],
  malachite:   ()=>{const g=CUTS.roundcab(); paint(g,PATTERNS.rings([C('#0B4A2A'),C('#2EC27E')])); return [g,polished('#ffffff',{vertexColors:true})];},
  moonstone:   ()=>[CUTS.cab(), Object.assign(clear('#E6EEF8',1.52,{transmission:0.55,roughness:0.12,dist:0.2}),{iridescence:0.6,iridescenceIOR:1.3,iridescenceThicknessRange:[200,400]})],
  sunstone:    ()=>{const g=CUTS.cab(); paint(g,PATTERNS.flecks([C('#E8833A'),C('#FFE2A8')],0.07)); return [g,polished('#ffffff',{vertexColors:true})];},
  labradorite: ()=>[CUTS.cab(1,0.72,0.42), polished('#4A5866',{iridescence:1,iridescenceIOR:1.8,iridescenceThicknessRange:[300,900]})],
  amazonite:   ()=>{const g=CUTS.cab(); paint(g,PATTERNS.streaks([C('#3FB8A8'),C('#DFF7F2')])); return [g,polished('#ffffff',{vertexColors:true})];},
  rhodochrosite:()=>{const g=CUTS.cab(); paint(g,PATTERNS.zigzag([C('#B83A5A'),C('#F6A0B4')])); return [g,polished('#ffffff',{vertexColors:true})];},
  larimar:     ()=>{const g=CUTS.roundcab(); paint(g,PATTERNS.web([C('#5BB8DE'),C('#F2FAFF')])); return [g,polished('#ffffff',{vertexColors:true})];},
  obsidian:    ()=>[CUTS.rough(11), polished('#121216',{roughness:0.04})],

  pearl:       ()=>{const g=new THREE.SphereGeometry(1,64,32); g.deleteAttribute('uv'); return [g,new THREE.MeshPhysicalMaterial({color:C('#F4EFE6'),roughness:0.32,clearcoat:0.8,clearcoatRoughness:0.2,iridescence:0.35,iridescenceIOR:1.4,iridescenceThicknessRange:[250,420]})];},
  amber:       ()=>[CUTS.drop(),     clear('#E8A317',1.54,{roughness:0.1,dist:0.08})],
  coral:       ()=>[coralBranch(),   polished('#E8574A',{roughness:0.35,clearcoat:0.5})],

  platinum:    ()=>[CUTS.ingot(),    metal('#E5E4E2',0.12)],
  copper:      ()=>[CUTS.tumble(1,0.55,0.75,9), metal('#D07A45',0.3)],
  pyrite:      ()=>[pyriteCubes(),   metal('#D4B44A',0.22)],
  hematite:    ()=>[CUTS.tumble(1,0.6,0.8,6), metal('#6A6A74',0.12)],

  /* ── second batch ── */
  padparadscha:()=>[CUTS.cushion(),  clear('#F59B7A',1.77,{dist:0.15})],
  redberyl:    ()=>[CUTS.emerald(),  clear('#C8204A',1.57,{dist:0.06})],
  paraiba:     ()=>[CUTS.oval(),     clear('#2EE0D0',1.62,{dist:0.2})],
  benitoite:   ()=>[CUTS.trillion(), clear('#3A6AE8',1.78,{dist:0.08})],
  taaffeite:   ()=>[CUTS.round(),    clear('#B88AC8',1.72,{dist:0.15})],
  grandidierite:()=>[CUTS.oval(),    clear('#5AC8B0',1.6,{dist:0.1,roughness:0.05})],
  demantoid:   ()=>[CUTS.round(),    clear('#3EB04A',1.88,{dist:0.08})],
  tsavorite:   ()=>[CUTS.oval(),     clear('#2EAA4A',1.74,{dist:0.07})],
  hiddenite:   ()=>[CUTS.emerald(),  clear('#7AC87A',1.66,{dist:0.2})],
  heliodor:    ()=>[CUTS.prism(1.6), clear('#F2D03A',1.57,{dist:0.2})],
  chrysoberyl: ()=>{const g=CUTS.cab(1,0.75,0.6); paint(g,PATTERNS.eye([C('#B8A82A'),C('#FFF6C8')])); return [g,polished('#ffffff',{vertexColors:true,roughness:0.12,transmission:0.25,ior:1.75,thickness:0.05})];},
  andalusite:  ()=>[CUTS.radiant(),  clear('#8A7A3A',1.64,{dist:0.08})],
  titanite:    ()=>[CUTS.pear(),     clear('#B8C83A',1.95,{dist:0.12})],
  kyanite:     ()=>[CUTS.blade(),    clear('#3A6AC8',1.72,{transmission:0.6,roughness:0.08,dist:0.06})],
  apatite:     ()=>[CUTS.oval(),     clear('#2EC8C8',1.64,{dist:0.1})],
  diopside:    ()=>[CUTS.round(),    clear('#1E7A3A',1.68,{dist:0.05})],
  danburite:   ()=>[CUTS.wedge(),    clear('#F2F2E8',1.63,{dist:1})],
  moissanite:  ()=>[CUTS.round(),    clear('#F2F6F4',2.65,{dist:1})],
  imperialtopaz:()=>[CUTS.pear(),    clear('#E88A3A',1.63,{dist:0.12})],
  sphalerite:  ()=>[CUTS.round(),    clear('#C87A1E',2.37,{dist:0.08})],
  fireopal:    ()=>[CUTS.oval(),     clear('#F06A1E',1.45,{dist:0.1})],
  celestite:   ()=>[cluster(),       clear('#A8D0F0',1.62,{dist:0.3})],
  selenite:    ()=>{const g=CUTS.prism(3.2); return [g,clear('#F4F2EA',1.52,{dist:1,roughness:0.12})];},

  chrysoprase: ()=>[CUTS.cab(),      clear('#5ACB7A',1.54,{transmission:0.35,roughness:0.15,dist:0.04})],
  bluechalcedony:()=>[CUTS.roundcab(),clear('#9AB8D8',1.54,{transmission:0.45,roughness:0.15,dist:0.06})],
  bloodstone:  ()=>{const g=CUTS.cab(); paint(g,PATTERNS.flecks([C('#1E3A2A'),C('#C8281E')],0.06)); return [g,polished('#ffffff',{vertexColors:true})];},
  ametrine:    ()=>{const g=CUTS.emerald(); paint(g,PATTERNS.bicolor([C('#B07AC8'),C('#E8C04A')])); const m=clear('#ffffff',1.54,{dist:2}); m.vertexColors=true; m.color.set('#ffffff'); return [g,m];},
  prasiolite:  ()=>[CUTS.oval(),     clear('#A8D88A',1.54,{dist:0.3})],
  rutilatedquartz:()=>{const g=CUTS.roundcab(); paint(g,PATTERNS.streaks([C('#F4F0E4'),C('#C8902A')],38)); const m=clear('#ffffff',1.54,{dist:2,transmission:0.75}); m.vertexColors=true; m.color.set('#ffffff'); return [g,m];},
  sardonyx:    ()=>{const g=CUTS.cab(); paint(g,PATTERNS.stripes([C('#6A2010'),C('#B8502A'),C('#F2ECE4')],11)); return [g,polished('#ffffff',{vertexColors:true})];},
  petrifiedwood:()=>{const g=CUTS.disc(0.3); paint(g,PATTERNS.tree([C('#7A4A2A'),C('#C8905A'),C('#3A2A1E')])); return [g,polished('#ffffff',{vertexColors:true,roughness:0.3})];},

  blackopal:   ()=>[CUTS.cab(1,0.75,0.45), polished('#14142A',{roughness:0.08,iridescence:1,iridescenceIOR:2.0,iridescenceThicknessRange:[200,1000]})],
  prehnite:    ()=>[CUTS.roundcab(), clear('#B8D88A',1.63,{transmission:0.5,roughness:0.15,dist:0.06})],
  chrysocolla: ()=>{const g=CUTS.cab(); paint(g,PATTERNS.web([C('#2EA8B8'),C('#1E6A5A')])); return [g,polished('#ffffff',{vertexColors:true,roughness:0.3})];},
  sodalite:    ()=>{const g=CUTS.cab(); paint(g,PATTERNS.streaks([C('#2A3E8A'),C('#E8ECF2')],24)); return [g,polished('#ffffff',{vertexColors:true})];},
  charoite:    ()=>{const g=CUTS.cab(); paint(g,PATTERNS.stripes([C('#4A1E6A'),C('#9A5AC0'),C('#E0D0F0')],16)); return [g,polished('#ffffff',{vertexColors:true})];},
  sugilite:    ()=>{const g=CUTS.cab(); paint(g,PATTERNS.mottled([C('#3A1A4A'),C('#7A2A8A'),C('#B060C0')])); return [g,polished('#ffffff',{vertexColors:true})];},
  howlite:     ()=>{const g=CUTS.tumble(1,0.62,0.82,12); paint(g,PATTERNS.web([C('#EEEEEA'),C('#6A6A6A')])); return [g,polished('#ffffff',{vertexColors:true,roughness:0.3})];},
  serpentine:  ()=>{const g=CUTS.tumble(1,0.6,0.8,13); paint(g,PATTERNS.mottled([C('#2E4A22'),C('#6A8A4A'),C('#B8C88A')])); return [g,polished('#ffffff',{vertexColors:true})];},
  rhodonite:   ()=>{const g=CUTS.cab(); paint(g,PATTERNS.web([C('#D86A7A'),C('#1E1E1E')])); return [g,polished('#ffffff',{vertexColors:true})];},
  unakite:     ()=>{const g=CUTS.tumble(1,0.6,0.8,14); paint(g,PATTERNS.mottled([C('#4A7A4A'),C('#8AB07A'),C('#E8988A')])); return [g,polished('#ffffff',{vertexColors:true})];},
  smithsonite: ()=>[CUTS.tumble(1,0.55,0.85,15), clear('#8AC8C8',1.62,{transmission:0.35,roughness:0.25,dist:0.05})],
  azurite:     ()=>{const g=CUTS.cab(); paint(g,PATTERNS.rings([C('#0E2470'),C('#2A50C8')],18)); return [g,polished('#ffffff',{vertexColors:true})];},

  jet:         ()=>[CUTS.tumble(1,0.55,0.75,16), polished('#101010',{roughness:0.1})],
  ammolite:    ()=>{const g=CUTS.disc(0.28); paint(g,PATTERNS.spiral([C('#3A2418'),C('#B8502A'),C('#2E9A5A')])); return [g,polished('#ffffff',{vertexColors:true,iridescence:0.45,iridescenceIOR:1.6,iridescenceThicknessRange:[300,800]})];},
  motherofpearl:()=>[CUTS.cab(1,0.8,0.16), polished('#F2EEF0',{roughness:0.25,iridescence:1,iridescenceIOR:1.5,iridescenceThicknessRange:[250,600]})],

  palladium:   ()=>[CUTS.ingot(),    metal('#CED0CE',0.16)],
  meteorite:   ()=>{const g=CUTS.cab(1,0.8,0.14); paint(g,PATTERNS.widman([C('#C8C8D0'),C('#6A6A72')])); return [g,new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,metalness:1,roughness:0.25})];},
  bismuth:     ()=>[hopper(), new THREE.MeshPhysicalMaterial({color:'#D8C8E0',metalness:1,roughness:0.15,iridescence:1,iridescenceIOR:2.2,iridescenceThicknessRange:[200,900]})],
  galena:      ()=>[galenaCubes(),   metal('#8A8A94',0.22)],
};

/* ─────────────── export ─────────────── */
function exportGLB(id){
  const [geo,mat]=MODELS[id]();
  geo.computeBoundingBox();
  const bb=geo.boundingBox, size=bb.getSize(new THREE.Vector3()), c=bb.getCenter(new THREE.Vector3());
  geo.translate(-c.x,-c.y,-c.z);
  geo.scale(...Array(3).fill(SIZE/Math.max(size.x,size.y,size.z)));
  const mesh=new THREE.Mesh(geo,mat); mesh.name=id;
  const scene=new THREE.Scene(); scene.add(mesh);
  return new Promise((res,rej)=>new GLTFExporter().parse(scene,b=>{
    fs.writeFileSync(path.join(OUT,id+'.glb'),Buffer.from(b)); res(b.byteLength);
  },rej,{binary:true}));
}

const wanted=process.argv.slice(2);
const ids=wanted[0]==='--all'?Object.keys(MODELS):wanted.length?wanted:Object.keys(MODELS).filter(id=>!fs.existsSync(path.join(OUT,id+'.glb')));
for(const id of ids){
  if(!MODELS[id]){ console.warn('no generator for',id); continue; }
  console.log(id.padEnd(14),((await exportGLB(id))/1024).toFixed(1)+' KB');
}
