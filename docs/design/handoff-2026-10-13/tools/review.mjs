import fs from 'fs'; import { Resvg } from '@resvg/resvg-js';
new Function(fs.readFileSync('out/bundle.js','utf8'))(); const V=globalThis.VibeTribe;
const F = { fontFiles: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'], loadSystemFonts:false, defaultFontFamily:'DejaVu Sans' };
const bbox = frag => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${frag}</svg>`,{font:F}).getBBox();
function elems(svg){ // texts and glyph groups
  const out=[];
  for (const m of svg.matchAll(/<text [^>]*>[^<]*<\/text>/g)) out.push({id:/id="([^"]+)"/.exec(m[0])[1], frag:m[0]});
  for (const m of svg.matchAll(/<g id="(vt-[a-z-]*glyph[^"]*|vt-ahead|vt-calm|vt-top-glyph|vt-bg-glyph)"/g)) {
    let i=m.index, depth=0, re=/<g[ >]|<\/g>/g; re.lastIndex=i; let t;
    while ((t=re.exec(svg))) { depth += t[0]==='</g>'?-1:1; if (!depth) { out.push({id:m[1], frag:svg.slice(i, t.index+4)}); break; } }
  }
  for (const m of svg.matchAll(/<rect id="vt-overflow-pill"[^>]*\/>/g)) out.push({id:'vt-overflow-pill', frag:m[0]});
  return out.map(e=>({...e,b:bbox(e.frag)})).filter(e=>e.b);
}
const issues=[];
function check(name, m){ for (const variant of ['dicht','luftig']) check1(name+' ['+variant+']', m, variant); }
function check1(name, m, variant){
  const svg=V.render(m,{variant}); const es=elems(svg);
  for (const e of es){ const b=e.b; if (b.x<9.5||b.y<9.5||b.x+b.width>134.5||b.y+b.height>134.5) issues.push(`${name}: ${e.id} out of safe area`); }
  for (let i=0;i<es.length;i++) for (let j=i+1;j<es.length;j++){
    const a=es[i].b,b=es[j].b; if (es[i].id==='vt-overflow' && es[j].id==='vt-overflow-pill' || es[j].id==='vt-overflow' && es[i].id==='vt-overflow-pill') continue;
    const gap=2; if (a.x<b.x+b.width-gap && b.x<a.x+a.width-gap && a.y<b.y+b.height-gap && b.y<a.y+a.height-gap) issues.push(`${name}: ${es[i].id} overlaps ${es[j].id}`);
  }
}
const titles=['Mobile Entwicklung Northwind','A','','vibetribe-streamdeck-plugin','Überprüfung Änderungsprotokoll','WWWWWWWWWWWWWWWWWWWW','日本語のプロジェクト','a/b/c/d/e/f/g/h/i/j/k/l','x'.repeat(60),'🚀🚀🚀'];
const states=Object.keys(V.states); const badges=['APP','WIN','WSL','REM','MAC','?','LINUX'];
let n=0;
for (const t of titles) for (const s of states) for (const bd of badges) for (const extra of [{}, {bgCount:12}, {bgStale:true}, {wait:59}, {wait:3599}, {wait:35999}, {wait:360000}, {detail:'Kompaktiert'}, {detail:'server_error', wait:700}, {jumping:true}]) { check(`slot ${s} "${t.slice(0,12)}" ${bd} ${JSON.stringify(extra)}`, {kind:'slot',state:s,title:t,badge:bd,frame:'thick',...extra}); n++; }
for (const w of [0,1,9,12,123]) for (const ov of [0,3,12,123]) for (const cyc of [null,{index:9,total:12},{index:12,total:123}]) for (const tw of [null,42,40000]) { check(`inbox w${w} ov${ov} cyc${JSON.stringify(cyc)}`, {kind:'inbox',waiting:w,overflow:ov,cycle:cyc,top:w?{title:'Mobile Entwicklung Northwind',state:'needs_permission',wait:tw}:null}); n++; }
for (const u of [null,0,5,99.6,100,140,-5]) for (const lab of ['5h','Woche']) for (const ah of [true,false]) { check(`limit ${lab} ${u} ahead${ah}`, {kind:'limit',label:lab,usedPct:u,pacePct:120,resetIn:'23T 23h',level:'red',ahead:ah}); n++; }
for (const used of ['0,00 €','12.345,67 €','123.456,78 €','1.234.567,89 €']) for (const r of [0,0.5,1.3,null]) { check(`extra ${used} ${r}`, {kind:'extra',used,limit:'100.000,00 €',ratio:r,level:'red'}); n++; }
check('status 6 rows + long alert', {kind:'status',alert:'Verbindung verloren',rows:['WIN','WSL','REM','LIM','X','Y'].map(s=>({source:s,health:'missing'}))});
check('status expanded', {kind:'status',expanded:true,alert:'Port in use',rows:['WIN','WSL','REM','LIM'].map(s=>({source:s,health:'missing'}))});
check('status unknown health', {kind:'status',rows:[{source:'WIN',health:'weird'}]});
console.log('cases', n); const uniq=[...new Set(issues.map(i=>i.replace(/ ".*?"| \{.*\}| (APP|WIN|WSL|REM|MAC|\?|LINUX)\b/g,'')))];
console.log('issues', issues.length); const cat={}; for (const i of issues){ const k=i.replace(/^(\w+).*?(\[\w+\]): /,"$1 $2: ").replace(/\d+/g,"#"); cat[k]=(cat[k]||0)+1;} console.log(Object.entries(cat).sort((a,b)=>b[1]-a[1]).map(e=>e[1]+"  "+e[0]).join("\n"));
