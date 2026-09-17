/**
 * Small, safe Markdown → HTML renderer for SKILL.md files.
 * Every piece of source text is escaped before any tag is emitted, so the
 * output can only contain tags this file produces.
 */
(function (global) {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Absolute http(s)/mailto/anchor/root links pass through. A relative path is
   * resolved against `base` (the directory the document lives in) and tagged
   * with data-rel so the host can route it to a sibling tab.
   */
  function resolveHref(href, base) {
    const h = String(href || "").trim();
    if (/^(https?:|mailto:|#|\/)/i.test(h)) return { href: h, rel: null };
    if (!base || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
    const parts = [];
    for (const seg of h.replace(/^\.\//, "").split("/")) {
      if (seg === "..") parts.pop();
      else if (seg && seg !== ".") parts.push(seg);
    }
    const rel = parts.join("/");
    return rel ? { href: base.replace(/\/$/, "") + "/" + parts.map(encodeURIComponent).join("/"), rel } : null;
  }

  function inline(text, base) {
    // Protect code spans first so nothing inside them is styled.
    const codes = [];
    let s = escapeHtml(text).replace(/`([^`]+)`/g, (_, c) => {
      codes.push(`<code>${c}</code>`);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
      const r = resolveHref(src, base);
      return r ? `<img alt="${alt}" src="${r.href}" loading="lazy" />` : alt;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const r = resolveHref(href, base);
      if (!r) return label;
      const relAttr = r.rel ? ` data-rel="${escapeHtml(r.rel)}"` : "";
      return `<a href="${r.href}"${relAttr} target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  function renderTable(rows, base) {
    const cells = (line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    let html = "<table><thead><tr>";
    for (const h of head) html += `<th>${inline(h, base)}</th>`;
    html += "</tr></thead><tbody>";
    for (const r of body) {
      html += "<tr>";
      for (let i = 0; i < head.length; i++) html += `<td>${inline(r[i] || "", base)}</td>`;
      html += "</tr>";
    }
    return html + "</tbody></table>";
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  }

  function render(md, opts = {}) {
    const base = opts.base || null;
    const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    function paragraphUntilBlank() {
      const buf = [];
      while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) {
        buf.push(lines[i].trim());
        i++;
      }
      return buf.join(" ");
    }

    function blockStart(line) {
      return (
        /^(#{1,6})\s/.test(line) ||
        /^```/.test(line) ||
        /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
        /^>\s?/.test(line) ||
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
        (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      );
    }

    function list(indent) {
      const itemRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
      const first = itemRe.exec(lines[i]);
      const ordered = /\d/.test(first[2]);
      let html = ordered ? "<ol>" : "<ul>";
      while (i < lines.length) {
        const m = itemRe.exec(lines[i]);
        if (!m || m[1].length < indent) break;
        if (m[1].length > indent) {
          html = html.replace(/<\/li>$/, "") + list(m[1].length) + "</li>";
          continue;
        }
        i++;
        let text = m[3];
        // Lazy continuation lines (indented, not a new item, not blank).
        while (
          i < lines.length &&
          lines[i].trim() &&
          !itemRe.test(lines[i]) &&
          /^\s{2,}/.test(lines[i])
        ) {
          text += " " + lines[i].trim();
          i++;
        }
        const task = /^\[([ xX])\]\s+/.exec(text);
        if (task) {
          text = text.slice(task[0].length);
          const checked = task[1] !== " " ? " checked" : "";
          html += `<li class="task"><input type="checkbox" disabled${checked} /> ${inline(text, base)}</li>`;
        } else {
          html += `<li>${inline(text, base)}</li>`;
        }
        // Allow blank line between items of the same list.
        if (i < lines.length && !lines[i].trim() && i + 1 < lines.length) {
          const next = itemRe.exec(lines[i + 1]);
          if (next && next[1].length >= indent) i++;
        }
      }
      return html + (ordered ? "</ol>" : "</ul>");
    }

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      let m;
      if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
        const level = m[1].length;
        const text = inline(m[2], base);
        const id = slugify(m[2]);
        out.push(`<h${level} id="${id}">${text}</h${level}>`);
        i++;
        continue;
      }
      if (/^```/.test(line)) {
        const lang = line.slice(3).trim().split(/\s+/)[0];
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        const cls = lang ? ` class="lang-${escapeHtml(lang)}"` : "";
        out.push(`<pre><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre>`);
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        out.push("<hr />");
        i++;
        continue;
      }
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
        out.push(`<blockquote>${render(buf.join("\n"), opts)}</blockquote>`);
        continue;
      }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
        out.push(renderTable(rows, base));
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        out.push(list(/^(\s*)/.exec(line)[1].length));
        continue;
      }
      out.push(`<p>${inline(paragraphUntilBlank(), base)}</p>`);
    }
    return out.join("\n");
  }

  global.Markdown = { render, escapeHtml };
})(window);
