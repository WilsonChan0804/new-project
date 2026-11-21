const { chromium } = require('playwright'); const fs=require('fs'); const path=require('path');
(async()=>{
 const src=JSON.parse(fs.readFileSync('src.json')); const out=process.argv[2]; fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch(); const p=await b.newPage();
 await p.setContent('<html><body></body></html>'); await p.addScriptTag({path:'node_modules/mermaid/dist/mermaid.min.js'});
 await p.evaluate(()=>mermaid.initialize({startOnLoad:false,theme:'base',htmlLabels:false,flowchart:{htmlLabels:false,curve:'basis',padding:12},
  themeVariables:{fontFamily:'-apple-system,Segoe UI,Roboto,Helvetica,Arial,PingFang TC,Microsoft JhengHei,Noto Sans CJK TC,sans-serif',fontSize:'14px',
  primaryColor:'#FFF1E6',primaryBorderColor:'#F08020',primaryTextColor:'#3B2A1F',lineColor:'#B34A22',secondaryColor:'#FDE3CC',tertiaryColor:'#FFFFFF',clusterBkg:'#FFF8F1',clusterBorder:'#E8B890',edgeLabelBackground:'#FFFFFF'}}));
 for (const [k,v] of Object.entries(src)) { try { const svg=await p.evaluate(async([k,v])=>(await mermaid.render('d'+k.replace(/\W/g,''),v)).svg,[k,v]); fs.writeFileSync(path.join(out,k+'.svg'),svg); console.log('ok',k);} catch(e){console.log('ERR',k,String(e).slice(0,200));} }
 await b.close();})();
