import {
  $, pad2, uniqSorted,
  loadHistory, buildFrequency, buildRecency, normalizeToWeights,
  sampleWithoutReplacementWeighted, scoreGame,
  downloadText, copyToClipboard, toast, GAME_META, primeLoader,
  getAutoRelax, setAutoRelax,
  addMyGame
} from "./common.js";

const GAME="lotofacil";
const PREFIX="lf";
const META=GAME_META[GAME];

const elGrid=$(`${PREFIX}_grid`);
const elSelected=$(`${PREFIX}_selected`);
const btnClearSel=$(`${PREFIX}_clearSel`);

const elK=$(`${PREFIX}_k`);
const elQtd=$(`${PREFIX}_qtd`);
const elBase=$(`${PREFIX}_base`);
const elMode=$(`${PREFIX}_mode`);
const elInt=$(`${PREFIX}_int`);
const elBlock=$(`${PREFIX}_block`);
const elParity=$(`${PREFIX}_parity`);
const elEven=$(`${PREFIX}_even`);
const elOdd=$(`${PREFIX}_odd`);
const elTol=$(`${PREFIX}_tol`);
const elParityHint=$(`${PREFIX}_parity_hint`);
const chkRelax=$(`${PREFIX}_autoRelax`);
const badge=$(`${PREFIX}_relaxBadge`);
const chip=$(`${PREFIX}_relaxChip`);

const btnGen=$(`${PREFIX}_gen`);
const btnSuggest=$(`${PREFIX}_suggest`);
const btnCopy=$(`${PREFIX}_copy`);
const btnTxt=$(`${PREFIX}_txt`);
const btnCsv=$(`${PREFIX}_csv`);
const btnSave=$(`${PREFIX}_save`);

const kpis=$(`${PREFIX}_kpis`);
const out=$(`${PREFIX}_out`);
const note=$(`${PREFIX}_note`);
const latestBox=$(`${PREFIX}_latest`);

let selectedSet=new Set();
let lastGames=[];
function normalizeSelectionForK(k){
  // remove exclusões (se existirem) e limita a seleção ao tamanho do jogo
  if(typeof excludedSet!=="undefined"){
    for(const n of excludedSet) selectedSet.delete(n);
  }
  const arr = uniqSorted([...selectedSet]);
  if(arr.length>k){
    const kept = arr.slice(0,k);
    selectedSet = new Set(kept);
    toast("warn","Seleção ajustada", `Você marcou ${arr.length} dezenas. Mantivemos ${k} para gerar sem erro.`);
    syncGrid?.();
  }
}

let lastLatest=null;
let model=null;

function clampInt(v,min,max,def){
  const n=Number(v);
  if(!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function computeTargetEven(k, mode, game){
  if(!mode || mode==="any") return null;
  if(game==="lotofacil"){
    if(mode==="7-8") return 7;
    if(mode==="8-7") return 8;
    if(mode==="balanced") return Math.floor(k/2);
    return null;
  }
  const baseEven=Math.floor(k/2);
  if(mode==="balanced") return baseEven;
  if(mode==="more_even") return Math.min(k, baseEven+1);
  if(mode==="more_odd")  return Math.max(0, baseEven-1);
  return null;
}

function buildParityPreference(k, mode, evenRaw, oddRaw, tol, game){
  const hasEven = evenRaw !== "";
  const hasOdd  = oddRaw  !== "";
  let targetEven = null;

  if(hasEven && hasOdd){
    const e=parseInt(evenRaw,10), o=parseInt(oddRaw,10);
    if(!Number.isFinite(e) || !Number.isFinite(o)) throw new Error("Pares/Ímpares inválidos.");
    if(e+o !== k) throw new Error("Pares + Ímpares precisa ser igual ao tamanho do jogo.");
    targetEven = e;
  } else if(hasEven) {
    const e=parseInt(evenRaw,10);
    if(!Number.isFinite(e)) throw new Error("Pares inválidos.");
    targetEven = e;
  } else if(hasOdd) {
    const o=parseInt(oddRaw,10);
    if(!Number.isFinite(o)) throw new Error("Ímpares inválidos.");
    targetEven = k - o;
  } else {
    targetEven = computeTargetEven(k, mode, game);
  }

  if(targetEven == null) return null;

  const evenMin=Math.max(0, targetEven - tol);
  const evenMax=Math.min(k, targetEven + tol);
  return { mode, targetEven, tol, evenMin, evenMax };
}

function parityText(pref){
  if(!pref) return "Qualquer";
  if(pref.evenMin===pref.evenMax) return `${pref.evenMin} pares`;
  return `${pref.evenMin}–${pref.evenMax} pares (±${pref.tol})`;
}

function updateParityHint(k, mode, game){
  const evenRaw=(elEven?.value ?? "").toString().trim();
  const oddRaw =(elOdd?.value  ?? "").toString().trim();
  const tol=clampInt(elTol?.value, 0, 2, 1);
  let pref=null;
  try{ pref=buildParityPreference(k, mode, evenRaw, oddRaw, tol, game); }catch(e){ pref=null; }
  if(!elParityHint) return;
  if(!pref) {
    elParityHint.textContent = "Paridade: sem filtro (qualquer combinação de pares/ímpares).";
  } else {
    elParityHint.textContent = `Preferência aplicada: ${parityText(pref)}.`;
  }
}


function computeExactParity(k, mode, game){
  // Retorna {even, odd} ou null
  if(!mode || mode==="any") return null;

  // Lotofácil tem modos fixos
  if(game==="lotofacil"){
    if(mode==="7-8") return {even:7, odd:8};
    if(mode==="8-7") return {even:8, odd:7};
    if(mode==="balanced") return {even:Math.floor(k/2), odd:k-Math.floor(k/2)};
    return null;
  }

  // Mega: modos qualitativos -> converte para paridade exata por k
  const baseEven=Math.floor(k/2);
  const baseOdd=k-baseEven;
  if(mode==="balanced") return {even:baseEven, odd:baseOdd};
  if(mode==="more_even"){
    const even=Math.min(k, baseEven+1);
    return {even, odd:k-even};
  }
  if(mode==="more_odd"){
    const odd=Math.min(k, baseOdd+1);
    return {even:k-odd, odd};
  }
  return null;
}

function readRelaxPref(){ return getAutoRelax(GAME, true); }
function saveRelaxPref(v){ setAutoRelax(GAME, !!v); }
function setChipState(el,on,txtOn,txtOff,mini){
  if(!el) return;
  el.classList.remove("chip--on","chip--off","chip-mini");
  el.classList.add("chip");
  if(mini) el.classList.add("chip-mini");
  if(on){ el.classList.add("chip--on"); el.textContent=txtOn; }
  else{ el.classList.add("chip--off"); el.textContent=txtOff; }
}
function updateRelaxUI(){
  const on=!!chkRelax?.checked;
  setChipState(badge,on,"✅ Auto-relax ON","⛔ Auto-relax OFF",false);
  setChipState(chip,on,"ON","OFF",true);
}

function renderGrid(){
  elGrid.innerHTML="";
  for(let n=META.min;n<=META.max;n++){
    const b=document.createElement("div");
    b.className="num";
    b.textContent=pad2(n);
    b.dataset.n=String(n);
    b.addEventListener("click", ()=>toggleSelect(n));
    elGrid.appendChild(b);
  }
  syncGrid();
}
function toggleSelect(n){
  if(selectedSet.has(n)) selectedSet.delete(n);
  else selectedSet.add(n);
  syncGrid();
}
function syncGrid(){
  const sel=uniqSorted([...selectedSet]);
  elSelected.value=sel.map(pad2).join(" ");
  for(const node of elGrid.querySelectorAll(".num")){
    const n=Number(node.dataset.n);
    node.classList.toggle("selected", selectedSet.has(n));
    node.classList.toggle("active", selectedSet.has(n));
  }
}

function passParity(game, pref){
  if(!pref) return true;
  const even = game.reduce((a,n)=>a+((n%2===0)?1:0),0);
  return even>=pref.evenMin && even<=pref.evenMax;
}


function makeWeights(draws, mode, intensity, blockTop){
  const freqRows=buildFrequency(draws, META.min, META.max);
  const recRows=buildRecency(draws, META.min, META.max, 30);

  const freqByN=new Array(META.max+1).fill(0);
  const recByN=new Array(META.max+1).fill(0);
  for(const r of freqRows) freqByN[r.n]=r.count;
  for(const r of recRows) recByN[r.n]=r.score;

  const freqW=normalizeToWeights(freqByN.slice(META.min, META.max+1), 0.08);
  const recW =normalizeToWeights(recByN.slice(META.min, META.max+1), 0.08);

  const alpha=Math.max(0, Math.min(1, Number(intensity||0)/100));
  const base = (mode==="B") ? freqW : freqW.map((f,i)=>0.65*f+0.35*recW[i]);
  const uni=new Array(base.length).fill(1);
  let mix = base.map((x,i)=> (1-alpha)*uni[i] + alpha*x);

  const bt = clampInt(blockTop, 0, 15, 0);
  if(bt>0){
    const top = freqRows.slice(0, bt).map(r=>r.n);
    const fixed = new Set(selectedSet);
    for(const n of top){
      if(fixed.has(n)) continue;
      const idx=n - META.min;
      if(idx>=0 && idx<mix.length) mix[idx]=0.00001;
    }
  }
  return mix;
}

function genOne(k, weights, strict, paritySpec){
  const fixed=uniqSorted([...selectedSet]);
  if(fixed.length>k) return null;

  const poolNums=[], poolW=[];
  for(let n=META.min;n<=META.max;n++){
    if(fixed.includes(n)) continue;
    poolNums.push(n);
    poolW.push(weights[n - META.min]);
  }

  const need=k-fixed.length;
  const picked=sampleWithoutReplacementWeighted(poolNums,poolW,need);
  const game=uniqSorted([...fixed, ...picked]);

  if(!passParity(game, paritySpec)) return null;
  if(!strict) return game;

  let maxRun=1, run=1;
  for(let i=1;i<game.length;i++){
    run=(game[i]===game[i-1]+1)? run+1 : 1;
    if(run>maxRun) maxRun=run;
  }
  if(maxRun>8) return null;

  if(model && strict==="C"){
    const s=scoreGame(game, model);
    if(s<6.0) return null;
  }
  return game;
}

function gamesToText(games){
  return games.map((g,i)=>{
    const even=g.reduce((a,n)=>a+((n%2)===0?1:0),0);
    const odd=g.length-even;
    return `${i+1}) (${even}P/${odd}I) ${g.map(pad2).join(" - ")}`;
  }).join("
");
}
function gamesToCsv(games){
  const rows=[["idx","dezenas"], ...games.map((g,i)=>[i+1, g.map(pad2).join(" ")])];
  return rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
}

async function suggestTop5(){
  const base=clampInt(elBase.value, 50, 200, 100);
  const {items}=await loadHistory(GAME, base);
  const freq=buildFrequency(items, META.min, META.max).slice(0,5).map(r=>r.n);
  selectedSet = new Set(freq);
  syncGrid();
  toast("ok","Sugestão aplicada","Top 5 mais frequentes preenchido na seleção.");
}

async function generate(){
  const loader=primeLoader();
  btnGen.disabled=true; btnSuggest.disabled=true;
  btnCopy.disabled=true; btnTxt.disabled=true; btnCsv.disabled=true; if(btnSave) btnSave.disabled=true;

  const k=clampInt(elK.value, META.kMin, META.kMax, META.kMin);
  elK.value=String(k);
  normalizeSelectionForK(k);
  const qtd=clampInt(elQtd.value, 1, 200, 10);
  elQtd.value=String(qtd);

  const base=clampInt(elBase.value, 50, 200, 100);
  const mode=String(elMode.value||"A");
  const intensity=clampInt(elInt.value, 0, 100, 35);
  const blockTop=clampInt(elBlock?.value, 0, 15, 0);
  const parityMode=String(elParity?.value||"any");

  
// Paridade (preferência): ajuste pares/ímpares sem travar em "exato"
  const evenRaw = (elEven?.value ?? "").toString().trim();
  const oddRaw  = (elOdd?.value  ?? "").toString().trim();
  const tol = clampInt(elTol?.value, 0, 2, 1);

  const paritySpec = buildParityPreference(k, parityMode, evenRaw, oddRaw, tol, "lotofacil");
  updateParityHint(k, parityMode, "lotofacil");

  const strict = (mode==="C") ? "C" : false;
    const games=[];
    const seen=new Set();
    const maxTry = relaxOn ? 420 : 240;

    for(let gi=0; gi<qtd; gi++){
      let got=null, tries=0;
      while(!got && tries<maxTry){
        tries++;
        got=genOne(k, weights, strict, paritySpec);
        if(got){
          const key=got.join("-");
          if(seen.has(key)) got=null;
          else seen.add(key);
        }
      }
      if(!got){
        const uni=new Array(META.max-META.min+1).fill(1);
        let fallback=null;
        for(let t=0;t<260 && !fallback;t++) fallback=genOne(k, uni, false, null);
        if(!fallback) throw new Error("Não foi possível gerar jogos com as restrições atuais. Reduza bloqueios/paridade.");
        got=fallback;
      }

      games.push(got);
      loader.setProgress(28 + ((gi+1)/qtd)*68);
      if ((gi % 2) === 0) await new Promise(r=>requestAnimationFrame(()=>r()));
    }

    lastGames=games;

    const evenCounts = games.map(g=>g.reduce((a,n)=>a+((n%2)===0?1:0),0));
    const evenMin = Math.min(...evenCounts);
    const evenMax = Math.max(...evenCounts);
    const evenAvg = evenCounts.reduce((a,b)=>a+b,0) / (evenCounts.length || 1);

    if(kpis){
      kpis.innerHTML=`
        <div class="pill">Jogos: <b>${games.length}</b></div>
        <div class="pill">Dezenas/jogo: <b>${k}</b></div>
        <div class="pill">Modo: <b>${mode}</b></div>
        <div class="pill">Bloqueio: <b>${blockTop===0 ? "OFF" : "Top "+blockTop}</b></div>
        <div class="pill">Paridade: <b>${(paritySpec && Number.isFinite(paritySpec.even)) ? (paritySpec.even+"P-"+paritySpec.odd+"I") : parityMode}</b></div>
              <div class="pill">Pares (min–máx): <b>${evenMin}–${evenMax}</b> · média <b>${evenAvg.toFixed(2)}</b></div>
`;
    }

    out.textContent=gamesToText(games);
    note.textContent="💡 A análise completa fica na página Estatísticas (frequência, recência, top 10 e gráfico).";

    btnCopy.disabled=false; btnTxt.disabled=false; btnCsv.disabled=false; if(btnSave) btnSave.disabled=false;
    toast("ok","Jogos gerados","Use Copiar/Salvar TXT/CSV ou Registrar em Meus Jogos.");
  }catch(e){
    toast("err","Erro", e.message||"Falha ao gerar.");
  }finally{
    loader.setProgress(100);
    setTimeout(()=>loader.hide(), 280);
    btnGen.disabled=false; btnSuggest.disabled=false;
  }
}

function registerMyGames(){
  if(!lastGames.length){
    toast("warn","Nada para registrar","Gere jogos primeiro.");
    return;
  }
  let conc = (lastLatest?.concurso ? (Number(lastLatest.concurso)+1) : null);
  const p = prompt("Concurso de referência (opcional):", conc??"");
  if(p!==null && String(p).trim()!==""){
    const n=Number(p);
    conc = Number.isFinite(n) ? n : conc;
  }
  let ok=0;
  for(const g of lastGames){
    try{
      addMyGame({modalidade: GAME, numeros: g, concurso_referencia: conc, status:"aguardando sorteio"});
      ok++;
    }catch{}
  }
  toast("ok","Registrado", `${ok} jogo(s) enviados para Meus Jogos.`);
}


function syncParityLimits(){
  const k=clampInt(elK.value, META.kMin, META.kMax, META.kMin);
  if(elEven){ elEven.max=String(k); }
  if(elOdd){ elOdd.max=String(k); }
  // Se um dos campos estiver preenchido, tenta manter soma k
  const evenRaw=(elEven?.value??"").toString().trim();
  const oddRaw=(elOdd?.value??"").toString().trim();
  if(evenRaw!=="" && oddRaw===""){
    const even=clampInt(evenRaw,0,k,0);
    elOdd.value=String(k-even);
  }else if(oddRaw!=="" && evenRaw===""){
    const odd=clampInt(oddRaw,0,k,0);
    elEven.value=String(k-odd);
  }


// Auto-preenche pares/ímpares quando o modo definir paridade
try {
  const k=clampInt(elK?.value, META.kMin, META.kMax, META.kMin);
  const spec=computeExactParity(k, String(elParity?.value||"any"), "lotofacil");
  if(spec && elEven && elOdd){
    // só sobrescreve se usuário não digitou nada ainda (evita brigar com edição manual)
    const evenRaw=(elEven.value??"").toString().trim();
    const oddRaw=(elOdd.value??"").toString().trim();
    if(evenRaw==="" && oddRaw===""){
      elEven.value=String(spec.even);
      elOdd.value=String(spec.odd);
    }
  }
} catch(_) {}
}
function init(){
  renderGrid();

  if(chkRelax){
    chkRelax.checked=readRelaxPref();
    updateRelaxUI();
    chkRelax.addEventListener("change", ()=>{
      saveRelaxPref(!!chkRelax.checked);
      updateRelaxUI();
    });
  }

  btnClearSel?.addEventListener("click", ()=>{
    selectedSet.clear();
    syncGrid();
  });

  elK?.addEventListener("change", ()=>syncParityLimits());
  elEven?.addEventListener("input", ()=>syncParityLimits());
  elOdd?.addEventListener("input", ()=>syncParityLimits());
  syncParityLimits();

// Atualiza dica de paridade (preferência) ao alterar opções
try {
  const kk = clampInt(elK?.value, META.kMin, META.kMax, META.kMin);
  updateParityHint(kk, String(elParity?.value||"any"), "lotofacil");
} catch(_) {}

elTol?.addEventListener("change", () => {
  try {
    const kk = clampInt(elK?.value, META.kMin, META.kMax, META.kMin);
    updateParityHint(kk, String(elParity?.value||"any"), "lotofacil");
  } catch(_) {}
});
elParity?.addEventListener("change", () => {
  try {
    const kk = clampInt(elK?.value, META.kMin, META.kMax, META.kMin);
    updateParityHint(kk, String(elParity?.value||"any"), "lotofacil");
  } catch(_) {}
});
elEven?.addEventListener("input", () => {
  try {
    const kk = clampInt(elK?.value, META.kMin, META.kMax, META.kMin);
    updateParityHint(kk, String(elParity?.value||"any"), "lotofacil");
  } catch(_) {}
});
elOdd?.addEventListener("input", () => {
  try {
    const kk = clampInt(elK?.value, META.kMin, META.kMax, META.kMin);
    updateParityHint(kk, String(elParity?.value||"any"), "lotofacil");
  } catch(_) {}
});
elK?.addEventListener("change", () => {
  try {
    const kk = clampInt(elK?.value, META.kMin, META.kMax, META.kMin);
    updateParityHint(kk, String(elParity?.value||"any"), "lotofacil");
  } catch(_) {}
});


  btnSuggest?.addEventListener("click", ()=>suggestTop5().catch(e=>toast("err","Erro",e.message||"Falha")));
  btnGen?.addEventListener("click", ()=>generate());

  btnCopy?.addEventListener("click", async ()=>{
    const text=out.textContent||"";
    const r=await copyToClipboard(text);
    toast(r.ok?"ok":"warn", r.ok?"Copiado":"Aviso", r.msg||"");
  });
  btnTxt?.addEventListener("click", ()=>{
    if(!lastGames.length) return;
    downloadText("lotofacil_jogos.txt", gamesToText(lastGames), "text/plain");
  });
  btnCsv?.addEventListener("click", ()=>{
    if(!lastGames.length) return;
    downloadText("lotofacil_jogos.csv", gamesToCsv(lastGames), "text/csv");
  });
  btnSave?.addEventListener("click", registerMyGames);
}

init();


/* ============================
   Lotofácil • Ferramentas (menu lateral)
   ============================ */

const toolsState = {
  rendered: new Set(),
  cache: new Map(), // base -> {items, latest, ...}
  lastHist: null,
};


function renderHistoryStatusCallout(panelEl, hist){
  if(!panelEl) return;
  const old = panelEl.querySelector(".history-callout");
  if(old) old.remove();

  const div=document.createElement("div");
  div.className="history-callout";

  const ok = hist && hist.source==="repo" && Array.isArray(hist.items) && hist.items.length>5;
  const badge = ok ? "Histórico carregado" : "Histórico limitado";
  const badgeClass = ok ? "ok" : "warn";
  const count = (hist && hist.items) ? hist.items.length : 0;
  const updated = (hist && hist.updatedAt) ? (" (atualizado em " + hist.updatedAt + ")") : "";

  const msg = ok
    ? ("Usando " + count + " concursos do histórico" + updated + ".")
    : "Arquivo de histórico não encontrado. Rode o workflow do GitHub Actions para gerar/atualizar os JSON em /docs/data. Algumas análises ficam limitadas.";

  div.innerHTML =
    '<div class="hc-left">' +
      '<span class="hc-badge ' + badgeClass + '">' + badge + '</span>' +
      '<span class="hc-text">Lotofácil • ' + msg + '</span>' +
    '</div>';

  panelEl.prepend(div);
}

function parseNums(text){
  if(!text) return [];
  return String(text)
    .replaceAll(";", ",")
    .replaceAll("|", ",")
    .split(/[\s,]+/g)
    .map(x=>x.trim())
    .filter(Boolean)
    .map(x=>Number(x))
    .filter(n=>Number.isFinite(n))
}

function uniqSortedNums(nums){
  return uniqSorted(nums.map(n=>Number(n)).filter(n=>Number.isFinite(n)));
}

function pickRandom(arr, k){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a.slice(0,k);
}

function combosLimit(arr, k, limit){
  // generates <= limit combinations
  arr=uniqSortedNums(arr);
  if(k<=0 || k>arr.length) return [];
  const n=arr.length;

  // approximate nCk; if huge, sample
  function nCk(n,k){
    k=Math.min(k, n-k);
    let r=1;
    for(let i=1;i<=k;i++) r=r*(n-k+i)/i;
    return r;
  }
  const total = nCk(n,k);

  const out=[];
  if(total <= limit){
    // recursive exact
    const cur=[];
    (function rec(start, left){
      if(left===0){ out.push(cur.slice()); return; }
      for(let i=start; i<=n-left; i++){
        cur.push(arr[i]);
        rec(i+1, left-1);
        cur.pop();
      }
    })(0,k);
    return out;
  }

  // sample unique combos
  const seen=new Set();
  const triesMax=Math.min(200000, limit*800);
  let tries=0;
  while(out.length<limit && tries<triesMax){
    tries++;
    const pick=pickRandom(arr,k).slice().sort((a,b)=>a-b);
    const key=pick.join("-");
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(pick);
  }
  return out;
}

function gamesToText(games){
  return games.map((g,i)=>{
    const even=g.reduce((a,n)=>a+((n%2)===0?1:0),0);
    const odd=g.length-even;
    return `${i+1}) (${even}P/${odd}I) ${g.map(pad2).join(" - ")}`;
  }).join("
");
}
async function getHist(base){
  const b=Math.max(10, Math.min(5000, Math.floor(Number(base||200))));
  if(toolsState.cache.has(b)) return toolsState.cache.get(b);
  const res=await loadHistory(GAME, b);
  toolsState.cache.set(b, res);
  toolsState.lastHist=res;
  return res;
}

function showPanel(panelId){
  document.querySelectorAll(".panels .panel").forEach(p=>{
    p.classList.toggle("show", p.id===panelId);
  });
  document.querySelectorAll(".sidebar .side-link").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.panel===panelId);
  });
  // lazy render
  if(!toolsState.rendered.has(panelId)){
    toolsState.rendered.add(panelId);
    renderPanel(panelId)
      .then(()=>{ const el=document.getElementById(panelId); if(el && toolsState.lastHist) renderHistoryStatusCallout(el, toolsState.lastHist); })
      .catch(e=>toast("err","Erro", e.message||"Falha"));
  }
}

async function renderPanel(panelId){
  switch(panelId){
    case "lf_panel_last": return renderLastResults();
    case "lf_panel_desd": return setupDesdobramentos();
    case "lf_panel_fech": return setupFechamentos();
    case "lf_panel_pos":  return setupPosicionais();
    case "lf_panel_mov":  return renderMovimentacao();
    case "lf_panel_ind":  return renderIndependencia();
    case "lf_panel_cic":  return renderCiclos();
    case "lf_panel_easy": return setupDezenaFacil();
    case "lf_panel_resumo": return renderResumo();
    case "lf_panel_pad": return renderPadroes();
    case "lf_panel_lin": return renderLinhas();
    case "lf_panel_col": return renderColunas();
    default: return;
  }
}

/* ---------- Últimos Resultados ---------- */
async function renderLastResults(){
  const elN=$("lf_last_n"), btn=$("lf_last_run"), body=$("lf_last_body");
  const btnCopy=$("lf_last_copy"), btnCsv=$("lf_last_csv");

  async function run(){
    const n=Math.max(5, Math.min(200, Math.floor(Number(elN.value||30))));
    elN.value=String(n);

    const res=await getHist(Math.max(200, n+10));
    const items=res.items||[];
    const slice=items.slice(-n).reverse();

    body.innerHTML="";
    for(const it of slice){
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>${it.concurso}</b></td><td>${it.data||""}</td><td>${(it.dezenas||[]).map(pad2).join(" - ")}</td>`;
      body.appendChild(tr);
    }

    btnCopy.disabled=false;
    btnCsv.disabled=false;
  }

  btn?.addEventListener("click", ()=>run().catch(e=>toast("err","Erro",e.message||"Falha")));
  btnCopy?.addEventListener("click", async ()=>{
    const rows=[...body.querySelectorAll("tr")].map(tr=>tr.innerText);
    const r=await copyToClipboard(rows.join("\n"));
    toast(r.ok?"ok":"warn", r.ok?"Copiado":"Aviso", r.msg||"");
  });
  btnCsv?.addEventListener("click", ()=>{
    const rows=[["concurso","data","dezenas"]];
    [...body.querySelectorAll("tr")].forEach(tr=>{
      const t=[...tr.querySelectorAll("td")].map(td=>td.textContent.trim());
      rows.push(t);
    });
    const csv=rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
    downloadText("lotofacil_ultimos_resultados.csv", csv, "text/csv");
  });

  await run();
}

/* ---------- Desdobramentos ---------- */
function setupDesdobramentos(){
  const base=$("lf_desd_base"), elK=$("lf_desd_k"), elLim=$("lf_desd_lim");
  const btn=$("lf_desd_run"), out=$("lf_desd_out");
  const btnCopy=$("lf_desd_copy"), btnTxt=$("lf_desd_txt"), btnSave=$("lf_desd_save");

  let lastGames=[];

  function run(){
    const nums=uniqSortedNums(parseNums(base.value));
    const k=Math.max(15, Math.min(20, Math.floor(Number(elK.value||15))));
    const lim=Math.max(10, Math.min(1000, Math.floor(Number(elLim.value||200))));
    elK.value=String(k); elLim.value=String(lim);

    if(nums.length < k) throw new Error("Conjunto base menor que K.");
    if(nums.some(n=>n<1||n>25)) throw new Error("Lotofácil aceita 1..25.");
    if(nums.length>25) throw new Error("Conjunto base muito grande.");

    const games=combosLimit(nums, k, lim);
    lastGames=games;

    const evenCounts = games.map(g=>g.reduce((a,n)=>a+((n%2)===0?1:0),0));
    const evenMin = Math.min(...evenCounts);
    const evenMax = Math.max(...evenCounts);
    const evenAvg = evenCounts.reduce((a,b)=>a+b,0) / (evenCounts.length || 1);
    out.textContent = games.length ? gamesToText(games) : "Nada gerado.";
    btnCopy.disabled=!games.length;
    btnTxt.disabled=!games.length;
    btnSave.disabled=!games.length;
    toast("ok","Desdobramentos","Gerados com sucesso.");
  }

  btn?.addEventListener("click", ()=>{
    try{ run(); }catch(e){ toast("err","Erro", e.message||""); }
  });
  btnCopy?.addEventListener("click", async ()=>{
    const r=await copyToClipboard(out.textContent||"");
    toast(r.ok?"ok":"warn", r.ok?"Copiado":"Aviso", r.msg||"");
  });
  btnTxt?.addEventListener("click", ()=>{
    downloadText("lotofacil_desdobramentos.txt", out.textContent||"", "text/plain");
  });
  btnSave?.addEventListener("click", ()=>{
    if(!lastGames.length) return;
    for(const g of lastGames) addMyGame("lotofacil", g, {origem:"Desdobramentos"});
    toast("ok","Registrado","Jogos enviados para Meus Jogos.");
  });

  // init state
  btnCopy.disabled=true; btnTxt.disabled=true; btnSave.disabled=true;
}

/* ---------- Fechamentos (heurística) ---------- */
function setupFechamentos(){
  const base=$("lf_fech_base"), elK=$("lf_fech_k"), elQtd=$("lf_fech_qtd");
  const btn=$("lf_fech_run"), out=$("lf_fech_out");
  const btnCopy=$("lf_fech_copy"), btnTxt=$("lf_fech_txt"), btnSave=$("lf_fech_save");

  let lastGames=[];

  function run(){
    const nums=uniqSortedNums(parseNums(base.value));
    const k=Math.max(15, Math.min(20, Math.floor(Number(elK.value||15))));
    const qtd=Math.max(2, Math.min(60, Math.floor(Number(elQtd.value||10))));
    elK.value=String(k); elQtd.value=String(qtd);

    if(nums.length < k) throw new Error("Conjunto base menor que K.");
    if(nums.some(n=>n<1||n>25)) throw new Error("Lotofácil aceita 1..25.");

    // greedy: prioritize numbers with lower appearances
    const count=new Map(nums.map(n=>[n,0]));
    const games=[];
    for(let gi=0; gi<qtd; gi++){
      const sorted=nums.slice().sort((a,b)=>(count.get(a)-count.get(b)) || (Math.random()-0.5));
      const g=sorted.slice(0,k).sort((a,b)=>a-b);
      games.push(g);
      for(const n of g) count.set(n, (count.get(n)||0)+1);
    }
    lastGames=games;

    const evenCounts = games.map(g=>g.reduce((a,n)=>a+((n%2)===0?1:0),0));
    const evenMin = Math.min(...evenCounts);
    const evenMax = Math.max(...evenCounts);
    const evenAvg = evenCounts.reduce((a,b)=>a+b,0) / (evenCounts.length || 1);
    out.textContent=gamesToText(games);
    btnCopy.disabled=false; btnTxt.disabled=false; btnSave.disabled=false;
    toast("ok","Fechamentos","Gerados com heurística de cobertura.");
  }

  btn?.addEventListener("click", ()=>{ try{ run(); }catch(e){ toast("err","Erro", e.message||""); }});
  btnCopy?.addEventListener("click", async ()=>{
    const r=await copyToClipboard(out.textContent||"");
    toast(r.ok?"ok":"warn", r.ok?"Copiado":"Aviso", r.msg||"");
  });
  btnTxt?.addEventListener("click", ()=>downloadText("lotofacil_fechamentos.txt", out.textContent||"", "text/plain"));
  btnSave?.addEventListener("click", ()=>{
    if(!lastGames.length) return;
    for(const g of lastGames) addMyGame("lotofacil", g, {origem:"Fechamentos"});
    toast("ok","Registrado","Jogos enviados para Meus Jogos.");
  });

  btnCopy.disabled=true; btnTxt.disabled=true; btnSave.disabled=true;
}

/* ---------- Fechamentos Posicionais (linhas) ---------- */
function rowOf(n){ return Math.floor((n-1)/5); } // 0..4

async function setupPosicionais(){
  const elK=$("lf_pos_k"), elQtd=$("lf_pos_qtd");
  const r1=$("lf_pos_r1"), r2=$("lf_pos_r2"), r3=$("lf_pos_r3"), r4=$("lf_pos_r4"), r5=$("lf_pos_r5");
  const btn=$("lf_pos_run"), out=$("lf_pos_out");
  const btnCopy=$("lf_pos_copy"), btnTxt=$("lf_pos_txt"), btnSave=$("lf_pos_save");

  let lastGames=[];
  const res=await getHist(500);
  const items=res.items||[];
  const freqRows=buildFrequency(items, 1, 25);
  const freqByN=new Array(26).fill(0);
  for(const r of freqRows) freqByN[r.n]=r.count;

  function pickRow(rowIdx, need, picked){
    const nums=[];
    const w=[];
    for(let n=1;n<=25;n++){
      if(rowOf(n)!==rowIdx) continue;
      if(picked.has(n)) continue;
      nums.push(n);
      w.push((freqByN[n]||1));
    }
    // normalize weights locally
    const sum=w.reduce((a,b)=>a+b,0) || 1;
    const ww=w.map(x=>x/sum);
    return sampleWithoutReplacementWeighted(nums, ww, need);
  }

  function run(){
    const k=Math.max(15, Math.min(20, Math.floor(Number(elK.value||15))));
    const qtd=Math.max(2, Math.min(60, Math.floor(Number(elQtd.value||10))));
    elK.value=String(k); elQtd.value=String(qtd);

    const rr=[r1,r2,r3,r4,r5].map(x=>Math.max(0, Math.min(5, Math.floor(Number(x.value||0)))));
    rr.forEach((v,i)=>{ [r1,r2,r3,r4,r5][i].value=String(v); });

    const sum=rr.reduce((a,b)=>a+b,0);
    if(sum!==k) throw new Error(`A soma das linhas deve ser igual a K (${k}). Atualmente: ${sum}.`);

    const games=[];
    for(let gi=0; gi<qtd; gi++){
      const picked=new Set();
      for(let row=0; row<5; row++){
        const need=rr[row];
        if(need===0) continue;
        const got=pickRow(row, need, picked);
        for(const n of got) picked.add(n);
      }
      const g=[...picked].sort((a,b)=>a-b);
      games.push(g);
    }

    lastGames=games;

    const evenCounts = games.map(g=>g.reduce((a,n)=>a+((n%2)===0?1:0),0));
    const evenMin = Math.min(...evenCounts);
    const evenMax = Math.max(...evenCounts);
    const evenAvg = evenCounts.reduce((a,b)=>a+b,0) / (evenCounts.length || 1);
    out.textContent=gamesToText(games);
    btnCopy.disabled=false; btnTxt.disabled=false; btnSave.disabled=false;
    toast("ok","Posicionais","Jogos gerados por distribuição de linhas.");
  }

  btn?.addEventListener("click", ()=>{ try{ run(); }catch(e){ toast("err","Erro", e.message||""); }});
  btnCopy?.addEventListener("click", async ()=>{
    const r=await copyToClipboard(out.textContent||"");
    toast(r.ok?"ok":"warn", r.ok?"Copiado":"Aviso", r.msg||"");
  });
  btnTxt?.addEventListener("click", ()=>downloadText("lotofacil_fechamento_posicional.txt", out.textContent||"", "text/plain"));
  btnSave?.addEventListener("click", ()=>{
    if(!lastGames.length) return;
    for(const g of lastGames) addMyGame("lotofacil", g, {origem:"Posicionais"});
    toast("ok","Registrado","Jogos enviados para Meus Jogos.");
  });

  btnCopy.disabled=true; btnTxt.disabled=true; btnSave.disabled=true;
}

/* ---------- Movimentação ---------- */
async function renderMovimentacao(){
  const a=$("lf_mov_a"), b=$("lf_mov_b"), btn=$("lf_mov_run"), body=$("lf_mov_body"), btnCsv=$("lf_mov_csv");

  async function run(){
    const A=Math.max(20, Math.min(2000, Math.floor(Number(a.value||50))));
    const B=Math.max(20, Math.min(2000, Math.floor(Number(b.value||200))));
    a.value=String(A); b.value=String(B);

    const res=await getHist(Math.max(A,B));
    const items=res.items||[];
    const lastA=items.slice(-A);
    const lastB=items.slice(-B);

    const fA=new Array(26).fill(0);
    const fB=new Array(26).fill(0);

    for(const d of lastA) for(const n of (d.dezenas||[])) fA[n]+=1;
    for(const d of lastB) for(const n of (d.dezenas||[])) fB[n]+=1;

    body.innerHTML="";
    for(let n=1;n<=25;n++){
      const rateA=fA[n]/A;
      const rateB=fB[n]/B;
      const delta=(rateA-rateB)*100;
      const trend = delta>0.35 ? "⬆️ Subindo" : (delta<-0.35 ? "⬇️ Caindo" : "➡️ Estável");
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>${pad2(n)}</b></td><td>${fA[n]}</td><td>${fB[n]}</td><td>${delta.toFixed(2)}pp</td><td>${trend}</td>`;
      body.appendChild(tr);
    }
    btnCsv.disabled=false;
  }

  btn?.addEventListener("click", ()=>run().catch(e=>toast("err","Erro",e.message||"Falha")));
  btnCsv?.addEventListener("click", ()=>{
    const rows=[["dezena","freqA","freqB","delta_pp","tendencia"]];
    [...body.querySelectorAll("tr")].forEach(tr=>{
      const t=[...tr.querySelectorAll("td")].map(td=>td.textContent.trim());
      rows.push(t);
    });
    const csv=rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
    downloadText("lotofacil_movimentacao.csv", csv, "text/csv");
  });
  btnCsv.disabled=true;

  await run();
}

/* ---------- Independência ---------- */
async function renderIndependencia(){
  const elBase=$("lf_ind_base"), btn=$("lf_ind_run"), body=$("lf_ind_body"), btnCsv=$("lf_ind_csv");

  async function run(){
    const base=Math.max(50, Math.min(2000, Math.floor(Number(elBase.value||200))));
    elBase.value=String(base);

    const res=await getHist(base);
    const items=res.items||[];
    const latest=items.at(-1)?.concurso ?? 0;

    const freq=new Array(26).fill(0);
    const lastConcurso=new Array(26).fill(0);

    for(const d of items){
      for(const n of (d.dezenas||[])){
        freq[n]+=1;
        lastConcurso[n]=d.concurso;
      }
    }

    const freqVals=freq.slice(1);
    const sorted=freqVals.slice().sort((a,b)=>a-b);
    const median=sorted[Math.floor(sorted.length/2)] || 0;

    body.innerHTML="";
    for(let n=1;n<=25;n++){
      const delay = latest && lastConcurso[n] ? (latest - lastConcurso[n]) : 0;
      const indep = (delay>=8 && freq[n]<=median) ? "ALTA" : ((delay>=5) ? "MÉDIA" : "BAIXA");
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>${pad2(n)}</b></td><td>${freq[n]}</td><td>${delay}</td><td>${indep}</td><td>${lastConcurso[n]||"—"}</td>`;
      body.appendChild(tr);
    }

    // sort rows: indep high + delay desc
    const rows=[...body.querySelectorAll("tr")];
    rows.sort((ra,rb)=>{
      const aI=ra.children[3].textContent, bI=rb.children[3].textContent;
      const score = x => x==="ALTA"?3:(x==="MÉDIA"?2:1);
      const da=Number(ra.children[2].textContent)||0;
      const db=Number(rb.children[2].textContent)||0;
      const fa=Number(ra.children[1].textContent)||0;
      const fb=Number(rb.children[1].textContent)||0;
      return score(bI)-score(aI) || db-da || fa-fb;
    });
    body.innerHTML="";
    rows.forEach(r=>body.appendChild(r));

    btnCsv.disabled=false;
  }

  btn?.addEventListener("click", ()=>run().catch(e=>toast("err","Erro",e.message||"Falha")));
  btnCsv?.addEventListener("click", ()=>{
    const rows=[["dezena","frequencia","atraso","independencia","ultimo_concurso"]];
    [...body.querySelectorAll("tr")].forEach(tr=>{
      rows.push([...tr.querySelectorAll("td")].map(td=>td.textContent.trim()));
    });
    const csv=rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
    downloadText("lotofacil_independencia.csv", csv, "text/csv");
  });
  btnCsv.disabled=true;

  await run();
}

/* ---------- Ciclos ---------- */
async function renderCiclos(){
  const elBase=$("lf_cic_base"), btn=$("lf_cic_run"), kpis=$("lf_cic_kpis"), out=$("lf_cic_out");

  async function run(){
    const base=Math.max(200, Math.min(5000, Math.floor(Number(elBase.value||2000))));
    elBase.value=String(base);

    const res=await getHist(base);
    const items=res.items||[];
    if(!items.length){ out.textContent="Sem dados."; return; }

    let cycles=[];
    let seen=new Set();
    let startIdx=0;

    for(let i=0;i<items.length;i++){
      for(const n of (items[i].dezenas||[])) seen.add(n);
      if(seen.size===25){
        cycles.push({len: i-startIdx+1, end: items[i].concurso, start: items[startIdx].concurso});
        // reset for next cycle
        seen=new Set();
        startIdx=i+1;
      }
    }

    // current cycle progress
    const curSeen=new Set();
    for(let i=startIdx;i<items.length;i++){
      for(const n of (items[i].dezenas||[])) curSeen.add(n);
    }
    const missing=[];
    for(let n=1;n<=25;n++) if(!curSeen.has(n)) missing.push(n);

    const lastCycle = cycles.at(-1);
    const avg = cycles.length ? (cycles.reduce((a,c)=>a+c.len,0)/cycles.length) : 0;

    kpis.innerHTML = `
      <div class="pill">Ciclos completos: <b>${cycles.length}</b></div>
      <div class="pill">Média (base): <b>${avg ? avg.toFixed(1) : "—"}</b></div>
      <div class="pill">Último ciclo: <b>${lastCycle ? lastCycle.len : "—"}</b></div>
      <div class="pill">Progresso atual: <b>${curSeen.size}/25</b></div>
    `;

    out.textContent =
      `Ciclo atual (desde concurso ${items[startIdx]?.concurso ?? "—"}):\n`+
      `• Já saíram: ${curSeen.size}/25\n`+
      `• Faltam: ${missing.length ? missing.map(pad2).join(" - ") : "nenhuma (ciclo fechou no último concurso)"}\n\n`+
      (lastCycle ? `Último ciclo: ${lastCycle.start} → ${lastCycle.end} (${lastCycle.len} concursos)` : "Sem ciclos completos na base.");
  }

  btn?.addEventListener("click", ()=>run().catch(e=>toast("err","Erro",e.message||"Falha")));
  await run();
}

/* ---------- Dezena Fácil ---------- */
async function setupDezenaFacil(){
  const elQtd=$("lf_easy_qtd"), elHot=$("lf_easy_hot"), elCold=$("lf_easy_cold"), btn=$("lf_easy_run");
  const out=$("lf_easy_out"), btnCopy=$("lf_easy_copy"), btnTxt=$("lf_easy_txt"), btnSave=$("lf_easy_save");

  let lastGames=[];

  function buildDelay(items){
    const latest=items.at(-1)?.concurso ?? 0;
    const lastC=new Array(26).fill(0);
    for(const d of items){
      for(const n of (d.dezenas||[])) lastC[n]=d.concurso;
    }
    const delay=new Array(26).fill(0);
    for(let n=1;n<=25;n++){
      delay[n]= (latest && lastC[n]) ? (latest-lastC[n]) : 0;
    }
    return {delay, lastC, latest};
  }

  async function run(){
    const qtd=Math.max(1, Math.min(50, Math.floor(Number(elQtd.value||10))));
    const hotN=Math.max(0, Math.min(15, Math.floor(Number(elHot.value||6))));
    const coldN=Math.max(0, Math.min(15, Math.floor(Number(elCold.value||6))));
    elQtd.value=String(qtd); elHot.value=String(hotN); elCold.value=String(coldN);

    const base=Math.max(200, qtd*20);
    const res=await getHist(base);
    const items=res.items||[];
    const freq=buildFrequency(items,1,25);
    const {delay}=buildDelay(items);

    const hot=freq.slice(0, Math.min(25, hotN+6)).map(r=>r.n);
    const cold=[...Array(25)].map((_,i)=>i+1).sort((a,b)=>delay[b]-delay[a]).slice(0, Math.min(25, coldN+6));

    const games=[];
    const seen=new Set();
    for(let i=0;i<qtd;i++){
      const set=new Set();
      for(const n of hot){
        if(set.size>=hotN) break;
        set.add(n);
      }
      for(const n of cold){
        if(set.size>=hotN+coldN) break;
        set.add(n);
      }
      while(set.size<15){
        set.add(1+Math.floor(Math.random()*25));
      }
      const g=[...set].slice(0,15).sort((a,b)=>a-b);
      const key=g.join("-");
      if(seen.has(key)){ i--; continue; }
      seen.add(key);
      games.push(g);
    }

    lastGames=games;

    const evenCounts = games.map(g=>g.reduce((a,n)=>a+((n%2)===0?1:0),0));
    const evenMin = Math.min(...evenCounts);
    const evenMax = Math.max(...evenCounts);
    const evenAvg = evenCounts.reduce((a,b)=>a+b,0) / (evenCounts.length || 1);
    out.textContent=gamesToText(games);
    btnCopy.disabled=false; btnTxt.disabled=false; btnSave.disabled=false;
    toast("ok","Dezena Fácil","Sugestões geradas.");
  }

  btn?.addEventListener("click", ()=>run().catch(e=>toast("err","Erro",e.message||"Falha")));
  btnCopy?.addEventListener("click", async ()=>{
    const r=await copyToClipboard(out.textContent||"");
    toast(r.ok?"ok":"warn", r.ok?"Copiado":"Aviso", r.msg||"");
  });
  btnTxt?.addEventListener("click", ()=>downloadText("lotofacil_dezena_facil.txt", out.textContent||"", "text/plain"));
  btnSave?.addEventListener("click", ()=>{
    if(!lastGames.length) return;
    for(const g of lastGames) addMyGame("lotofacil", g, {origem:"Dezena Fácil"});
    toast("ok","Registrado","Jogos enviados para Meus Jogos.");
  });

  btnCopy.disabled=true; btnTxt.disabled=true; btnSave.disabled=true;
}

/* ---------- Tabela Resumida ---------- */
async function renderResumo(){
  const elBase=$("lf_res_base"), btn=$("lf_res_run"), body=$("lf_res_body"), btnCsv=$("lf_res_csv");

  async function run(){
    const base=Math.max(50, Math.min(5000, Math.floor(Number(elBase.value||200))));
    elBase.value=String(base);
    const res=await getHist(base);
    const items=res.items||[];
    const latest=items.at(-1)?.concurso ?? 0;

    const freq=new Array(26).fill(0);
    const lastC=new Array(26).fill(0);

    for(const d of items){
      for(const n of (d.dezenas||[])){
        freq[n]+=1;
        lastC[n]=d.concurso;
      }
    }

    body.innerHTML="";
    for(let n=1;n<=25;n++){
      const delay = latest && lastC[n] ? (latest-lastC[n]) : 0;
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>${pad2(n)}</b></td><td>${freq[n]}</td><td>${lastC[n]||"—"}</td><td>${delay}</td>`;
      body.appendChild(tr);
    }
    btnCsv.disabled=false;
  }

  btn?.addEventListener("click", ()=>run().catch(e=>toast("err","Erro",e.message||"Falha")));
  btnCsv?.addEventListener("click", ()=>{
    const rows=[["dezena","frequencia","ultimo_concurso","atraso"]];
    [...body.querySelectorAll("tr")].forEach(tr=>{
      rows.push([...tr.querySelectorAll("td")].map(td=>td.textContent.trim()));
    });
    const csv=rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
    downloadText("lotofacil_tabela_resumida.csv", csv, "text/csv");
  });
  btnCsv.disabled=true;

  await run();
}

/* ---------- Estatísticas dos Padrões ---------- */
async function renderPadroes(){
  const elBase=$("lf_pad_base"), btn=$("lf_pad_run"), body=$("lf_pad_body"), kpis=$("lf_pad_kpis");

  function bucketSum(s){
    if(s<=170) return "Soma ≤ 170";
    if(s<=190) return "171–190";
    if(s<=210) return "191–210";
    if(s<=230) return "211–230";
    return "Soma ≥ 231";
  }

  async function run(){
    const base=Math.max(50, Math.min(5000, Math.floor(Number(elBase.value||500))));
    elBase.value=String(base);
    const res=await getHist(base);
    const items=res.items||[];
    if(items.length<2){ body.innerHTML=`<tr><td colspan="4" class="muted">Base insuficiente.</td></tr>`; return; }

    const total=items.length;
    const map=new Map(); // key -> {count,last}
    const add=(key, concurso)=>{
      const cur=map.get(key)||{count:0,last:0};
      cur.count+=1;
      cur.last=concurso;
      map.set(key, cur);
    };

    // parity + sum per draw
    for(const d of items){
      const nums=d.dezenas||[];
      const even=nums.reduce((a,n)=>a+((n%2===0)?1:0),0);
      const odd=nums.length-even;
      add(`Paridade ${even}P-${odd}I`, d.concurso);
      const s=nums.reduce((a,b)=>a+b,0);
      add(bucketSum(s), d.concurso);
    }
    // repeats consecutive
    for(let i=1;i<items.length;i++){
      const rep = (items[i].dezenas||[]).filter(n=>(new Set(items[i-1].dezenas||[])).has(n)).length;
      add(`Repetidas ${rep}`, items[i].concurso);
    }

    const rows=[...map.entries()].map(([k,v])=>({k, c:v.count, p:(100*v.count/total), last:v.last}));
    rows.sort((a,b)=> b.c-a.c || a.k.localeCompare(b.k));

    body.innerHTML="";
    for(const r of rows.slice(0, 30)){
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>${r.k}</b></td><td>${r.c}</td><td>${r.p.toFixed(2)}%</td><td>${r.last}</td>`;
      body.appendChild(tr);
    }

    const top=rows[0];
    kpis.innerHTML = `
      <div class="pill">Base: <b>${total}</b></div>
      <div class="pill">Mais comum: <b>${top ? top.k : "—"}</b></div>
    `;
  }

  btn?.addEventListener("click", ()=>run().catch(e=>toast("err","Erro",e.message||"Falha")));
  await run();
}

/* ---------- Linhas / Colunas ---------- */
function colOf(n){ return (n-1)%5; } // 0..4
function buildLineColDist(items, kind){
  // kind: "row" | "col"
  const dist=[...Array(5)].map(()=>new Array(6).fill(0)); // [group][count0..5]
  for(const d of items){
    const nums=d.dezenas||[];
    const counts=new Array(5).fill(0);
    for(const n of nums){
      const g = (kind==="row") ? rowOf(n) : colOf(n);
      counts[g]+=1;
    }
    for(let g=0; g<5; g++){
      const c=counts[g];
      dist[g][c]+=1;
    }
  }
  return dist;
}

async function renderLinhas(){
  const elBase=$("lf_lin_base"), btn=$("lf_lin_run"), body=$("lf_lin_body");
  async function run(){
    const base=Math.max(50, Math.min(5000, Math.floor(Number(elBase.value||500))));
    elBase.value=String(base);
    const res=await getHist(base);
    const items=res.items||[];
    const dist=buildLineColDist(items,"row");
    body.innerHTML="";
    for(let r=0;r<5;r++){
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>L${r+1}</b></td>` + dist[r].map(x=>`<td>${x}</td>`).join("");
      body.appendChild(tr);
    }
  }
  btn?.addEventListener("click", ()=>run().catch(e=>toast("err","Erro",e.message||"Falha")));
  await run();
}

async function renderColunas(){
  const elBase=$("lf_col_base"), btn=$("lf_col_run"), body=$("lf_col_body");
  async function run(){
    const base=Math.max(50, Math.min(5000, Math.floor(Number(elBase.value||500))));
    elBase.value=String(base);
    const res=await getHist(base);
    const items=res.items||[];
    const dist=buildLineColDist(items,"col");
    body.innerHTML="";
    for(let c=0;c<5;c++){
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><b>C${c+1}</b></td>` + dist[c].map(x=>`<td>${x}</td>`).join("");
      body.appendChild(tr);
    }
  }
  btn?.addEventListener("click", ()=>run().catch(e=>toast("err","Erro",e.message||"Falha")));
  await run();
}

function initLotofacilToolsNav(){
  const links=[...document.querySelectorAll(".sidebar .side-link")];
  if(!links.length) return;

  links.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const panel=btn.dataset.panel;
      if(panel) showPanel(panel);
    });
  });

  // default panel = generator
  const url=new URL(location.href);
  const tab=url.searchParams.get("tab");
  if(tab){
    const id=`lf_panel_${tab}`;
    if(document.getElementById(id)) showPanel(id);
  }else{
    showPanel("lf_panel_generator");
  }
}

initLotofacilToolsNav();
