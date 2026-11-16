#!/usr/bin/env node
// Порядок просмотра серии и что смотреть дальше — по data/franchises.json и отметкам пользователя (ветка state).
// Запускать ПЕРЕД тем, как готовить любой тайтл: готовится всегда первая часть серии, которую он ещё не досмотрел.
//
//   node scripts/order.js                 все серии
//   node scripts/order.js <серия|тайтл>   одна серия (по id серии или id любого её тайтла)
//
// Значки: ✓ досмотрено · ◐ начато · ○ добавлено, не начато · — ещё не добавлено на сайт · ⏳ ещё не вышло
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const data = read("data/titles.json");
const franchises = fs.existsSync(path.join(ROOT, "data/franchises.json")) ? read("data/franchises.json") : {};
const byId = new Map((data.titles ?? []).map((t) => [t.id, t]));

function loadState() {
  const sync = data.sync ?? {};
  if (!/^[\w.-]+\/[\w.-]+$/.test(sync.repo ?? "")) return {};
  try {
    const out = execFileSync("gh", ["api", `repos/${sync.repo}/contents/${sync.file || "progress.json"}?ref=${sync.branch || "state"}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(Buffer.from(JSON.parse(out).content, "base64").toString("utf8")).titles ?? {};
  } catch (e) {
    console.error(`(отметки не прочитались: ${String(e.stderr ?? e.message).trim().split("\n")[0]})`);
    return {};
  }
}

const state = loadState();

// Сколько отмечено у тайтла и досмотрен ли он.
function progress(t) {
  const e = state[t.id] ?? {};
  let watched = 0;
  let total = 0;
  for (const p of t.parts ?? []) {
    total += p.count;
    watched += Math.min(p.count, e.w?.[p.id] ?? 0);
  }
  return { watched, total, done: total > 0 && watched >= total && !t.ongoing, score: e.q?.s ?? null };
}

function show(fid, f) {
  console.log(`\n${f.title}  [${fid}]${f.note ? `\n  ${f.note}` : ""}`);
  let next = null;
  f.entries.forEach((e, i) => {
    const t = e.id ? byId.get(e.id) : null;
    let mark, tail;
    if (e.released === false) [mark, tail] = ["⏳", "ещё не вышло"];
    else if (!t) [mark, tail] = ["—", "не добавлено на сайт"];
    else {
      const p = progress(t);
      mark = p.done ? "✓" : p.watched ? "◐" : "○";
      tail = `${p.watched}/${p.total}${p.score != null ? `, оценка ${p.score}` : p.done ? ", опросник не пройден" : ""}  [${t.id}]`;
      if (p.done) tail += "";
    }
    const done = mark === "✓";
    if (!done && !next && e.released !== false) next = { n: i + 1, e, added: !!t };
    console.log(`  ${String(i + 1).padStart(2)}. ${mark} ${e.title}${e.year ? ` (${e.year})` : ""} — ${tail}`);
  });
  if (next) console.log(`  → смотреть дальше: № ${next.n} «${next.e.title}»${next.added ? "" : " — её и нужно готовить"}`);
  else console.log("  → всё вышедшее досмотрено");
}

const arg = process.argv[2];
const list = Object.entries(franchises).filter(([fid, f]) => !arg || fid === arg || (f.entries ?? []).some((e) => e.id === arg));
if (!list.length) {
  console.error(arg ? `Нет серии или тайтла «${arg}» в data/franchises.json` : "data/franchises.json пуст");
  process.exit(1);
}
for (const [fid, f] of list) show(fid, f);
