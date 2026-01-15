import { $, pad2, loadHistory, buildFrequency, toast, downloadText, GAME_META } from "./common.js";

const elGame=$("st_game"), elBase=$("st_base"), elTop=$("st_top"), elConcurso=$("st_concurso");
const btnRun=$("st_run"), btnCsv=$("st_csv"), btnExcel=$("st_excel");
const btnCopyHeat=$("st_copy_heat");

const kpis=$("st_kpis");

const canvasFreq=$("st_canvas");
const heatBody=$("st_heat_body");

const repCanvas=$("st_rep_canvas");
const repBody=$("st_rep_body");

const rank=$("st_rank");
const topLabel=$("st_top_label");
const topBody=$("st_topnums_body");

const parCanvas=$("st_par_pie");
const parKpis=$("st_par_kpis");
const parBody=$("st_par_body");

let lastHeatRows=[];
let sortKey="count";
let sortDir="desc";

/* =========================
   Helpers
   ========================= */

function clampInt(v, min, max, def){
  const n=Number(v);
  if(!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function toCsv(rows){
  return rows.map(r => r.map(x => `"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
}

function drawSize(meta){
  // quantidade de dezenas por concurso (Mega varia 6..15; aqui usamos o padrão mínimo da modalidade para estatística)
  // Para estatísticas de frequência, consideramos o tamanho real de cada concurso quando disponível (it.dezenas.length).
  // Quando não disponível, usamos meta.k ou meta.draw como fallback.
  return meta?.k || meta?.draw || meta?.minPick || 0;
}

function pct(n, d){
  if(!d) return 0;
  return 100*n/d;
}

function avgEvery(n, d){
  if(!n) return "—";
  const x = Math.round(d/n);
  return `1 em ${Math.max(1,x)} concursos`;
}

function countIntersection(a, b){
  const setB=new Set(b);
  let c=0;
  for(const n of a) if(setB.has(n)) c++;
  return c;
}

function safeDateStr(s){
  if(!s) return "—";
  return String(s);
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    return {ok:true};
  }catch(e){
    return {ok:false, msg:"Não foi possível copiar."};
  }
}

/* =========================
   Slicing: Base + Concurso
   ========================= */
function sliceToConcurso(items, concurso){
  if(!concurso) return items;
  const n = Number(concurso);
  if(!Number.isFinite(n)) return items;

  // items are ordered by concurso
  const idx = items.findIndex(x => Number(x.concurso) === n);
  if(idx === -1){
    // if concurso not found, use up to the closest <= n
    let hi=-1;
    for(let i=0;i<items.length;i++){
      if(Number(items[i].concurso) <= n) hi=i;
    }
    return hi>=0 ? items.slice(0, hi+1) : items;
  }
  return items.slice(0, idx+1);
}

function sliceBase(items, baseRaw){
  if(baseRaw === "all") return items;
  const base = clampInt(baseRaw, 10, 5000, 100);
  return items.slice(-Math.min(base, items.length));
}

/* =========================
   Frequency + Delay + Trend
   ========================= */
function buildDelayMap(items, minN, maxN){
  const lastConcurso = items.at(-1)?.concurso ?? 0;
  const lastSeen = new Map();
  for(const d of items){
    for(const n of (d.dezenas||[])){
      lastSeen.set(n, d.concurso);
    }
  }
  const delay = new Map();
  for(let n=minN;n<=maxN;n++){
    const last = lastSeen.get(n);
    delay.set(n, (lastConcurso && last) ? (lastConcurso - last) : 0);
  }
  return {delay, lastConcurso};
}

function buildTrendMap(items, baseRaw, minN, maxN){
  if(baseRaw === "all") return new Map(); // no trend for full history
  const base = clampInt(baseRaw, 10, 5000, 100);
  if(items.length < base*2) return new Map();

  const cur = items.slice(-base);
  const prev = items.slice(-(base*2), -base);

  const curCnt=new Array(maxN+1).fill(0);
  const prevCnt=new Array(maxN+1).fill(0);

  for(const d of cur) for(const n of (d.dezenas||[])) curCnt[n]+=1;
  for(const d of prev) for(const n of (d.dezenas||[])) prevCnt[n]+=1;

  const map=new Map();
  for(let n=minN;n<=maxN;n++){
    const curRate = curCnt[n]/base;
    const prevRate = prevCnt[n]/base;
    map.set(n, curRate - prevRate);
  }
  return map;
}

/* =========================
   Charts
   ========================= */
function clearCanvas(c){
  const ctx=c.getContext("2d");
  const w=c.width, h=c.height;
  ctx.clearRect(0,0,w,h);
}

function fitCanvas(c){
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  const w = Math.max(300, rect.width);
  const h = Math.max(240, rect.height || 320);
  c.width = Math.floor(w * dpr);
  c.height = Math.floor(h * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx, w, h};
}

function drawVerticalBars(canvas, rows, opts={}){
  const {ctx, w, h} = fitCanvas(canvas);
  const title = opts.title || "";
  const maxBars = opts.maxBars || Math.min(25, rows.length);
  const data = rows.slice(0, maxBars);

  ctx.clearRect(0,0,w,h);

  // margins
  const mt=36, mr=16, mb=40, ml=42;
  const gw=w-ml-mr, gh=h-mt-mb;

  // title
  ctx.font="700 14px system-ui";
  ctx.fillStyle="rgba(240,244,250,.92)";
  ctx.fillText(title, ml, 20);

  const maxV = Math.max(...data.map(d=>d.value), 1);
  const barW = gw / data.length;

  // axis
  ctx.strokeStyle="rgba(255,255,255,.10)";
  ctx.beginPath();
  ctx.moveTo(ml, mt);
  ctx.lineTo(ml, mt+gh);
  ctx.lineTo(ml+gw, mt+gh);
  ctx.stroke();

  // bars
  for(let i=0;i<data.length;i++){
    const d=data[i];
    const bh = (d.value/maxV)*gh;
    const x = ml + i*barW + barW*0.18;
    const y = mt + gh - bh;
    const bw = barW*0.64;

    // gradient (green->gold)
    const grad=ctx.createLinearGradient(x,y,x,y+bh);
    grad.addColorStop(0,"rgba(34,197,94,.70)");
    grad.addColorStop(1,"rgba(255,215,0,.45)");
    ctx.fillStyle=grad;
    roundRect(ctx, x, y, bw, bh, 8);
    ctx.fill();

    // labels
    ctx.fillStyle="rgba(240,244,250,.80)";
    ctx.font="11px system-ui";
    ctx.save();
    ctx.translate(x+bw/2, mt+gh+14);
    ctx.rotate(-0.35);
    ctx.textAlign="center";
    ctx.fillText(String(d.label), 0, 0);
    ctx.restore();
  }
}

function drawHorizontalBars(canvas, rows, opts={}){
  const {ctx, w, h} = fitCanvas(canvas);
  const title=opts.title||"";
  const maxBars=opts.maxBars||Math.min(10, rows.length);
  const data=rows.slice(0, maxBars);

  ctx.clearRect(0,0,w,h);
  const mt=36, mr=16, mb=20, ml=60;
  const gw=w-ml-mr, gh=h-mt-mb;

  ctx.font="700 14px system-ui";
  ctx.fillStyle="rgba(240,244,250,.92)";
  ctx.fillText(title, ml, 20);

  const maxV=Math.max(...data.map(d=>d.value), 1);
  const rowH=gh/data.length;

  for(let i=0;i<data.length;i++){
    const d=data[i];
    const bw=(d.value/maxV)*gw;
    const y=mt + i*rowH + rowH*0.18;
    const bh=rowH*0.64;

    // background track
    ctx.fillStyle="rgba(255,255,255,.06)";
    roundRect(ctx, ml, y, gw, bh, 8); ctx.fill();

    // bar
    const grad=ctx.createLinearGradient(ml,y,ml+bw,y);
    grad.addColorStop(0,"rgba(239,68,68,.60)");
    grad.addColorStop(1,"rgba(255,215,0,.45)");
    ctx.fillStyle=grad;
    roundRect(ctx, ml, y, bw, bh, 8); ctx.fill();

    // labels
    ctx.fillStyle="rgba(240,244,250,.90)";
    ctx.font="12px system-ui";
    ctx.textAlign="right";
    ctx.fillText(String(d.label), ml-8, y+bh*0.78);

    ctx.textAlign="left";
    ctx.fillStyle="rgba(240,244,250,.78)";
    ctx.fillText(String(d.value), ml+bw+8, y+bh*0.78);
  }
}

function drawPie(canvas, parts, opts={}){
  const {ctx, w, h} = fitCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const title=opts.title||"";
  ctx.font="700 14px system-ui";
  ctx.fillStyle="rgba(240,244,250,.92)";
  ctx.fillText(title, 14, 20);

  const cx=w*0.33, cy=h*0.58;
  const r=Math.min(w,h)*0.28;

  const total=parts.reduce((a,p)=>a+p.value,0) || 1;
  let ang=-Math.PI/2;

  const colors=[
    "rgba(59,130,246,.72)",
    "rgba(34,197,94,.72)",
    "rgba(255,215,0,.60)",
    "rgba(239,68,68,.60)"
  ];

  parts.forEach((p,i)=>{
    const slice=(p.value/total)*Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,ang,ang+slice);
    ctx.closePath();
    ctx.fillStyle=colors[i%colors.length];
    ctx.fill();

    ang += slice;
  });

  // legend
  let lx=w*0.62, ly=46;
  ctx.font="12px system-ui";
  parts.forEach((p,i)=>{
    ctx.fillStyle=colors[i%colors.length];
    ctx.fillRect(lx, ly+2, 12, 12);
    ctx.fillStyle="rgba(240,244,250,.90)";
    const pr = ((p.value/total)*100).toFixed(1);
    ctx.fillText(`${p.label}: ${pr}%`, lx+18, ly+13);
    ly += 20;
  });
}

function roundRect(ctx, x, y, w, h, r){
  const rr=Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

/* =========================
   Rendering blocks
   ========================= */
function renderHeatTable(rows, thresholds){
  heatBody.innerHTML="";
  for(const r of rows){
    const tr=document.createElement("tr");

    // heat class based on delay thresholds
    let hm="hm-mid";
    if(r.delay <= thresholds.good) hm="hm-good";
    else if(r.delay >= thresholds.bad) hm="hm-bad";

    // trend
    const tdTrend = (() => {
      if(!Number.isFinite(r.trend)) return `<span class="trend-flat">—</span>`;
      if(r.trend > thresholds.trendUp) return `<span class="trend-up">↑</span>`;
      if(r.trend < -thresholds.trendUp) return `<span class="trend-down">↓</span>`;
      return `<span class="trend-flat">↔</span>`;
    })();

    tr.innerHTML = `
      <td><b>${pad2(r.n)}</b></td>
      <td>${r.count}</td>
      <td class="hm ${hm}">${r.delay}</td>
      <td>${tdTrend}</td>
    `;
    heatBody.appendChild(tr);
  }
}

function renderRank(rows, top){
  rank.innerHTML="";
  const data = rows.slice(0, top);
  const max = Math.max(...data.map(x=>x.count), 1);

  // show a "premium" top 20 list for visual (still respects top selected)
  const show = data.slice(0, Math.min(20, data.length));
  show.forEach((r, i)=>{
    const div=document.createElement("div");
    div.className="rank-item " + (i===0?"top1":(i===1?"top2":(i===2?"top3":"")));
    div.innerHTML=`
      <div class="rank-badge">${i+1}º • ${pad2(r.n)}</div>
      <div class="rank-bar"><i style="width:${Math.round((r.count/max)*100)}%"></i></div>
      <div class="rank-val">${r.count}</div>
    `;
    rank.appendChild(div);
  });

  if(data.length>show.length){
    const more=document.createElement("div");
    more.className="muted";
    more.style.marginTop="8px";
    more.textContent=`Mostrando Top ${show.length}. A tabela abaixo mostra o Top selecionado (capado ao máximo da modalidade).`;
    rank.appendChild(more);
  }
}

function renderTopNumbersTable(rows, topN, maxN){
  const n=Math.min(topN, rows.length);
  const show=rows.slice(0,n);

  if(topLabel){
    topLabel.textContent = `Mostrando Top ${n} (de ${maxN}). As 3 primeiras ficam destacadas.`;
  }

  topBody.innerHTML="";
  for(let i=0;i<show.length;i++){
    const it=show[i];
    const tr=document.createElement("tr");
    const rankN=i+1;

    const isTop3 = rankN<=3;
    const pctVal = (it.pct!=null) ? `${it.pct.toFixed(2)}%` : "—";
    const delayVal = (it.delay!=null) ? it.delay : 0;

    const trend = (Number.isFinite(it.trend) ? it.trend : 0);
    const trendArrow = trend>0 ? "↑" : (trend<0 ? "↓" : "→");
    const trendCls = trend>0 ? "trend-up" : (trend<0 ? "trend-down" : "trend-flat");

    tr.innerHTML = `
      <td>${rankN}</td>
      <td><span class="num-badge ${isTop3 ? "num-badge-top" : ""}">${pad2(it.n)}</span></td>
      <td><b>${it.count}</b></td>
      <td>${pctVal}</td>
      <td><span class="${delayVal>= (Math.floor(maxN/2)) ? "delay-high" : "delay-ok"}">${delayVal}</span></td>
      <td><span class="trend ${trendCls}">${trendArrow}</span></td>
    `;
    topBody.appendChild(tr);
  }
}


function buildRepeatPattern(items){
  const counts=new Map();
  const last=new Map();
  const totalPairs=Math.max(0, items.length-1);

  for(let i=1;i<items.length;i++){
    const rep=countIntersection(items[i].dezenas||[], items[i-1].dezenas||[]);
    counts.set(rep, (counts.get(rep)||0)+1);
    last.set(rep, items[i].concurso);
  }

  const latestConcurso = items.at(-1)?.concurso ?? 0;
  const rows=[];
  for(const [rep, occ] of counts.entries()){
    const lastConcurso = last.get(rep) ?? 0;
    const delay = latestConcurso && lastConcurso ? (latestConcurso - lastConcurso) : 0;
    rows.push({rep, occ, delay, lastConcurso, p: pct(occ, totalPairs)});
  }
  rows.sort((a,b)=> b.occ-a.occ || b.rep-a.rep);
  return {rows, totalPairs};
}

function renderRepeat(items){
  repBody.innerHTML="";
  const {rows, totalPairs}=buildRepeatPattern(items);
  if(!totalPairs){
    repBody.innerHTML = `<tr><td colspan="4" class="muted">Base insuficiente (precisa de pelo menos 2 concursos).</td></tr>`;
    return;
  }

  // table compact: rep | occ | delay | last
  for(const r of rows){
    const tr=document.createElement("tr");
    tr.innerHTML = `
      <td><b>${r.rep}</b></td>
      <td>${r.occ}</td>
      <td>${r.delay}</td>
      <td>${r.lastConcurso}</td>
    `;
    repBody.appendChild(tr);
  }

  // horizontal bar chart by delay (top delays)
  const delaySorted = rows.slice().sort((a,b)=> b.delay-a.delay);
  drawHorizontalBars(repCanvas, delaySorted.map(x=>({label:`Rep ${x.rep}`, value:x.delay})), {title:"Atrasos (Top 10)", maxBars:10});
}

function buildParityPattern(items){
  const counts=new Map();
  const last=new Map();
  const total=items.length;
  const latestConcurso=items.at(-1)?.concurso ?? 0;

  let totalEven=0, totalOdd=0;

  for(const d of items){
    const nums=d.dezenas||[];
    const even=nums.reduce((a,n)=>a+((n%2===0)?1:0),0);
    const odd=nums.length-even;
    totalEven += even;
    totalOdd += odd;
    const key=`${even}-${odd}`;
    counts.set(key, (counts.get(key)||0)+1);
    last.set(key, d.concurso);
  }

  const rows=[];
  for(const [key, occ] of counts.entries()){
    const [even, odd]=key.split("-").map(Number);
    const lastConcurso=last.get(key) ?? 0;
    const delay = latestConcurso && lastConcurso ? (latestConcurso - lastConcurso) : 0;
    rows.push({even, odd, occ, delay, lastConcurso, p:pct(occ,total)});
  }
  rows.sort((a,b)=> b.occ-a.occ || b.even-a.even);

  const avgEven = total ? (totalEven/total) : 0;
  const avgOdd = total ? (totalOdd/total) : 0;

  return {rows, total, totalEven, totalOdd, avgEven, avgOdd};
}

function renderParity(items){
  parBody.innerHTML="";
  const {rows, total, totalEven, totalOdd, avgEven, avgOdd} = buildParityPattern(items);
  if(!total){
    parBody.innerHTML = `<tr><td colspan="6" class="muted">Sem dados na base.</td></tr>`;
    return;
  }

  // pie: proportion of even vs odd numbers overall
  drawPie(parCanvas, [
    {label:"Pares", value: totalEven},
    {label:"Ímpares", value: totalOdd},
  ], {title:"Proporção (todas dezenas na base)"});

  parKpis.innerHTML = `
    <div class="pill">Média por concurso: <b>${avgEven.toFixed(2)} pares</b> • <b>${avgOdd.toFixed(2)} ímpares</b></div>
    <div class="pill">Base: <b>${total}</b> concursos</div>
  `;

  // table compact: even | odd | occ | delay | % | last
  for(const r of rows){
    const tr=document.createElement("tr");
    tr.innerHTML = `
      <td><b>${r.even}</b></td>
      <td>${r.odd}</td>
      <td>${r.occ}</td>
      <td>${r.delay}</td>
      <td>${r.p.toFixed(2)}%</td>
      <td>${r.lastConcurso}</td>
    `;
    parBody.appendChild(tr);
  }
}

function computeThresholds(delays, baseRaw){
  // Use terciles on delays; stable for mega/lotofacil
  const arr=delays.slice().sort((a,b)=>a-b);
  const q = p => arr[Math.floor((arr.length-1)*p)] ?? 0;
  const good = q(0.33);
  const bad = q(0.75);

  // trend threshold based on base size
  let trendUp=0.01;
  if(baseRaw !== "all"){
    const base=clampInt(baseRaw,10,5000,100);
    trendUp = Math.max(0.004, Math.min(0.03, 1/base*2.2));
  }
  return {good, bad, trendUp};
}

function renderFrequencyChart(rows, top){
  const bars = rows.slice(0, top).map(r=>({label: pad2(r.n), value: r.count}));
  drawVerticalBars(canvasFreq, bars, {title:`Top ${top} — Frequência`, maxBars: Math.min(top, 30)});
}

/* =========================
   Sorting + Export
   ========================= */
function applySort(rows){
  const dir = sortDir === "asc" ? 1 : -1;
  const key = sortKey;

  const get = (r) => {
    if(key==="n") return r.n;
    if(key==="count") return r.count;
    if(key==="delay") return r.delay;
    if(key==="trend") return Number.isFinite(r.trend)?r.trend:0;
    return r.count;
  };

  return rows.slice().sort((a,b)=>{
    const av=get(a), bv=get(b);
    if(bv===av) return a.n-b.n;
    return (av<bv?-1:1)*dir;
  });
}

function bindSorting(){
  const ths=[...document.querySelectorAll("thead th[data-sort]")];
  ths.forEach(th=>{
    th.addEventListener("click", ()=>{
      const k=th.dataset.sort;
      if(!k) return;
      if(sortKey===k) sortDir = (sortDir==="desc"?"asc":"desc");
      else { sortKey=k; sortDir="desc"; }
      renderHeatTable(applySort(lastHeatRows), window.__stThresholds || {good:0,bad:0,trendUp:0.01});
      toast("ok","Ordenado", `Ordenação: ${k} (${sortDir})`);
    });
  });
}

/* Excel export (SpreadsheetML minimal) */
function toExcelXml(rows){
  const esc = s => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  const cols = rows[0]?.length || 0;
  const xmlRows = rows.map(r=>{
    const cells = r.map(v=>`<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join("");
    return `<Row>${cells}</Row>`;
  }).join("");
  return `<?xml version="1.0"?>
  <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Worksheet ss:Name="Estatisticas">
      <Table ss:ExpandedColumnCount="${cols}">${xmlRows}</Table>
    </Worksheet>
  </Workbook>`;
}

function downloadExcel(filename, rows){
  const xml=toExcelXml(rows);
  downloadText(filename, xml, "application/vnd.ms-excel");
}

/* =========================
   Main
   ========================= */
async function run(){
  btnRun.disabled=true;
  btnCsv.disabled=true;
  btnExcel.disabled=true;

  try{
    const game=String(elGame.value);
    const baseRaw=String(elBase.value);
    const topRaw=clampInt(elTop.value, 5, 100, 100);
    const concursoRaw = elConcurso ? String(elConcurso.value||"").trim() : "";

    const meta=GAME_META[game];
    const wantAll = (baseRaw === "all");
    const wantConcurso = concursoRaw !== "";

    // Load "all" to be able to slice precisely by concurso and/or all-history
    const bigN = 999999;
    const res = await loadHistory(game, bigN);
    const repoItems = res.items || [];
    const source = res.source;
    const updatedAt = res.updatedAt;

    if(!repoItems.length){
      toast("warn","Sem dados","Não foi possível carregar histórico. Verifique a pasta /data no GitHub Pages.");
      return;
    }

    let items = repoItems.slice();

    // if concurso specified, slice up to that concurso
    items = sliceToConcurso(items, wantConcurso ? concursoRaw : null);

    // choose base
    items = wantAll ? items : sliceBase(items, baseRaw);

    const latest = items.at(-1);

    const totalMarks = items.reduce((acc,it)=>acc + (Array.isArray(it.dezenas)? it.dezenas.length : 0), 0) || (items.length * drawSize(meta));

    // KPI cards
    kpis.innerHTML = `
      <div class="pill">Fonte: <b>${source||"—"}</b></div>
      <div class="pill">Atualizado: <b>${updatedAt ? new Date(updatedAt).toLocaleString() : "—"}</b></div>
      <div class="pill">Base: <b>${items.length}</b></div>
      <div class="pill">Concurso foco: <b>${latest?.concurso ?? "—"}</b></div>
      <div class="pill">Data sorteio: <b>${safeDateStr(latest?.data)}</b></div>
      <div class="pill">Modalidade: <b>${meta?.name||game}</b></div>
    `;

    // frequency rows (sorted desc)
    const freqRows = buildFrequency(items, meta.min, meta.max);
    // buildFrequency returns sorted by count desc already in common
    const top = Math.min(topRaw, (meta.max-meta.min+1));

    // delay + trend
    const {delay: delayMap} = buildDelayMap(items, meta.min, meta.max);
    const trendMap = buildTrendMap(items, baseRaw, meta.min, meta.max);

    // merged rows
    const merged = freqRows.map(r=>{
      const d = delayMap.get(r.n) ?? 0;
      const t = trendMap.has(r.n) ? trendMap.get(r.n) : NaN;
      return {n:r.n, count:r.count, delay:d, trend:t};
    });

    // thresholds for heatmap
    const delays = merged.map(x=>x.delay);
    const thresholds = computeThresholds(delays, baseRaw);
    window.__stThresholds = thresholds;

    lastHeatRows = merged;
    const sortedForHeat = applySort(merged);
    renderHeatTable(sortedForHeat, thresholds);

    // frequency chart (visual)
    renderFrequencyChart(merged.slice().sort((a,b)=>b.count-a.count||a.n-b.n), top);

    // ranking + topnums table
    const mergedByCount = merged.slice().sort((a,b)=>b.count-a.count||a.n-b.n);
    renderRank(mergedByCount, top);
    renderTopNumbersTable(mergedByCount.map(x=>({n:x.n, count:x.count, delay:x.delay, trend:x.trend, pct: (totalMarks ? (100*x.count/totalMarks) : null)})), top, (meta.max-meta.min+1));

    // repeats + parity
    renderRepeat(items);
    renderParity(items);

    // enable exports
    btnCsv.disabled=false;
    btnExcel.disabled=false;

    toast("ok","Atualizado","Painéis recalculados com sucesso.");
  }catch(e){
    toast("err","Erro", e.message||"Falha ao calcular.");
  }finally{
    btnRun.disabled=false;
  }
}

btnRun?.addEventListener("click", run);

/* Export CSV (heat table) */
btnCsv?.addEventListener("click", ()=>{
  if(!lastHeatRows.length) return;
  const rows=[["dezena","frequencia","atraso_atual","tendencia_delta"], ...applySort(lastHeatRows).map(r=>[
    pad2(r.n),
    String(r.count),
    String(r.delay),
    Number.isFinite(r.trend) ? r.trend.toFixed(6) : ""
  ])];
  downloadText("estatisticas_heat.csv", toCsv(rows), "text/csv");
});

/* Export Excel (SpreadsheetML) */
btnExcel?.addEventListener("click", ()=>{
  if(!lastHeatRows.length) return;
  const rows=[["Dezena","Frequência","Atraso atual","Tendência (Δ)"], ...applySort(lastHeatRows).map(r=>[
    pad2(r.n),
    String(r.count),
    String(r.delay),
    Number.isFinite(r.trend) ? r.trend.toFixed(6) : "—"
  ])];
  downloadExcel("estatisticas.xls", rows);
});

/* Copy heat table */
btnCopyHeat?.addEventListener("click", async ()=>{
  const rows=[...heatBody.querySelectorAll("tr")].map(tr=>tr.innerText);
  const r=await copyText(rows.join("\n"));
  toast(r.ok?"ok":"warn", r.ok?"Copiado":"Aviso", r.msg||"");
});

/* resize redraw (charts) */
window.addEventListener("resize", ()=>{
  if(lastHeatRows.length) run();
},{passive:true});

// Sorting binding once
bindSorting();

// initial run
run();
