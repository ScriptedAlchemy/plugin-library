"use strict";

const { execFile } = require("child_process");

const GBOT_BIN = process.env.GBOT_BIN || "gbot";
const TTL_MS = 20_000;
let cache = { at: 0, value: null };
let inflight = null;

function runGbot(args) {
  return new Promise((resolve, reject) => {
    execFile(
      GBOT_BIN,
      [...args, "--json"],
      { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(
            err.code === "ENOENT"
              ? `\`${GBOT_BIN}\` not found on PATH`
              : String(stderr || stdout || err.message).trim(),
          );
          e.code = err.code;
          return reject(e);
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          reject(new Error(`gbot ${args.join(" ")}: bad JSON (${parseErr.message})`));
        }
      },
    );
  });
}

/** Send one confirmed instruction directly through gbot. */
async function sendToBot(target, message) {
  const result = await runGbot(["send", target, message]);
  if (!result || typeof result !== "object") throw new Error("gbot send: expected an object");
  return result;
}

/** Boundary check on gbot output: a shape change surfaces as a 502, not an empty roster. */
function shapeList(list, what) {
  if (!Array.isArray(list)) throw new Error(`gbot ${what} list: expected an array`);
  return list.map((b) => {
    if (!b || typeof b.id !== "string" || typeof b.name !== "string") {
      throw new Error(`gbot ${what} list: entry without string id/name`);
    }
    return shapeBot(b);
  });
}

function shapeBot(b) {
  return {
    id: b.id,
    name: b.name,
    kind: b.kind || "bot",
    description: b.description || "",
    avatarColor: b.avatarColor || null,
    avatarShape: b.avatarShape || null,
    members: Array.isArray(b.members) ? b.members : undefined,
  };
}

/** Bots and groups from `gbot`, cached briefly and de-duplicated across callers. */
async function listBots({ force = false } = {}) {
  if (!force && cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    const [bots, groups] = await Promise.all([runGbot(["bots", "list"]), runGbot(["groups", "list"])]);
    const value = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      bots: shapeList(bots, "bots"),
      groups: shapeList(groups, "groups"),
    };
    cache = { at: Date.now(), value };
    return value;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

module.exports = { listBots, sendToBot };
