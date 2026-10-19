// Optional usage data. Off unless PC_CONFIG.telemetry.endpoint is set AND the student has agreed
// (Edit deck → "Share anonymous practice data"). Students are identified only by a random ID made
// on their device; no names or emails. Only the fields listed in the program's program.yaml
// (telemetry.fields) are sent; the typed answer is not on that list unless it's added on purpose.
// Events wait in an outbox and are sent in small batches; if sending fails they stay for next time.
(function () {
  const cfg = (window.PC_CONFIG && window.PC_CONFIG.telemetry) || {};
  const enabled = !!cfg.endpoint && !window.PC_DEMO;
  const OUT = window.PROGRAM.telemetry_prefix + ".outbox", UID = window.PROGRAM.telemetry_prefix + ".uid";
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  let uid = get(UID, null);
  if (enabled && !uid) { uid = "s-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); put(UID, uid); }
  let consent = () => false;

  function flush() {
    if (!enabled || !consent()) return;
    const box = get(OUT, []);
    if (!box.length) return;
    const batch = box.slice(0, 50);
    fetch(cfg.endpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
                          body: JSON.stringify(batch), keepalive: true })
      .then(() => { put(OUT, get(OUT, []).slice(batch.length)); if (box.length > batch.length) flush(); })
      .catch(() => { /* offline: try again later */ });
  }

  function send(type, data) {
    if (!enabled || !consent()) return;
    const box = get(OUT, []);
    // Only the fields listed in program.yaml (telemetry.fields) are sent.
    const allowed = Array.isArray(cfg.fields) ? Object.fromEntries(Object.entries(data).filter(([k]) => cfg.fields.includes(k))) : data;
    box.push({ t: new Date().toISOString(), uid, study: cfg.study || "", type, program: window.PROGRAM.id, ...allowed });
    put(OUT, box.slice(-2000));
    flush();
  }

  window.Telemetry = {
    enabled,
    setConsent(fn) { consent = fn; flush(); },
    send,
    flush,
    uid: () => uid,
  };
  window.addEventListener("online", flush);
})();
