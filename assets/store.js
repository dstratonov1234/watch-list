// Отметки пользователя — где остановился и ответы опросников: window.WatchStore.
// Живут в localStorage этого браузера и в файле репозитория (ветка state) через GitHub API.
// Читать файл может кто угодно (репозиторий публичный), писать — только браузер, в котором введён токен.
(() => {
  "use strict";

  const LS_STATE = "wl-state";
  const LS_TOKEN = "wl-token";
  const LS_USER = "wl-user";
  const API = "https://api.github.com";
  // На локальном сервере отмечать можно без токена (отметки остаются в браузере); ?readonly — посмотреть, как видит посетитель.
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && !new URLSearchParams(location.search).has("readonly");

  let cfg = null; // { repo: "owner/name", branch, file } из data/titles.json → sync
  let state = { titles: {} };
  let remote = null; // последняя известная версия файла в репозитории
  let sha; // sha файла: undefined — ещё не знаем, null — файла нет
  let token = "";
  let user = "";
  let status = "init"; // off | readonly | synced | pending | saving | error
  let error = "";
  let pushTimer = 0;
  let pushing = false;
  let queued = false;
  let lastPull = 0;
  let message = "";
  const subs = new Set();

  const ls = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch {
        /* приватный режим — живём без сохранения */
      }
    },
  };

  // ---------- формат ----------
  // titles[id] = { w: { <partId>: <сколько посмотрено> }, wt: <мс>, last: <partId>, q: { a: {ответы}, s: оценка } | null, qt: <мс> }

  const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

  const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

  // Запись всегда в одном виде (порядок полей и ключей) — иначе две одинаковые отметки выглядели бы разными.
  function cleanEntry(e) {
    if (!e || typeof e !== "object") return null;
    const w = {};
    for (const [k, v] of Object.entries(e.w && typeof e.w === "object" ? e.w : {})) if (int(v) > 0) w[String(k)] = int(v);
    const out = { w: sortKeys(w), wt: int(e.wt) };
    if (typeof e.last === "string") out.last = e.last;
    if (e.q && typeof e.q === "object" && e.q.a && typeof e.q.a === "object") {
      out.q = { a: sortKeys(e.q.a), s: e.q.s != null && Number.isFinite(Number(e.q.s)) ? Number(e.q.s) : null };
    } else out.q = null;
    out.qt = int(e.qt);
    return out;
  }

  function cleanState(s) {
    const titles = {};
    for (const [id, e] of Object.entries(s?.titles && typeof s.titles === "object" ? s.titles : {})) {
      const c = cleanEntry(e);
      if (c) titles[id] = c;
    }
    return { titles };
  }

  // Новее — та отметка, что поставлена позже; прогресс и опросник сливаются независимо.
  function mergeEntry(a, b) {
    if (!a) return b;
    if (!b) return a;
    const W = b.wt > a.wt ? b : a;
    const Q = b.qt > a.qt ? b : a;
    const out = { w: { ...W.w }, wt: W.wt, q: Q.q, qt: Q.qt };
    if (W.last) out.last = W.last;
    return out;
  }

  function mergeStates(a, b) {
    const titles = {};
    for (const id of new Set([...Object.keys(a.titles), ...Object.keys(b.titles)])) titles[id] = mergeEntry(a.titles[id], b.titles[id]);
    return { titles };
  }

  function serialize(s) {
    const titles = {};
    for (const id of Object.keys(s.titles).sort()) titles[id] = cleanEntry(s.titles[id]);
    return JSON.stringify({ v: 1, titles }, null, 2) + "\n";
  }

  const dirty = () => !remote || serialize(state) !== serialize(remote);

  // ---------- GitHub ----------

  const b64 = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

  const headers = (t = token) => ({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  });

  const fileUrl = () => `${API}/repos/${cfg.repo}/contents/${cfg.file}`;

  // Свежая версия файла из репозитория. Без токена GitHub даёт 60 запросов в час с адреса —
  // если лимит вышел, берём копию с raw.githubusercontent.com (отстаёт до пяти минут).
  async function pull(t = token) {
    const res = await fetch(`${fileUrl()}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers(t), cache: "no-store" });
    if (res.status === 404) {
      sha = null;
      remote = { titles: {} };
    } else if (res.ok) {
      const j = await res.json();
      sha = j.sha;
      remote = cleanState(JSON.parse(unb64(j.content)));
    } else if (!t && (res.status === 403 || res.status === 429)) {
      const raw = await fetch(`https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/${cfg.file}`, { cache: "no-store" });
      if (!raw.ok) throw new Error(`GitHub ответил ${raw.status}`);
      sha = undefined;
      remote = cleanState(await raw.json());
    } else {
      throw new Error(res.status === 401 ? "GitHub не принял токен" : `GitHub ответил ${res.status}`);
    }
    lastPull = Date.now();
    return remote;
  }

  async function put(t, text, msg) {
    return fetch(fileUrl(), {
      method: "PUT",
      headers: { ...headers(t), "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, content: b64(text), branch: cfg.branch, ...(sha ? { sha } : {}) }),
      keepalive: text.length < 40000,
    });
  }

  // Записать текущее состояние в репозиторий. Если файл успели изменить с другого устройства —
  // забрать его, слить и повторить.
  async function push(t = token, force = false) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (sha === undefined) {
        await pull(t);
        adopt(mergeStates(state, remote));
      }
      if (!force && !dirty()) return;
      const text = serialize(state);
      const res = await put(t, text, message || "Отметка");
      if (res.ok) {
        sha = (await res.json()).content?.sha;
        remote = cleanState(JSON.parse(text));
        message = "";
        return;
      }
      if (res.status === 409 || res.status === 422) {
        sha = undefined;
        continue;
      }
      if (res.status === 401) throw new Error("GitHub не принял токен");
      if (res.status === 403 || res.status === 404) throw new Error("У токена нет права записи в репозиторий (нужно Contents: Read and write)");
      throw new Error(`GitHub ответил ${res.status}`);
    }
    throw new Error("Не удалось записать: файл меняется с другого устройства");
  }

  // ---------- состояние ----------

  function saveLocal() {
    ls.set(LS_STATE, JSON.stringify(state));
  }

  function adopt(next) {
    const changed = serialize(next) !== serialize(state);
    state = next;
    if (changed) saveLocal();
    return changed;
  }

  function setStatus(s, err = "") {
    const changed = s !== status || err !== error;
    status = s;
    error = err;
    return changed;
  }

  function emit(kind) {
    for (const fn of [...subs]) {
      try {
        fn(kind);
      } catch (e) {
        console.error(e);
      }
    }
  }

  const settled = () => (!cfg ? "off" : !token ? "readonly" : dirty() ? "pending" : "synced");

  async function flush() {
    clearTimeout(pushTimer);
    pushTimer = 0;
    if (!cfg || !token) return;
    if (pushing) {
      queued = true;
      return;
    }
    pushing = true;
    setStatus("saving");
    emit("sync");
    try {
      await push();
      setStatus(settled());
    } catch (e) {
      setStatus("error", e.message);
    }
    pushing = false;
    emit("sync");
    if (queued) {
      queued = false;
      flush();
    }
  }

  function commit(msg) {
    saveLocal();
    message = msg;
    if (cfg && token) {
      setStatus("pending");
      clearTimeout(pushTimer);
      pushTimer = setTimeout(flush, 1200);
    }
    emit("change");
  }

  function ensure(id) {
    return (state.titles[id] ??= { w: {}, wt: 0, q: null, qt: 0 });
  }

  async function refresh(force = false) {
    if (!cfg || pushing || pushTimer) return;
    if (!force && Date.now() - lastPull < 30000) return;
    try {
      await pull();
      const changed = adopt(mergeStates(state, remote));
      setStatus(settled());
      if (token && dirty()) flush();
      emit(changed ? "change" : "sync");
    } catch (e) {
      setStatus(token ? "error" : settled(), token ? e.message : "");
      emit("sync");
    }
  }

  const Store = {
    // Запуск: отметки этого браузера сразу, свежая версия из репозитория — следом.
    async init(sync) {
      try {
        state = cleanState(JSON.parse(ls.get(LS_STATE) ?? "{}"));
      } catch {
        state = { titles: {} };
      }
      const ok = sync && /^[\w.-]+\/[\w.-]+$/.test(sync.repo ?? "");
      cfg = ok ? { repo: sync.repo, branch: sync.branch || "state", file: sync.file || "progress.json" } : null;
      token = cfg ? (ls.get(LS_TOKEN) ?? "") : "";
      user = ls.get(LS_USER) ?? "";
      setStatus(settled());
      if (cfg) await refresh(true);
    },

    entry(id) {
      return state.titles[id] ?? { w: {}, wt: 0, q: null, qt: 0 };
    },

    // Отмечать можно, когда подключён токен; на локальном сервере — всегда (отметки останутся в браузере).
    canEdit: () => !!token || isLocal,

    setWatched(id, partId, n) {
      const e = ensure(id);
      n = int(n);
      if ((e.w[partId] ?? 0) === n && e.last === partId) return;
      e.w = { ...e.w };
      if (n) e.w[partId] = n;
      else delete e.w[partId];
      e.wt = Date.now();
      e.last = partId;
      commit(`Прогресс: ${id} ${partId}=${n}`);
    },

    setQuiz(id, answers, score) {
      const e = ensure(id);
      e.q = { a: answers, s: score };
      e.qt = Date.now();
      commit(`Оценка: ${id} ${score ?? "—"}`);
    },

    clearQuiz(id) {
      const e = ensure(id);
      if (!e.q) return;
      e.q = null;
      e.qt = Date.now();
      commit(`Оценка снята: ${id}`);
    },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    info: () => ({ status, error, user, configured: !!cfg, connected: !!token, repo: cfg?.repo ?? "", branch: cfg?.branch ?? "", local: isLocal }),

    refresh,
    flush,

    // Подключить токен: проверяем чтение и запись (пробная запись того же состояния), и только потом запоминаем.
    async connect(t) {
      t = String(t ?? "").trim();
      if (!cfg) throw new Error("Синхронизация не настроена");
      if (!t) throw new Error("Вставь токен");
      const repo = await fetch(`${API}/repos/${cfg.repo}`, { headers: headers(t), cache: "no-store" });
      if (repo.status === 401) throw new Error("GitHub не принял токен");
      if (!repo.ok) throw new Error("У токена нет доступа к репозиторию");
      await pull(t);
      adopt(mergeStates(state, remote));
      message = "Подключено устройство";
      await push(t, true);
      let login = "";
      try {
        const me = await fetch(`${API}/user`, { headers: headers(t), cache: "no-store" });
        if (me.ok) login = (await me.json()).login ?? "";
      } catch {
        /* имя — только для подписи */
      }
      token = t;
      user = login;
      ls.set(LS_TOKEN, t);
      ls.set(LS_USER, login || null);
      setStatus(settled());
      emit("change");
    },

    disconnect() {
      token = "";
      user = "";
      ls.set(LS_TOKEN, null);
      ls.set(LS_USER, null);
      setStatus(settled());
      emit("change");
    },
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
    else if (pushTimer) flush(); // уходим со страницы — дописать сразу
  });
  window.addEventListener("pagehide", () => pushTimer && flush());
  window.addEventListener("online", () => token && dirty() && flush());

  window.WatchStore = Store;
})();
