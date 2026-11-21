// Renders the Zen flame loop (src/assets/flames/flame-loop.webm) as numbered PPM frames: the fractal flame of
// flame-192.webp (seed 192) with its first transform's linear part rotated once around over the loop, so the
// last frame meets the first. Plain Node, no dependencies.
//
// Reproduce the clip (1280 x 360, 3600 frames = 150 s at 24 fps, 6e6 points per frame, supersample 2):
//   node wall/scripts/flame-loop.mjs 192 3600 1280 360 6e6 /tmp/flame-frames
//   for f in /tmp/flame-frames/f*.ppm; do magick "$f" -blur 0x0.7 -quality 94 "${f%.ppm}.jpg"; done
//   cat /tmp/flame-frames/f*.jpg | ffmpeg -f image2pipe -framerate 24 -c:v mjpeg -i - \
//     -c:v libvpx-vp9 -b:v 550k -maxrate 900k -crf 45 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p -an \
//     wall/src/assets/flames/flame-loop.webm
// (each frame gets a Gaussian blur of radius 0.7 and is saved as JPEG quality 94 before the VP9 encode.)
// Arguments: seed frames width height points outDir [fromFrame [toFrame]]; the last two split a render across processes.
import { writeFileSync, mkdirSync } from 'node:fs';

// ---- flame core ----
function rng(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let ox=0,oy=0;
const VAR=[
 (x,y)=>{ox=x;oy=y},
 (x,y)=>{ox=Math.sin(x);oy=Math.sin(y)},
 (x,y)=>{const r=x*x+y*y+1e-9;ox=x/r;oy=y/r},
 (x,y)=>{const r=x*x+y*y,s=Math.sin(r),c=Math.cos(r);ox=x*s-y*c;oy=x*c+y*s},
 (x,y)=>{const r=Math.sqrt(x*x+y*y)+1e-9;ox=(x-y)*(x+y)/r;oy=2*x*y/r},
 (x,y)=>{const r=Math.sqrt(x*x+y*y),t=Math.atan2(x,y);ox=t/Math.PI;oy=r-1},
 (x,y)=>{const r=Math.sqrt(x*x+y*y),t=Math.atan2(x,y);ox=r*Math.sin(t+r);oy=r*Math.cos(t-r)},
 (x,y)=>{const r=Math.sqrt(x*x+y*y),t=Math.atan2(x,y);ox=r*Math.sin(t*r);oy=-r*Math.cos(t*r)},
 (x,y)=>{const r=Math.sqrt(x*x+y*y),t=Math.atan2(x,y)/Math.PI;ox=t*Math.sin(Math.PI*r);oy=t*Math.cos(Math.PI*r)},
 (x,y)=>{const r=Math.sqrt(x*x+y*y)+1e-9,t=Math.atan2(x,y);ox=(Math.cos(t)+Math.sin(r))/r;oy=(Math.sin(t)-Math.cos(r))/r},
 (x,y)=>{const r=Math.sqrt(x*x+y*y)+1e-9,t=Math.atan2(x,y);ox=Math.sin(t)/r;oy=r*Math.cos(t)},
 (x,y)=>{const r=Math.sqrt(x*x+y*y),t=Math.atan2(x,y);ox=Math.sin(t)*Math.cos(r);oy=Math.cos(t)*Math.sin(r)},
 (x,y,R)=>{const r=Math.sqrt(Math.sqrt(x*x+y*y)),t=Math.atan2(x,y)/2+(R()<.5?0:Math.PI);ox=r*Math.cos(t);oy=r*Math.sin(t)},
 (x,y)=>{const r=2/(Math.sqrt(x*x+y*y)+1);ox=r*y;oy=r*x},
 (x,y)=>{const r=4/(x*x+y*y+4);ox=r*x;oy=r*y},
 (x,y)=>{ox=Math.sin(x);oy=y},
 (x,y)=>{const r=2/(Math.sqrt(x*x+y*y)+1);ox=r*x;oy=r*y},
 (x,y)=>{const e=Math.exp(Math.min(x-1,6));ox=e*Math.cos(Math.PI*y);oy=e*Math.sin(Math.PI*y)},
 (x,y)=>{const r=Math.sqrt(x*x+y*y)+1e-9,t=Math.atan2(x,y),p=Math.pow(r,Math.sin(t));ox=p*Math.cos(t);oy=p*Math.sin(t)},
 (x,y)=>{const yy=Math.max(-5,Math.min(5,y));ox=Math.cos(Math.PI*x)*Math.cosh(yy);oy=-Math.sin(Math.PI*x)*Math.sinh(yy)},
];
const PALS=[
 [[0,[20,0,60]],[.18,[90,20,160]],[.38,[255,45,150]],[.58,[255,120,80]],[.78,[255,210,110]],[1,[60,225,235]]],
 [[0,[10,10,70]],[.2,[30,90,220]],[.42,[45,226,230]],[.62,[150,110,255]],[.82,[255,60,170]],[1,[255,200,120]]],
 [[0,[60,0,90]],[.25,[200,30,160]],[.5,[255,150,60]],[.7,[250,240,150]],[.85,[80,220,200]],[1,[120,90,255]]],
];
function pal(p,c,out){const P=PALS[p];let i=1;while(i<P.length-1&&c>P[i][0])i++;const a=P[i-1],b=P[i],t=Math.max(0,Math.min(1,(c-a[0])/(b[0]-a[0])));out[0]=a[1][0]+(b[1][0]-a[1][0])*t;out[1]=a[1][1]+(b[1][1]-a[1][1])*t;out[2]=a[1][2]+(b[1][2]-a[1][2])*t}
function genome(seed){const R=rng(seed);const K=2+Math.floor(R()*3);const xs=[];let tw=0;
 for(let i=0;i<K;i++){const ang=R()*6.283,ang2=ang+(R()-.5)*1.2,sx=.35+R()*.65,sy=.35+R()*.65;
  const a=Math.cos(ang)*sx,b=-Math.sin(ang2)*sy,d=Math.sin(ang)*sx,e=Math.cos(ang2)*sy,c=(R()-.5)*2.2,f=(R()-.5)*1.4;
  const nv=1+Math.floor(R()*2.2);const vs=[];for(let j=0;j<nv;j++)vs.push([Math.floor(R()*VAR.length),.4+R()*.8]);
  if(R()<.5)vs.push([0,.2+R()*.5]);
  const w=.3+R();tw+=w;xs.push({a,b,c,d,e,f,vs,w,col:R()})}
 let acc=0;xs.forEach(t=>{acc+=t.w/tw;t.cum=acc});
 return{xs,sym:[1,1,2,2,3,-1,-1,-1][Math.floor(R()*8)],pal:Math.floor(R()*3),stretch:[1,1.5,2.1][Math.floor(R()*3)],seed}}
function step(g,st,R){const r=R();let t=g.xs[g.xs.length-1];for(const q of g.xs){if(r<=q.cum){t=q;break}}
 const px=t.a*st.x+t.b*st.y+t.c,py=t.d*st.x+t.e*st.y+t.f;let nx=0,ny=0;for(const v of t.vs){VAR[v[0]](px,py,R);nx+=v[1]*ox;ny+=v[1]*oy}
 st.x=nx;st.y=ny;st.c=(st.c+t.col)/2;
 if(!isFinite(nx)||!isFinite(ny)||Math.abs(nx)>1e5||Math.abs(ny)>1e5){st.x=R()*2-1;st.y=R()*2-1;return false}return true}
function sym(g,st,R,o){let x=st.x,y=st.y;if(g.sym>1){const k=Math.floor(R()*g.sym),a=k*6.283185/g.sym,cs=Math.cos(a),sn=Math.sin(a);const tx=x*cs-y*sn;y=x*sn+y*cs;x=tx}else if(g.sym<0&&R()<.5){x=-x}o[0]=x*g.stretch;o[1]=y}
function camera(g,W,H){const R=rng(g.seed*13+5),st={x:R()*2-1,y:R()*2-1,c:R()},o=[0,0],X=[],Y=[];
 for(let i=-30;i<30000;i++){if(!step(g,st,R)||i<0)continue;sym(g,st,R,o);X.push(o[0]);Y.push(o[1])}
 if(X.length<20000)return null;X.sort((a,b)=>a-b);Y.sort((a,b)=>a-b);const n=X.length,q=p=>Math.floor(n*p);
 const x0=X[q(.03)],x1=X[q(.97)],y0=Y[q(.03)],y1=Y[q(.97)],w=x1-x0,h=y1-y0;if(!(w>1e-3&&h>1e-3))return null;
 const sxf=W/(w*1.04),syf=H/(h*1.04),scale=Math.max(syf*.8,Math.min(sxf,syf*2.6));
 return{cx:(g.sym!==1&&g.sym!==undefined&&g.sym!==1?0:(x0+x1)/2)*(g.sym===1?1:0)+(g.sym===1?0:0)+(g.sym===1?0:0),cy:(y0+y1)/2,scale,x0,x1}}

// ---- frame loop ----
const [,, seed, frames, W, H, N, outDir, from = "0", to] = process.argv;
const w = +W, h = +H, ss = 2, SW = w * ss, SH = h * ss, F = +frames;
mkdirSync(outDir, { recursive: true });
const base = genome(+seed);
const cam = camera(base, SW, SH); cam.cx = base.sym === 1 ? (cam.x0 + cam.x1) / 2 : 0;
const orig = base.xs.map((t) => ({ a: t.a, b: t.b, d: t.d, e: t.e }));
for (let fi = +from; fi < (to === undefined ? F : +to); fi++) {
  const th = (2 * Math.PI * fi) / F;
  // Electric Sheep style loop: rotate the first transform's linear part once around.
  const cs = Math.cos(th), sn = Math.sin(th), o0 = orig[0], t0 = base.xs[0];
  t0.a = cs * o0.a - sn * o0.d; t0.b = cs * o0.b - sn * o0.e; t0.d = sn * o0.a + cs * o0.d; t0.e = sn * o0.b + cs * o0.e;
  const R = rng(+seed * 7 + 1), st = { x: R() * 2 - 1, y: R() * 2 - 1, c: R() }, o = [0, 0];
  const hh = new Float32Array(SW * SH), cc = new Float32Array(SW * SH);
  for (let i = -30; i < +N; i++) { if (!step(base, st, R) || i < 0) continue; sym(base, st, R, o);
    const ix = Math.floor((o[0] - cam.cx) * cam.scale + SW / 2), iy = Math.floor((o[1] - cam.cy) * cam.scale + SH / 2);
    if (ix >= 0 && ix < SW && iy >= 0 && iy < SH) { const k = iy * SW + ix; hh[k]++; cc[k] += st.c; } }
  const s = Array.from(hh).filter((x) => x > 0).sort((a, b) => a - b); const mx = s.length ? s[Math.floor(s.length * 0.9995)] : 1, lm = Math.log(1 + mx), c3 = [0, 0, 0];
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let r_ = 0, g_ = 0, b_ = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) { const k = (y * ss + j) * SW + x * ss + i, n = hh[k];
      if (n > 0) { const a = Math.pow(Math.min(1, Math.log(1 + n) / lm), 1 / 2.4) * 1.05; pal(base.pal, cc[k] / n, c3); r_ += c3[0] * a; g_ += c3[1] * a; b_ += c3[2] * a; } }
    const q = (y * w + x) * 3; buf[q] = Math.min(255, r_ / 4); buf[q + 1] = Math.min(255, g_ / 4); buf[q + 2] = Math.min(255, b_ / 4); }
  writeFileSync(`${outDir}/f${String(fi).padStart(4, '0')}.ppm`, Buffer.concat([Buffer.from(`P6 ${w} ${h} 255\n`), buf]));
}
console.log('done', seed);
