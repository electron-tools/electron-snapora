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

## 自动递增版本

以下命令只保存在本内部文档中，不写入公开的 `package.json.scripts`。复制与变更级别对应的一行执行即可。

主版本，例如 `1.0.4 → 2.0.0`：

```powershell
pnpm run verify:release-metadata && pnpm version major --no-git-tag-version
```

次版本，例如 `1.0.4 → 1.1.0`：

```powershell
pnpm run verify:release-metadata && pnpm version minor --no-git-tag-version
```

修订版本，例如 `1.0.3 → 1.0.4`：

```powershell
pnpm run verify:release-metadata && pnpm version patch --no-git-tag-version
```

命令使用 `--no-git-tag-version`，只修改包版本，不自动创建 Git commit 或 tag。版本自增后先更新 CHANGELOG、完成 dry-run、提交并等待 CI；CI 全绿后再单独执行 `npm publish`。正式版本使用 `latest`，包含 SemVer prerelease 后缀的版本使用 `next`。

运行前必须保证工作区干净，并已配置 npm 登录、2FA/OTP 和 Git 身份。元数据预检失败时不会自增版本；如果自增后因测试或网络导致发布失败，不要再次运行版本命令，否则版本会继续递增。修复后直接重新执行 dry-run 或 `npm publish`。

## Git tag 与 GitHub Release

Git tag 只记录版本名指向哪个 Git 提交，annotated tag 的短消息也不会自动变成完整发布说明。要让 GitHub 的 Releases 页面展示“新增了什么、修复了什么”，每次发布必须同时创建同名 GitHub Release。

发布说明以 `CHANGELOG.md` 对应版本小节为唯一来源，至少保留实际存在的 `Added`、`Changed`、`Fixed`、`Security`、`Compatibility` 分类。不要使用空白 Release，也不要只写 `Release vX.Y.Z`。

已登录 GitHub CLI 时，可在 npm 发布和 tag 推送成功后执行：

```powershell
gh release create v1.0.4 --repo electron-tools/electron-snapora --title "electron-snapora v1.0.4" --notes "<复制 CHANGELOG.md 中 1.0.4 的正文>"
```

GitHub CLI 未登录时，在仓库的 Releases 页面选择对应 tag，标题使用 `electron-snapora vX.Y.Z`，正文复制对应 CHANGELOG 小节。创建后通过 GitHub 公共 API 或 Releases 页面确认 `draft=false`、`prerelease=false`。

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

2026-08-24 对 `electron-snapora@1.0.7` 在 Windows 开发环境执行 `npm pack --dry-run` 和临时 tarball 检查得到：

| 指标                 | 结果                  |
| -------------------- | --------------------- |
| tarball 条目         | 63                    |
| tarball 压缩体积     | 235,328 bytes         |
| `dist` 文件数        | 54                    |
| `dist` 未压缩体积    | 898,582 bytes         |
| Source Map           | 17 个 / 575,479 bytes |
| Source Map 占 `dist` | 约 64.0%              |

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

1. 确认 `package.json`、`CHANGELOG.md` 和目标 tag 使用同一个正式版本，`publishConfig.tag` 为 `latest`。
2. 确认 `package.json.license` 与根目录 `LICENSE` 一致。
3. 执行 `pnpm pack --dry-run`，只允许出现公开内容边界中的文件。
4. 执行 `pnpm release:check`，确保质量、元数据和真实消费矩阵全部通过。
5. 执行 `npm publish --dry-run`，确认 registry、tag 和最终文件清单。
6. 从“自动递增版本”一节复制与变更级别对应的命令执行，并更新对应 CHANGELOG 小节。
7. 提交并推送版本变更，等待 GitHub CI 全绿后发布到 npm `latest`。
8. 在实际发布提交上创建并推送 annotated Git tag。
9. 创建同名 GitHub Release，正文使用对应 CHANGELOG 小节；确认 Releases 页面能直接看到 Added/Changed/Fixed 内容。

## npm 本地登录

npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/

当前阻塞项及平台验收进度以 `docs/plan.md` 为准。
