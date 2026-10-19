// Saves student progress in the browser (localStorage), with export/import as a file.
// localStorage can be unavailable (private windows, blocked storage); the app then still works
// for the current visit and says progress won't be saved.

(function () {
  const KEY = window.PROGRAM.storage_key;
  let available = true;

  function load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      available = false;
      return null;
    }
  }

  function save(state) {
    state.program = window.PROGRAM.id;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      available = false;
      return false;
    }
  }

  function clear() {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* nothing to clear */ }
  }

  function exportFile(state) {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${window.PROGRAM.file_prefix}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // Resolves with the parsed state, or rejects with a message for the student.
  function importFile(file) {
    return file.text().then((txt) => {
      let s;
      try { s = JSON.parse(txt); } catch (e) { throw new Error("That file isn't a progress file."); }
      if (s && s.version === 1) throw new Error("That progress file is from an older version of this app and can't be loaded.");
      if (!s || s.version !== 2 || !Array.isArray(s.topics) || !s.cards || !Array.isArray(s.log)) {
        throw new Error("That file isn't a progress file from this app.");
      }
      const me = window.PROGRAM;
      if (s.program && s.program !== me.id) {
        throw new Error(`That progress file is from a different app (${s.program}), not ${me.heading}. Load it in that app instead.`);
      }
      if (!s.program) throw new Error("That progress file is from an older version of this app and can't be loaded.");
      return s;
    });
  }

  window.Store = { load, save, clear, exportFile, importFile, isAvailable: () => available };
})();
