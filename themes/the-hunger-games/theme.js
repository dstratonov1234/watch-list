// Голодные игры (2012) — «Эфир Капитолия».
// Страница — экран капитолийской трансляции: кадр фильма во весь экран и графика эфира поверх него.
// Отметить фильм — «Игры окончены» (герб в ночном небе над ареной); опросник — совет распорядителей, которые
// в фильме ставят трибутам баллы; оценка объявляется как балл трибута — портрет и цифра; следующая часть
// серии — «далее в эфире».
(() => {
  "use strict";

  const SEEN_KEY = "hg-intro"; // заставка в этой вкладке уже игралась — повторно играть короче

  const isUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
  const cssUrl = (u) => `url("${String(u).replace(/["\\\n\r]/g, "")}")`;
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
        sessionStorage.setItem(k, v);
      } catch {
        /* без памяти вкладки заставка просто всегда полная */
      }
    },
  };

  // Логотип не загрузился — убрать картинку: тогда название покажется текстом (оно всегда лежит рядом).
  // Движок сперва пробует запасные адреса и меняет src — это не поломка.
  function dropIfBroken(img) {
    if (!img) return;
    let prev = img.src;
    img.addEventListener("error", () => {
      if (img.src !== prev) return void (prev = img.src);
      img.remove();
    });
  }

  // Как объявлен балл — по ступеням вердиктов: от 7,5 золотом, от 4 ровным светом экрана, ниже — погасшим.
  const tier = (score) => (score >= 7.5 ? "hi" : score >= 4 ? "mid" : "lo");

  // Пусковая труба: свет арены за створками, створки, название.
  function tubeHtml(item, esc) {
    const logo = isUrl(item.logo) ? `<img src="${esc(item.logo)}" alt="">` : "";
    return `<i class="hg-tube-light"></i><i class="hg-door l"></i><i class="hg-door r"></i>
      <div class="hg-tube-title">${logo}<b>${esc(item.title)}</b></div>`;
  }

  window.TitleThemes.register("the-hunger-games", {
    // ------------------------------------------------------------ баннер ---
    // Китнисс с натянутым луком: стрела смотрит туда, где после совета появится балл.
    banner(b) {
      const { progress: p, esc, chain } = b;
      const seen = p.status === "completed";
      const judged = b.score != null;
      const logo = b.art.logo('class="hg-b-logo" alt=""');
      // место в серии — вместо счёта серий: у фильма отметка одна
      const part = chain && chain.total > 1 ? `<span class="hg-b-part">${b.item.type === "film" ? "фильм" : "часть"} ${chain.index} из ${chain.total}</span>` : "";
      const score = judged
        ? `<span class="hg-b-score ${tier(b.score)}" role="img" aria-label="Оценка ${b.fmtScore(b.score)} из 10"><small>оценка</small><b>${b.fmtScore(b.score)}</b></span>`
        : "";
      b.el.innerHTML = `
        <span class="hg-b ${seen ? "seen" : ""} ${judged ? "judged" : ""}">
          <span class="hg-b-screen">${b.art.hero('alt="" decoding="async"')}<span class="hg-b-scan" aria-hidden="true"></span></span>
          <span class="hg-b-brk" aria-hidden="true"></span>
          <span class="hg-b-lower">
            ${logo}<span class="hg-b-title">${esc(b.item.title)}</span>
            ${part}
          </span>
          ${score}
        </span>`;
      dropIfBroken(b.el.querySelector(".hg-b-logo"));
    },

    // ----------------------------------------------- сцена при наведении ---
    // Ночь на арене: лес, герб в небе за баннером и спускающиеся парашюты спонсоров.
    stage(s) {
      const chutes = [
        [7, 0.9, 19, -2],
        [22, 0.6, 26, -14],
        [38, 1.1, 17, -9],
        [57, 0.7, 23, -5],
        [73, 1, 20, -16],
        [90, 0.65, 28, -11],
      ]
        .map(([x, sc, d, delay]) => `<i class="hg-st-chute" style="--x:${x}%;--s:${sc};--d:${d}s;--delay:${delay}s;--o:${sc > 0.8 ? 0.95 : 0.6}"></i>`)
        .join("");
      s.el.innerHTML = `<div class="hg-st-seal"></div><div class="hg-st-forest"></div>${chutes}`;
      // кадр для страницы — заранее, пока курсор на баннере
      if (isUrl(s.item.images?.backdrop)) new Image().src = s.item.images.backdrop;
    },

    // ---------------------------------------------------------- заставка ---
    cover(t) {
      const layer = t.layer("hg-tube");
      layer.innerHTML = tubeHtml(t.item, t.esc);
      t.data.started = performance.now();
      const img = layer.querySelector(".hg-tube-title img");
      dropIfBroken(img);
      const decoded = img?.decode ? Promise.race([img.decode().catch(() => {}), t.wait(300)]) : Promise.resolve();
      void layer.offsetWidth; // стартовое положение применить до смены класса
      layer.classList.add("closing");
      return Promise.all([decoded, t.wait(700)]); // створки сомкнулись
    },

    // ---------------------------------------------------------- страница ---
    page(ctx) {
      const { esc, item, root } = ctx;
      const quiz = ctx.quiz;
      const edit = ctx.canEdit();
      const run = quiz?.questions?.length ? ctx.quizRun() : null;
      const still = !!ctx.reducedMotion;
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
      ctx.onCleanup(() => timers.forEach(clearTimeout));

      // кадр во весь экран; не загрузился — движок подставит баннерный
      const backdrop = isUrl(item.images?.backdrop)
        ? `<img src="${esc(item.images.backdrop)}" data-fallbacks="${isUrl(item.hero) ? esc(item.hero) : ""}" alt="" decoding="async">`
        : ctx.art.hero('alt="" decoding="async"');
      const logo = ctx.art.logo('alt=""');
      // портрет трибута — Китнисс на показе распорядителям: на карточке, в зале совета и при объявлении балла
      const tribute = isUrl(item.images?.tribute) ? item.images.tribute : null;
      const face = tribute ? `<img class="hg-face" src="${esc(tribute)}" alt="" decoding="async">` : ctx.art.cover('alt=""');

      // «Далее в эфире» — следующая часть серии; «ранее» — предыдущая. Ссылка — только на часть, которая уже на сайте.
      const chain = ctx.chain();
      const tick = (x, label) => {
        if (!x) return "";
        const body = `<small>${label}</small><b>${esc(x.title)}</b>`;
        return x.href ? `<a class="hg-tick" href="${esc(x.href)}">${body}<span aria-hidden="true">→</span></a>` : `<span class="hg-tick off">${body}<span>— ${x.released ? "ещё не добавлен" : "ещё не вышел"}</span></span>`;
      };
      const loop = "74-е Голодные игры · Весь мир смотрит · И пусть удача всегда будет с вами · ";
      const ticker = `
        <footer class="hg-ticker">
          ${chain ? tick(chain.next, "далее в эфире") + tick(chain.prev, "ранее") : ""}
          <div class="hg-marquee" aria-hidden="true"><span>${loop.repeat(5)}</span><span>${loop.repeat(5)}</span></div>
        </footer>`;

      root.innerHTML = `
        <div class="hg-air">
          <div class="hg-bg" aria-hidden="true">${backdrop}</div>
          <header class="hg-top">
            <a class="hg-back" href="#/">← К списку</a>
            <span class="hg-bug" aria-hidden="true">Трансляция<br>Капитолия<i></i></span>
          </header>
          <div class="hg-stage">
            <section class="hg-lower" tabindex="-1">
              <span class="hg-kicker">${chain && chain.total > 1 ? `${item.type === "film" ? "Фильм" : "Часть"} ${chain.index} из ${chain.total}` : "Эфир Капитолия"}</span>
              ${logo}
              <h1 class="hg-name">${esc(item.title)}</h1>
              <div class="hg-state"></div>
              <p class="sr-only" aria-live="polite" data-say></p>
            </section>
            <aside class="hg-card" aria-label="Оценка распорядителей">
              <div class="hg-card-photo">${face}</div>
              <div class="hg-card-meta"></div>
            </aside>
          </div>
          ${ticker}
        </div>
        <dialog class="hg-session" aria-label="Совет распорядителей"></dialog>`;

      const air = root.querySelector(".hg-air");
      const lower = root.querySelector(".hg-lower");
      dropIfBroken(lower.querySelector(":scope > img"));
      const stateEl = root.querySelector(".hg-state");
      const card = root.querySelector(".hg-card");
      const cardMeta = root.querySelector(".hg-card-meta");
      const say = root.querySelector("[data-say]");
      const dlg = root.querySelector(".hg-session");
      if (tribute) dlg.style.setProperty("--hg-shot", cssUrl(tribute));
      let wasSeen = ctx.progress().status === "completed";

      // --- состояние: одно действие на экран ---
      function render() {
        const p = ctx.progress();
        const st = ctx.quizState();
        const judged = !!st && st.score != null;
        const seen = p.status === "completed";
        const single = p.total === 1;
        const mustConnect = !edit && ctx.canConnect();
        air.classList.toggle("seen", seen);
        air.classList.toggle("judged", judged);

        let html;
        if (!seen) {
          const unit = p.next ? ctx.unitWord(p.next.part.unit, 1) : "";
          const line = single ? "Игры ещё впереди." : `Отмечено ${p.watched} из ${p.total}.`;
          const act = edit
            ? single
              ? `<button type="button" class="hg-btn" data-act="watch">Игры окончены<small>отметить фильм просмотренным</small></button>`
              : `<button type="button" class="hg-btn" data-act="watch">Отметить: ${p.next?.n ?? ""} ${unit}</button>${p.watched ? `<button type="button" class="hg-link" data-act="unwatch">снять последнюю отметку</button>` : ""}`
            : "";
          html = `<p class="hg-line">${line}</p>${act}`;
        } else if (!judged) {
          const act =
            edit && run
              ? `<button type="button" class="hg-btn gold" data-act="session">${run.draft ? "Продолжить совет" : "Выставить оценку"}<small>${quiz.questions.length} ${ctx.plural(quiz.questions.length, "вопрос", "вопроса", "вопросов")} — и балл от 0 до 10</small></button>`
              : "";
          html = `<p class="hg-line">Игры окончены. Слово — распорядителям.</p>${act}${edit ? `<button type="button" class="hg-link" data-act="unwatch">снять отметку</button>` : ""}`;
        } else {
          // балл уже на карточке — здесь только путь к пересмотру
          html = edit && run ? `<button type="button" class="hg-link" data-act="session">${run.draft ? "продолжить совет" : "пересмотреть оценку"}</button>` : "";
        }
        // браузер не подключён: ни отметки, ни оценки — говорим об этом и даём подключить отсюда
        if (mustConnect) html += `<p class="hg-line">Сейчас только просмотр: чтобы отмечать и ставить оценку, подключи этот браузер.</p><button type="button" class="hg-btn line" data-act="connect">Подключить отметки</button>`;
        stateEl.innerHTML = html;

        // портрет на карточке не пересоздаётся — меняется только подпись, поэтому он плавно «включается» в цвет
        card.className = `hg-card ${judged ? tier(st.score) : ""}`;
        cardMeta.innerHTML = `
          <span class="hg-card-label">Оценка распорядителей</span>
          ${
            judged
              ? `<b class="hg-card-num" role="img" aria-label="${ctx.fmtScore(st.score)} из 10">${ctx.fmtScore(st.score)}</b>
                 <span class="hg-card-verdict">${esc(st.verdict?.label ?? "")}</span>
                 <span class="hg-card-text">${esc(st.verdict?.text ?? "")}</span>`
              : `<span class="hg-card-wait">${seen ? "Ещё не объявлена." : "Объявят, когда Игры закончатся."}</span>`
          }`;
        return seen;
      }

      // Фильм только что отмечен: над ареной ночь, в небе герб — «Игры окончены».
      function gamesOver() {
        const el = ctx.layer("hg-over");
        el.innerHTML = `<i class="hg-over-forest"></i><i class="hg-over-seal"></i><b>Игры окончены</b>`;
        later(() => el.remove(), 2700);
      }

      // Пока идёт объявление, действия на странице молчат: двойной клик или зажатый Enter не должны
      // тут же снять отметку или открыть совет.
      let lockUntil = 0;
      const hold = () => (still ? 500 : 2500);

      render();
      ctx.onChange(() => {
        const hadFocus = stateEl.contains(document.activeElement);
        const seen = render();
        if (seen && !wasSeen) {
          say.textContent = "Фильм отмечен просмотренным.";
          lockUntil = performance.now() + hold();
          if (!still) gamesOver();
          if (hadFocus) {
            // фокус ждёт на плашке и переходит к следующему действию, когда объявление закончится
            lower.focus({ preventScroll: true });
            later(() => document.activeElement === lower && stateEl.querySelector("button")?.focus({ preventScroll: true }), hold() + 50);
          }
        } else {
          if (!seen && wasSeen) say.textContent = "Отметка снята.";
          if (hadFocus) stateEl.querySelector("button")?.focus({ preventScroll: true });
        }
        wasSeen = seen;
      });

      ctx.listen(root, "click", (e) => {
        if (dlg.contains(e.target)) return;
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (!act || performance.now() < lockUntil) return;
        if (act === "watch") {
          // последняя отметка: второй клик двойного щелчка не должен попасть в «снять отметку»
          const p = ctx.progress();
          if (p.total - p.watched <= 1) lockUntil = performance.now() + 700;
          ctx.markNext();
        }
        if (act === "unwatch") {
          const last = ctx.progress().last;
          if (last) ctx.setWatched(last.part.id, last.n - 1);
        }
        if (act === "session") openSession();
        if (act === "connect") ctx.connect();
      });

      // зажатая клавиша не нажимает кнопки раз за разом
      ctx.listen(root, "keydown", (e) => {
        if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault();
      });

      // ------------------------------------------------ совет распорядителей ---
      // Ход опросника и черновик ответов ведёт движок (ctx.quizRun) — здесь только экран и клавиши.
      let scored = false;

      function openSession() {
        if (!run || !edit) return;
        run.start();
        scored = false;
        drawQuestion(true);
        if (!dlg.open) dlg.showModal();
        focusQuestion();
      }

      function drawQuestion(swap) {
        const q = run.question;
        const a = run.answers[q.id];
        const type = q.type ?? "choice";
        const total = run.questions.length;
        let body;
        if (type === "scale") {
          const min = Number(q.min ?? 1), max = Number(q.max ?? 5);
          const steps = Array.from({ length: max - min + 1 }, (_, n) => min + n);
          body = `<div class="hg-scale" role="radiogroup" aria-label="${esc(q.text)}">
            ${q.labels?.[0] ? `<span>${esc(q.labels[0])}</span>` : ""}
            ${steps.map((v) => `<button type="button" class="hg-opt" role="radio" aria-checked="${a === v}" data-v="${v}">${v}</button>`).join("")}
            ${q.labels?.[1] ? `<span>${esc(q.labels[1])}</span>` : ""}
          </div>`;
        } else {
          const multi = type === "multi";
          const opts = q.options ?? [];
          const many = opts.length > 6;
          const on = (id) => (multi ? Array.isArray(a) && a.includes(id) : a === id);
          // длинный список — в две колонки, сверху вниз: цифры и стрелки идут по колонке
          body = `<div class="hg-opts ${many ? "many" : ""}" ${many ? `style="--rows:${Math.ceil(opts.length / 2)}"` : ""} role="${multi ? "group" : "radiogroup"}" aria-label="${esc(q.text)}">${opts
            .map((o, n) => `<button type="button" class="hg-opt" ${multi ? `aria-pressed="${on(o.id)}"` : `role="radio" aria-checked="${on(o.id)}"`} data-v="${esc(o.id)}"><i>${n + 1}</i><span>${esc(o.text)}</span></button>`)
            .join("")}</div>`;
        }
        dlg.classList.remove("reveal");
        dlg.innerHTML = `
          <div class="hg-s-in">
            <header class="hg-s-head">
              <h2 class="hg-s-title">${esc(quiz.title ?? "Совет распорядителей")}</h2>
              <span class="hg-s-count" aria-label="Вопрос ${run.i + 1} из ${total}"><b>${run.i + 1}</b> / ${total}</span>
              <button type="button" class="hg-s-x" data-t="close" aria-label="Прервать совет — ответы сохранятся">×</button>
            </header>
            <div class="hg-s-bars" aria-hidden="true">${run.questions.map((x, n) => `<i class="${n === run.i ? "now" : run.answered(x) ? "done" : ""}"></i>`).join("")}</div>
            <section class="hg-s-q ${swap ? "swap" : ""}">
              <span class="hg-s-no" aria-hidden="true">Вопрос ${run.i + 1}</span>
              <p class="hg-s-text" tabindex="-1">${esc(q.text)}</p>
              ${q.hint ? `<p class="hg-s-hint">${esc(q.hint)}</p>` : ""}
              ${body}
            </section>
            <footer class="hg-s-foot">
              <button type="button" class="hg-btn line" data-t="back" ${run.i ? "" : "disabled"}>← Назад</button>
              <span class="hg-keys">${type === "multi" ? "цифры — отметить, Enter — дальше" : "цифры — ответ"}</span>
              ${
                run.last
                  ? `<button type="button" class="hg-btn gold" data-t="submit" ${run.canSubmit ? "" : "disabled"}>Объявить балл</button>`
                  : `<button type="button" class="hg-btn" data-t="next" ${run.canNext ? "" : "disabled"}>Дальше →</button>`
              }
            </footer>
          </div>`;
      }

      // Фокус — на тексте вопроса, а не на первом ответе: иначе Enter молча выбрал бы его.
      // У вопроса с уже данным ответом фокус встаёт на этот ответ.
      function focusQuestion() {
        const picked = dlg.querySelector('.hg-opt[aria-checked="true"]');
        (picked ?? dlg.querySelector(".hg-s-text"))?.focus({ preventScroll: true });
      }

      function go(delta) {
        if (!run.go(delta)) return;
        drawQuestion(true);
        dlg.scrollTop = 0;
        focusQuestion();
      }

      function pick(v) {
        const q = run.question;
        const at = run.i;
        const advance = run.pick(v);
        if (q.type === "multi") {
          const a = run.answers[q.id] ?? [];
          for (const b of dlg.querySelectorAll(".hg-opt")) b.setAttribute("aria-pressed", String(a.includes(b.dataset.v)));
          return;
        }
        for (const b of dlg.querySelectorAll(".hg-opt")) b.setAttribute("aria-checked", String(b.dataset.v === String(v)));
        const next = dlg.querySelector('[data-t="next"]');
        if (next) next.disabled = false;
        const submit = dlg.querySelector('[data-t="submit"]');
        if (submit) {
          submit.disabled = !run.canSubmit;
          if (run.canSubmit) submit.focus({ preventScroll: true }); // последний ответ дан — дальше только объявить балл
        }
        // выбранный ответ успевает загореться — и совет идёт дальше
        if (advance) later(() => !scored && dlg.open && run.i === at && go(1), still ? 0 : 320);
      }

      // Объявление балла — как в эфире объявляют баллы трибутов: портрет и цифра, которая набегает от нуля.
      function announce() {
        if (!run.canSubmit) {
          run.jump(Math.max(0, run.firstUnanswered()));
          drawQuestion(true);
          return focusQuestion();
        }
        const res = run.submit();
        if (!res) return;
        scored = true;
        const final = res.score;
        const spoken = `Оценка распорядителей: ${ctx.fmtScore(final)} из 10. ${res.verdict?.label ?? ""}`;
        dlg.classList.add("reveal");
        dlg.innerHTML = `
          <div class="hg-s-in">
            <header class="hg-s-head">
              <h2 class="hg-s-title">${esc(quiz.title ?? "Совет распорядителей")}</h2>
              <button type="button" class="hg-s-x" data-t="close" aria-label="Закрыть">×</button>
            </header>
            <section class="hg-score ${tier(final)}">
              <div class="hg-score-photo">${face}</div>
              <div class="hg-score-meta">
                <span class="hg-score-kicker">Оценка распорядителей</span>
                <b class="hg-score-num" aria-hidden="true">${still ? ctx.fmtScore(final) : ctx.fmtScore(0)}</b>
                <p class="hg-score-label">${esc(res.verdict?.label ?? "")}</p>
                <p class="hg-score-text">${esc(res.verdict?.text ?? "")}</p>
                <div class="hg-score-foot">
                  <button type="button" class="hg-btn" data-t="close">Вернуться в эфир</button>
                  <button type="button" class="hg-btn line" data-t="again">Пересмотреть</button>
                </div>
                <p class="sr-only" aria-live="polite" data-said></p>
              </div>
            </section>
          </div>`;
        dlg.scrollTop = 0;
        dlg.querySelector('.hg-score-foot [data-t="close"]').focus({ preventScroll: true });
        later(() => {
          const said = dlg.querySelector("[data-said]");
          if (said) said.textContent = spoken;
        }, 150);
        if (still) return;
        const num = dlg.querySelector(".hg-score-num");
        const t0 = performance.now() + 650;
        const step = () => {
          if (!num.isConnected) return;
          const k = Math.min(1, Math.max(0, (performance.now() - t0) / 1100));
          num.textContent = ctx.fmtScore(Math.round(final * (1 - Math.pow(1 - k, 3)) * 10) / 10);
          if (k < 1) later(step, 32);
        };
        step();
      }

      ctx.listen(dlg, "click", (e) => {
        const opt = e.target.closest(".hg-opt");
        if (opt) return pick(opt.dataset.v);
        const t = e.target.closest("[data-t]")?.dataset.t;
        if (t === "close") dlg.close();
        if (t === "back") go(-1);
        if (t === "next") go(1);
        if (t === "submit") announce();
        if (t === "again") {
          // пересмотр: те же ответы, с первого вопроса
          run.start();
          run.jump(0);
          scored = false;
          drawQuestion(true);
          focusQuestion();
        }
      });

      ctx.listen(dlg, "keydown", (e) => {
        // Esc закрывает только окно совета: до документа не пускаем, иначе движок уведёт к списку
        if (e.key === "Escape") return e.stopPropagation();
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const digit = /^[1-9]$/.test(e.key);
        // зажатая клавиша не отвечает за человека
        if (e.repeat && (digit || e.key === "Enter" || e.key === " ")) return e.preventDefault();
        if (scored) return;
        const opts = [...dlg.querySelectorAll(".hg-opt")];
        if (digit && opts[Number(e.key) - 1]) {
          e.preventDefault();
          opts[Number(e.key) - 1].focus({ preventScroll: true });
          return pick(opts[Number(e.key) - 1].dataset.v);
        }
        if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && opts.length) {
          e.preventDefault();
          const i = opts.indexOf(document.activeElement);
          const rows = Number(dlg.querySelector(".hg-opts.many")?.style.getPropertyValue("--rows")) || 0;
          let n;
          if (rows && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            n = i < 0 ? 0 : i + (e.key === "ArrowRight" ? rows : -rows); // в соседнюю колонку
            if (n < 0 || n >= opts.length) return;
          } else {
            const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
            n = i < 0 ? (d > 0 ? 0 : opts.length - 1) : (i + d + opts.length) % opts.length;
          }
          return opts[n].focus({ preventScroll: true });
        }
        if (e.key === "Enter") {
          // Enter на ответе выбирает его (обычный щелчок кнопки). Вне кнопок и на вопросе с несколькими
          // ответами — ведёт дальше, если на вопрос уже отвечено.
          const multi = run.question?.type === "multi";
          if ((multi && e.target.closest(".hg-opt")) || !e.target.closest("button")) {
            e.preventDefault();
            (dlg.querySelector('[data-t="next"]:not(:disabled)') ?? dlg.querySelector('[data-t="submit"]:not(:disabled)'))?.click();
          }
        }
      });

      ctx.listen(dlg, "close", () => {
        scored = true;
        render(); // кнопка знает, остался ли незаконченный совет
        (stateEl.querySelector('[data-act="session"]') ?? root.querySelector(".hg-back"))?.focus({ preventScroll: true });
      });

      // ---------------------------------------------------------- заставка ---
      const handed = ctx.handoff?.layers.find((l) => l.classList.contains("hg-tube")) ?? null;
      if (still) {
        ctx.handoff?.layers.forEach((l) => l.remove());
        air.classList.add("hg-in");
        return;
      }

      const again = session.get(SEEN_KEY) === "1";
      session.set(SEEN_KEY, "1");
      const pageBuilt = performance.now();
      let started = ctx.handoff?.data?.started ?? pageBuilt;
      let layer = handed;
      if (!layer) {
        // прямой заход по ссылке: створки уже сомкнуты, под ними ещё ничего нет
        layer = ctx.layer("hg-tube closed");
        layer.innerHTML = tubeHtml(item, esc);
        dropIfBroken(layer.querySelector(".hg-tube-title img"));
        started = pageBuilt - 450;
      }

      let opened = false;
      const open = () => {
        if (opened) return;
        opened = true;
        layer.classList.add("opening"); // створки расходятся — за ними свет арены…
        later(() => {
          air.classList.add("hg-in");
          layer.classList.add("gone"); // …глаза привыкают, и под ним — страница
        }, 520);
        later(() => layer.remove(), 1500);
      };
      // название держится на сомкнутых створках; странице под ними нужно не меньше трети секунды, чтобы собраться
      const wait = again ? 1100 : 1650;
      const timer = later(open, Math.max(320, wait - (performance.now() - started)));
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
