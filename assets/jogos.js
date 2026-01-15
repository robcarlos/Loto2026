import {
  $, pad2, toast, downloadText, copyToClipboard,
  fetchResultByConcurso, GAME_META, buildFrequency, buildRecency, loadHistory,
  loadMyGames, saveMyGames, addMyGame, updateMyGame, deleteMyGame, clearMyGames, validateNumbers,
  loadDailyGames, saveDailyGames, getLastUpdateISO, setLastUpdateISO, getLastSeenConcurso, setLastSeenConcurso
} from "./common.js";

const elGame = $("jg_game");
const elConcurso = $("jg_concurso");
const elNums = $("jg_nums");
const elObs = $("jg_obs");

const btnAdd = $("jg_add");
const btnClear = $("jg_clear");

const fGame = $("jg_f_game");
const fStatus = $("jg_f_status");
const fText = $("jg_f_text");

const btnExportTxt = $("jg_txt");
const btnExportCsv = $("jg_csv");
const btnCopy = $("jg_copy");
const btnClearAll = $("jg_clear_all");

const tbody = $("jg_body");
const kpi = $("jg_kpi");

function parseNums(txt, game){
  const meta=GAME_META[game];
  const max=meta?.max || 60;
  const nums = String(txt||"")
    .replaceAll("-", " ")
    .replaceAll(",", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(x=>Number(x))
    .filter(n=>Number.isFinite(n) && n>=1 && n<=max);
  return Array.from(new Set(nums)).sort((a,b)=>a-b);
}

function fmtIso(iso){
  if(!iso) return "—";
  try{
    const d=new Date(iso);
    return d.toLocaleString(undefined,{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  }catch{ return String(iso); }
}

function statusBadge(status){
  const s=String(status||"").toLowerCase();
  let cls="badge";
  if(s.includes("premiado") || s.includes("quina") || s.includes("quadra") || s.includes("pontos")) cls+=" ok";
  else if(s.includes("não") || s.includes("nao")) cls+=" bad";
  else if(s.includes("conferido")) cls+=" warn";
  else if(s.includes("sorteado")) cls+=" warn";
  else cls+=" neutral";
  return `<span class="${cls}">${status||"—"}</span>`;
}

function computeDrawLabel(row){
  // If already conferido -> show stored draw date
  if(row.data_sorteio) return `Sorteado: ${row.data_sorteio}`;
  if(row.concurso_referencia) return `Concurso: ${row.concurso_referencia}`;
  return "—";
}

function matchesFilter(row){
  const g=fGame.value;
  const s=fStatus.value;
  const t=(fText.value||"").trim();

  if(g && g!=="all" && row.modalidade!==g) return false;
  if(s && s!=="all"){
    const st=String(row.status||"").toLowerCase();
    if(!st.includes(s)) return false;
  }
  if(t){
    const blob = [
      row.modalidade,
      row.status,
      String(row.concurso_referencia||""),
      (row.numeros||[]).join(" "),
      row.obs||""
    ].join(" ").toLowerCase();
    if(!blob.includes(t.toLowerCase())) return false;
  }
  return true;
}



/* ============================
   Atualização automática (Meus Jogos)
   ============================ */
const btnUpdateDay = $("jg_update_day");
const elProgFill = $("jg_progress_fill");
const elProgText = $("jg_progress_text");
const elProgEta  = $("jg_progress_eta");
const elProgLast = $("jg_progress_last");
const elProgLog  = $("jg_progress_log");
const elDailyOut = $("jg_daily_out");
const btnDailyCopy = $("jg_daily_copy");
const btnDailyTxt  = $("jg_daily_txt");
const btnDailyReg  = $("jg_daily_register");


function setFill(pct, mode="running"){
  const p = Math.max(0, Math.min(100, Number(pct)||0));
  elProgFill.style.width = p.toFixed(0) + "%";
  if(mode==="done"){
    elProgFill.style.background = "linear-gradient(90deg, rgba(34,197,94,.90), rgba(34,197,94,.65))";
  }else if(mode==="error"){
    elProgFill.style.background = "linear-gradient(90deg, rgba(239,68,68,.90), rgba(239,68,68,.65))";
  }else{
    elProgFill.style.background = "linear-gradient(90deg, rgba(59,130,246,.85), rgba(34,197,94,.75))";
  }
}

function stepEls(){
  return [...document.querySelectorAll("#jg_progress_steps .pstep")];
}
function setStepState(step, state){
  stepEls().forEach(el=>{
    if(el.dataset.step!==step) return;
    el.classList.remove("pending","running","done","error");
    el.classList.add(state);
  });
}
function resetSteps(){
  stepEls().forEach(el=>{
    el.classList.remove("running","done","error");
    el.classList.add("pending");
  });
}

function logLine(msg){
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${msg}`;
  elProgLog.textContent = (elProgLog.textContent==="—" ? line : (elProgLog.textContent + "\n" + line));
}

function setLastUpdate(dt){
  setLastUpdateISO(dt);
  renderLastUpdate();
}
function renderLastUpdate(){
  try{
    const raw=getLastUpdateISO();
    elProgLast.textContent = "Última atualização: " + (raw ? new Date(raw).toLocaleString() : "—");
  }catch{
    elProgLast.textContent = "Última atualização: —";
  }
}

function setText(msg){ elProgText.textContent = msg; }

function setEta(seconds){
  if(!Number.isFinite(seconds) || seconds<0) { elProgEta.textContent="—"; return; }
  elProgEta.textContent = `~${Math.ceil(seconds)}s restantes`;
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function fmtGameLabel(game){
  return (GAME_META?.[game]?.label) || game;
}

async function computeDailyGames(){
  // Gera sugestões simples usando frequência/recência na base 200 (rápido e estável)
  const out = { updatedAt: new Date().toISOString(), megasena: [], lotofacil: [] };

  for(const game of ["megasena","lotofacil"]){
    const meta = GAME_META[game];
    const base = 200;
    const res = await loadHistory(game, base);
    const items = res.items||[];
    if(items.length<10) continue;

    const freq = buildFrequency(items, meta.min, meta.max); // ordenado desc
    const rec  = buildRecency(items, meta.min, meta.max, 30); // score
    const recMap = new Map(rec.map(r=>[r.n, r.score]));

    // score combinado: frequência + recência (penaliza muito repetido/recente demais levemente)
    const scored = freq.map(r=>{
      const n=r.n, f=r.count;
      const rc = recMap.get(n)||0;
      // quanto menor score de recência (mais recente), maior rc; aqui usamos um equilíbrio
      const s = (f*1.0) + (rc*0.6);
      return {n, s};
    }).sort((a,b)=>b.s-a.s);

    // monta pool e gera 5 jogos
    const pool = scored.slice(0, Math.min(meta.max-meta.min+1, 30)).map(x=>x.n);
    const games=[];
    const seen=new Set();
    const k=meta.kMin; // jogo padrão mínimo
    let guard=0;
    while(games.length<5 && guard<5000){
      guard++;
      const pick = [];
      const set=new Set();
      // metade do pool + metade aleatório
      while(set.size<Math.ceil(k*0.6)){
        set.add(pool[Math.floor(Math.random()*pool.length)]);
      }
      while(set.size<k){
        set.add(meta.min + Math.floor(Math.random()*(meta.max-meta.min+1)));
      }
      const arr=[...set].sort((a,b)=>a-b);
      const key=arr.join("-");
      if(seen.has(key)) continue;
      seen.add(key);
      games.push(arr);
    }

    out[game] = games;
  }

  saveDailyGames(out);
  return out;
}

function renderDailyGames(){
  const obj = loadDailyGames();
  const lines=[];
  const ms=obj.megasena||[];
  const lf=obj.lotofacil||[];
  if(ms.length){
    lines.push("Mega-Sena:");
    ms.forEach((g,i)=>lines.push(`  ${i+1}. ${g.map(pad2).join(" - ")}`));
  }
  if(lf.length){
    lines.push("");
    lines.push("Lotofácil:");
    lf.forEach((g,i)=>lines.push(`  ${i+1}. ${g.map(pad2).join(" - ")}`));
  }
  elDailyOut.textContent = lines.join("\n").trim() || "Nenhuma atualização ainda.";
  const hasAny = (ms.length || lf.length);
  btnDailyCopy.disabled=!hasAny;
  btnDailyTxt.disabled=!hasAny;
  btnDailyReg.disabled=!hasAny;
}


async function runAutoUpdate(){
  // etapas sequenciais com progresso + fallback
  const estimateTotal = 15; // segundos
  const t0 = performance.now();
  let pct = 0;

  function tick(){
    const elapsed = (performance.now()-t0)/1000;
    const remaining = Math.max(0, estimateTotal*(1-pct/100));
    setEta(remaining);
  }

  const timer = setInterval(tick, 250);

  try{
    btnUpdateDay.disabled=true;
    resetSteps();
    elProgLog.textContent="—";
    setFill(0,"running");
    setText("Iniciando atualização…");
    setEta(estimateTotal);

    // STEP 1: coleta
    setStepState("collect","running");
    setText("📥 Coletando resultados do concurso…");
    logLine("Início • Coleta de dados");

    // confere jogos pendentes que tenham concurso_referencia
    const items = loadMyGames();
    const pend = items.filter(x => (x.status||"").toLowerCase().includes("aguardando") && x.concurso_referencia);
    let checked=0, updated=0;

    for(const row of pend){
      try{
        const res = await fetchResultByConcurso(row.modalidade, row.concurso_referencia);
        // calcula acertos
        const jogo = String(row.numeros||"").split(",").map(Number).filter(Number.isFinite);
        const dezenas = res.dezenas||[];
        const acertos = jogo.filter(n=>new Set(dezenas).has(n)).length;

        // status por modalidade
        const meta = GAME_META[row.modalidade];
        let status="não premiado";
        if(row.modalidade==="lotofacil"){
          if(acertos===15) status="premiado (15 pontos)";
          else if(acertos>=11) status=`premiado (${acertos} pontos)`;
        }else{
          if(acertos===6) status="premiado (sena - 6)";
          else if(acertos===5) status="premiado (quina - 5)";
          else if(acertos===4) status="premiado (quadra - 4)";
        }

        updateMyGame(row.id, {
          status,
          acertos,
          concurso_conferido: res.concurso,
          data_sorteio: res.data || "",
          data_conferencia: new Date().toISOString()
        });
        updated++;
      }catch(e){
        // não encontrado -> permanece aguardando
      }finally{
        checked++;
        // progresso parcial dentro da etapa
        pct = Math.min(35, (checked/Math.max(1, pend.length))*35);
        setFill(pct,"running");
      }
      // micro pausa para UX
      await sleep(40);
    }

    setStepState("collect","done");
    logLine(`Coleta concluída • pendentes checados: ${checked} • atualizados: ${updated}`);
    pct = 35; setFill(pct,"running");

    // STEP 2: stats
    setStepState("stats","running");
    setText("🧮 Processando estatísticas…");
    logLine("Processando estatísticas (base rápida)");

    await sleep(300);
    // força carregar bases para cache e validar que histórico está acessível
    await loadHistory("megasena", 200);
    await loadHistory("lotofacil", 200);

    pct = 65; setFill(pct,"running");
    setStepState("stats","done");
    logLine("Estatísticas processadas");

    // STEP 3: daily games
    setStepState("daily","running");
    setText("🎯 Atualizando jogos do dia…");
    logLine("Gerando sugestões do dia");
    const daily = await computeDailyGames();
    renderDailyGames();

async function autoSyncIfNewDraws(){
  // Se detectar concurso novo, confere automaticamente jogos pendentes vinculados ao concurso.
  try{
    const gamesToCheck = ["megasena","lotofacil"];
    let totalUpdated=0;
    for(const game of gamesToCheck){
      const hist = await loadHistory(game, 10);
      const items=(hist.items||[]).slice().sort((a,b)=>a.concurso-b.concurso);
      const latest=items.at(-1);
      if(!latest?.concurso) continue;

      const lastSeen = getLastSeenConcurso(game) || 0;
      if(latest.concurso <= lastSeen) continue; // nada novo

      // marca como visto
      setLastSeenConcurso(game, latest.concurso);

      // confere pendentes desse game até o concurso mais recente
      const all = loadMyGames();
      const pend = all.filter(r =>
        r.modalidade===game &&
        r.concurso_referencia!=null &&
        Number(r.concurso_referencia) <= Number(latest.concurso) &&
        String(r.status||"").toLowerCase().includes("aguardando")
      );

      let updated=0;
      for(const row of pend){
        try{
          const res = await fetchResultByConcurso(game, row.concurso_referencia);
          const dezenas = (res.dezenas||[]).map(Number);
          const jogo = (row.numeros||[]).map(Number);
          const acertos = jogo.filter(n=>new Set(dezenas).has(n)).length;

          let status="não premiado";
          if(game==="lotofacil"){
            if(acertos===15) status="premiado (15 pontos)";
            else if(acertos>=11) status=`premiado (${acertos} pontos)`;
          }else if(game==="megasena"){
            if(acertos===6) status="premiado (sena - 6)";
            else if(acertos===5) status="premiado (quina - 5)";
            else if(acertos===4) status="premiado (quadra - 4)";
          }

          updateMyGame(row.id, {
            status,
            acertos,
            concurso_conferido: res.concurso,
            data_sorteio: res.data || "",
            data_conferencia: new Date().toISOString()
          });
          updated++;
        }catch{
          // se concurso ainda não disponível, ignora
        }
      }

      totalUpdated += updated;
      if(updated>0){
        toast("ok","Atualização automática", `${fmtGameLabel(game)} • ${updated} jogo(s) conferido(s) (concurso novo: ${latest.concurso}).`);
      }
    }
    if(totalUpdated>0) render();
  }catch(e){
    // silencioso (não quebra a página)
  }
}
    pct = 90; setFill(pct,"running");
    setStepState("daily","done");
    logLine("Sugestões do dia atualizadas");

    // STEP 4: final
    setStepState("final","running");
    setText("✅ Finalizando e disponibilizando…");
    await sleep(250);
    pct = 100; setFill(pct,"done");
    setStepState("final","done");
    setText("Concluído! ✅");
    setEta(0);

    setLastUpdate(new Date().toISOString());
    render();

    toast("ok","Atualização concluída","Novo jogo do dia atualizado com sucesso.");
  }catch(e){
    setFill(pct||10,"error");
    setText("Falha ao atualizar ❌");
    setEta(NaN);
    // marca step atual como error (o primeiro ainda running)
    stepEls().forEach(el=>{
      if(el.classList.contains("running")) el.classList.remove("running"), el.classList.add("error");
    });
    logLine("ERRO: " + (e.message||"Falha"));
    toast("err","Não foi possível atualizar", "Tente novamente. " + (e.message||""));
  }finally{
    clearInterval(timer);
    btnUpdateDay.disabled=false;
  }
}

btnUpdateDay?.addEventListener("click", runAutoUpdate);

btnDailyCopy?.addEventListener("click", async ()=>{
  const r = await copyToClipboard(elDailyOut.textContent||"");
  toast(r.ok?"ok":"warn", r.ok?"Copiado":"Aviso", r.msg||"");
});
btnDailyTxt?.addEventListener("click", ()=>{
  downloadText("jogos_do_dia.txt", elDailyOut.textContent||"", "text/plain");
});
btnDailyReg?.addEventListener("click", ()=>{
  try{
    const obj = loadDailyGames();
    if(!raw) return;
    const obj=JSON.parse(raw);
    let c=0;
    for(const game of ["megasena","lotofacil"]){
      for(const g of (obj[game]||[])){
        addMyGame(game, g, {origem:"Jogo do dia"});
        c++;
      }
    }
    toast("ok","Registrado", `${c} jogos do dia adicionados em Meus Jogos.`);
    render();
  }catch(e){
    toast("err","Falha", e.message||"");
  }
});

// init
renderLastUpdate();
renderDailyGames();

async function autoSyncIfNewDraws(){
  // Se detectar concurso novo, confere automaticamente jogos pendentes vinculados ao concurso.
  try{
    const gamesToCheck = ["megasena","lotofacil"];
    let totalUpdated=0;
    for(const game of gamesToCheck){
      const hist = await loadHistory(game, 10);
      const items=(hist.items||[]).slice().sort((a,b)=>a.concurso-b.concurso);
      const latest=items.at(-1);
      if(!latest?.concurso) continue;

      const lastSeen = getLastSeenConcurso(game) || 0;
      if(latest.concurso <= lastSeen) continue; // nada novo

      // marca como visto
      setLastSeenConcurso(game, latest.concurso);

      // confere pendentes desse game até o concurso mais recente
      const all = loadMyGames();
      const pend = all.filter(r =>
        r.modalidade===game &&
        r.concurso_referencia!=null &&
        Number(r.concurso_referencia) <= Number(latest.concurso) &&
        String(r.status||"").toLowerCase().includes("aguardando")
      );

      let updated=0;
      for(const row of pend){
        try{
          const res = await fetchResultByConcurso(game, row.concurso_referencia);
          const dezenas = (res.dezenas||[]).map(Number);
          const jogo = (row.numeros||[]).map(Number);
          const acertos = jogo.filter(n=>new Set(dezenas).has(n)).length;

          let status="não premiado";
          if(game==="lotofacil"){
            if(acertos===15) status="premiado (15 pontos)";
            else if(acertos>=11) status=`premiado (${acertos} pontos)`;
          }else if(game==="megasena"){
            if(acertos===6) status="premiado (sena - 6)";
            else if(acertos===5) status="premiado (quina - 5)";
            else if(acertos===4) status="premiado (quadra - 4)";
          }

          updateMyGame(row.id, {
            status,
            acertos,
            concurso_conferido: res.concurso,
            data_sorteio: res.data || "",
            data_conferencia: new Date().toISOString()
          });
          updated++;
        }catch{
          // se concurso ainda não disponível, ignora
        }
      }

      totalUpdated += updated;
      if(updated>0){
        toast("ok","Atualização automática", `${fmtGameLabel(game)} • ${updated} jogo(s) conferido(s) (concurso novo: ${latest.concurso}).`);
      }
    }
    if(totalUpdated>0) render();
  }catch(e){
    // silencioso (não quebra a página)
  }
}


function render(){
  const all=loadMyGames();

  const filtered=all.filter(matchesFilter);
  const total=all.length;
  const prem=all.filter(x=>String(x.status||"").toLowerCase().includes("premiado")).length;
  const agu=all.filter(x=>String(x.status||"").toLowerCase().includes("aguardando")).length;

  if(kpi){
    kpi.innerHTML = `
      <div class="pill">Total: <b>${total}</b></div>
      <div class="pill">Aguardando: <b>${agu}</b></div>
      <div class="pill">Premiados: <b>${prem}</b></div>
      <div class="pill">Exibindo: <b>${filtered.length}</b></div>
    `;
  }

  tbody.innerHTML="";
  for(const row of filtered){
    const meta=GAME_META[row.modalidade];
    const nums=(row.numeros||[]).map(pad2).join(" - ");
    const concRef = row.concurso_referencia ?? "—";
    const concConf = row.concurso_conferido ?? "—";
    const ac = (row.acertos==null) ? "—" : String(row.acertos);
    const draw = row.data_sorteio ? row.data_sorteio : "—";

    const tr=document.createElement("tr");
    tr.innerHTML = `
      <td>${meta?meta.label:row.modalidade}</td>
      <td class="mono">${nums}</td>
      <td class="mono">${concRef}</td>
      <td>${statusBadge(row.status)}</td>
      <td class="mono">${ac}</td>
      <td class="mono">${concConf}</td>
      <td>${draw}</td>
      <td class="mono">${fmtIso(row.data_registro)}</td>
      <td class="actions">
        <button class="btn small" data-act="check" data-id="${row.id}">✅ Conferir</button>
        <button class="btn small" data-act="edit" data-id="${row.id}">✏️ Status</button>
        <button class="btn small danger" data-act="del" data-id="${row.id}">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function exportTxt(){
  const items=loadMyGames();
  const rows=items.map((x,i)=>{
    const meta=GAME_META[x.modalidade];
    return `${i+1}) ${meta?.label||x.modalidade} | ${x.numeros.map(pad2).join("-")} | conc:${x.concurso_referencia??"-"} | ${x.status} | acertos:${x.acertos??"-"} | reg:${x.data_registro}`;
  }).join("\n");
  downloadText("meus_jogos.txt", rows, "text/plain");
}

function exportCsv(){
  const items=loadMyGames();
  const head=["id","modalidade","numeros","concurso_referencia","status","acertos","concurso_conferido","data_sorteio","data_registro","data_conferencia","obs"];
  const lines=[head.join(",")];
  for(const x of items){
    const row=[
      x.id,
      x.modalidade,
      (x.numeros||[]).join(" "),
      x.concurso_referencia ?? "",
      x.status ?? "",
      x.acertos ?? "",
      x.concurso_conferido ?? "",
      x.data_sorteio ?? "",
      x.data_registro ?? "",
      x.data_conferencia ?? "",
      (x.obs||"").replaceAll('"','""'),
    ].map(v=>`"${String(v).replaceAll('"','""')}"`);
    lines.push(row.join(","));
  }
  downloadText("meus_jogos.csv", lines.join("\n"), "text/csv");
}

async function checkGame(id){
  const items=loadMyGames();
  const row=items.find(x=>x.id===id);
  if(!row) return;

  const meta=GAME_META[row.modalidade];
  const conc = row.concurso_referencia ?? Number(prompt("Concurso para conferir:", "")) || null;
  if(!conc){
    toast("warn","Concurso obrigatório","Informe o concurso de referência para conferir.");
    return;
  }

  try{
    const result = await fetchResultByConcurso(row.modalidade, conc);
    const sorteioNums = result.dezenas.map(Number);
    const jogoNums = validateNumbers(row.modalidade, row.numeros);

    // Mega: concursos antigos sempre 6 dezenas; Lotofácil 15
    const acertos = jogoNums.reduce((a,n)=>a+(sorteioNums.includes(n)?1:0),0);

    let status="conferido";
    if(row.modalidade==="lotofacil"){
      if(acertos===15) status="premiado (15 pontos)";
      else if(acertos>=11) status=`premiado (${acertos} pontos)`;
      else status="não premiado";
    }else{
      if(acertos===6) status="premiado (sena - 6)";
      else if(acertos===5) status="premiado (quina - 5)";
      else if(acertos===4) status="premiado (quadra - 4)";
      else status="não premiado";
    }

    updateMyGame(id,{
      concurso_referencia: conc,
      concurso_conferido: conc,
      acertos,
      status,
      data_conferencia: new Date().toISOString(),
      data_sorteio: result.data || null,
    });

    toast("ok","Conferido", `${meta.label} • Concurso ${conc} • Acertos: ${acertos}`);
    render();
  }catch(e){
    toast("err","Falha ao conferir", e.message||"Erro");
  }
}

function editStatus(id){
  const items=loadMyGames();
  const row=items.find(x=>x.id===id);
  if(!row) return;
  const next = prompt("Novo status:", row.status||"");
  if(next==null) return;
  updateMyGame(id,{status: next});
  render();
}

function removeGame(id){
  if(!confirm("Excluir este jogo?")) return;
  deleteMyGame(id);
  render();
}

function addFromForm(){
  try{
    const game=elGame.value;
    const nums=parseNums(elNums.value, game);
    const valid=validateNumbers(game, nums);

    const conc = elConcurso.value ? Number(elConcurso.value) : null;
    const obs = (elObs.value||"").trim();

    addMyGame({
      modalidade: game,
      numeros: valid,
      concurso_referencia: Number.isFinite(conc)?conc:null,
      status: "aguardando sorteio",
      obs
    });

    elNums.value=""; elObs.value="";
    toast("ok","Jogo registrado","Salvo em Meus Jogos (validado).");
    render();
  }catch(e){
    toast("err","Não foi possível registrar", e.message||"");
  }
}

function clearForm(){
  elConcurso.value="";
  elNums.value="";
  elObs.value="";
}

function bind(){
  btnAdd?.addEventListener("click", addFromForm);
  btnClear?.addEventListener("click", clearForm);

  fGame?.addEventListener("change", render);
  fStatus?.addEventListener("change", render);
  fText?.addEventListener("input", ()=>{ window.clearTimeout(bind._t); bind._t=setTimeout(render, 120); });

  btnExportTxt?.addEventListener("click", exportTxt);
  btnExportCsv?.addEventListener("click", exportCsv);

  btnCopy?.addEventListener("click", async ()=>{
    const text = loadMyGames().map((x,i)=>`${i+1}) ${x.modalidade}: ${x.numeros.map(pad2).join("-")} | conc:${x.concurso_referencia??"-"} | ${x.status}`).join("\n");
    const r=await copyToClipboard(text);
    toast(r.ok?"ok":"warn", r.ok?"Copiado":"Aviso", r.msg||"");
  });

  btnClearAll?.addEventListener("click", ()=>{
    if(!confirm("Apagar TODOS os jogos registrados?")) return;
    clearMyGames();
    render();
  });

  tbody?.addEventListener("click", (ev)=>{
    const btn=ev.target.closest("button");
    if(!btn) return;
    const id=btn.dataset.id;
    const act=btn.dataset.act;
    if(act==="check") checkGame(id);
    if(act==="edit") editStatus(id);
    if(act==="del") removeGame(id);
  });
}

bind();
render();


/* =========================================================
   Resultados & Visualização (Meus Jogos)
   ========================================================= */

const resGame = $("res_game");
const resBase = $("res_base");
const resConcurso = $("res_concurso");
const resRefresh = $("res_refresh");
const resExportCsv = $("res_export_csv");
const resExportXls = $("res_export_xls");

const resCurrentTitle = $("res_current_title");
const resCurrentSub = $("res_current_sub");
const resCurrentNums = $("res_current_nums");
const resCurrentPar = $("res_current_par");
const resCurrentSum = $("res_current_sum");

const resHistRange = $("res_hist_range");
const resHistSearch = $("res_hist_search");
const resHistClear = $("res_hist_clear");
const resRecentBody = $("res_recent_body");
const resLastUpdate = $("res_last_update");

const resPie = $("res_pie");
const resPieNote = $("res_pie_note");
const resTopBars = $("res_topbars");
const resHeatGrid = $("res_heatgrid");
const resSort = $("res_sort");

let _resState = { all:[], upTo:[], baseItems:[], prevItems:[], updatedAt:null, game:"megasena", contest:null };

function clampInt(v, min, max, defVal){
  const n = Number(v);
  if(!Number.isFinite(n)) return defVal;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function formatNums(nums){ return (nums||[]).map(pad2).join(" - "); }

function computeEvenOdd(nums){
  let even=0, odd=0;
  for(const n of nums||[]){ (n%2===0) ? even++ : odd++; }
  return {even, odd};
}

function buildFreqCounts(items, min, max){
  const counts = new Array(max+1).fill(0);
  for(const d of items){
    for(const n of (d.dezenas||[])){
      if(n>=min && n<=max) counts[n]+=1;
    }
  }
  return counts;
}

function buildLastConcurso(items, min, max){
  const last = new Array(max+1).fill(0);
  for(const d of items){
    for(const n of (d.dezenas||[])){
      if(n>=min && n<=max) last[n]=d.concurso;
    }
  }
  return last;
}

function quantiles(vals){
  const v = vals.slice().filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);
  if(!v.length) return {q33:0,q66:0};
  const q = (p)=> v[Math.max(0, Math.min(v.length-1, Math.floor(p*(v.length-1))))];
  return {q33:q(0.33), q66:q(0.66)};
}

function delayClass(delay, q33, q66){
  if(delay===null || delay===undefined) return "gray";
  if(delay<=q33) return "green";
  if(delay<=q66) return "yellow";
  return "red";
}

function trendClass(delta){
  if(delta > 0.015) return {icon:"↑", cls:"trend-up"};
  if(delta < -0.015) return {icon:"↓", cls:"trend-down"};
  return {icon:"→", cls:"trend-flat"};
}

function drawPie(canvas, a, b){
  if(!canvas) return;
  const ctx=canvas.getContext("2d");
  const w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h);

  const total=a+b || 1;
  const angA=(a/total)*Math.PI*2;

  const cx=w/2, cy=h/2, r=Math.min(w,h)*0.36;

  // bg
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle="rgba(255,255,255,.05)"; ctx.fill();

  // slice A (even) - blue
  ctx.beginPath(); ctx.moveTo(cx,cy);
  ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+angA);
  ctx.closePath();
  ctx.fillStyle="rgba(56,189,248,.75)";
  ctx.fill();

  // slice B (odd) - emerald
  ctx.beginPath(); ctx.moveTo(cx,cy);
  ctx.arc(cx,cy,r,-Math.PI/2+angA, -Math.PI/2+Math.PI*2);
  ctx.closePath();
  ctx.fillStyle="rgba(34,197,94,.70)";
  ctx.fill();

  // ring
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.strokeStyle="rgba(255,255,255,.14)"; ctx.lineWidth=2; ctx.stroke();

  // labels
  ctx.fillStyle="rgba(240,244,250,.92)";
  ctx.font="700 14px system-ui, -apple-system, Segoe UI, Roboto";
  const pctA=(100*a/total).toFixed(1);
  const pctB=(100*b/total).toFixed(1);
  ctx.fillText(`Pares: ${pctA}%`, 16, 24);
  ctx.fillText(`Ímpares: ${pctB}%`, 16, 46);
}

function drawHBar(canvas, rows){
  if(!canvas) return;
  const ctx=canvas.getContext("2d");
  const w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h);

  const padL=50, padR=18, padT=12, padB=18;
  const innerW=w-padL-padR;
  const innerH=h-padT-padB;

  const max = Math.max(1, ...rows.map(r=>r.count));
  const barH = Math.max(14, Math.floor(innerH / Math.max(1, rows.length)) - 6);
  const gap = 10;

  ctx.font="800 12px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillStyle="rgba(240,244,250,.88)";
  rows.forEach((r,i)=>{
    const y = padT + i*(barH+gap);
    const bw = (r.count/max) * innerW;

    // bar color: top3 gold-ish, others green
    const isTop3 = i<3;
    ctx.fillStyle = isTop3 ? "rgba(255,215,0,.72)" : "rgba(34,197,94,.58)";
    ctx.fillRect(padL, y, bw, barH);

    // outline
    ctx.strokeStyle="rgba(255,255,255,.10)";
    ctx.strokeRect(padL, y, innerW, barH);

    // labels
    ctx.fillStyle="rgba(240,244,250,.90)";
    ctx.fillText(pad2(r.n), 14, y+barH-2);
    ctx.fillText(String(r.count), padL + bw + 6, y+barH-2);
  });
}

function buildXls(rows){
  // Minimal SpreadsheetML (Excel opens .xls)
  const esc = (s)=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const xmlRows = rows.map(r=>{
    const cells = r.map(v=>`<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join("");
    return `<Row>${cells}</Row>`;
  }).join("");
  return `<?xml version="1.0"?>
  <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Worksheet ss:Name="Dados"><Table>${xmlRows}</Table></Worksheet>
  </Workbook>`;
}

function exportTableCsv(){
  const rows=[["concurso","data","numeros"]];
  [...resRecentBody.querySelectorAll("tr")].forEach(tr=>{
    const t=[...tr.querySelectorAll("td")].map(td=>td.textContent.trim());
    rows.push([t[0]||"", t[1]||"", t[2]||""]);
  });
  const csv = rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  downloadText(`resultados_${_resState.game}.csv`, csv, "text/csv");
}

function exportTableXls(){
  const rows=[["concurso","data","numeros"]];
  [...resRecentBody.querySelectorAll("tr")].forEach(tr=>{
    const t=[...tr.querySelectorAll("td")].map(td=>td.textContent.trim());
    rows.push([t[0]||"", t[1]||"", t[2]||""]);
  });
  const xml=buildXls(rows);
  downloadText(`resultados_${_resState.game}.xls`, xml, "application/vnd.ms-excel");
}

function setHeatGrid(meta, freq, delay, trend, sortKey){
  if(!resHeatGrid) return;

  const nums=[];
  for(let n=meta.min; n<=meta.max; n++){
    nums.push({
      n,
      freq: freq[n]||0,
      delay: (delay[n]===null || delay[n]===undefined) ? null : delay[n],
      delta: trend[n]||0
    });
  }

  if(sortKey==="delay"){
    nums.sort((a,b)=>(b.delay??-1)-(a.delay??-1) || b.freq-a.freq || a.n-b.n);
  }else if(sortKey==="trend"){
    nums.sort((a,b)=> (Math.abs(b.delta)-Math.abs(a.delta)) || b.delta-a.delta || b.freq-a.freq || a.n-b.n);
  }else{
    nums.sort((a,b)=> b.freq-a.freq || (a.delay??999)-(b.delay??999) || a.n-b.n);
  }

  const {q33, q66} = quantiles(nums.map(x=>x.delay).filter(x=>x!==null));
  resHeatGrid.style.gridTemplateColumns = `repeat(${meta.max>=60?10:5}, minmax(0,1fr))`;
  resHeatGrid.innerHTML="";

  for(const it of nums){
    const cls=delayClass(it.delay, q33, q66);
    const tr=trendClass(it.delta);
    const el=document.createElement("div");
    el.className=`heat-item ${cls}`;
    el.title = `Dezena ${pad2(it.n)}\nFrequência: ${it.freq}\nAtraso: ${it.delay===null?"—":it.delay}\nTendência: ${it.delta>0?"+":""}${(it.delta*100).toFixed(2)}pp`;
    el.innerHTML = `
      ${pad2(it.n)}
      <small><span class="${tr.cls}">${tr.icon}</span> ${it.freq}</small>
    `;
    resHeatGrid.appendChild(el);
  }
}

function setCurrentCard(meta, current, lastMap, latestConcurso){
  if(!current){
    resCurrentTitle.textContent="Concurso —";
    resCurrentSub.textContent="Data —";
    resCurrentNums.innerHTML=`<div class="muted">Sem dados.</div>`;
    resCurrentPar.textContent="—";
    resCurrentSum.textContent="—";
    return;
  }
  resCurrentTitle.textContent = `Concurso ${current.concurso}`;
  resCurrentSub.textContent = `Data: ${current.data || "—"}`;

  const nums=current.dezenas||[];
  const par=computeEvenOdd(nums);
  resCurrentPar.textContent = `${par.even}P-${par.odd}I`;
  resCurrentSum.textContent = String(nums.reduce((a,b)=>a+b,0));

  // recency per number: delay = latestConcurso - last before latest; here delay=0 for current numbers, so use parity to color
  resCurrentNums.innerHTML="";
  for(const n of nums){
    const pill=document.createElement("div");
    const isEven = (n%2===0);
    pill.className = `num-pill recent ${isEven?"mid":""}`;
    pill.textContent=pad2(n);
    pill.title = `Dezena ${pad2(n)} (${isEven?"par":"ímpar"})`;
    resCurrentNums.appendChild(pill);
  }
}

function fillRecentTable(items, highlightConcurso=null){
  const range=clampInt(resHistRange?.value, 10, 50, 50);
  const slice = items.slice(-range).slice().reverse(); // newest first
  resRecentBody.innerHTML="";

  for(const it of slice){
    const tr=document.createElement("tr");
    if(highlightConcurso && Number(it.concurso)===Number(highlightConcurso)) tr.classList.add("hl");
    tr.innerHTML = `<td><b>${it.concurso}</b></td><td>${it.data||""}</td><td>${formatNums(it.dezenas)}</td>`;
    resRecentBody.appendChild(tr);
  }
}

async function refreshResults(){
  if(!resGame || !resBase) return;

  const game = String(resGame.value||"megasena");
  const meta = GAME_META[game];
  const baseN = Number(resBase.value||100);
  const contest = resConcurso && resConcurso.value ? clampInt(resConcurso.value, 1, 999999, null) : null;

  _resState.game=game;
  _resState.contest=contest;

  const allRes = await loadHistory(game, Math.max(200, baseN===1000000?999999:baseN*4));
  const allItems = (allRes.items||[]).slice().sort((a,b)=>a.concurso-b.concurso);
  const updatedAt = allRes.updatedAt || null;

  // Up to contest (if provided)
  let upTo = allItems;
  let current = allItems.at(-1) || null;

  if(contest){
    const idx = allItems.findIndex(x=>Number(x.concurso)===Number(contest));
    if(idx>=0){
      current = allItems[idx];
      upTo = allItems.slice(0, idx+1);
    }else{
      // if contest not found, use closest below
      const below = allItems.filter(x=>x.concurso<=contest);
      if(below.length){
        upTo = below;
        current = below.at(-1);
      }
    }
  }

  // Base window for stats
  const baseItems = (baseN>=1000000) ? upTo : upTo.slice(-Math.max(10, Math.min(baseN, upTo.length)));
  const prevItems = (baseN>=1000000) ? [] : upTo.slice(-Math.max(10, Math.min(baseN*2, upTo.length))).slice(0, Math.max(0, upTo.length-baseItems.length)).slice(-baseItems.length);

  _resState={all:allItems, upTo, baseItems, prevItems, updatedAt, game, contest};

  const latestConcurso = current?.concurso ?? (upTo.at(-1)?.concurso ?? 0);

  // Current card
  const lastMap = buildLastConcurso(upTo, meta.min, meta.max);
  setCurrentCard(meta, current, lastMap, latestConcurso);

  // Last update label
  if(resLastUpdate){
    const txt = updatedAt ? new Date(updatedAt).toLocaleString() : "—";
    resLastUpdate.textContent = `Última atualização: ${txt}`;
  }

  // Recent table (range)
  fillRecentTable(upTo, contest);

  // Frequency counts
  const freq = buildFreqCounts(baseItems, meta.min, meta.max);
  const last = buildLastConcurso(baseItems, meta.min, meta.max);

  // Delay per number
  const delay = new Array(meta.max+1).fill(null);
  for(let n=meta.min; n<=meta.max; n++){
    if(!last[n]) { delay[n]=null; continue; }
    delay[n] = latestConcurso - last[n];
  }

  // Trend vs prev window
  const trend = new Array(meta.max+1).fill(0);
  if(prevItems && prevItems.length){
    const freqPrev = buildFreqCounts(prevItems, meta.min, meta.max);
    const lenA = Math.max(1, baseItems.length);
    const lenB = Math.max(1, prevItems.length);
    for(let n=meta.min; n<=meta.max; n++){
      const rateA = freq[n]/lenA;
      const rateB = freqPrev[n]/lenB;
      trend[n] = (rateA-rateB);
    }
  }

  // Pie (even/odd totals)
  let evenTot=0, oddTot=0;
  for(const d of baseItems){
    const eo=computeEvenOdd(d.dezenas||[]);
    evenTot+=eo.even; oddTot+=eo.odd;
  }
  drawPie(resPie, evenTot, oddTot);
  const avgEven = (evenTot/Math.max(1, baseItems.length)).toFixed(2);
  const avgOdd  = (oddTot/Math.max(1, baseItems.length)).toFixed(2);
  if(resPieNote){
    resPieNote.textContent = `Média histórica (base): ${avgEven} pares / ${avgOdd} ímpares por concurso.`;
  }

  // Top 10 bars
  const top = [];
  for(let n=meta.min; n<=meta.max; n++) top.push({n, count:freq[n]||0});
  top.sort((a,b)=> b.count-a.count || a.n-b.n);
  drawHBar(resTopBars, top.slice(0,10));

  // Heatmap grid
  setHeatGrid(meta, freq, delay, trend, String(resSort?.value||"freq"));

  toast("ok","Atualizado","Resultados e visualizações recalculados.");
}

function initResultsViz(){
  if(!resGame || !resRefresh) return;

  // sync defaults: follow last selected game from page filters if available
  try{
    const url=new URL(location.href);
    const g=url.searchParams.get("game");
    if(g && (g==="megasena"||g==="lotofacil")) resGame.value=g;
  }catch{}

  resRefresh.addEventListener("click", ()=>refreshResults().catch(e=>toast("err","Erro", e.message||"Falha")));
  resSort?.addEventListener("change", ()=>refreshResults().catch(()=>{}));
  resHistRange?.addEventListener("change", ()=>fillRecentTable(_resState.upTo, _resState.contest));

  resHistSearch?.addEventListener("keydown", (ev)=>{
    if(ev.key!=="Enter") return;
    const v = resHistSearch.value ? clampInt(resHistSearch.value, 1, 999999, null) : null;
    if(!v) return;
    if(resConcurso) resConcurso.value=String(v);
    refreshResults().catch(e=>toast("err","Erro", e.message||"Falha"));
  });

  resHistClear?.addEventListener("click", ()=>{
    if(resConcurso) resConcurso.value="";
    if(resHistSearch) resHistSearch.value="";
    refreshResults().catch(()=>{});
  });

  resExportCsv?.addEventListener("click", exportTableCsv);
  resExportXls?.addEventListener("click", exportTableXls);

  // initial
  refreshResults().catch(()=>{});
}

initResultsViz();
