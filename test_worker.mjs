#!/usr/bin/env node
// 本地验证脚本（不依赖网络，镜像文件在仓库内）
// 运行: node test_worker.mjs

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProxy, renderPac } from './worker/lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mirrorPac = fs.readFileSync(path.join(__dirname, 'mirror', 'gfw.pac'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log('PASS  ' + name);
  } else {
    failed++;
    console.log('FAIL  ' + name + (extra ? '  -> ' + extra : ''));
  }
}

// ---- normalizeProxy 单测 ----
check('裸地址自动补 PROXY', normalizeProxy('127.0.0.1:7890') === 'PROXY 127.0.0.1:7890', normalizeProxy('127.0.0.1:7890'));
check('带协议原样保留', normalizeProxy('PROXY 192.168.1.1:8080') === 'PROXY 192.168.1.1:8080');
check('SOCKS5', normalizeProxy('SOCKS5 127.0.0.1:1080') === 'SOCKS5 127.0.0.1:1080');
check('多代理 ; 分隔', normalizeProxy('127.0.0.1:7890;SOCKS5 127.0.0.1:1080') === 'PROXY 127.0.0.1:7890; SOCKS5 127.0.0.1:1080');
check('DIRECT 保留', normalizeProxy('DIRECT') === 'DIRECT');
check('缺省默认', normalizeProxy('') === 'PROXY 127.0.0.1:7890');
check('非法输入抛错', (() => { try { normalizeProxy('PROXY 1.2.3.4:80";evil()'); return false; } catch { return true; } })());
check('分号尾部拒绝', (() => { try { normalizeProxy('1.2.3.4:80;\\'); return false; } catch { return true; } })());

// ---- 渲染 ----
const injected = renderPac(mirrorPac, 'PROXY 127.0.0.1:7890');
check('替换锚点命中', injected !== null);
check('注入值正确', /var proxy = "PROXY 127.0.0.1:7890";/.test(injected.split('\n')[0]), injected.split('\n')[0]);
check('其他内容未破坏', /var direct = 'DIRECT';/.test(injected));

// ---- PAC 逻辑执行测试（复用上游 mock 环境） ----
const mockFunctions = `
function isPlainHostName(host) {
  if (/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host)) return false;
  if (host.indexOf(':') !== -1) return false;
  return host.indexOf('.') === -1;
}
function dnsResolve(host) {
  if (host === 'baidu.com') return '39.156.66.10';
  if (host === 'google.com.hk') return '142.251.43.199';
  if (host === '8.8.8.8') return '8.8.8.8';
  return undefined;
}
var allowAlert = false;
function alert() {}
`;

const sandbox = { console, allowAlert: false };
vm.runInNewContext(mockFunctions + '\n\n' + injected, sandbox, { timeout: 5000 });
const FindProxyForURL = sandbox.FindProxyForURL;
check('FindProxyForURL 已定义', typeof FindProxyForURL === 'function');

const cases = [
  ['baidu.com', 'DIRECT'],
  ['gov.cn', 'DIRECT'],
  ['qq.com', 'DIRECT'],
  ['google.com', 'PROXY'],
  ['youtube.com', 'PROXY'],
  ['github.com', 'PROXY'],
  ['8.8.8.8', 'PROXY'],
  ['39.156.66.10', 'DIRECT'],
  ['127.0.0.1', 'DIRECT'],
];
for (const [host, expect] of cases) {
  const r = String(FindProxyForURL('', host));
  check(`${host} -> ${expect}`, r.includes(expect), r);
}

console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
process.exit(failed === 0 ? 0 : 1);
