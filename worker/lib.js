// 纯函数模块：可被 worker / 本地 server / 测试共用
export const DEFAULT_PROXY = '127.0.0.1:7890';
export const PROXY_RE = /var proxy = "PROXY [^"]*";/;
const PROXY_SCHEMES = /^(PROXY|SOCKS5|SOCKS4|SOCKS|HTTPS|HTTP|DIRECT)\s+[A-Za-z0-9.\-_:]+$/i;
const SCHEME_PREFIX = /^(PROXY|SOCKS5|SOCKS4|SOCKS|HTTPS|HTTP)\s/i;

// 归一化用户输入的代理串，支持：
//   ?PROXY=127.0.0.1:7890                         → "PROXY 127.0.0.1:7890"
//   ?PROXY=PROXY+127.0.0.1:7890                   → 原样
//   ?PROXY=127.0.0.1:7890;SOCKS5+127.0.0.1:1080   → 多代理（; 分隔）
export function normalizeProxy(raw) {
  if (!raw) raw = DEFAULT_PROXY;
  const parts = String(raw)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('empty proxy');
  return parts
    .map((p) => {
      if (/^DIRECT$/i.test(p)) return 'DIRECT';
      if (!SCHEME_PREFIX.test(p)) p = 'PROXY ' + p;
      if (!PROXY_SCHEMES.test(p)) throw new Error('invalid proxy: ' + p);
      return p;
    })
    .join('; ');
}

// 将代理注入到上游 pac 中。返回 null 表示锚点未命中（上游格式可能变化）。
export function renderPac(pac, proxy) {
  const out = pac.replace(PROXY_RE, () => 'var proxy = ' + JSON.stringify(proxy) + ';');
  return out === pac ? null : out;
}

// ============ ES5 兼容转换（IE10 / Windows7 等旧 PAC 引擎需要） ============
// 上游模板使用 ES6（new Map / String.endsWith / 默认参数），在 IE 的 JScript
// 引擎里会导致整个 PAC 解析失败。这里做最小化转换：
//   1) 注入 ES5 polyfill（Map / endsWith / some，仅在缺失时生效）
//   2) 改写 debug 的默认参数签名
const DEBUG_SIG_RE = /function debug\(msg,\s*host='',\s*ip=''\)\s*\{/;
const DEBUG_SIG_ES5 =
  'function debug(msg, host, ip) {\n' +
  "    if (host === undefined) host = '';\n" +
  "    if (ip === undefined) ip = '';\n";
const PROXY_LINE_RE = /var proxy = "[^"]*";/;

const ES5_POLYFILLS = `\n
// ---- ES5 polyfills injected by dynamic-pac (required by IE10/Windows7 PAC engine) ----
if (typeof String.prototype.endsWith !== 'function') {
  String.prototype.endsWith = function (suffix) {
    return this.length >= suffix.length && this.lastIndexOf(suffix) === this.length - suffix.length;
  };
}
if (typeof Array.prototype.some !== 'function') {
  Array.prototype.some = function (fn, ctx) {
    for (var i = 0; i < this.length; i++) {
      if (i in this && fn.call(ctx, this[i], i, this)) return true;
    }
    return false;
  };
}
if (typeof Map === 'undefined') {
  var Map = function () { this._k = []; this._v = []; };
  Map.prototype._i = function (k) { for (var i = 0; i < this._k.length; i++) if (this._k[i] === k) return i; return -1; };
  Map.prototype.set = function (k, v) { var i = this._i(k); if (i === -1) { this._k.push(k); this._v.push(v); } else { this._v[i] = v; } return this; };
  Map.prototype.get = function (k) { var i = this._i(k); return i === -1 ? undefined : this._v[i]; };
  Map.prototype.has = function (k) { return this._i(k) !== -1; };
  if (typeof Object.defineProperty === 'function') {
    Object.defineProperty(Map.prototype, 'size', { get: function () { return this._k.length; } });
  }
}
`;

// 对已注入代理的 pac 做 ES5 转换。若 debug 签名已不存在（上游改动），仍返回 polyfill 注入结果。
export function applyEs5Compat(pac) {
  const withPolyfill = pac.replace(PROXY_LINE_RE, (m) => m + ES5_POLYFILLS);
  return withPolyfill.replace(DEBUG_SIG_RE, () => DEBUG_SIG_ES5);
}

// 完整构建：注入代理 + ES5 转换。返回 null 表示注入锚点未命中。
export function buildPac(pac, proxy) {
  const injected = renderPac(pac, proxy);
  if (injected === null) return null;
  return applyEs5Compat(injected);
}

// worker / server 共同接受的 PAC 路径
export const PAC_PATHS = ['/pac', '/pac/', '/dynamic-pac', '/dynamic-pac/'];
