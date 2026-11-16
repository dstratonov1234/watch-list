#!/usr/bin/env node
// Отметки пользователя лежат в ветке state (файл progress.json) — сайт пишет туда сам.
// Этот скрипт — чтобы посмотреть их и поставить отметку по прямым словам пользователя (через gh api):
//
//   node scripts/state.js show [id]              что отмечено (все тайтлы или один)
//   node scripts/state.js set <id> <partId> <n>  «в этой части посмотрено n»
//   node scripts/state.js done <id>              посмотрел целиком: все части на максимум
//   node scripts/state.js init                   создать пустой файл, если его ещё нет
//
// Ответы опросников и оценки скрипт не трогает — их ставит только пользователь на сайте.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "titles.json"), "utf8"));
const sync = data.sync ?? {};
if (!/^[\w.-]+\/[\w.-]+$/.test(sync.repo ?? "")) {
  console.error("В data/titles.json не задан sync.repo");
  process.exit(1);
}
const branch = sync.branch || "state";
const file = sync.file || "progress.json";
const endpoint = `repos/${sync.repo}/contents/${file}`;

const gh = (args) => execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function read() {
  try {
    const j = JSON.parse(gh([`${endpoint}?ref=${branch}`]));
    return { sha: j.sha, state: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) };
  } catch (e) {
    if (/404|Not Found/.test(String(e.stderr ?? e.message))) return { sha: null, state: { v: 1, titles: {} } };
    throw e;
  }
}

function write(state, sha, message) {
  const titles = {};
  for (const id of Object.keys(state.titles).sort()) titles[id] = state.titles[id];
  const text = JSON.stringify({ v: 1, titles }, null, 2) + "\n";
  const args = ["--method", "PUT", endpoint, "-f", `message=${message}`, "-f", `content=${Buffer.from(text).toString("base64")}`, "-f", `branch=${branch}`];
  if (sha) args.push("-f", `sha=${sha}`);
  gh(args);
}

const title = (id) => {
  const t = (data.titles ?? []).find((x) => x.id === id);
  if (!t) {
    console.error(`Нет тайтла «${id}» в data/titles.json`);
    process.exit(1);
  }
  return t;
};

function describe(t, e) {
  const parts = (t?.parts ?? []).map((p) => `${p.title || p.id}: ${Math.min(e?.w?.[p.id] ?? 0, p.count)}/${p.count}`).join(", ");
  const score = e?.q ? ` · оценка ${e.q.s ?? "—"}` : "";
  return `${parts || JSON.stringify(e?.w ?? {})}${score}`;
}

function mark(id, changes, message) {
  const t = title(id);
  const { sha, state } = read();
  const e = (state.titles[id] ??= { w: {}, wt: 0, q: null, qt: 0 });
  for (const [partId, n] of changes) {
    const part = t.parts.find((p) => String(p.id) === String(partId));
    if (!part) {
      console.error(`У «${id}» нет части «${partId}» (есть: ${t.parts.map((p) => p.id).join(", ")})`);
      process.exit(1);
    }
    const v = Math.max(0, Math.min(part.count, Math.floor(Number(n))));
    if (!Number.isFinite(v)) {
      console.error("n должно быть числом");
      process.exit(1);
    }
    if (v) e.w[part.id] = v;
    else delete e.w[part.id];
    e.last = String(part.id);
  }
  e.wt = Date.now();
  write(state, sha, message);
  console.log(`${t.title} — ${describe(t, e)}`);
}

const [cmd, id, partId, n] = process.argv.slice(2);

if (cmd === "show") {
  const { state } = read();
  const ids = id ? [id] : (data.titles ?? []).map((t) => t.id);
  for (const x of ids) {
    const t = (data.titles ?? []).find((y) => y.id === x);
    console.log(`${t?.title ?? x} [${x}] — ${describe(t, state.titles[x])}`);
  }
  const extra = Object.keys(state.titles).filter((x) => !(data.titles ?? []).some((t) => t.id === x));
  if (!id && extra.length) console.log(`В отметках есть тайтлы, которых нет в списке: ${extra.join(", ")}`);
} else if (cmd === "set" && id && partId && n != null) {
  mark(id, [[partId, n]], `Прогресс: ${id} ${partId}=${n}`);
} else if (cmd === "done" && id) {
  mark(id, title(id).parts.map((p) => [p.id, p.count]), `Прогресс: ${id} посмотрен целиком`);
} else if (cmd === "init") {
  const { sha, state } = read();
  if (sha) console.log("Файл уже есть");
  else {
    write(state, null, "Пустые отметки");
    console.log("Создан пустой progress.json");
  }
} else {
  console.error("Использование: node scripts/state.js show [id] | set <id> <partId> <n> | done <id> | init");
  process.exit(1);
}
