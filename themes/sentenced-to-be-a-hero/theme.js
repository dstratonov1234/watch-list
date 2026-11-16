// Приговорённый быть героем — «Тюремные записи штрафного отряда героев 9004».
// Страница — зал приговора: в центре пламенная печать (священные печати из мира сериала), по её окружности —
// приказы о наказании (так серии названы в самом сериале). Исполненные приказы горят, в середине печати —
// приговор. Отметка серии — печать «исполнено», опросник — трибунал, оценка — приговор.
(() => {
  "use strict";

  const ID = "sentenced-to-be-a-hero";
  const SEEN_KEY = "sh-intro"; // заставка в этой вкладке уже игралась — повторно играть короче
  const DRAFT_KEY = "sh-draft"; // незаконченное заседание трибунала (ответы до приговора)
  const BANDS = 8;
  const R_IN = 54; // кольцо печати в единицах SVG: внутренний и внешний радиус сектора приказа
  const R_OUT = 100;
  const R_NUM = 111; // номера приказов — снаружи, как на циферблате
  const MAX_WEDGES = 40; // больше — сектора слишком узкие: остаётся кольцо и листание в панели

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

  // Сектор кольца для приказа i из n (отсчёт сверху по часовой стрелке).
  const polar = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  function wedgePath(i, n) {
    const sweep = n === 1 ? 359.99 : 360 / n;
    const a0 = -90 + (i * 360) / n;
    const a1 = a0 + sweep;
    const big = sweep > 180 ? 1 : 0;
    const f = (r, a) => polar(r, a).map((v) => v.toFixed(2)).join(" ");
    return `M${f(R_OUT, a0)}A${R_OUT} ${R_OUT} 0 ${big} 1 ${f(R_OUT, a1)}L${f(R_IN, a1)}A${R_IN} ${R_IN} 0 ${big} 0 ${f(R_IN, a0)}Z`;
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

      const parts0 = ctx.parts();
      const many = parts0.length > 1;
      const dossier = isUrl(item.images?.dossier) ? `<img src="${esc(item.images.dossier)}" alt="" decoding="async">` : ctx.art.cover('alt="" decoding="async"');

      const { prev, next } = ctx.neighbors;
      const neigh =
        prev || next
          ? `<nav class="sh-neigh" aria-label="Соседние дела">
               ${prev ? `<a class="prev" href="${esc(prev.href)}"><small>← Предыдущее дело</small><b>${esc(prev.title)}</b></a>` : "<span></span>"}
               ${next ? `<a class="next" href="${esc(next.href)}"><small>Следующее дело →</small><b>${esc(next.title)}</b></a>` : "<span></span>"}
             </nav>`
          : "";
      const tabs = many
        ? `<div class="sh-tabs" role="tablist" aria-label="Части">${parts0
            .map((p) => `<button type="button" class="sh-tab" role="tab" data-part="${esc(p.id)}">${esc(p.title || p.id)}<small></small></button>`)
            .join("")}</div>`
        : "";

      root.innerHTML = `
        <div class="sh-bg" aria-hidden="true"></div>
        <div class="sh-hall">
          <header class="sh-ident">
            <a class="sh-back" href="#/">← К списку</a>
            ${ctx.art.logo('alt=""')}
            <h1 class="sh-name">${esc(item.title)}</h1>
            <p class="sh-unit">Штрафной отряд 9004 · тюремные записи</p>
          </header>
          <section class="sh-seat" aria-label="Печать приговора">
            ${tabs}
            <div class="sh-dial">
              <i class="sh-chain a" aria-hidden="true"></i><i class="sh-chain b" aria-hidden="true"></i>
              <div class="sh-dial-core" aria-hidden="true">${dossier}</div>
              <div class="sh-dial-ring dim" aria-hidden="true"></div>
              <div class="sh-dial-ring lit" aria-hidden="true"></div>
              <div class="sh-dial-gaps" aria-hidden="true"></div>
              <svg class="sh-dial-svg" viewBox="-124 -124 248 248" role="group" aria-label="Приказы по кругу печати"></svg>
              <div class="sh-dial-center"></div>
            </div>
          </section>
          <section class="sh-order" aria-label="Выбранный приказ"></section>
          <aside class="sh-docket">
            <section class="sh-served" aria-label="Прогресс"></section>
            <section class="sh-verdict" aria-label="Приговор"></section>
            <p class="sr-only" aria-live="polite" data-say></p>
          </aside>
          ${neigh}
        </div>
        <dialog class="sh-trib" aria-label="Трибунал"></dialog>`;

      const hall = root.querySelector(".sh-hall");
      const dial = root.querySelector(".sh-dial");
      const svg = root.querySelector(".sh-dial-svg");
      const center = root.querySelector(".sh-dial-center");
      const order = root.querySelector(".sh-order");
      const served = root.querySelector(".sh-served");
      const verdict = root.querySelector(".sh-verdict");
      const say = root.querySelector("[data-say]");
      const dlg = root.querySelector(".sh-trib");

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

      // --- выбранный приказ: с него начинается страница ---
      // Смотрит дальше — выбран следующий приказ (его и отмечать); досмотрел — последний.
      const p0 = ctx.progress();
      const start = p0.next ?? p0.last;
      const sel = { part: start?.part.id ?? p0.parts[0]?.id ?? "", n: start?.n ?? 1 };
      const partOf = (id = sel.part) => ctx.parts().find((x) => x.id === id) ?? ctx.parts()[0];
      const seenSet = () => {
        const out = new Set();
        for (const p of ctx.progress().parts) for (let n = 1; n <= p.watched; n++) out.add(`${p.id}:${n}`);
        return out;
      };
      let known = seenSet();
      // Возврат назад снимает сразу несколько печатей — такое нажатие сначала «взводится» и ждёт второго.
      let armed = null; // { part, n, timer }

      // --- кольцо печати ---
      function buildDial() {
        const part = partOf();
        const n = part?.count ?? 0;
        dial.style.setProperty("--n", String(Math.max(1, n)));
        dial.classList.toggle("dense", n > MAX_WEDGES);
        if (!part || n < 1 || n > MAX_WEDGES) return void (svg.innerHTML = "");
        const every = n > 24 ? 2 : 1;
        svg.innerHTML = part.episodes
          .map((ep, i) => {
            const [x, y] = polar(R_NUM, -90 + ((i + 0.5) * 360) / n);
            const num = i % every === 0 ? `<text class="sh-wn" data-n="${ep.n}" x="${x.toFixed(2)}" y="${y.toFixed(2)}">${ep.n}</text>` : "";
            return `<path class="sh-w" d="${wedgePath(i, n)}" data-n="${ep.n}" role="button" tabindex="-1"></path>${num}`;
          })
          .join("");
      }

      function renderCenter() {
        const p = ctx.progress();
        const part = p.parts.find((x) => x.id === sel.part) ?? p.parts[0];
        const st = ctx.quizState();
        const judged = !!st && st.score != null;
        const canJudge = edit && !!quiz?.questions?.length && p.status === "completed";
        let inner;
        if (judged) {
          inner = `<span class="sh-score ${tier(st.score)}" role="img" aria-label="Оценка ${ctx.fmtScore(st.score)} из 10"><b>${ctx.fmtScore(st.score)}</b><i>из 10</i></span>`;
        } else {
          const done = many ? part.watched : p.watched;
          const total = many ? part.count : p.total;
          inner = `<span class="sh-count"><b>${done}</b><i>/ ${total}</i></span>
            <span class="sh-count-label">${ctx.plural(done, "приказ исполнен", "приказа исполнено", "приказов исполнено")}</span>`;
        }
        center.innerHTML =
          canJudge && !judged
            ? `<button type="button" class="sh-center-btn" data-act="tribunal">${inner}<span class="sh-center-cta">${trib.draft ? "продолжить заседание" : "созвать трибунал"}</span></button>`
            : inner;
        hall.classList.toggle("judged", judged);
        for (const t of ["hi", "mid", "lo"]) hall.classList.toggle(`tier-${t}`, judged && tier(st.score) === t);
      }

      function syncDial() {
        const p = ctx.progress();
        const part = p.parts.find((x) => x.id === sel.part) ?? p.parts[0];
        if (!part) return;
        const eps = partOf()?.episodes ?? [];
        dial.style.setProperty("--sh-fill", part.count ? (part.watched / part.count).toFixed(4) : "0");
        const mark = (el, n) => {
          const isNext = !!p.next && p.next.part.id === part.id && p.next.n === n;
          el.classList.toggle("seen", n <= part.watched);
          el.classList.toggle("next", isNext);
          el.classList.toggle("sel", n === sel.n);
          el.classList.toggle("doomed", !!armed && armed.part === part.id && n > armed.n && n <= part.watched);
        };
        for (const w of svg.querySelectorAll(".sh-w")) {
          const n = Number(w.dataset.n);
          mark(w, n);
          w.setAttribute("tabindex", n === sel.n ? "0" : "-1");
          const title = eps[n - 1]?.title;
          w.setAttribute("aria-label", `Приказ ${n}${title ? `: ${title}` : ""} — ${n <= part.watched ? "исполнен" : "не исполнен"}`);
          w.setAttribute("aria-current", String(n === sel.n));
        }
        for (const t of svg.querySelectorAll(".sh-wn")) mark(t, Number(t.dataset.n));
        for (const tab of root.querySelectorAll(".sh-tab")) {
          const tp = p.parts.find((x) => x.id === tab.dataset.part);
          tab.setAttribute("aria-selected", String(tab.dataset.part === sel.part));
          if (tp) tab.querySelector("small").textContent = `${tp.watched}/${tp.count}`;
        }
        renderCenter();
      }

      // --- панель выбранного приказа ---
      function drawOrder(swap) {
        const part = partOf();
        const ep = part?.episodes[sel.n - 1];
        if (!ep) return void (order.innerHTML = "");
        const [kind, what] = splitOrder(ep.title || `${ep.n} ${ctx.unitWord(part.unit, 1)}`);
        const inner = `<span class="sh-ink"><b>исполнено</b></span><span class="sh-do"></span>`;
        const stamp = edit ? `<button type="button" class="sh-stamp" data-act="stamp">${inner}</button>` : `<div class="sh-stamp">${inner}</div>`;
        order.innerHTML = `
          <div class="sh-order-in ${swap ? "swap" : ""}">
            <span class="sh-order-no" aria-hidden="true">${pad(ep.n)}</span>
            <p class="sh-kind">${esc(kind || "Приказ")}</p>
            <h2 class="sh-what"><span class="sr-only">Приказ ${ep.n}. </span>${esc(what)}</h2>
            <div class="sh-still ${ep.image ? "" : "none"}" data-gallery>
              ${ep.image ? `<img src="${esc(ep.image)}" alt="" decoding="async" data-caption="${esc(ep.title)}">` : ""}
              ${stamp}
            </div>
            <nav class="sh-order-nav" aria-label="Листать приказы">
              <button type="button" class="sh-nav" data-act="back" ${ep.n > 1 ? "" : "disabled"} aria-label="Предыдущий приказ">←</button>
              <span>${many && part.title ? `${esc(part.title)} · ` : ""}приказ ${ep.n} из ${part.count}</span>
              <button type="button" class="sh-nav" data-act="fwd" ${ep.n < part.count ? "" : "disabled"} aria-label="Следующий приказ">→</button>
            </nav>
          </div>`;
        syncOrder();
      }

      // Панель перерисовывается целиком: если фокус был на её кнопке, возвращаем его на ту же кнопку.
      function redrawOrder(swap) {
        const act = order.contains(document.activeElement) ? document.activeElement.dataset?.act : null;
        drawOrder(swap);
        if (act) (order.querySelector(`[data-act="${act}"]:not(:disabled)`) ?? order.querySelector('[data-act="stamp"], .sh-nav:not(:disabled)'))?.focus({ preventScroll: true });
      }

      function syncOrder() {
        const p = ctx.progress();
        const part = p.parts.find((x) => x.id === sel.part);
        if (!part || !order.firstElementChild) return;
        const n = sel.n;
        const cur = part.watched;
        const seen = n <= cur;
        const isNext = !!p.next && p.next.part.id === part.id && p.next.n === n;
        const isArmed = !!armed && armed.part === part.id && armed.n === n;
        order.classList.toggle("seen", seen);
        order.classList.toggle("next", isNext);
        order.classList.toggle("armed", isArmed);
        if (!seen) order.classList.remove("just");
        const drop = cur - n;
        order.querySelector(".sh-do").textContent = isArmed
          ? `снять ${drop} ${ctx.plural(drop, "печать", "печати", "печатей")}?`
          : seen
            ? ""
            : isNext
              ? edit ? "исполнить" : "следующий"
              : edit ? `исполнено по № ${n}` : "не исполнен";
        const btn = order.querySelector("button.sh-stamp");
        if (btn) {
          btn.setAttribute("aria-pressed", String(seen));
          btn.setAttribute(
            "aria-label",
            isArmed
              ? `Подтвердить: снять ${drop} ${ctx.plural(drop, "печать", "печати", "печатей")} и остановиться на приказе ${n}`
              : n === cur
                ? `Приказ ${n} исполнен. Снять с него печать`
                : seen
                  ? `Приказ ${n} исполнен. Вернуться: остановился на нём`
                  : `Отметить: остановился на приказе ${n}`,
          );
        }
        // кадр серии открывается в полный размер только у исполненных — чтобы не ловить спойлеры
        order.querySelector(".sh-still img")?.toggleAttribute("data-zoom", seen);
      }

      // --- дело: счёт приказов и приговор ---
      function renderServed() {
        const p = ctx.progress();
        const where = p.last ? `Последний исполненный — <b>${many && p.last.part.title ? `${esc(p.last.part.title)}, ` : ""}приказ № ${p.last.n}</b>` : "Ни один приказ ещё не исполнен";
        const nextBtn = edit && p.next ? `<button type="button" class="sh-btn" data-act="next">Исполнить приказ № ${p.next.n}</button>` : "";
        served.innerHTML = `
          ${tallyHtml(p.watched, p.total)}
          <p class="sh-served-line"><b>${p.watched}</b> из ${p.total} ${ctx.plural(p.total, "приказа", "приказов", "приказов")} исполнено</p>
          ${p.status === "completed" ? "" : `<p class="sh-where">${where}</p>`}
          ${nextBtn}`;
      }

      function renderVerdict() {
        const p = ctx.progress();
        const st = ctx.quizState();
        const judged = !!st && st.score != null;
        if (!quiz?.questions?.length) return void (verdict.innerHTML = "");
        if (judged) {
          verdict.innerHTML = `
            <div class="sh-verdict-kicker">Приговор трибунала</div>
            <div class="sh-verdict-label">${esc(st.verdict?.label ?? "Вынесен")}</div>
            <div class="sh-verdict-text">${esc(st.verdict?.text ?? "")}</div>
            ${edit && p.status === "completed" ? `<button type="button" class="sh-btn line" data-act="tribunal">${trib.draft ? "Продолжить заседание" : "Обжаловать приговор"}</button>` : ""}`;
        } else if (p.status === "completed" && edit) {
          verdict.innerHTML = `
            <div class="sh-verdict-kicker">Все приказы исполнены</div>
            <div class="sh-verdict-label">Дело ждёт приговора</div>
            <div class="sh-verdict-text">${quiz.questions.length} ${ctx.plural(quiz.questions.length, "вопрос", "вопроса", "вопросов")} — и оценка от 0 до 10.</div>
            <button type="button" class="sh-btn fire" data-act="tribunal">${trib.draft ? "Продолжить заседание" : "Созвать трибунал"}</button>`;
        } else if (p.status !== "completed") {
          verdict.innerHTML = `<div class="sh-verdict-note">Трибунал соберётся, когда будут исполнены все приказы.</div>`;
        } else {
          // всё исполнено, но этот браузер не подключён: заседание открыть некому
          verdict.innerHTML = `<div class="sh-verdict-note">Приговор ещё не вынесен. Созвать трибунал можно из браузера, в котором подключены отметки, — кнопка на главной.</div>`;
        }
      }

      function syncAll() {
        renderServed();
        renderVerdict();
        syncDial();
        syncOrder();
      }

      // Выбрать приказ: кольцо подсвечивает сектор, панель справа показывает его.
      function select(partId, n, focus = false) {
        const changedPart = partId !== sel.part;
        const part = partOf(partId);
        if (!part) return;
        if (armed) {
          cancel(armed.timer);
          armed = null;
        }
        sel.part = part.id;
        sel.n = clamp(n, 1, Math.max(1, part.count));
        if (changedPart) buildDial();
        redrawOrder(true);
        syncDial();
        if (focus) svg.querySelector(`.sh-w[data-n="${sel.n}"]`)?.focus({ preventScroll: true });
      }

      function disarm() {
        if (!armed) return;
        cancel(armed.timer);
        armed = null;
        syncDial();
        syncOrder();
      }

      // Печать на выбранном приказе: «остановился на нём». По последнему исполненному — снять одну печать;
      // по более раннему — возврат: снимет несколько печатей, поэтому просит подтверждения вторым нажатием.
      function stampAction() {
        if (!edit) return;
        const cur = ctx.progress().parts.find((x) => x.id === sel.part)?.watched ?? 0;
        const n = sel.n;
        if (n < cur) {
          if (armed && armed.part === sel.part && armed.n === n) {
            cancel(armed.timer);
            armed = null;
            return ctx.setWatched(sel.part, n);
          }
          if (armed) cancel(armed.timer);
          armed = { part: sel.part, n, timer: later(disarm, 4500) };
          syncDial();
          syncOrder();
          const drop = cur - n;
          say.textContent = `Снять ${drop} ${ctx.plural(drop, "печать", "печати", "печатей")} и остановиться на приказе ${n}? Нажми ещё раз, чтобы подтвердить.`;
          return;
        }
        disarm();
        ctx.setWatched(sel.part, n === cur ? n - 1 : n);
      }

      // Удар: клинок света падает на приказ в панели и на его сектор в кольце, печать врезается, летят искры.
      function strike(n) {
        const stamp = order.querySelector(".sh-stamp");
        if (stamp && order.classList.contains("seen")) {
          order.classList.remove("just");
          void order.offsetWidth;
          order.classList.add("just");
          stamp.insertAdjacentHTML("beforeend", `<span class="sh-strike" aria-hidden="true"></span>${burstHtml()}`);
        }
        const count = partOf()?.count ?? 0;
        if (count) dial.insertAdjacentHTML("beforeend", `<span class="sh-dial-strike" style="--a:${(((n - 0.5) * 360) / count).toFixed(2)}deg" aria-hidden="true"><b></b>${burstHtml()}</span>`);
        dial.classList.remove("flash");
        void dial.offsetWidth;
        dial.classList.add("flash");
        later(() => {
          root.querySelectorAll(".sh-strike, .sh-order .sh-burst, .sh-dial-strike").forEach((x) => x.remove());
          order.classList.remove("just");
          dial.classList.remove("flash");
        }, 1100);
      }

      buildDial();
      drawOrder(false);
      syncAll();

      ctx.onChange(() => {
        // отметка изменилась (здесь или с другого устройства) — взведённый возврат больше не актуален
        if (armed) {
          cancel(armed.timer);
          armed = null;
        }
        const now = seenSet();
        const fresh = [...now].filter((k) => !known.has(k));
        known = now;
        if (!fresh.length) return syncAll();
        // свежая печать: показать этот приказ, ударить — и перейти к следующему
        const [partId, nStr] = fresh[fresh.length - 1].split(":");
        const n = Number(nStr);
        if (partId !== sel.part) {
          sel.part = partId;
          buildDial();
        }
        sel.n = n;
        redrawOrder(false);
        syncAll();
        if (ctx.reducedMotion) return;
        strike(n);
        later(() => {
          const p = ctx.progress();
          // фокус идёт за выбором, если он был на кольце
          if (p.next && sel.part === partId && sel.n === n && !dlg.open) select(p.next.part.id, p.next.n, svg.contains(document.activeElement));
        }, 1350);
      });

      ctx.listen(root, "click", (e) => {
        if (dlg.contains(e.target)) return;
        const wedge = e.target.closest(".sh-w");
        if (wedge) return select(sel.part, Number(wedge.dataset.n));
        const tab = e.target.closest(".sh-tab");
        if (tab) {
          const tp = ctx.progress().parts.find((x) => x.id === tab.dataset.part);
          return tp && select(tp.id, tp.watched < tp.count ? tp.watched + 1 : tp.count);
        }
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "stamp") return stampAction();
        disarm();
        if (act === "back") select(sel.part, sel.n - 1);
        if (act === "fwd") select(sel.part, sel.n + 1);
        if (act === "next") {
          ctx.markNext();
          served.querySelector('[data-act="next"]')?.focus();
        }
        if (act === "tribunal") openTribunal();
      });

      // Кольцо с клавиатуры: стрелки ведут по приказам, Enter или пробел ставят печать.
      ctx.listen(svg, "keydown", (e) => {
        if (!e.target.closest?.(".sh-w")) return;
        const count = partOf()?.count ?? 0;
        if (!count) return;
        let n = sel.n;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (n % count) + 1;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = ((n - 2 + count) % count) + 1;
        else if (e.key === "Home") n = 1;
        else if (e.key === "End") n = count;
        else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          return stampAction();
        } else return;
        e.preventDefault();
        select(sel.part, n, true);
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
        renderVerdict(); // кнопки знают, осталось ли незаконченное заседание
        renderCenter();
        (verdict.querySelector('[data-act="tribunal"]') ?? root.querySelector(".sh-back"))?.focus({ preventScroll: true });
      });

      // ---------------------------------------------------------- заставка ---
      const handed = ctx.handoff?.layers.find((l) => l.classList.contains("sh-cut")) ?? null;
      if (ctx.reducedMotion) {
        ctx.handoff?.layers.forEach((l) => l.remove());
        hall.classList.add("sh-in");
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
        hall.classList.add("sh-in"); // печать разгорается от нуля до текущего числа приказов
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
