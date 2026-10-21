/**
 * Public widget routes — no authentication required.
 *
 * GET  /widget.js                     — serves the compiled embed widget script
 * GET  /widget-test/:channelId        — browser-loadable test page for a channel
 * POST /public/chat/:channelId        — SSE streaming chat (creates DB conversation)
 * GET  /public/chat/:channelId/:conversationId/replies — a person's replies once they have the chat
 * POST /public/csat/:channelId        — submit CSAT rating for a conversation
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '@ybot/db'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { proposeDraftFlows, textMightStartDraft } from '../lib/draft-flows.js'
import { ANSWER_FAILED, runTurn, withPerson } from '../lib/turn-pipeline.js'
import { openEventStream } from '../lib/event-stream.js'
import { isHeld } from '../lib/handover.js'
import { triggerRules } from '../lib/automation-engine.js'
import { appBuildLabel, BELLA_PUBLIC_CHANNEL, resolveDemoChannel } from '../lib/demo-page.js'
import { visitorTurn } from '../lib/widget-open.js'
import { loadPublicChannel } from '../lib/web-channels.js'
import { streamDoneEvent, webChoices } from '../lib/widget-rating.js'
import { withLlmScope } from '../lib/llm-ledger.js'
import { noteRunChat, runForChat, TEST_RUN_HEADER } from '../lib/test-runs.js'
import { firstDelivery } from '../lib/inbound-dedupe.js'
import { fileURLToPath } from 'node:url'

/** Derive the public-facing origin robustly when running behind a reverse proxy.
 *  With trustProxy:true Fastify already sets request.protocol from X-Forwarded-Proto,
 *  but we also read the forwarded headers explicitly as belt-and-suspenders. */
function requestOrigin(request: FastifyRequest): string {
  const proto =
    (request.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ??
    request.protocol ??
    'https'
  const host =
    (request.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ??
    request.hostname
  return `${proto}://${host}`
}

// ── CORS helper — applied to every public route ────────────────────────────
function setCors(reply: { header(k: string, v: string): void }) {
  reply.header('Access-Control-Allow-Origin',  '*')
  reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  reply.header('Access-Control-Allow-Headers', 'Content-Type')
}

// ── Widget JS source (served if compiled bundle is absent) ─────────────────
const WIDGET_INLINE_JS = /* js */`
(function(){
  var script=document.currentScript||document.querySelector('script[src*="widget.js"]');
  var channelId='';
  if(script){try{var u=new URL(script.src);channelId=u.searchParams.get('id')||u.searchParams.get('channelId')||'';}catch(e){}}
  if(!channelId)channelId=window.YBotChannelId||'';
  if(!channelId){console.warn('[BotStudio widget] No channelId');return;}
  var API_BASE='/api/v1';
  if(script){try{var u=new URL(script.src);API_BASE=u.protocol+'//'+u.host+'/api/v1';}catch(e){}}
  var ACCENT=window.YBotAccentColor||'#6366f1';
  var TITLE=window.YBotTitle||'Chat with us';
  var conversationId=null;
  var sessionId='ws_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  var open=false,messages=[],loading=false;
  var csatState=null,liveTimer=null,watchGen=0,seenReplies={};
  function css(el,s){Object.assign(el.style,s);}
  function mk(tag,a){var n=document.createElement(tag);for(var k in a)n.setAttribute(k,a[k]);return n;}
  var HOSTS={'phorest.com':'Phorest','fresha.com':'Fresha','booksy.com':'Booksy','calendly.com':'Calendly','setmore.com':'Setmore','simplybook.me':'SimplyBook','vagaro.com':'Vagaro','squareup.com':'Square','square.site':'Square'};
  function hostLabel(url){try{var host=new URL(url).hostname.replace(/^www\\./,'').toLowerCase();for(var k in HOSTS){if(host===k||host.slice(-(k.length+1))==='.'+k)return HOSTS[k];}}catch(e){}return '';}
  function fillChat(node,text){
    node.textContent='';
    var ph=[],next=String(text||'').replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g,function(full){ph.push(full);return '\\u0000'+(ph.length-1)+'\\u0000';});
    next=next.replace(/\\bBook on ([A-Za-z][\\w .'-]*):\\s*(https?:\\/\\/[^\\s]+)/gi,function(_a,label,url){return '['+String(label).trim()+']('+url+')';});
    next=next.replace(/https?:\\/\\/[^\\s<>]+/g,function(url){var cleaned=url.replace(/[),.;]+$/,'');var label=hostLabel(cleaned);return label?'['+label+']('+cleaned+')':url;});
    next=next.replace(/\\u0000(\\d+)\\u0000/g,function(_a,i){return ph[Number(i)]||'';});
    var re=/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g,last=0,m;
    while((m=re.exec(next))){
      if(m.index>last)node.appendChild(document.createTextNode(next.slice(last,m.index)));
      var a=mk('a',{href:m[2],target:'_blank',rel:'noopener noreferrer'});a.textContent=m[1];css(a,{color:'inherit',textDecoration:'underline'});node.appendChild(a);
      last=m.index+m[0].length;
    }
    if(last<next.length)node.appendChild(document.createTextNode(next.slice(last)));
  }
  var root=mk('div');css(root,{position:'fixed',bottom:'24px',right:'24px',zIndex:'2147483647',fontFamily:'system-ui,sans-serif'});
  var bubble=mk('button');css(bubble,{width:'56px',height:'56px',borderRadius:'50%',border:'none',cursor:'pointer',background:ACCENT,color:'#fff',boxShadow:'0 4px 20px rgba(0,0,0,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'24px',transition:'transform .2s'});
  bubble.innerHTML='&#128172;';bubble.title=TITLE;
  bubble.onmouseenter=function(){bubble.style.transform='scale(1.1)'};
  bubble.onmouseleave=function(){bubble.style.transform='scale(1)'};
  var panel=mk('div');css(panel,{position:'absolute',bottom:'72px',right:'0',width:'360px',height:'540px',background:'#fff',borderRadius:'16px',boxShadow:'0 12px 48px rgba(0,0,0,.18)',display:'none',flexDirection:'column',overflow:'hidden'});
  var hdr=mk('div');css(hdr,{background:ACCENT,color:'#fff',padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:'0'});
  var hTitle=mk('span');hTitle.textContent=TITLE;css(hTitle,{fontWeight:'600',fontSize:'15px'});
  var closeB=mk('button');closeB.innerHTML='&times;';css(closeB,{background:'none',border:'none',color:'#fff',cursor:'pointer',fontSize:'18px',padding:'2px 6px'});
  closeB.onclick=function(){toggle(false);};hdr.append(hTitle,closeB);
  var msgArea=mk('div');css(msgArea,{flex:'1',overflowY:'auto',padding:'12px',display:'flex',flexDirection:'column',gap:'8px'});
  var inputRow=mk('div');css(inputRow,{padding:'10px 12px',borderTop:'1px solid #f0f0f0',display:'flex',gap:'8px',flexShrink:'0'});
  var ta=mk('textarea');ta.placeholder='Type a message\u2026';ta.rows=1;css(ta,{flex:'1',resize:'none',border:'1px solid #e5e7eb',borderRadius:'8px',padding:'8px 12px',fontSize:'14px',fontFamily:'inherit',outline:'none',lineHeight:'1.4'});
  var sendB=mk('button');sendB.textContent='\u2191';css(sendB,{background:ACCENT,color:'#fff',border:'none',borderRadius:'8px',width:'36px',height:'36px',cursor:'pointer',fontSize:'18px',fontWeight:'bold',flexShrink:'0',alignSelf:'flex-end'});
  inputRow.append(ta,sendB);panel.append(hdr,msgArea,inputRow);root.append(panel,bubble);document.body.appendChild(root);
  function renderCsatCard(){
    if(csatState===null)return;
    var card=mk('div');css(card,{margin:'8px 0 4px',padding:'12px 14px',background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:'12px',textAlign:'center'});
    if(csatState==='pending'){
      var lbl=mk('p');lbl.textContent='Was this conversation helpful?';css(lbl,{margin:'0 0 10px',fontSize:'13px',color:'#374151',fontWeight:'500'});
      var btns=mk('div');css(btns,{display:'flex',gap:'8px',justifyContent:'center'});
      var up=mk('button');up.innerHTML='\uD83D\uDC4D Yes';
      var dn=mk('button');dn.innerHTML='\uD83D\uDC4E No';
      [up,dn].forEach(function(b){css(b,{background:'#fff',border:'1px solid #d1d5db',borderRadius:'8px',padding:'6px 16px',cursor:'pointer',fontSize:'13px',color:'#374151',transition:'background .15s'});});
      up.onmouseover=function(){up.style.background='#dcfce7';};up.onmouseout=function(){up.style.background='#fff';};
      dn.onmouseover=function(){dn.style.background='#fee2e2';};dn.onmouseout=function(){dn.style.background='#fff';};
      up.onclick=function(){submitCsat(1);};dn.onclick=function(){submitCsat(-1);};
      btns.append(up,dn);card.append(lbl,btns);
    } else {
      var thanks=mk('p');
      thanks.textContent=csatState===1?'\uD83D\uDC4D Thanks for the positive feedback!':'\uD83D\uDC4E Thanks for letting us know!';
      css(thanks,{margin:'0',fontSize:'13px',color:'#6b7280'});card.appendChild(thanks);
    }
    msgArea.appendChild(card);
  }
  function render(){
    msgArea.innerHTML='';
    messages.forEach(function(m,idx){
      var row=mk('div');css(row,{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start'});
      var bub=mk('div');css(bub,{maxWidth:'80%',padding:'8px 12px',borderRadius:m.role==='user'?'14px 14px 2px 14px':'14px 14px 14px 2px',background:m.role==='user'?ACCENT:'#f3f4f6',color:m.role==='user'?'#fff':'#111',fontSize:'14px',lineHeight:'1.5',whiteSpace:'pre-wrap',wordBreak:'break-word'});
      fillChat(bub,m.text+(m.streaming?'\u258b':''));
      row.appendChild(bub);msgArea.appendChild(row);
      if(m.replies&&m.replies.length&&idx===messages.length-1&&!m.streaming){
        var chips=mk('div');css(chips,{display:'flex',flexWrap:'wrap',gap:'6px'});
        m.replies.forEach(function(label){var c=mk('button');c.textContent=label;css(c,{background:'#fff',border:'1px solid '+ACCENT,color:ACCENT,borderRadius:'999px',padding:'5px 12px',fontSize:'13px',cursor:'pointer',fontFamily:'inherit'});c.onclick=function(){m.replies=null;postChat(label);};chips.appendChild(c);});
        msgArea.appendChild(chips);
      }
    });
    renderCsatCard();
    msgArea.scrollTop=msgArea.scrollHeight;
  }
  function addMsg(role,text,streaming){messages.push({role:role,text:text,streaming:streaming||false});render();return messages.length-1;}
  function updMsg(i,text,streaming,ended){
    if(messages[i]){messages[i].text=text;messages[i].streaming=streaming||false;}
    if(ended&&messages.filter(function(m){return m.role==='user';}).length>=1&&csatState===null){csatState='pending';}
    render();
  }
  function submitCsat(rating){
    if(!conversationId)return;
    csatState=rating;render();
    fetch(API_BASE+'/public/csat/'+channelId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:conversationId,rating:rating})}).catch(function(){});
  }
  var greeting=false;
  async function postChat(text,opening){
    var hist=messages.slice(-10).map(function(m){return{role:m.role==='user'?'user':'assistant',content:m.text};});
    if(!opening)addMsg('user',text);
    var bi=addMsg('bot','',true);
    var body={sessionId:sessionId,history:hist};
    if(conversationId)body.conversationId=conversationId;
    if(opening)body.opening=true; else {body.message=text;body.messageId=sessionId+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
    var res=await fetch(API_BASE+'/public/chat/'+channelId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!res.ok||!res.body){updMsg(bi,'Sorry, something went wrong. ('+res.status+')');return;}
    var reader=res.body.getReader(),dec=new TextDecoder(),buf='',botText='',live=false;
    while(true){
      var r=await reader.read();if(r.done)break;
      buf+=dec.decode(r.value,{stream:true});
      var lines=buf.split('\\n');buf=lines.pop()||'';
      for(var i=0;i<lines.length;i++){
        var line=lines[i];
        if(line.startsWith('data: ')){try{var d=JSON.parse(line.slice(6));if(d.conversationId)conversationId=d.conversationId;if(d.chunk){botText+=d.chunk;updMsg(bi,botText,true);}if(d.done){live=!!d.live;if(messages[bi])messages[bi].replies=d.replies||null;updMsg(bi,botText,false,!!d.ended);}}catch(e){}}
      }
    }
    if(conversationId)watchReplies(live);
    if(!botText&&live){messages.splice(bi,1);render();}
    else if(!botText)updMsg(bi,"I\\'m sorry, I couldn\\'t generate a response.",false,false);
  }
  async function checkReplies(){
    try{
      var res=await fetch(API_BASE+'/public/chat/'+channelId+'/'+conversationId+'/replies?session='+encodeURIComponent(sessionId));
      if(!res.ok)return false;
      var d=await res.json();
      (d.replies||[]).forEach(function(m){if(seenReplies[m.id])return;seenReplies[m.id]=true;addMsg('bot',m.text);});
      return !!d.live;
    }catch(e){return false;}
  }
  function watchReplies(live){
    var gen=++watchGen;
    if(liveTimer)clearTimeout(liveTimer);
    var tick=async function(){var now=await checkReplies();if(gen!==watchGen)return;liveTimer=setTimeout(tick,now?4000:15000);};
    liveTimer=setTimeout(tick,live?1000:15000);
  }
  async function send(){
    var text=ta.value.trim();if(!text||loading)return;
    ta.value='';
    loading=true;sendB.disabled=true;
    try{await postChat(text,false);}catch(e){updMsg(messages.length-1,"Couldn\\'t reach the server. Please try again.");}
    finally{loading=false;sendB.disabled=false;}
  }
  async function greet(){
    if(greeting||messages.length||loading)return;
    greeting=true;loading=true;sendB.disabled=true;
    try{await postChat('',true);}catch(e){updMsg(messages.length-1,"Couldn\\'t reach the server. Please try again.");}
    finally{loading=false;sendB.disabled=false;}
  }
  function toggle(force){
    open=force!==undefined?force:!open;
    panel.style.display=open?'flex':'none';
    bubble.innerHTML=open?'&times;':'&#128172;';
    if(open){setTimeout(function(){ta.focus();},50);greet();}
  }
  bubble.onclick=function(){toggle();};sendB.onclick=send;
  ta.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
  window.YBotWidget={open:function(){toggle(true);},close:function(){toggle(false);},toggle:function(){toggle();}};
})();`

export async function widgetRoutes(app: FastifyInstance) {

  // Handle OPTIONS preflight for all public/* and widget.js
  app.options('/widget.js', async (_req, reply) => { setCors(reply); return reply.status(204).send() })
  app.options('/public/*', async (_req, reply) => { setCors(reply); return reply.status(204).send() })

  // ── GET /widget.js ─────────────────────────────────────────────────────────
  app.get('/widget.js', async (_request, reply) => {
    setCors(reply)
    reply.header('Content-Type', 'application/javascript; charset=utf-8')
    reply.header('Cache-Control', 'public, max-age=60')

    // Try to serve the pre-built bundle first
    try {
      const __dir = dirname(fileURLToPath(import.meta.url))
      const candidates = [
        resolve(__dir, '../../embed/dist/widget.js'),
        resolve(__dir, '../../../apps/embed/dist/widget.js'),
      ]
      for (const p of candidates) {
        try { return reply.send(await readFile(p, 'utf8')) } catch { /* try next */ }
      }
    } catch { /* fall through */ }

    // Fall back to the inline version
    return reply.send(WIDGET_INLINE_JS)
  })

  // ── GET /widget-test/:channelId — browser test page ────────────────────────
  app.get<{ Params: { channelId: string }; Querystring: { title?: string; color?: string } }>('/widget-test/:channelId', async (request, reply) => {
    const { channelId } = request.params
    const channel = await loadPublicChannel(channelId)
    const botLabel   = channel?.bot?.name ?? 'BotStudio'
    const personaName = channel?.bot?.personaName ?? botLabel
    // Allow wizard/embed overrides via query params
    const titleOverride = request.query.title ? String(request.query.title) : null
    const colorOverride = request.query.color ? String(request.query.color) : null

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${botLabel} — Widget Test</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f8fafc;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;color:#334155}
    .card{background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:480px;width:90%;text-align:center}
    h1{font-size:1.5rem;font-weight:700;margin-bottom:8px}
    p{color:#64748b;font-size:.95rem;line-height:1.6}
    .badge{display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:4px 12px;font-family:monospace;font-size:.8rem;color:#475569;margin-top:16px}
    .arrow{font-size:2rem;position:fixed;bottom:90px;right:30px;animation:bounce .8s infinite alternate}
    @keyframes bounce{from{transform:translateX(0)}to{transform:translateX(8px)}}
  </style>
</head>
<body>
  <div class="card">
    <h1>🤖 ${botLabel}</h1>
    <p>The chat widget is loaded in the bottom-right corner.<br/>Click the 💬 bubble to start a conversation.</p>
    <div class="badge">Channel: ${channelId}</div>
  </div>
  <div class="arrow">👉</div>
  <script>window.YBotTitle='${titleOverride ?? botLabel}';window.YBotBotName='${personaName}';${colorOverride ? `window.YBotAccentColor='${colorOverride}';` : ''}</script>
  <script src="/api/v1/widget.js?id=${channelId}" defer></script>
</body>
</html>`)
  })

  // ── GET /public/demo/:channelId — hosted demo salon page ──────────────────
  app.get<{ Params: { channelId: string } }>('/public/demo/:channelId', async (request, reply) => {
    const { channelId } = request.params
    const origin = requestOrigin(request)
    const requested = await loadPublicChannel(channelId)
    const fallback = requested
      ? null
      : await loadPublicChannel(BELLA_PUBLIC_CHANNEL)
    const active = new Set<string>()
    if (requested) active.add(requested.id)
    if (fallback) active.add(fallback.id)
    const target = resolveDemoChannel(channelId, active)
    if (!target) {
      return reply
        .status(404)
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Demo not available</title></head><body><p>This demo link is no longer available.</p></body></html>')
    }
    if (target.redirect) {
      return reply.header('Cache-Control', 'no-store').redirect(`/api/v1/public/demo/${target.channelId}`)
    }
    const channel = requested
    const personaName = channel?.bot?.personaName ?? channel?.bot?.name ?? ''
    const build = appBuildLabel()

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=60')
      .send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bella Hair Studio — Modern Cuts, Colour &amp; Care</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--accent:#8b5cf6;--ink:#201b2e;--muted:#6b6780;--bg:#faf8ff}
    body{font-family:"Inter",system-ui,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6}
    h1,h2,h3{font-family:"Fraunces",Georgia,serif;font-weight:600;letter-spacing:-.5px}
    .wrap{max-width:1080px;margin:0 auto;padding:0 24px}
    header{display:flex;align-items:center;justify-content:space-between;padding:22px 0;gap:16px}
    .logo{font-family:"Fraunces",serif;font-size:22px;font-weight:600}
    .build{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:var(--muted);white-space:nowrap}
    .logo span{color:var(--accent)}
    nav a{color:var(--muted);text-decoration:none;margin-left:26px;font-size:15px;font-weight:500}
    nav a:hover{color:var(--ink)}
    .hero{display:grid;grid-template-columns:1.1fr 0.9fr;gap:48px;align-items:center;padding:60px 0 80px}
    .hero h1{font-size:56px;line-height:1.05;margin-bottom:20px}
    .hero p{font-size:19px;color:var(--muted);max-width:460px;margin-bottom:30px}
    .btn{display:inline-block;background:var(--accent);color:#fff;padding:14px 26px;border-radius:30px;font-weight:600;text-decoration:none;border:none;cursor:pointer;font-size:16px;transition:transform .15s}
    .btn:hover{transform:translateY(-2px)}
    .hero-img{border-radius:24px;height:380px;background:linear-gradient(135deg,rgba(139,92,246,.9),rgba(236,72,153,.85));display:flex;align-items:center;justify-content:center;color:#fff;font-size:90px;box-shadow:0 30px 60px rgba(139,92,246,.3)}
    .section{padding:60px 0}
    .section h2{font-size:36px;text-align:center;margin-bottom:12px}
    .section .lede{text-align:center;color:var(--muted);max-width:520px;margin:0 auto 44px;font-size:17px}
    .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
    .card{background:#fff;border-radius:18px;padding:28px;box-shadow:0 10px 30px rgba(32,27,46,.06);border:1px solid #f0ecfa}
    .card .emoji{font-size:34px}
    .card h3{font-size:21px;margin:14px 0 8px}
    .card p{color:var(--muted);font-size:15px;margin-bottom:12px}
    .card .price{font-weight:600;color:var(--accent)}
    .cta{background:linear-gradient(135deg,#2a2140,#3a2b5c);color:#fff;border-radius:28px;padding:56px;text-align:center;margin:40px 0}
    .cta h2{color:#fff;font-size:34px;margin-bottom:12px}
    .cta p{color:#d7cff0;margin-bottom:26px;font-size:17px}
    .cta .btn{background:#fff;color:var(--accent)}
    footer{text-align:center;color:var(--muted);padding:40px 0;font-size:14px;border-top:1px solid #eee7f8}
    @media(max-width:800px){.hero{grid-template-columns:1fr;padding:30px 0 50px}.hero h1{font-size:40px}.hero-img{height:240px;font-size:64px}.cards{grid-template-columns:1fr}nav{display:none}}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo">Bella<span>.</span>Hair Studio</div>
      <div style="display:flex;align-items:center;gap:18px">
        <nav>
          <a href="#services">Services</a>
          <a href="#about">About</a>
          <a href="#book" onclick="openChat();return false">Book</a>
        </nav>
        <span class="build" title="${build.title}">${build.short}</span>
      </div>
    </header>
    <section class="hero">
      <div>
        <h1>Where great hair<br/>begins.</h1>
        <p>Expert cuts, rich colour and restorative care from stylists who genuinely listen. Book your chair in under a minute.</p>
        <button class="btn" onclick="openChat()">Book an appointment</button>
      </div>
      <div class="hero-img">&#128135;&#8205;&#9792;&#65039;</div>
    </section>
    <section class="section" id="services">
      <h2>Our services</h2>
      <p class="lede">A full menu of salon services, tailored to you. Not sure what you need? Just ask our receptionist.</p>
      <div class="cards">
        <div class="card"><div class="emoji">&#9986;&#65039;</div><h3>Cuts &amp; Styling</h3><p>Precision cuts, blow-dries and finishing that keeps its shape long after you leave.</p><div class="price">from £35</div></div>
        <div class="card"><div class="emoji">&#127912;</div><h3>Colour &amp; Highlights</h3><p>Full colour, foils, balayage and gloss treatments using gentle, salon-grade products.</p><div class="price">from £70</div></div>
        <div class="card"><div class="emoji">&#128134;</div><h3>Treatments</h3><p>Deep-conditioning, keratin smoothing and scalp care to bring your hair back to life.</p><div class="price">from £45</div></div>
        <div class="card"><div class="emoji">&#127800;</div><h3>Balayage</h3><p>Sun-kissed, natural-looking colour that grows out gracefully with minimal upkeep.</p><div class="price">from £90</div></div>
        <div class="card"><div class="emoji">&#128133;</div><h3>Skin Scrub</h3><p>Revitalising exfoliation and skin treatment to restore your natural glow.</p><div class="price">from £200</div></div>
        <div class="card"><div class="emoji">&#129452;</div><h3>Keratin Smoothing</h3><p>Frizz-free, sleek hair for up to 3 months with professional keratin treatments.</p><div class="price">from £120</div></div>
      </div>
    </section>
    <section class="cta" id="book">
      <h2>Ready for your next look?</h2>
      <p>Chat with our virtual receptionist and lock in a time that suits you.</p>
      <button class="btn" onclick="openChat()">Start booking</button>
    </section>
    <section class="section" id="about">
      <h2>Visit us</h2>
      <p class="lede">Open Mon–Sat, 9am–6pm · 14 Rosewood Lane · Walk-ins welcome when we have space.</p>
    </section>
  </div>
  <footer>© Bella Hair Studio · <span title="${build.title}">${build.short}</span> · Powered by <a href="${origin}" style="color:inherit">BotStudio</a></footer>
  <script>
    window.YBotChannelId='${channelId}';
    window.YBotTitle='Chat with Bella Hair Studio';
    window.YBotAccentColor='#8b5cf6';
    ${personaName ? `window.YBotBotName='${personaName}';` : ''}
    function openChat(){if(window.YBotWidget)window.YBotWidget.open();}
    document.addEventListener('DOMContentLoaded', function(){openChat();});
  </script>
  <script src="/api/v1/widget.js?id=${channelId}" defer></script>
</body>
</html>`)
  })

  // ── POST /public/chat/:channelId — public SSE streaming chat ───────────────
  app.post<{ Params: { channelId: string } }>('/public/chat/:channelId', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    setCors(reply)
    const { channelId } = request.params
    const body = request.body as {
      message?: string
      opening?: boolean
      sessionId?: string
      conversationId?: string
      visitorName?: string
      /** Set by the widget per message so a resent request is handled once. */
      messageId?: string
      history?: Array<{ role: string; content: string }>
    }
    const visitor = visitorTurn({ message: body.message, opening: body.opening === true })
    if (!visitor) return reply.status(400).send({ error: 'message required' })
    const userText = visitor.text

    const channel = await loadPublicChannel(channelId)
    if (!channel?.bot) return reply.status(404).send({ error: 'Channel not found' })

    // ── Domain allowlist check ─────────────────────────────────────────────
    if (channel.allowedDomains.length > 0) {
      const origin = (request.headers['origin'] as string | undefined) ?? ''
      const hostname = (() => { try { return new URL(origin).hostname } catch { return '' } })()
      const allowed = channel.allowedDomains.some((d) =>
        hostname === d || hostname.endsWith(`.${d}`)
      )
      if (!allowed) {
        return reply.status(403).send({ error: { code: 'DOMAIN_NOT_ALLOWED', message: 'This domain is not authorised to use this widget' } })
      }
    }

    const { tenantId, botId } = { tenantId: channel.tenantId, botId: channel.botId }

    const messageId = typeof body.messageId === 'string' ? body.messageId.slice(0, 120) : undefined
    if (visitor.showVisitor && !(await firstDelivery(channelId, messageId))) {
      const stream = openEventStream(reply, { 'Access-Control-Allow-Origin': '*' })
      if (body.conversationId) stream.send({ conversationId: body.conversationId })
      stream.send({ duplicate: true })
      stream.send(streamDoneEvent(false))
      stream.end()
      return
    }

    // ── Resolve or create a conversation ──────────────────────────────────
    let conversationId = body.conversationId ?? null
    if (conversationId) {
      // Verify it belongs to this channel
      const exists = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId, channelId } })
      if (!exists) conversationId = null
    }

    if (!conversationId) {
      const testRunId = await runForChat(request.headers[TEST_RUN_HEADER], botId)
      const env = channel.environmentId
        ? await prisma.environment.findFirst({ where: { id: channel.environmentId, botId } })
        : await prisma.environment.findFirst({ where: { botId }, orderBy: { createdAt: 'asc' } })
      if (env) {
        // Upsert an anonymous contact keyed by sessionId
        const sessionId = body.sessionId ?? `anon_${Date.now()}`
        let contact = await prisma.contact.findFirst({ where: { tenantId, externalId: sessionId } })
        if (!contact) {
          contact = await prisma.contact.create({
            data: { tenantId, externalId: sessionId, displayName: 'Visitor', channelId },
          })
        }
        const open = await prisma.conversation.findFirst({
          where: { tenantId, channelId, contactId: contact.id, status: 'active', ...(testRunId ? { testRunId } : {}) },
          orderBy: { updatedAt: 'desc' },
        })
        if (open) {
          conversationId = open.id
        } else {
          const convo = await prisma.conversation.create({
            data: { tenantId, botId, environmentId: env.id, channelId, contactId: contact.id, status: 'active', testRunId: testRunId ?? null },
          })
          conversationId = convo.id
        }
        if (testRunId && conversationId) noteRunChat(testRunId, conversationId)
      }
    }

    if (textMightStartDraft(userText)) {
      void withLlmScope({ source: 'authoring', tenantId, botId }, () => proposeDraftFlows(botId)).catch(() => {})
    }

    const stream = openEventStream(reply, { 'Access-Control-Allow-Origin': '*' })
    const send = (data: object) => stream.send(data)

    try {
      if (!conversationId) {
        send({ chunk: 'This chat is not set up yet. Please try again later.' })
        send(streamDoneEvent(false))
        return
      }

      // Emit conversationId first so client can persist it
      send({ conversationId })
      const turn = await runTurn({
        conversationId,
        tenantId,
        botId,
        text: userText,
        opening: !visitor.showVisitor,
        onChunk: (chunk) => send({ chunk }),
      })
      const choices = webChoices(turn.ended || withPerson(turn) ? undefined : turn.choices)
      if (choices.extra) send({ chunk: choices.extra })
      send(streamDoneEvent(turn.ended, withPerson(turn), choices.replies))
    } catch (err) {
      request.log.error({ err, conversationId, channelId }, 'widget turn failed')
      send({ chunk: ANSWER_FAILED })
      send(streamDoneEvent(false))
    } finally {
      stream.end()
    }
  })

  // ── GET /public/chat/:channelId/:conversationId/replies — a person's replies ─
  app.get<{ Params: { channelId: string; conversationId: string }; Querystring: { session?: string } }>(
    '/public/chat/:channelId/:conversationId/replies',
    { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
    async (request, reply) => {
      setCors(reply)
      const { channelId, conversationId } = request.params
      const session = request.query.session ?? ''
      const chat = await prisma.conversation.findFirst({
        where: { id: conversationId, channelId },
        select: { status: true, assignedTo: true, contact: { select: { externalId: true } } },
      })
      if (!chat || !session || chat.contact?.externalId !== session) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This chat was not found for this visitor.' } })
      }
      const rows = await prisma.message.findMany({
        where: { conversationId, direction: 'outbound', authorKind: 'agent' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, content: true, createdAt: true },
      })
      const replies = rows.reverse().flatMap((row) => {
        const content = row.content && typeof row.content === 'object' ? row.content as { text?: unknown; internal?: unknown } : {}
        if (content.internal === true || typeof content.text !== 'string' || !content.text.trim()) return []
        return [{ id: row.id, text: content.text, at: row.createdAt.toISOString() }]
      })
      return reply.send({ live: isHeld(chat), replies })
    },
  )

  // ── POST /public/csat/:channelId — rate a bot response ────────────────────
  app.post<{ Params: { channelId: string } }>('/public/csat/:channelId', async (request, reply) => {
    setCors(reply)
    const { channelId } = request.params
    const { conversationId, rating, messageId, comment } = request.body as {
      conversationId?: string; rating?: number; messageId?: string; comment?: string
    }
    if (!conversationId || (rating !== 1 && rating !== -1)) {
      return reply.status(400).send({ error: 'conversationId and rating (1 or -1) required' })
    }

    const convo = await prisma.conversation.findFirst({ where: { id: conversationId, channelId } })
    if (!convo) return reply.status(404).send({ error: 'Not found' })

    await prisma.csatResponse.create({
      data: { tenantId: convo.tenantId, conversationId, messageId, rating, comment },
    })

    // Fire automation rules for csat.submitted
    triggerRules('csat.submitted', {
      tenantId: convo.tenantId,
      botId: convo.botId,
      conversationId,
      csatRating: rating,
      hasComment: !!(comment && comment.trim()),
    }).catch(() => {})

    return reply.send({ ok: true })
  })
}
