/* global Markdown, Picker */
(function () {
  "use strict";

  const esc = Markdown.escapeHtml;
  const $ = (id) => document.getElementById(id);

  const state = {
    installed: [],
    marketplace: [],
    groups: {}, // plugin_id -> [{ name, skillIds }]
    view: "installed",
    query: "",
    pluginId: null,
    doc: null, // { kind, id } open in the reader
    docSeq: 0, // bumps per openDoc so slow fetches can't paint a stale doc
  };

  const els = {
    shell: $("shell"),
    search: $("search"),
    list: $("pluginList"),
    counts: $("counts"),
    main: $("mainInner"),
    readerHead: $("readerHead"),
    readerTabs: $("readerTabs"),
    readerBody: $("readerBody"),
    readerStatus: $("readerStatus"),
    readerApply: $("readerApply"),
    picker: $("pickerRoot"),
    toast: $("toast"),
  };

  // ---------------------------------------------------------------- utils
  async function getJson(url) {
    const r = await fetch(url);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.message || body.error || `HTTP ${r.status}`);
    return body;
  }
  function localUrl(key, kind, ...segments) {
    return `/api/local/${key}/${kind}/${segments.flatMap((s) => s.split("/")).map(encodeURIComponent).join("/")}`;
  }
  function hueOf(s) {
    let h = 0;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function initials(name) {
    const parts = String(name || "?").replace(/[^\w\s/-]/g, " ").trim().split(/[\s/-]+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  /** Initials tile; when the plugin ships a logo, an <img> sits on top and is removed if it fails. */
  function logoHtml(p, cls = "") {
    const img = p.local && p.local.logo ? `<img src="${esc(localUrl(p.local.key, "file", p.local.logo))}" alt="" />` : "";
    return `<span class="logo ${cls}" style="--item-hue:${hueOf(p.name)}"><span class="initials">${esc(initials(p.name))}</span>${img}</span>`;
  }
  function wireLogos(root) {
    root.querySelectorAll(".logo img").forEach((img) => img.addEventListener("error", () => img.remove()));
  }
  function plural(n, one, many = one + "s") {
    return `${n} ${n === 1 ? one : many}`;
  }
  function toast(msg, cls = "") {
    els.toast.textContent = msg;
    els.toast.className = `toast ${cls}`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => els.toast.classList.add("hidden"), 3600);
  }
  function setStatus(msg, cls = "") {
    els.readerStatus.textContent = msg;
    els.readerStatus.className = `status ${cls}`;
  }
  function onSendResult(msg, tone) {
    toast(msg, tone);
    setStatus(msg, tone);
  }

  // ---------------------------------------------------------------- data
  function findPlugin(id) {
    return state.installed.find((p) => p.plugin_id === String(id)) || state.marketplace.find((p) => p.plugin_id === String(id)) || null;
  }

  function skillGroups(p) {
    const skills = (p.local && p.local.skills) || [];
    const groups = state.groups[p.plugin_id];
    if (!groups) return skills.length ? [{ name: "Skills", skills }] : [];
    const byId = new Map(skills.map((s) => [s.id, s]));
    const seen = new Set();
    const out = [];
    for (const g of groups) {
      const list = g.skillIds.map((id) => byId.get(id)).filter(Boolean);
      list.forEach((s) => seen.add(s.id));
      if (list.length) out.push({ name: g.name, skills: list });
    }
    const rest = skills.filter((s) => !seen.has(s.id));
    if (rest.length) out.push({ name: "Other", skills: rest });
    return out;
  }

  // ---------------------------------------------------------------- sidebar
  function renderList() {
    const q = state.query.toLowerCase();
    const match = (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q) ||
      p.plugin_id.includes(q) ||
      ((p.local && p.local.skills) || []).some((s) => s.id.includes(q) || s.name.toLowerCase().includes(q));

    const rows = (state.view === "installed" ? state.installed : state.marketplace).filter(match);
    const item = (p) => {
      const n = p.skill_count;
      const sub = p.local
        ? [n ? plural(n, "skill") : null, p.local.agents.length ? plural(p.local.agents.length, "agent") : null, p.local.hasMcp ? "MCP" : null].filter(Boolean).join(" · ") || "connector"
        : [p.category, n ? plural(n, "skill") : null].filter(Boolean).join(" · ");
      return `<button class="plugin-item${n ? "" : " dim"}" data-id="${esc(p.plugin_id)}" aria-current="${p.plugin_id === state.pluginId}" style="--item-hue:${hueOf(p.name)}">
        ${logoHtml(p)}
        <span><span class="name">${esc(p.name)}</span><span class="sub">${esc(sub)}</span></span>
        <span class="count${n >= 10 ? " hot" : ""}">${n || "–"}</span>
      </button>`;
    };

    let html;
    if (!rows.length) {
      html = `<div class="list-empty">${q ? `Nothing matches “${esc(state.query)}”.` : "Nothing here yet."}</div>`;
    } else if (state.view === "installed") {
      const withSkills = rows.filter((p) => p.skill_count > 0);
      const without = rows.filter((p) => p.skill_count === 0);
      html = withSkills.map(item).join("");
      if (without.length) html += `<div class="list-heading">Connectors only</div>${without.map(item).join("")}`;
    } else {
      html = rows.slice(0, 250).map(item).join("");
      if (rows.length > 250) html += `<div class="list-empty">Showing 250 of ${rows.length}. Narrow the search.</div>`;
    }
    els.list.innerHTML = html;
    wireLogos(els.list);
    els.list.querySelectorAll(".plugin-item").forEach((b) => b.addEventListener("click", () => navigate(`#/p/${b.dataset.id}`)));
    const cur = els.list.querySelector('[aria-current="true"]');
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  // ---------------------------------------------------------------- main
  function renderWelcome() {
    document.documentElement.style.setProperty("--hue", 220);
    els.main.innerHTML = `<div class="welcome">
      <h2>Pick a plugin to explore</h2>
      <p>Every installed plugin shows its real skills, agents and rules straight from disk. Open any skill to read it in full, then hand it to a bot.</p>
      <div class="hints"><span><kbd>/</kbd> search</span><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Esc</kbd> close reader</span></div>
    </div>`;
  }

  function renderPlugin(p) {
    document.documentElement.style.setProperty("--hue", hueOf(p.name));
    const L = p.local;
    const byline = [];
    if (L && L.author) byline.push(esc(L.author));
    if (L && L.semver) byline.push(`v${esc(L.semver)}`);
    if (p.category) byline.push(esc(p.category));
    if (/^\d+$/.test(p.plugin_id)) byline.push(`<span title="plugin id">#${esc(p.plugin_id)}</span>`);
    else if (L) byline.push(`<span title="plugin directory">${esc(L.key)}</span>`);

    const chips = [p.installed ? `<span class="chip ok">Installed</span>` : `<span class="chip warn">Not installed</span>`];
    if (L) {
      if (L.skills.length) chips.push(`<span class="chip"><b>${L.skills.length}</b> skills</span>`);
      if (L.agents.length) chips.push(`<span class="chip"><b>${L.agents.length}</b> agents</span>`);
      if (L.rules.length) chips.push(`<span class="chip"><b>${L.rules.length}</b> rules</span>`);
      if (L.hasMcp) chips.push(`<span class="chip">MCP server</span>`);
      if (L.hasReadme) chips.push(`<a class="chip link" href="#/p/${esc(p.plugin_id)}/f/README.md">README</a>`);
      if (L.homepage) chips.push(`<a class="chip link" href="${esc(L.homepage)}" target="_blank" rel="noopener">Source ↗</a>`);
    } else {
      if (p.skill_count) chips.push(`<span class="chip"><b>${p.skill_count}</b> skills</span>`);
      if (p.connector_count) chips.push(`<span class="chip"><b>${p.connector_count}</b> connectors</span>`);
    }
    chips.push(`<button class="chip link" id="sendPlugin">Send plugin to a bot…</button>`);

    let html = `<div class="hero">
      ${logoHtml(p, "lg")}
      <div>
        <h2>${esc(p.name)}</h2>
        <div class="byline">${byline.join('<span class="dot">·</span>')}</div>
        ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
        <div class="chips">${chips.join("")}</div>
      </div>
    </div>`;

    const section = (title, items, cardFn) =>
      items.length
        ? `<section class="section"><div class="section-head"><h3>${esc(title)}</h3><span class="n">${items.length}</span></div><div class="grid">${items.map(cardFn).join("")}</div></section>`
        : "";

    if (L) {
      for (const g of skillGroups(p)) {
        html += `<section class="section">
          <div class="section-head"><h3>${esc(g.name)}</h3><span class="n">${g.skills.length}</span><span class="hint">click a skill to read it in full</span></div>
          <div class="grid">${g.skills.map((s) => skillCard(p, s)).join("")}</div>
        </section>`;
      }
      html += section("Agents", L.agents, (a) => docCard(p, "a", a));
      html += section("Rules", L.rules, (r) => docCard(p, "r", r, r.alwaysApply ? "always applied" : ""));
      if (!L.skills.length && !L.agents.length && !L.rules.length) {
        html += `<div class="section notice">This plugin only ships a connector${L.hasMcp ? " (MCP server)" : ""}. There are no skills to read.</div>`;
      }
    } else if (p.installed) {
      html += `<div class="section notice">Installed, but its files aren't in the local plugin cache yet, so skills can't be read here.</div>`;
    } else {
      html += `<div class="section notice">Marketplace listing. Skill contents become readable once the plugin is installed.</div>`;
    }

    els.main.innerHTML = html;
    els.main.scrollTop = 0;
    wireLogos(els.main);
    els.main.querySelectorAll(".card[data-doc]").forEach((c) => c.addEventListener("click", () => navigate(c.dataset.doc)));
    $("sendPlugin").addEventListener("click", () => Picker.openPicker({ root: els.picker, plugin: p, skill: null, onResult: onSendResult }));
    markCurrentCard();
  }

  function skillCard(p, s) {
    const size = s.bytes > 1024 ? `${(s.bytes / 1024).toFixed(1)} KB` : `${s.bytes} B`;
    return `<button class="card" data-doc="#/p/${p.plugin_id}/s/${encodeURIComponent(s.id)}" data-key="s:${esc(s.id)}">
      <div class="title">${esc(s.name)}${s.name !== s.id ? `<code>${esc(s.id)}</code>` : ""}</div>
      <div class="blurb">${esc(s.description)}</div>
      <div class="foot"><span>${size}</span>${s.files.length ? `<span>· ${plural(s.files.length, "extra file")}</span>` : ""}<span class="read">Read →</span></div>
    </button>`;
  }

  function docCard(p, kind, d, tag = "") {
    return `<button class="card" data-doc="#/p/${p.plugin_id}/${kind}/${encodeURIComponent(d.id)}" data-key="${kind}:${esc(d.id)}">
      <div class="title">${esc(d.name)}</div>
      <div class="blurb">${esc(d.description)}</div>
      <div class="foot">${tag ? `<span>${esc(tag)}</span>` : ""}<span class="read">Read →</span></div>
    </button>`;
  }

  function markCurrentCard() {
    const key = state.doc ? `${state.doc.kind}:${state.doc.id}` : null;
    els.main.querySelectorAll(".card[data-key]").forEach((c) => c.setAttribute("aria-current", String(c.dataset.key === key)));
  }

  // ---------------------------------------------------------------- reader
  const KIND_LABEL = { s: "skill", a: "agent", r: "rule", f: "file" };

  function closeReader() {
    state.doc = null;
    state.docSeq++;
    els.shell.classList.remove("reader-open");
    markCurrentCard();
  }

  /** Resolve a route kind+id to the files the reader shows as tabs. */
  function docTabs(p, kind, id) {
    const L = p.local;
    switch (kind) {
      case "s": {
        const skill = L.skills.find((s) => s.id === id);
        if (!skill) return null;
        return { skill, tabs: [{ label: "SKILL.md", path: skill.file }, ...skill.files.map((f) => ({ label: f, path: `skills/${skill.id}/${f}` }))] };
      }
      case "a":
      case "r": {
        const entry = (kind === "a" ? L.agents : L.rules).find((x) => x.id === id);
        return entry ? { skill: null, tabs: [{ label: entry.file, path: entry.file }] } : null;
      }
      case "f":
        return { skill: null, tabs: [{ label: id, path: id }] };
      default: {
        const never = kind;
        throw new Error(`unhandled doc kind: ${never}`);
      }
    }
  }

  function openDoc(p, kind, id) {
    state.doc = { kind, id };
    const seq = ++state.docSeq;
    els.shell.classList.add("reader-open");
    markCurrentCard();

    els.readerHead.innerHTML = `<div>
        <div class="crumb">${logoHtml(p)}<span>${esc(p.name)}</span><span>/</span><span>${KIND_LABEL[kind]}</span></div>
        <h2>${esc(id)}</h2><div class="meta"></div>
      </div>
      <button class="icon-btn" id="closeReader" title="Close (Esc)" aria-label="Close">✕</button>`;
    wireLogos(els.readerHead);
    $("closeReader").onclick = () => navigate(`#/p/${p.plugin_id}`);
    els.readerBody.innerHTML = `<div class="prose"><div class="skeleton" style="width:60%;margin-top:20px"></div><div class="skeleton" style="width:90%;margin-top:14px"></div><div class="skeleton" style="width:80%;margin-top:10px"></div></div>`;
    els.readerTabs.innerHTML = "";
    setStatus("");

    const resolved = p.local ? docTabs(p, kind, id) : null;
    const skill = resolved ? resolved.skill : null;
    els.readerApply.textContent = skill ? `Send “${skill.name}” to a bot…` : "Send plugin to a bot…";
    els.readerApply.onclick = () => Picker.openPicker({ root: els.picker, plugin: p, skill, onResult: onSendResult });
    if (!resolved) {
      els.readerBody.innerHTML = `<div class="notice" style="margin-top:16px">Not found in the local plugin cache.</div>`;
      return;
    }
    const { tabs } = resolved;

    const selectTab = (i) => {
      els.readerTabs.querySelectorAll("button").forEach((x, j) => x.setAttribute("aria-selected", String(i === j)));
      loadTab(p.local.key, tabs, i, seq);
    };
    if (tabs.length > 1) {
      els.readerTabs.innerHTML = tabs.map((t, i) => `<button role="tab" aria-selected="${i === 0}">${esc(t.label)}</button>`).join("");
      els.readerTabs.querySelectorAll("button").forEach((b, i) => (b.onclick = () => selectTab(i)));
    }
    selectTab(0);
  }

  const dirname = (p) => p.split("/").slice(0, -1).join("/");
  const joinPath = (dir, rel) => (dir ? `${dir}/${rel}` : rel);

  async function loadTab(key, tabs, index, seq) {
    const tab = tabs[index];
    const stillCurrent = () => seq === state.docSeq;
    try {
      if (/\.mdc?$/i.test(tab.path)) {
        const { meta, markdown } = await getJson(localUrl(key, "doc", tab.path));
        if (!stillCurrent()) return;
        els.readerHead.querySelector(".meta").innerHTML = Object.entries(meta)
          .filter(([k]) => k !== "description" && k !== "name")
          .map(([k, v]) => `<span class="chip" title="${esc(k)}">${esc(k)}: ${esc(String(v))}</span>`)
          .join("");
        const lead = meta.description ? `<p class="lead"><em>${esc(meta.description)}</em></p>` : "";
        const dir = dirname(tab.path);
        const base = dir ? localUrl(key, "file", dir) : `/api/local/${key}/file`;
        els.readerBody.innerHTML = `<article class="prose">${lead}${Markdown.render(markdown, { base })}</article>`;
        // A relative link that names another tab switches tabs instead of leaving the reader.
        els.readerBody.querySelectorAll("a[data-rel]").forEach((a) => {
          const target = joinPath(dir, a.dataset.rel);
          const i = tabs.findIndex((t) => t.path === target);
          if (i >= 0) {
            a.removeAttribute("target");
            a.addEventListener("click", (e) => {
              e.preventDefault();
              els.readerTabs.querySelectorAll("button").forEach((x, j) => x.setAttribute("aria-selected", String(i === j)));
              loadTab(key, tabs, i, seq);
            });
          }
        });
      } else {
        const r = await fetch(localUrl(key, "file", tab.path));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (!stillCurrent()) return;
        els.readerBody.innerHTML = `<div class="prose"><pre><code>${esc(text)}</code></pre></div>`;
      }
      els.readerBody.scrollTop = 0;
    } catch (e) {
      if (stillCurrent()) els.readerBody.innerHTML = `<div class="notice" style="margin-top:16px">${esc(e.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------- routing
  function navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function route() {
    const m = /^#\/p\/([^/]+)(?:\/([sarf])\/(.+))?$/.exec(location.hash);
    if (!m) {
      state.pluginId = null;
      closeReader();
      renderWelcome();
      renderList();
      return;
    }
    const p = findPlugin(m[1]);
    if (!p) {
      state.pluginId = null;
      closeReader();
      renderWelcome();
      renderList();
      return;
    }
    if (state.pluginId !== p.plugin_id) {
      state.pluginId = p.plugin_id;
      setView(p.installed ? "installed" : "marketplace", false);
      renderPlugin(p);
    }
    renderList();
    if (m[2]) openDoc(p, m[2], decodeURIComponent(m[3]));
    else closeReader();
  }

  function setView(view, rerender = true) {
    state.view = view;
    document.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    if (rerender) renderList();
  }

  // ---------------------------------------------------------------- keyboard
  document.addEventListener("keydown", (e) => {
    const inField = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "Escape") {
      if (!els.picker.classList.contains("hidden")) return; // the picker owns Esc while open
      if (state.doc) return navigate(`#/p/${state.pluginId}`);
      if (inField) document.activeElement.blur();
      return;
    }
    if (inField) return;
    if (e.key === "/") {
      e.preventDefault();
      els.search.focus();
      els.search.select();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = [...els.list.querySelectorAll(".plugin-item")];
      if (!items.length) return;
      e.preventDefault();
      const i = items.findIndex((x) => x.getAttribute("aria-current") === "true");
      const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      navigate(`#/p/${next.dataset.id}`);
    }
  });

  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim();
    renderList();
  });
  document.querySelectorAll(".segmented button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  window.addEventListener("hashchange", route);

  // ---------------------------------------------------------------- init
  (async function init() {
    try {
      const lib = await getJson("/api/library");
      state.installed = lib.installed.sort((a, b) => b.skill_count - a.skill_count || a.name.localeCompare(b.name));
      state.marketplace = lib.marketplace.sort((a, b) => b.skill_count - a.skill_count || a.name.localeCompare(b.name));
      state.groups = lib.groups || {};
      els.counts.textContent = `${state.installed.length} installed · ${state.marketplace.length} in marketplace`;
      route();
    } catch (e) {
      els.counts.textContent = "failed to load";
      els.main.innerHTML = `<div class="notice">${esc(e.message)}</div>`;
    }
  })();
})();
