const core = await import(process.env.CORE_URL);
import { readFileSync, writeFileSync } from "node:fs";
import { mulberry32 } from "./rng.mjs";
const o=JSON.parse(readFileSync("fast_fixed.json"));
const dw=0.0005;
const q=(r,t)=>[Math.round(r[t].maxDev/0.1), r.N1+r.N2, r.L];
const cmp=t=>(a,b)=>{const x=q(a,t),y=q(b,t);for(let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]-y[i];return 0;};
const picks=[];
for(const [k,c] of Object.entries(o.cases)){
  for(const [mode,t] of [["편차최소(±1 Oe 허용)","bestNO"],["중심설계(±0.25 Oe)","bestC"]]){
    const L=c.res.filter(r=>r[t]).sort(cmp(t)); c[t+"_sorted"]=L.slice(0,20).map(r=>({...r, sel:r[t]}));
    const r=L[0]; picks.push({case:k,mode,tag:t,r,Rb2:c.Rb,W2:c.W,m2:c.m2});
  }
}
for(const [k,l1,n2,l2] of [["B",24,1,20]]){const c=o.cases[k]; const r=c.res.find(r=>r.l1===l1&&r.n2===n2&&r.l2===l2&&r.dir===1&&r.bestNO); if(r) picks.push({case:k,mode:"대안: 코일2 1층 꽉 채움(20턴)",tag:"bestNO",r,Rb2:c.Rb,W2:c.W,m2:c.m2});}
const mkS=(p,dR1=0,dR2=0,dd=0)=>{const r=p.r,b=r[p.tag]; const d=(b.d+dd)/1000;
  return {I:1,dw,d,xa:0,xb:d,h1:25,h2:10,
   c1:{R:r.R1/1000+dR1,m:40,n:5,last:r.l1,dw,xc:0,dir:1},
   c2:{R:r.R2/1000+dR2,m:p.m2,n:r.n2,last:r.l2,dw,xc:d,dir:r.dir}};};
const rng=mulberry32(20260917); const gauss=()=>{let u=0,v=0;while(!u)u=rng();v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
const sR=0.5/3/1000, sD=0.5/3;
for(const p of picks){
  const E=core.evaluate(mkS(p),61);
  p.exact={h1solo:E.h1solo,hAt0:E.hAt0,hAtD:E.hAtD,maxDev:E.maxDev,rmsDev:E.rmsDev,normRms:E.normRmsDev,nonlin:E.nonlin,L1:E.L1,L2:E.L2,R1o:E.R1o,R2o:E.R2o,Rtot:E.Rtot,P:E.P,V:E.V,N1:E.N1,N2:E.N2,infl:E.infl};
  p.curve=E.wx.map((x,i)=>[x*1000,E.wm[i],E.wt[i]]);
  const md=[]; let pass=0; const NMC=2000;
  for(let s=0;s<NMC;s++){const e=core.evaluate(mkS(p,gauss()*sR,gauss()*sR,gauss()*sD),61); md.push(e.maxDev);
    if(Math.abs(e.h1solo-25)<=1&&Math.abs(e.hAt0-25)<=1&&Math.abs(e.hAtD-10)<=1) pass++;}
  md.sort((a,b)=>a-b); p.mc={n:NMC,passRate:pass/NMC,p50:md[NMC/2],p95:md[Math.floor(NMC*0.95)]};
  console.log(p.case,p.mode,JSON.stringify({l1:p.r.l1,n2:p.r.n2,l2:p.r.l2,d:p.r[p.tag].d,dir:p.r.dir}),JSON.stringify(p.exact,(k,v)=>typeof v==='number'?+v.toFixed(4):v),JSON.stringify(p.mc));
  delete p.r.best; 
}
writeFileSync("final_fixed.json",JSON.stringify({coil1:o.coil1,picks,cases:Object.fromEntries(Object.entries(o.cases).map(([k,c])=>[k,{Rb:c.Rb,W:c.W,m2:c.m2,nFeasCombos:c.res.length,top_min:c.bestNO_sorted,top_center:c.bestC_sorted,all:c.res.map(r=>({l1:r.l1,N1:r.N1,n2:r.n2,l2:r.l2,N2:r.N2,dir:r.dir,nf:r.nf,dmin:r.dmin,dmax:r.dmax,b:r.bestNO,c:r.bestC}))}]))}));
