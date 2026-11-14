/* One window from Kirkland on a 2D canvas: a sky that follows the real sun, one mountain
   panorama from elevation data (azimuth 128 to 300: Rainier in the south round to the
   Olympics in the west), Seattle drawn in
   metres, and the lake in front. All sizes are in design pixels; o.scale maps them to
   device pixels so lines stay sharp at any zoom. */

import pano from './terrain/pano.json';

/* Terrain profiles: elevation arrays sampled by compass azimuth, read by prof(). Only the
   panorama ships. */
interface Terrain { az0: number; step: number; eye: number; far: number[]; mid: number[]; near: number[]; peaks: unknown[] }
/** The terrains `draw` can look at: the one panorama. */
export type TerrainName = 'pano';
const TER: Record<string, Terrain> = { pano: pano as Terrain };
/** Test only: make another profile drawable under `name` (the parity test adds the older `west` and `south` views). */
export function registerTerrain(name: string, data: unknown): void { TER[name] = data as Terrain; }
// Local aliases so the hand-tuned helpers below stay in their original compact form.
type Any = any; // the helpers take canvas contexts, colour triples and option bags; typing each would mean rewriting them
type RGB = number[];
const LAT=47.68,LON=-122.21;
const rad=(d:Any)=>d*Math.PI/180,deg=(r:Any)=>r*180/Math.PI,clamp=(v:Any,a:Any,b:Any)=>v<a?a:v>b?b:v,mix=(a:Any,b:Any,t:Any)=>a+(b-a)*t,smooth=(t:Any)=>{t=clamp(t,0,1);return t*t*(3-2*t)},fr=(x:Any)=>x-Math.floor(x);
const hx=(h:string)=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const css=(c:RGB,a?:number)=>a===undefined?`rgb(${c[0]|0},${c[1]|0},${c[2]|0})`:`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a<0?0:a>1?1:+a.toFixed(3)})`;
const mixc=(a:Any,b:Any,t:Any)=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];
function hash(a:number,b:number,c:number=0){let h=(Math.imul(a|0,374761393)+Math.imul(b|0,668265263)+Math.imul(c|0,2147483647))|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296}

/* sun: low-precision almanac formulas, good to a few hundredths of a degree */
function when(y:number,m:number,d:number,h:number,tz?:number){return Date.UTC(y,m-1,d)+(h-(tz===undefined?-8:tz))*3600000}
function sun(ms:number){const d=ms/86400000-10957.5,g=rad((357.529+.98560028*d)%360),q=280.459+.98564736*d,L=rad((q+1.915*Math.sin(g)+.02*Math.sin(2*g))%360),e=rad(23.439-.00000036*d);
 const ra=Math.atan2(Math.cos(e)*Math.sin(L),Math.cos(L)),dec=Math.asin(Math.sin(e)*Math.sin(L));
 const ha=rad((((18.697374558+24.06570982441908*d)*15+LON)%360+360)%360)-ra,p=rad(LAT);
 const alt=Math.asin(Math.sin(p)*Math.sin(dec)+Math.cos(p)*Math.cos(dec)*Math.cos(ha));
 const az=Math.atan2(-Math.sin(ha),Math.tan(dec)*Math.cos(p)-Math.sin(p)*Math.cos(ha));
 return{az:(deg(az)+360)%360,alt:deg(alt)}}

/* palette, keyed by sun altitude. s: sky top to horizon, f: water, cl: cloud top, underside, strength, sn: snow colour, strength */
const K=(alt:Any,s:Any,far:Any,mid:Any,bld:Any,f:Any,grid:Any,rim:Any,star:Any,lights:Any,cl:Any,sn:Any,hz:Any)=>({alt,s:s.map(hx),far:hx(far),mid:hx(mid),bld:hx(bld),f:f.map(hx),grid:hx(grid),rim:rim.map(hx),star,lights,cl:[hx(cl[0]),hx(cl[1]),cl[2]],sn:[hx(sn[0]),sn[1]],hz});
const DAY=K(12,['#070a24','#0d1f4d','#16466e','#2a8fa3'],'#1b4a78','#123560','#0c1c42',['#0b1436','#05051a'],'#35e6ea',['#35e6ea','#9a7bff'],0,0,['#2c6a92','#52adc0',.3],['#dcf0ff',.66],.28);
const NIGHT=K(-16,['#04030f','#0a0726','#160f40','#2a1a66'],'#110c3a','#0b0828','#07051c',['#0c0830','#04031a'],'#9a7bff',['#ff3d9a','#35e6ea'],1,1,['#120e34','#231a52',.36],['#aab4f0',.24],.18);
const KE=[DAY,
 K(6,['#090826','#1b1a5a','#4f3d8c','#e8a57c'],'#3a2e74','#231a55','#120c36',['#150e3a','#06051a'],'#8fd8e8',['#ffc24d','#ff7ab8'],0,.06,['#5a3f8e','#ffb884',.5],['#ffd9c2',.46],.3),
 K(.5,['#0f0628','#3a0f5c','#b3266e','#ff8a4c'],'#3a1463','#260c4a','#140730',['#1a0838','#07041c'],'#ff3d9a',['#ff3d9a','#ffc24d'],0,.4,['#5a1f78','#ff7a59',.6],['#c98ad8',.22],.34),
 K(-4,['#0a0524','#2a0c52','#7a1f6e','#e0507a'],'#2c1058','#1c0a42','#0f062a',['#150730','#06041a'],'#ff3d9a',['#ff3d9a','#9a7bff'],.25,.85,['#3a1560','#d04a7e',.5],['#a88be0',.2],.3),
 K(-9,['#060418','#140a3a','#2c1660','#6a2a7a'],'#1a0f48','#120a34','#0a0622',['#0e0830','#04031a'],'#b06bff',['#ff3d9a','#35e6ea'],.7,1,['#1c1146','#43276e',.42],['#9aa0e8',.2],.22),NIGHT];
const KM=[DAY,
 K(6,['#080a2a','#12205a','#2a5a8c','#74b6c6'],'#1f4a7c','#123058','#0c1c44',['#0c1232','#05051a'],'#55d6e2',['#35e6ea','#ff9ac4'],0,0,['#3a6c98','#ffc9b0',.4],['#ffe3d0',.78],.3),
 K(0,['#0a0a2e','#1c1a56','#5d4a8e','#d892a6'],'#2b3474','#191f56','#0e143c',['#101238','#05051c'],'#8fb8ee',['#ff9ac4','#9a7bff'],.05,.3,['#4a4488','#ff9fb0',.5],['#ffb7b0',.88],.32),
 K(-7,['#06051a','#100c36','#2a1f5e','#5a4a8a'],'#171250','#0f0b36','#0a0724',['#0c0830','#04031a'],'#9a7bff',['#9a7bff','#35e6ea'],.55,.85,['#1a1444','#3a2c6a',.38],['#b0a8f0',.3],.2),NIGHT];
function pal(alt:Any,eve:Any){const T=eve?KE:KM;let i=0;while(i<T.length-2&&alt<T[i+1].alt)i++;const a=T[i],b=T[i+1],t=clamp((a.alt-alt)/(a.alt-b.alt),0,1),m=(x:Any,y:Any)=>mixc(x,y,t);
 return{s:a.s.map((c:Any,j:Any)=>m(c,b.s[j])),far:m(a.far,b.far),mid:m(a.mid,b.mid),bld:m(a.bld,b.bld),f:[m(a.f[0],b.f[0]),m(a.f[1],b.f[1])],grid:m(a.grid,b.grid),rim:[m(a.rim[0],b.rim[0]),m(a.rim[1],b.rim[1])],
  star:mix(a.star,b.star,t),lights:mix(a.lights,b.lights,t),cl:[m(a.cl[0],b.cl[0]),m(a.cl[1],b.cl[1]),mix(a.cl[2],b.cl[2],t)],sn:[m(a.sn[0],b.sn[0]),mix(a.sn[1],b.sn[1],t)],hz:mix(a.hz,b.hz,t)}}
function prof(T:Any,arr:Any,az:Any){const f=(az-T.az0)/T.step,i=Math.floor(f);if(i<0||i>=arr.length-1)return 0;const t=f-i;return(arr[i]*(1-t)+arr[i+1]*t)/100}

/* Seattle, in metres along the skyline: south on the left, as seen from across the lake */
const sym=(p:Any)=>p.map(([w,h]:Any)=>[-w,h]).concat(p.slice().reverse().filter(([w]:Any)=>w>0).map(([w,h]:Any)=>[w,h]));
const arc=(cx:Any,cy:Any,rx:Any,ry:Any,a0:Any,a1:Any,n:Any)=>{const r=[];for(let i=0;i<=n;i++){const a=rad(a0+(a1-a0)*i/n);r.push([cx+Math.cos(a)*rx,cy+Math.sin(a)*ry])}return r};
const crane=(d:Any)=>[[[-14,0],[-10,46]],[[14,0],[10,46]],[[-12,22],[12,22]],[[-13,46],[13,46],[13,55],[-13,55],[-13,46]],[[-5,55],[1,86],[7,55]],[[11*d,52],[44*d,114]],[[1,86],[30*d,90]],[[-12*d,52],[-38*d,52]]];
const C:Any[]=[],B=(x:number,z:number,p:Any,o?:Any)=>C.push(Object.assign({x,z,p},o||{}));
const M0=-1680,M1=3320;
const flat=(w:Any,h:Any)=>[[-w,0],[-w,h],[w,h],[w,0]];
const pent=(w:Any,h:Any,f:Any)=>[[-w,0],[-w,h],[-w*f,h],[-w*f,h+6],[w*f,h+6],[w*f,h],[w,h],[w,0]];
const step=(w:Any,h:Any)=>[[-w,0],[-w,h-18],[-w+4,h-18],[-w+4,h-7],[-w+8,h-7],[-w+8,h],[w-8,h],[w-8,h-7],[w-4,h-7],[w-4,h-18],[w,h-18],[w,0]];
/* back row: plain office towers that fill the gaps and thin out to the north */
for(let x=-330,i=0;x<1760;i++){const w=13+hash(i,21)*9,env=x<1000?112+76*Math.exp(-((x-380)*(x-380))/260000):116-((x-1000)/760)*44,h=Math.round((env*(.68+.38*hash(i,23)))/4.2)*4.2,k=hash(i,25);
 B(x,0,k<.42?pent(w,h,.55):k<.74||w<15?flat(w,h):step(w,h),hash(i,27)<.16?{a:[[[0,h+(k<.42?6:0)],[0,h+20]]]}:{});x+=w*2+3+hash(i,29)*20}
/* low and mid rise the towers stand in */
for(let x=-900,i=0;x<1900;i++){const w=22+hash(i,3)*30,h=Math.round(((x<-300?22:36)+hash(i,5)*(x<-300?26:40))/4.2)*4.2;B(x+w/2,.5,hash(i,9)<.5?pent(w/2,h,.5):flat(w/2,h));x+=w+2+hash(i,11)*7}
B(-1500,1,[[-150,0],[-150,34],[-126,37],[-126,50],...arc(-15,50,111,18,180,0,14),[96,37],[150,34],[150,0]],{nw:1,flood:[[-110,62],[-60,68],[30,68],[80,62]],l:[arc(-46,47,80,15,172,8,10)]}); // ballpark roof
B(-1085,1,[[-140,0],[-140,28],[-118,44],[-60,50],[60,50],[118,44],[140,28],[140,0]],{nw:1,a:[arc(0,30,152,58,180,0,22),arc(0,30,152,50,177,3,22)],rowl:[-110,110,52]});                // stadium arches
B(-1345,.9,null,{a:crane(1),bc:[[44,114]]});B(-1262,.9,null,{a:crane(1),bc:[[44,114]]});B(-905,.9,null,{a:crane(-1),bc:[[-44,114]]});                                                 // port cranes
B(-770,2,sym([[9,0],[9,52],[10.5,52],[10.5,57],[8,57],[8,63],[0,77]]),{a:[[[0,77],[0,84]]]});                                                                                           // station clock tower
B(-440,2,[[-34,0],[-34,78],[-12,78],[-12,112],[-13.5,112],[-13.5,116],[-10.5,116],[-10.5,121],[0,143],[10.5,121],[10.5,116],[13.5,116],[13.5,112],[12,112],[12,78],[24,78],[24,0]],{a:[[[0,143],[0,151]]],bc:[[0,151]]}); // Smith Tower
B(-84,2,[[-17,0],[-17,201],[9,201],[17,188],[17,0]],{l:[[[9,0],[9,201]]]});                                                                                                             // F5 Tower
B(0,1,[[-31,0],[-31,284],[-4,284],[-4,264],[13,264],[13,226],[31,226],[31,0]],{l:[[[-4,0],[-4,264]],[[13,0],[13,226]]],a:[[[-22,284],[-22,298]],[[-12,284],[-12,292]]],bc:[[-22,298]],hero:1}); // Columbia Center
B(78,2,[[-21,0],[-21,188],[-18,188],[-18,197],[-14,197],[-14,204],...arc(0,204,12,13,180,0,12),[14,204],[14,197],[18,197],[18,188],[21,188],[21,0]],{a:[[[0,217],[0,224]]]});          // Municipal Tower
B(156,1,[[-21,0],[-21,168],[-15,168],[-15,175],[15,175],[15,168],[21,168],[21,0]]);
B(212,2,pent(20,155,.6));
B(272,1,pent(22,188,.4));
B(334,2,[[-18,0],[-18,140],...arc(0,140,18,16,180,0,12),[18,0]]);
B(390,1,[[-16,0],[-16,150],[-6,150],[-6,160],[16,160],[16,0]]);
B(452,1,sym([[23,0],[23,192],[18,198],[18,212],[12,216],[12,224],[0,236]]),{a:[[[0,236],[0,244]]],bc:[[0,244]]});                                                                       // 1201 Third
B(508,2,sym([[14,0],[14,66],[11,66],[11,80],[8,80],[8,90],[4,90],[4,97],[0,101]]));                                                                                                    // Seattle Tower
B(566,1,[[-28,0],[-28,160],[-20,160],[-20,182],[4,182],[4,187],[18,187],[18,182],[27,182],[27,0]]);
B(622,2,pent(16,148,.5));
B(672,2,[[-6,0],...arc(-16,0,10,36,0,90,8).slice(1),[-16,157],[16,157],...arc(16,0,10,36,90,180,8).slice(0,-1),[6,0]]);                                                                // Rainier Tower on its pedestal
B(742,1,[[-19,0],[-19,259],[17,259],...arc(65,150,48,150,180,270,16).slice(1)],{l:[[[17,150],[17,259]]]});                                                                              // Rainier Square Tower
B(846,1,[[-22,0],[-22,204],[-15,204],[-15,216],[-2,216],[-2,226],[9,226],[9,216],...arc(9,160,15,56,90,0,10).slice(1),[24,0]],{a:[[[3,226],[3,242]]]});                                   // Two Union Square
B(896,2,[[-15,0],[-15,133],[-11,139],[11,139],[15,133],[15,0]]);
B(952,1,sym([[21,0],[21,146],[16,152],[16,160],[9,166],[0,178]]));                                                                                                                    // US Bank Centre
B(1016,1,pent(22,152,.35),{a:[[[-12,158],[-12,172]]]});B(1068,2,pent(12,134,.5));B(1118,1,[[-12,0],[-12,128],[-7,134],[7,134],[12,128],[12,0]]);B(1172,1,flat(24,113.4));
[[1240,137],[1288,121]].forEach(([x,h]:Any)=>B(x,2,[[-14,0],[-14,h-8],[-15.5,h-8],[-15.5,h-3],[-13,h],[13,h],[15.5,h-3],[15.5,h-8],[14,h-8],[14,0]],{band:1}));                               // Westin towers
B(1342,1,pent(19,146,.5));B(1402,1,[[-20,0],[-20,150],[-8,150],[-8,160],[20,160],[20,0]]);B(1464,1,[[-20,0],[-20,159],[10,159],[10,148],[20,148],[20,0]]);
B(1522,2,step(13,134));B(1578,2,sym([[9,0],[9,108],[5,114],[0,126]]));B(1632,1,pent(11,117.6,.5));
B(1900,2,null,{a:[-2,-1,0,1,2].map((k:Any)=>[[k*11-4.5,0],[k*11-3.2,19],[k*11,32],[k*11+3.2,19],[k*11+4.5,0]])});                                                                           // Science Center arches
B(1990,2,null,{needle:1,bc:[[0,185]]});
B(2112,1,[[-55,0],[-55,12],[-30,22],[0,34],[30,22],[55,12],[55,0]],{nw:1});                                                                                                            // arena roof
B(2700,1,null,{hill:1});                                                                                                                                                              // Queen Anne
B(2640,1,null,{mast:[100,236],bc:[[0,236],[0,170]]});B(2742,1,null,{mast:[103,262],bc:[[0,262],[0,186]]});B(2836,1,null,{mast:[99,228],bc:[[0,228],[0,166]]});                            // its broadcast towers
B(0,3,null,{ridge:1});                                                                                                                                                                // the tree line across the lake
C.sort((a:Any,b:Any)=>a.z-b.z);
C.forEach((b:Any,i:Any)=>{b.w=[];if(!b.p||b.nw)return;let x0=1e9,x1=-1e9,y1=0;b.p.forEach(([x,y]:Any)=>{x0=Math.min(x0,x);x1=Math.max(x1,x);y1=Math.max(y1,y)});b.bb=[x0,x1,y1];
 for(let r=0,y=6.3;y<y1-3;y+=4.2,r++){const fl=hash(i,r,7)<.42?.62:.13;for(let c=0,x=x0+2.6;x<x1-3;x+=3.6,c++)if(hash(i,c,r)<fl)b.w.push([x,y,hash(c,r,i)<.7?0:hash(r,c,i)<.8?1:2,hash(i*3,c,r),hash(c,i*5,r)])}});
const WIN=[[255,213,144],[200,236,255],[255,154,208]];
const HILL=(m:Any)=>100*Math.pow(.5+.5*Math.cos(Math.PI*clamp(m/(m<0?640:600),-1,1)),.62);

function needle(ctx:Any,X:Any,Y:Any,big:Any){const leg=(d:Any)=>{ctx.beginPath();ctx.moveTo(X(-19*d),Y(0));ctx.quadraticCurveTo(X(-9*d),Y(58),X(-4.6*d),Y(112));ctx.quadraticCurveTo(X(-5.2*d),Y(136),X(-10.5*d),Y(151));
  ctx.lineTo(X(-7*d),Y(151));ctx.quadraticCurveTo(X(-3.4*d),Y(136),X(-2.9*d),Y(112));ctx.quadraticCurveTo(X(-6.5*d),Y(60),X(-14.5*d),Y(0));ctx.closePath();ctx.fill();ctx.stroke()};
 leg(1);leg(-1);
 const poly=(p:Any)=>{ctx.beginPath();p.forEach(([x,y]:Any,i:Any)=>i?ctx.lineTo(X(x),Y(y)):ctx.moveTo(X(x),Y(y)));ctx.closePath();ctx.fill();ctx.stroke()};
 poly([[-1.6,0],[-1.6,151],[1.6,151],[1.6,0]]);poly([[-11.5,28.5],[-11.5,31.5],[11.5,31.5],[11.5,28.5]]);
 poly(sym([[10.5,151],[20,156.5],[21.8,157.6],[21.8,159.2],[19.2,159.8],[18.4,163],[12.5,166.6],[5.2,169.2],[4.2,172.4],[1.6,173.4],[1.3,178.6],[.55,179],[.55,185]]));
 if(big){ctx.beginPath();ctx.moveTo(X(-12.5),Y(166.6));ctx.lineTo(X(12.5),Y(166.6));ctx.stroke()}}
function mast(ctx:Any,X:Any,Y:Any,b:Any,t:Any,big:Any){ctx.beginPath();ctx.moveTo(X(-7),Y(b-6));ctx.lineTo(X(-1),Y(t-24));ctx.moveTo(X(7),Y(b-6));ctx.lineTo(X(1),Y(t-24));ctx.moveTo(X(0),Y(t-24));ctx.lineTo(X(0),Y(t));
 ctx.moveTo(X(-3),Y(t-16));ctx.lineTo(X(3),Y(t-16));ctx.moveTo(X(-2.2),Y(t-8));ctx.lineTo(X(2.2),Y(t-8));
 if(big){const n=7,Hh=t-24-b+6;for(let i=1;i<n;i++){const f=i/n,w=7-6*f,y=b-6+Hh*f,f2=(i-1)/n,w2=7-6*f2,y2=b-6+Hh*f2;ctx.moveTo(X(-w),Y(y));ctx.lineTo(X(w),Y(y));ctx.moveTo(X(-w2),Y(y2));ctx.lineTo(X(w),Y(y));ctx.moveTo(X(w2),Y(y2));ctx.lineTo(X(-w),Y(y))}}
 ctx.stroke()}
/* a row of tree crowns along a ground line g(m), from m0 to m1 */
function trees(ctx:Any,X:Any,Y:Any,g:Any,m0:Any,m1:Any,seed:Any,hmin:Any,hvar:Any){ctx.beginPath();ctx.moveTo(X(m0),Y(0));ctx.lineTo(X(m0),Y(g(m0)));for(let m=m0,i=0;m<m1;i++){const w=13+hash(i,seed)*24,e=Math.min(m1,m+w),h=hmin+hash(i,seed+1)*hvar;
  ctx.quadraticCurveTo(X(m+(e-m)*.5),Y(Math.max(g(m),g(e))+h*1.7),X(e),Y(g(e)));m=e}ctx.lineTo(X(m1),Y(0));ctx.closePath()}

function city(ctx:Any,o:Any,P:Any,rim:Any,W:Any,px:Any,refl:Any){const ppd=o.ppd,s=ppd*21/4700*(o.cityScale||1),xl=(223-o.az0)*ppd,hy=o.hy;if(xl>W+60||xl+(M1-M0)*s<-60)return;
 const big=s>.3,mid=s>.2,t=o.t||0,L=P.lights,lod=Math.min(1,Math.pow(s/.42,2)),ww=Math.max(px(1),2.1*s),wh=Math.max(px(1),1.7*s);
 if(L>.3){const cx=xl+(700-M0)*s,r=(M1-M0)*s*.4,g=ctx.createRadialGradient(cx,hy,0,cx,hy,r);g.addColorStop(0,`rgba(255,130,190,${.2*L})`);g.addColorStop(.55,`rgba(190,110,255,${.07*L})`);g.addColorStop(1,'rgba(190,110,255,0)');ctx.fillStyle=g;ctx.fillRect(cx-r,hy-r,r*2,r)}
 ctx.lineJoin='round';ctx.lineCap='round';
 const dot=(x:Any,y:Any,r:Any,c:Any,a:Any)=>{ctx.globalAlpha=a;ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill()};
 for(const b of C){const X=(m:Any)=>xl+(b.x+m-M0)*s,Y=(h:Any)=>hy-h*s,za=b.z<=.5?.2:b.z<1?.4:b.z<2?.58:.78,base=mixc(P.bld,P.far,b.z<=.5?.56:b.z<1?.3:b.z<2?.15:0);
  ctx.strokeStyle=rim;ctx.lineWidth=px(big?1.25:1);ctx.globalAlpha=1;ctx.fillStyle=css(base);
  if(b.ridge){const gr=(m:Any)=>(m<-1560||m>2120?5:12)+6*Math.sin(m/210)+3*Math.sin(m/83+1);ctx.fillStyle=css(mixc(P.bld,[0,0,0],.4));trees(ctx,X,Y,gr,M0,2190,5,3,5);ctx.fill();continue}
  if(b.hill){ctx.fillStyle=css(mixc(P.bld,P.far,.24));ctx.beginPath();ctx.moveTo(X(-640),Y(0));for(let m=-640;m<=600;m+=20)ctx.lineTo(X(m),Y(HILL(m)));ctx.lineTo(X(600),Y(0));ctx.closePath();ctx.fill();ctx.globalAlpha=.4;ctx.stroke();ctx.globalAlpha=1;
   ctx.fillStyle=css(mixc(P.bld,P.far,.12));for(let m=-560,i=0;m<540;i++){const w=10+hash(i,41)*16,h=4+hash(i,43)*7,g0=Math.min(HILL(m),HILL(m+w));if(hash(i,45)<.7)ctx.fillRect(X(m),Y(g0+h),w*s,h*s+1);m+=w+3+hash(i,47)*16}
   trees(ctx,X,Y,(m:Any)=>HILL(m)-3,-600,560,17,3,5);ctx.fillStyle=css(mixc(P.bld,P.far,.2));ctx.fill();
   if(L>.25&&mid)for(let i=0;i<70;i++){const m=-600+hash(i,51)*1180,h=hash(i,53)*HILL(m)*.82+3;if(hash(i,55)<L*.8){ctx.fillStyle=css(WIN[hash(i,57)<.75?0:1],L*(.35+.5*hash(i,59)));ctx.fillRect(X(m),Y(h),ww,wh)}}continue}
  if(b.p){ctx.beginPath();b.p.forEach(([x,y]:Any,i:Any)=>i?ctx.lineTo(X(x),Y(y)):ctx.moveTo(X(x),Y(y)));ctx.closePath();
   if(b.bb&&mid){const g=ctx.createLinearGradient(0,Y(b.bb[2]),0,hy);g.addColorStop(0,css(mixc(base,P.s[2],.16)));g.addColorStop(1,css(base));ctx.fillStyle=g}ctx.fill();
   if(b.bb&&(big||L>.03)){ctx.save();ctx.clip();const [x0,x1,y1]=b.bb;
    if(big){ctx.fillStyle='rgba(0,0,8,.2)';ctx.fillRect(X(x0+(x1-x0)*.62),Y(y1)-2,(x1-x0)*.38*s+2,y1*s+4);if(b.band){ctx.fillStyle='rgba(255,255,255,.05)';for(let y=10;y<y1-8;y+=8.4)ctx.fillRect(X(x0),Y(y),(x1-x0)*s,Math.max(px(.6),1*s))}}
    if(L>.03&&s>.1)for(const [x,y,c,th,ld] of b.w){if(ld>lod||th>L*1.15)continue;ctx.fillStyle=css(WIN[c],L*(.42+.5*th));ctx.fillRect(X(x),Y(y),ww,wh)}
    ctx.restore()}
   ctx.globalAlpha=za*(b.hero?1.25:1);ctx.stroke();
   if(L>.45&&mid&&b.bb&&b.z>=1&&hash(Math.round(b.x),77)<.3){const c=WIN[hash(Math.round(b.x),79)<.5?1:2],y0=Y(b.bb[2])+px(.5);ctx.globalAlpha=(L-.45)*1.6;ctx.fillStyle=css(c);ctx.fillRect(X(b.bb[0]*.55),y0,(b.bb[1]-b.bb[0])*.55*s,Math.max(px(1),1.3*s))}
   if(refl&&b.bb&&L>.12&&s>.13)refl.push([X((b.bb[0]+b.bb[1])/2),(b.bb[1]-b.bb[0])*s,b.bb[2]*s,b.z>=1?1:.5])}
  ctx.globalAlpha=za;ctx.fillStyle=css(base);
  if(b.needle){ctx.globalAlpha=.9;needle(ctx,X,Y,big);if(L>.2){ctx.globalAlpha=L;ctx.strokeStyle='#ffe9c4';ctx.lineWidth=px(1.2);ctx.beginPath();ctx.moveTo(X(-21),Y(158.4));ctx.lineTo(X(21),Y(158.4));ctx.moveTo(X(-18),Y(161.6));ctx.lineTo(X(18),Y(161.6));ctx.stroke();if(refl)refl.push([X(0),44*s,150*s,1.6])}}
  if(b.mast){ctx.globalAlpha=.6;ctx.lineWidth=px(1);mast(ctx,X,Y,b.mast[0],b.mast[1],big)}
  const ln=(b.a||[]).concat(big&&b.l?b.l:[]);if(ln.length){ctx.strokeStyle=rim;ctx.lineWidth=px(big?1.2:1);ctx.beginPath();for(const l of ln)l.forEach(([x,y]:Any,i:Any)=>i?ctx.lineTo(X(x),Y(y)):ctx.moveTo(X(x),Y(y)));ctx.globalAlpha=b.p?za*.9:Math.max(za,.5);ctx.stroke()}
  if(L>.2&&mid){if(b.rowl)for(let m=b.rowl[0];m<=b.rowl[1];m+=11)dot(X(m),Y(b.rowl[2]),Math.max(px(.7),1.1*s),'#eaf6ff',L*.8);if(b.flood)for(const [m,h] of b.flood)dot(X(m),Y(h),Math.max(px(.9),1.8*s),'#f4fbff',L*.9)}
  if(b.bc&&L>.15)for(const [bx,by] of b.bc)dot(X(bx),Y(by),Math.max(px(1.1),2.2*s),'#ff4d6d',L*(.55+.45*+(Math.sin(t*2.4+b.x+by)>.2)));
 }ctx.globalAlpha=1}

/* a made-up spectrum so the echo lines have something to dance to: kick, a wandering melody, hats */
function spec(u:Any,t:Any){const b=t*1.75,kick=Math.exp(-fr(b)*5.5),hat=Math.exp(-fr(b*2+.5)*8);let v=Math.exp(-u*u/.022)*(.3+.8*kick);
 for(let j=0;j<3;j++){const c=.3+.2*Math.sin(t*.42*(j+1)+j*2.1);v+=Math.exp(-((u-c)*(u-c))/.0045)*(.3+.34*Math.sin(t*.9+j*1.7)+.2)}
 v+=Math.exp(-((u-.84)*(u-.84))/.02)*hat*.45+(hash(Math.floor(u*70),Math.floor(t*14))-.5)*.1;return Math.max(0,v)}

const STARS:number[][]=[];for(let i=0;i<280;i++)STARS.push([hash(i,1),hash(i,2),.45+Math.pow(hash(i,3),3)*1.9,hash(i,4)*6.3,hash(i,5)]);
const CLOUDS:{u:number;v:number;w:number;h:number;d:number}[]=[];for(let i=0;i<8;i++)CLOUDS.push({u:hash(i,61),v:.3+.5*hash(i,62),w:360+hash(i,63)*520,h:9+hash(i,64)*12,d:.5+hash(i,65)});
let GRAIN:HTMLCanvasElement|null=null;
function grain(ctx:Any,w:Any,h:Any){if(typeof document==='undefined')return;if(!GRAIN){const c=document.createElement('canvas');c.width=c.height=160;const x=c.getContext('2d');if(!x)return;const im=x.createImageData(160,160);for(let i=0;i<160*160;i++){const v=hash(i,71)<.5?0:255;im.data[i*4]=im.data[i*4+1]=im.data[i*4+2]=v;im.data[i*4+3]=Math.floor(hash(i,73)*11)}x.putImageData(im,0,0);GRAIN=c}
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=ctx.createPattern(GRAIN,'repeat');ctx.fillRect(0,0,w,h);ctx.restore()}
function wisp(ctx:Any,cx:Any,cy:Any,rx:Any,ry:Any,col:Any,a:Any){ctx.save();ctx.translate(cx,cy);ctx.scale(rx/ry,1);const g=ctx.createRadialGradient(0,0,0,0,0,ry);g.addColorStop(0,css(col,a));g.addColorStop(.5,css(col,a*.5));g.addColorStop(1,css(col,0));ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,ry,0,7);ctx.fill();ctx.restore()}

/* grid pulse (music reaction): soft glow bands that roll across the lake grid, drawn additively
   over the lines. Each band sits at depth p on the same pow(.., 2.1) spacing as the horizontal
   lines and grows with it, so it reads as one row of the floor coming toward the viewer. */
const PULSE_COL:RGB=[0,0,0]; // the band colour, filled in place once a band is visible
function gridPulse(ctx:Any,G:HorizonGrid,W:Any,H:Any,hy:Any,vx:Any,px:Any,grid:RGB){let on=false;const col=PULSE_COL;
 for(let i=0;i<G.waves.length;i++){const w=G.waves[i];if(!(w.a>.003))continue;
  if(!on){for(let k=0;k<3;k++)col[k]=mix(grid[k],255,.35);ctx.save();ctx.beginPath();ctx.rect(0,hy,W,H-hy);ctx.clip();ctx.globalCompositeOperation='lighter';on=true}
  const p=clamp(w.p,0,1),a=clamp(w.a,0,1),y=hy+(H-hy)*Math.pow(p,2.1),th=4+(H-hy)*.26*Math.pow(p,1.1);
  wisp(ctx,vx,y,W*.72,th,col,a);ctx.fillStyle=css(col,a*.35);ctx.fillRect(0,y-px(.7),W,px(1.4))}
 if(on)ctx.restore()}

/** Grid pulse (music reaction): the lake grid brightens with the bass and glow bands roll toward the viewer. */
export interface HorizonGrid {
  /** 0 to 1: raises the grid line opacity from 0.3 up to 0.55. */
  bright: number;
  /** Glow bands: `p` is the depth (0 at the horizon, 1 at the bottom edge), `a` the opacity (0 to 1). Bands with `a` near 0 are skipped. */
  waves: { p: number; a: number }[];
}

/** Echo ripple (music reaction): lines of the range that wobble to a spectrum. */
export interface HorizonEcho {
  /** Number of echo lines. A fractional count (a glide between cameras) crossfades the two whole counts either side. */
  n: number;
  /** Amplitude of the spectrum in canvas design pixels. */
  amp: number;
  /** Opacity of the echo lines, 0 to 1. */
  a: number;
  /** Animation time in seconds. */
  t?: number;
  /** Horizontal centre of the spectrum in design pixels (default: half the width). */
  cx?: number;
  /** Half width of the spectrum in design pixels (default 1000). */
  hs?: number;
  /** Drift speed of the lines (default 0.3). */
  speed?: number;
  /** Seconds of spectrum history spread across the lines (default 7). */
  span?: number;
  /**
   * The spectrum the lines follow, in place of the made-up `spec(u, tau)`: `u` runs 0 at `cx`
   * to 1 at `hs` away, `tau` is the line's moment (`t` minus its share of `span`). Values in
   * `spec`'s range, about 0 to 1.3. Absent: `spec`, as before.
   */
  sample?: (u: number, tau: number) => number;
  /** Optional soft cap in design pixels. Omitted on the default path for pixel parity. */
  heightCap?: number;
  /**
   * Stroke colours for the lines, as RGB triples (0 to 255): at the left edge, at `cx`, and at the
   * right edge, blended over the palette's rim colour by `k` (0 to 1), and the line width in design
   * pixels (default 1.4). With a tint the newest line also fades in over its first `1 / n` of the
   * drift (by `k`), so a brighter line never pops in at the front. Absent or `k` 0: as before.
   */
  tint?: { left: number[]; centre: number[]; right: number[]; k: number; width?: number };
  /**
   * The drift phase of the lines, 0 to 1, in place of `t * speed` (the caller steps it, so the lines
   * can ease to a stop on their resting places). Absent: `t * speed`, as before.
   */
  drift?: number;
  /**
   * How far the lines have settled into their resting look, 0 (live, as before) to 1 (at rest):
   * linear in time; each line eases from it, the far lines (nearer the horizon) a touch later.
   * At rest the lines stop following the spectrum and take `look`'s shape and opacity, scaled by
   * `restA`, with thinner strokes. Absent or 0: exactly as before.
   */
  rest?: number;
  /** The resting opacity (0 to 1) the `look`'s per-line shares scale. */
  restA?: number;
  /** The resting look (default 'contours'). */
  look?: RestLook;
  /**
   * How much the camera is the visualizer, 0 to 1 (`visualizerWeight`). Above 0 the displacement
   * mask lets the ripple reach the foot of the range and fade toward the echo's edges, and `swell`
   * lifts the base shape. Absent or 0: exactly as before.
   */
  dance?: number;
  /** The kick, 0 to 1: the lines' base shape swells by up to 20 percent of itself (scaled by `dance`). Absent or 0: no swell. */
  swell?: number;
}

/** The resting looks of the ridgelines; see `REST_LOOK` in echo.ts. */
export const REST_LOOKS = ['contours', 'levels', 'haze', 'ridge', 'ridgelevels', 'flat'] as const;
export type RestLook = (typeof REST_LOOKS)[number];
/* The resting looks' sizes, from the concept page (a 1280 by 300 drawing whose mountain peaks at
   0.641 of its 150 px height): vertical sizes are in units of that peak, so they keep their share
   of the real range's height (cmax); horizontal ones scale with the width. */
const REST_PEAK=.641*150,REST_LEVEL_TOP=.92*150/REST_PEAK,REST_LW=1,REST_LAG=.22;
/* Fill under each resting line, as a share of the live fill: the layered look stays for contours
   and levels; haze and ridge draw lines only (their fills would paint the sky or recolour the range). */
const REST_FILL:Record<RestLook,number>={contours:1,levels:1,haze:0,ridge:0,ridgelevels:1,flat:1};
/* 'ridgelevels': the top line traces the ridge, the others are straight levels cut off by the mountain, up to this share of its height.
   A line between the top two blends its level, share and glow into the ridge's by its place, so a drifting line never jumps; at rest the places are whole. */
const REST_RL_TOP=.9;

/* The dance's edge fade: 1 within 62 percent of the half span from the echo's centre, easing to 0 at the half span (numbers in, number out: no closure per frame). */
function echoEdge(i:number,cx:number,hs:number){const u=Math.abs(i*2-cx)/hs;return u>=1?0:u<.62?1:1-smooth((u-.62)/.38)}
/* The displacement mask for sample i (range height c, tallest cmax): the ripple is strongest where the range is tall; with the dance it also reaches the foot and fades toward the echo's edges. */
function echoMask(c:number,cmax:number,i:number,cx:number,hs:number,dn:number){const m0=Math.min(1,c/(cmax*.5));return dn>0?mix(m0,Math.min(1,.2+c/(cmax*.5))*(.25+.75*echoEdge(i,cx,hs)),dn):m0}

/** Everything `draw` reads. Sizes are design pixels; `scale` maps them to device pixels. */
export interface HorizonDrawOptions {
  /** Design width (default 2560). */
  W?: number;
  /** Design height (default 720). */
  H?: number;
  /** Design pixels to canvas pixels: stage scale times devicePixelRatio (default 1). */
  scale?: number;
  /** Which terrain (default and only shipped value: 'pano'). */
  ter?: TerrainName;
  /** Horizon line, design pixels from the top. */
  hy: number;
  /** Compass azimuth in degrees at the left edge of the view. */
  az0: number;
  /** Pixels per degree of azimuth. */
  ppd: number;
  /** Vertical exaggeration of the terrain and sun height (default 1). */
  vex?: number;
  /** Seconds of animation time, drives twinkle, clouds and ripples (default 0). */
  t?: number;
  /** Wall clock in epoch milliseconds, which sets the sun and the palette. */
  ms: number;
  /** Number of stars drawn at night (default 190, at most 280). */
  stars?: number;
  /** Moon as [x, y, radius] in design pixels, or null for none. */
  moon?: [number, number, number] | null;
  /** Sun radius override in design pixels (default 2.05 times ppd). */
  sunR?: number;
  /** Vertical scale for sun height only (default: vex). */
  sunV?: number;
  /** Cloud strength multiplier (default 1). */
  clouds?: number;
  /** Sideways cloud offset in design pixels (default 0). Clouds wrap around the stage width plus a 15 percent margin each side, so they slide in and out. */
  cloudShift?: number;
  /** Snow strength multiplier (default 1). */
  snow?: number;
  /** Snow line in degrees before vex (default 0.84; the morning camera passes 0.86). */
  snowDeg?: number;
  /** Music ripple, or null for none. */
  echo?: HorizonEcho | null;
  /** Grid pulse, or null for none (the grid then draws exactly as without music). */
  grid?: HorizonGrid | null;
  /** Set false to hide the city (default shown). */
  city?: boolean;
  /** City size multiplier (default 1). */
  cityScale?: number;
  /** Vanishing point x of the lake grid in design pixels (default half the width). */
  vx?: number;
  /** Lake grid scroll phase, 0 to 1 (default 0). */
  phase?: number;
  /** Set false to skip the film grain (default on). */
  grain?: boolean;
  /**
   * Draw only one part of the picture (default: all of it). 'sky' draws the sky, the stars, the
   * moon, the sun and the clouds and stops. 'ground' clears the canvas and draws everything in
   * front of the sky (the ranges and their lines, the ripple, the city, the shore, the haze at
   * the horizon, the lake with its lights, the grid and the grain) on transparency, with exactly
   * the pixels the whole picture puts there; 'sky' under 'ground' is the whole picture.
   */
  part?: HorizonPart;
}

/** A part of the picture `draw` can be asked for; see `HorizonDrawOptions.part`. */
export type HorizonPart = 'sky' | 'ground';

/** What `draw` returns: the sun's sky position and the palette used. */
export interface HorizonDrawResult {
  sun: { az: number; alt: number };
  x: number;
  y: number;
  P: Any;
}

export function draw(ctx:CanvasRenderingContext2D,o:HorizonDrawOptions):HorizonDrawResult{const W=o.W||2560,H=o.H||720,sc=o.scale||1,px=(w:Any)=>Math.max(w,1/sc),TR=TER[o.ter||'pano'],hy=o.hy,ppd=o.ppd,az0=o.az0,k=ppd*(o.vex||1),t=o.t||0,sp=sun(o.ms),P=pal(sp.alt,sp.az>180);
 /* SK: draw the sky, GD: the ground (both unless a part is asked for) */
 const SK=o.part!=='ground',GD=o.part!=='sky';
 ctx.setTransform(sc,0,0,sc,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
 let g:Any;if(SK){g=ctx.createLinearGradient(0,0,0,hy);g.addColorStop(0,css(P.s[0]));g.addColorStop(.49,css(P.s[1]));g.addColorStop(.84,css(P.s[2]));g.addColorStop(1,css(P.s[3]));ctx.fillStyle=g;ctx.fillRect(0,0,W,hy+1)}else ctx.clearRect(0,0,W+1,H+1);
 /* the rim gradient and the sun's glitter on the lake are the ground's: the sky part makes neither */
 let rim:Any=null;if(GD){rim=ctx.createLinearGradient(0,0,W,0);rim.addColorStop(0,css(P.rim[0]));rim.addColorStop(.5,css(P.rim[1]));rim.addColorStop(1,css(P.rim[0]))}
 if(SK&&P.star>.02){const n=o.stars||190;for(let i=0;i<n;i++){const s=STARS[i],c=s[4]<.12?'255,214,232':s[4]<.3?'206,226,255':'255,255,255';ctx.fillStyle=`rgba(${c},${(P.star*(.2+.7*hash(i,9))*(.7+.3*Math.sin(t*1.3+s[3]))).toFixed(3)})`;ctx.beginPath();ctx.arc(s[0]*W,s[1]*(hy-30),s[2],0,7);ctx.fill()}}
 if(SK&&o.moon&&P.star>.3){const [mx,my,mr]=o.moon;g=ctx.createRadialGradient(mx,my,mr*.6,mx,my,mr*4);g.addColorStop(0,`rgba(196,214,255,${.3*P.star})`);g.addColorStop(1,'rgba(196,214,255,0)');ctx.fillStyle=g;ctx.fillRect(mx-mr*4,my-mr*4,mr*8,mr*8);
  g=ctx.createLinearGradient(mx-mr,my-mr,mx+mr,my+mr);g.addColorStop(0,'#ffffff');g.addColorStop(.6,'#d6e4ff');g.addColorStop(1,'#a79bf0');ctx.globalAlpha=P.star;ctx.fillStyle=g;ctx.beginPath();ctx.arc(mx,my,mr,0,7);ctx.fill();
  ctx.fillStyle='rgba(120,110,200,.16)';[[-.3,-.2,.26],[.25,.3,.18],[.1,-.42,.12]].forEach(([a,b,r]:Any)=>{ctx.beginPath();ctx.arc(mx+a*mr,my+b*mr,r*mr,0,7);ctx.fill()});ctx.globalAlpha=1}
 /* sun */
 const hi=smooth((sp.alt-7)/7),R=mix(o.sunR||ppd*2.05,ppd*.85,hi),sx=(sp.az-az0)*ppd,sy=hy-sp.alt*ppd*(o.sunV||o.vex||1),SA=mixc(hx('#ffe27a'),hx('#fff6d2'),hi),SB=mixc(hx('#ff8a4c'),hx('#ffdc9a'),hi),SC=mixc(hx('#ff2d87'),hx('#ffb0c8'),hi);
 let glit=null;
 if(sy-R<hy&&sx>-R*5&&sx<W+R*5){const yt=sy-R,yb=Math.min(sy+R,hy),hv=yb-yt,st=1-hi;
  if(SK){const gy=Math.min(sy,hy);g=ctx.createRadialGradient(sx,gy,R*.3,sx,gy,R*4.2);g.addColorStop(0,css(SB,.55));g.addColorStop(.4,css(SC,.16));g.addColorStop(1,css(SC,0));ctx.fillStyle=g;ctx.fillRect(sx-R*4.3,gy-R*4.3,R*8.6,Math.min(R*8.6,hy-gy+R*4.3));
  ctx.save();ctx.beginPath();let y=yt-1;
  [.5,.62,.72,.8,.87,.93,.975].forEach((f:Any,i:Any)=>{const gy0=yt+hv*f,th=hv*(.014+.011*i)*st;ctx.rect(sx-R-2,y,R*2+4,gy0-y);y=gy0+th});ctx.rect(sx-R-2,y,R*2+4,Math.max(0,yb-y));ctx.clip();
  g=ctx.createLinearGradient(0,sy-R,0,sy+R);g.addColorStop(0,css(SA));g.addColorStop(.55,css(SB));g.addColorStop(1,css(SC));ctx.fillStyle=g;ctx.beginPath();ctx.arc(sx,sy,R,0,7);ctx.fill();ctx.restore()}
  if(GD&&sp.alt<8)glit={x:sx,R:R*Math.min(1,hv/R),c:SB,a:smooth(hv/(R*.7))*(1-hi)}}
 /* clouds: soft bands, lit from below when the sun is low */
 const ca=P.cl[2]*(o.clouds===undefined?1:o.clouds),cs=(o.cloudShift||0)/(1.3*W);
 if(SK&&ca>.02)for(let i=0;i<CLOUDS.length;i++){const c=CLOUDS[i],cx=(fr(c.u+t*c.d*.0016+cs)*1.3-.15)*W,cy=hy*c.v,th=c.h*(1.3-c.v);
  for(let j=0;j<4;j++){const ox=(hash(i,j,81)-.5)*c.w*.8,oy=(hash(i,j,82)-.5)*th*1.1,rx=c.w*(.22+.3*hash(i,j,83)),ry=th*(.5+.5*hash(i,j,84));wisp(ctx,cx+ox,cy+oy+ry*.5,rx*.92,ry*.7,P.cl[1],ca*.5);wisp(ctx,cx+ox,cy+oy,rx,ry,P.cl[0],ca)}}
 if(!GD)return{sun:sp,x:sx,y:sy,P};
 /* the mountains */
 const N=Math.ceil(W/2)+1,cr=new Float32Array(N),ps=new Float32Array(N+1);let cmax=1;for(let i=0;i<N;i++){cr[i]=prof(TR,TR.far,az0+i*2/ppd)*k;if(cr[i]>cmax)cmax=cr[i];ps[i+1]=ps[i]+cr[i]}
 const sm=(i:Any,r:Any)=>{const a=Math.max(0,i-r),b=Math.min(N,i+r+1);return(ps[b]-ps[a])/(b-a)};
 const layer=(f:Any,fill:Any)=>{ctx.beginPath();ctx.moveTo(0,hy+1);for(let i=0;i<N;i++)ctx.lineTo(i*2,hy-f(i));ctx.lineTo(W,hy+1);ctx.closePath();ctx.fillStyle=fill;ctx.fill()};
 const line=(f:Any,a:Any,w:Any,style?:Any)=>{ctx.beginPath();for(let i=0;i<N;i++)i?ctx.lineTo(i*2,hy-f(i)):ctx.moveTo(0,hy-f(0));ctx.strokeStyle=style||rim;ctx.globalAlpha=a;ctx.lineWidth=px(w);ctx.lineJoin='round';ctx.stroke();ctx.globalAlpha=1};
 g=ctx.createLinearGradient(0,hy-cmax,0,hy);g.addColorStop(0,css(P.far));g.addColorStop(1,css(mixc(P.far,mixc(P.s[2],P.s[3],.4),.3)));layer((i:Any)=>cr[i],g);
 const sa=P.sn[1]*(o.snow===undefined?1:o.snow),sl=(o.snowDeg||.84)*k;
 if(sa>.02&&cmax>sl+3){const top=hy-cmax,ys=hy-sl,cap=ys-(ys-top)*.48;
  g=ctx.createLinearGradient(0,ys+8,0,ys-14);g.addColorStop(0,css(P.sn[0],0));g.addColorStop(1,css(P.sn[0],sa*.62));layer((i:Any)=>cr[i],g);
  g=ctx.createLinearGradient(0,cap+10,0,cap-12);g.addColorStop(0,css(P.sn[0],0));g.addColorStop(1,css(P.sn[0],sa*.5));layer((i:Any)=>cr[i],g);
  /* a few rock ribs so the snow is not one flat tint */
  ctx.strokeStyle=css(mixc(P.far,P.s[1],.35),.32*Math.min(1,sa*1.6));ctx.lineWidth=px(1.3);ctx.lineCap='round';ctx.beginPath();
  for(let i=6;i<N-6;i+=1){const az=az0+i*2/ppd,q=Math.floor(az*9);if(hash(q,33)>.24||Math.floor((az-2/ppd)*9)===q)continue;const h0=cr[i];if(h0<sl+10)continue;const len=(h0-sl)*(.35+.4*hash(q,35)),lean=(hash(q,37)-.5)*len*.5;ctx.moveTo(i*2,hy-h0+3);ctx.lineTo(i*2+lean,hy-h0+3+len)}
  ctx.stroke()}
 line((i:Any)=>cr[i],.34,1.2);
 if(sp.alt<9&&sp.alt>-7&&sx>-R*6&&sx<W+R*6){const hg=ctx.createLinearGradient(sx-R*5.5,0,sx+R*5.5,0),a=.95*smooth((sp.alt+7)/6)*(1-hi);hg.addColorStop(0,css(SA,0));hg.addColorStop(.5,css(SA,a));hg.addColorStop(1,css(SA,0));line((i:Any)=>cr[i],1,1.8,hg)}
 if(o.echo){const E=o.echo,nE=Math.max(1,E.n),n0=Math.floor(nE),fn=nE-n0>1e-9?nE-n0:0,cx=E.cx===undefined?W/2:E.cx,hs=E.hs||1000,fq=E.drift===undefined?((E.t||0)*(E.speed||.3))%1:fr(E.drift),span=E.span||7,S=E.sample||spec,C=(v:number)=>E.heightCap===undefined?v:E.heightCap*Math.tanh(v/E.heightCap),TT=E.tint,tk=TT?clamp(TT.k,0,1):0,lw=TT?mix(1.4,TT.width||1.4,tk):1.4;
  let es:Any;if(tk>0){const c0=clamp(cx/W,.01,.99),rimAt=(q:Any)=>mixc(P.rim[0],P.rim[1],1-Math.abs(q-.5)*2);es=ctx.createLinearGradient(0,0,W,0);
   for(const [q,c] of [[0,TT!.left],[c0,TT!.centre],[c0+(1-c0)*.6,mixc(TT!.centre,TT!.right,.5)],[1,TT!.right]] as Any)es.addColorStop(q,css(mixc(rimAt(q),c,tk)))}
  const RK=E.rest?clamp(E.rest,0,1):0,LK:RestLook=E.look||'contours',RA=E.restA||0,ek=Math.min(1,RK*8),vu=cmax/REST_PEAK,hu=W/1280;
  const hz=(i:Any,r:Any)=>r?sm(i,r):cr[i];
  /* The dance: how much the camera is the visualizer and the kick. At 0 every number below is today's. */
  const DN=E.dance?clamp(E.dance,0,1):0,SW=E.swell?clamp(E.swell,0,1):0;
  /* One whole set of n lines at weight wk. A glide blends the line count, so a fractional count draws
     the two whole sets either side crossfaded by its fraction: every line keeps its own place. */
  const set=(n:number,wk:number)=>{
  /* a line's resting height at sample i: kc runs 0 (the lowest line) to n - 1 (the top one), q is kc / (n - 1);
     the haze ranges are softened (box smoothed) the farther back they sit */
  const rh=(i:Any,kc:Any,q:Any)=>LK==='flat'?0:LK==='levels'?Math.min(cr[i],vu*REST_LEVEL_TOP*REST_PEAK*(kc+1)/(n+.6)+2.5*vu*Math.sin(Math.PI*i*2/W)*(kc/n))
   :LK==='haze'?hz(Math.round(clamp(((i*2-q*70*hu)*(1+q*.1)-q*.03*W)/2,0,N-1)),Math.round(q*30))*(1+q*.42)+q*26*vu
   :LK==='ridge'?Math.max(0,cr[i]-Math.max(0,2-kc)*7*vu)
   :LK==='ridgelevels'?mix(Math.min(cr[i],cmax*REST_RL_TOP*(kc+1)/(n-1)),cr[i],clamp(kc-(n-2),0,1))
   :cr[i]*(kc+1)/n;
  /* each look's resting opacity for line q, as a share of restA */
  const rs=(kc:Any,q:Any)=>LK==='levels'?.9-.35*q:LK==='haze'?1-.75*q:LK==='ridge'?2.4*Math.max(0,1-Math.abs(kc-(n-1)))+.45*clamp(2-kc,0,1):LK==='ridgelevels'?mix(.75,2.2,clamp(kc-(n-2),0,1)):.55+.45*q;
  for(let j=0;j<n;j++){const a=(j+fq)/n,p=1-a,tau=(E.t||0)-a*span,sw=.35+.65*Math.sin(Math.PI*a),pp=Math.pow(p,1.15),r=Math.round(2+a*26),bs=DN>0&&SW>0?1+.2*SW*DN*(1-.45*a):1;
   if(RK>0){const x=clamp((RK-REST_LAG*a)/(1-REST_LAG),0,1),wl=1-(1-x)*(1-x),q=n>1?clamp(1-(a*n-.5)/(n-1),0,1):1,kc=q*(n-1);
    // At rest only the resting shape: the spectrum is not read.
    const f=wl>=1?(i:Any)=>rh(i,kc,q):(i:Any)=>mix(mix(cr[i],sm(i,r),Math.min(1,a*2.2))*pp*bs+C(S(Math.min(1,Math.abs(i*2-cx)/hs),tau)*E.amp*sw)*echoMask(cr[i],cmax,i,cx,hs,DN),rh(i,kc,q),wl);
    const fa=(1-wl*(1-REST_FILL[LK]))*wk;
    if(fa>.002){const col=mixc(mixc(P.far,P.s[3],.12),P.mid,a);layer(f,fa<1?css(col,fa):css(col))}
    // Live opacity eased to the resting one; while settling, lines at either end of the drift fade so none pops.
    const al=mix(E.a*(1-a*a*a)*(tk>0?mix(1,smooth(a*n),tk):1),Math.min(1,RA*rs(kc,q)),wl)*mix(1,smooth(a*n*2)*smooth((1-a)*n*2),ek)*wk;
    const top=LK==='ridge'||LK==='ridgelevels'?Math.max(0,1-Math.abs(kc-(n-1))):0,lr=mix(lw,REST_LW+.8*top,wl);
    if(top*wl>.01&&al>.002)line(f,al*.3*top*wl,lr+4,es);
    if(al>.002)line(f,al,lr,es);
    continue}
   const f=(i:Any)=>mix(cr[i],sm(i,r),Math.min(1,a*2.2))*pp*bs+C(S(Math.min(1,Math.abs(i*2-cx)/hs),tau)*E.amp*sw)*echoMask(cr[i],cmax,i,cx,hs,DN);
   layer(f,wk<1?css(mixc(mixc(P.far,P.s[3],.12),P.mid,a),wk):css(mixc(mixc(P.far,P.s[3],.12),P.mid,a)));line(f,E.a*(1-a*a*a)*(tk>0?mix(1,smooth(a*n),tk):1)*wk,lw,es)}};
  set(n0,1-fn);if(fn)set(n0+1,fn)}
 const md=(i:Any)=>prof(TR,TR.mid,az0+i*2/ppd)*k,nr=(i:Any)=>prof(TR,TR.near,az0+i*2/ppd)*k;
 g=ctx.createLinearGradient(0,hy-cmax*.6,0,hy);g.addColorStop(0,css(P.mid));g.addColorStop(1,css(mixc(P.mid,mixc(P.s[2],P.s[3],.4),.2)));layer(md,g);line(md,.16,1);
 const refl:Any[]=[];
 if(o.city!==false)city(ctx,o,P,rim,W,px,refl);
 layer(nr,css(mixc(P.bld,[0,0,0],.3)));
 const hb=clamp(70*k/42,40,170);g=ctx.createLinearGradient(0,hy-hb,0,hy);g.addColorStop(0,css(P.s[3],0));g.addColorStop(1,css(P.s[3],P.hz*.55));ctx.fillStyle=g;ctx.fillRect(0,hy-hb,W,hb);
 /* the lake */
 g=ctx.createLinearGradient(0,hy,0,H);g.addColorStop(0,css(mixc(P.f[0],P.s[3],.34)));g.addColorStop(.22,css(P.f[0]));g.addColorStop(1,css(P.f[1]));ctx.fillStyle=g;ctx.fillRect(0,hy,W,H-hy);
 ctx.globalCompositeOperation='lighter';
 for(const [x,w,h,wt] of refl){const hh=Math.min(H-hy,h*.6+8);ctx.save();ctx.beginPath();ctx.rect(x-w,hy,w*2,hh);ctx.clip();wisp(ctx,x,hy,Math.max(w*.62,2),hh,[255,190,150],.2*P.lights*wt);ctx.restore()}
 if(o.moon&&P.star>.3){const [mx,,mr]=o.moon;ctx.save();ctx.beginPath();ctx.rect(0,hy,W,H-hy);ctx.clip();wisp(ctx,mx,hy,mr*1.6,(H-hy)*.95,[190,205,255],.2*P.star);ctx.restore()}
 if(glit&&glit.a>.02)for(let i=0;i<9;i++){const w=glit.R*(.5+i*.2)*(.78+.22*Math.sin(t*2.6+i*1.7));ctx.fillStyle=css(glit.c,(.42-i*.04)*glit.a);ctx.fillRect(glit.x-w/2,hy+4+i*(6+i*1.5),w,2.2+i*.45)}
 ctx.globalCompositeOperation='source-over';
 const vx=o.vx===undefined?W/2:o.vx,ph=o.phase||0,GP=o.grid;ctx.strokeStyle=css(P.grid,GP?.3+.25*clamp(GP.bright,0,1):.3);ctx.lineWidth=px(1.1);ctx.beginPath();
 for(let i=-80;i<=80;i++){ctx.moveTo(vx,hy);ctx.lineTo(vx+i*170,H)}
 for(let j=0;j<8;j++){const y=hy+(H-hy)*Math.pow((j+ph)/8,2.1);ctx.moveTo(0,y);ctx.lineTo(W,y)}ctx.stroke();
 const rc=mixc(P.grid,[255,255,255],.35);for(let i=0;i<64;i++){const v=.04+.96*hash(i,95),y=hy+(H-hy)*Math.pow(v,1.7),len=18+v*150,x=fr(hash(i,96)+t*.004*(1+v))*(W+len)-len;ctx.fillStyle=css(rc,(.05+.1*hash(i,97))*(.55+.45*Math.sin(t*1.4+i)));ctx.fillRect(x,y,len,px(1))}
 g=ctx.createLinearGradient(0,hy,0,hy+(H-hy)*.5);g.addColorStop(0,css(P.f[0],.7));g.addColorStop(1,css(P.f[0],0));ctx.fillStyle=g;ctx.fillRect(0,hy,W,(H-hy)*.5);
 // after the fog, which would otherwise hide the bands for most of their roll
 if(GP)gridPulse(ctx,GP,W,H,hy,vx,px,P.grid);
 ctx.globalAlpha=.16;ctx.fillStyle=rim;ctx.fillRect(0,hy-3,W,6);ctx.globalAlpha=.9;ctx.fillRect(0,hy-px(.8),W,px(1.6));ctx.globalAlpha=1;
 if(o.grain!==false)grain(ctx,W*sc,H*sc);
 return{sun:sp,x:sx,y:sy,P}}

const peaks = TER.pano.peaks;
const peaksOf = (n: string) => TER[n].peaks;
export { sun, when, pal, css, spec, hash, peaks, peaksOf };
