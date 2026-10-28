// Student app: deck setup, Today (with focus), daily session, and progress file.
// Students pick topics; the scheduler works on each topic's hidden cards.

(function () {
  const $app = document.getElementById("app");
  const P = window.PROGRAM;   // this program's settings (title, wording, storage keys), from program.js
  const esc = (s) => Render.esc(s);
  let state, cfg, meta, byId = {}, cardsOf = {};
  let view = "today";

  // ---------- helpers ----------
  // Demo mode (demo.html): a fixed mid-semester student on a fixed date. Nothing is saved, and
  // extra practice is drawn with a fixed seed, so every visitor sees the same problems.
  const DEMO = window.PC_DEMO || null;
  let demoSeed = 12345;
  const demoRand = () => ((demoSeed = (demoSeed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const rnd = DEMO ? demoRand : Math.random;
  const today = () => (DEMO ? DEMO.day : Scheduler.dayKey());
  const topicMeta = (id) => meta.topics.find((t) => t.id === id);
  // The student's topics in course order (topics.yaml), whatever order they were added in. Display
  // only: state.topics keeps the order added, which the scheduler uses for new topics.
  const deckInOrder = () => meta.topics.map((t) => t.id).filter((id) => state.topics.includes(id));
  const liveCards = (t) => topicMeta(t).cards.filter((c) => c.count > 0);
  const save = () => (DEMO ? true : Store.save(state));

  // card id → instances, for the topics in the deck
  function cardPool() {
    const out = {};
    state.topics.forEach((t) => (PC.pool[t] || []).forEach((i) => (out[i.card] = out[i.card] || []).push(i)));
    return out;
  }

  function loadDeckData() {
    return PC.loadTopics(state.topics).then(() => {
      byId = {};
      Object.values(PC.pool).flat().forEach((i) => { byId[i.id] = i; });
    });
  }

  // Demo: today's set is the first n problems of the fixed list (n from the settings), keeping
  // answered problems; extra practice continues down the list.
  function demoFill(s) {
    if (!DEMO || !DEMO.sequence) return s;
    const seq = DEMO.sequence.filter((q) => state.topics.includes(q.topic));
    // Reuse the existing item objects (not copies), so marking one done sticks.
    const doneIds = new Map(s.items.concat(...s.extra).map((x) => [x.id, x]));
    const n = s.items.length;
    const want = (k) => seq.slice(0, k).map((q) => doneIds.get(q.id) || { ...q, done: false });
    s.items = want(n);
    let at = n;
    s.extra = s.extra.map((set) => { const part = seq.slice(at, at + set.length); at += set.length;
      return part.map((q) => doneIds.get(q.id) || { ...q, done: false }); });
    return s;
  }
  const session = () => demoFill(Scheduler.todaySession(state, cardPool(), cfg, today(), rnd));
  const todayItems = () => { const s = session(); return s.items.concat(...s.extra); };

  // Problems per day: about one a day per `recommend_per_skills` skills in the deck, at least
  // `recommend_min`, rounded up to an offered option. It's only a label; students choose freely.
  function recommendedDaily(topicIds) {
    const skills = topicIds.reduce((n, id) => n + ((topicMeta(id) || { cards: [] }).cards.filter((c) => c.count > 0).length), 0);
    const want = Math.max(cfg.recommend_min || 3, Math.ceil(skills / (cfg.recommend_per_skills || 7)));
    const offered = cfg.daily_options;
    return offered.find((n) => n >= want) || offered[offered.length - 1];
  }
  function dailyOptions(topicIds, selected) {
    const rec = topicIds.length ? recommendedDaily(topicIds) : null;
    return cfg.daily_options.map((n) => `<option value="${n}" ${n === selected ? "selected" : ""}>${n} problems${n === rec ? " (recommended)" : ""}</option>`).join("");
  }

  // Usage data: ratings as 1–5, and answers as the number (or choice text) the app read, never raw typing.
  const RATING = { stuck: 1, slip: 2, hard: 3, good: 4, easy: 5 };
  function sentAnswer(a, st) {
    if (st.value === undefined || st.value === null) return "";
    const f = Answers.formatOf(a);
    if (f === "choice") return a.choices[st.value];
    if (f === "multi") return [].concat(st.value).map((i) => a.choices[i]).join("; ");
    return st.value;
  }
  // Onboarding questions: asked once each whenever the program has them, collecting or not (answers
  // stay on the device until the program collects; then the student row is sent).
  // The demo shows every question, filled in with the sample student's answers.
  const unanswered = () => !window.Telemetry ? [] : DEMO ? Telemetry.questions
    : Telemetry.questions.filter((q) => !(state.profile && state.profile[q.field]));

  // Topic status rolled up from its cards.
  function topicStatus(t) {
    const cards = liveCards(t);
    if (!cards.length) return { badge: '<span class="badge gray">coming soon</span>', detail: "" };
    const cs = cards.map((c) => state.cards[c.id] || { status: "queued" });
    const started = cs.filter((c) => c.status !== "queued").length;
    const detail = `${started} of ${cards.length} skill${cards.length === 1 ? "" : "s"} started`;
    if (!started) return { badge: '<span class="badge gray">starting soon</span>', detail };
    if (cs.some((c) => c.status === "learning")) return { badge: '<span class="badge">learning</span>', detail };
    const strong = cs.every((c) => c.status === "review" && Scheduler.retrievability(c, today(), cfg) >= 0.9);
    return { badge: strong ? '<span class="badge ok">strong</span>' : '<span class="badge">review</span>', detail };
  }

  // ---------- views ----------
  function render() {
    window.scrollTo(0, 0);
    if (view === "setup") return renderSetup();
    if (view === "session") return renderSession();
    if (view === "progress") return renderProgress();
    if (view === "welcome") return renderWelcome();
    return renderToday();
  }

  // First visit (and the About link): what the app is and how it works.
  function renderWelcome() {
    const first = state.topics.length === 0;
    $app.innerHTML = header(first ? "" : '<button class="linkbtn" id="back">Back</button>') + `
      <div class="card welcome"><h2>Welcome</h2>
        <p>This is an app designed to help with ${esc(P.subject)}. It works by combining a
        spaced repetition scheduler with a daily practice problem bank. You select the number of problems you
        want to practice every day and the topics you want to review. If you're currently in a course, you can
        always add new topics as they're introduced in the course.</p>
        <p>The app will provide your daily problems selected from your list of topics. Problems you get correct
        and rate as easy will appear rarely as a check-in for that skill. Problems you miss or rate as harder
        will appear more often, so you can target your practice on the skills that really need it.</p>
        <p>The purpose of this app isn't to replace homework or other dedicated study, but allow you to slowly
        develop your skills over time with only a few minutes of practice daily, while ensuring your skills stay fresh.</p>
        <p class="muted">${window.Telemetry && Telemetry.collects
          ? "Your schedule and progress are saved in this internet browser on this device. Anonymous practice data (which problems you answer, whether they're right, your ratings, and timing; never your name) is collected to help improve the app."
          : "No data is stored outside of this internet browser on this device."} If you switch to a
        different device or different browser, your personal schedule won't follow.</p>
        ${first ? '<button class="btn" id="next">Pick my topics</button>' : ""}
      </div>`;
    const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
    on("next", () => { view = "setup"; render(); });
    on("back", () => { view = "today"; render(); });
  }

  const header = (right) => `<div class="app-head"><h1>${esc(P.heading)}</h1><div class="row">${right || ""}</div></div>`;
  const demoNotice = () => DEMO ? `<div class="notice">Demo: this is a sample student ${DEMO.week ? `in week ${DEMO.week} of the semester` : "partway through the semester"}.
     Try anything; nothing is saved, and reloading the page starts the demo over.
     <span class="muted small">Demo set ${esc(DEMO.code || "")}</span></div>` : "";
  const storageNotice = () => DEMO ? demoNotice() : Store.isAvailable() ? "" :
    `<div class="notice">This browser isn't letting the page save progress (a private window, or storage is blocked).
     You can still practice, and you can save a progress file from the Progress page before leaving.</div>`;

  function renderSetup() {
    const first = state.topics.length === 0;
    const topicItem = (t) => {
      const live = liveCards(t.id).length;
      const checked = state.topics.includes(t.id) ? "checked" : "";
      return `<li class="${live ? "" : "soon"}"><input type="checkbox" id="t-${t.id}" value="${t.id}" ${checked} ${live ? "" : "disabled"}>
        <label for="t-${t.id}"><span class="tname">${esc(t.name)}</span>${live ? "" : '<span class="badge gray">coming soon</span>'}
        <br><span class="muted small">${esc(t.blurb)}</span></label></li>`;
    };
    const items = meta.collections.map((c) => `<h3 class="collection">${esc(c.name)}</h3>
      <ul class="topic-list">${c.topics.map((id) => topicItem(topicMeta(id))).join("")}</ul>`).join("");
    const opts = dailyOptions(state.topics, state.settings.daily);
    $app.innerHTML = header(first ? '<button class="linkbtn" id="toWelcome">Back</button>' : '<button class="linkbtn" id="cancel">Cancel</button>') + storageNotice() + `
      <div class="card">
        <h2>${first ? "Build your deck" : "Your deck"}</h2>
        <p class="muted">Check the topics you've covered in class. Add more any time, as your course gets to them;
        a new topic shows up in your next set of problems.</p>
        ${items}
        <div class="row"><label for="daily"><strong>Problems per day</strong></label><select id="daily">${opts}</select></div>
        <div class="check-row" title="Do a few extra problems to catch up on missed problems.">
          <input type="checkbox" id="catchUp" ${state.settings.catchUp ? "checked" : ""}>
          <label for="catchUp"><strong>Catch-up mode</strong>
          <span class="muted small">Do a few extra problems to catch up on missed problems.</span></label></div>
        <p class="muted small">A few problems every day works better than many problems once in a while.</p>
        ${unanswered().map((q) => `<div class="row"><label for="q-${esc(q.field)}"><strong>${esc(q.question)}</strong></label>
          <select id="q-${esc(q.field)}" class="onboard" data-field="${esc(q.field)}"><option value="">Choose…</option>${q.options.map((o) => `<option ${(state.profile || {})[q.field] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`).join("")}
        ${DEMO && Telemetry.questions.length ? '<p class="muted small">Demo: a new student answers these once, when building their first deck.</p>' : ""}
        <div class="feedback" id="err"></div>
        <div class="tools"><button class="btn" id="saveDeck">${first ? "Start practicing" : "Save deck"}</button></div>
      </div>`;
    // Keep the "(recommended)" tag in step with the topics checked.
    $app.querySelectorAll(".topic-list input").forEach((box) => (box.onchange = () => {
      const sel = document.getElementById("daily");
      const checked = [...$app.querySelectorAll(".topic-list input:checked")].map((b) => b.value);
      sel.innerHTML = dailyOptions(checked, +sel.value);
    }));
    if (document.getElementById("toWelcome")) document.getElementById("toWelcome").onclick = () => { view = "welcome"; render(); };
    document.getElementById("saveDeck").onclick = () => {
      const checked = [...$app.querySelectorAll(".topic-list input:checked")].map((x) => x.value);
      if (!checked.length) {
        const e = document.getElementById("err");
        e.className = "feedback bad"; e.textContent = "Check at least one topic first.";
        return;
      }
      const asked = [...$app.querySelectorAll("select.onboard")];
      if (asked.some((x) => !x.value)) {
        const e = document.getElementById("err");
        e.className = "feedback bad"; e.textContent = "Answer the questions above first.";
        return;
      }
      state.settings.daily = +document.getElementById("daily").value;
      state.settings.catchUp = document.getElementById("catchUp").checked;
      if (asked.length) {
        state.profile = { created: today(), ...(state.profile || {}) };
        asked.forEach((x) => (state.profile[x.dataset.field] = x.value));
        if (!DEMO) Telemetry.student(state, today());
      }
      Scheduler.setTopics(state, checked, cardsOf);
      save();
      // Resize today's set to the new settings (answered problems stay).
      loadDeckData().then(() => {
        if (state.sessions[today()]) demoFill(Scheduler.resizeToday(state, cardPool(), cfg, today(), rnd));
        save(); view = "today"; render();
      });
    };
    const c = document.getElementById("cancel");
    if (c) c.onclick = () => { view = "today"; render(); };
  }

  function focusCard() {
    const f = Scheduler.focusActive(state, today());
    const live = deckInOrder().filter((t) => liveCards(t).length);
    if (f) {
      const until = state.focus.until;
      const left = Scheduler.daysBetween(today(), until) + 1;
      return `<div class="card"><h2>Focus: ${esc(topicMeta(f).name)}</h2>
        <p class="muted small">Extra problems from this topic every day, for ${left} more day${left === 1 ? "" : "s"}.
        Starts with tomorrow's set if today's has already begun.</p>
        <button class="btn ghost" id="endFocus">End focus</button></div>`;
    }
    if (live.length < 2) return "";
    const opts = live.map((t) => `<option value="${t}">${esc(topicMeta(t).name)}</option>`).join("");
    return `<details class="card quiet"><summary>Optional: focus on one topic for a week</summary>
      <p class="muted small">Exam coming up, or a topic that's giving you trouble? For the next ${cfg.focus_days} days,
      at least ${cfg.focus_guaranteed} problem${cfg.focus_guaranteed === 1 ? "" : "s"} a day come from it, and any spare slots go to it too.</p>
      <div class="row"><select id="focusPick">${opts}</select><button class="btn ghost" id="startFocus">Focus</button></div></details>`;
  }

  // Why today's set is bigger than the daily setting, in plain words.
  function setNote(s) {
    const parts = [];
    if (s.newTopic) {
      const names = (s.newTopics || []).map((t) => topicMeta(t) && topicMeta(t).name).filter(Boolean);
      parts.push(`${s.newTopic} for your new topic${names.length > 1 ? "s" : ""}${names.length ? ` (${esc(names.join(", "))})` : ""}`);
    }
    if (s.catchUp) parts.push(`${s.catchUp} to catch up`);
    return parts.length ? `<div class="muted small">${state.settings.daily} a day, plus ${parts.join(" and ")}</div>` : "";
  }

  function renderToday() {
    const s = session();
    save();   // building today's set may have unlocked cards
    const items = todayItems();
    const done = items.filter((x) => x.done).length;
    const dailyDone = s.items.filter((x) => x.done).length;
    const allDone = items.length > 0 && done === items.length;
    const rows = deckInOrder().map((t) => {
      const st = topicStatus(t);
      return `<tr><td>${esc(topicMeta(t).name)}<br><span class="muted small">${st.detail}</span></td><td>${st.badge}</td></tr>`;
    }).join("");
    let main;
    if (!s.items.length) {
      main = `<p>None of the topics in your deck have problems yet. Add one that does, from <strong>Edit deck</strong>.</p>`;
    } else if (allDone) {
      main = `<div class="today-count">Done for today</div>
        <p class="muted">${done} problem${done === 1 ? "" : "s"} today.</p>
        <div class="tools"><button class="btn ghost" id="extra">Extra practice (${state.settings.daily} more)</button></div>`;
    } else {
      const left = items.length - done;
      main = `<div class="today-count">${dailyDone} of ${s.items.length}</div>
        <div class="muted">done today${s.extra.length ? ` · ${left} extra left` : ""}</div>
        ${setNote(s)}
        <div class="progress"><div style="width:${(100 * done) / items.length}%"></div></div>
        <button class="btn" id="go">${done ? "Continue" : "Start today's problems"}</button>`;
    }
    $app.innerHTML = header(`<button class="linkbtn" id="edit">Edit deck</button><button class="linkbtn" id="prog">Progress</button><button class="linkbtn" id="about">About</button>`)
      + storageNotice() + `<div class="card">${main}</div>
      <div class="card"><h2>Your deck</h2><table class="status-table">${rows}</table>
      <p class="muted small">Each topic has a few kinds of problems ("skills"), introduced a few at a time.
      Skills you're learning come up most days; strong ones come back every week or two.</p></div>` + focusCard();
    document.getElementById("edit").onclick = () => { view = "setup"; render(); };
    document.getElementById("prog").onclick = () => { view = "progress"; render(); };
    if (document.getElementById("about")) document.getElementById("about").onclick = () => { view = "welcome"; render(); };
    const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
    on("go", () => { view = "session"; render(); });
    on("extra", () => { Scheduler.addExtra(state, cardPool(), cfg, today(), rnd); session(); save(); view = "session"; render(); });
    on("startFocus", () => {
      Scheduler.setFocus(state, document.getElementById("focusPick").value, today(), cfg);
      const s2 = state.sessions[today()];
      if (s2 && !s2.items.some((x) => x.done) && !s2.extra.length) delete state.sessions[today()];
      save(); render();
    });
    on("endFocus", () => { Scheduler.setFocus(state, null, today(), cfg); save(); render(); });
  }

  // One problem at a time: answer → check → rate → next.
  function renderSession() {
    const items = todayItems();
    const idx = items.findIndex((x) => !x.done);
    if (idx < 0) { view = "today"; return render(); }
    const item = items[idx];
    const p = byId[item.id];
    if (!p) { item.done = true; item.skipped = true; save(); return renderSession(); }
    const dailyN = session().items.length;
    const label = idx < dailyN ? `Problem ${idx + 1} of ${dailyN}` : `Extra practice ${idx - dailyN + 1}`;
    const shown = Date.now();
    const st = { checked: false, correct: false, viewedBefore: false, answer: null, ms: null };

    $app.innerHTML = header('<button class="linkbtn" id="home">Pause</button>') + `
      <div class="card" id="problem">
        <div class="problem-meta"><span>${label}</span></div>
        ${Render.problemHTML(p)}
        <div class="answer-row" id="answer"></div>
        <div class="feedback" id="fb"></div>
        <div id="rating"></div>
        <div class="tools"><button class="btn ghost" id="toggle">Show worked solution</button></div>
      </div>
      <div class="card" id="solution"></div>`;
    const sol = document.getElementById("solution");
    Render.renderSolution(p, sol);
    // The problem ID sits just after the solution card (shown with it), so the answer stays the card's last line.
    sol.insertAdjacentHTML("afterend", `<p class="pid small sol-id">${esc(p.id)}</p>`);
    if (window.Telemetry && Telemetry.enabled) {
      const done = Telemetry.reported(p.id);
      sol.insertAdjacentHTML("beforeend", `<p class="small report-row">${done ? '<span class="muted">Thanks, reported.</span>'
        : '<button type="button" class="linkbtn small" id="report">Report a problem with this question</button>'}</p>`);
      const rb = document.getElementById("report");
      if (rb) rb.onclick = () => { Telemetry.report(state, today(), p, (meta.bank || {}).version);
                                   rb.outerHTML = '<span class="muted">Thanks, reported.</span>'; };
    }
    const fb = document.getElementById("fb");
    const ans = Answers.mount(document.getElementById("answer"), p.answer, (r) => check(r));
    ans.focus();
    if (ans.input) ans.input.addEventListener("input", () => { if (!st.checked) fb.className = "feedback"; });

    document.getElementById("home").onclick = () => { view = "today"; render(); };
    document.getElementById("toggle").onclick = (e) => {
      const open = sol.classList.toggle("open");
      e.target.textContent = open ? "Hide worked solution" : "Show worked solution";
      if (open && !st.checked && !st.viewedBefore) {
        st.viewedBefore = true;
        finish("stuck");
      }
    };

    function check(r) {
      if (st.checked || st.viewedBefore) return;
      if (r.error) { fb.className = "feedback bad"; fb.textContent = r.error; return; }
      st.checked = true;
      st.answer = Answers.formatOf(p.answer) === "choice" ? p.answer.choices[r.value] : r.raw;
      st.value = r.value;
      st.ms = Date.now() - shown;
      const g = Answers.grade(p.answer, r.value);
      st.correct = g.correct;
      if (g.partial !== undefined) st.partial = Math.round(g.partial * 1000) / 1000;
      disableAnswer();
      fb.className = "feedback " + (st.correct ? "ok" : "bad");
      fb.textContent = st.correct ? `Correct: ${p.answer.display}` : `Not quite. The answer is ${p.answer.display}.`;
      const opts = st.correct
        ? [["hard", "Hard", "Got it, with effort"], ["good", "Good", "Got it"], ["easy", "Easy", "Quick and sure"]]
        : [["slip", "Slip", "I knew how; careless mistake"], ["stuck", "Stuck", "I wasn't sure how to set it up"]];
      document.getElementById("rating").innerHTML = `<div class="rating">
        <p>${st.correct ? "How did that feel?" : "What happened?"}</p>
        <div class="row">${opts.map(([k, l, h]) => `<button class="btn ghost" data-r="${k}">${l}<span class="hint">${h}</span></button>`).join("")}</div></div>`;
      document.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => finish(b.dataset.r)));
    }

    function disableAnswer() {
      ans.disable();
    }

    function finish(rating) {
      Scheduler.record(state, cfg, today(), {
        id: p.id, card: item.card, topic: item.topic, variant: item.variant,
        answer: st.answer, correct: st.correct, viewedBefore: st.viewedBefore, ms: st.ms ?? (Date.now() - shown), rating,
        program: P.id, bank: (meta.bank || {}).version, fp: p.fp, format: Answers.formatOf(p.answer),
        guess: Answers.guess(p.answer), ...(st.partial !== undefined ? { partial: st.partial } : {}),
      });
      item.done = true;
      item.result = st.viewedBefore ? "viewed" : st.correct ? "correct" : "miss";
      if (window.Telemetry) {
        const last = state.log[state.log.length - 1];
        Telemetry.send("attempt", { student: state.sid, problem: p.id, fp: p.fp, card: item.card, date: today(),
          ms: st.ms ?? (Date.now() - shown), correct: st.correct, viewedBefore: st.viewedBefore, rating: RATING[rating],
          answer: sentAnswer(p.answer, st), correct_answer: sentAnswer(p.answer, { value: p.answer.value }),
          counted: last.counted, stability: Math.round((state.cards[item.card].stability || 0) * 100) / 100,
          position: idx + 1, setSize: items.length, model: cfg.memory_model || "stability", bank: (meta.bank || {}).version });
      }
      save();
      disableAnswer();
      const more = todayItems().some((x) => !x.done);
      document.getElementById("rating").innerHTML = `<div class="tools">
        <button class="btn" id="next">${more ? "Next problem" : "Finish"}</button></div>`;
      document.getElementById("next").onclick = () => renderSession();
    }
  }

  function renderProgress() {
    const n = state.log.length;
    if (DEMO) {
      const days = new Set(state.log.map((e) => e.day)).size;
      $app.innerHTML = header('<button class="linkbtn" id="back">Back</button>') + demoNotice() + `
        <div class="card"><h2>Progress</h2>
        <p>This sample student has answered ${n} problems over ${days} days.</p>
        <p class="muted small">In the real app, this page saves and loads progress files and can erase progress.</p>
        <div class="tools"><button class="btn ghost" id="restart">Restart the demo</button></div></div>`;
      document.getElementById("back").onclick = () => { view = "today"; render(); };
      document.getElementById("restart").onclick = () => location.reload();
      return;
    }
    const days = new Set(state.log.map((e) => e.day)).size;
    $app.innerHTML = header('<button class="linkbtn" id="back">Back</button>') + storageNotice() + `
      <div class="card"><h2>Progress</h2>
        <p>${n} problem${n === 1 ? "" : "s"} answered over ${days} day${days === 1 ? "" : "s"}.</p>
        <p class="muted small">Progress is saved in this browser only. To move to another device, or to keep a backup,
        save a progress file and load it on the other device.</p>
        <div class="tools"><button class="btn" id="exp">Save progress file</button></div>
        <div class="row" style="margin-top:14px"><label for="imp"><strong>Load a progress file:</strong></label>
          <input type="file" id="imp" accept="application/json,.json"></div>
        <div class="feedback" id="msg"></div>
      </div>
      <div class="card"><h2>Start over</h2>
        <p class="muted small">Erases your deck and history in this browser. Save a progress file first if you might want it back.</p>
        <button class="btn ghost danger" id="reset">Erase progress</button></div>`;
    const msg = document.getElementById("msg");
    document.getElementById("back").onclick = () => { view = "today"; render(); };
    document.getElementById("exp").onclick = () => Store.exportFile(state);
    document.getElementById("imp").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      Store.importFile(f).then((s) => {
        if (!s.sid) s.sid = state.sid;
        if (!s.profile && state.profile) s.profile = state.profile;
        if (state.tester) s.tester = true;
        state = s;
        if (window.Telemetry) { Telemetry.adopt(state); if (state.profile) Telemetry.student(state, today()); }
        save();
        return loadDeckData().then(() => {
          msg.className = "feedback ok";
          msg.textContent = `Loaded: ${s.topics.length} topics, ${s.log.length} past problems.`;
        });
      }).catch((err) => { msg.className = "feedback bad"; msg.textContent = err.message; });
    };
    document.getElementById("reset").onclick = () => {
      if (!confirm("Erase your deck and all progress in this browser?")) return;
      Store.clear();
      const keep = { sid: state.sid, tester: state.tester, profile: state.profile };   // same student, fresh start
      state = Scheduler.newState(cfg);
      Object.entries(keep).forEach(([k, v]) => { if (v !== undefined) state[k] = v; });
      save();
      view = "welcome"; render();
    };
  }

  // ---------- start ----------
  PC.loadMeta().then(() => {
    meta = PC.meta;
    cfg = meta.scheduler;
    meta.topics.forEach((t) => { cardsOf[t.id] = t.cards.map((c) => c.id); });
    state = DEMO ? JSON.parse(JSON.stringify(DEMO.state)) : (Store.load() || Scheduler.newState(cfg));
    state.program = P.id;      // progress files say which program they belong to
    delete state.settings.share;   // the old "share data" switch, now removed
    if (!DEMO && window.Telemetry) {
      const changed = Telemetry.adopt(state);
      // Send the student row if it changed, or if it has never gone out (e.g. collection was switched on later).
      if (state.profile && (changed || !state.profileSent)) Telemetry.student(state, today());
      if (changed || state.profileSent) save();
    }
    if (state.settings.catchUp === undefined) state.settings.catchUp = cfg.catch_up_default;
    state.topics = state.topics.filter((t) => cardsOf[t]);   // drop topics removed from the content
    if (state.topics.length) Scheduler.setTopics(state, state.topics, cardsOf);   // picks up new cards from content updates
    view = state.topics.length ? "today" : "welcome";
    return loadDeckData();
  }).then(render).catch((e) => {
    $app.innerHTML = `<div class="card"><p class="danger">Something went wrong loading the practice problems.</p>
      <p class="muted small">${esc(e.message)}</p></div>`;
  });
})();
