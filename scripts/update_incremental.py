import os, json, time, requests
from datetime import datetime

TOKEN = os.environ.get("LOT_TOKEN", "").strip()
BASE = "https://apiloterias.com.br/app/v2/resultado"
OUT_DIR = "data"

GAMES = ["megasena", "lotofacil"]

def die(msg: str):
    raise SystemExit(msg)

def get_json(url: str, retries=4, timeout=25):
    last = None
    for i in range(retries):
        try:
            r = requests.get(url, timeout=timeout)
            r.raise_for_status()
            js = r.json()
            if isinstance(js, dict):
                return js
            last = ValueError("JSON não é dict")
        except Exception as e:
            last = e
            time.sleep(1.6 ** i)
    raise RuntimeError(f"Falha GET: {url} -> {last}")

def url_latest(lot: str) -> str:
    return f"{BASE}?loteria={lot}&token={TOKEN}"

def url_contest(lot: str, n: int) -> str:
    return f"{BASE}?loteria={lot}&concurso={n}&token={TOKEN}"

def normalize(js: dict):
    concurso = js.get("concurso") or js.get("numero")
    data = js.get("data") or js.get("dataApuracao") or ""
    dezenas = js.get("dezenas") or js.get("listaDezenas") or []
    return {"concurso": int(concurso), "data": str(data), "dezenas": [int(x) for x in dezenas]}

def load_history(path: str, lot: str):
    if not os.path.exists(path):
        return {"loteria": lot, "updatedAt": "", "lastConcurso": 0, "items": []}
    with open(path, "r", encoding="utf-8") as f:
        obj = json.load(f) or {}
    obj.setdefault("loteria", lot)
    obj.setdefault("updatedAt", "")
    obj.setdefault("lastConcurso", 0)
    obj.setdefault("items", [])
    if not isinstance(obj["items"], list):
        obj["items"] = []
    return obj

def save_history(path: str, obj: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def main():
    if not TOKEN:
        die("ERRO: LOT_TOKEN não configurado. Crie o Secret LOT_TOKEN no GitHub (Settings > Secrets and variables > Actions).")

    os.makedirs(OUT_DIR, exist_ok=True)

    for lot in GAMES:
        path = os.path.join(OUT_DIR, f"history_{lot}.json")
        hist = load_history(path, lot)

        local_last = int(hist.get("lastConcurso", 0) or 0)
        latest = normalize(get_json(url_latest(lot)))
        api_last = latest["concurso"]

        if api_last <= local_last:
            hist["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            save_history(path, hist)
            print(f"{lot}: sem novidades (local={local_last}, api={api_last})")
            continue

        print(f"{lot}: atualizando {local_last+1} → {api_last}")
        for n in range(local_last + 1, api_last + 1):
            js = normalize(get_json(url_contest(lot, n)))
            hist["items"].append(js)

        hist["lastConcurso"] = api_last
        hist["updatedAt"] = datetime.utcnow().isoformat() + "Z"

        # manter um tamanho razoável (site leve)
        MAX_KEEP = 2000
        if len(hist["items"]) > MAX_KEEP:
            hist["items"] = hist["items"][-MAX_KEEP:]

        save_history(path, hist)
        print(f"{lot}: OK (last={api_last})")

if __name__ == "__main__":
    main()
