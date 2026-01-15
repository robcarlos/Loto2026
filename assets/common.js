// Mestre da Loteria – Sorte Certa
// Common utilities (static-friendly): works on GitHub Pages using ./data/history_*.json
const CACHE_BUSTER = (typeof window !== "undefined") ? (Date.now().toString(36)) : "static";
function withCB(url){
  // Avoid aggressive caching on GitHub Pages/CDN
  return url + (url.includes("?") ? "&" : "?") + "v=" + CACHE_BUSTER;
}
export function $(id){return document.getElementById(id);}
export function pad2(n){return String(n).padStart(2,"0");}
export function uniqSorted(arr){return Array.from(new Set(arr)).sort((a,b)=>a-b);}

// -------------------------
// Meta (rules per game)
// -------------------------
import { GAME_META } from "./config.js";
export { GAME_META };

function escHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

// -------------------------
// UI helpers
// -------------------------
export function toast(type, title, msg="", durationMs=2600){
  let host=document.querySelector(".toast-host");
  if(!host){
    host=document.createElement("div");
    host.className="toast-host";
    document.body.appendChild(host);
  }
  const el=document.createElement("div");
  el.className="toast "+(type||"");
  const icon = (type==="ok") ? "✅" : (type==="warn") ? "⚠️" : (type==="err") ? "⛔" : "ℹ️";
  el.innerHTML = `
    <div class="ticon">${icon}</div>
    <div class="tcontent">
      <b>${title||""}</b>
      <div class="tmsg">${msg||""}</div>
    </div>
  `;
  host.appendChild(el);
  const ms = Math.max(1200, Number(durationMs)||2600);
  setTimeout(()=>{ try{ el.remove(); }catch{} }, ms);
}


export function downloadText(filename, content, mime="text/plain"){
  const blob=new Blob([content],{type:mime+";charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),900);
}

export async function copyToClipboard(text){
  try{ await navigator.clipboard.writeText(text); return {ok:true,msg:"Copiado."}; }
  catch{
    try{
      const ta=document.createElement("textarea");
      ta.value=text; ta.style.position="fixed"; ta.style.left="-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
      return {ok:true,msg:"Copiado."};
    }catch{
      return {ok:false,msg:"Não foi possível copiar."};
    }
  }
}

// Loader Prime (usa a figure.svg + overlay)
export function primeLoader(){
  const overlay=document.getElementById("prime_overlay");
  const pct=document.getElementById("prime_pct");
  const title=document.getElementById("prime_title");
  const subtitle=document.getElementById("prime_sub");
  const hint=document.getElementById("prime_hint");
  const fill=document.getElementById("prime_fill");

  function show(t="Carregando…", s="Aguarde", h=""){
    if(title) title.textContent=t;
    if(subtitle) subtitle.textContent=s;
    if(hint) hint.textContent=h;
    if(pct) pct.textContent="0%";
    if(fill) fill.style.height="0%";
    if(overlay) overlay.classList.add("show");
  }
  function hide(){
    if(overlay) overlay.classList.remove("show");
  }
  function setProgress(v){
    const p=Math.max(0, Math.min(100, Number(v)||0));
    if(pct) pct.textContent = `${Math.round(p)}%`;
    if(fill) fill.style.height = `${p}%`;
  }
  return {show, hide, setProgress};
}

// -------------------------
// History (static-first)
// -------------------------
const DATA_DIR = "./data";
const API_DIR = './api';
const _historyCache = new Map(); // key -> {items,lastConcurso,updatedAt}

function histUrl(game){
  return withCB(`${DATA_DIR}/history_${game}.json`);
}


function apiFileUrl(game){
  return withCB(`${API_DIR}/${game}.json`);
}
async function tryFetchJson(url, timeoutMs=9000){
  const ctl=new AbortController();
  const t=setTimeout(()=>ctl.abort(), timeoutMs);
  try{
    const res=await fetch(url, {signal:ctl.signal, cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    return await res.json();
  }finally{ clearTimeout(t); }
}

function normalizeHistoryObj(game, obj){
  if(!obj || typeof obj!=="object") return null;
  const items = Array.isArray(obj.items) ? obj.items : [];
  const normItems = items
    .filter(x=>x && (x.concurso!=null))
    .map(x=>{
      const concurso=Number(x.concurso);
      const data=String(x.data||"");
      const raw = (x.raw && typeof x.raw==="object") ? x.raw : null;

      let dezenas = [];
      if(Array.isArray(x.dezenas)) dezenas = x.dezenas.map(Number).filter(n=>Number.isFinite(n));
      else if(typeof x.dezenas==="string") dezenas = x.dezenas.split(",").map(n=>Number(n)).filter(n=>Number.isFinite(n));

      return {concurso, data, dezenas, raw};
    })
    .filter(x=>x.concurso>0 && (x.dezenas.length>0 || x.raw))
    .sort((a,b)=>a.concurso-b.concurso);

  const lastConcurso = Number(obj.lastConcurso || (normItems.at(-1)?.concurso||0));
  return {loteria:game, updatedAt:String(obj.updatedAtUTC||obj.updatedAt||""), lastConcurso, items:normItems};
}

// Remote fallback (CORS pode bloquear em alguns ambientes)
const ENDPOINTS={
  caixa:(g)=>`https://servicebus2.caixa.gov.br/portaldeloterias/api/${g}`,
  caixaC:(g,c)=>`https://servicebus2.caixa.gov.br/portaldeloterias/api/${g}/${c}`,
  guidiLatest:(g)=>`https://api.guidi.dev.br/loteria/${g}/ultimo`,
  guidiC:(g,c)=>`https://api.guidi.dev.br/loteria/${g}/${c}`,
};

function normalizeCaixa(j){
  const concurso=Number(j.numero||j.concurso);
  const data=j.dataApuracao||j.data||"";
  const dezenas=(j.listaDezenas||j.dezenas||[]).map(Number);
  if(!concurso||!dezenas.length) throw new Error("Formato CAIXA inesperado");
  return {concurso,data,dezenas};
}
function normalizeGuidi(j){
  const concurso=Number(j.concurso||j.numero);
  const data=j.data||j.dataApuracao||"";
  const dezenas=(j.dezenas||j.listaDezenas||j.numeros||[]).map(Number);
  if(!concurso||!dezenas.length) throw new Error("Formato GUIDI inesperado");
  return {concurso,data,dezenas};
}

async function fetchLatestRemote(game){
  // tenta CAIXA, depois GUIDI
  try{ return normalizeCaixa(await tryFetchJson(ENDPOINTS.caixa(game))); }catch{}
  return normalizeGuidi(await tryFetchJson(ENDPOINTS.guidiLatest(game)));
}
async function fetchByConcursoRemote(game, concurso){
  try{ return normalizeCaixa(await tryFetchJson(ENDPOINTS.caixaC(game,concurso))); }catch{}
  return normalizeGuidi(await tryFetchJson(ENDPOINTS.guidiC(game,concurso)));
}

// Fallback mínimo (para não quebrar se não houver data)
export function localFallbackHistory(game){
  if(game==="lotofacil"){
    return [
      {concurso:3200,data:"01/01/2026",dezenas:[1,2,3,5,6,7,9,10,12,14,15,17,18,21,25]},
      {concurso:3199,data:"29/12/2025",dezenas:[1,4,5,6,8,9,11,12,14,16,17,19,20,22,24]},
      {concurso:3198,data:"27/12/2025",dezenas:[2,3,4,5,7,8,10,11,13,14,16,18,19,21,23]},
    ];
  }
  return [
    {concurso:2750,data:"01/01/2026",dezenas:[1,10,18,25,39,56]},
    {concurso:2749,data:"29/12/2025",dezenas:[5,12,28,33,41,59]},
    {concurso:2748,data:"27/12/2025",dezenas:[3,16,22,37,44,52]},
  ];
}

async function loadHistoryFromRepo(game){
  if(_historyCache.has(game)) return _historyCache.get(game);
  try{
    const obj = await tryFetchJson(histUrl(game), 8000);
    const norm = normalizeHistoryObj(game, obj);
    if(norm && norm.items.length){
      _historyCache.set(game, norm);
      return norm;
    }
  }catch{}
  return null;
}

async function loadLatestFromApiFile(game){
  try{
    const obj = await tryFetchJson(apiFileUrl(game), 8000);
    const norm = normalizeRemoteObj(game, obj);
    if(norm && norm.concurso) return norm;
  }catch{}
  return null;
}


export async function loadHistory(game, n=100){
  const repo = await loadHistoryFromRepo(game);
  if(repo && repo.items.length){
    const items = repo.items.slice(-Math.max(1, Math.min(Number(n)||100, repo.items.length)));
    const latest = items.at(-1);
    return {latest, items, source:"repo", updatedAt:repo.updatedAt};
  }

  // If the history file does not exist yet, use the latest JSON committed by the workflow.
  const latestFile = await loadLatestFromApiFile(game);
  if(latestFile && latestFile.concurso){
    return {latest: latestFile, items: [latestFile], source:"latest-file"};
  }

  // Final fallback (offline demo dataset)
  const items = localFallbackHistory(game).slice(-Math.min(Number(n)||50, 50));
  return {latest: items.at(-1), items, source:"fallback"};
}

export async function fetchResultByConcurso(game, concurso){
  const c=Number(concurso);
  if(!c) throw new Error("Concurso inválido");
  const repo = await loadHistoryFromRepo(game);
  if(repo && repo.items.length){
    const found = repo.items.find(x=>x.concurso===c);
    if(found) return found;
  }
  // fallback remoto
  try{ return await fetchByConcursoRemote(game, c); }catch{}
  throw new Error("Concurso não encontrado");
}

// -------------------------
// Statistics helpers
// -------------------------
export function buildFrequency(draws, min, max){
  const counts=new Array(max+1).fill(0);
  for(const d of draws){
    for(const n of (d.dezenas||[])){
      if(n>=min && n<=max) counts[n]+=1;
    }
  }
  const rows=[];
  for(let n=min;n<=max;n++) rows.push({n, count:counts[n]});
  rows.sort((a,b)=> b.count-a.count || a.n-b.n);
  return rows;
}

export function buildRecency(draws, min, max, window=30){
  const lastSeen=new Array(max+1).fill(null);
  for(const d of draws){
    for(const n of d.dezenas||[]){
      if(n>=min && n<=max) lastSeen[n]=d.concurso;
    }
  }
  const latestConcurso = draws.at(-1)?.concurso || 0;
  const rows=[];
  for(let n=min;n<=max;n++){
    const ls=lastSeen[n];
    const gap = (ls==null)? (window+1) : (latestConcurso - ls);
    // score alto = mais "atrasado" (até window)
    const score = Math.min(window, Math.max(0, gap));
    rows.push({n, score});
  }
  rows.sort((a,b)=> b.score-a.score || a.n-b.n);
  return rows;
}

export function normalizeToWeights(values, minWeight=0.05){
  const vmax=Math.max(...values, 0);
  const vmin=Math.min(...values, 0);
  const span = Math.max(1e-9, vmax - vmin);
  return values.map(v => minWeight + ((v - vmin)/span) * (1-minWeight));
}

export function sampleWithoutReplacementWeighted(nums, weights, k){
  const chosen=[];
  const poolNums=nums.slice();
  const poolW=weights.slice();
  for(let i=0;i<k;i++){
    const sum = poolW.reduce((a,b)=>a+b,0);
    let r=Math.random()*sum;
    let idx=0;
    for(idx=0; idx<poolNums.length; idx++){
      r-=poolW[idx];
      if(r<=0) break;
    }
    if(idx>=poolNums.length) idx=poolNums.length-1;
    chosen.push(poolNums[idx]);
    poolNums.splice(idx,1);
    poolW.splice(idx,1);
    if(!poolNums.length) break;
  }
  return chosen;
}

// Simple game pattern scoring (0..10)
function gamePatterns(game){
  const k=game.length;
  const even = game.reduce((a,n)=>a+((n%2===0)?1:0),0);
  let maxRun=1, run=1;
  for(let i=1;i<k;i++){
    run=(game[i]===game[i-1]+1)?run+1:1;
    if(run>maxRun) maxRun=run;
  }
  const sum = game.reduce((a,n)=>a+n,0);
  return {even, maxRun, sum};
}

export function scoreGame(game, model){
  // model: {freqMap, recMap, baseLen, game}
  const meta=GAME_META[model?.game] || null;
  const k=game.length;
  const p=gamePatterns(game);
  // base score from constraints closeness
  const idealEvenMin = (k<=6)?2: Math.floor(k/2)-1;
  const idealEvenMax = (k<=6)?4: Math.ceil(k/2)+1;
  let score=10;

  if(p.even<idealEvenMin) score -= (idealEvenMin-p.even)*1.2;
  if(p.even>idealEvenMax) score -= (p.even-idealEvenMax)*1.2;

  const runMax = (meta?.key==="lotofacil") ? 8 : 6;
  if(p.maxRun>runMax) score -= (p.maxRun-runMax)*1.3;

  // slight bias: prefer mixed freq/rec
  const f=model?.freqMap||{};
  const r=model?.recMap||{};
  const freqAvg = game.reduce((a,n)=>a+(Number(f[n]||0)),0)/k;
  const recAvg  = game.reduce((a,n)=>a+(Number(r[n]||0)),0)/k;
  score += Math.min(1.2, (freqAvg/Math.max(1, model?.baseLen||1))*8);
  score += Math.min(1.2, (recAvg/30)*1.4);

  return Math.max(0, Math.min(10, score));
}

// -------------------------
// Canvas chart (for Estatísticas)
// -------------------------
export function drawBarChart(canvas, rows, opts={}){
  const ctx=canvas.getContext("2d");
  const w=canvas.clientWidth||800, h=canvas.clientHeight||320;
  const dpr=Math.max(1, window.devicePixelRatio||1);
  canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);

  const title=opts.title??"";
  const maxBars=opts.maxBars??20;
  const data=rows.slice(0,maxBars);
  const maxVal=Math.max(1,...data.map(r=>r.count??r.score??0));

  const pad=18, top=34, bottom=28, left=34, right=14;
  ctx.clearRect(0,0,w,h);

  // title
  ctx.fillStyle="rgba(233,238,246,0.92)";
  ctx.font="600 14px system-ui,-apple-system,Segoe UI,Roboto";
  ctx.fillText(title,pad,20);

  // axes
  ctx.strokeStyle="rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.moveTo(left, top); ctx.lineTo(left, h-bottom);
  ctx.lineTo(w-right, h-bottom);
  ctx.stroke();

  const bw = (w-left-right) / Math.max(1, data.length);
  ctx.font="600 12px system-ui,-apple-system,Segoe UI,Roboto";

  data.forEach((r,i)=>{
    const v=(r.count??r.score??0);
    const bh = (h-top-bottom) * (v/maxVal);
    const x = left + i*bw + 6;
    const y = (h-bottom) - bh;

    // bar (no custom colors fixed; use simple alpha + gradient like gold/green feel)
    const grad=ctx.createLinearGradient(0, y, 0, h-bottom);
    grad.addColorStop(0, "rgba(255,215,0,0.85)");
    grad.addColorStop(1, "rgba(34,197,94,0.25)");
    ctx.fillStyle=grad;
    ctx.fillRect(x, y, Math.max(10, bw-12), bh);

    // label
    ctx.fillStyle="rgba(240,244,250,0.88)";
    ctx.fillText(pad2(r.n), x, h-bottom+18);
  });
}

// -------------------------
// My Games (LocalStorage) - validated
// -------------------------
import { loadMyGames, saveMyGames, getLastSeenConcurso, setLastSeenConcurso, getAutoRelax, setAutoRelax, loadDailyGames, saveDailyGames, getLastUpdateISO, setLastUpdateISO } from "./storage.js";

export { loadMyGames, saveMyGames, getLastSeenConcurso, setLastSeenConcurso, getAutoRelax, setAutoRelax, loadDailyGames, saveDailyGames, getLastUpdateISO, setLastUpdateISO };

export function uid(){
  return Math.random().toString(16).slice(2)+Date.now().toString(16);
}


export function validateNumbers(game, nums){
  const meta=GAME_META[game];
  if(!meta) throw new Error("Modalidade inválida");
  const list=Array.from(new Set((nums||[]).map(Number))).filter(n=>Number.isFinite(n));
  list.sort((a,b)=>a-b);
  if(list.length< meta.kMin || list.length> meta.kMax){
    throw new Error(`${meta.label}: quantidade inválida (${list.length}). Permitido: ${meta.kMin}–${meta.kMax}.`);
  }
  if(list.some(n=>n<meta.min || n>meta.max)){
    throw new Error(`${meta.label}: números devem estar entre ${meta.min} e ${meta.max}.`);
  }
  return list;
}

export function addMyGame(rec){
  const items=loadMyGames();
  const game=rec.modalidade;
  const nums=validateNumbers(game, rec.numeros);
  const now=new Date().toISOString();

  const row={
    id: uid(),
    modalidade: game,
    numeros: nums,
    status: rec.status || "aguardando sorteio",
    data_registro: now,
    concurso_referencia: rec.concurso_referencia ?? null,
    concurso_conferido: null,
    acertos: null,
    data_conferencia: null,
    data_sorteio: null,
    obs: rec.obs || "",
  };
  items.unshift(row);
  saveMyGames(items);
  return row;
}

export function updateMyGame(id, patch){
  const items=loadMyGames();
  const i=items.findIndex(x=>x.id===id);
  if(i<0) return null;
  const cur=items[i];
  const next={...cur, ...patch};

  // if numbers change, validate
  if(patch && patch.numeros){
    next.numeros = validateNumbers(next.modalidade, patch.numeros);
  }
  items[i]=next;
  saveMyGames(items);
  return next;
}

export function deleteMyGame(id){
  const items=loadMyGames().filter(x=>x.id!==id);
  saveMyGames(items);
}

export function clearMyGames(){
  saveMyGames([]);
}
