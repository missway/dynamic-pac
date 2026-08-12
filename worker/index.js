// 动态 PAC Worker（方案 B+）
//
// 工作方式：
//   1. 读取查询参数 PROXY（兼容小写 proxy），归一化并校验，防注入。
//   2. 拉取本仓库 mirror/gfw.pac（每周由 GitHub Actions 从 zhiyi7/gfw-pac 同步），失败时用内嵌快照。
//   3. 注入代理地址 + ES5 转换（兼容 IE10/Windows7 等旧 PAC 引擎）后返回。
//
// 规则源保持最新：mirror/gfw.pac 每周四自动更新，worker 侧 1 小时边缘缓存。
import { SNAPSHOT } from './snapshot.js';
import { buildPac, normalizeProxy, PROXY_RE, PAC_PATHS } from './lib.js';

const DEFAULT_MIRROR_URL = 'https://raw.githubusercontent.com/missway/dynamic-pac/main/mirror/gfw.pac';

async function getPac(env) {
  const mirror = (env && env.MIRROR_URL) || DEFAULT_MIRROR_URL;
  try {
    const res = await fetch(mirror, { cf: { cacheTtl: 3600 } });
    if (res.ok) {
      const text = await res.text();
      if (PROXY_RE.test(text)) return text;
    }
  } catch (e) {
    // fall through to snapshot
  }
  return SNAPSHOT;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response(
        'Dynamic PAC for gfw-pac.\n\n' +
          'Usage: /dynamic-pac/?PROXY=127.0.0.1:7890\n' +
          'Multi:  /dynamic-pac/?PROXY=PROXY%20127.0.0.1:7890;SOCKS5%20127.0.0.1:1080\n',
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    if (!PAC_PATHS.includes(url.pathname)) {
      return new Response('404 Not Found', { status: 404 });
    }

    let proxy;
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() === 'proxy') {
        proxy = value;
        break;
      }
    }
    try {
      proxy = normalizeProxy(proxy);
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }

    const pac = await getPac(env);
    const out = buildPac(pac, proxy);
    if (out === null) {
      return new Response('upstream pac format changed; mirror needs refresh', { status: 502 });
    }

    return new Response(out, {
      headers: {
        'Content-Type': 'application/x-ns-proxy-autoconfig; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  },
};
