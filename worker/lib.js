// 纯函数模块：可被 worker 与测试共用
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
