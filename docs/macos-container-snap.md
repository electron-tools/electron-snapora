# macOS 多屏选择与容器吸附

状态：2026-10-30，已实现源码和 demo 接入；当前工作环境为 Windows，未执行 Swift 编译、签名包启动或 macOS 实机测试。Ping 接入不变，Lark / 浏览器 / Ping 的 Mac 体验仍待验收。不要将 Windows 上的模拟测试结果视为 Mac 原生验证。

## 实现边界

| 能力         | 实现                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 多屏实时选择 | 复用 `LiveScreenshotSession`；一次会话同时呈现各屏，确认后只采集选中屏                                                                                 |
| 窗口边界     | CoreGraphics `CGWindowListCopyWindowInfo`，前后层级与窗口 ID，不读取标题                                                                               |
| 容器         | AX 公共接口按目标窗口读取角色、位置、大小、有限子节点，不读取 Name/Value/文本                                                                          |
| 粒度         | 与 Windows 共用 `snap-policy.ts`，窗口 / 面板 / 精细三档，demo 默认窗口级                                                                                |
| 坐标         | CG / AX 顶部原点全局点坐标直接对应 DIP；按显示器裁剪并附加 displayId，Retina 缩放只用于像素采集                                                        |
| 像素         | macOS 14+ `SCScreenshotManager`，按实际 `pointPixelScale` 配置 PNG 尺寸，关闭采集光标                                                                  |
| 排除截图层   | `BrowserWindow.getMediaSourceId()` 取 CGWindowID，`SCContentFilter(display:excludingWindows:)` 精确排除；不依赖 `setContentProtection`，不排除整个进程 |
| 交互         | 复用透明吸附边框、选区、工具栏、标注、复制、保存、贴图与取消；macOS 实时窗口不进入 simple fullscreen，旧冻结窗口策略保留                               |
| 故障         | AX 不可用保留窗口/手动选择；原生像素路径失败明确报错，不回退到可能含遮罩/光标的截图                                                                    |

依据：[Electron 窗口 ID 与原生句柄的区别](https://www.electronjs.org/docs/latest/api/base-window#wingetmediasourceid)、[Apple 截图 API](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager)、[窗口排除过滤器](<https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(display:excludingwindows:)>)、[点到像素比例](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/pointpixelscale)。macOS 的 `getNativeWindowHandle()` 是 NSView 指针，不能当作 CGWindowID。

原生工作进程不放在主进程执行：AX 和像素采集各用一个可复用 helper 实例，避免某应用的 AX 阻塞拖慢采集。预热只启动进程；窗口边界先发布，AX 结果随后增量发布。每次探测重新读取，不复用上一次截图的旧树。AX 总预算约 1800ms、单窗口约 650ms、每窗口最多 1600 节点、深度 24、每页取最多 256 子节点，单次 AX 消息超时 50ms；这些是软限制，外层另有 5 秒硬超时。鼠标移动只命中已取得的本地候选。

每轮查询携带新的全局 DIP 鼠标坐标，先扫描鼠标所在窗口；仅对 AX 扫描队列跳过被前方窗口矩形完全覆盖的目标，已知半透明窗口不用于判定完全覆盖。所有整窗候选和原 z-order 保留，用于前后层级命中。遮挡判断仍是矩形启发式，不解析异形窗口或逐像素透明度。

容器遍历优先使用 `AXVisibleChildren`，已支持但返回空列表时不回退。仅在该属性不支持时，分批读取 `AXChildren`，不再永远停在前 256 项。每级继承祖先可见边界，滚动视口外的分支不产生候选；无几何信息的结构节点仍可访问子节点。应用不支持可见子项且树很大时，分页回退仍受节点/时间预算约束，可能只提供整窗或部分容器。对应语义见 [Apple 的可见子项说明](https://developer.apple.com/documentation/applicationservices/kaxvisiblechildrenattribute)。

公共 AX 不提供保证可用的 CGWindowID 属性；目前按进程及窗口边界匹配 AX 窗口，多窗口边界相同且有歧义时只保留整窗候选。Canvas、自绘区域或应用未暴露 AX 时不能保证容器级选择。权限状态从实际 helper 读取，不能用宿主的状态冒充子进程状态。

取消中的原生工作进程被终止；排队任务在出队和预热后检查 AbortSignal。响应按请求 ID 关联，旧进程的输出和退出事件不能影响新进程。启动、响应字节数和等待时间均有上限，退出时释放子进程。长 PNG 响应按块累积，只扫描新分片的换行符，完整行到达后一次合并和解析；取消/超限会丢弃未完成分片，不重复扫描累计字符串。

## 本地运行

1. 在 macOS 14+ 安装依赖和 Xcode Command Line Tools（`xcode-select --install`）。
2. `pnpm run demo`（或别名 `pnpm run demo:mac`）：macOS 14+ 自动使用系统 `xcrun swiftc` 构建 helper，进行开发用 ad-hoc 签名，再构建/启动 demo。编译失败直接停止，避免打开无法采集的 demo。Windows 的 `pnpm build` 单独编译 Windows exe；较旧 macOS 跳过原生编译。
3. 点击 demo 的“授权屏幕录制与辅助功能”。系统允许后刷新状态，若仍为旧状态重启 demo。屏幕录制负责像素权限；辅助功能负责跨应用容器。
4. 在实时/冻结模式及三档粒度间切换，比较下一次截图。macOS 全局快捷键沿用 demo 配置 `CommandOrControl+Shift+A`。

### 启动与设置排查

- 只有全屏预览而跨应用移动不切换时，先看 `[macOS container snap]`。`windows > 0` 且 `accessibility: true` 不能证明容器遍历成功：旧实现接受所有非负层级窗口，Window Server 状态层可能以全屏边界抢占命中，并使其他窗口被判为完全遮挡。当前在命中及 AX 遮挡判断前过滤 Window Server 与系统菜单/覆盖层，仅保留 normal、floating、modalPanel、utility 层；真正的全屏应用保留。自定义其他层级的置顶窗口暂不提供吸附候选，仍可手动框选。像素采集排除校验继续使用完整列表，避免漏掉截图层。参考 [WebRTC 的 Mac 窗口过滤](https://webrtc.googlesource.com/src.git/+/refs/heads/main/modules/desktop_capture/mac/window_list_utils.cc)。
- 日志新增 `native` 阶段计数：`visibleWindows` 为排除本次截图层后的枚举数，`filteredWindows` 为系统/层级过滤数，`axTargets` 为遮挡筛选后目标数，`matchedWindows` 为成功匹配 AX 窗口数，`rawContainers` 为粒度过滤前的容器数。无文本内容。最终 `windows`/`containers` 是裁剪到显示器并过滤后的候选数，跨屏窗口可能计入多次。当前修复仍需 Mac 实机确认；计数用于继续区分窗口匹配失败、目标未暴露 AX 树及面板过滤。
- 若界面仍显示“吸附粒度（Windows）”及“当前平台暂不支持 Windows 容器吸附”，正在运行旧 demo。先核对源码目录和提交，更新代码并退出旧进程再启动。当前标签应为“吸附粒度（Windows / macOS）”，Mac 上另有权限面板。
- 在 Mac 终端运行 `sw_vers -productVersion` 查看系统版本；实时模式要求 14 或更新版本，旧系统只保留冻结截图。
- `macOS helper unavailable` / `CAPTURE_FAILED` 表示原生进程无法启动或已退出，不能据此判断用户未授权。旧版本直接运行 `pnpm demo` 不会编译 helper，应运行 `pnpm run demo:mac`；当前入口已自动补上构建。也可依次执行 `pnpm run build:native:mac`、`pnpm run demo`。
- 启动失败错误包含 helper 路径和系统错误码/退出信号。`ENOENT` 优先检查文件是否构建并复制到 `dist/native/snapora-macos`；`EACCES` 检查可执行权限；被系统终止需进一步检查签名或系统日志。权限拒绝使用单独的 `PERMISSION_DENIED`。
- 截图进行中设置暂时禁用，按 Esc 取消或完成截图后恢复；初始化响应迟到不会解锁进行中的操作。交互模式与吸附粒度各自按支持状态恢复，一项设置读取失败不会错误禁用另一项。

```ts
const provider = createMacSnapProvider({ granularity: 'panel' });
const manager = new ScreenshotManager({ getWindowSnapRegions: provider });
await provider.prepare();
await manager.prepare({ display: 'all', interactionMode: 'live' });
await manager.capture({ display: 'all', interactionMode: 'live' });
// 应用退出时：manager.dispose(); provider.dispose();
```

权限检查：`await provider.getPermissions()`；只有用户点击授权按钮时调用 `getPermissions(true)`。未授予辅助功能允许窗口级退化；缺少屏幕录制权限时实时采集返回 `PERMISSION_DENIED`。

macOS live 路径由实际采集后端检查屏幕权限，Electron 宿主的 `getMediaAccessStatus('screen')` 不再提前阻断它；原生拒绝会直接返回，不回退到 Electron 截图。frozen 路径继续检查宿主权限，保留原有拒绝后打开系统设置的行为。默认宿主/子进程可能共享 TCC 归属，不能假定二者一定独立；这里分别按各路径的实际权限主体判断。demo 的 helper 状态是辅助显示，最终以采集后端结果为准，自定义 Mac 后端也需要自行执行权限检查。

自定义 Overlay 在 macOS live 模式必须提供 `captureWindowId` 和 `showSelection()`；使用内置类时传 `liveSelection: true`。自定义采集适配器从可选第四参数 `CaptureExclusionContext` 接收要排除的窗口 ID。该上下文仅在主进程构建，不加入渲染进程可提交的截图 options。旧自定义适配器签名兼容，但如需支持 Mac live，必须自行实现排除。

## 构建与分发

- `pnpm run build:native:mac` 构建本机架构；`pnpm run build:native:mac:universal` 构建 arm64 + x86_64。生成文件不入 Git，位于 `src/electron/native/snapora-macos` 并复制到 `dist/native`。普通 `build` 会重新复制已有 native 文件，不会在 Windows 伪造 Mac 二进制。
- 安装包将 `dist/native/snapora-macos` 放到 ASAR 外（例如 electron-builder `asarUnpack: ['**/dist/native/snapora-macos']`），保留执行权限；默认路径自动映射 `app.asar` 到 `app.asar.unpacked`。
- 应随应用使用 Developer ID 签名并公证 helper，保留稳定路径和代码身份。构建脚本中的 ad-hoc 签名仅供源码 demo，不能作为生产发布验收。运行时不编译、不下载、不调用 PowerShell。
- 也可通过 provider 的 `executablePath` 及 `new ElectronCaptureAdapter({ macHelperPath })` 提供自己的绝对路径，再把 adapter 传给 manager；自定义 adapter 由宿主 `dispose()`。
- 尚未发布包含 helper 的 npm 包。发布前先执行 `pnpm run test:native:mac`，再执行 `pnpm run build:native:mac:universal` 和 `pnpm run release:check`。后者检查 universal Mach-O 的两个架构、复制后的文件一致性，并在 Mac 校验执行权限与签名；缺失或单架构产物会阻止发布检查。跨平台 JS 构建成功不代表包含可执行 Mac helper。`test:native:mac` 会生成本机单架构文件，因此务必在它之后重新生成 universal 文件。
- 面向宿主的五语言 README 已提供 provider、权限 IPC、Preload 和清理示例。demo IPC 与 AppleScript 焦点恢复不属于包依赖。Windows 外部 worker 也需解包原生目录，统一使用 `asarUnpack: ['node_modules/electron-snapora/dist/native/**']`（electron-builder 26）；库将外部 helper 路径统一映射到 `app.asar.unpacked`。

## 验证

Windows 可运行的测试覆盖：进程启动、复用、增量分帧、过期响应、取消排队/采集中/启动中任务、超时与响应大小限制；AX 候选裁剪、负坐标和不同缩放下不二次放大、共享三档策略、失败保留整窗；CGWindowID 贯穿多屏会话和采集、SCK 路由、PNG 尺寸与资源约束、透明 Overlay 非聚焦屏仍显示、旧冻结模式保留。

审查修复新增测试：8 MiB 响应按 64 KiB 分片输入实际解析器，断言扫描总量线性、收到换行前不完成；半包累计超限、取消半包后重启隔离；宿主 denied/restricted 而 helper 可采集、helper 拒绝而宿主 granted、冻结路径继续拒绝；每次查询发送更新的鼠标坐标。测试不依赖机器耗时阈值。

同机模拟基准（Windows / Node，实际解析器，64 KiB 分片，无桌面采集）：32 MiB 响应修复前约 3394ms，修复后约 69ms；16 MiB 从约 932ms 降至约 23ms。这是样本的累计解析时间，不是 Mac 实机性能或端到端截图延迟承诺。

`pnpm run test:native:mac` 会先编译实际 helper，再编译并运行 `test/electron/native/macos-snap-policy.test.swift` 的 7 组回归。测试直接调用生产 `macos-snap-policy.swift`，用内存窗口和树代替系统 API：覆盖系统全屏状态层过滤且保留真实全屏/浮动/模态窗口、副屏目标优先/遮挡过滤/原 z-order 不变、滚到第 500 项后的可见行、可见列表为空不回退、父视口裁剪与结构节点、AXChildren 分页超过 256 项，以及节点/深度/时间上限。该命令不启动截图 helper、不申请权限、不读取桌面；当前 Windows 环境没有 Swift，原生测试已编写但尚未执行。

Mac 验收入口：授权后连接两块显示器，运行 `pnpm run demo:mac-live-smoke`。脚本按顺序选择两屏，并检查选前零像素采集、两屏面板、同进程测试窗口保留而截图层排除、选后颜色变化、PNG 导出、越界拖动、取消及迟到帧。只操作测试窗口，不写用户剪贴板，结果保存到 `.pack-preview/mac-live-selection-smoke.json`。

实机验收待办：Swift 编译；Apple Silicon / Intel；Retina + 普通屏，负原点/上下排列；Lark / Chrome / Ping 三档容器效果；全屏 Space 与焦点/文字输入；系统光标和遮罩像素排除；初次拒绝与重新授权；签名安装包的权限归属、启动和清理。源码实现尚不能证明这些项目通过。
