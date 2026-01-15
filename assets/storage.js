// Mestre da Loteria – Sorte Certa
// Camada única de LocalStorage (safe JSON + chaves padronizadas)

import { STORAGE_KEYS } from "./config.js";

function safeParse(json, fallback){
  try{
    const v = JSON.parse(json);
    return v ?? fallback;
  }catch{ return fallback; }
}

export function getItem(key, fallback=null){
  try{
    const v = localStorage.getItem(key);
    return v===null ? fallback : v;
  }catch{ return fallback; }
}

export function setItem(key, value){
  try{ localStorage.setItem(key, String(value)); }catch{}
}

export function getJson(key, fallback){
  const raw = getItem(key, null);
  if(raw===null) return fallback;
  return safeParse(raw, fallback);
}

export function setJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
}

export function getBool(key, fallback=false){
  const v = getItem(key, null);
  if(v===null) return fallback;
  return String(v).toLowerCase()==="true";
}

export function setBool(key, value){
  setItem(key, value ? "true" : "false");
}

/* Preferências */
export function getAutoRelax(game, fallback=true){
  return getBool(STORAGE_KEYS.autoRelax(game), fallback);
}
export function setAutoRelax(game, value){
  setBool(STORAGE_KEYS.autoRelax(game), !!value);
}

/* Last seen concurso */
export function getLastSeenConcurso(game){
  const v = getItem(STORAGE_KEYS.lastSeen(game), null);
  if(v===null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function setLastSeenConcurso(game, concurso){
  if(concurso==null) return;
  setItem(STORAGE_KEYS.lastSeen(game), String(concurso));
}

/* Meus Jogos (lista consolidada) */
export function loadMyGames(){
  const arr = getJson(STORAGE_KEYS.MY_GAMES, []);
  return Array.isArray(arr) ? arr : [];
}
export function saveMyGames(items){
  setJson(STORAGE_KEYS.MY_GAMES, Array.isArray(items) ? items : []);
}


/* Jogos do dia */
export function loadDailyGames(){
  const obj = getJson(STORAGE_KEYS.DAILY_GAMES, {megasena:[], lotofacil:[]});
  return (obj && typeof obj==="object") ? obj : {megasena:[], lotofacil:[]};
}
export function saveDailyGames(obj){
  setJson(STORAGE_KEYS.DAILY_GAMES, obj || {megasena:[], lotofacil:[]});
}

/* Última atualização (timestamp ISO) */
export function getLastUpdateISO(){
  return getItem(STORAGE_KEYS.LAST_UPDATE, null);
}
export function setLastUpdateISO(iso){
  if(!iso) return;
  setItem(STORAGE_KEYS.LAST_UPDATE, iso);
}