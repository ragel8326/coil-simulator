const core = await import(process.env.CORE_URL);
import { writeFileSync } from "node:fs";
const { coilTurns, H_pack, OE, wireLength, resistance } = core;
const dwmm=0.5, dw=dwmm/1000, TOL=1, NW=61, G=0.02; // grid mm
const XMAX=150, NG=Math.round(XMAX/G)+1;
const m1=40, Rb1=45, W1=20;
const coil1=[]; for(let l=20;l<=35;l++){ const c={R:(Rb1+5*dwmm/2)/1000,m:m1,n:5,last:l,dw,xc:0,dir:1}; const T=coilTurns(c);
  const prof=new Float64Array(NG); for(let i=0;i<NG;i++) prof[i]=H_pack(i*G/1000,T,1,1)/OE; // symmetric, |x|
  const L=wireLength(T); coil1.push({n1:5,l1:l,N1:T.N,R1:c.R*1000,prof,h1solo:prof[0],L,Ro:resistance(L,dw)}); }
const interp=(p,x)=>{ x=Math.abs(x)/G; const i=Math.floor(x); if(i>=NG-1) return p[NG-1]; const f=x-i; return p[i]*(1-f)+p[i+1]*f; };
const out={coil1:coil1.map(({prof,...r})=>r),cases:{}};
for (const cs of [{key:"A",Rb:22,W:10},{key:"B",Rb:35,W:10}]){
  const m2=Math.round(cs.W/dwmm); const res=[];
  for(let n2=1;n2<=10;n2++) for(let l2=1;l2<=m2;l2++){
    const c={R:(cs.Rb+n2*dwmm/2)/1000,m:m2,n:n2,last:l2,dw,xc:0,dir:1}; const T=coilTurns(c);
    const prof=new Float64Array(NG); for(let i=0;i<NG;i++) prof[i]=H_pack(i*G/1000,T,1,1)/OE;
    const L2=wireLength(T), Ro2=resistance(L2,dw);
    for(const c1 of coil1) for(const dir of [1,-1]){
      let best=null, bestNO=null, bestM=null, bestC=null, nf=0, dmin=null, dmax=null;
      for(let k=50;k<=1500;k++){ const d=k/10;
        const h0=c1.prof[0]+dir*interp(prof,d), hd=interp(c1.prof,d)+dir*prof[0];
        if(Math.abs(h0-25)>TOL||Math.abs(hd-10)>TOL) continue;
        nf++; if(dmin===null) dmin=d; dmax=d;
        const drop=15; let mx=0,ss=0;
        for(let i=0;i<NW;i++){ const u=i/(NW-1), x=d*u; const h=interp(c1.prof,x)+dir*interp(prof,x-d); const e=h-(25+(10-25)*u); if(Math.abs(e)>mx) mx=Math.abs(e); ss+=e*e; }
        const r={d,h0,hd,maxDev:mx,rms:Math.sqrt(ss/NW),nrms:Math.sqrt(ss/NW)/drop,overlap:d<(W1+cs.W)/2};
        if(!best||r.nrms<best.nrms) best=r; if(!r.overlap&&(!bestNO||r.nrms<bestNO.nrms)) bestNO=r;
        if(!r.overlap&&Math.abs(h0-25)<=0.5&&Math.abs(hd-10)<=0.5&&(!bestM||r.nrms<bestM.nrms)) bestM=r;
        if(!r.overlap&&Math.abs(c1.h1solo-25)<=0.25&&Math.abs(h0-25)<=0.25&&Math.abs(hd-10)<=0.25&&(!bestC||r.nrms<bestC.nrms)) bestC=r;
      }
      if(nf) res.push({n1:5,l1:c1.l1,N1:c1.N1,R1:c1.R1,h1solo:c1.h1solo,n2,l2,N2:T.N,R2:c.R*1000,outer2:cs.Rb+n2*dwmm,dir,nf,dmin,dmax,best,bestNO,bestM,bestC,L:c1.L+L2,Rtot:c1.Ro+Ro2});
    }
  }
  out.cases[cs.key]={...cs,m2,res};
  console.log(cs.key, res.length);
}
writeFileSync("fast_fixed.json",JSON.stringify(out));
