#!/usr/bin/env node
// Проверка данных и тем:  node scripts/validate.js [--fix] [--check-images]
//   --fix           проставить у тайтлов флаги episodes/quiz (есть ли файл), пересчитать build —
//                   хэш кода сайта — в data/titles.json и в ссылках ?v= в index.html
//   --check-images  проверить, что картинки (арт тайтлов, кадры серий) и шрифты тем открываются
// Выход с кодом 1, если есть ошибки. Предупреждения не мешают публикации.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const FIX = args.has("--fix");
const CHECK_IMAGES = args.has("--check-images");

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const rel = (...p) => path.join(ROOT, ...p);
const exists = (...p) => fs.existsSync(rel(...p));
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(rel(file), "utf8"));
  } catch (e) {
    err(`${file}: не читается как JSON — ${e.message}`);
    return null;
  }
};

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COLOR_RE = /^#[0-9a-f]{3,8}$/i;
const URL_RE = /^https?:\/\//i;
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const TYPES = ["anime", "series", "film", "manga", "book", "cartoon", "other"];
const UNITS = ["episode", "chapter", "volume", "film", "part"];

const urls = []; // [адрес, где встретился]

function checkTitle(t, seen) {
  const at = `titles.json → ${t.id ?? "?"}`;
  if (!ID_RE.test(t.id ?? "")) err(`${at}: id должен быть kebab-case латиницей`);
  if (seen.has(t.id)) err(`${at}: id повторяется`);
  seen.add(t.id);
  if (!t.title) err(`${at}: нет title`);
  if (!TYPES.includes(t.type)) err(`${at}: type — один из ${TYPES.join(", ")}`);
  if (t.added && !DATE_RE.test(t.added)) err(`${at}: added — дата YYYY-MM-DD`);
  for (const k of ["cover", "hero", "logo"]) {
    if (t[k] == null) continue;
    if (!URL_RE.test(t[k])) err(`${at}: ${k} — не http(s)-ссылка`);
    else urls.push([t[k], `${at}.${k}`]);
  }
  if (!t.cover && !t.hero) warn(`${at}: нет ни cover, ни hero — у баннера не будет арта`);
  // дополнительные картинки для темы тайтла: { имя: ссылка }
  for (const [k, u] of Object.entries(t.images ?? {})) {
    if (!URL_RE.test(u ?? "")) err(`${at}: images.${k} — не http(s)-ссылка`);
    else urls.push([u, `${at}.images.${k}`]);
  }

  const partIds = new Set();
  if (!Array.isArray(t.parts) || !t.parts.length) err(`${at}: нужна хотя бы одна часть в parts`);
  for (const p of t.parts ?? []) {
    if (!p.id || partIds.has(String(p.id))) err(`${at}: у части нет id или он повторяется (${p.id})`);
    partIds.add(String(p.id));
    if (!Number.isInteger(p.count) || p.count < 0) err(`${at}: parts.${p.id}.count — целое число ≥ 0`);
    if (p.unit && !UNITS.includes(p.unit)) err(`${at}: parts.${p.id}.unit — один из ${UNITS.join(", ")}`);
  }

  checkEpisodes(t, partIds);
  checkQuiz(t);
  checkTheme(t);
}

function checkEpisodes(t, partIds) {
  const file = `data/episodes/${t.id}.json`;
  const has = exists(file);
  if (FIX) {
    if (has) t.episodes = true;
    else delete t.episodes;
  } else if (!!t.episodes !== has) err(`titles.json → ${t.id}: флаг episodes не совпадает с наличием ${file} (запусти --fix)`);
  if (!has) return;
  const data = readJson(file);
  if (!data) return;
  for (const [pid, list] of Object.entries(data.parts ?? {})) {
    if (!partIds.has(pid)) err(`${file}: части «${pid}» нет в parts тайтла`);
    const count = (t.parts ?? []).find((p) => String(p.id) === pid)?.count ?? 0;
    const ns = new Set();
    for (const ep of list ?? []) {
      if (!Number.isInteger(ep.n) || ep.n < 1 || ep.n > count) err(`${file}: ${pid} — номер ${ep.n} вне 1…${count}`);
      if (ns.has(ep.n)) err(`${file}: ${pid} — номер ${ep.n} повторяется`);
      ns.add(ep.n);
      if (ep.image != null) {
        if (!URL_RE.test(ep.image)) err(`${file}: ${pid} #${ep.n} — image не http(s)-ссылка`);
        else urls.push([ep.image, `${file} ${pid} #${ep.n}`]);
      }
    }
  }
}

function checkQuiz(t) {
  const file = `data/quiz/${t.id}.json`;
  const has = exists(file);
  if (FIX) {
    if (has) t.quiz = true;
    else delete t.quiz;
  } else if (!!t.quiz !== has) err(`titles.json → ${t.id}: флаг quiz не совпадает с наличием ${file} (запусти --fix)`);
  if (!has) return;
  const quiz = readJson(file);
  if (!quiz) return;
  const qs = quiz.questions ?? [];
  if (!qs.length) err(`${file}: нет вопросов`);
  const ids = new Set();
  let lo = 0, hi = 0, wsum = 0;
  for (const q of qs) {
    const at = `${file} → ${q.id ?? "?"}`;
    if (!q.id || ids.has(q.id)) err(`${at}: у вопроса нет id или он повторяется`);
    ids.add(q.id);
    if (!q.text) err(`${at}: нет текста вопроса`);
    const w = q.weight ?? 1;
    if (!(w > 0)) err(`${at}: weight должен быть > 0`);
    const type = q.type ?? "choice";
    let min = 0, max = 1;
    if (type === "scale") {
      if (!(Number(q.max ?? 5) > Number(q.min ?? 1))) err(`${at}: у шкалы max должен быть больше min`);
    } else if (type === "choice" || type === "multi") {
      const opts = q.options ?? [];
      if (opts.length < 2) err(`${at}: нужно минимум два ответа`);
      const oids = new Set();
      const vals = [];
      for (const o of opts) {
        if (!o.id || oids.has(o.id)) err(`${at}: у ответа нет id или он повторяется (${o.id})`);
        oids.add(o.id);
        if (!o.text) err(`${at}: у ответа ${o.id} нет текста`);
        if (o.value == null) {
          if (type === "multi") err(`${at}: у ответа ${o.id} в multi нужен value`);
          continue; // «не помню» — в оценку не идёт
        }
        if (typeof o.value !== "number" || (type === "choice" && (o.value < 0 || o.value > 1))) err(`${at}: value ответа ${o.id} — число от 0 до 1`);
        vals.push(o.value);
      }
      if (type === "choice") {
        if (!vals.length) err(`${at}: ни у одного ответа нет value`);
        min = Math.min(...vals);
        max = Math.max(...vals);
        if (vals.length && max < 1) warn(`${at}: лучший ответ даёт ${max}, а не 1 — десятку получить нельзя`);
        if (vals.length && min > 0) warn(`${at}: худший ответ даёт ${min}, а не 0`);
      } else {
        const base = Number(q.base ?? 0);
        const pos = vals.filter((v) => v > 0).reduce((a, b) => a + b, 0);
        const neg = vals.filter((v) => v < 0).reduce((a, b) => a + b, 0);
        min = Math.max(0, Math.min(1, base + neg));
        max = Math.max(0, Math.min(1, base + pos));
        if (max < 1) warn(`${at}: максимум вопроса ${max.toFixed(2)}, а не 1`);
      }
    } else err(`${at}: type — choice, multi или scale`);
    lo += w * min;
    hi += w * max;
    wsum += w;
  }
  if (wsum) {
    const range = [lo, hi].map((x) => Math.round((x / wsum) * 100) / 10);
    quizRanges.push(`${t.id}: ${qs.length} вопросов, оценка от ${range[0]} до ${range[1]}`);
    if (range[0] !== 0 || range[1] !== 10) warn(`${file}: оценка получается в диапазоне ${range[0]}…${range[1]}, а не 0…10`);
  }
  let prev = Infinity;
  for (const v of quiz.verdicts ?? []) {
    if (typeof v.min !== "number" || !v.label) err(`${file}: у вердикта нужны min и label`);
    if (v.min >= prev) err(`${file}: verdicts должны идти от большего min к меньшему`);
    prev = v.min;
  }
  if ((quiz.verdicts ?? []).length && prev > 0) err(`${file}: последний вердикт должен начинаться с min: 0`);
}

const quizRanges = [];

function checkTheme(t) {
  const th = t.theme;
  const at = `titles.json → ${t.id}.theme`;
  if (!th) return warn(`titles.json → ${t.id}: нет theme — тайтл выглядит общим видом сайта`);
  for (const k of ["bg", "surface", "text", "accent"]) if (!COLOR_RE.test(th[k] ?? "")) err(`${at}.${k}: нужен цвет #rrggbb`);
  if (th.accent2 != null && !COLOR_RE.test(th.accent2)) err(`${at}.accent2: нужен цвет #rrggbb`);
  for (const spec of th.fonts ?? []) {
    if (!/^[\w\s:@;,.+-]+$/.test(spec)) err(`${at}.fonts: «${spec}» — недопустимая запись шрифта`);
    else urls.push([`https://fonts.googleapis.com/css2?family=${spec.trim().replace(/ /g, "+")}&display=swap`, `${at}.fonts`]);
  }
  const dir = `themes/${t.id}`;
  if (th.css === true && !exists(dir, "theme.css")) err(`${at}: css: true, но нет ${dir}/theme.css`);
  if (th.js === true) {
    if (!exists(dir, "theme.js")) return err(`${at}: js: true, но нет ${dir}/theme.js`);
    const src = fs.readFileSync(rel(dir, "theme.js"), "utf8");
    if (!src.includes(`TitleThemes.register("${t.id}"`)) err(`${dir}/theme.js: нет строки TitleThemes.register("${t.id}", …)`);
    for (const fn of ["banner", "stage", "cover", "page"]) if (!new RegExp(`\\b${fn}\\s*\\(`).test(src)) warn(`${dir}/theme.js: нет ${fn}()`);
  }
  if (th.css === true) {
    const css = fs.readFileSync(rel(dir, "theme.css"), "utf8");
    // картинки темы должны лежать рядом: url(assets/…)
    for (const m of css.matchAll(/url\(\s*["']?(assets\/[^"')]+)["']?\s*\)/g)) {
      if (!exists(dir, m[1])) err(`${dir}/theme.css: нет файла ${m[1]}`);
    }
  }
  if (exists(dir, "assets")) {
    for (const f of fs.readdirSync(rel(dir, "assets"))) {
      const size = fs.statSync(rel(dir, "assets", f)).size;
      if (size > 450 * 1024) warn(`${dir}/assets/${f}: ${(size / 1024).toFixed(0)} КБ — тяжеловат (ориентир ≤ 300 КБ)`);
    }
  }
}

// Серии: порядок просмотра частей (data/franchises.json). Каждый тайтл сайта должен стоять в своей серии —
// даже если он в ней пока один: по этому файлу проверяется, что смотрим по порядку, и строятся ссылки
// «следующая часть».
function checkFranchises(titleIds) {
  const file = "data/franchises.json";
  if (!exists(file)) return warn(`${file}: файла нет — у тайтлов не будет ссылок на следующую часть`);
  const data = readJson(file);
  if (!data) return;
  const placed = new Map();
  for (const [fid, f] of Object.entries(data)) {
    const at = `${file} → ${fid}`;
    if (!ID_RE.test(fid)) err(`${at}: id серии должен быть kebab-case латиницей`);
    if (!f?.title) err(`${at}: нет title`);
    if (!Array.isArray(f?.entries) || !f.entries.length) {
      err(`${at}: нужен непустой массив entries`);
      continue;
    }
    f.entries.forEach((e, i) => {
      if (!e?.title) err(`${at}: у части № ${i + 1} нет title`);
      if (e?.id == null) return;
      if (!titleIds.has(e.id)) err(`${at}: часть «${e.title}» ссылается на тайтл «${e.id}», которого нет в titles.json`);
      if (placed.has(e.id)) err(`${at}: тайтл «${e.id}» уже стоит в серии «${placed.get(e.id)}»`);
      placed.set(e.id, fid);
      if (e.released === false) err(`${at}: часть «${e.title}» добавлена на сайт, но помечена released: false`);
    });
  }
  for (const id of titleIds) if (!placed.has(id)) warn(`titles.json → ${id}: не стоит ни в одной серии в ${file} (добавь, даже если часть пока одна)`);
}

// Ключи и токены не должны попадать в репозиторий (он публичный).
function scanSecrets() {
  const SECRET = /(sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})/;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === ".git" || name === "node_modules") continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.size < 2_000_000 && /\.(js|mjs|json|css|html|md|py|txt|yml|yaml)$/i.test(name)) {
        if (SECRET.test(fs.readFileSync(p, "utf8"))) err(`${path.relative(ROOT, p)}: похоже на ключ или токен — убрать из репозитория`);
      }
    }
  };
  walk(ROOT);
}

// Хэш всего, что браузер кэширует: код сайта, темы, серии и опросники.
function buildHash() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  for (const d of ["assets", "themes", "data/episodes", "data/quiz"]) walk(rel(d));
  if (exists("data/franchises.json")) files.push(rel("data/franchises.json"));
  const h = crypto.createHash("sha1");
  for (const f of files) {
    h.update(path.relative(ROOT, f).replace(/\\/g, "/"));
    h.update(fs.readFileSync(f));
  }
  return h.digest("hex").slice(0, 10);
}

async function checkUrls() {
  const seen = new Map();
  for (const [u, where] of urls) if (!seen.has(u)) seen.set(u, where);
  const list = [...seen];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const [u, where] = list[i++];
      try {
        const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (validate)" }, signal: AbortSignal.timeout(20000) });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok) err(`${where}: ${res.status} — ${u}`);
        else if (!u.includes("fonts.googleapis.com") && !type.startsWith("image/")) err(`${where}: по ссылке не картинка (${type}) — ${u}`);
        await res.body?.cancel();
      } catch (e) {
        err(`${where}: не открывается (${e.message}) — ${u}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return list.length;
}

(async () => {
  const data = readJson("data/titles.json");
  if (data) {
    if (!Array.isArray(data.titles)) err("titles.json: нет массива titles");
    if (data.sync && !/^[\w.-]+\/[\w.-]+$/.test(data.sync.repo ?? "")) err("titles.json: sync.repo — «владелец/репозиторий»");
    const seen = new Set();
    for (const t of data.titles ?? []) checkTitle(t, seen);
    checkFranchises(seen);
    for (const dir of ["episodes", "quiz"]) {
      if (!exists("data", dir)) continue;
      for (const f of fs.readdirSync(rel("data", dir))) if (f.endsWith(".json") && !seen.has(f.slice(0, -5))) warn(`data/${dir}/${f}: тайтла с таким id нет`);
    }
    if (exists("themes")) {
      for (const d of fs.readdirSync(rel("themes"))) if (fs.statSync(rel("themes", d)).isDirectory() && !seen.has(d)) warn(`themes/${d}: тайтла с таким id нет`);
    }
  }
  scanSecrets();

  if (data && FIX && !errors.length) {
    const build = buildHash();
    data.build = build;
    fs.writeFileSync(rel("data/titles.json"), JSON.stringify(data, null, 2) + "\n");
    const html = fs.readFileSync(rel("index.html"), "utf8");
    const next = html.replace(/(assets\/[\w.-]+\?v=)[\w-]+/g, `$1${build}`);
    if (next !== html) fs.writeFileSync(rel("index.html"), next);
    console.log(`build: ${build}`);
  }

  if (CHECK_IMAGES) console.log(`проверено ссылок: ${await checkUrls()}`);

  for (const r of quizRanges) console.log(`опросник ${r}`);
  for (const w of warnings) console.log(`⚠ ${w}`);
  for (const e of errors) console.log(`✗ ${e}`);
  console.log(errors.length ? `\n✗ ошибок: ${errors.length}` : `✓ OK${warnings.length ? ` (предупреждений: ${warnings.length})` : ""}`);
  process.exit(errors.length ? 1 : 0);
})();
