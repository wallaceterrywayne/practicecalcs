// Drug label renderer. A problem's `label` field is a record built by the generator
// (generator/labels.py); this draws it as an SVG that suggests a real label.
// Manufacturer names, NDC numbers, lot codes and barcodes are deliberate placeholders.
//   Labels.draw(spec) → SVG string. spec = {kind, layout, ...fields for that kind}

(function () {
  const LF = "'Archivo Narrow','Arial Narrow','Helvetica Neue',Arial,sans-serif";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  function T(x, y, s, o = {}) {
    return `<text x="${x}" y="${y}" font-family="${LF}" font-size="${o.size || 11}" font-weight="${o.w || 400}" fill="${o.fill || "#111"}" text-anchor="${o.anchor || "start"}"${o.ls ? ` letter-spacing="${o.ls}"` : ""}>${esc(s)}</text>`;
  }
  const tw = (s, size, w = 400) => String(s).length * size * (w >= 600 ? 0.6 : 0.5);
  function wrapW(text, width, size) {
    const max = Math.max(8, Math.floor(width / (size * 0.47)));
    const out = []; let line = "";
    for (const w of String(text).split(" ")) {
      if ((line + " " + w).trim().length > max) { out.push(line.trim()); line = w; } else line += " " + w;
    }
    if (line.trim()) out.push(line.trim());
    return out;
  }
  function flow(x, y, width, items, size = 9.5) {
    let svg = "";
    for (const it of items) {
      const s = it.s || size, lh = s * 1.28;
      for (const l of wrapW(it.t, it.b ? width * 0.85 : width, s)) { svg += T(x, y, l, { size: s, w: it.b ? 700 : 400 }); y += lh; }
      y += lh * 0.55;
    }
    return { svg, y };
  }
  function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function bars(x, y, w, h, seed) {
    let r = hash(seed), o = "", cx = x;
    while (cx < x + w - 3) {
      r = (Math.imul(r, 1103515245) + 12345) >>> 0;
      const bw = 1 + ((r >>> 8) % 3);
      o += `<rect x="${cx.toFixed(1)}" y="${y}" width="${bw}" height="${h}" fill="#111"/>`;
      cx += bw + 1 + ((r >>> 12) % 2);
    }
    return o;
  }
  const fmtN = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
  const frame = (W, H, body, alt) =>
    `<svg class="druglabel" viewBox="0 0 ${W} ${H}" width="${W}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(alt)}"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="5" fill="#fff" stroke="#bdbdb8"/>${body}</svg>`;
  function sbox(x, y, m, size, fill) {
    const w = Math.max(110, tw(m.strength, size, 700) + 22);
    return { svg: `<rect x="${x}" y="${y}" width="${w}" height="${size * 1.45}" fill="${fill}"/>` + T(x + 11, y + size * 1.1, m.strength, { size, w: 700, fill: "#fff" }), w };
  }

  const MFR = {
    xyz: { name: "XYZ Pharmaceuticals", city: "Anytown, USA 00000" },
    abc: { name: "ABC Laboratories, Inc.", city: "Anytown, USA 00000" },
    sample: { name: "Sample Drug Co.", city: "Anytown, USA 00000" },
  };
  const DISCLAIMER = "SAMPLE TEXT FOR PRACTICE PROBLEMS ONLY. Not prescribing information; do not rely on it outside these exercises.";
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  // ---------- label content (what the label says), shared by every layout ----------
  const MODELS = {
    tablet(d) {
      const piece = d.piece || "tablet";
      return {
        strength: `${fmtN(d.amt)} ${d.unit}`, sub: "", qty: `${d.count} ${cap(piece)}s`, qtySub: "", route: "", callout: "",
        side: [{ t: `Each ${piece} contains ${fmtN(d.amt)} ${d.unit} ${d.generic}.${d.scored ? " Tablets are scored." : ""}` },
          { t: "Usual Dosage: See package insert for full prescribing information." },
          { t: "Dispense in a tight, light-resistant container as defined in the USP." },
          { t: "Store at 20° to 25°C (68° to 77°F). Keep out of reach of children." }],
      };
    },
    liquid(d) {
      const per = d.per === 1 ? "mL" : `${d.per} mL`, u = d.unit || "mg";
      return {
        strength: `${fmtN(d.amt)} ${u}/${per}`, sub: "", qty: `${fmtN(d.total)} mL`, qtySub: `(${Math.round((d.total / 29.57) * 10) / 10} fl oz)`,
        route: "For oral use only.", callout: d.shake ? "SHAKE WELL BEFORE USE" : "",
        side: [{ t: `Each ${per} contains ${fmtN(d.amt)} ${u} ${d.generic}.` }, ...(d.shake ? [{ t: "SHAKE WELL BEFORE USE.", b: 1 }] : []),
          { t: "Usual Dosage: See package insert. Dispense in a tight, light-resistant container." },
          { t: "Store at 20° to 25°C (68° to 77°F). Protect from freezing." }],
      };
    },
    vial(d) {
      const c = d.amt / d.vol, single = d.dose.startsWith("Single");
      return {
        strength: d.vol === 1 ? `${fmtN(d.amt)} ${d.unit}/mL` : `${fmtN(d.amt)} ${d.unit}/${d.vol} mL`, sub: d.vol > 1 ? `(${fmtN(c)} ${d.unit}/mL)` : "",
        qty: `${d.vol} mL`, qtySub: "", route: `${d.route}  |  ${d.dose}`, callout: "",
        side: [{ t: `Each mL contains ${fmtN(c)} ${d.unit} ${d.generic}${d.salt ? " (as the " + d.salt + ")" : ""}.` },
          { t: single ? "Discard unused portion." : "Discard 28 days after first use.", b: 1 },
          { t: "Usual Dosage: See package insert." }, { t: "Store at 20° to 25°C (68° to 77°F). Protect from light." }],
      };
    },
    recon(d) {
      return {
        strength: `${fmtN(d.amt)} ${d.unit}`, sub: "per vial", qty: "", qtySub: "", route: d.route || "For IM or IV Use  |  Single-Dose Vial",
        callout: "Reconstitute before use. See directions.",
        side: [{ t: `Each vial contains ${d.generic} equivalent to ${fmtN(d.amt)} ${d.unit}.` }, { t: "RECONSTITUTION:", b: 1 },
          ...d.rows.map((r) => ({ t: `${r[0] ? r[0] + ": " : ""}Add ${r[1]} ${r[2]}. Provides ${r[3]}.`, s: 9 })),
          { t: d.keep, b: 1, s: 9 }, { t: "Store dry powder at 20° to 25°C (68° to 77°F).", s: 9 }],
      };
    },
  };

  // ---------- layouts for flat labels ----------
  const LAYOUTS = {
    panel(d, m) {
      const W = 640, side = flow(14, 36, 136, m.side), H = Math.max(280, side.y + 12);
      const nm = wrapW(d.generic, 330, 28), o = (nm.length - 1) * 28;
      const sb = sbox(172, 110 + o, m, 30, d.color);
      const subBelow = m.sub.startsWith("(");
      return frame(W, H,
        `<rect x="1" y="1" width="${W - 2}" height="10" rx="5" fill="${d.color}"/><line x1="158" y1="18" x2="158" y2="${H - 14}" stroke="#d6d6d0"/><line x1="${W - 92}" y1="18" x2="${W - 92}" y2="${H - 14}" stroke="#d6d6d0"/>` +
        side.svg + T(172, 36, "NDC " + d.ndc, { size: 12, w: 600 }) + T(536, 36, "Rx only", { size: 13, w: 700, anchor: "end" }) +
        nm.map((l, i) => T(172, 74 + i * 28, l, { size: 27, w: 700 })).join("") + T(172, 96 + o, d.form, { size: 15, fill: "#333" }) +
        sb.svg + (m.sub ? (subBelow ? T(172, 166 + o, m.sub, { size: 15, w: 700 }) : T(sb.w + 182, 138 + o, m.sub, { size: 15, w: 700 })) : "") +
        (m.qty ? T(536, 138 + o, m.qty, { size: 17, w: 700, anchor: "end" }) + (m.qtySub ? T(536, 152 + o, m.qtySub, { size: 10, anchor: "end", fill: "#444" }) : "") : "") +
        (m.route ? T(172, (subBelow ? 190 : 184) + o, m.route, { size: 12, w: 600 }) : "") +
        (m.callout ? `<rect x="172" y="${196 + o}" width="364" height="24" fill="none" stroke="${d.color}" stroke-width="1.5"/>` + T(354, 212 + o, m.callout, { size: 11.5, w: 700, anchor: "middle", fill: d.color }) : "") +
        T(172, H - 30, "Manufactured by: " + d.mfr, { size: 9, fill: "#333" }) + T(172, H - 19, d.city, { size: 9, fill: "#333" }) +
        `<g transform="translate(${W - 54},${H - 30}) rotate(-90)">${bars(0, 0, 150, 34, d.seed)}${T(75, 46, "SAMPLE · NOT SCANNABLE", { size: 8, anchor: "middle", ls: 1 })}</g>` +
        T(W - 82, 40, "Lot:", { size: 9, fill: "#444" }) + T(W - 82, 52, d.lot, { size: 10, w: 600 }) + T(W - 82, 72, "Exp:", { size: 9, fill: "#444" }) + T(W - 82, 84, d.exp, { size: 10, w: 600 }), d.alt);
    },
    portrait(d, m) {
      const W = 330, x = 18, iw = W - 36;
      let y, b = `<rect x="1" y="1" width="${W - 2}" height="40" rx="5" fill="${d.color}"/><rect x="1" y="20" width="${W - 2}" height="21" fill="${d.color}"/>` +
        T(x, 27, "NDC " + d.ndc, { size: 12, w: 600, fill: "#fff" }) + T(W - 18, 27, "Rx only", { size: 13, w: 700, fill: "#fff", anchor: "end" });
      y = 72; for (const l of wrapW(d.generic, iw, 26)) { b += T(x, y, l, { size: 26, w: 700 }); y += 26; }
      b += T(x, y - 2, d.form, { size: 14, fill: "#333" }); y += 14;
      const sz = tw(m.strength, 34, 700) > iw - 10 ? 28 : 34;
      b += `<line x1="${x}" y1="${y}" x2="${W - 18}" y2="${y}" stroke="#111" stroke-width="1.5"/>` + T(W / 2, y + sz * 1.15, m.strength, { size: sz, w: 700, anchor: "middle", fill: d.color }) + `<line x1="${x}" y1="${y + sz * 1.5}" x2="${W - 18}" y2="${y + sz * 1.5}" stroke="#111" stroke-width="1.5"/>`;
      y += sz * 1.5 + 20;
      if (m.sub) { b += T(W / 2, y, m.sub, { size: 15, w: 700, anchor: "middle" }); y += 20; }
      if (m.qty) { b += T(W / 2, y, m.qty + (m.qtySub ? "  " + m.qtySub : ""), { size: 14, w: 600, anchor: "middle" }); y += 20; }
      if (m.route) { b += T(W / 2, y, m.route, { size: 11.5, w: 600, anchor: "middle" }); y += 18; }
      if (m.callout) { b += `<rect x="${x}" y="${y - 2}" width="${iw}" height="22" fill="none" stroke="${d.color}" stroke-width="1.5"/>` + T(W / 2, y + 13, m.callout, { size: 11, w: 700, anchor: "middle", fill: d.color }); y += 30; }
      b += `<line x1="${x}" y1="${y}" x2="${W - 18}" y2="${y}" stroke="#d6d6d0"/>`;
      const f = flow(x, y + 16, iw, m.side, 9); b += f.svg; y = f.y + 4;
      b += bars(x, y, 130, 30, d.seed) + T(x + 65, y + 42, "SAMPLE · NOT SCANNABLE", { size: 8, anchor: "middle", ls: 1 }) +
        T(W - 18, y + 10, "Lot " + d.lot, { size: 9.5, w: 600, anchor: "end" }) + T(W - 18, y + 23, "Exp " + d.exp, { size: 9.5, w: 600, anchor: "end" });
      y += 60; b += T(x, y, d.mfr + ", " + d.city, { size: 8.5, fill: "#333" });
      return frame(W, y + 14, b, d.alt);
    },
    band(d, m) {
      const W = 600, nm = wrapW(d.generic, W - 48, 30), hb = 36 + nm.length * 32 + 22;
      let b = `<path d="M1 6 Q1 1 6 1 L${W - 6} 1 Q${W - 1} 1 ${W - 1} 6 L${W - 1} ${hb} L1 ${hb} Z" fill="${d.color}"/>` +
        nm.map((l, i) => T(24, 50 + i * 32, l, { size: 30, w: 700, fill: "#fff" })).join("") + T(24, 46 + nm.length * 32, d.form, { size: 15, fill: "#fff" }) +
        T(W - 24, 26, "Rx only", { size: 13, w: 700, fill: "#fff", anchor: "end" });
      let y = hb + 50; const sz = tw(m.strength, 40, 700) > 290 ? 30 : 40;
      b += T(24, y, m.strength, { size: sz, w: 700 }) + `<rect x="24" y="${y + 10}" width="${Math.min(300, tw(m.strength, sz, 700))}" height="4" fill="${d.color}"/>`;
      y += 40;
      if (m.sub) { b += T(24, y, m.sub, { size: 16, w: 700 }); y += 24; }
      if (m.qty) { b += T(24, y, m.qty + (m.qtySub ? "  " + m.qtySub : ""), { size: 15, w: 600 }); y += 22; }
      if (m.route) { b += T(24, y, m.route, { size: 12, w: 600 }); y += 20; }
      if (m.callout) { b += T(24, y + 4, "▲ " + m.callout, { size: 12, w: 700, fill: d.color }); y += 24; }
      const f = flow(352, hb + 30, 226, m.side, 9.5);
      b += `<line x1="336" y1="${hb + 16}" x2="336" y2="${Math.max(y, f.y)}" stroke="#d6d6d0"/>` + f.svg;
      y = Math.max(y, f.y) + 10;
      b += `<rect x="1" y="${y}" width="${W - 2}" height="1" fill="#d6d6d0"/>` + T(24, y + 22, "NDC " + d.ndc, { size: 12, w: 600 }) + T(24, y + 38, d.mfr + " · " + d.city, { size: 9, fill: "#333" }) +
        T(300, y + 22, "Lot " + d.lot, { size: 10, w: 600 }) + T(300, y + 36, "Exp " + d.exp, { size: 10, w: 600 }) + bars(W - 170, y + 10, 146, 28, d.seed);
      return frame(W, y + 52, b, d.alt);
    },
    banner(d, m) {
      const W = 720, f = flow(530, 30, 172, m.side, 8.6), H = Math.max(200, f.y + 52);
      let b = `<rect x="1" y="1" width="16" height="${H - 2}" fill="${d.color}"/><rect x="9" y="1" width="8" height="${H - 2}" fill="${d.color}"/>` +
        T(32, 28, "NDC " + d.ndc, { size: 11, w: 600 }) + T(330, 28, "Rx only", { size: 12, w: 700, anchor: "end" });
      const nm = wrapW(d.generic, 300, 24);
      nm.forEach((l, i) => (b += T(32, 60 + i * 24, l, { size: 24, w: 700 })));
      const y = 60 + nm.length * 24 - 4; b += T(32, y, d.form, { size: 13, fill: "#333" });
      if (m.route) b += T(32, y + 22, m.route, { size: 11, w: 600 });
      if (m.callout) b += T(32, y + 40, m.callout, { size: 11, w: 700, fill: d.color });
      b += T(32, H - 26, d.mfr, { size: 9, fill: "#333" }) + T(32, H - 15, d.city, { size: 9, fill: "#333" });
      b += `<rect x="346" y="20" width="168" height="${H - 40}" fill="none" stroke="${d.color}" stroke-width="2"/>`;
      const sz = tw(m.strength, 30, 700) > 140 ? 22 : 30, mid = 20 + (H - 40) / 2;
      b += T(430, mid - 12, m.strength, { size: sz, w: 700, anchor: "middle" });
      if (m.sub) b += T(430, mid + 14, m.sub, { size: 13, w: 700, anchor: "middle" });
      if (m.qty) b += T(430, mid + 42, m.qty, { size: 15, w: 600, anchor: "middle" }) + (m.qtySub ? T(430, mid + 56, m.qtySub, { size: 9.5, anchor: "middle", fill: "#444" }) : "");
      b += f.svg + bars(530, H - 44, 104, 24, d.seed) + T(702, H - 34, "Lot " + d.lot, { size: 8.5, w: 600, anchor: "end" }) + T(702, H - 22, "Exp " + d.exp, { size: 8.5, w: 600, anchor: "end" });
      return frame(W, H, b, d.alt);
    },
    tallbag: (d) => bag(d, { W: 420, H: 520, lx: 76, lw: 250, ly: 66, lh: 340, gradLeft: false }),
    widebag: (d) => bag(d, { W: 500, H: 440, lx: 110, lw: 280, ly: 58, lh: 270, gradLeft: true }),
  };

  function bag(d, g) {
    const { W, H, lx, lw, ly, lh } = g, cx = lx + lw / 2, bot = H - 70;
    const grads = [], step = d.vol >= 500 ? 100 : d.vol >= 250 ? 50 : 25, gx = g.gradLeft ? lx - 40 : lx + lw + 20;
    for (let v = step; v < d.vol; v += step) {
      const y = ly + 30 + (v / d.vol) * (lh - 40);
      grads.push(`<line x1="${gx}" y1="${y}" x2="${gx + 14}" y2="${y}" stroke="#555"/>` + T(g.gradLeft ? gx - 4 : gx + 20, y + 4, v, { size: 10, fill: "#333", anchor: g.gradLeft ? "end" : "start" }));
    }
    const nm = wrapW(d.generic, (lw - 30) * 0.85, 21); let y = ly + 60;
    let lab = `<rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" fill="#fff" stroke="#c9d0d3"/><rect x="${lx}" y="${ly}" width="${lw}" height="8" fill="${d.color}"/>` +
      T(lx + 10, ly + 28, "NDC " + d.ndc, { size: 11, w: 600 }) + T(lx + lw - 10, ly + 28, "Rx only", { size: 11, w: 700, anchor: "end" });
    nm.forEach((l) => { lab += T(cx, y, l, { size: 21, w: 700, anchor: "middle" }); y += 24; });
    lab += T(cx, y - 4, d.base, { size: 12, anchor: "middle", fill: "#333" }); y += 12;
    if (d.amt) {
      lab += `<rect x="${lx + 20}" y="${y}" width="${lw - 40}" height="56" fill="${d.color}"/>` + T(cx, y + 23, `${fmtN(d.amt)} ${d.unit}`, { size: 20, w: 700, anchor: "middle", fill: "#fff" }) + T(cx, y + 46, `per ${fmtN(d.vol)} mL`, { size: 16, w: 600, anchor: "middle", fill: "#fff" });
      y += 82; lab += T(cx, y, `(${d.each})`, { size: 15, w: 700, anchor: "middle" }); y += 24;
    } else {
      lab += `<rect x="${lx + 20}" y="${y}" width="${lw - 40}" height="40" fill="${d.color}"/>` + T(cx, y + 28, `${fmtN(d.vol)} mL`, { size: 22, w: 700, anchor: "middle", fill: "#fff" });
      y += 66;
    }
    lab += T(cx, y, `${fmtN(d.vol)} mL Single-Dose Container`, { size: 10.5, anchor: "middle" }) + T(cx, y + 14, "For Intravenous Infusion Only", { size: 10.5, w: 600, anchor: "middle" }) +
      T(cx, y + 28, d.amt ? "Premixed. Do not add supplementary medication." : "Sterile, nonpyrogenic solution.", { size: 9, anchor: "middle", fill: "#333" });
    lab += T(lx + 10, ly + lh - 14, "Lot " + d.lot + "   Exp " + d.exp, { size: 9, fill: "#333" }) + T(lx + lw - 10, ly + lh - 14, d.mfr.split(",")[0], { size: 9, fill: "#333", anchor: "end" });
    const disc = wrapW(DISCLAIMER, (lw + 40) * 0.85, 8).map((l, i) => T(cx, ly + lh + 16 + i * 10, l, { size: 8, w: 700, anchor: "middle", fill: "#333" })).join("");
    const L = lx - 56, R = lx + lw + 56;
    return `<svg class="druglabel" viewBox="0 0 ${W} ${H}" width="${W}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(d.alt)}">
      <rect x="${cx - 24}" y="6" width="48" height="24" rx="12" fill="none" stroke="#a9b1ad" stroke-width="6"/>
      <path d="M${L + 12} 34 Q${L + 12} 26 ${L + 24} 26 L${R - 24} 26 Q${R - 12} 26 ${R - 12} 34 L${R + 6} ${bot - 30} Q${R + 8} ${bot - 4} ${R - 20} ${bot} L${L + 20} ${bot} Q${L - 8} ${bot - 4} ${L - 6} ${bot - 30} Z" fill="#eef4f7" stroke="#a9b6bd" stroke-width="2"/>
      <rect x="${cx - 50}" y="${bot}" width="26" height="54" rx="4" fill="#dfe6e9" stroke="#a9b6bd"/><rect x="${cx + 24}" y="${bot}" width="26" height="46" rx="4" fill="${d.color}" opacity=".85"/>
      ${grads.join("")}${lab}${disc}</svg>`;
  }

  const LOTS = "ABCDEFGHJKLMNPRT";
  function draw(spec) {
    const h = hash(spec.kind + spec.generic + spec.amt + (spec.lotSeed || ""));
    const mf = MFR[spec.m] || MFR.xyz;
    const d = {
      ...spec, mfr: mf.name, city: mf.city, ndc: "XXXXX-XXXX-XX", seed: spec.kind + spec.generic + spec.amt,
      lot: `${1 + (h % 9)}${LOTS[h % 16]}${String(h % 97).padStart(2, "0")}${LOTS[(h >>> 4) % 16]}`,
      exp: `${String(1 + (h % 12)).padStart(2, "0")}/20${28 + (h % 2)}`,
      alt: spec.alt || `Drug label: ${spec.generic}`,
    };
    if (spec.kind === "ivbag") return LAYOUTS[spec.layout === "tallbag" ? "tallbag" : "widebag"](d);
    const m = MODELS[spec.kind](d);
    m.side.push({ t: DISCLAIMER, b: 1, s: 8.2 });
    return (LAYOUTS[spec.layout] || LAYOUTS.panel)(d, m);
  }

  window.Labels = { draw };
})();
