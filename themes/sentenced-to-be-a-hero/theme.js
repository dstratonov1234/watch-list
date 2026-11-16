// Приговорённый быть героем — «Тюремные записи штрафного отряда героев 9004».
// Страница — дело осуждённого: серии — приказы о наказании (так они названы в самом сериале),
// отметка — печать «исполнено», опросник — трибунал, оценка — приговор.
(() => {
  "use strict";

  const ID = "sentenced-to-be-a-hero";
  const SEEN_KEY = "sh-intro"; // заставка в этой вкладке уже игралась — повторно играть короче
  const DRAFT_KEY = "sh-draft"; // незаконченное заседание трибунала (ответы до приговора)
  const BANDS = 8;

  const isUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
  const pad = (n) => String(n).padStart(2, "0");
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  const session = {
    get(k) {
      try {
        return sessionStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) sessionStorage.removeItem(k);
        else sessionStorage.setItem(k, v);
      } catch {
        /* без памяти вкладки заставка просто всегда полная, а черновик живёт до ухода со страницы */
      }
    },
  };

  // Каким вышел приговор: от 7,5 — печать богини (пламя и золото), от 6 — золотой штамп, ниже — кровавый.
  const tier = (score) => (score >= 7.5 ? "hi" : score >= 6 ? "mid" : "lo");

  // Зарубки на стене камеры: по одной на приказ, пятая перечёркивает четыре.
  function tallyHtml(done, total) {
    if (total > 60) {
      const p = total ? Math.round((done / total) * 100) : 0;
      return `<span class="sh-bar" aria-hidden="true"><i style="width:${p}%"></i></span>`;
    }
    let out = "";
    for (let g = 0; g < total; g += 5) {
      const n = Math.min(5, total - g);
      let marks = "";
      for (let k = 0; k < Math.min(n, 4); k++) marks += `<i class="${g + k < done ? "on" : ""}"></i>`;
      if (n === 5) marks += `<b class="${g + 4 < done ? "on" : ""}"></b>`;
      out += `<span class="sh-tg">${marks}</span>`;
    }
    return `<span class="sh-tally" aria-hidden="true">${out}</span>`;
  }

  // «Наказание: оборона крепости…» → вид приказа и его суть (если в названии серии есть двоеточие).
  function splitOrder(title) {
    const i = title.indexOf(":");
    if (i > 0 && i < 40 && i < title.length - 1) {
      const what = title.slice(i + 1).trim();
      return [title.slice(0, i).trim(), what.charAt(0).toUpperCase() + what.slice(1)];
    }
    return ["", title];
  }

  // Слой заставки: полосы-разрезы, под названием — арт дела, само название в двойной золотой рамке.
  function cutHtml(item, esc) {
    const bands = Array.from({ length: BANDS }, (_, i) => {
      const fromCentre = Math.floor(Math.abs(i - (BANDS - 1) / 2));
      return `<i class="sh-cut-band" style="--i:${i};--j:${fromCentre};--dir:${i % 2 ? "88%" : "-88%"}"></i>`;
    }).join("");
    const art = isUrl(item.images?.dossier) ? `<div class="sh-cut-art"><img src="${esc(item.images.dossier)}" alt=""></div>` : "";
    const logo = isUrl(item.logo) ? `<img src="${esc(item.logo)}" alt="">` : "";
    return `<div class="sh-cut-rot">${bands}</div>${art}
      <div class="sh-cut-title"><span class="sh-cut-frame">${logo}<b>${esc(item.title)}</b></span></div>`;
  }

  // Арт под названием проявляется, только когда картинка готова, — иначе он «вспыхнет» посреди заставки.
  function armArt(layer) {
    const img = layer.querySelector(".sh-cut-art img");
    if (!img) return;
    (img.decode ? img.decode() : Promise.resolve()).then(
      () => layer.classList.add("art"),
      () => {},
    );
  }

  const stageLayer = () => document.querySelector(`.stage-layer[data-title="${ID}"]`);

  // Искры от удара печати.
  function burstHtml(n = 9) {
    let out = "";
    for (let i = 0; i < n; i++) {
      const a = Math.round((360 / n) * i + Math.random() * 26 - 13);
      out += `<i style="--a:${a}deg;--d:${Math.round(34 + Math.random() * 30)}px"></i>`;
    }
    return `<span class="sh-burst" aria-hidden="true">${out}</span>`;
  }

  window.TitleThemes.register("sentenced-to-be-a-hero", {
    // ------------------------------------------------------------ баннер ---
    banner(b) {
      const { progress: p, esc } = b;
      const label = b.plural(p.watched, "приказ исполнен", "приказа исполнено", "приказов исполнено");
      const art = b.art.hero('alt="" decoding="async"');
      const judged = b.score != null;
      const seal = judged
        ? `<span class="sh-b-seal ${tier(b.score)}" role="img" aria-label="Приговор: ${b.fmtScore(b.score)} из 10"><b>${b.fmtScore(b.score)}</b></span>`
        : "";
      b.el.innerHTML = `
        <span class="sh-b ${judged ? "judged" : ""}">
          <span class="sh-b-fire" aria-hidden="true"></span>
          <span class="sh-b-shard sh-b-a">${art}
            <span class="sh-b-id">${b.art.logo('class="sh-b-logo" alt=""')}<span class="sh-b-name">${esc(b.item.title)}</span></span>
          </span>
          <span class="sh-b-shard sh-b-m" aria-hidden="true">${art}</span>
          <span class="sh-b-shard sh-b-c">${art}
            <span class="sh-b-prog">
              <span class="sh-b-count"><b>${p.watched}</b><i>/ ${p.total}</i></span>
              <span class="sh-b-label">${label}</span>
              ${tallyHtml(p.watched, p.total)}
            </span>
            ${seal}
          </span>
        </span>`;
    },

    // ----------------------------------------------- сцена при наведении ---
    // Кольцо клинков вокруг баннера, все остриём в него. Углы считаются для типичного баннера,
    // а место — от настоящего (переменные --bcx/--bcy/--bw/--bh ставит движок).
    stage(s) {
      const N = 16;
      const A = 1160 / 2 + 96;
      const B = 212 / 2 + 170;
      let swords = "";
      for (let i = 0; i < N; i++) {
        const phi = (Math.PI * 2 * i) / N + Math.PI / N;
        const cx = Math.cos(phi);
        const cy = Math.sin(phi);
        // клинок в ассете смотрит остриём вниз; поворачиваем так, чтобы остриё смотрело в центр баннера
        const r = (Math.atan2(cx * A, -cy * B) * 180) / Math.PI;
        swords += `<i class="sh-st-sw" style="--cx:${cx.toFixed(4)};--cy:${cy.toFixed(4)};--r:${r.toFixed(1)}deg;--i:${i}"><b></b></i>`;
      }
      s.el.innerHTML = `<div class="sh-st-ground"></div><div class="sh-st-seal"></div>${swords}`;
      // арт для заставки — заранее, пока курсор ещё на баннере
      if (isUrl(s.item.images?.dossier)) new Image().src = s.item.images.dossier;
    },

    // ---------------------------------------------------------- заставка ---
    cover(t) {
      stageLayer()?.classList.add("sh-drop"); // клинки со сцены бьют в баннер
      const layer = t.layer("sh-cut");
      layer.innerHTML = cutHtml(t.item, t.esc);
      t.data.started = performance.now();
      const img = layer.querySelector(".sh-cut-frame img");
      const decoded = img?.decode ? Promise.race([img.decode().catch(() => {}), t.wait(300)]) : Promise.resolve();
      armArt(layer);
      void layer.offsetWidth; // стартовое положение применить до смены класса
      layer.classList.add("closing");
      // экран закрыт, когда раскрылась последняя полоса (44 мс × 7 + 110 + 360)
      return Promise.all([decoded, t.wait(800)]);
    },

    // ---------------------------------------------------------- страница ---
    page(ctx) {
      const { esc, item, root } = ctx;
      const quiz = ctx.quiz;
      const edit = ctx.canEdit();
      const timers = new Set();
      const later = (fn, ms) => {
        const id = setTimeout(() => {
          timers.delete(id);
          fn();
        }, ms);
        timers.add(id);
        return id;
      };
      const cancel = (id) => {
        clearTimeout(id);
        timers.delete(id);
      };
      ctx.onCleanup(() => {
        timers.forEach(clearTimeout);
        stageLayer()?.classList.remove("sh-drop");
      });

      const dossier = isUrl(item.images?.dossier) ? `<img src="${esc(item.images.dossier)}" alt="" decoding="async">` : ctx.art.cover('alt="" decoding="async"');

      // --- приказы ---
      let k = 0;
      const partsHtml = ctx
        .parts()
        .map((part, pi, all) => {
          const orders = part.episodes
            .map((ep) => {
              const [kind, what] = splitOrder(ep.title || `${ep.n} ${ctx.unitWord(part.unit, 1)}`);
              const still = ep.image
                ? `<div class="sh-still"><img src="${esc(ep.image)}" alt="" loading="lazy" decoding="async" data-caption="${esc(ep.title)}"></div>`
                : `<div class="sh-still none"></div>`;
              const inner = `<span class="sh-ink"><b>исполнено</b></span><span class="sh-do"></span>`;
              const stamp = edit ? `<button type="button" class="sh-stamp" data-part="${esc(part.id)}" data-n="${ep.n}">${inner}</button>` : `<div class="sh-stamp">${inner}</div>`;
              return `
                <li class="sh-order" data-part="${esc(part.id)}" data-n="${ep.n}" style="--k:${Math.min(k++, 14)}">
                  <span class="sh-no" aria-hidden="true">${pad(ep.n)}</span>
                  <div class="sh-slip">
                    ${still}
                    <div class="sh-text">
                      ${kind ? `<span class="sh-kind">${esc(kind)}</span>` : ""}
                      <p class="sh-what"><span class="sr-only">Приказ ${ep.n}. </span>${esc(what)}</p>
                    </div>
                    ${stamp}
                  </div>
                </li>`;
            })
            .join("");
          return `
            <section class="sh-part" data-part="${esc(part.id)}">
              <h2 class="sh-part-head"><span>${esc(part.title || "Приказы")}</span><small>штрафной отряд 9004 · приказы</small>${all.length > 1 ? `<i data-count></i>` : ""}</h2>
              <ol class="sh-orders" data-gallery>${orders}</ol>
            </section>`;
        })
        .join("");

      const { prev, next } = ctx.neighbors;
      const neigh =
        prev || next
          ? `<nav class="sh-neigh" aria-label="Соседние дела">
               ${prev ? `<a class="prev" href="${esc(prev.href)}"><small>← Предыдущее дело</small><b>${esc(prev.title)}</b></a>` : "<span></span>"}
               ${next ? `<a class="next" href="${esc(next.href)}"><small>Следующее дело →</small><b>${esc(next.title)}</b></a>` : "<span></span>"}
             </nav>`
          : "";

      root.innerHTML = `
        <div class="sh-bg" aria-hidden="true"></div>
        <div class="sh-page">
          <aside class="sh-dossier">
            <a class="sh-back" href="#/">← К списку</a>
            <div class="sh-portrait">
              ${dossier}
              <div class="sh-ident">
                ${ctx.art.logo('alt=""')}
                <h1 class="sh-name">${esc(item.title)}</h1>
              </div>
            </div>
            <section class="sh-served" aria-label="Прогресс"></section>
            <section class="sh-verdict" aria-label="Приговор"></section>
            <p class="sr-only" aria-live="polite" data-say></p>
          </aside>
          <div class="sh-ledger">${partsHtml}${neigh}</div>
        </div>
        <dialog class="sh-trib" aria-label="Трибунал"></dialog>`;

      const page = root.querySelector(".sh-page");
      const dossierEl = root.querySelector(".sh-dossier");
      const served = root.querySelector(".sh-served");
      const verdict = root.querySelector(".sh-verdict");
      const say = root.querySelector("[data-say]");
      const dlg = root.querySelector(".sh-trib");
      const orderEls = [...root.querySelectorAll(".sh-order")];

      // --- трибунал: состояние заседания (нужно и блоку приговора) ---
      const trib = { answers: {}, i: 0, done: false, draft: false };
      try {
        const d = JSON.parse(session.get(DRAFT_KEY) ?? "null");
        if (d && d.id === item.id && d.a && typeof d.a === "object") Object.assign(trib, { answers: d.a, i: Number(d.i) || 0, draft: true });
      } catch {
        /* битый черновик — просто начнём заново */
      }
      const saveDraft = () => {
        trib.draft = true;
        session.set(DRAFT_KEY, JSON.stringify({ id: item.id, a: trib.answers, i: trib.i }));
      };
      const dropDraft = () => {
        trib.draft = false;
        session.set(DRAFT_KEY, null);
      };

      // --- счёт приказов ---
      function renderServed() {
        const p = ctx.progress();
        const label = ctx.plural(p.watched, "приказ исполнен", "приказа исполнено", "приказов исполнено");
        const many = p.parts.length > 1;
        const where = p.last ? `Последний исполненный — <b>${many && p.last.part.title ? `${esc(p.last.part.title)}, ` : ""}приказ № ${p.last.n}</b>` : "Ни один приказ ещё не исполнен";
        const nextBtn = edit && p.next ? `<button type="button" class="sh-btn" data-act="next">Исполнить приказ № ${p.next.n}</button>` : "";
        served.innerHTML = `
          <div class="sh-served-num"><b>${p.watched}</b><span>/ ${p.total}</span></div>
          <div class="sh-served-label">${label}</div>
          ${tallyHtml(p.watched, p.total)}
          ${p.status === "completed" ? "" : `<p class="sh-where">${where}</p>`}
          ${nextBtn}`;
      }

      // --- приговор ---
      function renderVerdict() {
        const p = ctx.progress();
        const st = ctx.quizState();
        const judged = !!st && st.score != null;
        dossierEl.classList.toggle("judged", judged);
        if (!quiz?.questions?.length) return void (verdict.innerHTML = "");
        if (judged) {
          verdict.innerHTML = `
            <div class="sh-seal ${tier(st.score)}" role="img" aria-label="Оценка ${ctx.fmtScore(st.score)} из 10"><b>${ctx.fmtScore(st.score)}</b></div>
            <div class="sh-verdict-kicker">Приговор трибунала</div>
            <div class="sh-verdict-label">${esc(st.verdict?.label ?? "Вынесен")}</div>
            <div class="sh-verdict-text">${esc(st.verdict?.text ?? "")}</div>
            ${edit && p.status === "completed" ? `<button type="button" class="sh-btn line" data-act="tribunal">${trib.draft ? "Продолжить заседание" : "Обжаловать приговор"}</button>` : ""}`;
        } else if (p.status === "completed" && edit) {
          verdict.innerHTML = `
            <div class="sh-seal wait" aria-hidden="true"></div>
            <div class="sh-verdict-kicker">Все приказы исполнены</div>
            <div class="sh-verdict-label">Дело ждёт приговора</div>
            <div class="sh-verdict-text">${quiz.questions.length} ${ctx.plural(quiz.questions.length, "вопрос", "вопроса", "вопросов")} — и оценка от 0 до 10.</div>
            <button type="button" class="sh-btn fire" data-act="tribunal">${trib.draft ? "Продолжить заседание" : "Созвать трибунал"}</button>`;
        } else if (p.status !== "completed") {
          verdict.innerHTML = `
            <div class="sh-seal wait" aria-hidden="true"></div>
            <div class="sh-verdict-note">Трибунал соберётся, когда будут исполнены все приказы.</div>`;
        } else {
          // всё исполнено, но этот браузер не подключён: заседание открыть некому
          verdict.innerHTML = `
            <div class="sh-seal wait" aria-hidden="true"></div>
            <div class="sh-verdict-note">Приговор ещё не вынесен. Созвать трибунал можно из браузера, в котором подключены отметки, — кнопка на главной.</div>`;
        }
      }

      // --- печати на приказах ---
      let known = null; // что было отмечено при прошлой отрисовке: «часть:номер»
      // Возврат назад снимает сразу несколько печатей — такой клик сначала только «взводится» и ждёт второго.
      let armed = null; // { part, n, timer }

      function showArmed() {
        const cur = armed ? (ctx.progress().parts.find((x) => x.id === armed.part)?.watched ?? 0) : 0;
        for (const el of orderEls) {
          const n = Number(el.dataset.n);
          const mine = !!armed && el.dataset.part === armed.part;
          el.classList.toggle("armed", mine && n === armed.n);
          el.classList.toggle("doomed", mine && n > armed.n && n <= cur);
          if (mine && n === armed.n) {
            const drop = cur - armed.n;
            el.querySelector(".sh-do").textContent = `снять ${drop} ${ctx.plural(drop, "печать", "печати", "печатей")}?`;
          }
        }
      }

      function disarm() {
        if (!armed) return;
        cancel(armed.timer);
        armed = null;
        renderOrders(false);
      }

      function renderOrders(animate) {
        const p = ctx.progress();
        const watched = new Map(p.parts.map((x) => [x.id, x.watched]));
        const seenNow = new Set();
        const fresh = [];
        for (const el of orderEls) {
          const part = el.dataset.part;
          const n = Number(el.dataset.n);
          const cur = watched.get(part) ?? 0;
          const seen = n <= cur;
          const isNext = !!p.next && p.next.part.id === part && p.next.n === n;
          if (seen) seenNow.add(`${part}:${n}`);
          if (seen && known && !known.has(`${part}:${n}`)) fresh.push(el);
          el.classList.toggle("seen", seen);
          el.classList.toggle("next", isNext);
          if (!seen) el.classList.remove("just");
          const btn = el.querySelector(".sh-stamp");
          el.querySelector(".sh-do").textContent = seen ? "" : isNext ? (edit ? "исполнить" : "следующий") : edit ? `по № ${n}` : "";
          if (btn.tagName === "BUTTON") {
            btn.setAttribute("aria-pressed", String(seen));
            btn.setAttribute(
              "aria-label",
              n === cur ? `Приказ ${n} исполнен. Снять с него печать` : seen ? `Приказ ${n} исполнен. Вернуться: остановился на нём` : `Отметить: остановился на приказе ${n}`,
            );
          }
          // кадр серии открывается в полный размер только у исполненных — чтобы не ловить спойлеры
          const img = el.querySelector(".sh-still img");
          if (img) img.toggleAttribute("data-zoom", seen);
        }
        for (const sec of root.querySelectorAll(".sh-part")) {
          const part = p.parts.find((x) => x.id === sec.dataset.part);
          const count = sec.querySelector("[data-count]");
          if (part && count) count.textContent = `${part.watched} / ${part.count}`;
        }
        if (animate && !ctx.reducedMotion) fresh.slice(-6).forEach((el, i) => later(() => strike(el), i * 90));
        known = seenNow;
        showArmed();
      }

      // Удар: клинок света падает на приказ, печать врезается, летят искры.
      function strike(el) {
        if (!el.isConnected || !el.classList.contains("seen")) return;
        el.classList.remove("just");
        void el.offsetWidth;
        el.classList.add("just");
        const spot = el.querySelector(".sh-stamp");
        spot.insertAdjacentHTML("beforeend", `<span class="sh-strike" aria-hidden="true"></span>${burstHtml()}`);
        const fx = [...spot.querySelectorAll(".sh-strike, .sh-burst")].slice(-2);
        later(() => {
          fx.forEach((x) => x.remove());
          el.classList.remove("just");
        }, 1000);
      }

      function renderAll(animate) {
        renderServed();
        renderVerdict();
        renderOrders(animate);
      }
      renderAll(false);
      ctx.onChange(() => {
        // отметка изменилась (здесь или с другого устройства) — взведённый возврат больше не актуален
        if (armed) {
          cancel(armed.timer);
          armed = null;
        }
        renderAll(true);
      });

      ctx.listen(root, "click", (e) => {
        const stamp = e.target.closest("button.sh-stamp");
        if (stamp) {
          const part = stamp.dataset.part;
          const n = Number(stamp.dataset.n);
          const cur = ctx.progress().parts.find((x) => x.id === part)?.watched ?? 0;
          if (n < cur) {
            // возврат к приказу n снимет печати с n+1…cur: первый клик взводит, второй — подтверждает
            if (armed && armed.part === part && armed.n === n) {
              cancel(armed.timer);
              armed = null;
              return ctx.setWatched(part, n);
            }
            if (armed) cancel(armed.timer);
            armed = { part, n, timer: later(disarm, 4500) };
            renderOrders(false);
            const drop = cur - n;
            say.textContent = `Снять ${drop} ${ctx.plural(drop, "печать", "печати", "печатей")} и остановиться на приказе ${n}? Нажми ещё раз, чтобы подтвердить.`;
            return;
          }
          disarm();
          // печать на приказе n: остановился на нём; повторно по последнему исполненному — снять с него печать
          return ctx.setWatched(part, n === cur ? n - 1 : n);
        }
        disarm();
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "next") {
          ctx.markNext();
          served.querySelector('[data-act="next"]')?.focus();
        }
        if (act === "tribunal") openTribunal();
      });

      // ---------------------------------------------------------- трибунал ---
      // Заседание: по одному вопросу на экран. Ответ на вопрос с одним вариантом сразу ведёт дальше.
      // Ответы — черновик: закрытое окно их не теряет, приговор выносится только по кнопке.
      function openTribunal() {
        if (!quiz?.questions?.length || !edit) return;
        if (!trib.draft) {
          trib.answers = JSON.parse(JSON.stringify(ctx.quizState()?.answers ?? {}));
          trib.i = 0;
        }
        trib.i = clamp(trib.i, 0, quiz.questions.length - 1);
        trib.done = false;
        renderQuestion(true);
        if (!dlg.open) dlg.showModal();
        focusOption();
      }

      const answered = (q) => {
        const a = trib.answers[q.id];
        return q.type === "multi" ? Array.isArray(a) : a != null;
      };

      function renderQuestion(swap) {
        const qs = quiz.questions;
        const q = qs[trib.i];
        const a = trib.answers[q.id];
        const type = q.type ?? "choice";
        let body;
        if (type === "scale") {
          const min = Number(q.min ?? 1), max = Number(q.max ?? 5);
          const steps = Array.from({ length: max - min + 1 }, (_, n) => min + n);
          body = `<div class="sh-scale" role="radiogroup" aria-label="${esc(q.text)}">
            ${q.labels?.[0] ? `<span>${esc(q.labels[0])}</span>` : ""}
            ${steps.map((v) => `<button type="button" class="sh-opt" role="radio" aria-checked="${a === v}" data-v="${v}">${v}</button>`).join("")}
            ${q.labels?.[1] ? `<span>${esc(q.labels[1])}</span>` : ""}
          </div>`;
        } else if (type === "multi") {
          body = `<div class="sh-opts ${(q.options ?? []).length > 6 ? "many" : ""}" role="group" aria-label="${esc(q.text)}">${(q.options ?? [])
            .map((o, n) => `<button type="button" class="sh-opt" aria-pressed="${Array.isArray(a) && a.includes(o.id)}" data-v="${esc(o.id)}"><i>${n + 1}</i><span>${esc(o.text)}</span></button>`)
            .join("")}</div>`;
        } else {
          body = `<div class="sh-opts" role="radiogroup" aria-label="${esc(q.text)}">${(q.options ?? [])
            .map((o, n) => `<button type="button" class="sh-opt" role="radio" aria-checked="${a === o.id}" data-v="${esc(o.id)}"><i>${n + 1}</i><span>${esc(o.text)}</span></button>`)
            .join("")}</div>`;
        }
        const last = trib.i === qs.length - 1;
        const ok = answered(q) || type === "multi";
        const rest = qs.every((x) => x === q || answered(x));
        dlg.innerHTML = `
          <div class="sh-trib-in">
            <header class="sh-trib-head">
              <h2 class="sh-trib-title">${esc(quiz.title ?? "Трибунал")}</h2>
              <span class="sh-trib-count" aria-label="Вопрос ${trib.i + 1} из ${qs.length}"><b>${trib.i + 1}</b> / ${qs.length}</span>
              <button type="button" class="sh-trib-x" data-t="close" aria-label="Прервать заседание — ответы сохранятся"><span>×</span></button>
            </header>
            <div class="sh-ticks" aria-hidden="true">${qs.map((x, n) => `<i class="${n === trib.i ? "now" : answered(x) ? "done" : ""}"></i>`).join("")}</div>
            <section class="sh-q ${swap ? "swap" : ""}">
              <span class="sh-q-no" aria-hidden="true">${pad(trib.i + 1)}</span>
              <p class="sh-q-text">${esc(q.text)}</p>
              ${q.hint ? `<p class="sh-q-hint">${esc(q.hint)}</p>` : ""}
              ${body}
            </section>
            <footer class="sh-trib-foot">
              <button type="button" class="sh-btn line" data-t="back" ${trib.i ? "" : "disabled"}>← Назад</button>
              <span class="sh-keys">${type === "multi" ? "цифры или пробел — отметить, Enter — дальше" : "цифры — ответ, Enter — дальше"}</span>
              ${
                last
                  ? `<button type="button" class="sh-btn fire" data-t="sentence" ${ok && rest ? "" : "disabled"}>Огласить приговор</button>`
                  : `<button type="button" class="sh-btn" data-t="next" ${ok ? "" : "disabled"}>Дальше →</button>`
              }
            </footer>
          </div>`;
      }

      function focusOption() {
        const opts = [...dlg.querySelectorAll(".sh-opt")];
        (opts.find((o) => o.getAttribute("aria-checked") === "true") ?? opts[0])?.focus({ preventScroll: true });
      }

      function go(delta) {
        const n = trib.i + delta;
        if (n < 0 || n >= quiz.questions.length) return;
        const q = quiz.questions[trib.i];
        if (delta > 0 && q.type === "multi" && !Array.isArray(trib.answers[q.id])) trib.answers[q.id] = []; // «никого» — тоже ответ
        trib.i = n;
        saveDraft();
        renderQuestion(true);
        dlg.scrollTop = 0;
        focusOption();
      }

      function pick(v) {
        const q = quiz.questions[trib.i];
        const type = q.type ?? "choice";
        if (type === "multi") {
          const cur = new Set(Array.isArray(trib.answers[q.id]) ? trib.answers[q.id] : []);
          cur.has(v) ? cur.delete(v) : cur.add(v);
          trib.answers[q.id] = (q.options ?? []).map((o) => o.id).filter((id) => cur.has(id));
          saveDraft();
          for (const b of dlg.querySelectorAll(".sh-opt")) b.setAttribute("aria-pressed", String(cur.has(b.dataset.v)));
          return;
        }
        trib.answers[q.id] = type === "scale" ? Number(v) : v;
        saveDraft();
        for (const b of dlg.querySelectorAll(".sh-opt")) b.setAttribute("aria-checked", String(b.dataset.v === String(v)));
        const at = trib.i;
        if (at === quiz.questions.length - 1) {
          const btn = dlg.querySelector('[data-t="sentence"]');
          if (btn) btn.disabled = !quiz.questions.every(answered);
          return;
        }
        dlg.querySelector('[data-t="next"]').disabled = false;
        // выбранный ответ успевает загореться — и заседание идёт дальше
        later(() => !trib.done && dlg.open && trib.i === at && go(1), ctx.reducedMotion ? 0 : 340);
      }

      function sentence() {
        const q = quiz.questions[trib.i];
        if (q.type === "multi" && !Array.isArray(trib.answers[q.id])) trib.answers[q.id] = [];
        if (!ctx.scoreQuiz(trib.answers).complete) {
          // остались вопросы без ответа — вернуться к первому из них
          trib.i = quiz.questions.findIndex((x) => !answered(x));
          renderQuestion(true);
          return focusOption();
        }
        trib.done = true;
        dropDraft();
        const score = ctx.saveQuiz(trib.answers);
        const v = ctx.verdictFor(score);
        dlg.innerHTML = `
          <div class="sh-trib-in">
            <header class="sh-trib-head">
              <h2 class="sh-trib-title">${esc(quiz.title ?? "Трибунал")}</h2>
              <button type="button" class="sh-trib-x" data-t="close" aria-label="Закрыть" style="margin-left:auto"><span>×</span></button>
            </header>
            <section class="sh-sentence" aria-live="polite">
              <span class="sh-sentence-kicker">Приговор</span>
              <div class="sh-sentence-seal ${tier(score)}" role="img" aria-label="Оценка ${ctx.fmtScore(score)} из 10">
                <span class="sh-press"><b>${ctx.fmtScore(score)}</b></span>
                ${ctx.reducedMotion ? "" : `<span class="sh-strike" aria-hidden="true"></span>${burstHtml(14)}`}
              </div>
              <p class="sh-sentence-label">${esc(v?.label ?? "Вынесен")}</p>
              <p class="sh-sentence-text">${esc(v?.text ?? "")}</p>
              <div class="sh-sentence-foot">
                <button type="button" class="sh-btn line" data-t="again">Обжаловать</button>
                <button type="button" class="sh-btn" data-t="close">Закрыть дело</button>
              </div>
            </section>
          </div>`;
        dlg.scrollTop = 0;
        dlg.querySelector('.sh-sentence-foot [data-t="close"]').focus({ preventScroll: true });
      }

      ctx.listen(dlg, "click", (e) => {
        const opt = e.target.closest(".sh-opt");
        if (opt) return pick(opt.dataset.v);
        const t = e.target.closest("[data-t]")?.dataset.t;
        if (t === "close") dlg.close();
        if (t === "back") go(-1);
        if (t === "next") go(1);
        if (t === "sentence") sentence();
        if (t === "again") {
          // обжалование: те же ответы, с первого вопроса
          trib.i = 0;
          trib.done = false;
          renderQuestion(true);
          focusOption();
        }
      });

      ctx.listen(dlg, "keydown", (e) => {
        // Esc закрывает только заседание: до документа не пускаем, иначе движок уведёт к списку
        if (e.key === "Escape") return e.stopPropagation();
        if (trib.done || e.ctrlKey || e.metaKey || e.altKey) return;
        const opts = [...dlg.querySelectorAll(".sh-opt")];
        if (/^[1-9]$/.test(e.key) && opts[Number(e.key) - 1]) {
          e.preventDefault();
          opts[Number(e.key) - 1].focus();
          return pick(opts[Number(e.key) - 1].dataset.v);
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (!opts.length) return;
          e.preventDefault();
          const i = opts.indexOf(document.activeElement);
          opts[(i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length]?.focus();
        }
        if (e.key === "Enter") {
          // на вопросе с несколькими ответами Enter ведёт дальше (отмечают пробелом или цифрой);
          // на обычном — Enter на варианте выбирает его, и заседание идёт дальше само
          const multi = quiz.questions[trib.i].type === "multi";
          if ((multi && e.target.closest(".sh-opt")) || !e.target.closest("button")) {
            e.preventDefault();
            (dlg.querySelector('[data-t="next"]:not(:disabled)') ?? dlg.querySelector('[data-t="sentence"]:not(:disabled)'))?.click();
          }
        }
      });

      ctx.listen(dlg, "close", () => {
        trib.done = true;
        renderVerdict(); // кнопка знает, осталось ли незаконченное заседание
        (verdict.querySelector('[data-act="tribunal"]') ?? root.querySelector(".sh-back"))?.focus({ preventScroll: true });
      });

      // ---------------------------------------------------------- заставка ---
      const handed = ctx.handoff?.layers.find((l) => l.classList.contains("sh-cut")) ?? null;
      if (ctx.reducedMotion) {
        ctx.handoff?.layers.forEach((l) => l.remove());
        page.classList.add("sh-in");
        return;
      }

      const again = session.get(SEEN_KEY) === "1";
      session.set(SEEN_KEY, "1");
      const pageBuilt = performance.now();
      let started = ctx.handoff?.data?.started ?? pageBuilt;
      let layer = handed;
      if (!layer) {
        // прямой заход по ссылке: экран закрыт сразу, под ним ещё ничего нет
        layer = ctx.layer("sh-cut closed");
        layer.innerHTML = cutHtml(item, esc);
        armArt(layer);
        started = pageBuilt - 500;
      }

      let opened = false;
      const open = () => {
        if (opened) return;
        opened = true;
        layer.classList.remove("closing");
        layer.classList.add("closed");
        void layer.offsetWidth;
        layer.classList.add("opening");
        page.classList.add("sh-in");
        later(() => layer.remove(), 1500);
      };
      // название держится на закрытом экране; странице под ним нужно не меньше трети секунды, чтобы собраться
      const hold = again ? 1200 : 1750;
      const timer = later(open, Math.max(320, hold - (performance.now() - started)));
      const hurry = () => {
        if (opened || performance.now() - pageBuilt < 320) return;
        cancel(timer);
        open();
      };
      ctx.listen(window, "pointerdown", hurry);
      ctx.listen(window, "keydown", hurry);
      ctx.listen(window, "wheel", hurry, { passive: true });
      ctx.onCleanup(() => layer.remove());
    },
  });
})();
