// Anonymous usage data. On only when the program's program.yaml sets telemetry.endpoint (a Google
// Apps Script web app; see docs/HOSTING.md). Never on in the demo. There is no switch for students.
//
// Three kinds of record, one tab each in the Google Sheet (the script is built per program: programs/<id>/build/collect.gs):
//   attempt   one answered problem
//   student   one row per student (re-sent when it changes; the newest row wins)
//   report    a student tapped "Report a problem" under a worked solution
// Exactly the fields in telemetry.fields.<kind> are sent; anything else is dropped here.
//
// Students are identified only by a random ID (state.sid) kept in their saved progress, so it
// follows their progress file to other devices. It is never shown anywhere in the app.
// A tester ID: opening the app once with ?tester in the address marks this student as a tester
// for good (saved with the ID and in a separate browser key, so later visits by the normal link,
// or erasing progress, don't undo it).
// Records wait in an outbox and go in small batches; if sending fails they wait for next time.
(function () {
  const cfg = (window.PC_CONFIG && window.PC_CONFIG.telemetry) || {};
  // Checked at use, not at load: the demo page sets PC_DEMO in a script that loads after this one.
  const on = () => !!cfg.endpoint && !window.PC_DEMO;
  const PREFIX = window.PROGRAM.telemetry_prefix;
  const OUT = PREFIX + ".outbox", TESTER = PREFIX + ".t", REPORTED = PREFIX + ".reported";
  // Onboarding questions (program.yaml telemetry.questions): [{field, question, options}], asked once each.
  const questions = (Array.isArray(cfg.questions) ? cfg.questions : []).filter((q) => q.field && Array.isArray(q.options));
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };

  // The tester link: remember it, then tidy the address so it isn't bookmarked or shared by accident.
  try {
    const url = new URL(location.href);
    if (url.searchParams.has("tester")) {
      put(TESTER, true);
      url.searchParams.delete("tester");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  } catch (e) { /* old browser: ignore */ }

  const newId = () => {
    const a = new Uint8Array(8);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.random() * 256));
    return [...a].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  };

  // Gives the saved progress its hidden ID and tester mark (call on every load and import).
  // Returns true if the student row needs (re)sending.
  function adopt(state) {
    let changed = false;
    if (!state.sid) { state.sid = newId(); changed = true; }
    if (get(TESTER, false) && !state.tester) { state.tester = true; changed = true; }
    if (state.tester) put(TESTER, true);     // a tester file loaded on a new device keeps it a tester device
    return changed;
  }

  function flush() {
    if (!on()) return;
    const box = get(OUT, []);
    if (!box.length) return;
    const batch = box.slice(0, 50);
    fetch(cfg.endpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
                          body: JSON.stringify(batch), keepalive: true })
      .then(() => { put(OUT, get(OUT, []).slice(batch.length)); if (box.length > batch.length) flush(); })
      .catch(() => { /* offline: try again later */ });
  }

  function send(kind, data) {
    if (!on() || !data.student) return;   // no record without a student ID
    const allowed = (cfg.fields || {})[kind];
    if (!Array.isArray(allowed)) return;
    const rec = { kind, irb: cfg.irb || "", consent: cfg.consent || "NA", ...data };
    const row = { kind };
    allowed.forEach((k) => { if (rec[k] !== undefined) row[k] = rec[k]; });
    const box = get(OUT, []);
    box.push(row);
    put(OUT, box.slice(-5000));
    flush();
  }

  // The student row. `state.profile` holds the onboarding answers, keyed by field name.
  function student(state, today) {
    const pr = state.profile || {};
    const answers = Object.fromEntries(questions.map((q) => [q.field, pr[q.field] ?? (q.field === "year_at_start" ? pr.year : "") ?? ""]));
    send("student", { student: state.sid, app: window.PROGRAM.id, created: pr.created || today,
                      ...answers, tester: !!state.tester, updated: today });
  }

  // "Report a problem": once per problem per browser.
  const reported = (id) => get(REPORTED, []).includes(id);
  function report(state, today, p, bank) {
    send("report", { student: state.sid, date: today, problem: p.id, fp: p.fp, bank });
    put(REPORTED, get(REPORTED, []).concat(p.id).slice(-2000));
  }

  window.Telemetry = {
    get enabled() { return on(); },
    collects: !!cfg.endpoint,          // this program collects (even on its demo page, which never sends)
    questions,
    adopt, send, student, report, reported, flush,
  };
  window.addEventListener("online", flush);
})();
