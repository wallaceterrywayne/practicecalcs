// Answer formats. Each format draws its own input, reads what the student entered, and grades it.
// The scheduler only ever receives right or wrong. Adding a format = one entry in FORMATS.
//
//   Answers.formatOf(answer)            → "number" | "ratio" | "choice" | "multi"
//   Answers.mount(el, answer, onSubmit) → draws the input in `el`; calls onSubmit({raw, value, error})
//                                         when the student submits; returns {disable, focus}
//   Answers.grade(answer, value)        → {correct, partial}   (partial: 0–1, logged, never scheduled on)
//   Answers.guess(answer)               → chance of getting it right by guessing (0 for typed answers)
//   Answers.parseNumber("1 1/2")        → 1.5
//
// An answer's format is its `format` field, or, for problems built before formats existed, read
// from its shape: `choices` → choice, unit "1:x" → ratio, otherwise number.

(function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const VULGAR = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };

  // A number as a student might type it: 2.5, 2,500, .75, 1/2, 1 1/2, 1½, ½, -3. Text after the
  // number (a unit such as "mL") is ignored. Anything else → NaN.
  function parseNumber(s) {
    let t = String(s).trim().replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/⁄/g, "/");
    const m = t.match(/^(-?)\s*(?:(\d+)\s*)?([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/);
    if (m) return (m[1] ? -1 : 1) * ((m[2] ? +m[2] : 0) + VULGAR[m[3]]);
    const mixed = t.match(/^(-?)(\d+)\s+(\d+)\s*\/\s*(\d+)/);                     // 1 1/2
    if (mixed) return +mixed[4] === 0 ? NaN : (mixed[1] ? -1 : 1) * (+mixed[2] + +mixed[3] / +mixed[4]);
    const frac = t.match(/^(-?\d*\.?\d+)\s*\/\s*(\d*\.?\d+)/);                    // 1/2, 2.5/5
    if (frac) return +frac[2] === 0 ? NaN : +frac[1] / +frac[2];
    const num = t.match(/^-?\d*\.?\d+/);
    return num ? parseFloat(num[0]) : NaN;
  }

  const textInput = (placeholder) =>
    `<input type="text" class="ans-input" inputmode="decimal" placeholder="${placeholder}" autocomplete="off">`;

  const FORMATS = {
    number: {
      html: (a) => `${textInput("Your answer")}<span class="unit">${esc(a.unit || "")}</span><button class="btn ans-check" type="button">Check</button>`,
      read: (el) => {
        const raw = el.querySelector(".ans-input").value.trim();
        const value = parseNumber(raw);
        return { raw, value, error: Number.isNaN(value) ? "Enter a number first." : null };
      },
      grade: (a, v) => ({ correct: Math.abs(v - a.value) < 1e-9 }),       // exact match to the stated rounding
      guess: () => 0,
      typed: true,
    },
    ratio: {
      html: () => `<span class="unit">1&nbsp;:</span>${textInput("x")}<button class="btn ans-check" type="button">Check</button>`,
      read: (el) => {
        const raw = el.querySelector(".ans-input").value.trim();
        const m = raw.replace(/,/g, "").match(/^\s*1\s*:\s*(\d*\.?\d+)/);    // a full "1:2500" works too
        const value = m ? parseFloat(m[1]) : parseNumber(raw);
        return { raw, value, error: Number.isNaN(value) ? "Enter a number first." : null };
      },
      grade: (a, v) => ({ correct: Math.abs(v - a.value) < 1e-9 }),
      guess: () => 0,
      typed: true,
    },
    choice: {
      html: (a) => a.choices.map((c, i) => `<button class="btn ghost choice" type="button" data-choice="${i}">${esc(c)}</button>`).join(""),
      read: (el, picked) => ({ raw: picked === undefined ? "" : String(picked), value: picked, error: null }),
      grade: (a, v) => ({ correct: v === a.value }),
      guess: (a) => 1 / a.choices.length,
      instant: true,                                                       // a click submits
    },
    multi: {
      html: (a) => `<fieldset class="ans-multi"><legend class="muted small">Choose all that apply</legend>` +
        a.choices.map((c, i) => `<label class="check-row"><input type="checkbox" value="${i}"> <span>${esc(c)}</span></label>`).join("") +
        `</fieldset><button class="btn ans-check" type="button">Check</button>`,
      read: (el) => {
        const value = [...el.querySelectorAll(".ans-multi input:checked")].map((x) => +x.value);
        return { raw: value.join(","), value, error: value.length ? null : "Choose at least one." };
      },
      grade: (a, v) => {
        const want = new Set(a.value), got = new Set(v);
        const right = a.choices.filter((_, i) => want.has(i) === got.has(i)).length;
        return { correct: right === a.choices.length, partial: right / a.choices.length };   // exactly right, or not
      },
      guess: (a) => Math.pow(0.5, a.choices.length),
    },
  };

  function formatOf(a) {
    return a.format || (a.choices ? "choice" : a.unit === "1:x" ? "ratio" : "number");
  }

  function mount(el, a, onSubmit) {
    const f = FORMATS[formatOf(a)];
    el.innerHTML = f.html(a);
    const submit = (picked) => onSubmit(f.read(el, picked));
    if (f.instant) el.querySelectorAll("[data-choice]").forEach((b) => (b.onclick = () => submit(+b.dataset.choice)));
    const btn = el.querySelector(".ans-check");
    if (btn) btn.onclick = () => submit();
    const input = el.querySelector(".ans-input");
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    return {
      disable: () => el.querySelectorAll("input, button").forEach((x) => { x.disabled = true; }),
      focus: () => { if (input) input.focus(); },
      input,
    };
  }

  const grade = (a, v) => FORMATS[formatOf(a)].grade(a, v);
  const guess = (a) => FORMATS[formatOf(a)].guess(a);
  const api = { FORMATS, formatOf, mount, grade, guess, parseNumber };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.Answers = api;
})();
