// Голодные игры: И вспыхнет пламя (2013) — «Наряд Цинны».
// Страница — сцена шоу Цезаря Фликермана перед Квартальной бойней. Пока фильм не отмечен, Китнисс стоит к нам
// спиной в белом свадебном платье с тлеющим подолом. Отметить фильм — «покружиться»: огонь поднимается от подола,
// и она оказывается к нам лицом — в наряде сойки-пересмешницы с крыльями. Опросник — интервью у Цезаря;
// оценка — насколько вспыхнуло пламя: цифра в огне. Следующая часть серии — «следующий выход».
(() => {
  "use strict";

  const SEEN_KEY = "cf-intro"; // заставка в этой вкладке уже игралась — повторно играть короче
  const BAND = 290; // высота горящей кромки (assets/burn.webp), см. burn.py
  const JOIN = 170; // строка сплошного угля в ней: по ней кромка стыкуется с тем, что уже сгорело
  const HEM = 8; // тлеющий подол: линия огня в покое стоит на столько выше низа кадра

  const isUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
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

  // Как разгорелось. Ступень берётся из вердикта опросника (поле tier), а если её там нет — по оценке:
  // от 7,5 — пламя, от 6 — низкий огонь, от 4 — тлеет, ниже — пепел. На баннере вердикта нет — там всегда по оценке.
  const TIERS = ["hi", "warm", "mid", "lo"];
  const tierOf = (score) => (score >= 7.5 ? "hi" : score >= 6 ? "warm" : score >= 4 ? "mid" : "lo");
  const tierFor = (score, verdict) => (TIERS.includes(verdict?.tier) ? verdict.tier : tierOf(score));

  const pic = (item, name) => (isUrl(item.images?.[name]) ? item.images[name] : null);
  const preload = (url) => {
    if (!url) return null;
    const im = new Image();
    im.decoding = "async";
    im.src = url;
    return im;
  };
  const decoded = (img, ms) =>
    Promise.race([img?.decode ? img.decode().catch(() => {}) : Promise.resolve(), new Promise((r) => setTimeout(r, ms))]);

  // Заставка: стена огня поднимается снизу и оставляет за собой уголь; на угле — эмблема фильма и название.
  function coverHtml(item, esc) {
    const logo = isUrl(item.logo) ? `<img src="${esc(item.logo)}" alt="">` : "";
    const emblem = pic(item, "emblem");
    return `<div class="cf-cv-mover">
        <i class="cf-cv-flames"></i><i class="cf-cv-edge"></i>
        <div class="cf-cv-body">
          ${emblem ? `<img class="cf-cv-art" src="${esc(emblem)}" alt="">` : ""}
          <div class="cf-cv-title">${logo}<b>${esc(item.title)}</b></div>
        </div>
        <i class="cf-cv-tail"></i>
      </div>`;
  }

  window.TitleThemes.register("the-hunger-games-catching-fire", {
    // ------------------------------------------------------------ баннер ---
    // Полоса ткани. Не смотрел — белое платье с тлеющим подолом (наведение — огонь уходит вверх по ткани,
    // под ней наряд сойки); посмотрел — сгорело целиком: крылья. Счёта у фильма нет, прогресс — сам наряд.
    banner(b) {
      const { progress: p, esc, item } = b;
      const seen = p.status === "completed";
      const judged = b.score != null;
      const logo = b.art.logo('class="cf-b-logo" alt=""');
      const bride = pic(item, "bride");
      const mock = pic(item, "mockingjay");
      const score = judged
        ? `<span class="cf-b-score" role="img" aria-label="Оценка ${b.fmtScore(b.score)} из 10"><b>${b.fmtScore(b.score)}</b></span>`
        : "";
      // Название стоит дважды: чёрным оттиском на ткани (его съедает огонь) и золотом на наряде сойки
      // (его огонь открывает). Читается вслух то, что сейчас видно.
      const name = (cls, hidden) => `<span class="cf-b-name ${cls}" ${hidden ? 'aria-hidden="true"' : ""}>${logo}<span class="cf-b-title">${esc(item.title)}</span></span>`;
      b.el.innerHTML = `
        <span class="cf-b ${seen ? "seen" : ""} ${judged ? `judged ${tierOf(b.score)}` : ""}">
          <span class="cf-b-cloth">${bride ? `<img class="cf-b-art" src="${esc(bride)}" alt="" decoding="async">` : ""}${name("ink", seen)}</span>
          <span class="cf-b-win"><span class="cf-b-dark">${mock ? `<img class="cf-b-art" src="${esc(mock)}" alt="" decoding="async">` : b.art.hero('class="cf-b-art" alt="" decoding="async"')}${name("gold", !seen)}${score}</span></span>
          <span class="cf-b-sparks" aria-hidden="true"></span>
          <span class="cf-b-edge" aria-hidden="true"></span>
        </span>`;
      b.el.querySelectorAll(".cf-b-logo").forEach(dropIfBroken);
    },

    // ----------------------------------------------- сцена при наведении ---
    // «Тик-так»: голограмма арены-часов из зала распорядителей. Двенадцать секторов, свет идёт по ним шагами,
    // как часовая стрелка; из-под баннера поднимаются искры.
    stage(s) {
      s.el.innerHTML = `
        <div class="cf-st-glow"></div>
        <div class="cf-st-arena"><i class="cf-st-disc"></i><i class="cf-st-hand"></i><i class="cf-st-rim"></i></div>
        <div class="cf-st-sparks"><i></i><i></i></div>`;
      // кадр для страницы — заранее, пока курсор на баннере
      preload(pic(s.item, s.progress.status === "completed" ? "front" : "white"));
    },

    // ---------------------------------------------------------- заставка ---
    cover(t) {
      const layer = t.layer("cf-cover");
      layer.innerHTML = coverHtml(t.item, t.esc);
      t.data.started = performance.now();
      dropIfBroken(layer.querySelector(".cf-cv-title img"));
      const ready = Promise.all([...layer.querySelectorAll("img")].map((im) => decoded(im, 300)));
      void layer.offsetWidth; // стартовое положение применить до смены класса
      layer.classList.add("closing");
      return Promise.all([ready, t.wait(840)]); // огонь дошёл до верха, экран закрыт
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
      let alive = true;
      ctx.onCleanup(() => {
        alive = false;
        timers.forEach(clearTimeout);
      });

      const hero = isUrl(item.hero) ? item.hero : "";
      const white = pic(item, "white");
      const front = pic(item, "front") ?? (hero || null); // кадр «после»; нет своего — баннерный арт
      const interview = pic(item, "interview");
      const emblem = pic(item, "emblem");
      const shot = (url, cls) => `<img class="${cls}" src="${esc(url)}" data-fallbacks="${url === hero ? "" : esc(hero)}" alt="" decoding="async">`;
      const logo = ctx.art.logo('class="cf-logo" alt=""');

      // Сверка «то ли я включил»: одна тихая надпись под названием — оригинальное название, год, длительность
      // и ссылки на карточку именно этого фильма.
      const id = ctx.ident();
      const facts = id.facts.length ? `<p class="cf-facts">${id.facts.map((f) => `<span>${esc(f)}</span>`).join("")}</p>` : "";
      const refs = id.links.length
        ? `<p class="cf-refs"><small>сверить</small>${id.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} <i aria-hidden="true">↗</i></a>`).join("")}</p>`
        : "";

      // «Следующий выход» — следующая часть серии. Ссылка — только на часть, которая уже на сайте; иначе —
      // её название с пометкой. Пока оценки нет, выход стоит тихо в углу; после оценки он — главное действие.
      const next = ctx.chain()?.next ?? null;
      const exitHtml = (main) => {
        if (!next) return "";
        const body = `<small>следующий выход</small><b>«${esc(next.title)}»</b>`;
        if (next.href) return main ? `<a class="cf-btn gold cf-next" href="${esc(next.href)}">${body}</a>` : `<a class="cf-exit" href="${esc(next.href)}">${body}</a>`;
        return `<span class="cf-exit off ${main ? "main" : ""}">${body}<i>${next.released ? "ещё не добавлен" : "ещё не вышел"}</i></span>`;
      };

      let wasSeen = ctx.progress().status === "completed";
      root.innerHTML = `
        <div class="cf-show">
          <div class="cf-bg" aria-hidden="true">
            ${white ? shot(white, "cf-bg-a") : ctx.art.hero('class="cf-bg-a" alt="" decoding="async"')}
            ${wasSeen && front ? shot(front, "cf-bg-b") : ""}
            <i class="cf-hem"></i>
            <i class="cf-bg-sparks"></i>
            <i class="cf-bg-shade"></i>
          </div>
          <a class="cf-back" href="#/">← К списку</a>
          <header class="cf-marquee">
            ${logo}
            <h1 class="cf-name">${esc(item.title)}</h1>
            ${facts}${refs}
          </header>
          <section class="cf-floor" tabindex="-1">
            <div class="cf-state"></div>
            <p class="sr-only" aria-live="polite" data-say></p>
          </section>
          <footer class="cf-foot">${exitHtml(false)}</footer>
        </div>
        <dialog class="cf-talk" aria-label="Интервью у Цезаря"></dialog>`;

      const show = root.querySelector(".cf-show");
      const bg = root.querySelector(".cf-bg");
      const floor = root.querySelector(".cf-floor");
      const foot = root.querySelector(".cf-foot");
      const stateEl = root.querySelector(".cf-state");
      const say = root.querySelector("[data-say]");
      const dlg = root.querySelector(".cf-talk");
      dropIfBroken(root.querySelector(".cf-logo"));
      show.classList.toggle("lit", wasSeen); // lit — на сцене уже наряд сойки

      // Кадр «после» кладётся в разметку, только когда нужен: под заставкой он не должен грузиться
      // наперегонки с первым кадром. Пока фильм не отмечен — подгружается чуть позже, чтобы огню было что открыть.
      function ensureAfter() {
        let b = bg.querySelector(".cf-bg-b");
        if (!b && front) {
          bg.querySelector(".cf-bg-a").insertAdjacentHTML("afterend", shot(front, "cf-bg-b"));
          b = bg.querySelector(".cf-bg-b");
        }
        return b;
      }
      if (!wasSeen) later(ensureAfter, 1700);

      // --- состояние: одно действие на экран ---
      function render() {
        const p = ctx.progress();
        const st = ctx.quizState();
        const judged = !!st && st.score != null;
        const seen = p.status === "completed";
        const single = p.total === 1;
        const canTalk = edit && !!run;
        const mustConnect = !edit && ctx.canConnect();
        show.classList.toggle("seen", seen);
        show.classList.toggle("judged", judged);
        show.classList.remove(...TIERS);
        if (judged) show.classList.add(tierFor(st.score, st.verdict));
        // следующий выход: после оценки он стоит на сцене под вердиктом, до неё — тихо в углу
        foot.hidden = judged || !next;

        let html;
        if (!seen) {
          const unit = p.next ? ctx.unitWord(p.next.part.unit, 1) : "";
          const act = edit
            ? single
              ? `<button type="button" class="cf-btn ember" data-act="watch"><b>Покружиться</b><small>отметить фильм просмотренным</small></button>`
              : `<button type="button" class="cf-btn ember" data-act="watch"><b>Отметить: ${p.next?.n ?? ""} ${unit}</b></button>${p.watched ? `<button type="button" class="cf-link" data-act="unwatch">снять последнюю отметку</button>` : ""}`
            : "";
          html = `${single ? "" : `<p class="cf-line">Отмечено ${p.watched} из ${p.total}.</p>`}${act}`;
        } else if (!judged) {
          const n = quiz?.questions?.length ?? 0;
          const act = canTalk
            ? `<button type="button" class="cf-btn gold" data-act="talk"><b>${run.draft ? "Продолжить интервью" : "Интервью у Цезаря"}</b><small>${n} ${ctx.plural(n, "вопрос", "вопроса", "вопросов")} — и оценка от 0 до 10</small></button>`
            : "";
          html = `<p class="cf-line">${canTalk ? "Платье сгорело. Цезарь ждёт у микрофона." : "Платье сгорело."}</p>${act}${edit ? `<button type="button" class="cf-link" data-act="unwatch">снять отметку</button>` : ""}`;
        } else {
          // оценка — цифра в огне; под ней — следующий выход и путь к повторному интервью
          const t = tierFor(st.score, st.verdict);
          html = `
            <div class="cf-score ${t}">
              <span class="cf-score-kicker">${esc(st.verdict?.label ?? "Оценка")}</span>
              <b class="cf-score-num" role="img" aria-label="Оценка ${ctx.fmtScore(st.score)} из 10">${ctx.fmtScore(st.score)}</b>
              <span class="cf-score-text">${esc(st.verdict?.text ?? "")}</span>
            </div>
            ${exitHtml(true)}
            ${canTalk ? `<button type="button" class="cf-link" data-act="talk">${run.draft ? "продолжить интервью" : "ответить заново"}</button>` : ""}`;
        }
        // браузер не подключён: ни отметки, ни оценки — говорим об этом и даём подключить отсюда
        if (mustConnect) html += `<p class="cf-line dim">Сейчас только просмотр: чтобы отмечать и ставить оценку, подключи этот браузер.</p><button type="button" class="cf-btn line" data-act="connect"><b>Подключить отметки</b></button>`;
        stateEl.innerHTML = html;
        return seen;
      }

      // Отметка. Огонь поднимается от тлеющего подола: быстро до платья, медленно через фигуру, быстро наверх.
      // Под огнём — кадр «после»: окно с ним едет вверх, сам кадр — навстречу и потому стоит на месте, поверх стыка —
      // горящая кромка. Двигаются только transform-ы. Старый кадр при этом чуть поворачивается — «покружилась».
      const BURN_MS = 2700;
      let burnRun = 0;
      const stopAnims = (el) => el?.getAnimations?.().forEach((a) => a.cancel());
      async function burn() {
        const my = ++burnRun;
        const b = ensureAfter();
        if (!b || still) return void show.classList.add("lit");
        show.classList.add("burning");
        const wrap = document.createElement("div");
        wrap.className = "cf-burn";
        wrap.innerHTML = `<div class="cf-burn-win"><img src="${esc(b.currentSrc || b.src)}" alt=""></div><i class="cf-burn-flames"></i><i class="cf-burn-flames b"></i><i class="cf-burn-edge"></i><i class="cf-burn-burst"></i>`;
        const inner = wrap.querySelector("img");
        bg.insertBefore(wrap, bg.querySelector(".cf-bg-sparks"));
        ctx.onCleanup(() => wrap.remove());
        await decoded(inner, 500); // без этого при быстром клике огонь открыл бы пустой кадр
        if (!alive || my !== burnRun) return void wrap.remove();

        const H = bg.clientHeight;
        // новый кадр в окне стоит ровно там же, где встанет потом
        inner.style.top = `${b.offsetTop}px`;
        inner.style.height = `${b.offsetHeight}px`;
        const ys = [H - HEM, H * 0.7, H * 0.2, -(BAND - JOIN) - 4];
        const at = [0, 0.16, 0.8, 1];
        const ease = ["cubic-bezier(0.3, 0.2, 0.5, 1)", "cubic-bezier(0.4, 0.1, 0.6, 0.9)", "cubic-bezier(0.5, 0, 0.8, 0.5)", "linear"];
        const frames = (sign) => ys.map((y, i) => ({ transform: `translate3d(0, ${sign * y}px, 0)`, offset: at[i], easing: ease[i] }));
        const opts = { duration: BURN_MS, fill: "forwards" };
        for (const el of wrap.querySelectorAll(".cf-burn-win, .cf-burn-edge, .cf-burn-flames")) el.animate(frames(1), opts);
        inner.animate(frames(-1), opts);
        inner.animate([{ scale: "1.07" }, { scale: "1" }], { duration: BURN_MS, easing: "cubic-bezier(0.2, 0.6, 0.2, 1)", fill: "forwards" });
        // старый кадр: лёгкий наезд и поворот; сполох искр вокруг фигуры, когда огонь проходит через неё
        bg.querySelector(".cf-bg-a").animate([{ transform: "none" }, { transform: "scale(1.06) rotate(1.6deg)" }], { duration: BURN_MS, easing: "ease-in-out", fill: "forwards" });
        wrap.querySelector(".cf-burn-burst").animate(
          [{ opacity: 0, scale: "0.8" }, { opacity: 0.95, scale: "1.05", offset: 0.45 }, { opacity: 0, scale: "1.3" }],
          { duration: BURN_MS * 0.62, delay: BURN_MS * 0.26, easing: "ease-out", fill: "both" },
        );
        later(() => {
          if (my !== burnRun) return;
          show.classList.add("lit");
          show.classList.remove("burning");
          later(() => wrap.remove(), 80);
        }, BURN_MS);
      }
      function unburn() {
        burnRun++;
        bg.querySelectorAll(".cf-burn").forEach((el) => el.remove());
        stopAnims(bg.querySelector(".cf-bg-a"));
        show.classList.remove("lit", "burning");
      }

      // Пока идёт огонь, действия на странице молчат: двойной клик или зажатый Enter не должны
      // тут же снять отметку или открыть интервью. Новое действие появляется ровно тогда, когда его можно нажать.
      let lockUntil = 0;
      const hold = () => (still ? 400 : BURN_MS + 650);

      render();
      ctx.onChange(() => {
        const hadFocus = stateEl.contains(document.activeElement);
        const seen = render();
        if (seen && !wasSeen) {
          say.textContent = "Фильм отмечен просмотренным.";
          lockUntil = performance.now() + hold();
          burn();
          if (!still) {
            stateEl.classList.add("wait");
            later(() => stateEl.classList.remove("wait"), hold() - 60);
          }
          if (hadFocus) {
            floor.focus({ preventScroll: true });
            later(() => document.activeElement === floor && stateEl.querySelector("button, a")?.focus({ preventScroll: true }), hold() + 40);
          }
        } else {
          if (!seen && wasSeen) {
            say.textContent = "Отметка снята.";
            unburn();
          } else if (seen && !show.classList.contains("burning")) {
            ensureAfter();
            show.classList.add("lit");
          }
          if (hadFocus) stateEl.querySelector("button, a")?.focus({ preventScroll: true });
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
        if (act === "talk") openTalk();
        if (act === "connect") ctx.connect();
      });

      // зажатая клавиша не нажимает кнопки раз за разом
      ctx.listen(root, "keydown", (e) => {
        if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault();
      });

      // -------------------------------------------------- интервью у Цезаря ---
      // Сцена шоу: кадр интервью наверху, вопрос — реплика Цезаря, ответы — строки под ней. Каркас окна
      // строится один раз, меняется только то, что внутри .cf-t-in (кадр не мигает от вопроса к вопросу).
      // Ход опросника и черновик ответов ведёт движок (ctx.quizRun) — здесь только экран и клавиши.
      let scored = false;

      function shell() {
        dlg.classList.remove("reveal", ...TIERS);
        dlg.innerHTML = `
          <div class="cf-t-stage" aria-hidden="true">${interview ? `<img src="${esc(interview)}" alt="">` : ""}</div>
          <button type="button" class="cf-t-x" data-t="close" aria-label="Прервать интервью — ответы сохранятся">×</button>
          <div class="cf-t-in"></div>`;
      }

      function openTalk() {
        if (!run || !edit) return;
        run.start();
        scored = false;
        shell();
        drawQuestion(true);
        if (!dlg.open) dlg.showModal();
        focusQuestion();
      }

      function drawQuestion(swap) {
        const q = run.question;
        const a = run.answers[q.id];
        const type = q.type ?? "choice";
        const multi = type === "multi";
        const total = run.questions.length;
        let body;
        let keys = "";
        if (type === "scale") {
          const min = Number(q.min ?? 1), max = Number(q.max ?? 5);
          const steps = Array.from({ length: max - min + 1 }, (_, n) => min + n);
          if (min >= 1 && max <= 9) keys = "цифры — ответ";
          body = `<div class="cf-scale" role="radiogroup" aria-label="${esc(q.text)}">
            ${q.labels?.[0] ? `<span>${esc(q.labels[0])}</span>` : ""}
            ${steps.map((v) => `<button type="button" class="cf-opt" role="radio" aria-checked="${a === v}" data-v="${v}"><span>${v}</span></button>`).join("")}
            ${q.labels?.[1] ? `<span>${esc(q.labels[1])}</span>` : ""}
          </div>`;
        } else {
          const opts = q.options ?? [];
          const on = (oid) => (multi ? Array.isArray(a) && a.includes(oid) : a === oid);
          if (opts.length <= 9) keys = multi ? "цифры — отметить, Enter — дальше" : "цифры — ответ";
          body = `<div class="cf-opts ${multi ? "multi" : ""}" role="${multi ? "group" : "radiogroup"}" aria-label="${esc(q.text)}">${opts
            .map((o, n) => `<button type="button" class="cf-opt" ${multi ? `aria-pressed="${on(o.id)}"` : `role="radio" aria-checked="${on(o.id)}"`} data-v="${esc(o.id)}"><i>${n + 1}</i><span>${esc(o.text)}</span>${multi ? `<u aria-hidden="true"></u>` : ""}</button>`)
            .join("")}</div>`;
        }
        // лампы по кромке сцены — по одной на вопрос; --d — насколько лампа далеко от середины (для дуги)
        const half = Math.max(1, (total - 1) / 2);
        const bulbs = run.questions
          .map((x, n) => `<i class="${n === run.i ? "now" : run.answered(x) ? "done" : ""}" style="--d:${((n - (total - 1) / 2) / half).toFixed(3)}"></i>`)
          .join("");
        // у вопроса с одним ответом «дальше» не нужно — интервью идёт само; тихая ссылка есть только там,
        // куда вернулись к уже данному ответу
        const forward = run.last
          ? `<button type="button" class="cf-btn ember" data-t="submit" ${run.canSubmit ? "" : "disabled"}><b>Вспыхнуло?</b></button>`
          : multi
            ? `<button type="button" class="cf-btn gold" data-t="next" ${run.canNext ? "" : "disabled"}><b>Дальше →</b></button>`
            : `<button type="button" class="cf-link" data-t="next" ${run.canNext ? "" : "hidden"}>дальше →</button>`;
        dlg.querySelector(".cf-t-in").innerHTML = `
          <div class="cf-t-bulbs" role="img" aria-label="Вопрос ${run.i + 1} из ${total}">${bulbs}</div>
          <section class="cf-t-q ${swap ? "swap" : ""}">
            <p class="cf-t-who" aria-hidden="true">${esc(quiz.title ?? "Интервью у Цезаря")}</p>
            <p class="cf-t-text" tabindex="-1">${esc(q.text)}</p>
            ${q.hint ? `<p class="cf-t-hint">${esc(q.hint)}</p>` : ""}
            ${body}
          </section>
          <footer class="cf-t-foot">
            <button type="button" class="cf-link" data-t="back" ${run.i ? "" : "hidden"}>← назад</button>
            <span class="cf-keys">${keys}</span>
            ${forward}
          </footer>`;
      }

      // Фокус — на тексте вопроса, а не на первом ответе: иначе Enter молча выбрал бы его.
      // У вопроса с уже данным ответом фокус встаёт на этот ответ.
      function focusQuestion() {
        const picked = dlg.querySelector('.cf-opt[aria-checked="true"]');
        (picked ?? dlg.querySelector(".cf-t-text"))?.focus({ preventScroll: true });
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
        const next = dlg.querySelector('[data-t="next"]');
        dlg.querySelector(".cf-t-bulbs .now")?.classList.toggle("done", !!run.answered(q));
        if (q.type === "multi") {
          const a = run.answers[q.id] ?? [];
          for (const b of dlg.querySelectorAll(".cf-opt")) b.setAttribute("aria-pressed", String(a.includes(b.dataset.v)));
          if (next) next.disabled = !run.canNext;
        } else {
          for (const b of dlg.querySelectorAll(".cf-opt")) b.setAttribute("aria-checked", String(b.dataset.v === String(v)));
          if (next) next.hidden = !run.canNext || advance;
        }
        const submit = dlg.querySelector('[data-t="submit"]');
        if (submit) {
          submit.disabled = !run.canSubmit;
          if (run.canSubmit && q.type !== "multi") submit.focus({ preventScroll: true }); // последний ответ дан — дальше только узнать оценку
        }
        // выбранный ответ успевает загореться — и интервью идёт дальше
        if (advance) later(() => !scored && dlg.open && run.i === at && go(1), still ? 0 : 340);
      }

      // Оглашение: эмблема фильма в темноте, под ней цифра; снизу поднимается огонь — настолько, насколько
      // вспыхнуло, — пока цифра набегает от нуля. Если не вспыхнуло — сверху сыплется пепел.
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
        const spoken = `Оценка: ${ctx.fmtScore(final)} из 10. ${res.verdict?.label ?? ""}`;
        dlg.classList.add("reveal", tierFor(final, res.verdict));
        dlg.style.setProperty("--cf-heat", String(Math.max(0, Math.min(1, final / 10))));
        dlg.innerHTML = `
          <div class="cf-r-art" aria-hidden="true">${emblem ? `<img src="${esc(emblem)}" alt="">` : ""}</div>
          <i class="cf-r-fire" aria-hidden="true"></i><i class="cf-r-fire b" aria-hidden="true"></i><i class="cf-r-sparks" aria-hidden="true"></i>
          <button type="button" class="cf-t-x" data-t="close" aria-label="Закрыть">×</button>
          <section class="cf-r">
            <b class="cf-r-num" aria-hidden="true">${still ? ctx.fmtScore(final) : ctx.fmtScore(0)}</b>
            <p class="cf-r-label">${esc(res.verdict?.label ?? "")}</p>
            <p class="cf-r-text">${esc(res.verdict?.text ?? "")}</p>
            <div class="cf-r-foot">
              <button type="button" class="cf-btn gold" data-t="close"><b>Вернуться на сцену</b></button>
              <button type="button" class="cf-link" data-t="again">ответить заново</button>
            </div>
            <p class="sr-only" aria-live="polite" data-said></p>
          </section>`;
        dlg.scrollTop = 0;
        dlg.querySelector('.cf-r-foot [data-t="close"]').focus({ preventScroll: true });
        later(() => {
          const said = dlg.querySelector("[data-said]");
          if (said) said.textContent = spoken;
        }, 150);
        if (still) return;
        const num = dlg.querySelector(".cf-r-num");
        const t0 = performance.now() + 750;
        const step = () => {
          if (!num.isConnected) return;
          const k = Math.min(1, Math.max(0, (performance.now() - t0) / 1500));
          num.textContent = ctx.fmtScore(Math.round(final * (1 - Math.pow(1 - k, 3)) * 10) / 10);
          if (k < 1) later(step, 32);
        };
        step();
      }

      ctx.listen(dlg, "click", (e) => {
        const opt = e.target.closest(".cf-opt");
        if (opt) return pick(opt.dataset.v);
        const t = e.target.closest("[data-t]")?.dataset.t;
        if (t === "close") dlg.close();
        if (t === "back") go(-1);
        if (t === "next") go(1);
        if (t === "submit") announce();
        if (t === "again") {
          // заново: те же ответы, с первого вопроса
          run.start();
          run.jump(0);
          scored = false;
          shell();
          drawQuestion(true);
          focusQuestion();
        }
      });

      ctx.listen(dlg, "keydown", (e) => {
        // Esc закрывает только окно интервью: до документа не пускаем, иначе движок уведёт к списку
        if (e.key === "Escape") return e.stopPropagation();
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const digit = /^[1-9]$/.test(e.key);
        // зажатая клавиша не отвечает за человека
        if (e.repeat && (digit || e.key === "Enter" || e.key === " ")) return e.preventDefault();
        if (scored) return;
        const opts = [...dlg.querySelectorAll(".cf-opt")];
        const scale = !!dlg.querySelector(".cf-scale");
        // цифры: у обычного вопроса — номер ответа, у шкалы — само значение
        const byDigit = digit ? (scale ? opts.find((o) => o.dataset.v === e.key) : opts[Number(e.key) - 1]) : null;
        if (byDigit) {
          e.preventDefault();
          byDigit.focus({ preventScroll: true });
          return pick(byDigit.dataset.v);
        }
        if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && opts.length) {
          e.preventDefault();
          const i = opts.indexOf(document.activeElement);
          const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
          const n = i < 0 ? (d > 0 ? 0 : opts.length - 1) : (i + d + opts.length) % opts.length;
          return opts[n].focus({ preventScroll: true });
        }
        if (e.key === "Enter") {
          // Enter на ответе выбирает его (обычный щелчок кнопки). Вне кнопок и на вопросе с несколькими
          // ответами — ведёт дальше, если на вопрос уже отвечено.
          const multi = run.question?.type === "multi";
          if ((multi && e.target.closest(".cf-opt")) || !e.target.closest("button")) {
            e.preventDefault();
            (dlg.querySelector('[data-t="next"]:not(:disabled):not([hidden])') ?? dlg.querySelector('[data-t="submit"]:not(:disabled)'))?.click();
          }
        }
      });

      ctx.listen(dlg, "close", () => {
        scored = true;
        render(); // кнопка знает, осталось ли незаконченное интервью
        (stateEl.querySelector('[data-act="talk"]') ?? root.querySelector(".cf-back"))?.focus({ preventScroll: true });
      });

      // ---------------------------------------------------------- заставка ---
      const handed = ctx.handoff?.layers.find((l) => l.classList.contains("cf-cover")) ?? null;
      if (still) {
        ctx.handoff?.layers.forEach((l) => l.remove());
        show.classList.add("cf-in");
        return;
      }

      const again = session.get(SEEN_KEY) === "1";
      session.set(SEEN_KEY, "1");
      const pageBuilt = performance.now();
      let started = ctx.handoff?.data?.started ?? pageBuilt;
      let layer = handed;
      if (!layer) {
        // прямой заход по ссылке: экран уже закрыт углём, под ним ещё ничего нет; эмблема и название
        // проявляются плавно, когда раскодируются
        layer = ctx.layer("cf-cover closed");
        layer.innerHTML = coverHtml(item, esc);
        dropIfBroken(layer.querySelector(".cf-cv-title img"));
        started = pageBuilt - 400;
        const fresh = layer;
        Promise.all([...fresh.querySelectorAll("img")].map((im) => decoded(im, 500))).then(() => requestAnimationFrame(() => fresh.classList.add("lit")));
      }

      let opened = false;
      const open = () => {
        if (opened) return;
        opened = true;
        layer.classList.remove("closing", "closed", "lit");
        layer.classList.add("opening"); // уголь уходит вверх вслед за огнём и уносит название — под ним сцена
        later(() => show.classList.add("cf-in"), 160);
        later(() => layer.remove(), 1500);
      };
      // название держится на угле; кадру сцены под ним нужно успеть загрузиться и раскодироваться
      const first = bg.querySelector(wasSeen ? ".cf-bg-b" : ".cf-bg-a") ?? bg.querySelector(".cf-bg-a");
      const wait = again ? 1050 : 1500;
      let timer = 0;
      let armed = false;
      decoded(first, 1400).then(() => {
        if (!alive) return;
        armed = true;
        timer = later(open, Math.max(340 - (performance.now() - pageBuilt), wait - (performance.now() - started), 0));
      });
      const hurry = () => {
        if (opened || !armed || performance.now() - pageBuilt < 340) return;
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
