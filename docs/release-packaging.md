# npm 打包与发布检查

本文档供仓库维护者使用，不随 npm 包发布。面向使用者的安装、接入和宿主打包说明保留在根目录 `README.md`。

## 公开内容边界

发布内容由 `package.json` 的 `files` 白名单控制：

- `dist`：ESM/CommonJS 运行时代码、类型声明、宿主与 Overlay Preload、Overlay HTML/CSS/JS。
- `README*.md`：英文完整文档，以及简体中文、日语、韩语和西班牙语快速开始。
- `CHANGELOG.md`：对使用者可见的版本变化。
- `LICENSE`：项目许可证；正式发布前必须存在。
- `package.json`：npm 必需的包元数据。

以下仓库内容不得进入 npm tarball：

- `src`、`demo`、`integration`、`scripts` 和 `docs`。
- `.github`、`.ai-factory` 及其他维护工具配置。
- 测试文件、覆盖率、临时打包目录和本地日志。

`exports` 只限制使用者可导入的入口，不决定文件是否进入 tarball；检查发布内容时应以 `files` 和 `pnpm pack --dry-run` 的结果为准。

## 本地检查命令

只生成 `dist`：

```powershell
pnpm build
```

重新构建并预览最终 tarball 清单，不生成 `.tgz`：

```powershell
pnpm pack --dry-run
```

生成真实 tarball 并逐项查看：

```powershell
New-Item -ItemType Directory -Force .pack-preview
pnpm pack --pack-destination .pack-preview
$packFile = Get-ChildItem .pack-preview\*.tgz | Select-Object -First 1
tar -tf $packFile.FullName
```

`.pack-preview` 仅用于本地检查，不得提交。检查结束后可删除。

验证真实 tarball 的 ESM、CommonJS、打包器、Electron 版本和成品应用消费：

```powershell
pnpm verify:package
```

执行完整发布门禁：

```powershell
pnpm release:check
npm publish --dry-run
```

`prepack` 会重建 `dist`；`prepublishOnly` 会执行完整发布门禁。独立消费项目优先使用 pnpm 缓存，缺少元数据时允许从 registry 补齐。

## 自动递增版本并发布

以下命令只保存在本内部文档中，不写入公开的 `package.json.scripts`。复制与变更级别对应的一行执行即可。

主版本，例如 `1.0.1 → 2.0.0`：

```powershell
pnpm run verify:release-metadata && pnpm version major --no-git-tag-version && npm publish
```

次版本，例如 `1.0.1 → 1.1.0`：

```powershell
pnpm run verify:release-metadata && pnpm version minor --no-git-tag-version && npm publish
```

修订版本，例如 `1.0.1 → 1.0.2`：

```powershell
pnpm run verify:release-metadata && pnpm version patch --no-git-tag-version && npm publish
```

命令使用 `--no-git-tag-version`，只修改包版本，不自动创建 Git commit 或 tag。`npm publish` 仍会触发 `prepublishOnly` 完整门禁；正式版本使用 `latest`，包含 SemVer prerelease 后缀的版本使用 `next`。

运行前必须保证工作区干净，并已配置 npm 登录、2FA/OTP 和 Git 身份。元数据预检失败时不会自增版本；如果自增后因测试或网络导致发布失败，不要再次运行版本发布命令，否则版本会继续递增。修复问题后直接运行 `npm publish` 重试，发布成功后再提交版本变更和创建对应 Git tag。

### 常用维护命令

| 目的                         | 命令                           |
| ---------------------------- | ------------------------------ |
| 格式、Lint、类型、测试和构建 | `pnpm check`                   |
| 启动示例                     | `pnpm demo`                    |
| 选区/复制/双击真实回归       | `pnpm demo:selection-smoke` 等 |
| ESM/CommonJS tarball 消费    | `pnpm verify:consumers`        |
| electron-vite/Webpack 消费   | `pnpm verify:bundlers`         |
| Electron 版本矩阵            | `pnpm verify:electron-matrix`  |
| ASAR/目录成品应用            | `pnpm verify:packaged`         |
| 完整 npm 消费矩阵            | `pnpm verify:package`          |
| 发布元数据                   | `pnpm verify:release-metadata` |
| 完整发布门禁                 | `pnpm release:check`           |

## 当前 tarball 基线

2026-08-21 对固定到屏幕功能的待发布构建在 Windows 开发环境执行 `npm pack --dry-run` 和临时 tarball 检查得到：

| 指标                 | 结果                  |
| -------------------- | --------------------- |
| tarball 条目         | 62                    |
| tarball 压缩体积     | 179,435 bytes         |
| `dist` 文件数        | 54                    |
| `dist` 未压缩体积    | 702,699 bytes         |
| Source Map           | 17 个 / 446,556 bytes |
| Source Map 占 `dist` | 约 63.3%              |

当前 tarball 已包含 MIT `LICENSE`，未包含源码、测试、Demo、CI、内部文档或发布脚本。

## 精简判断

必须保留：

- `main`、`core` 和公共 `preload` 的 ESM/CommonJS 入口及对应声明文件。
- 默认宿主 Preload 的 CommonJS 文件。
- Overlay HTML、CSS、JS 和 Overlay CommonJS Preload。
- 主入口声明引用的共享声明文件。

可评估裁剪：

- Source Map：当前是最大体积项；正式版 1.0.1 保留用于真实宿主排错，后续版本重新评估。
- 内部 Overlay Preload 的 ESM 和声明产物：当前没有公共导出，运行时只加载 CommonJS 文件。
- 默认宿主 Preload 的 ESM 产物：当前公共导出和 `BrowserWindow` 都使用 CommonJS 文件。

不要仅为减少几 KB 引入多套复杂构建配置。每次精简后必须重新执行 `pnpm pack --dry-run` 和 `pnpm verify:package`。

## 发布前检查表

1. 确认首个正式版本为 `1.0.1`，`publishConfig.tag` 为 `latest`。
2. 确认 `package.json.license` 与根目录 `LICENSE` 一致。
3. 执行 `pnpm pack --dry-run`，只允许出现公开内容边界中的文件。
4. 执行 `pnpm release:check`，确保质量、元数据和真实消费矩阵全部通过。
5. 执行 `npm publish --dry-run`，确认 registry、tag 和最终文件清单。
6. 从“自动递增版本并发布”一节复制与变更级别对应的命令执行。
7. 提交版本变更并创建对应 Git tag；正式版本发布到 npm `latest`。

## npm 本地登录

npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/

当前阻塞项及平台验收进度以 `docs/plan.md` 为准。
