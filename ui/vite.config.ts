import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 为浏览器环境提供 Node.js 内置模块的最小化 polyfill。
 * Vite 在浏览器构建时会把所有 node:* 内置模块替换成同一个空对象 {}，
 * 导致 path.resolve / os.homedir 等调用在运行时抛出 TypeError。
 * 此插件拦截 node:path / node:os / node:fs 的解析，注入可安全运行的替代实现。
 */
function nodeBrowserPolyfillsPlugin(): Plugin {
  const PATH_ID = "\0virtual:node-path-polyfill";
  const OS_ID = "\0virtual:node-os-polyfill";
  const FS_ID = "\0virtual:node-fs-polyfill";
  const MODULE_ID = "\0virtual:node-module-polyfill";
  const CHILD_PROCESS_ID = "\0virtual:node-child-process-polyfill";
  const CRYPTO_ID = "\0virtual:node-crypto-polyfill";

  const NODE_PATH_IDS = new Set(["node:path", "path"]);
  const NODE_OS_IDS = new Set(["node:os", "os"]);
  const NODE_FS_IDS = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);
  const NODE_MODULE_IDS = new Set(["node:module", "module"]);
  const NODE_CHILD_PROCESS_IDS = new Set(["node:child_process", "child_process"]);
  const NODE_CRYPTO_IDS = new Set(["node:crypto", "crypto"]);
  const NODE_URL_IDS = new Set(["node:url", "url"]);
  const URL_POLYFILL_ID = "\0virtual:node-url-polyfill";

  return {
    name: "node-browser-polyfills",
    enforce: "pre",
    resolveId(id) {
      if (NODE_PATH_IDS.has(id)) return PATH_ID;
      if (NODE_OS_IDS.has(id)) return OS_ID;
      if (NODE_FS_IDS.has(id)) return FS_ID;
      if (NODE_MODULE_IDS.has(id)) return MODULE_ID;
      if (NODE_CHILD_PROCESS_IDS.has(id)) return CHILD_PROCESS_ID;
      if (NODE_CRYPTO_IDS.has(id)) return CRYPTO_ID;
      if (NODE_URL_IDS.has(id)) return URL_POLYFILL_ID;
    },
    load(id) {
      if (id === PATH_ID) {
        // 注意：用单引号拼接而非模板字符串，避免反斜杠二次转义问题
        return [
          "const sep = '/';",
          "const delimiter = ':';",
          "function _normSep(p) { return p.split('\\\\').join('/'); }",
          "function normalize(p) {",
          "  if (!p) return '.';",
          "  const s = _normSep(p);",
          "  const abs = s.startsWith('/');",
          "  const parts = s.split('/').filter(function(x){ return x && x !== '.'; });",
          "  const out = [];",
          "  for (let i = 0; i < parts.length; i++) {",
          "    if (parts[i] === '..') out.pop(); else out.push(parts[i]);",
          "  }",
          "  const r = out.join('/');",
          "  return (abs ? '/' : '') + (r || '.');",
          "}",
          "function join() {",
          "  const args = Array.prototype.slice.call(arguments);",
          "  return normalize(args.filter(Boolean).join('/'));",
          "}",
          "function resolve() {",
          "  const args = Array.prototype.slice.call(arguments);",
          "  let r = '';",
          "  for (let i = args.length - 1; i >= 0; i--) {",
          "    const p = args[i]; if (!p) continue;",
          "    r = r ? p + '/' + r : p;",
          "    if (_normSep(p).startsWith('/')) break;",
          "  }",
          "  if (!_normSep(r).startsWith('/')) r = '/' + r;",
          "  return normalize(r);",
          "}",
          "function dirname(p) {",
          "  if (!p) return '.';",
          "  const parts = _normSep(p).split('/');",
          "  parts.pop();",
          "  return parts.join('/') || '/';",
          "}",
          "function basename(p, ext) {",
          "  const b = _normSep(p).split('/').pop() || '';",
          "  if (ext && b.endsWith(ext)) return b.slice(0, -ext.length);",
          "  return b;",
          "}",
          "function extname(p) {",
          "  const b = basename(p);",
          "  const i = b.lastIndexOf('.');",
          "  return i > 0 ? b.slice(i) : '';",
          "}",
          "function isAbsolute(p) { return typeof p === 'string' && _normSep(p).startsWith('/'); }",
          "function relative(from, to) { return to; }",
          "const pathModule = { sep, delimiter, normalize, join, resolve, dirname, basename, extname, isAbsolute, relative };",
          "export { sep, delimiter, normalize, join, resolve, dirname, basename, extname, isAbsolute, relative };",
          "export default pathModule;",
        ].join("\n");
      }
      if (id === OS_ID) {
        return `
function homedir() { return '/'; }
function tmpdir() { return '/tmp'; }
function platform() { return 'browser'; }
function type() { return 'Browser'; }
function hostname() { return 'localhost'; }
function cpus() { return []; }
function freemem() { return 0; }
function totalmem() { return 0; }
const EOL = '\\n';
const osModule = { homedir, tmpdir, platform, type, hostname, cpus, freemem, totalmem, EOL };
export { homedir, tmpdir, platform, type, hostname, cpus, freemem, totalmem, EOL };
export default osModule;
`;
      }
      if (id === FS_ID) {
        // fs は Browser では動作しないので、安全に失敗する空実装を返す
        return `
function noop() { return null; }
function noopBool() { return false; }
const promises = {
  readFile: async () => { throw new Error('fs not available in browser'); },
  writeFile: async () => { throw new Error('fs not available in browser'); },
  access: async () => { throw new Error('fs not available in browser'); },
  mkdir: async () => { throw new Error('fs not available in browser'); },
  readdir: async () => { throw new Error('fs not available in browser'); },
  stat: async () => { throw new Error('fs not available in browser'); },
};
function existsSync() { return false; }
function readFileSync() { return null; }
function writeFileSync() {}
function mkdirSync() {}
const fsModule = { existsSync, readFileSync, writeFileSync, mkdirSync, promises };
export { existsSync, readFileSync, writeFileSync, mkdirSync, promises };
export default fsModule;
`;
      }
      if (id === MODULE_ID) {
        return `
export function createRequire(url) {
  return function require(id) {
    throw new Error('require("' + id + '") is not available in browser');
  };
}
export const builtinModules = [];
export class Module {
  constructor(id) { this.id = id; this.exports = {}; }
  static _resolveFilename(id) { return id; }
  static _cache = {};
  static builtinModules = [];
}
const moduleObj = { createRequire, builtinModules, Module };
export default moduleObj;
`;
      }
      if (id === URL_POLYFILL_ID) {
        return `
export function fileURLToPath(url) {
  if (!url) return '';
  const s = typeof url === 'string' ? url : url.href || String(url);
  if (s.startsWith('file:///')) return '/' + s.slice(8);
  if (s.startsWith('file://')) return '/' + s.slice(7);
  return s;
}
export function pathToFileURL(p) {
  const href = 'file:///' + (p || '').replace(/\\\\/g, '/').replace(/^\\//, '');
  return new URL(href);
}
export function format(urlObj) { return typeof urlObj === 'string' ? urlObj : urlObj.href || ''; }
export function parse(s) { try { return new URL(s); } catch { return {}; } }
const urlModule = { fileURLToPath, pathToFileURL, format, parse };
export default urlModule;
`;
      }
      if (id === CHILD_PROCESS_ID) {
        return `
export function exec() { throw new Error('child_process not available in browser'); }
export function execSync() { throw new Error('child_process not available in browser'); }
export function spawn() { throw new Error('child_process not available in browser'); }
export function spawnSync() { throw new Error('child_process not available in browser'); }
const cp = { exec, execSync, spawn, spawnSync };
export default cp;
`;
      }
      if (id === CRYPTO_ID) {
        return `
export function randomBytes(n) {
  const arr = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr);
  return arr;
}
export function createHash(alg) {
  return { update() { return this; }, digest() { return ''; } };
}
export function randomUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
const cryptoModule = { randomBytes, createHash, randomUUID };
export default cryptoModule;
`;
      }
    },
  };
}

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

export default defineConfig(() => {
  const envBase = process.env.OPENCLAW_CONTROL_UI_BASE_PATH?.trim();
  const base = envBase ? normalizeBase(envBase) : "./";
  return {
    base,
    publicDir: path.resolve(here, "public"),
    //todo 解决vite.config.ts 里完全没有 process 的 polyfill 配置，而且也没有引入任何 node polyfill 插件前端页面无法加载问题
    define: {
      "process.env": "{}",
      "process.cwd": "(() => '/')",
      "process.platform": JSON.stringify("browser"),
      "process.version": JSON.stringify("v0.0.0"),
      "process.versions": "{}",
      "process.pid": "0",
      "process.ppid": "0",
      "process.argv": "[]",
      "process.exit": "((code) => { throw new Error('process.exit(' + code + ') called in browser'); })",
      "process.hrtime": "(() => [0, 0])",
      "process.nextTick": "((fn, ...args) => Promise.resolve().then(() => fn(...args)))",
    },
    optimizeDeps: {
      include: ["lit/directives/repeat.js"],
    },
    build: {
      outDir: path.resolve(here, "../dist/control-ui"),
      emptyOutDir: true,
      sourcemap: true,
      // Keep CI/onboard logs clean; current control UI chunking is intentionally above 500 kB.
      chunkSizeWarningLimit: 1024,
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
    plugins: [
      nodeBrowserPolyfillsPlugin(),
      {
        name: "control-ui-dev-stubs",
        configureServer(server) {
          server.middlewares.use("/__openclaw/control-ui-config.json", (_req, res) => {
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                basePath: "/",
                assistantName: "",
                assistantAvatar: "",
              }),
            );
          });
        },
      },
    ],
  };
});
