# Windows 跨应用容器吸附原型

此功能只在 electron-snapora 的 Windows demo 中主动启用，未修改 Ping 接入。
库默认仍然自由框选；macOS、Linux 不调用 Windows 探测器。

## 运行

```powershell
cd D:\workspace\test\electron-snapora
pnpm run demo
```

如果 demo 已启动，关闭旧 demo 后重新运行，才能加载最新构建。
将目标应用放在前台，鼠标移到目标显示器，按 **Ctrl + Alt + Shift + S**。
该组合避开了 Lark/Ping 常用的 Ctrl + Shift + A；也可在 demo 里重新设置。

demo 的“吸附粒度”下拉框提供以下选项，默认选择面板级。按钮和全局快捷键共用主进程设置，
切换从下一次截图生效；截图进行中禁止切换，重启 demo 恢复面板级。不支持 Windows 探测的平台禁用此控件。

| 配置值   | 显示名称 | 策略                                       |
| -------- | -------- | ------------------------------------------ |
| `window` | 窗口级   | 仅 Win32/DWM 整窗边界，不遍历 UIA          |
| `panel`  | 面板级   | 主要布局区域，过滤小分组、列表行和深层嵌套 |
| `fine`   | 精细级   | 保留初版原型的小容器与列表项               |

`createWindowsSnapProvider({ granularity: 'panel' })` 的默认值也是 `panel`。
普通 manager 未配置 provider 时不启用吸附。参数类型为 `WindowsSnapGranularity`，非法值会抛出错误。
provider 的 `granularity` 为默认粒度；demo 复用同一个 provider，通过第三个参数传入本次粒度：
`getWindowSnapRegions: (signal, update) => provider(signal, update, currentGranularity)`。

面板级先排除 `Custom` / `ListItem`，要求至少 160 × 120 DIP、面积达到所属窗口的 8%，
且宽度达到窗口的 30% 或高度达到 50%。按面积从大到小处理：包含区域间面积差小于 10% 的包装层合并，
窗口内最多保留两层明显缩小的包含关系。规则按各自窗口计算，不拿整个屏幕作为基准。
这是启发式的几何层级，不等同于原始 UIA 节点深度，也不保证与 Lark 的私有策略完全一致。

窗口边界返回后立即准备截图层，UIA 容器随后逐窗补齐；移动鼠标预览候选，单击固定选区，按住左键拖动超过 4 DIP
即转为自由框选。标注、保存、复制和取消仍使用原有流程。

## 实现边界

- `createWindowsSnapProvider()` 使用隐藏的 Windows PowerShell MTA 子进程加载本地 C# 代码。PowerShell 仅是原型的加载壳，实际 Win32 / UIA 查询由 C# 完成，不增加 npm 原生依赖。
- 默认一次探测完成就结束 worker；`keepAlive: true` 可复用同一进程。`prepare()` 预加载/编译代码并初始化 UIA，不预读应用内容；`dispose()` 终止查询并永久释放 provider。demo 在应用 ready 时预热、退出时释放。
- 先用 Win32 / DWM 枚举可见、非最小化、非 cloaked 窗口，按前后顺序立即输出边界，随后通过 `CacheRequest(TreeScope.Subtree, RawViewCondition, AutomationElementMode.None)` 批量读取各窗口子树，在本地遍历缓存，减少逐节点跨进程调用。每次截图都读取新子树，不跨截图复用旧候选。
- UIA 候选仅包括 Pane、Group、Document、List、Tree、DataGrid、Table、Tab、Custom、ListItem 中尺寸至少 64 × 40 物理像素的区域；不会读取 Name、Value 或文档内容。
- 本地遍历保留总预算 1800 ms、单窗口 650 ms、最多 1600 个处理节点、深度 24。批量子树获取本身不能被这些软预算打断，可能读取更多节点或阻塞，因此外层保留默认 5 秒硬超时并杀掉 worker；这不是原生读取节点数的硬上限。
- 超时或局部失败保留已输出的窗口/容器；完全无法启动探测器则回退自由框选。取消会终止探测并丢弃候选。
- 用 Electron `screen.screenToDipRect()` 转换物理坐标，再按目标显示器裁剪。先按窗口 z-order、再按区域面积排序，防止后台小容器抢占前台窗口。
- Overlay 出现前固定本次顶层窗口句柄及窗口边界；UIA 继续通过这些句柄查询，不通过 Overlay 上的鼠标命中测试寻找底层窗口。候选与捕获帧仍不是原子快照，探测期间应用滚动、移动或更新可能造成偏差。
- provider 的第二参数 `onUpdate` 发布当前累计候选，首次回调解除截图准备等待，后续经 jobId 隔离的 IPC 更新悬停。旧式只返回数组/Promise 的 provider 仍等待其返回。鼠标按下锁定候选，后续更新不改变选区；取消后丢弃迟到输出。
- 同一个 provider 不接受并发查询；超时/崩溃/取消会销毁工作进程，下次查询重新启动。未预热、预热尚未完成或 worker 重启后的首次截图仍有启动成本。
- 一些应用不暴露全部布局容器；纯 Canvas、自绘控件、权限更高的窗口可能只有整窗候选。当前未实现父子层级手动切换、图像识别、透明/异形窗口的精细遮挡判断。
- 这是源码 demo 原型，尚未验证安装包分发。PowerShell 需要访问真实的 `.ps1` / `.cs` 文件，生产接入前需处理 ASAR unpack、签名/策略兼容及性能优化；不能直接据此声称已支持打包部署。

显式接入方式：

```js
const {
  ScreenshotManager,
  createWindowsSnapProvider,
} = require('electron-snapora/main');
const { app } = require('electron');
const provider = createWindowsSnapProvider({
  granularity: 'panel',
  keepAlive: true,
  onDiagnostic: (event) => console.log(event),
});
const manager = new ScreenshotManager({ getWindowSnapRegions: provider });
app.whenReady().then(() => provider.prepare());
app.on('before-quit', () => {
  manager.dispose();
  provider.dispose();
});
```

## 2026-10-30 本机验证

对目标应用先恢复窗口并置前，再运行真实探测器和截图 Overlay。
测试只对 Snapora Overlay 注入输入事件，不点击目标应用内容、不复制或发送截图。
以下是初版原型（相当于现在的 `fine` 档）当时页面快照的数量，不是当前默认面板级的候选数，也不是固定能力指标：

| 目标                    | 内部候选数（去重后） | 探测耗时 | 悬停 / 单击 / 坐标 |
| ----------------------- | -------------------: | -------: | ------------------ |
| Lark                    |                   79 |  2285 ms | 通过               |
| Chrome                  |                   69 |  2129 ms | 通过               |
| Ping Chat Debug v1.20.0 |                   51 |  2018 ms | 通过               |

三组均在主屏 150% 缩放下验证，自动断言预览和最终选区矩形与原生候选一致（误差不超过 1 DIP）。
这证明跨应用内部区域可以识别和吸附，不代表任意页面的全部容器都可识别。
双屏混合 DPI、跨屏窗口和负原点显示器尚未做真机矩阵验证；负坐标裁剪有单元测试。

复现：先将目标窗口置前，取得其主窗口进程 ID，再运行：

```powershell
pnpm run demo:windows-snap-smoke --pid=<进程ID> --display=primary --granularity=fine
# 单独验证悬停后拖动转自由框选：
pnpm exec electron demo/windows-snap-smoke.cjs --pid=<进程ID> --display=primary --granularity=fine --drag
```

`--granularity` 支持三档，默认 `panel`。面板级/精细级只检查内部候选，缺少合适容器会明确失败；窗口级检查整窗。
目标被遮挡或不在指定显示器时也会失败，不会用整窗成功冒充内部容器成功。
后续可评估独立原生 helper 分发和按悬停点查询父容器链；当前仍保留 PowerShell 加载壳。

## 2026-10-30 延迟优化验证

本轮只修改 electron-snapora / demo，未修改 Ping 接入。以下读数均来自当前机器，不是 Lark 对照测试。
优化前同一桌面直接运行 native 脚本：窗口级 359 ms、面板级 1340 ms、精细级 1253 ms，
其中窗口返回前的启动/编译约 338–347 ms；面板/精细级各输出 163 条原始容器。
改为批量子树后，相同桌面仍输出 163 条，单次冷启动降到 986–1070 ms，未通过缩小三档筛选范围提速。

最终 provider 基准：先单独测一次冷启动，再预热新 worker（385 ms），三档各测 7 次。
桌面当时约 22 个窗口；样本量很小，p95 即该组最大值，不能代表长期尾延迟。

| 粒度   | 窗口就绪 p50 / p95 | 首个可用容器 p50 / p95 | 完整探测 p50 / p95 |
| ------ | ------------------ | ---------------------- | ------------------ |
| window | 1 / 7 ms           | 不适用                 | 1 / 7 ms           |
| panel  | 1 / 5 ms           | 48 / 59 ms             | 559 / 756 ms       |
| fine   | 2 / 2 ms           | 44 / 49 ms             | 519 / 570 ms       |

冷启动面板级：窗口 394 ms、首个面板 455 ms、完整 990 ms。这里“首个容器”指首次通过该档策略的候选，
不表示所有应用、所有鼠标位置的容器都已就绪；慢窗口仍稍后补齐。`durationMs` 仍统计完整探测，
新增 `windowsReadyMs`、`firstContainerMs`、`warm` 区分等待来源。

真实 demo 三档切换 smoke 的第二轮测量：预热后的面板级窗口 3 ms、首个面板 135 ms、完整 784 ms，
但从点击到捕获帧准备完成只需 **397 ms**；精细级为 **442 ms**，完整探测 726 ms。
第一次启动立即点击窗口级时预热尚未完成，捕获帧准备耗时 694 ms。
测量使用 renderer 的 `prepared` IPC，而不是透明窗口提前显示的 `show` / opacity；
首个候选耗时、截图层初始化、最终帧准备是不同指标。完整截图尚有屏幕采集和合成开销，不能据此声称零延迟。

复现与证据：

```powershell
pnpm run demo:snap-benchmark
pnpm run demo:granularity-smoke
pnpm run demo:snap-stream-smoke
```

前两项在 `.pack-preview/windows-snap-benchmark.json`、`.pack-preview/snap-granularity-timing.json`
保存本地数据（该目录不纳入发布）。第三项使用可控的迟到候选，驱动真实 Overlay，验证静止鼠标下悬停更新、
旧 job 忽略、按下后锁定、已选区域不被覆盖。原型的三应用悬停识别结果见上节历史记录，本轮没有重新将三应用逐一置前测速。

UIA 缓存机制依据 [Microsoft 官方说明](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/caching-in-ui-automation-clients)。

## 回归验证

- 本轮性能变更：192 项 Vitest + 11 项 Node 测试通过；新增复用/预热、启动超时、重启隔离、并发拒绝、增量候选与取消后迟到输出测试。真实 demo 三档切换、native benchmark 和增量 Overlay smoke 通过。

- 上轮三档版本验证结果：188 项 Vitest + 11 项 Node 测试通过；真实 demo 的下拉切换和原生截图链路 smoke 通过。本次桌面快照的内部候选数为窗口级 0、面板级 12、精细级 156，数量会随可见应用和页面变化。
- `pnpm run lint`、`pnpm run typecheck`、`pnpm run build` 通过。
- 所有 `*.test.ts` 及 Node 测试集中到根目录 `test/`，保持模块层级；Electron mock 也迁到 `test/electron/`。Vitest、TypeScript、ESLint 和 npm scripts 已同步修改。
- `pnpm run test` 运行 Vitest 和 Node 测试；定向示例：`pnpm exec vitest run test/electron/main/windows-snap-policy.test.ts`。
- `pnpm run demo:granularity-smoke` 验证真实 demo 的默认面板级、三档下拉切换、preload IPC、原生截图候选，以及非法值和截图中切换的拒绝行为。
- `pnpm exec electron demo/selection-smoke.cjs` 通过，验证默认自由框选未回退。
- `pnpm exec electron demo/windows-snap-smoke.cjs --fixture --display=primary --drag` 通过，验证真实 Overlay 中悬停后拖动会生成手动选区。此项使用固定候选，是交互回归，不计入三组真实 UIA 识别结果。
- 新单元测试覆盖探测进程超时与窗口回退、取消与清理、分段输出与去重、坐标转换、前后窗口优先级，以及 session 取消后不创建 Overlay。
