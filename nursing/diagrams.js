// Diagram kinds, drawn as SVG from block data. Colors come from CSS classes so dark mode works.
//
// dilution: the drug is drawn as a black layer settled on the bottom of each container, the same
// thickness before and after, so it's visible that the amount of drug doesn't change. Only the
// solvent above it grows (dilution) or shrinks (evaporation). Heights are schematic, not to scale.

(function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function val(text, x, y, cls) {
    const unknown = text === "?";
    return `<text x="${x}" y="${y}" text-anchor="middle" class="${cls}${unknown ? " unknown" : ""}">${esc(text)}</text>`;
  }

  // A container sitting on the baseline: solvent fill, optional drug layer at the bottom,
  // label just above, concentration inside, total below.
  function container(x, w, h, base, o) {
    const top = base - h;
    const drugH = o.drug ? 20 : 0;
    const dashed = o.dashed ? ' stroke-dasharray="5 4"' : "";
    let s = `<text x="${x + w / 2}" y="${top - 9}" text-anchor="middle" class="d-label">${esc(o.label)}</text>`;
    s += `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="6" class="d-liquid"/>`;
    if (drugH) {
      s += `<rect x="${x}" y="${base - drugH}" width="${w}" height="${drugH}" class="d-drug"/>`;
      const name = o.drug.length * 6.2 < w - 14 ? o.drug : "drug";
      s += `<text x="${x + w / 2}" y="${base - 6}" text-anchor="middle" class="d-drug-label">${esc(name)}</text>`;
    }
    s += `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="6" class="d-vessel"${dashed}/>`;
    if (o.conc !== undefined) s += val(o.conc, x + w / 2, top + (h - drugH) / 2 + 6, "d-conc");
    s += val(o.total, x + w / 2, base + 22, "d-total");
    return s;
  }

  const DIAGRAMS = {
    // Weighing number line: the amount on the balance, with the sensitivity requirement (±SR)
    // shown as the band where the true amount could be, and the error band (±% of the amount).
    numberline(b) {
      const W = 624, L = 70, R = 554, y = 70;
      const lo = b.min, hi = b.max, X = (v) => L + ((v - lo) / (hi - lo)) * (R - L);
      const t = (x, yy, s, cls, a = "middle") => `<text x="${x}" y="${yy}" text-anchor="${a}" class="${cls}">${esc(s)}</text>`;
      let s = `<line x1="${L - 20}" y1="${y}" x2="${R + 20}" y2="${y}" class="d-xline"/>`;
      if (b.err) {
        s += `<rect x="${X(b.err[0])}" y="${y - 30}" width="${X(b.err[1]) - X(b.err[0])}" height="12" rx="3" class="d-errband"/>`;
        s += t((X(b.err[0]) + X(b.err[1])) / 2, y - 36, b.errLabel, "d-label");
      }
      s += `<rect x="${X(b.sr[0])}" y="${y - 8}" width="${X(b.sr[1]) - X(b.sr[0])}" height="16" rx="3" class="d-srband"/>`;
      for (const [v, lab] of b.ticks) {
        s += `<line x1="${X(v)}" y1="${y - 12}" x2="${X(v)}" y2="${y + 12}" class="d-xline"/>` + t(X(v), y + 30, lab, "d-total");
      }
      s += t((X(b.sr[0]) + X(b.sr[1])) / 2, y + 52, b.srLabel, "d-parts");
      return `<svg viewBox="0 0 ${W} 136" role="img" aria-label="Weighing number line" class="diagram">${s}</svg>`;
    },

    // Alligation X: strengths on the left, target in the middle, parts on the right.
    alligation(b) {
      const L = 150, M = 312, R = 474, T = 34, B = 154, C = 94;
      const t = (x, y, s, cls) => `<text x="${x}" y="${y}" text-anchor="middle" class="${cls}">${esc(s)}</text>`;
      const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="d-xline"/>`;
      return `<svg viewBox="0 0 624 196" role="img" aria-label="Alligation X" class="diagram">
        ${line(L + 34, T + 6, R - 40, B - 6)}${line(L + 34, B - 6, R - 40, T + 6)}
        <rect x="${M - 46}" y="${C - 20}" width="92" height="34" rx="6" class="d-xbox"/>
        ${t(L, T + 6, b.hi, "d-conc")}${t(L, B + 6, b.lo, "d-conc")}${t(M, C + 3, b.target, "d-conc")}
        ${t(R + 10, T + 6, b.hiParts + " parts", "d-parts")}${t(R + 10, B + 6, b.loParts + " parts", "d-parts")}
        ${t(L, 186, "strengths", "d-label")}${t(M, 186, "target", "d-label")}${t(R + 10, 186, "parts", "d-label")}
      </svg>`;
    },

    // One preparation: drug layer at the bottom (with its amount), solvent above, concentration
    // inside, total below.
    single(b) {
      const W = 190, h = 120, base = 150, x = 217;
      let s = container(x, W, h, base, { label: b.label, conc: b.conc, total: b.total, drug: b.drug });
      s += `<text x="${x - 12}" y="${base - 6}" text-anchor="end" class="d-side${b.drugAmt === "?" ? " unknown" : ""}">${esc(b.drug)}: ${esc(b.drugAmt)}</text>`;
      if (b.solventAmt !== null && b.solventAmt !== undefined) {
        s += `<text x="${x + W + 12}" y="${base - 60}" class="d-side${b.solventAmt === "?" ? " unknown" : ""}">${esc(b.solvent)}: ${esc(b.solventAmt)}</text>`;
      }
      return `<svg viewBox="0 0 624 ${base + 40}" role="img" aria-label="Single preparation diagram" class="diagram">${s}</svg>`;
    },

    dilution(b) {
      const evap = b.mode === "evaporate";
      const ratio = b.after.n / b.before.n;
      const hB = 86;
      const hA = evap ? hB * clamp(ratio, 0.62, 0.78) : hB * clamp(ratio, 1.25, 1.42);
      const hM = Math.max(26, Math.abs(hA - hB));   // what was added or removed
      const base = 30 + Math.max(hA, hB);
      const W = 150;
      const xB = 24, xM = 222, xA = 448, wM = 96;
      const opY = evap ? base - 10 : base - 30;
      const parts = [
        container(xB, W, hB, base, { label: b.before.label, conc: b.before.conc, total: b.before.total, drug: b.drug }),
        `<text x="${(xB + W + xM) / 2}" y="${opY}" text-anchor="middle" class="d-op">${evap ? "−" : "+"}</text>`,
        container(xM, wM, hM, base, { label: b.change.label, total: b.change.amount, dashed: evap }),
        `<text x="${(xM + wM + xA) / 2}" y="${opY}" text-anchor="middle" class="d-op">=</text>`,
        container(xA, W, hA, base, { label: b.after.label, conc: b.after.conc, total: b.after.total, drug: b.drug }),
        `<text x="622" y="${base + 44}" text-anchor="end" class="d-note">not to scale</text>`,
      ];
      return `<svg viewBox="0 0 624 ${base + 52}" role="img" aria-label="${evap ? "Evaporation" : "Dilution"} diagram" class="diagram">${parts.join("")}</svg>`;
    },
  };

  window.DIAGRAMS = DIAGRAMS;
})();
