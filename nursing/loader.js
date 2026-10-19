// Loads web/data/meta.js and per-topic data files on demand.
// Data files are scripts that call PC.registerMeta / PC.registerTopic, so this works from file://.

(function () {
  const PC = (window.PC = window.PC || {});
  PC.meta = null;
  PC.pool = {};              // topic id → instances
  const waiting = {};

  PC.registerMeta = (m) => { PC.meta = m; window.CATALOG = m.catalog; };
  PC.registerTopic = (id, items) => {
    PC.pool[id] = items;
    (waiting[id] || []).forEach((f) => f());
  };

  function addScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + src));
      document.head.appendChild(s);
    });
  }

  PC.loadMeta = () => (PC.meta ? Promise.resolve(PC.meta) : addScript("data/meta.js").then(() => PC.meta));

  // Load the data for the given topics (skipping ones with no content or already loaded).
  PC.loadTopics = (ids) => Promise.all(ids.map((id) => {
    const t = PC.meta.topics.find((x) => x.id === id);
    if (!t || !t.count || PC.pool[id]) return Promise.resolve();
    return addScript(`data/${t.file || `topic-${id}.js`}`);
  }));
})();
