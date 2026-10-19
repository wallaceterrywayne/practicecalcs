// Scheduler. Pure functions over a plain state object, so it runs the same in the browser and in
// Node simulations (tests/). Settings come from content/scheduler.yaml.
//
// Students pick TOPICS; each topic expands to CARDS (one per kind of solution). The scheduler
// tracks memory per card.
//
// Memory, per card:
//   stability S  = days until the chance of a correct answer falls to retention_target (0.9)
//   (the default "stability" model; models are swappable, see "memory models" below)
//   retrievability R = retention_target ^ (days since last seen / S)        (never seen → 0)
//   correct, rated hard/good/easy:  S ← S · (1 + (g − 1) · min(1, Δ/S))   capped at max_stability
//   missed, rated slip/stuck:       S ← S · k
// Only the first attempt per card per day changes S.
//
// Each day's N slots are filled in order:
//   1. focus: if the student set a focus topic, `focus_guaranteed` slots go to its cards
//   2. due cards (R ≤ retention_target, or never seen), most forgotten first
//   3. learning cards not yet due
//   4. spare slots: focus topic first; otherwise mostly weak cards (random, weighted toward low
//      stability), with a `spare_pull_share` of slots pulling the soonest-due card forward
// Due cards that don't fit stay due and lead the next day. Missed days never pile up.
//
// Extra slots, decided when the day's set is built (together at most extra_share × N, rounded up):
//   * catch-up (on by default): one per due card the N slots can't fit
//   * new topic: a newly added topic gets up to `new_topic_extra` slots on its first
//     `new_topic_days` study days, filled from that topic's cards

(function (root) {
  // ---------- dates (local calendar days) ----------
  function dayKey(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function daysBetween(a, b) {
    const [y1, m1, d1] = a.split("-").map(Number);
    const [y2, m2, d2] = b.split("-").map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  }
  function addDays(day, n) {
    const [y, m, d] = day.split("-").map(Number);
    return dayKey(new Date(y, m - 1, d + n));
  }

  // ---------- state ----------
  function newState(cfg) {
    return {
      version: 2,
      created: new Date().toISOString(),
      settings: { daily: cfg.daily_default, maxLearning: cfg.max_learning, catchUp: cfg.catch_up_default },
      newTopicDays: {},    // topic id → study days it has had new-topic extras
      topics: [],          // student topic ids, in the order added
      deck: [],            // card ids, in the order their topics were added
      groupOf: {},         // card id → topic id
      cards: {},           // card id → {status, stability, lastSeen, streak, lastUpdateDay, learningSince, recent}
      focus: null,         // {topic, until} or null
      recentVariants: [],
      sessions: {},        // day → {items, extra: [[...]]}
      log: [],             // every attempt, never edited
    };
  }

  function cardState(state, id) {
    if (!state.cards[id]) {
      state.cards[id] = { status: "queued", stability: 0, lastSeen: null, streak: 0, lastUpdateDay: null,
                          learningSince: null, recent: [] };
    }
    return state.cards[id];
  }

  // ---------- memory models ----------
  // How a card's memory is estimated is a swappable part. The rest of the scheduler only asks a
  // model two things:
  //   recall(card, days, cfg)    the chance of a correct answer `days` after the card was last seen
  //   update(card, attempt, cfg) change the card's memory after the day's first counted attempt;
  //                              attempt = {success, rating (the effective one), elapsed (days)}
  // Contract: a model keeps card.stability = days until recall falls to cfg.retention_target
  // (what "due" means, and what spare slots and the progress page use). It may keep other fields
  // of its own on the card; they're saved with the student's progress.
  // Choose one with `memory_model` in scheduler.yaml (default "stability"); add one with addModel.
  const MODELS = {
    // The original model: exponential forgetting, fixed multipliers, no extra gain past due.
    stability: {
      recall: (cs, days, cfg) => (cs.stability > 0 ? Math.pow(cfg.retention_target, days / cs.stability) : 0),
      update(cs, a, cfg) {
        const S = cs.stability || 1;
        if (a.success) {
          const g = 1 + (cfg.growth[a.rating] - 1) * Math.min(1, a.elapsed / S);
          cs.stability = Math.min(cfg.max_stability, Math.max(cfg.min_stability.success, S * g));
        } else {
          cs.stability = Math.max(cfg.min_stability.miss, S * cfg.shrink[a.rating]);
        }
      },
    },
  };
  function model(cfg) {
    const name = cfg.memory_model || "stability";
    if (!MODELS[name]) throw new Error(`Unknown memory_model "${name}" in scheduler.yaml`);
    return MODELS[name];
  }
  function addModel(name, m) { MODELS[name] = m; }

  function retrievability(cs, today, cfg) {
    if (!cs.lastSeen) return 0;
    return model(cfg).recall(cs, daysBetween(cs.lastSeen, today), cfg);
  }

  // ---------- deck ----------
  // topicIds: the student's checked topics. cardsOf: topic id → [card ids].
  function setTopics(state, topicIds, cardsOf) {
    const keep = state.topics.filter((t) => topicIds.includes(t));
    topicIds.forEach((t) => { if (!keep.includes(t)) keep.push(t); });
    state.topics = keep;
    state.deck = [];
    state.newTopicDays = state.newTopicDays || {};
    topicIds.forEach((t) => { if (!(t in state.newTopicDays)) state.newTopicDays[t] = 0; });
    keep.forEach((t) => (cardsOf[t] || []).forEach((c) => { state.deck.push(c); state.groupOf[c] = t; cardState(state, c); }));
    Object.entries(state.cards).forEach(([id, cs]) => {
      // Removed from the deck: a skill already practiced is paused (its memory keeps decaying from
      // the last time it was seen, so it comes back as due as it really is); one never practiced
      // goes back in the queue. Re-added: it resumes as learning or review, whichever it was.
      if (!state.deck.includes(id)) {
        if (cs.status !== "queued" && cs.status !== "paused") {
          if (cs.lastSeen) { cs.pausedFrom = cs.status; cs.status = "paused"; } else cs.status = "queued";
        }
      } else if (cs.status === "paused") {
        cs.status = cs.pausedFrom || "review";
        delete cs.pausedFrom;
      }
    });
    if (state.focus && !keep.includes(state.focus.topic)) state.focus = null;
  }

  // Promote queued cards to learning. Rules, in order:
  //   * a topic with no started cards gets its first card unlocked at once, cap or not, so a newly
  //     added topic shows up the next session
  //   * otherwise promote until `maxLearning` cards are learning, fairly across topics (a topic's
  //     next card goes ahead of topics that already have more started)
  //   * a card still learning after `learning_block_days` stops counting toward the cap
  function unlock(state, hasContent, cfg, today) {
    const group = (id) => state.groupOf[id] || id;
    const started = (g) => state.deck.filter((id) => group(id) === g && state.cards[id].status !== "queued").length;
    const promote = (id) => { state.cards[id].status = "learning"; state.cards[id].learningSince = today; delete state.cards[id].queuedSince; };
    const queued = () => state.deck.filter((id) => hasContent(id) && state.cards[id].status === "queued");
    // No skill waits more than `queue_max_days` to start, whatever the learning cap.
    for (const id of queued()) {
      const cs = state.cards[id];
      if (!cs.queuedSince) cs.queuedSince = today;
      else if (cfg.queue_max_days && daysBetween(cs.queuedSince, today) >= cfg.queue_max_days) promote(id);
    }

    for (const t of state.topics) {
      if (started(t) === 0) { const first = queued().find((id) => group(id) === t); if (first) promote(first); }
    }
    const counts = (id) => {
      const cs = state.cards[id];
      return cs.status === "learning" &&
        !(cfg.learning_block_days && cs.learningSince && daysBetween(cs.learningSince, today) > cfg.learning_block_days);
    };
    while (state.deck.filter((id) => hasContent(id) && counts(id)).length < state.settings.maxLearning) {
      const q = queued();
      if (!q.length) break;
      q.sort((a, b) => started(group(a)) - started(group(b)) || state.deck.indexOf(a) - state.deck.indexOf(b));
      promote(q[0]);
    }
  }

  function activeCards(state, hasContent) {
    return state.deck.filter((id) => hasContent(id) && ["learning", "review"].includes(state.cards[id].status));
  }

  function focusActive(state, today) {
    return state.focus && state.focus.until >= today ? state.focus.topic : null;
  }

  // ---------- choosing cards ----------
  function weightedPick(items, weightOf, rand) {
    const total = items.reduce((s, x) => s + weightOf(x), 0);
    let r = rand() * total;
    for (const x of items) { r -= weightOf(x); if (r <= 0) return x; }
    return items[items.length - 1];
  }

  function chooseCards(state, active, R, cfg, today, n, rand, boost = { topics: [], k: 0 }, starter = null) {
    // Ties (e.g. several never-seen cards) go to the topic with the fewest cards seen so far,
    // so a newly added topic's first card always makes the next set.
    const seenIn = {};
    active.forEach((id) => { const g = state.groupOf[id]; seenIn[g] = (seenIn[g] || 0) + (state.cards[id].lastSeen ? 1 : 0); });
    const byR = (a, b) => R[a] - R[b] || seenIn[state.groupOf[a]] - seenIn[state.groupOf[b]] ||
      state.deck.indexOf(a) - state.deck.indexOf(b);
    const isDue = (id) => !state.cards[id].lastSeen || R[id] <= cfg.retention_target;
    const focus = focusActive(state, today);
    const chosen = [];   // [{card, why}]
    const free = () => active.filter((id) => !chosen.some((c) => c.card === id));
    // Take up to k cards from ids, re-sorting after each pick so equally urgent cards rotate across
    // topics (fewest already in today's set first).
    const inSet = (id) => chosen.filter((c) => state.groupOf[c.card] === state.groupOf[id]).length;
    const take = (ids, why, k) => {
      let left = ids.slice();
      while (k-- > 0 && left.length) {
        left.sort((a, b) => R[a] - R[b] || inSet(a) - inSet(b) || byR(a, b));
        chosen.push({ card: left.shift(), why });
      }
    };

    if (focus) take(free().filter((id) => state.groupOf[id] === focus).sort(byR), "focus", Math.min(cfg.focus_guaranteed, n));
    // A newly added topic quietly gets `new_topic_reserve` of the regular slots on its first
    // study days (no extra problems), so it starts up even on days full of due reviews.
    // The most recently added topic gets the slot first (topics are kept in the order added).
    if (boost.reserve) {
      const recent = boost.topics.slice().sort((a, b) => state.topics.indexOf(b) - state.topics.indexOf(a));
      for (const t of recent) {
        if (chosen.filter((c) => c.why === "new-topic").length >= boost.reserve || chosen.length >= n) break;
        take(free().filter((id) => state.groupOf[id] === t).sort(byR), "new-topic", 1);
      }
    }
    take(free().filter(isDue).sort(byR), "due", n - chosen.length);
    take(free().filter((id) => state.cards[id].status === "learning").sort(byR), "learning", n - chosen.length);
    take(free().filter((id) => boost.topics.includes(state.groupOf[id])).sort(byR), "new-topic",
         Math.min(boost.k, n - chosen.length));

    // Spare slots start a waiting skill first (fairly across topics), so a big deck isn't left
    // with skills that never begin. Then: focus, pull-forward, weak cards.
    if (chosen.length < n && starter) {
      const id = starter(chosen.map((c) => c.card));
      if (id) chosen.push({ card: id, why: "new-skill" });
    }
    while (chosen.length < n && free().length) {
      const pool = free();
      const inFocus = focus ? pool.filter((id) => state.groupOf[id] === focus).sort(byR) : [];
      if (inFocus.length) { chosen.push({ card: inFocus[0], why: "focus" }); continue; }
      if (rand() < cfg.spare_pull_share) { chosen.push({ card: pool.sort(byR)[0], why: "ahead" }); continue; }
      const w = (id) => cfg.fragility_weight / (1 + state.cards[id].stability) + cfg.floor_weight;
      chosen.push({ card: weightedPick(pool, w, rand), why: "weak" });
    }
    // Fewer cards than slots: repeat, weakest first (only the first attempt per day counts).
    const weakest = active.slice().sort((a, b) => state.cards[a].stability - state.cards[b].stability);
    for (let k = 0; chosen.length < n && weakest.length; k++) chosen.push({ card: weakest[k % weakest.length], why: "repeat" });
    return chosen;
  }

  // Pick a problem for a card. Preference: never seen and a variant not seen recently; then never
  // seen; then a variant not seen recently; then the problem seen longest ago. So exact repeats only
  // happen once a card's whole pool has been used.
  function pickInstance(state, instances, avoidIds, rand) {
    const lastSeen = {};
    state.log.forEach((e, i) => { lastSeen[e.id] = i; });
    const avail = instances.filter((i) => !avoidIds.includes(i.id));
    const recent = new Set(state.recentVariants);
    const fresh = (xs) => xs.filter((i) => !recent.has(i.variant));
    const unseen = avail.filter((i) => !(i.id in lastSeen));
    const pick = (xs) => xs[Math.floor(rand() * xs.length)];
    if (fresh(unseen).length) return pick(fresh(unseen));
    if (unseen.length) return pick(unseen);
    const pool = avail.length ? avail : instances;
    return pool.slice().sort((a, b) => (lastSeen[a.id] ?? -1) - (lastSeen[b.id] ?? -1))[0];
  }

  // Shuffle, keep the same topic out of adjacent slots where possible, and don't open with the
  // weakest card.
  function order(items, R, rand) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    for (let i = 1; i < a.length; i++) {
      if (a[i].topic === a[i - 1].topic) {
        const j = a.findIndex((x, idx) => idx > i && x.topic !== a[i - 1].topic);
        if (j > 0) [a[i], a[j]] = [a[j], a[i]];
      }
    }
    if (a.length > 1) {
      const weakest = Math.min(...a.map((x) => R[x.card]));
      if (R[a[0].card] === weakest) {
        const j = a.findIndex((x) => R[x.card] > weakest);
        if (j > 0) a.push(...a.splice(0, j));
      }
    }
    return a;
  }

  // pool: card id → instances.
  // How many slots to add to today's set: catch-up and new-topic extras, capped together.
  function extraSlots(state, pool, cfg, today) {
    const hasContent = (id) => (pool[id] || []).length > 0;
    const n = state.settings.daily;
    const active = activeCards(state, hasContent);
    // Extras never repeat a card within the day, so they're limited to cards beyond the daily set.
    const cap = Math.min(Math.ceil(cfg.extra_share * n), Math.max(0, active.length - n));
    const due = active.filter((id) => state.cards[id].lastSeen &&
      retrievability(state.cards[id], today, cfg) <= cfg.retention_target).length;
    const catchUp = state.settings.catchUp ? Math.max(0, due - n) : 0;
    const days = state.newTopicDays || {};
    const topics = state.topics.filter((t) => (days[t] || 0) < cfg.new_topic_days &&
      state.deck.some((id) => state.groupOf[id] === t && hasContent(id)));
    const newTopic = topics.length ? (cfg.new_topic_extra || 0) : 0;
    return { catchUp: Math.min(cap, catchUp), newTopic: Math.min(cap - Math.min(cap, catchUp), newTopic), topics };
  }

  function buildSession(state, pool, cfg, today, n, rand = Math.random, alsoAvoid = [], boost, ordered = false) {
    const hasContent = (id) => (pool[id] || []).length > 0;
    unlock(state, hasContent, cfg, today);
    const active = activeCards(state, hasContent);
    if (!active.length) return [];
    const R = Object.fromEntries(active.map((id) => [id, retrievability(state.cards[id], today, cfg)]));
    // Starts one queued skill (the topic with the fewest started first) to fill a spare slot.
    const starter = () => {
      const group = (id) => state.groupOf[id];
      const started = (g) => state.deck.filter((id) => group(id) === g && state.cards[id].status !== "queued").length;
      const q = state.deck.filter((id) => hasContent(id) && state.cards[id].status === "queued")
        .sort((a, b) => started(group(a)) - started(group(b)) || state.deck.indexOf(a) - state.deck.indexOf(b));
      if (!q.length) return null;
      state.cards[q[0]].status = "learning";
      state.cards[q[0]].learningSince = today;
      R[q[0]] = 0;
      return q[0];
    };
    const used = alsoAvoid.slice();
    const items = chooseCards(state, active, R, cfg, today, n, rand, boost, starter).map(({ card, why }) => {
      const inst = pickInstance(state, pool[card], used, rand);
      used.push(inst.id);
      return { id: inst.id, card, topic: state.groupOf[card], variant: inst.variant, why, done: false };
    });
    return ordered ? items : order(items, R, rand);   // ordered: priority order, for the demo's fixed list
  }

  function todaySession(state, pool, cfg, today, rand) {
    if (!state.sessions[today]) {
      unlock(state, (id) => (pool[id] || []).length > 0, cfg, today);
      const x = extraSlots(state, pool, cfg, today);
      const n = state.settings.daily + x.catchUp + x.newTopic;
      const items = buildSession(state, pool, cfg, today, n, rand, [], { topics: x.topics, k: x.newTopic, reserve: x.topics.length ? (cfg.new_topic_reserve || 0) : 0 });
      if (items.length) x.topics.forEach((t) => { state.newTopicDays[t] = (state.newTopicDays[t] || 0) + 1; });
      state.sessions[today] = { items, extra: [], catchUp: x.catchUp, newTopic: x.newTopic, newTopics: x.topics };
    }
    return state.sessions[today];
  }

  // Settings changed partway through a day (problems per day, catch-up, deck): resize today's set.
  // Answered problems stay; unanswered ones are rebuilt to fit the new settings.
  function resizeToday(state, pool, cfg, today, rand) {
    const s = state.sessions[today];
    if (!s) return todaySession(state, pool, cfg, today, rand);
    const done = s.items.filter((x) => x.done);
    unlock(state, (id) => (pool[id] || []).length > 0, cfg, today);
    // New-topic extras were decided this morning; keep that decision, but recompute catch-up.
    const days = state.newTopicDays;
    const saved = {};
    (s.newTopics || []).forEach((t) => { saved[t] = days[t]; days[t] = Math.max(0, (days[t] || 1) - 1); });
    const x = extraSlots(state, pool, cfg, today);
    Object.assign(days, saved);
    const n = state.settings.daily + x.catchUp + x.newTopic;
    const left = Math.max(0, n - done.length);
    const doneCards = new Set(done.map((d) => d.card));
    const used = s.items.concat(...s.extra).map((d) => d.id);
    const fresh = buildSession(state, pool, cfg, today, left + doneCards.size, rand, used, { topics: x.topics, k: x.newTopic, reserve: x.topics.length ? (cfg.new_topic_reserve || 0) : 0 })
      .filter((it) => !doneCards.has(it.card)).slice(0, left);
    s.items = done.concat(fresh);
    s.catchUp = x.catchUp;
    s.newTopic = x.newTopic;
    return s;
  }

  function addExtra(state, pool, cfg, today, rand) {
    const s = todaySession(state, pool, cfg, today, rand);
    const seen = s.items.concat(...s.extra).map((x) => x.id);
    const set = buildSession(state, pool, cfg, today, state.settings.daily, rand, seen);
    s.extra.push(set);
    return set;
  }

  function setFocus(state, topic, today, cfg) {
    state.focus = topic ? { topic, until: addDays(today, cfg.focus_days - 1) } : null;
  }

  // ---------- recording an attempt ----------
  // outcome: {id, card, topic, variant, answer, correct, viewedBefore, ms, rating,
  //           and optionally program, bank, fp, format, guess, partial}
  // rating: correct → hard | good | easy; miss → slip | stuck (viewedBefore forces stuck)
  function record(state, cfg, today, outcome) {
    const cs = cardState(state, outcome.card);
    const success = outcome.correct && !outcome.viewedBefore;
    let effective = outcome.rating;
    if (!success) {
      if (outcome.viewedBefore) effective = "stuck";
      const slips = cs.recent.slice(-cfg.slip_trust_window).filter((r) => r === "slip").length;
      if (effective === "slip" && slips > cfg.slip_trust_max) effective = "stuck";
    }
    const entry = {
      t: new Date().toISOString(), day: today, id: outcome.id, card: outcome.card, topic: outcome.topic,
      answer: outcome.answer, correct: !!outcome.correct, viewedBefore: !!outcome.viewedBefore,
      ms: outcome.ms, rating: outcome.rating, effective, counted: false, model: cfg.memory_model || "stability",
    };
    // Also recorded when the app supplies them: which program and published bank, the problem's
    // fingerprint (which version the student saw), its answer format, the chance of a right guess,
    // and partial credit (checklists).
    for (const k of ["program", "bank", "fp", "format", "guess", "partial"]) if (outcome[k] !== undefined) entry[k] = outcome[k];
    if (cs.lastUpdateDay !== today) {
      entry.counted = true;
      const S = cs.stability || 1;
      const elapsed = cs.lastSeen ? Math.max(1, daysBetween(cs.lastSeen, today)) : S;
      model(cfg).update(cs, { success, rating: effective, elapsed }, cfg);
      if (success) {
        cs.streak += 1;
        if (cs.status === "learning" && cs.streak >= cfg.graduate_streak) cs.status = "review";
      } else {
        cs.streak = 0;
      }
      cs.lastUpdateDay = today;
      cs.lastSeen = today;
    }
    cs.recent = cs.recent.concat(success ? "ok" : effective).slice(-10);
    state.recentVariants = state.recentVariants.concat(outcome.variant).slice(-cfg.recent_variants);
    state.log.push(entry);
    return entry;
  }

  const api = { dayKey, daysBetween, addDays, newState, setTopics, unlock, retrievability, addModel, MODELS, buildSession,
                todaySession, resizeToday, addExtra, extraSlots, setFocus, record, cardState, focusActive };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof window !== "undefined" ? window : globalThis);
