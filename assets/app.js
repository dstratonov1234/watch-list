(() => {
  "use strict";

  const Store = window.WatchStore;

  const els = {
    listView: document.getElementById("list-view"),
    search: document.getElementById("search"),
    list: document.getElementById("list"),
    titleView: document.getElementById("title-view"),
    lightbox: document.getElementById("lightbox"),
    lbImg: document.getElementById("lb-img"),
    lbCaption: document.getElementById("lb-caption"),
    syncBtn: document.getElementById("sync-btn"),
    syncDialog: document.getElementById("sync-dialog"),
    toast: document.getElementById("toast"),
  };

  const state = {
    titles: [],
    byId: new Map(),
    query: "",
    collapsed: new Set(),
    current: null,
    entering: false,
    arriving: false,
    listScroll: 0,
    extraCache: new Map(), // id → { episodes, quiz }
    franchises: {}, // data/franchises.json: порядок просмотра частей одной серии (сезоны, фильмы)
    // Версия кода и данных (titles.json → build) — добавляется к файлам тем, чтобы после обновления не висел старый кэш.
    version: "",
    pageToken: 0,
    handoff: null, // начало заставки, сыгранное на главной (cover), — ждёт страницу тайтла
    lightbox: { items: [], index: 0 },
  };

  const SITE_TITLE = "Watch List";

  // ---------- темы тайтлов ----------
  // theme в titles.json: цвета, шрифты, частицы и текстуры конкретного тайтла. Применяется к его баннеру
  // (переменные на .themed-card) и ко всей странице тайтла (переменные + .themed на <html>).

  const COLOR_RE = /^#[0-9a-f]{3,8}$/i;
  const FONT_RE = /^[\w\s-]+$/;
  const TEXTURES = { front: ["vignette", "grain", "scanlines"], back: ["glow", "fog", "paper", "halftone"] };
  const DEFAULT_THEME_COLOR = document.querySelector('meta[name="theme-color"]')?.content ?? "#0b0c10";
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  function luminance(hex) {
    const h = hex.replace("#", "");
    const full = h.length <= 4 ? [...h.slice(0, 3)].map((c) => c + c).join("") : h.slice(0, 6);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const fx = { front: null, back: null, vars: [] };

  function themeVars(t) {
    if (!t || ![t.bg, t.surface, t.text, t.accent].every((c) => COLOR_RE.test(c ?? ""))) return null;
    const sans = "Inter, system-ui, sans-serif";
    const font = (name) => (FONT_RE.test(name ?? "") ? `'${name}', ${sans}` : sans);
    const radius = clamp(Number(t.radius ?? 14) || 0, 0, 28);
    return {
      "--t-scheme": luminance(t.bg) < 0.35 ? "dark" : "light",
      "--t-radius-pill": radius < 8 ? `${radius}px` : "999px",
      "--t-bg": t.bg,
      "--t-surface": t.surface,
      "--t-text": t.text,
      "--t-accent": t.accent,
      "--t-accent-2": COLOR_RE.test(t.accent2 ?? "") ? t.accent2 : t.accent,
      "--t-display": font(t.displayFont ?? t.headingFont),
      "--t-heading": font(t.headingFont),
      "--t-body": font(t.bodyFont),
      "--t-body-size": `${clamp(Number(t.bodySize) || 15, 13, 20)}px`,
      "--t-radius": `${radius}px`,
      "--t-heading-case": t.headingCase === "uppercase" ? "uppercase" : "none",
      "--t-heading-weight": String(clamp(Number(t.headingWeight) || 700, 300, 900)),
      "--t-heading-spacing": /^-?\d*\.?\d+em$/.test(t.headingSpacing ?? "") ? t.headingSpacing : "0em",
      "--t-hero-pos": /^[\w\s%.-]+$/.test(t.heroPosition ?? "") ? t.heroPosition : "center 30%",
    };
  }

  const styleAttr = (vars) => (vars ? Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";") : "");

  function loadStylesheet(href) {
    if (document.querySelector(`link[data-src="${CSS.escape(href)}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.src = href;
    document.head.append(link);
  }

  // Шрифты всех тем и их собственные css грузятся сразу: баннеры в списке тоже оформлены.
  function loadThemeAssets(titles) {
    for (const t of titles) {
      if (!themeVars(t.theme)) continue;
      for (const spec of t.theme.fonts ?? []) {
        if (/^[\w\s:@;,.+-]+$/.test(spec)) loadStylesheet(`https://fonts.googleapis.com/css2?family=${spec.trim().replace(/ /g, "+")}&display=swap`);
      }
      if (t.theme.css === true) loadStylesheet(`themes/${encodeURIComponent(t.id)}/theme.css?v=${state.version}`);
    }
  }

  // ---------- модули тайтлов: themes/<id>/theme.js ----------
  // Модуль даёт тайтлу собственный UI/UX/VFX: TitleThemes.register("<id>", { banner, stage, cover, page }).
  // Всё, что зарегистрировано через ctx (listen, loop, layer, onCleanup, onChange), убирается при уходе со страницы.

  const modules = { registry: new Map(), loading: new Map(), cleanups: [], changeFns: [], token: 0, active: false };

  window.TitleThemes = {
    register(id, mod) {
      modules.registry.set(id, mod);
    },
  };

  function loadModule(id) {
    if (modules.registry.has(id)) return Promise.resolve(modules.registry.get(id));
    if (!modules.loading.has(id)) {
      modules.loading.set(
        id,
        new Promise((resolve) => {
          const s = document.createElement("script");
          s.src = `themes/${encodeURIComponent(id)}/theme.js?v=${state.version}`;
          s.onload = () => resolve(modules.registry.get(id) ?? null);
          s.onerror = () => resolve(null);
          document.head.append(s);
        }),
      );
    }
    return modules.loading.get(id);
  }

  // ---------- helpers ----------

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // Чем меряется тайтл: серии, главы, тома, фильмы, части.
  const UNITS = {
    episode: ["серия", "серии", "серий"],
    chapter: ["глава", "главы", "глав"],
    volume: ["том", "тома", "томов"],
    film: ["фильм", "фильма", "фильмов"],
    part: ["часть", "части", "частей"],
  };
  const unitWord = (unit, n) => plural(Math.abs(n), ...(UNITS[unit] ?? UNITS.episode));

  const fmtScore = (s) => (s == null ? "" : Number(s).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

  function hashHue(str) {
    let h = 0;
    for (const ch of str) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % 360;
  }

  const gradient = (title) => {
    const hue = hashHue(title);
    return `linear-gradient(135deg,hsl(${hue} 55% 38%),hsl(${(hue + 40) % 360} 60% 22%))`;
  };

  const unique = (arr) => [...new Set(arr.filter(Boolean))];

  // <img>, который при ошибке идёт по запасным адресам; в конце просто убирает себя.
  function imgTag(urls, attrs = "") {
    const [first, ...rest] = unique(urls.map(safeUrl));
    if (!first) return "";
    return `<img src="${esc(first)}" data-fallbacks="${esc(rest.join(" "))}" ${attrs}>`;
  }

  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.hasAttribute("data-fallbacks")) return;
      const [next, ...rest] = img.dataset.fallbacks.split(" ").filter(Boolean);
      if (next) {
        img.dataset.fallbacks = rest.join(" ");
        img.src = next;
        return;
      }
      if (img.classList.contains("hero-logo")) img.closest(".hero")?.classList.remove("has-logo");
      if (img.classList.contains("tb-logo")) img.closest(".tbanner")?.classList.remove("has-logo");
      img.remove();
    },
    true,
  );

  const heroUrls = (t) => [t.hero, t.cover];
  const logoUrls = (t) => [t.logo];
  const coverUrls = (t) => [t.cover, t.hero];
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- прогресс ----------
  // Тайтл состоит из частей (сезон, том, фильм) — у каждой своё число серий/глав. Отметка — сколько
  // в части уже посмотрено; «где остановился» — последняя тронутая часть.

  function progressOf(t) {
    const e = Store.entry(t.id);
    const parts = (t.parts ?? []).map((p) => {
      const count = Math.max(0, Math.floor(Number(p.count) || 0));
      return { id: String(p.id), title: p.title ?? "", unit: p.unit ?? "episode", count, watched: clamp(Number(e.w[p.id]) || 0, 0, count) };
    });
    const watched = parts.reduce((s, p) => s + p.watched, 0);
    const total = parts.reduce((s, p) => s + p.count, 0);
    const status = !watched ? "planned" : watched >= total && !t.ongoing ? "completed" : "watching";
    const lastPart = parts.find((p) => p.id === e.last && p.watched) ?? [...parts].reverse().find((p) => p.watched) ?? null;
    const nextPart = lastPart && lastPart.watched < lastPart.count ? lastPart : (parts.find((p) => p.watched < p.count) ?? null);
    return {
      parts,
      watched,
      total,
      status,
      last: lastPart ? { part: lastPart, n: lastPart.watched } : null,
      next: nextPart ? { part: nextPart, n: nextPart.watched + 1 } : null,
      score: scoreOf(t),
    };
  }

  const scoreOf = (t) => {
    const s = Store.entry(t.id).q?.s;
    return s == null ? null : Number(s);
  };

  // ---------- опросник ----------
  // data/quiz/<id>.json — вопросы под конкретный тайтл. У каждого ответа скрытый вес от 0 до 1;
  // оценка = 10 × (сумма вес_вопроса × вес_ответа) / (сумма весов вопросов), с точностью до 0,1.

  function questionValue(q, a) {
    if (a == null) return null;
    if (q.type === "scale") {
      const min = Number(q.min ?? 1), max = Number(q.max ?? 5);
      if (!Number.isFinite(Number(a)) || max <= min) return null;
      const v = clamp((Number(a) - min) / (max - min), 0, 1);
      return q.reverse ? 1 - v : v;
    }
    if (q.type === "multi") {
      if (!Array.isArray(a)) return null;
      const picked = (q.options ?? []).filter((o) => a.includes(o.id));
      return clamp(Number(q.base ?? 0) + picked.reduce((s, o) => s + (Number(o.value) || 0), 0), 0, 1);
    }
    const opt = (q.options ?? []).find((o) => o.id === a);
    return opt && opt.value != null ? clamp(Number(opt.value) || 0, 0, 1) : null; // value: null — «не помню», в оценку не идёт
  }

  const isAnswered = (q, a) => (q.type === "multi" ? Array.isArray(a) : q.type === "scale" ? Number.isFinite(Number(a)) && a !== null && a !== "" : (q.options ?? []).some((o) => o.id === a));

  function scoreQuiz(quiz, answers) {
    let sum = 0, wsum = 0, answered = 0;
    const questions = quiz?.questions ?? [];
    for (const q of questions) {
      const a = answers?.[q.id];
      if (!isAnswered(q, a)) continue;
      answered++;
      const v = questionValue(q, a);
      if (v == null) continue;
      const w = Number(q.weight ?? 1) || 0;
      sum += w * v;
      wsum += w;
    }
    return { score: wsum ? Math.round((sum / wsum) * 100) / 10 : null, answered, total: questions.length, complete: questions.length > 0 && answered === questions.length };
  }

  // Словесный вердикт под оценку: quiz.verdicts = [{ min, label, text }], берётся самый высокий подходящий порог.
  function verdictFor(quiz, score) {
    if (score == null) return null;
    return [...(quiz?.verdicts ?? [])].sort((a, b) => b.min - a.min).find((v) => score >= v.min) ?? null;
  }

  // Прохождение опросника: ход по вопросам и ответы-черновик, которые переживают закрытие окна и перезагрузку
  // (sessionStorage). Логика у всех тайтлов одна — тема только рисует вопросы в своём образе и зовёт эти методы.
  function quizRun(t, quiz) {
    const qs = quiz?.questions ?? [];
    const key = `wl-draft:${t.id}`;
    const run = { answers: {}, i: 0, draft: false };
    try {
      const d = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (d && d.a && typeof d.a === "object") Object.assign(run, { answers: d.a, i: clamp(Number(d.i) || 0, 0, Math.max(0, qs.length - 1)), draft: true });
    } catch {
      /* битый черновик — начнём заново */
    }
    const save = () => {
      run.draft = true;
      try {
        sessionStorage.setItem(key, JSON.stringify({ a: run.answers, i: run.i }));
      } catch {
        /* без памяти вкладки черновик живёт до ухода со страницы */
      }
    };
    const drop = () => {
      run.draft = false;
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* нечего чистить */
      }
    };
    const answered = (q) => isAnswered(q, run.answers[q.id]);
    return {
      questions: qs,
      get i() {
        return run.i;
      },
      get answers() {
        return run.answers;
      },
      get draft() {
        return run.draft;
      },
      get question() {
        return qs[run.i] ?? null;
      },
      get last() {
        return run.i === qs.length - 1;
      },
      answered,
      // Начать или продолжить. Без черновика — с первого вопроса и с прежними ответами, если опросник уже проходили.
      start() {
        if (!run.draft) {
          run.answers = JSON.parse(JSON.stringify(Store.entry(t.id).q?.a ?? {}));
          run.i = 0;
        }
        return run.i;
      },
      // Ответ на текущий вопрос (у multi — переключить вариант). true — можно сразу идти к следующему вопросу.
      pick(value) {
        const q = qs[run.i];
        if (!q) return false;
        if (q.type === "multi") {
          const cur = new Set(Array.isArray(run.answers[q.id]) ? run.answers[q.id] : []);
          cur.has(value) ? cur.delete(value) : cur.add(value);
          run.answers[q.id] = (q.options ?? []).map((o) => o.id).filter((id) => cur.has(id));
          save();
          return false;
        }
        run.answers[q.id] = q.type === "scale" ? Number(value) : value;
        save();
        return run.i < qs.length - 1;
      },
      go(delta) {
        const n = run.i + delta;
        if (n < 0 || n >= qs.length) return false;
        const q = qs[run.i];
        if (delta > 0 && q.type === "multi" && !Array.isArray(run.answers[q.id])) run.answers[q.id] = []; // пустой выбор — тоже ответ
        run.i = n;
        save();
        return true;
      },
      get canNext() {
        const q = qs[run.i];
        return !!q && (q.type === "multi" || answered(q));
      },
      get canSubmit() {
        return qs.length > 0 && qs.every((q, k) => answered(q) || (k === run.i && q.type === "multi"));
      },
      firstUnanswered: () => qs.findIndex((q) => !answered(q)),
      jump(n) {
        run.i = clamp(n, 0, Math.max(0, qs.length - 1));
      },
      // Сохранить ответы и оценку. null — если отвечено не на всё или отмечать в этом браузере нельзя.
      submit() {
        const q = qs[run.i];
        if (q?.type === "multi" && !Array.isArray(run.answers[q.id])) run.answers[q.id] = [];
        const r = scoreQuiz(quiz, run.answers);
        if (!r.complete || !Store.canEdit()) return null;
        drop();
        Store.setQuiz(t.id, run.answers, r.score);
        return { score: r.score, verdict: verdictFor(quiz, r.score) };
      },
    };
  }

  function quizState(t, quiz) {
    const q = Store.entry(t.id).q;
    if (!q) return null;
    return { answers: q.a, score: q.s, verdict: verdictFor(quiz, q.s) };
  }

  // ---------- данные тайтла: серии и опросник ----------

  async function loadExtra(t) {
    if (!state.extraCache.has(t.id)) {
      const get = async (on, dir) => {
        if (on !== true) return null;
        const res = await fetch(`data/${dir}/${encodeURIComponent(t.id)}.json?v=${state.version}`, { cache: "no-cache" }).catch(() => null);
        return res?.ok ? res.json().catch(() => null) : null;
      };
      const [episodes, quiz] = await Promise.all([get(t.episodes, "episodes"), get(t.quiz, "quiz")]);
      state.extraCache.set(t.id, { episodes, quiz });
    }
    return state.extraCache.get(t.id);
  }

  // Части с сериями: { id, title, unit, count, watched, episodes: [{ n, title, image, watched }] }
  function partsView(t, extra) {
    return progressOf(t).parts.map((part) => {
      const byN = new Map((extra?.episodes?.parts?.[part.id] ?? []).map((x) => [Number(x.n), x]));
      return {
        ...part,
        episodes: Array.from({ length: part.count }, (_, i) => {
          const x = byN.get(i + 1) ?? {};
          return { n: i + 1, title: x.title ?? "", image: safeUrl(x.image), watched: i + 1 <= part.watched };
        }),
      };
    });
  }

  function setWatched(t, partId, n) {
    const part = (t.parts ?? []).find((p) => String(p.id) === String(partId));
    if (!part || !Store.canEdit()) return;
    Store.setWatched(t.id, String(part.id), clamp(Math.floor(Number(n) || 0), 0, Math.max(0, Number(part.count) || 0)));
  }

  function markNext(t) {
    const next = progressOf(t).next;
    if (next) setWatched(t, next.part.id, next.n);
  }

  // ---------- контекст темы ----------

  // Общее для главной (banner, stage) и страницы: запись тайтла, прогресс, оценка, картинки с запасными адресами.
  function themeBase(t, extra) {
    const hasLogo = unique(logoUrls(t).map(safeUrl)).length > 0;
    const p = progressOf(t);
    return {
      item: t,
      assets: `themes/${encodeURIComponent(t.id)}/assets/`,
      progress: p,
      score: p.score,
      chain: chainOf(t),
      reducedMotion: reduceMotion(),
      finePointer: window.matchMedia("(pointer: fine)").matches,
      art: {
        hero: (attrs = 'alt=""') => imgTag(heroUrls(t), attrs),
        logo: (attrs = 'alt=""') => (hasLogo ? imgTag(logoUrls(t), attrs) : ""),
        cover: (attrs = 'alt=""') => imgTag(coverUrls(t), attrs),
      },
      esc,
      safeUrl,
      plural,
      unitWord,
      fmtScore,
      ...extra,
    };
  }

  // Тема строит свой баннер целиком: banner(b), b.el — <a class="tbanner">, его содержимое тема заменяет.
  // Пока модуль грузится, баннер скрыт (.module-pending), чтобы не мелькал общий вид.
  function decorateBanners() {
    for (const el of els.list.querySelectorAll(".tbanner")) {
      const t = state.byId.get(el.dataset.title);
      if (t?.theme?.js !== true) continue;
      const mod = modules.registry.get(t.id);
      if (mod) {
        buildBanner(mod, t, el);
        continue;
      }
      el.classList.add("module-pending");
      const reveal = setTimeout(() => el.classList.remove("module-pending"), 2500);
      loadModule(t.id).then((m) => {
        clearTimeout(reveal);
        if (m && el.isConnected) buildBanner(m, t, el);
        el.classList.remove("module-pending");
        if (m?.stage) rebuildStage(t);
      });
    }
  }

  function buildBanner(mod, t, el) {
    if (!mod.banner || el.classList.contains("custom")) return;
    try {
      mod.banner(themeBase(t, { el }));
      el.classList.add("custom");
    } catch (e) {
      console.error(`theme ${t.id} banner:`, e);
    }
  }

  function unmountModule() {
    modules.token++;
    modules.active = false;
    modules.changeFns = [];
    for (const fn of modules.cleanups.splice(0).reverse()) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
    els.titleView.classList.remove("module-pending");
  }

  // Заставка, начатая на главной (cover), передаётся странице тайтла: её слои уже закрывают экран,
  // page() должна их открыть и убрать. Если модуль не справился — страховка убирает их через 6 с.
  function takeHandoff(t, cleanups) {
    const handoff = state.handoff?.id === t.id ? state.handoff : null;
    if (!handoff) return null;
    state.handoff = null;
    const drop = () => handoff.layers.forEach((el) => el.remove());
    const safety = setTimeout(drop, 6000);
    cleanups.push(() => (clearTimeout(safety), drop()));
    return { layers: handoff.layers, data: handoff.data };
  }

  function makeCtx(t, extra) {
    const root = els.titleView;
    const cleanups = modules.cleanups;
    const handoff = takeHandoff(t, cleanups);
    const quiz = extra?.quiz ?? null;
    return {
      // { layers, data } — если вход был с главной и тема сыграла начало заставки в cover(); иначе null
      handoff,
      item: t,
      root,
      html: document.documentElement,
      assets: `themes/${encodeURIComponent(t.id)}/assets/`,
      reducedMotion: reduceMotion(),
      finePointer: window.matchMedia("(pointer: fine)").matches,
      // --- прогресс: всегда свежий снимок; после любой отметки вызываются функции из onChange ---
      parts: () => partsView(t, extra),
      progress: () => progressOf(t),
      canEdit: () => Store.canEdit(),
      // Браузер ещё не подключён к отметкам (а сайт это умеет): тема может предложить подключить прямо
      // со страницы — connect() открывает окно; после подключения страница соберётся заново уже с кнопками.
      canConnect: () => {
        const i = Store.info();
        return i.configured && !i.connected;
      },
      connect: () => openSync(),
      setWatched: (partId, n) => setWatched(t, partId, n),
      markNext: () => markNext(t),
      // --- опросник ---
      quiz,
      quizState: () => quizState(t, quiz),
      scoreQuiz: (answers) => scoreQuiz(quiz, answers),
      verdictFor: (score) => verdictFor(quiz, score),
      saveQuiz(answers) {
        if (!quiz || !Store.canEdit()) return null;
        const r = scoreQuiz(quiz, answers);
        Store.setQuiz(t.id, answers, r.score);
        return r.score;
      },
      clearQuiz: () => Store.canEdit() && Store.clearQuiz(t.id),
      // прохождение опросника с черновиком: { questions, i, question, last, answers, draft, start(), pick(v), go(±1),
      // canNext, canSubmit, firstUnanswered(), jump(n), submit() → { score, verdict } }
      quizRun: () => quizRun(t, quiz),
      onChange: (fn) => modules.changeFns.push(fn),
      // соседние тайтлы по порядку списка: { id, title, href } или null — для своей навигации темы
      neighbors: neighborsOf(t),
      // место тайтла в серии (сезоны, фильмы по порядку просмотра): { id, title, index, total, prev, next } или null;
      // prev/next — { title, href, added, released, status }: href есть, только если эта часть уже добавлена на сайт
      chain: () => chainOf(t),
      // сверка «то ли я смотрю»: { original, year, length, facts: [...], links: [{ label, href }] } — показать в образе
      // тайтла; ссылки ведут на карточку этой части в базах — открывать в новой вкладке
      ident: () => identOf(t),
      art: themeBase(t).art,
      esc,
      safeUrl,
      plural,
      unitWord,
      fmtScore,
      onCleanup: (fn) => cleanups.push(fn),
      listen(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        cleanups.push(() => target.removeEventListener(type, fn, opts));
      },
      loop(fn) {
        let id;
        let last = performance.now();
        const tick = (now) => {
          fn(now, Math.min(0.05, (now - last) / 1000));
          last = now;
          id = requestAnimationFrame(tick);
        };
        id = requestAnimationFrame(tick);
        cleanups.push(() => cancelAnimationFrame(id));
      },
      layer(className, parent = document.body) {
        const el = document.createElement("div");
        el.className = className;
        el.setAttribute("aria-hidden", "true");
        parent.append(el);
        cleanups.push(() => el.remove());
        return el;
      },
      fx: window.GameFX,
    };
  }

  async function mountModule(t, extra) {
    if (t.theme?.js !== true) return;
    const token = ++modules.token;
    els.titleView.classList.add("module-pending");
    const reveal = setTimeout(() => els.titleView.classList.remove("module-pending"), 2500);
    const mod = await loadModule(t.id);
    clearTimeout(reveal);
    if (token !== modules.token) return;
    els.titleView.classList.remove("module-pending");
    if (!mod?.page) return;
    try {
      modules.active = true;
      const cleanup = mod.page(makeCtx(t, extra));
      if (typeof cleanup === "function") modules.cleanups.push(cleanup);
    } catch (e) {
      modules.active = false;
      console.error(`theme ${t.id}:`, e);
    }
  }

  // cover(tctx): начало заставки тайтла, которое играет ещё на главной сразу после клика по баннеру.
  // Должна вернуть Promise, который выполнится, когда экран полностью закрыт. Слои создавать через tctx.layer().
  function makeCoverCtx(t) {
    dropHandoff();
    const handoff = { id: t.id, layers: [], data: {} };
    state.handoff = handoff;
    // На главной переменные темы (--t-display и др.) есть только у баннера — слоям заставки их даём сами.
    const vars = styleAttr(themeVars(t.theme));
    return {
      item: t,
      assets: `themes/${encodeURIComponent(t.id)}/assets/`,
      progress: progressOf(t),
      finePointer: window.matchMedia("(pointer: fine)").matches,
      data: handoff.data,
      esc,
      layer(className, parent = document.body) {
        const el = document.createElement("div");
        el.className = className;
        el.setAttribute("aria-hidden", "true");
        if (vars) el.setAttribute("style", vars);
        parent.append(el);
        handoff.layers.push(el);
        return el;
      },
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
  }

  function dropHandoff() {
    state.handoff?.layers.forEach((el) => el.remove());
    state.handoff = null;
  }

  function clearPageTheme() {
    unmountModule();
    const root = document.documentElement;
    root.classList.remove("themed");
    delete root.dataset.title;
    for (const k of fx.vars) root.style.removeProperty(k);
    fx.vars = [];
    fx.front?.remove();
    fx.back?.remove();
    fx.front = fx.back = null;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", DEFAULT_THEME_COLOR);
    window.GameFX?.stop();
  }

  function fxLayer(kind, names) {
    if (!names.length) return null;
    const el = document.createElement("div");
    el.className = `fx-${kind}`;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = names.map((n) => `<i class="tx-${n}"></i>`).join("");
    document.body.append(el);
    return el;
  }

  function applyPageTheme(t) {
    clearPageTheme();
    const root = document.documentElement;
    root.dataset.title = t.id;
    const vars = themeVars(t.theme);
    if (!vars) return;
    root.classList.add("themed");
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    fx.vars = Object.keys(vars);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.theme.bg);

    const textures = [].concat(t.theme.textures ?? []);
    fx.back = fxLayer("back", textures.filter((x) => TEXTURES.back.includes(x)));
    fx.front = fxLayer("front", textures.filter((x) => TEXTURES.front.includes(x)));

    const p = typeof t.theme.particles === "string" ? { type: t.theme.particles } : t.theme.particles;
    if (p?.type) window.GameFX?.start({ ...p, color: p.color ?? t.theme.accent });
  }

  // ---------- главная: категории сверху вниз ----------
  // В процессе → в планах → завершено; внутри категории — по алфавиту. Категория считается сама
  // по отметкам: ничего не отмечено — «в планах», отмечено всё — «завершено».

  const CATEGORIES = [
    { status: "watching", label: "В процессе" },
    { status: "planned", label: "В планах" },
    { status: "completed", label: "Завершено" },
  ];

  const byTitle = (a, b) => a.title.localeCompare(b.title, "ru", { sensitivity: "base" });
  const statusOf = (t) => progressOf(t).status;
  const ordered = () => CATEGORIES.flatMap((c) => state.titles.filter((t) => statusOf(t) === c.status).sort(byTitle));

  const COLLAPSE_KEY = "wl-collapsed";

  function loadCollapsed() {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  }

  function saveCollapsed() {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...state.collapsed]));
    } catch {
      /* приватный режим и т.п. — просто не запоминаем */
    }
  }

  const progressBar = (done, total) => {
    const p = total ? Math.round((done / total) * 100) : 0;
    return `<div class="progress" title="${p}%"><div style="width:${p}%"></div></div>`;
  };

  // «3 сезон · 5 серия» — где остановился, словами.
  function whereText(p) {
    if (!p.last) return "";
    const { part, n } = p.last;
    const multi = p.parts.length > 1 && part.title;
    return `${multi ? `${part.title} · ` : ""}${n} ${unitWord(part.unit, 1)}`;
  }

  function bannerHtml(t) {
    const vars = themeVars(t.theme);
    const hasLogo = unique(logoUrls(t).map(safeUrl)).length > 0;
    const p = progressOf(t);
    const unit = p.parts[0]?.unit ?? "episode";
    const progress = p.total
      ? `<div class="tb-count"><b>${p.watched}</b><span>из ${p.total}</span></div>
         <div class="tb-label">${unitWord(unit, p.total)}</div>
         ${progressBar(p.watched, p.total)}`
      : "";
    const score = p.score != null ? `<div class="tb-score" aria-label="Оценка ${fmtScore(p.score)} из 10"><b>${fmtScore(p.score)}</b><span>/ 10</span></div>` : "";

    return `
      <a class="tbanner ${p.status} ${vars ? "themed-card" : ""} ${hasLogo ? "has-logo" : ""}" data-title="${esc(t.id)}"
         style="${esc(styleAttr(vars))}" href="#/t/${encodeURIComponent(t.id)}">
        <div class="tb-media" style="background:${gradient(t.title)}">${imgTag(heroUrls(t), 'alt="" loading="lazy"')}</div>
        <div class="tb-body">
          <div class="tb-main">
            <div class="tb-title">
              ${hasLogo ? imgTag(logoUrls(t), `class="tb-logo" alt="" loading="lazy"`) : ""}
              <h3 class="tb-name">${esc(t.title)}</h3>
            </div>
          </div>
          <div class="tb-progress">${score}${progress}</div>
        </div>
      </a>`;
  }

  function renderList() {
    const q = state.query.trim().toLowerCase();
    const match = (t) => !q || [t.title, t.original, ...(t.aliases ?? [])].some((s) => String(s ?? "").toLowerCase().includes(q));
    const html = CATEGORIES.map((c) => {
      const all = state.titles.filter((t) => statusOf(t) === c.status);
      const titles = all.filter(match).sort(byTitle);
      if (!titles.length) return "";
      const collapsed = !q && state.collapsed.has(c.status);
      return `
        <section class="cat ${c.status} ${collapsed ? "collapsed" : ""}" data-cat="${c.status}">
          <h2 class="cat-head">
            <button type="button" class="cat-toggle" aria-expanded="${!collapsed}" aria-controls="cat-${c.status}">
              <span class="cat-arrow" aria-hidden="true"></span>
              <span class="cat-title">${c.label}</span>
              <span class="cat-count">${q ? `${titles.length} из ${all.length}` : all.length}</span>
            </button>
          </h2>
          <div class="cat-body" id="cat-${c.status}"${collapsed ? " inert" : ""}>
            <div class="cat-inner">${titles.map(bannerHtml).join("")}</div>
          </div>
        </section>`;
    }).join("");
    els.list.innerHTML =
      html ||
      (q
        ? `<div class="empty"><strong>Ничего не найдено</strong>Попробуй другой запрос.</div>`
        : `<div class="empty"><strong>Список пока пуст</strong>Скоро здесь появятся тайтлы.</div>`);
    decorateBanners();
  }

  function toggleCat(btn) {
    const sec = btn.closest(".cat");
    const collapsed = !sec.classList.contains("collapsed");
    sec.classList.toggle("collapsed", collapsed);
    btn.setAttribute("aria-expanded", String(!collapsed));
    sec.querySelector(".cat-body").inert = collapsed;
    if (collapsed) state.collapsed.add(sec.dataset.cat);
    else state.collapsed.delete(sec.dataset.cat);
    saveCollapsed();
  }

  // ---------- сцена: фон главной и бесшовный вход в тайтл ----------
  // Наведение на баннер включает за списком слой тайтла (свою задумку темы — stage(s)).
  // Клик: главная растворяется, поверх неё начинается заставка тайтла, страница открывается из-под неё.

  const stageEl = document.getElementById("stage");
  const stage = { current: null, leaveTimer: 0, banner: null };

  function stageLayer(t) {
    let layer = stageEl.querySelector(`.stage-layer[data-title="${CSS.escape(t.id)}"]`);
    if (layer) return layer;
    const vars = themeVars(t.theme);
    layer = document.createElement("div");
    layer.className = `stage-layer ${vars ? "themed-card" : ""}`;
    layer.dataset.title = t.id;
    if (vars) layer.setAttribute("style", styleAttr(vars));
    fillStage(t, layer);
    stageEl.append(layer);
    return layer;
  }

  function fillStage(t, layer) {
    const mod = t.theme?.js === true ? modules.registry.get(t.id) : null;
    if (mod?.stage) {
      try {
        layer.innerHTML = "";
        mod.stage(themeBase(t, { el: layer }));
        layer.classList.add("custom");
        return;
      } catch (e) {
        console.error(`theme ${t.id} stage:`, e);
      }
    }
    layer.innerHTML = `<div class="stage-hero"><div class="hero-media" style="background:${gradient(t.title)}">${imgTag(heroUrls(t), 'alt=""')}</div></div>`;
  }

  function rebuildStage(t) {
    const layer = stageEl.querySelector(`.stage-layer[data-title="${CSS.escape(t.id)}"]`);
    if (layer && !layer.classList.contains("custom")) fillStage(t, layer);
  }

  function setStage(t, { instant = false } = {}) {
    clearTimeout(stage.leaveTimer);
    const id = t?.id ?? null;
    if (stage.current === id && !instant) return;
    stage.current = id;
    stageEl.classList.toggle("instant", instant);
    const target = t ? stageLayer(t) : null;
    for (const l of stageEl.querySelectorAll(".stage-layer")) if (l !== target) l.classList.remove("on");
    if (target) {
      if (instant) target.classList.add("on");
      // слой включается кадром позже (чтобы сработал переход); если за этот кадр навели на другой баннер — не включаем
      else requestAnimationFrame(() => stage.current === id && target.classList.add("on"));
    }
    document.body.classList.toggle("staged", !!t);
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => stageEl.classList.remove("instant")));
  }

  const bannerTitle = (el) => state.byId.get(el?.closest?.(".tbanner")?.dataset.title);

  // Сцене темы — где баннер, на который навели: центр и размер в координатах окна (--bcx, --bcy, --bw, --bh),
  // чтобы задумка наведения могла выстроиться вокруг самого баннера, а заставка — начаться оттуда же.
  function placeStage(t, banner) {
    if (!banner) return;
    stage.banner = banner;
    const r = banner.getBoundingClientRect();
    const layer = stageLayer(t);
    layer.style.setProperty("--bcx", `${Math.round(r.left + r.width / 2)}px`);
    layer.style.setProperty("--bcy", `${Math.round(r.top + r.height / 2)}px`);
    layer.style.setProperty("--bw", `${Math.round(r.width)}px`);
    layer.style.setProperty("--bh", `${Math.round(r.height)}px`);
  }

  let placing = 0;
  window.addEventListener(
    "scroll",
    () => {
      if (placing || !stage.current || state.entering || state.arriving || location.hash.startsWith("#/t/")) return;
      placing = requestAnimationFrame(() => {
        placing = 0;
        const t = state.byId.get(stage.current);
        if (t && stage.banner?.isConnected && stage.banner.dataset.title === t.id) placeStage(t, stage.banner);
      });
    },
    { passive: true },
  );

  els.list.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const t = bannerTitle(e.target);
    if (!t) return;
    setStage(t);
    placeStage(t, e.target.closest(".tbanner"));
    if (t.theme?.js === true) loadModule(t.id); // чтобы заставка могла начаться сразу по клику
  });

  els.list.addEventListener("pointerout", (e) => {
    // Во время входа в тайтл список становится «прозрачным» для мыши и браузер шлёт pointerout —
    // фон в этот момент сбрасывать нельзя, иначе переход перестанет быть бесшовным.
    if (state.entering || state.arriving || document.body.classList.contains("leaving")) return;
    if (e.pointerType !== "mouse" || !bannerTitle(e.target) || bannerTitle(e.relatedTarget)) return;
    clearTimeout(stage.leaveTimer);
    stage.leaveTimer = setTimeout(() => setStage(null), 260);
  });

  els.list.addEventListener("focusin", (e) => {
    const t = bannerTitle(e.target);
    if (!t) return;
    setStage(t);
    placeStage(t, e.target.closest(".tbanner"));
    if (t.theme?.js === true) loadModule(t.id);
  });

  els.list.addEventListener("click", (e) => {
    const btn = e.target.closest(".cat-toggle");
    if (btn) return toggleCat(btn);
    const t = bannerTitle(e.target);
    if (!t || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    enterTitle(t);
  });

  async function enterTitle(t) {
    if (state.entering) return;
    state.listScroll = window.scrollY;
    const href = `#/t/${encodeURIComponent(t.id)}`;
    if (reduceMotion()) {
      location.hash = href;
      return;
    }
    state.entering = true;
    setStage(t);
    // Выбранный баннер держит своё выделение, пока главная растворяется (мышь с него в этот момент «уходит»)
    els.list.querySelector(`.tbanner[data-title="${CSS.escape(t.id)}"]`)?.classList.add("picked");
    document.body.classList.add("leaving");
    requestAnimationFrame(() => clearTimeout(stage.leaveTimer));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    loadExtra(t); // серии и опросник — заранее, чтобы страница собралась под заставкой без ожидания

    const mod = t.theme?.js === true ? await Promise.race([loadModule(t.id), wait(800)]) : null;
    if (mod?.cover) {
      try {
        await Promise.race([Promise.resolve(mod.cover(makeCoverCtx(t))), wait(2500)]);
        state.entering = false;
        state.arriving = true;
        location.hash = href;
        return;
      } catch (e) {
        console.error(`theme ${t.id} cover:`, e);
        dropHandoff();
      }
    }

    const img = stageLayer(t).querySelector("img");
    const loaded =
      img && !img.complete
        ? new Promise((r) => {
            img.addEventListener("load", r, { once: true });
            img.addEventListener("error", r, { once: true });
            setTimeout(r, 1200);
          })
        : null;
    await Promise.all([wait(450), loaded]);
    state.entering = false;
    state.arriving = true;
    location.hash = href;
  }

  // ---------- страница тайтла: запасной вид ----------
  // Тайтл с модулем строит всю страницу сам (page(ctx)); это — общий вид для тайтла без модуля.
  // На странице только отметка, где остановился, и опросник с оценкой.

  const draft = { id: null, answers: {}, open: false }; // ответы опросника, пока он не отправлен

  // Серия — части одной истории в порядке просмотра (data/franchises.json): сезоны, фильмы, спецвыпуски.
  // Часть может быть ещё не добавлена на сайт (нет id) или ещё не выйти (released: false) — тогда ссылки нет.
  function chainOf(t) {
    for (const [fid, f] of Object.entries(state.franchises)) {
      const list = Array.isArray(f?.entries) ? f.entries : [];
      const i = list.findIndex((e) => e?.id === t.id);
      if (i < 0) continue;
      const pick = (e) => {
        if (!e) return null;
        const other = e.id ? state.byId.get(e.id) : null;
        return {
          title: e.title ?? other?.title ?? "",
          href: other ? `#/t/${encodeURIComponent(other.id)}` : null,
          added: !!other,
          released: e.released !== false,
          status: other ? progressOf(other).status : null,
        };
      };
      // Номера части и числа частей здесь нет нарочно: «фильм 1 из 6» на сайте не показывается, каждый тайтл сам по себе.
      return { id: fid, title: f.title ?? "", prev: pick(list[i - 1]), next: pick(list[i + 1]) };
    }
    return null;
  }

  // Сверка — по чему пользователь убеждается, что включил именно эту часть: оригинальное название, год,
  // длительность (у фильма) или число серий, и ссылки на карточку этой части в базах (Кинопоиск, Shikimori…).
  // { original, year, length, facts: [строки для показа], links: [{ label, href }] }
  function identOf(t) {
    const year = Number.isInteger(t.year) ? t.year : null;
    const min = Number.isInteger(t.runtime) && t.runtime > 0 ? t.runtime : null;
    const p = progressOf(t);
    const unit = p.parts[0]?.unit ?? "episode";
    const h = min ? Math.floor(min / 60) : 0;
    const length = min ? [h ? `${h} ч` : "", min % 60 ? `${min % 60} мин` : ""].filter(Boolean).join(" ") : unit !== "film" && p.total > 1 ? `${p.total} ${unitWord(unit, p.total)}` : "";
    const original = t.original && t.original !== t.title ? String(t.original) : "";
    const links = (Array.isArray(t.links) ? t.links : []).map((l) => ({ label: String(l?.label ?? ""), href: safeUrl(l?.url) })).filter((l) => l.label && l.href);
    return { original, year, length, facts: [original, year ? String(year) : "", length].filter(Boolean), links };
  }

  function identHtml(t) {
    const d = identOf(t);
    if (!d.facts.length && !d.links.length) return "";
    const links = d.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join("");
    return `<p class="ident">${d.facts.map((f) => `<span>${esc(f)}</span>`).join("")}${links ? `<span class="ident-links"><small>сверить</small>${links}</span>` : ""}</p>`;
  }

  function chainHtml(t) {
    const c = chainOf(t);
    if (!c || (!c.prev && !c.next)) return "";
    const item = (x, dir) => {
      if (!x) return "<span></span>";
      const head = `<small>${dir === "prev" ? "← Предыдущая часть" : "Следующая часть →"}</small><b>${esc(x.title)}</b>`;
      return x.href
        ? `<a class="neighbor ${dir}" href="${esc(x.href)}">${head}</a>`
        : `<div class="neighbor ${dir} off">${head}<i>${x.released ? "ещё не добавлена" : "ещё не вышла"}</i></div>`;
    };
    return `<nav class="neighbors chain" aria-label="${esc(c.title)}: порядок просмотра">${item(c.prev, "prev")}${item(c.next, "next")}</nav>`;
  }

  function neighborsOf(t) {
    const list = ordered();
    const i = list.findIndex((x) => x.id === t.id);
    const pick = (x) => (x ? { id: x.id, title: x.title, href: `#/t/${encodeURIComponent(x.id)}` } : null);
    return { prev: pick(list[i - 1]), next: pick(list[i + 1]) };
  }

  function neighborsHtml(t) {
    const { prev, next } = neighborsOf(t);
    if (!prev && !next) return "";
    const link = (x, dir) =>
      x ? `<a class="neighbor ${dir}" href="${esc(x.href)}"><small>${dir === "prev" ? "← Предыдущий" : "Следующий →"}</small><b>${esc(x.title)}</b></a>` : "<span></span>";
    return `<nav class="neighbors">${link(prev, "prev")}${link(next, "next")}</nav>`;
  }

  function partHtml(part, edit, single) {
    const cells = part.episodes
      .map((ep) => {
        const label = `${ep.n} ${unitWord(part.unit, 1)}${ep.title ? ` — ${ep.title}` : ""}`;
        const inner = `<b>${ep.n}</b>${ep.title ? `<span>${esc(ep.title)}</span>` : ""}`;
        return edit
          ? `<button type="button" class="ep ${ep.watched ? "seen" : ""} ${ep.n === part.watched ? "here" : ""}" data-part="${esc(part.id)}" data-n="${ep.n}" aria-pressed="${ep.watched}" aria-label="${esc(label)}">${inner}</button>`
          : `<div class="ep ${ep.watched ? "seen" : ""} ${ep.n === part.watched ? "here" : ""}">${inner}</div>`;
      })
      .join("");
    return `
      <section class="block part" data-part="${esc(part.id)}">
        <h2><span class="sec-label">${esc(part.title || (single ? "Отметки" : "Часть"))}</span> <span class="block-count">${part.watched}/${part.count}</span></h2>
        <div class="ep-grid ${part.episodes.some((e) => e.title) ? "named" : ""}">${cells}</div>
      </section>`;
  }

  function questionHtml(q, i, a) {
    const name = `q-${esc(q.id)}`;
    let body = "";
    if (q.type === "scale") {
      const min = Number(q.min ?? 1), max = Number(q.max ?? 5);
      const steps = Array.from({ length: max - min + 1 }, (_, k) => min + k);
      body = `<div class="q-scale">
        ${q.labels?.[0] ? `<span class="q-edge">${esc(q.labels[0])}</span>` : ""}
        ${steps.map((v) => `<label><input type="radio" name="${name}" value="${v}" ${Number(a) === v && a != null ? "checked" : ""}><span>${v}</span></label>`).join("")}
        ${q.labels?.[1] ? `<span class="q-edge">${esc(q.labels[1])}</span>` : ""}
      </div>`;
    } else {
      const multi = q.type === "multi";
      const picked = (id) => (multi ? Array.isArray(a) && a.includes(id) : a === id);
      body = `<div class="q-options">${(q.options ?? [])
        .map((o) => `<label class="q-opt"><input type="${multi ? "checkbox" : "radio"}" name="${name}" value="${esc(o.id)}" ${picked(o.id) ? "checked" : ""}><span>${esc(o.text)}</span></label>`)
        .join("")}</div>`;
    }
    return `<fieldset class="q" data-q="${esc(q.id)}" data-type="${esc(q.type ?? "choice")}">
      <legend><i>${i + 1}</i>${esc(q.text)}</legend>${q.hint ? `<p class="q-hint">${esc(q.hint)}</p>` : ""}${body}</fieldset>`;
  }

  function quizHtml(t, extra, p) {
    const quiz = extra?.quiz;
    if (!quiz?.questions?.length) return "";
    const st = quizState(t, quiz);
    const edit = Store.canEdit();
    if (st && !draft.open) {
      return `
        <section class="block quiz done" data-section="quiz">
          <h2><span class="sec-label">${esc(quiz.title ?? "Опросник")}</span></h2>
          <div class="verdict">
            <div class="verdict-score" aria-label="Оценка ${fmtScore(st.score)} из 10"><b>${fmtScore(st.score)}</b><span>/ 10</span></div>
            ${st.verdict ? `<div class="verdict-text"><strong>${esc(st.verdict.label ?? "")}</strong>${st.verdict.text ? `<p>${esc(st.verdict.text)}</p>` : ""}</div>` : ""}
          </div>
          ${edit ? `<button type="button" class="btn ghost" data-act="quiz-open">Пройти заново</button>` : ""}
        </section>`;
    }
    if (p.status !== "completed") {
      return `<section class="block quiz locked" data-section="quiz"><h2><span class="sec-label">${esc(quiz.title ?? "Опросник")}</span></h2>
        <p class="muted">Откроется, когда досмотришь до конца.</p></section>`;
    }
    if (!edit) return "";
    const r = scoreQuiz(quiz, draft.answers);
    return `
      <section class="block quiz open" data-section="quiz">
        <h2><span class="sec-label">${esc(quiz.title ?? "Опросник")}</span> <span class="block-count" data-quiz-count>${r.answered}/${r.total}</span></h2>
        <form class="quiz-form">
          ${quiz.questions.map((q, i) => questionHtml(q, i, draft.answers[q.id])).join("")}
          <div class="quiz-actions">
            <button type="submit" class="btn" ${r.complete ? "" : "disabled"}>Получить оценку</button>
            ${st ? `<button type="button" class="btn ghost" data-act="quiz-cancel">Отмена</button>` : ""}
          </div>
        </form>
      </section>`;
  }

  function renderTitle(t, extra) {
    const hasLogo = unique(logoUrls(t).map(safeUrl)).length > 0;
    const p = progressOf(t);
    const parts = partsView(t, extra);
    const edit = Store.canEdit();
    const unit = p.parts[0]?.unit ?? "episode";
    const ratio = p.total ? p.watched / p.total : 0;
    if (draft.id !== t.id) Object.assign(draft, { id: t.id, answers: {}, open: false });

    els.titleView.innerHTML = `
      <header class="hero ${p.status} ${hasLogo ? "has-logo" : ""}">
        <div class="hero-media" style="background:${gradient(t.title)}">${imgTag(heroUrls(t), 'alt=""')}</div>
        <div class="wrap hero-inner">
          <a class="back" href="#/">← К списку</a>
          <div class="hero-title">
            ${hasLogo ? imgTag(logoUrls(t), `class="hero-logo" alt="${esc(t.title)}"`) : ""}
            <h1>${esc(t.title)}</h1>
            ${identHtml(t)}
          </div>
        </div>
      </header>
      <div class="wrap title-layout ${p.status}">
        <div class="title-main">
          ${parts.map((part) => partHtml(part, edit, parts.length === 1)).join("")}
          ${quizHtml(t, extra, p)}
          ${chainHtml(t)}
          ${neighborsHtml(t)}
        </div>
        <aside class="title-side">
          <div class="side-card">
            <div class="ring" style="--p:${ratio.toFixed(3)}" role="img" aria-label="Отмечено ${p.watched} из ${p.total}">
              <div class="ring-text"><b>${p.watched}</b><small>из ${p.total}</small></div>
            </div>
            <p class="where">${p.last ? esc(whereText(p)) : `Ещё не начато`}</p>
            ${edit && p.next ? `<button type="button" class="btn wide" data-act="next">+1 ${unitWord(p.next.part.unit, 1)}</button>` : ""}
            ${!edit && Store.info().configured ? `<button type="button" class="btn ghost wide" data-act="connect">Подключить отметки</button>` : ""}
            ${p.score != null ? `<div class="side-score"><b>${fmtScore(p.score)}</b><span>/ 10</span></div>` : ""}
            <span class="sr-only">${unitWord(unit, p.total)}</span>
          </div>
        </aside>
      </div>`;
  }

  function readForm(form, quiz) {
    const answers = {};
    for (const q of quiz.questions) {
      const inputs = [...form.querySelectorAll(`[name="q-${CSS.escape(q.id)}"]`)];
      if (q.type === "multi") {
        // пустой выбор — тоже ответ, но только если этот вопрос уже трогали
        const prev = draft.answers[q.id];
        const picked = inputs.filter((i) => i.checked).map((i) => i.value);
        if (picked.length || Array.isArray(prev)) answers[q.id] = picked;
      } else {
        const on = inputs.find((i) => i.checked);
        if (on) answers[q.id] = q.type === "scale" ? Number(on.value) : on.value;
      }
    }
    return answers;
  }

  els.titleView.addEventListener("click", (e) => {
    if (modules.active || !state.current) return;
    const t = state.current;
    const ep = e.target.closest("button.ep");
    if (ep) {
      const n = Number(ep.dataset.n);
      const cur = progressOf(t).parts.find((p) => p.id === ep.dataset.part)?.watched ?? 0;
      return setWatched(t, ep.dataset.part, cur === n ? n - 1 : n); // повторный клик по последней отмеченной — снять её
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "next") markNext(t);
    if (act === "connect") openSync();
    if (act === "quiz-open") {
      Object.assign(draft, { open: true, answers: { ...(Store.entry(t.id).q?.a ?? {}) } });
      renderTitle(t, state.extraCache.get(t.id));
    }
    if (act === "quiz-cancel") {
      draft.open = false;
      renderTitle(t, state.extraCache.get(t.id));
    }
  });

  els.titleView.addEventListener("change", (e) => {
    if (modules.active || !state.current) return;
    const form = e.target.closest(".quiz-form");
    const quiz = state.extraCache.get(state.current.id)?.quiz;
    if (!form || !quiz) return;
    if (e.target.type === "checkbox") draft.answers[e.target.closest(".q").dataset.q] ??= [];
    draft.answers = readForm(form, quiz);
    const r = scoreQuiz(quiz, draft.answers);
    form.querySelector('[type="submit"]').disabled = !r.complete;
    const count = els.titleView.querySelector("[data-quiz-count]");
    if (count) count.textContent = `${r.answered}/${r.total}`;
  });

  els.titleView.addEventListener("submit", (e) => {
    if (modules.active || !state.current) return;
    e.preventDefault();
    const t = state.current;
    const quiz = state.extraCache.get(t.id)?.quiz;
    if (!quiz || !scoreQuiz(quiz, draft.answers).complete) return;
    draft.open = false;
    Store.setQuiz(t.id, draft.answers, scoreQuiz(quiz, draft.answers).score);
  });

  // ---------- отметки изменились (здесь или пришли из репозитория) ----------

  let listDirty = false;

  let couldEdit = null; // можно ли было отмечать при прошлом событии (ставится при запуске)

  Store.subscribe((kind) => {
    renderSync();
    if (kind !== "change") return;
    // Браузер подключили или отключили — страницу тайтла собираем заново: на ней появятся (или пропадут)
    // печати, «+1» и вход в опросник.
    const can = Store.canEdit();
    const flipped = couldEdit !== null && can !== couldEdit;
    couldEdit = can;
    if (flipped && !els.titleView.hidden && state.current) return void showTitle(state.current);
    if (!els.titleView.hidden && state.current) {
      if (modules.active) {
        for (const fn of [...modules.changeFns]) {
          try {
            fn();
          } catch (e) {
            console.error(e);
          }
        }
      } else if (!els.titleView.classList.contains("module-pending")) {
        renderTitle(state.current, state.extraCache.get(state.current.id));
      }
      return;
    }
    if (state.entering || state.arriving) listDirty = true;
    else if (!els.listView.hidden) renderList();
  });

  // ---------- синхронизация: кнопка и окно ----------

  const SYNC_LABELS = {
    off: "Синхронизация не настроена",
    readonly: "Только просмотр — подключить синхронизацию",
    synced: "Отметки сохранены",
    pending: "Есть несохранённые отметки",
    saving: "Сохраняю…",
    error: "Не удалось сохранить",
    init: "Загрузка…",
  };

  let toastTimer = 0;
  function toast(text) {
    els.toast.textContent = text;
    els.toast.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("on"), 6000);
  }

  let lastStatus = "";
  function renderSync() {
    const info = Store.info();
    els.syncBtn.hidden = !info.configured;
    els.syncBtn.dataset.status = info.status;
    els.syncBtn.title = SYNC_LABELS[info.status] ?? "";
    els.syncBtn.setAttribute("aria-label", `Синхронизация: ${SYNC_LABELS[info.status] ?? ""}`);
    if (info.status === "error" && lastStatus !== "error") toast(`Не удалось сохранить в GitHub: ${info.error}. Отметка осталась в этом браузере.`);
    lastStatus = info.status;
    // Окно перерисовываем, только когда браузер подключён (там статус) или подключение только что сменилось:
    // пока в нём поле для токена, любая перерисовка стёрла бы вставленное.
    if (els.syncDialog.open && (info.connected || els.syncDialog.dataset.connected === "true")) fillSyncDialog();
  }

  function fillSyncDialog(msg = "") {
    const info = Store.info();
    const repoUrl = `https://github.com/${info.repo}`;
    const body = els.syncDialog.querySelector(".sync-body");
    els.syncDialog.dataset.connected = String(info.connected);
    if (info.connected) {
      body.innerHTML = `
        <p class="sync-state ${esc(info.status)}">${esc(SYNC_LABELS[info.status] ?? "")}${info.status === "error" ? `: ${esc(info.error)}` : ""}</p>
        <p>Этот браузер подключён${info.user ? ` как <b>${esc(info.user)}</b>` : ""}: отметки серий и ответы опросников сохраняются в репозиторий
          <a href="${esc(repoUrl)}/tree/${esc(info.branch)}" target="_blank" rel="noopener">${esc(info.repo)}</a> и видны на всех устройствах.</p>
        <div class="sync-actions">
          <button type="button" class="btn" data-sync="refresh">Обновить</button>
          <button type="button" class="btn ghost" data-sync="disconnect">Отключить этот браузер</button>
        </div>`;
      return;
    }
    body.innerHTML = `
      <p>Сейчас сайт только показывает отметки. Чтобы отмечать серии и проходить опросники, этому браузеру нужен <b>токен</b> — ключ от твоего репозитория на GitHub: с ним сайт может записывать туда отметки. Его создаёшь ты сам в настройках GitHub, это минута; хранится он только в этом браузере.</p>
      <ol class="sync-steps">
        <li>Войди на GitHub под аккаунтом <b>${esc(info.repo.split("/")[0] ?? "")}</b> и открой <a href="https://github.com/settings/personal-access-tokens/new?name=Watch+List&amp;description=Watch+List+sync&amp;contents=write" target="_blank" rel="noopener">создание токена</a>.</li>
        <li><b>Token name</b> — любое, например Watch List. <b>Expiration</b> — срок подольше: когда он выйдет, токен нужно будет создать заново.</li>
        <li><b>Repository access</b> → Only select repositories → выбери <b>${esc(info.repo.split("/")[1] ?? "")}</b>.</li>
        <li><b>Permissions</b> → Repository permissions → <b>Contents</b> → <b>Read and write</b>.</li>
        <li>Нажми <b>Generate token</b>, скопируй строку <code>github_pat_…</code> и вставь сюда.</li>
      </ol>
      <form class="sync-form">
        <input type="password" name="token" placeholder="github_pat_…" autocomplete="off" spellcheck="false" aria-label="GitHub-токен" required>
        <button type="submit" class="btn">Подключить</button>
      </form>
      <p class="sync-msg" role="status">${esc(msg)}</p>`;
  }

  // Окно подключения открывается и с главной, и со страницы тайтла (ctx.connect в теме).
  function openSync() {
    if (!Store.info().configured) return;
    fillSyncDialog();
    if (!els.syncDialog.open) els.syncDialog.showModal();
  }

  els.syncBtn.addEventListener("click", openSync);
  // Esc закрывает только окно: до документа не пускаем, иначе со страницы тайтла уведёт к списку
  els.syncDialog.addEventListener("keydown", (e) => e.key === "Escape" && e.stopPropagation());

  els.syncDialog.addEventListener("click", (e) => {
    if (e.target === els.syncDialog || e.target.closest(".sync-close")) return els.syncDialog.close();
    const act = e.target.closest("[data-sync]")?.dataset.sync;
    if (act === "disconnect") Store.disconnect();
    if (act === "refresh") Store.refresh(true);
  });

  els.syncDialog.addEventListener("submit", async (e) => {
    const form = e.target.closest(".sync-form");
    if (!form) return;
    e.preventDefault();
    const btn = form.querySelector("button");
    const out = els.syncDialog.querySelector(".sync-msg");
    btn.disabled = true;
    out.textContent = "Проверяю токен…";
    try {
      await Store.connect(form.token.value);
    } catch (err) {
      btn.disabled = false;
      out.textContent = err.message;
    }
  });

  // ---------- lightbox ----------

  function showLightbox(i) {
    const { items } = state.lightbox;
    state.lightbox.index = (i + items.length) % items.length;
    const img = items[state.lightbox.index];
    els.lbImg.src = img.currentSrc || img.src;
    els.lbImg.alt = img.alt;
    els.lbCaption.textContent = [img.dataset.caption, items.length > 1 ? `${state.lightbox.index + 1} / ${items.length}` : ""].filter(Boolean).join(" · ");
    els.lightbox.classList.toggle("single", items.length < 2);
    if (!els.lightbox.open) els.lightbox.showModal();
  }

  document.addEventListener("click", (e) => {
    const img = e.target.closest?.("img[data-zoom]") ?? e.target.querySelector?.(":scope > img[data-zoom]");
    if (!img || els.lightbox.contains(img)) return;
    const group = img.closest("[data-gallery]");
    state.lightbox.items = group ? [...group.querySelectorAll("img[data-zoom]")] : [img];
    showLightbox(state.lightbox.items.indexOf(img));
  });

  els.lightbox.querySelector(".lb-close").addEventListener("click", () => els.lightbox.close());
  els.lightbox.querySelector(".lb-prev").addEventListener("click", () => showLightbox(state.lightbox.index - 1));
  els.lightbox.querySelector(".lb-next").addEventListener("click", () => showLightbox(state.lightbox.index + 1));
  els.lightbox.addEventListener("click", (e) => {
    if (e.target === els.lightbox || e.target.tagName === "FIGURE") els.lightbox.close();
  });

  document.addEventListener("keydown", (e) => {
    if (els.lightbox.open) {
      if (e.key === "ArrowLeft") showLightbox(state.lightbox.index - 1);
      if (e.key === "ArrowRight") showLightbox(state.lightbox.index + 1);
      return;
    }
    // Esc в открытом окне темы закрывает только окно, со страницы не уводит
    if (e.key === "Escape" && !els.titleView.hidden && !document.querySelector("dialog[open]")) location.hash = "#/";
  });

  // ---------- routing ----------

  function showList() {
    state.pageToken++;
    dropHandoff();
    const from = els.titleView.hidden ? null : state.current;
    clearPageTheme();
    els.titleView.hidden = true;
    els.titleView.classList.remove("arriving");
    els.titleView.innerHTML = "";
    els.listView.hidden = false;
    document.body.classList.remove("leaving");
    document.title = SITE_TITLE;
    state.current = null;
    listDirty = false;
    stageEl.hidden = false;
    renderList();
    if (!from) return;
    window.scrollTo(0, state.listScroll);
    if (reduceMotion()) return setStage(null, { instant: true });
    // Обратный путь: слой тайтла остаётся на месте и плавно гаснет, пока главная проявляется.
    stageEl.classList.add("bare");
    setStage(from, { instant: true });
    els.listView.classList.add("returning");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        stageEl.classList.remove("bare");
        setStage(null);
      }),
    );
    setTimeout(() => els.listView.classList.remove("returning"), 700);
  }

  async function showTitle(t) {
    const token = ++state.pageToken;
    if (!els.listView.hidden && !state.arriving) state.listScroll = window.scrollY;
    const arriving = state.arriving;
    state.arriving = false;
    state.current = t;
    els.listView.hidden = true;
    els.titleView.hidden = false;
    // Проявление страницы нужно только без заставки темы: под заставкой оно невидимо, а конец этой
    // анимации заново растрирует всю страницу — и открытие заставки на этот миг замирает.
    els.titleView.classList.toggle("arriving", arriving && !(state.handoff?.id === t.id && state.handoff.layers.length));
    document.title = `${t.title} — ${SITE_TITLE}`;
    applyPageTheme(t);
    if (t.theme?.js === true) els.titleView.classList.add("module-pending");
    const extra = await loadExtra(t);
    if (token !== state.pageToken) return;
    renderTitle(t, extra);
    window.scrollTo(0, 0);
    mountModule(t, extra);
    // Страница тайтла проявилась — сцену убираем без анимации (на странице фон свой, сцена бы его закрыла).
    setTimeout(
      () => {
        if (token !== state.pageToken) return;
        document.body.classList.remove("leaving");
        setStage(null, { instant: true });
        stageEl.hidden = true;
      },
      arriving ? 600 : 0,
    );
  }

  function route() {
    const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const [head, ...rest] = hash.split("/");
    if (els.lightbox.open) els.lightbox.close();
    const t = head === "t" ? state.byId.get(rest.join("/")) : null;
    if (t) showTitle(t);
    else showList();
  }

  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderList();
  });

  window.addEventListener("hashchange", route);

  // ---------- boot ----------

  async function boot() {
    let data;
    try {
      const res = await fetch("data/titles.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      state.titles = (data.titles ?? []).filter((t) => t && t.id && t.title);
      // build — хэш кода сайта (ставит validate.js --fix): новые файлы тем не берутся из кэша
      state.version = encodeURIComponent(data.build ?? data.updated ?? "");
      state.byId = new Map(state.titles.map((t) => [t.id, t]));
      // порядок частей в сериях — необязательный файл: без него просто нет ссылок «следующая часть»
      const fr = await fetch(`data/franchises.json?v=${state.version}`, { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
      state.franchises = fr && typeof fr === "object" ? fr : {};
    } catch (err) {
      els.list.innerHTML = `<div class="empty"><strong>Не удалось загрузить список</strong>${esc(err.message)}</div>`;
      return;
    }
    state.collapsed = loadCollapsed();
    loadThemeAssets(state.titles);
    // Отметки этого браузера — сразу; свежие из репозитория придут следом и перерисуют список.
    // ?nosync — без репозитория (для проверок в headless Chrome: только отметки этого браузера)
    const ready = Store.init(new URLSearchParams(location.search).has("nosync") ? null : data.sync);
    couldEdit = Store.canEdit(); // токен из этого браузера уже прочитан
    await Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]);
    renderSync();
    route();
  }

  boot();
})();
