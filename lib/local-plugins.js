"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const CACHE_ROOTS = [
  process.env.CURSOR_PLUGIN_CACHE,
  path.join(os.homedir(), ".cursor", "plugins", "cache"),
].filter(Boolean);

const INDEX_TTL_MS = 15_000;
let cached = { at: 0, plugins: [] };

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readJsonFile(file) {
  const raw = readText(file);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function unquote(v) {
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return v.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

/**
 * YAML front matter as skills actually write it: `key: scalar`, quoted
 * scalars, and `>`/`|` block scalars (folded / literal, with `-`/`+` chomping).
 * Nested maps and sequences are not needed by any cached plugin and are skipped.
 */
function parseFrontMatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { meta: {}, body: md };
  const lines = m[1].split(/\r?\n/);
  const meta = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const value = kv[2].trim();
    const nextIndented = i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]);
    const block = /^([>|])[+-]?$/.exec(value);
    if (!block) {
      if (value === "" && nextIndented) {
        // Nested map or sequence: not needed by the UI, skip its body.
        while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === "")) i++;
        continue;
      }
      if (value !== "") meta[kv[1]] = unquote(value);
      continue;
    }
    const buf = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
      buf.push(lines[++i].replace(/^\s+/, ""));
    }
    while (buf.length && buf[buf.length - 1] === "") buf.pop();
    meta[kv[1]] = block[1] === ">" ? buf.join(" ").replace(/\s+/g, " ").trim() : buf.join("\n");
  }
  return { meta, body: md.slice(m[0].length) };
}

function firstHeading(body) {
  const h = /^#\s+(.+)$/m.exec(body);
  return h ? h[1].trim() : null;
}

function firstParagraph(body) {
  const buf = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^#/.test(t) || /^---/.test(t)) {
      if (buf.length) break;
      continue;
    }
    buf.push(t);
  }
  return buf.join(" ");
}

function walkFiles(dir, prefix = "") {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkFiles(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

/** Shared shape for skills, agents and rules: a markdown doc with a summary. */
function readDoc(root, file, id) {
  const raw = readText(path.join(root, file));
  if (raw == null) return null;
  const { meta, body } = parseFrontMatter(raw);
  return {
    id,
    name: typeof meta.name === "string" && meta.name ? meta.name : firstHeading(body) || id,
    description: typeof meta.description === "string" ? meta.description : firstParagraph(body),
    file,
    bytes: Buffer.byteLength(raw, "utf8"),
    alwaysApply: meta.alwaysApply === true,
  };
}

function readSkills(root) {
  const skillsDir = path.join(root, "skills");
  return listDirs(skillsDir)
    .map((id) => {
      const doc = readDoc(root, `skills/${id}/SKILL.md`, id);
      if (!doc) return null;
      const files = walkFiles(path.join(skillsDir, id))
        .filter((f) => f !== "SKILL.md")
        .sort();
      return { ...doc, files };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function readDocsIn(root, sub, ext) {
  const dir = path.join(root, sub);
  return walkFiles(dir)
    .filter((f) => ext.test(f))
    .map((f) => readDoc(root, `${sub}/${f}`, f.replace(ext, "")))
    .filter(Boolean);
}

function httpUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v) ? v : null;
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** One directory in the cache, before any file inside it has been read. */
function scanCandidates(cacheRoot) {
  const out = [];
  for (const marketplace of listDirs(cacheRoot)) {
    for (const slug of listDirs(path.join(cacheRoot, marketplace))) {
      const pluginDir = path.join(cacheRoot, marketplace, slug);
      for (const version of listDirs(pluginDir).filter((v) => !v.startsWith("."))) {
        const root = path.join(pluginDir, version);
        const manifest =
          readJsonFile(path.join(root, ".cursor-plugin", "plugin.json")) ||
          readJsonFile(path.join(root, "plugin.json")) ||
          {};
        out.push({
          key: `${marketplace}/${slug}`,
          marketplace,
          slug,
          version,
          root,
          manifest,
          // Cursor marks the version it actually installed with a sibling `<hash>.installed`.
          installedMarker: fs.existsSync(`${root}.installed`),
          mtime: mtimeOf(root),
          packageName: manifest.name || slug,
          semver: typeof manifest.version === "string" ? manifest.version : null,
        });
      }
    }
  }
  return out;
}

function readContents(c) {
  const { manifest, root } = c;
  return {
    key: c.key,
    aliases: c.aliases,
    marketplace: c.marketplace,
    slug: c.slug,
    version: c.version,
    root,
    name: manifest.displayName || manifest.name || c.slug,
    description: manifest.description || "",
    author: manifest.author && manifest.author.name ? manifest.author.name : null,
    homepage: httpUrl(manifest.homepage) || httpUrl(manifest.repository && manifest.repository.url) || httpUrl(manifest.repository),
    semver: c.semver,
    logo: manifest.logo && fs.existsSync(path.join(root, manifest.logo)) ? manifest.logo : null,
    hasReadme: fs.existsSync(path.join(root, "README.md")),
    hasMcp: fs.existsSync(path.join(root, "mcp.json")),
    skills: readSkills(root),
    agents: readDocsIn(root, "agents", /\.md$/),
    rules: readDocsIn(root, "rules", /\.mdc?$/),
    matchKeys: c.matchKeys,
  };
}

function compareSemver(a, b) {
  const pa = String(a || "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * The cache often holds one plugin several times: under its numeric id and
 * under its slug, sometimes at different versions. Serve the copy Cursor marked
 * as installed; otherwise the newest. The winner answers to every directory
 * name the plugin was found under.
 */
function dedupe(candidates) {
  const groups = new Map();
  for (const c of candidates) {
    const identity = `${c.marketplace}/${c.packageName}`;
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(c);
  }
  const out = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        Number(b.installedMarker) - Number(a.installedMarker) ||
        compareSemver(b.semver, a.semver) ||
        b.mtime - a.mtime,
    );
    const keep = group[0];
    const humanSlug = group.find((c) => !/^\d+$/.test(c.slug)) || keep;
    const aliases = new Set(group.map((c) => c.key));
    aliases.delete(humanSlug.key);
    const names = group.flatMap((c) => [normalizeName(c.manifest.displayName), normalizeName(c.manifest.name), normalizeName(c.slug)]);
    out.push({
      ...keep,
      key: humanSlug.key,
      slug: humanSlug.slug,
      aliases: [...aliases],
      matchKeys: [...new Set(names.filter(Boolean))],
    });
  }
  return out;
}

function indexLocalPlugins() {
  if (Date.now() - cached.at < INDEX_TTL_MS) return cached.plugins;
  const candidates = [];
  for (const root of CACHE_ROOTS) candidates.push(...scanCandidates(root));
  cached = { at: Date.now(), plugins: dedupe(candidates).map(readContents) };
  return cached.plugins;
}

function answersTo(p, key) {
  return p.key === key || p.aliases.includes(key);
}

/**
 * Match an installed catalog row to a cached plugin. Order of trust: an
 * explicit cache key from the catalog, a directory named after the plugin id,
 * an exact normalized-name hit, then a name-containment hit only when it is
 * unambiguous. A wrong `null` is honest; a wrong hit would be acted on.
 */
function findLocalPlugin(pluginId, name, cacheKey) {
  const all = indexLocalPlugins();
  if (cacheKey) {
    const hit = all.find((p) => answersTo(p, cacheKey));
    if (hit) return hit;
  }
  const id = String(pluginId || "");
  const byId = all.find((p) => p.slug === id || p.aliases.some((a) => a.endsWith(`/${id}`)));
  if (byId) return byId;
  const norm = normalizeName(name);
  if (!norm) return null;
  const exact = all.filter((p) => p.matchKeys.includes(norm));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = all.filter((p) => p.matchKeys.some((k) => k.length >= 6 && (norm.includes(k) || k.includes(norm))));
  return loose.length === 1 ? loose[0] : null;
}

function getLocalPlugin(key) {
  return indexLocalPlugins().find((p) => answersTo(p, key)) || null;
}

/** The wire shape for a cached plugin. Internal fields (root, aliases, …) stay here. */
function toPublic(p) {
  return {
    key: p.key,
    name: p.name,
    description: p.description,
    author: p.author,
    homepage: p.homepage,
    semver: p.semver,
    logo: p.logo,
    hasReadme: p.hasReadme,
    hasMcp: p.hasMcp,
    skills: p.skills,
    agents: p.agents,
    rules: p.rules,
  };
}

/**
 * Resolve `rel` inside `root`, following symlinks, or return null if the real
 * path escapes the root or is not a regular file.
 */
function resolveInside(root, rel) {
  let realRoot;
  let full;
  try {
    realRoot = fs.realpathSync(root);
    full = fs.realpathSync(path.resolve(root, rel));
  } catch {
    return null;
  }
  if (full !== realRoot && !full.startsWith(realRoot + path.sep)) return null;
  try {
    return fs.statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

module.exports = {
  indexLocalPlugins,
  dedupe,
  compareSemver,
  findLocalPlugin,
  getLocalPlugin,
  toPublic,
  resolveInside,
  parseFrontMatter,
};
