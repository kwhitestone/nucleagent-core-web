# nucleagent-core-web

NucleAgent 对话核心前端。**可独立构建和部署**，
由主壳 `nucleagent-web` 以 iframe 方式嵌入。

| | |
|---|---|
| 承载路由 | /chat、/creation、/tasks、管理后台 |
| 后端 | `nucleagent-core` |

## 为什么是独立仓库

这份代码原先住在 `nucleagent-core/app/src/web/`，和后端同仓，构建时依赖
workspace 根目录的相对路径。本仓的构建上下文是仓库根目录，不需要外层 workspace。
旧目录的保留、同步关系和唯一源码归属仍需单独决策，本说明不宣称源码迁移完成。

唯一的跨仓库依赖 `@prism-fusion/plugin-runtime` 原本是
`file:../../../../prism-fusion/src/web/src/plugin`，现已 vendor 进
`src/vendor/prism-fusion-plugin-runtime/`，来源 commit 与取舍见该目录下的
`VENDORED.md`。

## 本地开发

```bash
npm install
npm run dev      # 默认 26688 端口
npm run build    # vue-tsc 类型检查 + vite 构建
npm run test:unit
```

开发服务器参数参考 `.env.example`。浏览器入口也需要 HTTPS 和同源的
`/runtime-config.json`，不会再从 `.env.local` 烤入地址或回退到 localhost。
本地调试可使用开发域名与 HTTPS 反向代理，提供同样的公开配置文件。

## 运行期配置

镜像不含环境地址默认值，也不接收 `VITE_*` build args。
容器启动时，`docker-entrypoint.d/40-runtime-config.sh` 将明确配置的公开地址写入
`/runtime-config.json`，浏览器校验本站 origin 和环境后才加载应用。
所有必填变量、内外域名处理和失败规则见 [配置契约](docs/browser-runtime-config.md)。
秘密、API key 和用户凭据不得进入此配置。

## 容器

```bash
docker build -t nucleagent-core-web .
docker run -p 8080:8080 --env-file runtime.env nucleagent-core-web
```

监听 8080，`/healthz` 返回 200。

nginx 反代 /api/ → https://backend.example.test/api/，
让前端调后端保持**同源**，因此不触发 CORS 预检，后端也不必维护一份随本域名变动的
白名单。未命中反代的 API 路径显式返回 404，不会 fall through 到 `try_files`
把 SPA 的 `index.html` 当成 200 响应回去 —— 那种「假成功」最难排查。

`SHELL_ORIGIN` 管 CSP，`VITE_SHELL_URL` 管浏览器消息来源；二者需同时指向目标环境。
部署目标、组织配置和非敏感环境值由外部适配仓提供，凭据不进源码或镜像。

## 路由

`src/router/index.ts` 在被 iframe 嵌入时（`window.parent !== window`）使用
hash 路由，独立访问时使用 history 路由，两种模式的 base 都是 `/`：本应用部署在
自己域名的根路径，不在主壳的子路径下。
