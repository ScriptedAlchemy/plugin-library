import * as __rspack_external_node_child_process_cd435d64 from "node:child_process";
import * as __rspack_external_node_fs_1b05aee1 from "node:fs";
import * as __rspack_external_node_path_806ed179 from "node:path";
import * as __rspack_external_node_url_3991086a from "node:url";
var __webpack_modules__ = ({
"node:child_process"(module) {

module.exports = __rspack_external_node_child_process_cd435d64;


},
"node:fs"(module) {

module.exports = __rspack_external_node_fs_1b05aee1;


},
"node:path"(module) {

module.exports = __rspack_external_node_path_806ed179;


},
"node:url"(module) {

module.exports = __rspack_external_node_url_3991086a;


},
"./bin/plugin-library.mjs"(__webpack_module__, __unused_rspack___webpack_exports__, __webpack_require__) {
__webpack_require__.a(__webpack_module__, async function (__rspack_load_async_deps, __rspack_async_done) { try {
/* import */ var node_child_process__rspack_import_0 = __webpack_require__("node:child_process");
/* import */ var node_fs__rspack_import_1 = __webpack_require__("node:fs");
/* import */ var node_path__rspack_import_2 = __webpack_require__("node:path");
/* import */ var node_url__rspack_import_3 = __webpack_require__("node:url");
/**
 * plugin-library <start|stop|status|open [query]> [--json] [--browser] [--port N]
 *
 * `start` is idempotent: if the server already answers on the port it is left
 * alone, otherwise one is spawned detached and this process waits for health.
 * `open` starts, resolves `query` (plugin name, id, or skill id) to a deep link,
 * prints it, and with --browser hands it to the OS browser.
 */ 



const ROOT = node_path__rspack_import_2["default"].resolve(node_path__rspack_import_2["default"].dirname((0,node_url__rspack_import_3.fileURLToPath)(import.meta.url)), "..");
const PID_FILE = node_path__rspack_import_2["default"].join(ROOT, "logs", "server.pid");
const LOG_FILE = node_path__rspack_import_2["default"].join(ROOT, "logs", "server.out");
const SERVER_ENTRY = node_fs__rspack_import_1["default"].existsSync(node_path__rspack_import_2["default"].join(ROOT, "scripts", "plugin-library-server.mjs")) ? node_path__rspack_import_2["default"].join(ROOT, "scripts", "plugin-library-server.mjs") : node_path__rspack_import_2["default"].join(ROOT, "server.js");
const args = process.argv.slice(2);
const flag = (name)=>{
    const i = args.indexOf(name);
    if (i === -1) return false;
    args.splice(i, 1);
    return true;
};
const option = (name, fallback)=>{
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
};
const json = flag("--json");
const browser = flag("--browser");
const port = Number(option("--port", process.env.PORT || 8787));
const command = args.shift() || "open";
const query = args.join(" ").trim();
const base = `http://127.0.0.1:${port}`;
const out = (obj)=>{
    if (json) console.log(JSON.stringify(obj));
    else console.log(obj.url || obj.message || JSON.stringify(obj));
};
async function healthy() {
    try {
        const r = await fetch(`${base}/api/library`, {
            signal: AbortSignal.timeout(1500)
        });
        return r.ok;
    } catch  {
        return false;
    }
}
async function start() {
    if (await healthy()) return {
        started: false,
        pid: readPid()
    };
    node_fs__rspack_import_1["default"].mkdirSync(node_path__rspack_import_2["default"].dirname(LOG_FILE), {
        recursive: true
    });
    const log = node_fs__rspack_import_1["default"].openSync(LOG_FILE, "a");
    const child = (0,node_child_process__rspack_import_0.spawn)(process.execPath, [
        SERVER_ENTRY
    ], {
        cwd: ROOT,
        env: {
            ...process.env,
            PORT: String(port)
        },
        detached: true,
        stdio: [
            "ignore",
            log,
            log
        ]
    });
    child.unref();
    node_fs__rspack_import_1["default"].writeFileSync(PID_FILE, String(child.pid));
    for(let i = 0; i < 40; i++){
        if (await healthy()) return {
            started: true,
            pid: child.pid
        };
        await new Promise((r)=>setTimeout(r, 150));
    }
    throw new Error(`server did not become healthy on ${base}; see ${LOG_FILE}`);
}
function readPid() {
    try {
        return Number(node_fs__rspack_import_1["default"].readFileSync(PID_FILE, "utf8"));
    } catch  {
        return null;
    }
}
function stop() {
    const pid = readPid();
    if (!pid) return {
        stopped: false,
        message: "no pidfile; nothing to stop"
    };
    try {
        process.kill(pid, "SIGTERM");
        node_fs__rspack_import_1["default"].rmSync(PID_FILE, {
            force: true
        });
        return {
            stopped: true,
            pid
        };
    } catch (e) {
        node_fs__rspack_import_1["default"].rmSync(PID_FILE, {
            force: true
        });
        return {
            stopped: false,
            pid,
            message: e.code === "ESRCH" ? "process already gone" : e.message
        };
    }
}
/** Plugin name / id / skill id → hash route. Exact hits first, then substring. */ async function resolveHash(q) {
    if (!q) return "";
    const lib = await (await fetch(`${base}/api/library`)).json();
    const all = [
        ...lib.installed,
        ...lib.marketplace
    ];
    const norm = (s)=>String(s || "").toLowerCase();
    const nq = norm(q);
    const byId = all.find((p)=>p.plugin_id === q);
    if (byId) return `#/p/${byId.plugin_id}`;
    for (const p of lib.installed){
        const skill = (p.local?.skills || []).find((s)=>norm(s.id) === nq || norm(s.name) === nq);
        if (skill) return `#/p/${p.plugin_id}/s/${encodeURIComponent(skill.id)}`;
    }
    const byName = all.find((p)=>norm(p.name) === nq) || all.find((p)=>norm(p.name).includes(nq));
    if (byName) return `#/p/${byName.plugin_id}`;
    for (const p of lib.installed){
        const skill = (p.local?.skills || []).find((s)=>norm(s.id).includes(nq));
        if (skill) return `#/p/${p.plugin_id}/s/${encodeURIComponent(skill.id)}`;
    }
    return "";
}
function openInBrowser(url) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    return new Promise((resolve)=>(0,node_child_process__rspack_import_0.execFile)(opener, [
            url
        ], ()=>resolve()));
}
try {
    switch(command){
        case "start":
            {
                const r = await start();
                out({
                    ok: true,
                    url: `${base}/`,
                    ...r,
                    message: r.started ? `started on ${base}` : `already running on ${base}`
                });
                break;
            }
        case "stop":
            out({
                ok: true,
                ...stop()
            });
            break;
        case "status":
            {
                const up = await healthy();
                out({
                    ok: true,
                    running: up,
                    url: `${base}/`,
                    pid: readPid(),
                    message: up ? `running on ${base}` : "not running"
                });
                break;
            }
        case "open":
            {
                const r = await start();
                const hash = await resolveHash(query);
                const url = `${base}/${hash}`;
                if (browser) await openInBrowser(url);
                out({
                    ok: true,
                    url,
                    resolved: Boolean(hash) || !query,
                    query: query || null,
                    started: r.started
                });
                break;
            }
        default:
            console.error(`unknown command: ${command}\nusage: plugin-library <start|stop|status|open [query]> [--json] [--browser] [--port N]`);
            process.exit(2);
    }
} catch (e) {
    if (json) console.log(JSON.stringify({
        ok: false,
        error: e.message
    }));
    else console.error(e.message);
    process.exit(1);
}

__rspack_async_done();
} catch(e) { __rspack_async_done(e); } }, 1);

},

});
// The module cache
var __webpack_module_cache__ = {};

// The require function
function __webpack_require__(moduleId) {

// Check if module is in cache
var cachedModule = __webpack_module_cache__[moduleId];
if (cachedModule !== undefined) {
return cachedModule.exports;
}
// Create a new module (and put it into the cache)
var module = (__webpack_module_cache__[moduleId] = {
exports: {}
});
// Execute the module function
__webpack_modules__[moduleId](module, module.exports, __webpack_require__);

// Return the exports of the module
return module.exports;

}

// expose the module cache
__webpack_require__.c = __webpack_module_cache__;

// webpack/runtime/async_module
(() => {
var hasSymbol = typeof Symbol === "function";
var rspackQueues = hasSymbol ? Symbol("rspack queues") : "__rspack_queues";
var rspackExports = __webpack_require__.aE = hasSymbol ? Symbol("rspack exports") : "__webpack_exports__";
var rspackError = hasSymbol ? Symbol("rspack error") : "__rspack_error";
var rspackDone = hasSymbol ? Symbol("rspack done") : "__rspack_done";
var rspackDefer = __webpack_require__.zS = hasSymbol ? Symbol("rspack defer") : "__rspack_defer";
__webpack_require__.zT = (asyncDeps) => {
	var hasUnresolvedAsyncSubgraph = asyncDeps.some((id) => {
		var cache = __webpack_module_cache__[id];
		return !cache || cache[rspackDone] === false;
	});
	if (hasUnresolvedAsyncSubgraph) {
		return ({ then(onFulfilled, onRejected) { return Promise.all(asyncDeps.map(__webpack_require__)).then(onFulfilled, onRejected) } });
	}
}
var resolveQueue = (queue) => {
	if (queue && queue.d < 1) {
		queue.d = 1;
    	queue.forEach((fn) => (fn.r--));
		queue.forEach((fn) => (fn.r-- ? fn.r++ : fn()));
	}
}
var wrapDeps = (deps) => {
	return deps.map((dep) => {
		if (dep !== null && typeof dep === "object") {
			if(!dep[rspackQueues] && dep[rspackDefer]) {
				var asyncDeps = __webpack_require__.zT(dep[rspackDefer]);
				if (asyncDeps) {
					var d = dep;
					dep = {
						then(onFulfilled, onRejected) {
							asyncDeps.then(() => (onFulfilled(d)), onRejected);
						}
					};
				} else return dep;
			}
			if (dep[rspackQueues]) return dep;
			if (dep.then) {
				var queue = [];
				queue.d = 0;
				dep.then((r) => {
					obj[rspackExports] = r;
					resolveQueue(queue);
				},(e) => {
					obj[rspackError] = e;
					resolveQueue(queue);
				});
				var obj = {};
				obj[rspackDefer] = false;
				obj[rspackQueues] = (fn) => (fn(queue));
				return obj;
			}
		}
		var ret = {};
		ret[rspackQueues] = () => {};
		ret[rspackExports] = dep;
		return ret;
	});
};
__webpack_require__.a = (module, body, hasAwait, useModuleExports) => {
	var queue;
	hasAwait && ((queue = []).d = -1);
	var depQueues = new Set();
	var exports = module.exports;
	var currentDeps;
	var outerResolve;
	var reject;
	var promise = new Promise((resolve, rej) => {
		reject = rej;
		outerResolve = resolve;
	});
	promise[rspackExports] = exports;
	promise[rspackQueues] = (fn) => { queue && fn(queue), depQueues.forEach(fn), promise["catch"](() => {}); };
	module.exports = promise;
	var asyncModule = module;
	if (useModuleExports) {
		asyncModule = Object.create(module);
		asyncModule.exports = exports;
	}
	var handle = (deps) => {
		currentDeps = wrapDeps(deps);
		var fn;
		var getResult = () => {
			return currentDeps.map((d) => {
				if(d[rspackDefer]) return d;
				if (d[rspackError]) throw d[rspackError];
				return d[rspackExports];
			});
		}
		var promise = new Promise((resolve) => {
			fn = () => (resolve(getResult));
			fn.r = 0;
			var fnQueue = (q) => (q !== queue && !depQueues.has(q) && (depQueues.add(q), q && !q.d && (fn.r++, q.push(fn))));
			currentDeps.map((dep) => (dep[rspackDefer] || dep[rspackQueues](fnQueue)));
		});
		return fn.r ? promise : getResult();
	};
	var done = (err) => ((err ? reject(promise[rspackError] = err) : (useModuleExports && (exports = promise[rspackExports] = asyncModule.exports), outerResolve(exports))), resolveQueue(queue), promise[rspackDone] = true);
	body(handle, done, asyncModule);
	queue && queue.d < 0 && (queue.d = 0);
};

})();
// module cache are used so entry inlining is disabled
// startup
// Load entry module and return exports
var __webpack_exports__ = __webpack_require__("./bin/plugin-library.mjs");
__webpack_exports__ = await __webpack_exports__;
