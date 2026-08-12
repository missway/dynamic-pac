#!/usr/bin/env node
// 本地动态 PAC 服务器（国内直连可用）
//
// 为什么需要它：workers.dev 在国内直连被墙，PAC 地址必须能被客户端（浏览器/系统）
// 直接拉取，否则代理不生效。本脚本读取仓库内的 mirror/gfw.pac（或通过 /refresh
// 从 jsDelivr 拉取最新上游规则），在 127.0.0.1 提供动态 PAC。
//
// 用法:
//   node server.mjs              # 默认端口 8080
//   PORT=9090 node server.mjs    # 自定义端口
//
// PAC 地址栏填入:
//   http://127.0.0.1:8080/pac/?PROXY=127.0.0.1:7890
//
// 手动刷新规则（从 jsDelivr 拉取 zhiyi7 最新 gfw.pac）:
//   curl http://127.0.0.1:8080/refresh
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProxy, renderPac, PROXY_RE } from './worker/lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIRROR_FILE = path.join(__dirname, 'mirror', 'gfw.pac');
const UPSTREAM_URLS = [
  'https://cdn.jsdelivr.net/gh/zhiyi7/gfw-pac@master/gfw.pac',
  'https://cdn.jsdelivr.net/gh/zhiyi7/gfw-pac@main/gfw.pac',
  'https://raw.githubusercontent.com/zhiyi7/gfw-pac/master/gfw.pac',
];
const PORT = Number(process.env.PORT || 8080);

function readMirror() {
  return fs.readFileSync(MIRROR_FILE, 'utf8');
}

async function refreshMirror() {
  for (const url of UPSTREAM_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (!PROXY_RE.test(text)) continue; // 格式不匹配则跳过
      fs.writeFileSync(MIRROR_FILE, text);
      return { ok: true, from: url, bytes: text.length };
    } catch (e) {
      // 尝试下一个源
    }
  }
  return { ok: false };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/refresh') {
    const r = await refreshMirror();
    res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(r.ok ? `refreshed from ${r.from} (${r.bytes} bytes)` : 'refresh failed');
    return;
  }

  if (url.pathname !== '/pac' && url.pathname !== '/pac/') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found\n');
    return;
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
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(e.message + '\n');
    return;
  }

  let out;
  try {
    const pac = readMirror();
    out = renderPac(pac, proxy);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('mirror/gfw.pac not found or unreadable: ' + e.message + '\n');
    return;
  }

  if (out === null) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('mirror format mismatch; run /refresh\n');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ns-proxy-autoconfig; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(out);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dynamic-pac local server on http://127.0.0.1:${PORT}`);
  console.log(`PAC URL: http://127.0.0.1:${PORT}/pac/?PROXY=127.0.0.1:7890`);
});
