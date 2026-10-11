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

环境变量参考 `.env.example`，复制成 `.env.local` 后按需修改。

## 构建期变量（写死进产物，改了必须重新构建）

Vite 会把 `import.meta.env.*` 内联进 bundle，所以下面这些**不能**在容器启动时改：

| 变量 | 说明 |
|---|---|
| `VITE_SHELL_URL` | 主壳的精确 origin。postMessage 会同时校验 origin 和 parent window，填错则壳与子应用无法通信 |
| `VITE_CORE_BACKEND_URL` | 留空 —— 留空时前端走相对路径 `/api`，由本容器 nginx 同源反代，无需 CORS |
| `VITE_STORAGE_URL` | storage 服务的浏览器可达绝对地址（附件上传走预签名，必须跨域直连） |

## 运行期变量（容器启动时解析，同一镜像可改指向）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CORE_UPSTREAM` | 见 Dockerfile | 后端反代目标 |
| `SHELL_ORIGIN` | 跟随 `VITE_SHELL_URL` | 写进 CSP `frame-ancestors`，决定谁能 iframe 本站 |
| `FRAME_ANCESTORS` | 未设置时使用 `SHELL_ORIGIN` | 逗号分隔的精确 HTTP(S) origin 列表，可同时允许主壳和嵌入宿主；显式空值不合法 |

两者都由 `docker-entrypoint.d/40-runtime-config.sh` 校验后再注入 nginx 配置：
必须是单个 `scheme://host[:port]` 形式的 origin，带路径、查询串或凭据一律拒绝并
终止启动 —— 与其生成一份被注入的 nginx 配置，不如让容器起不来。
`FRAME_ANCESTORS` 的每一项使用同样的校验，不接受空项、空白、通配符或 CSP 关键字。
允许嵌入宿主时还须在构建期设置 `VITE_AUTH_BACKEND_URL` 和
`VITE_EMBED_HOST_ORIGINS`；CSP 列表不会改变 bundle 的 postMessage 来源校验。

## 容器

```bash
docker build --build-arg VITE_SHELL_URL=https://shell.example.test --build-arg VITE_STORAGE_URL=https://storage.example.test -t nucleagent-core-web .
docker run -p 8080:8080 -e CORE_UPSTREAM=https://backend.example.test nucleagent-core-web
```

监听 8080，`/healthz` 返回 200。

nginx 反代 /api/ → https://backend.example.test/api/，
让前端调后端保持**同源**，因此不触发 CORS 预检，后端也不必维护一份随本域名变动的
白名单。未命中反代的 API 路径显式返回 404，不会 fall through 到 `try_files`
把 SPA 的 `index.html` 当成 200 响应回去 —— 那种「假成功」最难排查。

仅修改运行期 `SHELL_ORIGIN` 不会更新 bundle 的 postMessage 校验；主壳来源变化必须重建。
部署目标、组织配置和非敏感环境值由外部适配仓提供，凭据不进源码或镜像。

## 路由

`src/router/index.ts` 在被 iframe 嵌入时（`window.parent !== window`）使用
hash 路由，独立访问时使用 history 路由，两种模式的 base 都是 `/`：本应用部署在
自己域名的根路径，不在主壳的子路径下。


### Additional shell origins

`VITE_SHELL_ALLOWED_ORIGINS` is a build-time comma-separated allowlist for
embedded shell messages. Omitted or empty preserves `VITE_SHELL_URL` as the
single trusted shell. The child binds replies to the verified parent origin;
parent, protocol, app, instance and session validation still apply.

At container start, `FRAME_ANCESTORS` accepts comma-separated exact HTTP(S)
origins. Omitted preserves `SHELL_ORIGIN`; explicit empty or invalid entries
fail startup. Preserve the existing production origin when adding clients,
and rebuild the frontend when changing the message allowlist.
