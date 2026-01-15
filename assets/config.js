// Mestre da Loteria – Sorte Certa
// Configuração central (modalidades, limites, chaves de storage)

export const GAME_META = {
  megasena:   { key:"megasena",   label:"Mega-Sena",  min:1, max:60, kMin:6,  kMax:15, premioMin:4 },
  lotofacil:  { key:"lotofacil",  label:"Lotofácil",  min:1, max:25, kMin:15, kMax:20, premioMin:11 },
};

export const STORAGE_KEYS = {
  // Meus Jogos (lista consolidada: Mega + Lotofácil)
  MY_GAMES: "mestre_loteria_meus_jogos_v2",
  DAILY_GAMES: "mestre_loteria_daily_games_v2",
  LAST_UPDATE: "mestre_loteria_last_update_v2",

  // Preferências por modalidade
  autoRelax: (game)=>`pref_${game}_autorelax_v1`,

  // Último concurso visto (para disparar atualização automática)
  lastSeen: (game)=>`mestre_loteria_last_seen_${game}_v1`,
};
