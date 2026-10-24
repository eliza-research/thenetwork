// Loopback-only design studio. Sample states never call the member API.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITES, buildSite } from '../../sites/sites.ts';
import { defaultApps } from '../../packages/mcp/src/apps.ts';
const root = join(import.meta.dir, '../..');
let revision = 0;
const port = 5190;
const origin = `http://127.0.0.1:${port}`;
const pattern = /<(h[1-3]|p|a|button|label|summary|dt)(\s[^<>]*?)?>([^<>]+)<\/\1>/g;
const escape = (s: string) => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
for (const site of SITES) await buildSite(site, join(root,'sites',site.domain,'dist'));
Bun.serve({ hostname:'127.0.0.1',port,async fetch(req) {
 const u = new URL(req.url);
 if (req.headers.get('host') !== `127.0.0.1:${port}`) return new Response('Invalid host',{status:403});
 if (u.pathname === '/') return new Response(Bun.file(join(import.meta.dir,'index.html')));
 if (u.pathname === '/asset/fonts/host-grotesk.woff2') return new Response(Bun.file(join(root,'sites/shared/fonts/host-grotesk.woff2')));
 if (u.pathname === '/theme') {
  const cssFile=join(root,'sites/shared/member.css');
  if(req.method==='GET') return Response.json({css:readFileSync(cssFile,'utf8')});
  if(req.method!=='POST'||req.headers.get('origin')!==origin||req.headers.get('content-type')!=='application/json') return new Response('Forbidden',{status:403});
  const values=await req.json() as Record<string,number>;
  const limits:Record<string,[number,number]>={width:[320,760],radius:[0,24],heading:[24,48]};
  for(const [key,[min,max]] of Object.entries(limits)) if(!Number.isFinite(values[key])||values[key]!<min||values[key]!>max)return new Response('Invalid value',{status:400});
  const css=readFileSync(cssFile,'utf8').replace(/\n\/\* Studio tokens \*\/\n\.member-pages\{[^}]*\}\n?/,'');
  writeFileSync(cssFile,css+'\n/* Studio tokens */\n.member-pages{--member-width:'+values.width+'px;--member-radius:'+values.radius+'px;--member-heading:'+values.heading+'px}\n');
  return Response.json({ok:true});
 }
 const site = SITES.find(s=>s.app===u.searchParams.get('app'));
 const page = u.searchParams.get('page') ?? 'join';
 if (!site || !['join','privacy','terms','404','oauth-phone','oauth-code','oauth-connections'].includes(page)) return new Response('Not found',{status:404});
 const file = page.startsWith('oauth-') ? join(root,'packages/mcp/src/pages.ts') : join(site.src,page+'.html');
 if (u.pathname === '/save') {
  if (req.method!=='POST' || req.headers.get('origin')!==origin || req.headers.get('content-type')!=='application/json') return new Response('Forbidden',{status:403});
  if (!existsSync(file)) return new Response('Edit OAuth in its shared source file.',{status:400});
  const body = await req.json() as {source:string; edits:Record<string,string>};
  const source = readFileSync(file,'utf8');
  if (source!==body.source) return new Response('Source changed. Reload before saving.',{status:409});
  let i=0;
  const updated = source.replace(pattern,(whole,tag,attrs)=>{
   const value=body.edits[String(i++)];
   const safe = typeof value==='string' ? escape(value).replaceAll('`','&#96;').replaceAll('${','&#36;{') : '';
   return typeof value==='string' ? `<${tag}${attrs??''}>${safe}</${tag}>` : whole;
  });
  writeFileSync(file,updated);
  revision++;
  await buildSite(site, join(root,'sites',site.domain,'dist'));
  return Response.json({ok:true});
 }
 if(u.pathname==='/source') return Response.json({source:existsSync(file)?readFileSync(file,'utf8'):null});
 if(u.pathname==='/screen') {
  let html:string;
  if(page.startsWith('oauth-')) {
   const {phonePage,codePage,consentsPage}=await import('../../packages/mcp/src/pages.ts?revision='+revision);
   const app=defaultApps()[site.app];
   const response=page==='oauth-phone'?phonePage(app,'preview'):page==='oauth-code'?codePage(app,'preview','0123'):consentsPage(app,[],String);
   html=await response.text();
   const source=readFileSync(file,'utf8');
   const renderer={'oauth-phone':'phonePage','oauth-code':'codePage','oauth-connections':'consentsPage'}[page];
   const start=source.indexOf('export function '+renderer);
   const next=source.indexOf('export function ',start+1);
   const end=next<0?source.length:next;
   const matches=[...source.matchAll(pattern)];
   html=html.replace(pattern,(whole,tag,attrs,text)=>{
    const index=matches.findIndex(m=>m.index!>=start&&m.index!<end&&m[1]===tag&&m[3]===text);
    return index<0?whole:`<${tag}${attrs??''} data-edit="${index}">${text}</${tag}>`;
   });
  } else {
   if(!existsSync(file)) return new Response('Not found',{status:404});
   let i=0;
   html=readFileSync(file,'utf8').replace(pattern,(_whole,tag,attrs,text)=>`<${tag}${attrs??''} data-edit="${i++}">${text}</${tag}>`);
   html=html.replace(/<script[\s\S]*?<\/script>/g,'').replaceAll('{{TURNSTILE_SITE_KEY}}','').replaceAll('./styles.css',`/asset/styles.css?app=${site.app}&page=join`).replaceAll('../../shared/member.css',`/asset/member.css?app=${site.app}&page=join`);
  }
  const requestedState=u.searchParams.get('state')??'phone';
  const state=['phone','phone-error','code','code-error','profile','done','member','invite','blocked','loading','default'].includes(requestedState)?requestedState:'phone';
  const injection=`<script>
  const desired=${JSON.stringify(state)};
  document.querySelectorAll('[data-step]').forEach(e=>e.hidden=e.dataset.step!==(desired.endsWith('-error')?desired.replace('-error',''):desired));
  if(desired.endsWith('-error')){const error=document.querySelector('[data-step="'+desired.replace('-error','')+'"] [data-error]');if(error){error.hidden=false;error.textContent=desired==='code-error'?'That code did not work. Try again.':'Enter a valid mobile number.'}}
  const slots={phoneShown:'(•••) •••-0123',phoneMasked:'(•••) •••-0123',firstName:'Alex',joinedAt:'October 19, 2026',state:'Active',blockedReason:'You must be 13 or older to join.',goneText:'Your data for this app is deleted.'};
  document.querySelectorAll('[data-slot]').forEach(e=>{if(slots[e.dataset.slot])e.textContent=slots[e.dataset.slot]});
  document.querySelectorAll('[data-when]').forEach(e=>e.hidden=['no-membership','paused','has-quiet','stopped'].includes(e.dataset.when));
  document.querySelectorAll('[name=firstName]').forEach(e=>e.value='Alex');document.querySelectorAll('[name=age]').forEach(e=>e.value='28');
  document.addEventListener('submit',e=>{e.preventDefault();parent.postMessage({type:'notice',text:'Design sample only. Use the runtime to test verification.'},location.origin)});
  document.addEventListener('click',e=>{const node=e.target.closest('[data-edit]');if(node){e.preventDefault();parent.postMessage({type:'select',id:node.dataset.edit,text:node.textContent},location.origin)}else if(e.target.closest('a,button'))e.preventDefault()});
  window.addEventListener('message',e=>{if(e.origin!==location.origin)return;if(e.data.type==='edit'){const el=document.querySelector('[data-edit="'+e.data.id+'"]');if(el)el.textContent=e.data.text}});
  </script><style>[data-edit]:hover{outline:1px dashed #888;outline-offset:3px;cursor:text}</style>`;
  return new Response(html.replace('</body>',injection+'</body>'),{headers:{'content-type':'text/html','cache-control':'no-store'}});
 }
 if(u.pathname.startsWith('/asset/')) {
  const name=u.pathname.split('/').pop()!;
  const assets:Record<string,string>={'styles.css':join(site.src,'styles.css'),'member.css':join(root,'sites/shared/member.css'),'host-grotesk.woff2':join(root,'sites/shared/fonts/host-grotesk.woff2')};
  if(assets[name])return new Response(Bun.file(assets[name]));
 }
 return new Response('Not found',{status:404});
}});
console.log(`Member flow design studio: ${origin}`);
