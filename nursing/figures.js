// Figures: pictures attached to a problem, drawn from data so their numbers always match the answer.
// A problem's `figures` is a list; each figure has a `kind` and a `place`:
//   place "problem"   shown under the stem, with the order card (a drug label)
//   place "solution"  shown at the top of the worked solution (anything that would give the answer away)
// Kinds:
//   label    {label: a drug label record}, drawn by labels.js
//   diagram  {diagram: <name in diagrams.js>, ...that diagram's fields}
//   image    {src: "assets/<file>", alt}   (a file in programs/<id>/assets/)
//   chart    {title, x: {label, min, max, log}, y: {label, min, max, log}, series: [{name, points: [[x, y], …], style: "line" | "points"}]}
// Every figure is click-to-zoom and carries alt text. Adding a kind = one entry in KINDS.

(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- chart: a plain line or point chart, linear or log axes ----------
  function niceTicks(lo, hi, log) {
    if (log) {
      const out = [];
      for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
        const v = Math.pow(10, e);
        if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
      }
      return out.length >= 2 ? out : [lo, hi];
    }
    const span = hi - lo, raw = span / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 6) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  const fmt = (v) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US") : String(+v.toPrecision(4)));

  function chart(f) {
    const W = 640, H = 380, L = 70, R = 24, T = f.title ? 44 : 20, B = 58;
    const all = f.series.flatMap((s) => s.points);
    const ax = (a, i) => {
      const vals = all.map((p) => p[i]);
      const lo = a.min ?? Math.min(...vals), hi = a.max ?? Math.max(...vals);
      return { ...a, lo: a.log ? Math.max(lo, 1e-12) : lo, hi: hi === lo ? lo + 1 : hi };
    };
    const xa = ax(f.x || {}, 0), ya = ax(f.y || {}, 1);
    const scale = (a, v, p0, p1) => {
      const t = a.log ? (Math.log10(v) - Math.log10(a.lo)) / (Math.log10(a.hi) - Math.log10(a.lo)) : (v - a.lo) / (a.hi - a.lo);
      return p0 + t * (p1 - p0);
    };
    const X = (v) => scale(xa, v, L, W - R), Y = (v) => scale(ya, v, H - B, T);
    let s = `<svg class="fc-chart" viewBox="0 0 ${W} ${H}" width="${W}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(f.alt || f.title || "Chart")}">`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" class="fc-bg"/>`;
    if (f.title) s += `<text x="${L}" y="26" class="fc-title">${esc(f.title)}</text>`;
    for (const v of niceTicks(ya.lo, ya.hi, ya.log)) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="fc-grid"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="fc-tick">${fmt(v)}</text>`;
    for (const v of niceTicks(xa.lo, xa.hi, xa.log)) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${H - B}" y2="${H - B + 5}" class="fc-axis"/><text x="${X(v)}" y="${H - B + 20}" text-anchor="middle" class="fc-tick">${fmt(v)}</text>`;
    s += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="fc-axis"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" class="fc-axis"/>`;
    if (xa.label) s += `<text x="${(L + W - R) / 2}" y="${H - 14}" text-anchor="middle" class="fc-label">${esc(xa.label)}</text>`;
    if (ya.label) s += `<text x="18" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 18 ${(T + H - B) / 2})" class="fc-label">${esc(ya.label)}</text>`;
    f.series.forEach((ser, k) => {
      const pts = ser.points.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`);
      if (ser.style !== "points") s += `<polyline points="${pts.join(" ")}" class="fc-line fc-s${k}"/>`;
      if (ser.style !== "line") ser.points.forEach(([x, y]) => (s += `<circle cx="${X(x)}" cy="${Y(y)}" r="4" class="fc-dot fc-s${k}"/>`));
    });
    if (f.series.length > 1) f.series.forEach((ser, k) => (s += `<text x="${W - R}" y="${T + 16 + 18 * k}" text-anchor="end" class="fc-legend fc-s${k}">${esc(ser.name || "")}</text>`));
    return s + "</svg>";
  }

  const KINDS = {
    label: (f) => window.Labels.draw(f.label),
    diagram: (f) => {
      const fn = window.DIAGRAMS && window.DIAGRAMS[f.diagram];
      return fn ? fn({ ...f, kind: f.diagram }) : `[unknown diagram: ${esc(f.diagram)}]`;
    },
    image: (f) => `<img src="${esc(f.src)}" alt="${esc(f.alt || "")}">`,
    chart,
  };

  // One figure, wrapped as a button that enlarges it.
  function html(f) {
    const draw = KINDS[f.kind];
    const inner = draw ? draw(f) : `[unknown figure: ${esc(f.kind)}]`;
    const what = f.kind === "label" ? "the drug label" : esc(f.alt || "the figure");
    return `<button type="button" class="figure-wrap figure-${esc(f.kind)}" aria-label="Enlarge ${what}">${inner}<span class="zoom-hint">Click to enlarge</span></button>`;
  }

  const at = (p, place) => (p.figures || []).filter((f) => (f.place || "problem") === place);
  window.Figures = { KINDS, html, at, chart };
})();
