# dynamic-pac

动态 PAC 端点。基于 [zhiyi7/gfw-pac](https://github.com/zhiyi7/gfw-pac) 的最新规则，通过在 URL 中带上你的代理地址，即可在 PAC 地址栏填入一个**动态地址**使用：

```
https://<你的-worker>/pac/?PROXY=127.0.0.1:7890
```

规则每周四由 GitHub Actions 从上游自动镜像，无需手动更新；代理地址由你通过 URL 参数注入，互不干扰。

## 快速使用（两种方式）

### 方式一：本地 PAC 服务器（国内直连可用，无需域名）

> `workers.dev` 域名在国内**直连不可达**，浏览器/系统拉取 PAC 走的是直连，因此默认的 Worker 端点在国内无法使用。本地服务器读本仓库的 `mirror/gfw.pac` 并在 `127.0.0.1` 提供服务，永远可达。

```bash
node server.mjs            # 默认端口 8080；PORT=9090 node server.mjs 自定义端口
```

PAC 地址栏填入：

```
http://127.0.0.1:8080/pac/?PROXY=127.0.0.1:7890
```

手动拉取最新上游规则（jsDelivr CDN，国内可达）：

```
curl http://127.0.0.1:8080/refresh
```

### 方式二：Cloudflare Worker（需绑定自定义域名）

部署后填入：

```
https://<你的域名>/pac/?PROXY=127.0.0.1:7890
```

`workers.dev` 默认域名在国内不稳定/不可达，务必绑定自定义域名后再用于实际使用。

## 原理

```
PAC 地址栏: https://<worker>.workers.dev/pac/?PROXY=127.0.0.1:7890
      │  Cloudflare Worker
      │   ├─ 解析/归一化/校验 PROXY (防注入)
      │   ├─ 拉取 本仓库 mirror/gfw.pac (1 小时边缘缓存)
      │   └─ 失败 → 内嵌 snapshot.js 兜底 → 替换 var proxy 注入 → 返回(no-store)
      ▼
   本仓库 mirror/gfw.pac  ← 每周四由 GitHub Actions 从 zhiyi7/gfw-pac 同步
```

- 浏览器在 PAC 沙箱中无法读取 URL 查询参数（无 `location`/`fetch`），所以需要一个小型服务端做注入，这里选用 Cloudflare Workers（免费、无需备案的静态仓库之外的动态层）。
- 镜像机制保证上游停更/被删后，本仓库仍保留最后一份可用规则。

## 快速开始

### 1. Fork / 克隆后准备

需要：GitHub 仓库 + Cloudflare 账号。

### 2. 部署 Worker

**方式 A：本地 wrangler（推荐用于首次）**

```bash
# 修改 worker/wrangler.toml 里的 MIRROR_URL 指向你自己的仓库，然后：
cd worker
npx wrangler login
npx wrangler deploy
```

**方式 B：GitHub Actions**

仓库 → Settings → Secrets and variables → Actions 添加：

- `CF_API_TOKEN`（Cloudflare → My Profile → API Tokens → Create Token → `Edit Cloudflare Workers`，权限 `Workers Scripts: Edit`）
- `CF_ACCOUNT_ID`（Dashboard 首页 URL 中的账号 ID）

然后手动触发 Actions → `Deploy Worker`，或修改 `worker/**` 后自动部署。

### 3. 使用

在系统/浏览器的 PAC 地址栏填入：

| 目的 | 地址 |
| --- | --- |
| HTTP 代理 | `https://<worker>.workers.dev/pac/?PROXY=127.0.0.1:7890` |
| SOCKS5 代理 | `https://<worker>.workers.dev/pac/?PROXY=SOCKS5%20127.0.0.1:1080` |
| 多代理（; 分隔，按顺序回退） | `https://<worker>.workers.dev/pac/?PROXY=PROXY%20127.0.0.1:7890;SOCKS5%20127.0.0.1:1080` |
| 缺省（不填 PROXY，默认 127.0.0.1:7890） | `https://<worker>.workers.dev/pac/` |

参数说明：

- `PROXY=127.0.0.1:7890`：裸地址自动补 `PROXY ` 前缀。
- `PROXY=PROXY 127.0.0.1:7890`：已带协议则原样使用。
- 多个代理用 `;` 分隔（URL 中空格请编码为 `%20` 或 `+`）。
- 非法参数返回 `400`；不存在的路径返回 `404`；上游格式变化返回 `502`。

> 提示：`workers.dev` 域名在国内可能不稳定，可在 Cloudflare 绑定自定义域名后使用
> `https://<你的域名>/pac/?PROXY=...`。

## 规则更新

`mirror/gfw.pac` 与 `worker/snapshot.js` 由 `.github/workflows/update-mirror.yml` 每周四 01:30 UTC 自动从 `zhiyi7/gfw-pac` 同步并提交。也可以在该 Actions 页手动 `Run workflow`。

规则在 Worker 侧有 1 小时边缘缓存，上游更新后最多 1 小时生效。

## 目录结构

```
├── server.mjs                 # 本地 PAC 服务器（国内直连可用，读 mirror/ 并可 /refresh）
├── worker/                    # Cloudflare Worker
│   ├── wrangler.toml          # 部署配置 + MIRROR_URL（指向本仓库镜像）
│   ├── index.js               # 入口：参数解析 → 拉镜像 → 注入 → 返回
│   ├── lib.js                 # 纯函数：normalizeProxy / renderPac（可单测）
│   └── snapshot.js            # 内嵌兜底（由同步工作流生成）
├── mirror/gfw.pac             # 上游同步的镜像 PAC（每周自动更新）
├── .github/workflows/
│   ├── update-mirror.yml      # 每周同步镜像 + 刷新快照
│   └── deploy-worker.yml      # wrangler 部署
└── test_worker.mjs            # 本地测试：node test_worker.mjs
```

## 本地测试

```bash
node test_worker.mjs
```

覆盖：代理参数归一化/校验（防注入）、注入渲染、以及用 Node `vm` 模拟浏览器 PAC 环境执行 `FindProxyForURL`，断言国内域名直连、国外域名走代理。

## 注意事项

- **公开仓库**：Worker 需要匿名读取 `mirror/gfw.pac`（`raw.githubusercontent.com`），因此镜像文件所在仓库需为 public。
- **依赖上游**：规则来自 zhiyi7/gfw-pac。若其停更，本仓库镜像会保留最后一份，可手动替换 `mirror/gfw.pac` 继续更新。
- 自定义域名部署后，记得在 Worker 的路由/自定义域设置里把该域名指向此 Worker。

## License

MIT
