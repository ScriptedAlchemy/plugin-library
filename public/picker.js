/* global Markdown */
/**
 * Bot picker + apply flow. One state object, one render() that switches on
 * `stage`, and one pure function that maps an /api/apply response to the
 * next stage. `confirmed: true` is only ever sent from a stage whose button
 * the user just clicked.
 */
(function (global) {
  "use strict";

  const esc = Markdown.escapeHtml;
  const AVATAR_COLORS = {
    magenta: "#d64ea8", green: "#3fbf7f", cyan: "#2fb7c9", blue: "#4f7fe0", red: "#e05252",
    orange: "#e6873a", black: "#3a3f4a", purple: "#8b5cf6", yellow: "#d4b13a",
  };

  function hueOf(s) {
    let h = 0;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function initials(name) {
    const parts = String(name || "?").replace(/[^\w\s/-]/g, " ").trim().split(/[\s/-]+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  function oneLine(s) {
    return String(s || "").split(/\n/)[0].trim();
  }
  function plural(n, one, many = one + "s") {
    return `${n} ${n === 1 ? one : many}`;
  }
  function avatarHtml(b) {
    const style = b.kind === "group" ? "" : `--av:${AVATAR_COLORS[b.avatarColor] || `hsl(${hueOf(b.name)} 55% 45%)`}`;
    const shape = b.kind === "group" ? "group" : b.avatarShape || "";
    return `<span class="avatar ${esc(shape)}" style="${style}">${esc(initials(b.name))}</span>`;
  }

  /** /api/apply response → next stage. Pure; the only place the contract is interpreted. */
  function nextStage(json) {
    const status = json.status || json.error;
    switch (status) {
      case "needs_install_confirm":
        return { stage: "confirm-install" };
      case "needs_mode_confirm":
        return { stage: "confirm-nudge" };
      case "missing_attach_api":
        return { stage: "offer-nudge" };
      case "install_queued":
        return { stage: "done", tone: "ok", message: "Install queued for the Plugin Applier." };
      case "nudge_send_queued":
        return { stage: "done", tone: "ok", message: "Nudge queued for the Plugin Applier." };
      case "profile_bake_queued":
        return { stage: "done", tone: "ok", message: "Profile bake queued for the Plugin Applier." };
      default:
        return { stage: "done", tone: "err", message: json.message || `Unexpected response: ${status}` };
    }
  }

  /**
   * @param {object} opts
   * @param {HTMLElement} opts.root  container to render into
   * @param {object} opts.plugin    { plugin_id, name, installed }
   * @param {object|null} opts.skill { id, name } or null for the whole plugin
   * @param {(msg: string, tone: string) => void} opts.onResult
   */
  function openPicker({ root, plugin, skill, onResult }) {
    const s = { stage: "loading", roster: null, query: "", selected: null, error: null };

    const thing = skill
      ? `the skill <b>${esc(skill.name)}</b> from <b>${esc(plugin.name)}</b>`
      : `<b>${esc(plugin.name)}</b>`;
    const target = () => `<b>${esc(s.selected.name)}</b>${s.selected.kind === "group" ? " (group)" : ""}`;

    function close() {
      root.classList.add("hidden");
      root.innerHTML = "";
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("keydown", onKey);

    async function loadRoster() {
      s.stage = "loading";
      render();
      try {
        const r = await fetch("/api/bots");
        const j = await r.json();
        if (!j.ok) throw new Error(j.message || j.error || "gbot unavailable");
        s.roster = j;
        s.stage = "list";
      } catch (e) {
        s.error = e.message;
        s.stage = "roster-error";
      }
      render();
    }

    async function submit(extra) {
      s.stage = "working";
      render();
      const payload = { plugin_id: plugin.plugin_id, bot_ref: s.selected.id, ...extra };
      if (skill) payload.skill_id = skill.id;
      try {
        const r = await fetch("/api/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        Object.assign(s, nextStage(await r.json()));
      } catch (e) {
        Object.assign(s, { stage: "done", tone: "err", message: String(e.message || e) });
      }
      render();
    }

    function rosterHtml() {
      const q = s.query.toLowerCase();
      const f = (b) => !q || b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q);
      const row = (b) => `<button class="bot" data-id="${esc(b.id)}" aria-selected="${!!s.selected && s.selected.id === b.id}">
        ${avatarHtml(b)}
        <span><span class="bname">${esc(b.name)}</span><span class="bdesc">${esc(oneLine(b.description) || (b.kind === "group" ? plural((b.members || []).length, "member") : ""))}</span></span>
        <span class="kind">${b.kind}</span>
      </button>`;
      const bots = s.roster.bots.filter(f);
      const groups = s.roster.groups.filter(f);
      let html = "";
      if (bots.length) html += `<div class="list-heading">Bots</div>${bots.map(row).join("")}`;
      if (groups.length) html += `<div class="list-heading">Groups</div>${groups.map(row).join("")}`;
      return html || `<div class="picker-state">No bot matches “${esc(s.query)}”.</div>`;
    }

    function confirmHtml() {
      const verb = plugin.installed ? "Apply" : "Install";
      switch (s.stage) {
        case "confirm":
          return {
            sentence: `${verb} ${thing} for ${target()}?`,
            fine: "Nothing changes on the bot until the Plugin Applier confirms it.",
            cancel: "Cancel",
            go: verb,
            action: () => submit({}),
          };
        case "confirm-install":
          return {
            sentence: `<b>${esc(plugin.name)}</b> isn't installed yet.`,
            fine: `Queue an account-wide install for the Plugin Applier, then the apply for ${target()}?`,
            cancel: "Cancel",
            go: "Queue install",
            action: () => submit({ confirmed: true }),
          };
        case "offer-nudge":
          return {
            sentence: "There's no per-bot attach API yet, so nothing was changed.",
            fine: `You can instead <b>send ${target()} a message</b> pointing at ${thing}. This posts to the bot's thread.`,
            cancel: "Done",
            go: "Send nudge",
            action: () => submit({ mode: "nudge_send", confirmed: true }),
          };
        case "confirm-nudge":
          return {
            sentence: `Send ${target()} a message about ${thing}?`,
            fine: "This posts to the bot's thread once the Plugin Applier drains the queue.",
            cancel: "Cancel",
            go: "Send nudge",
            action: () => submit({ mode: "nudge_send", confirmed: true }),
          };
        case "working":
          return { sentence: "Working…", fine: "", cancel: null, go: null, action: null };
        case "loading":
        case "list":
        case "roster-error":
        case "done":
          return null;
        default: {
          const never = s.stage;
          throw new Error(`unhandled picker stage: ${never}`);
        }
      }
    }

    function render() {
      if (s.stage === "done") {
        onResult(s.message, s.tone);
        close();
        return;
      }
      const showRoster = s.stage !== "loading" && s.stage !== "roster-error";
      const confirm = confirmHtml();
      root.innerHTML = `<div class="picker-backdrop" data-close></div>
        <div class="picker" role="dialog" aria-modal="true" aria-label="Choose a bot">
          <div class="picker-head">
            <div class="what">${plugin.installed ? "Apply" : "Install"} ${thing}</div>
            <h3>Which bot?</h3>
            <input type="search" data-search placeholder="Search bots and groups…" autocomplete="off" value="${esc(s.query)}" ${showRoster ? "" : "disabled"} />
          </div>
          <div class="picker-list">${
            s.stage === "loading"
              ? `<div class="picker-state">Asking <code>gbot</code> for the live roster…</div>`
              : s.stage === "roster-error"
                ? `<div class="picker-state">Couldn't reach <code>gbot</code>.<br /><span style="opacity:.7">${esc(s.error)}</span><br /><button class="btn ghost" data-retry>Retry</button></div>`
                : rosterHtml()
          }</div>
          ${
            confirm
              ? `<div class="confirm">
                  <div class="sentence">${confirm.sentence}</div>
                  ${confirm.fine ? `<div class="fine">${confirm.fine}</div>` : ""}
                  <div class="row">
                    ${confirm.cancel ? `<button class="btn ghost" data-cancel>${confirm.cancel}</button>` : ""}
                    ${confirm.go ? `<button class="btn" data-go>${confirm.go}</button>` : `<button class="btn" disabled>Working…</button>`}
                  </div>
                </div>`
              : ""
          }
        </div>`;

      root.querySelector("[data-close]").onclick = close;
      const cancel = root.querySelector("[data-cancel]");
      if (cancel) cancel.onclick = close;
      const go = root.querySelector("[data-go]");
      if (go && confirm) go.onclick = confirm.action;
      const retry = root.querySelector("[data-retry]");
      if (retry) retry.onclick = loadRoster;

      const search = root.querySelector("[data-search]");
      search.oninput = () => {
        s.query = search.value.trim();
        root.querySelector(".picker-list").innerHTML = rosterHtml();
        wireRoster();
      };
      wireRoster();
      if (s.stage === "list" && document.activeElement !== search) search.focus();
    }

    function wireRoster() {
      if (s.stage !== "list" && s.stage !== "confirm") return;
      root.querySelectorAll(".bot").forEach((b) => {
        b.onclick = () => {
          s.selected = [...s.roster.bots, ...s.roster.groups].find((x) => x.id === b.dataset.id);
          s.stage = "confirm";
          render();
        };
      });
    }

    root.classList.remove("hidden");
    loadRoster();
    return { close };
  }

  global.Picker = { openPicker, nextStage };
})(window);
