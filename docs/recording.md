# 录制接入与使用

本功能位于 `codex/capture-recording`，尚未发布 npm。Windows 10 2004+ / macOS 14+，Electron >=42。Windows 已做真实录制验证；macOS 仍需真机验证，不能据此宣称正式支持矩阵已全部通过。

## 宿主前置权限检查

主进程在接入时、`app.whenReady()` 后调用（demo 已接入，Ping 未改）：

```ts
import { prepareRecordingPermissions } from 'electron-snapora/main';
const permissions = await prepareRecordingPermissions({
  screen: true,
  microphone: true,
  camera: true,
});
```

此入口检查系统授权，并在 macOS 请求所选麦克风/摄像头授权、触发屏幕访问检查。返回 `screen` / `microphone` / `camera` 状态；不代表设备一定存在或未被占用。系统拒绝或撤销权限仍需宿主处理，不能绕过系统隐私设置。库在录制准备阶段建立采集流、验证编码器，选项或设备改变会重新准备；开始按钮可用后点击不会再发起权限申请。

## 宿主入口

沿用 `setupElectronSnapora()` 或 `ScreenshotManager` 与现有 preload。无需额外 FFmpeg 路径、转码服务、宿主页面 DOM 或宿主 renderer 编码代码。

```ts
// 宿主 renderer 的「录制」按钮
const result = await window.electronSnapora.record({
  display: 'all',
  locale: 'zh-CN',
  recording: {
    format: 'mp4',
    maxMp4DurationSeconds: 3600,
    audio: 'none',
  },
});

// 宿主「截图」按钮：默认预选截图，也可在顶部切到录制
await window.electronSnapora.capture({ locale: 'zh-CN' });

if (result.status === 'recorded') {
  console.log(result.filePath, result.format, result.durationSeconds, result.bytes);
}
```

主进程可直接 `manager.record(options)`；全局默认配置放在 `new ScreenshotManager({ recording: { maxMp4DurationSeconds: 3600 } })` 或 `setupElectronSnapora({ ipcMain, managerOptions: { recording: ... } })` 中。每次调用的 `recording` 覆盖默认值。时长字段是秒，允许 1–86400 的整数；GIF 始终限制 60 秒，不受此字段影响。

截图成功仍返回 `status: 'completed'` 与 PNG 数据；录制保存成功使用新增的 `status: 'recorded'` 与文件路径。取消和错误仍使用 `cancelled` / `failed`。宿主做穷尽分支时要处理新增状态。输出路径由库的保存对话框选择，renderer 不能传任意写盘路径。

`cancel()` 和宿主 renderer 销毁会终止当前任务。已有录制内容时，宿主中断返回失败及 `recoveryPath`，保留临时片段；用户在预览页主动取消会删除临时文件。失败保留的文件位于系统临时目录 `electron-snapora-recordings`，不会自动删除，宿主可在恢复/放弃后管理它们。

## 操作流程

1. 默认内置覆盖层进入所有显示器的实时准备界面，顶部显示紧凑的白色菜单：横向拖动手柄、截图、录制，选中项使用实心蓝底白字，外框圆角为 8px（对齐会中 dock）。拖动仅改变菜单横坐标，并限制在屏幕内。
2. 点击截图区域或拖出矩形后，模式菜单隐藏，进入现有截图编辑器。录制不会在这个动作后自动启动。
3. 选择录制并确认范围后，在选区中央显示 340×156 DIP 的紧凑浅色悬浮准备面板（小选区或屏幕边缘按屏幕范围避让）：顶部开始按钮，下方 MP4/GIF 单选、系统声音、麦克风、摄像头图标按钮。麦克风和摄像头右侧 SVG 小箭头展开设备列表；选择设备与开关状态分开。不显示顶部标题、尾部 switch、常驻说明或时长上限；只有全屏等无法容纳外侧操作栏的情况保留停止快捷键提示，并适当增加面板高度；默认声音关闭，以斜杠图标表示，开启恢复正常图标。GIF 强制无声，切回 MP4 恢复之前的声音选择。准备页没有关闭图标，Esc 取消。采集流和编码器初始化期间，按钮保持蓝底并显示“准备中…”，就绪后显示“开始录制”，不再用灰色文字渐亮表示初始化。点击开始立即隐藏准备面板，选区中央显示灰色圆形白字 3、2、1；倒计时关闭后才编码，录制开始时不再切换选区遮罩。
4. 支持暂停/继续，暂停不计入时长；到达上限自动停止。停止后在带系统原生标题栏的独立窗口预览，再保存或关闭。不会在后台重复播放另一份预览。

录制是固定屏幕区域，一次选区不能跨显示器拼接，不跟随目标窗口移动。录制期间显示器被拔出、缩放/方向改变、锁屏或休眠会终止录制；不同触发时序可能返回可恢复失败而非预览。

截图选区沿用主题强调色（默认蓝色）；录制嗅探、框选和准备使用珊瑚红色边框。开始录制后在当前显示器的选区外保留 40% 灰色遮罩和红色边框，两者均不拦截鼠标，暂停仍保留；停止、取消或失败后清理。录制中线条只绘制在选区外并留出 1 DIP 间隔，防止非整数缩放时混入视频。贴住显示器边缘的边不向屏幕内补画，全屏录制没有外侧空位，因此不显示边框。

停止快捷键：`Ctrl/⌘ + Alt + Shift + R`。暂停/继续：`Ctrl/⌘ + Alt + Shift + P`，若被其他应用占用则仍可使用可见控制面板。开始录制后准备面板收起，红点与时间垂直居中，录制时红点缓慢呼吸、暂停时停止动画；系统设置减少动态效果时保持静态。计时／时长上限、暂停和停止进入与顶部菜单一致的白底、8px 圆角紧凑操作栏，按钮与栏体内边距 2px。左侧手柄可以拖动；Windows 允许拖入选区并置于遮罩和摄像头上方，通过系统窗口捕获排除避免录进视频。macOS 因 ScreenCaptureKit 不保证遵守 Electron 内容保护，仍限制在选区外。初始位置优先与选区右边对齐放在选区下方；边缘空间不足时依次尝试右侧、上方、左侧。全屏或无外侧空位时录制中隐藏操作栏，必须成功注册停止快捷键才允许开始。没有强制覆盖宿主已有快捷键，结束后释放本次注册。

内置默认入口改为实时准备。显式 `interactionMode: 'frozen'` 保留旧截图流程，没有顶部模式菜单；旧自定义 `createOverlay` 注入仍默认冻结，若要使用录制菜单需实现实时覆盖层合同。容器识别仍需宿主配置 Windows/macOS snap provider；未配置也可手动框选。

## 格式、性能与限制

| 项目     | MP4                    | GIF                                         |
| -------- | ---------------------- | ------------------------------------------- |
| 默认上限 | 3600 秒，可配置        | 固定 60 秒                                  |
| 编码     | H.264；有声音时 AAC    | 256 色量化、LZW                             |
| 目标帧率 | 30fps                  | 10fps，编码繁忙时降低采样频率并保留实际时间 |
| 输出尺寸 | 最长边不超过 1920px    | 最长边不超过 1280px                         |
| 声音     | 无、麦克风、系统、混合 | 无                                          |
| 文件封装 | fragmented MP4         | 持续写 GIF 帧                               |

不缓存整段视频或全部 GIF 原始帧，不在停止时把视频重新转码。Mediabunny 实时源对编码队列设置上限，主进程每次接收不超过 4MiB、实际编码端按不超过 1MiB 分块并等待落盘确认；文件上限 8GiB。编码器长时间不产出、写盘失败或收尾超时会明确结束，不无限堆积。

fragmented MP4 是合法 MP4；部分旧编辑器兼容性不如普通 MP4。本期没有普通 MP4 重封装和视频剪辑。正常停止无需外置 FFmpeg。异常恢复依赖已落盘的初始化头和完整分片，最后未完成的片段可能丢失；GIF 异常退出不保证完整播放。时长限制通过运行时钟执行，停止调度存在毫秒级误差，不能理解为逐样本硬裁剪。

## 设备和摄像头

摄像头小窗默认中号正方形。悬停时在小窗内部底部显示单行纯图标设置栏（形状与大小各三个图标），移开或拖动时隐藏；图标复用截图工具栏的 tooltip 样式、350ms 延迟和中英文文案，不使用原生 title，可选择 16:9 长方形、正方形、圆形，以及小／中／大（标称宽度 128／160／224 DIP）。选区较小时三档同比缩小，最大尺寸不超过选区宽度的 48%、高度的 64%；切换保留最近的靠边位置，拖动不改变尺寸。长方形与方形使用 12px 透明圆角，圆形使用完整圆形裁切；外层裁切容器和透明原生窗口共同保证实际画面形状。

设置栏视觉上位于摄像头内部，由同位置的独立透明窗口承载图标和 tooltip。准备和录制期间都允许悬停操作，设置仅在本次摄像头开启期间保留。主进程以系统鼠标位置判断是否离开小窗，避免两层窗口交接时的 enter/leave 事件导致闪烁。

Windows 使用系统窗口捕获排除。macOS 改用包内 ScreenCaptureKit 录制 helper：首帧采集前按原生窗口 ID 排除设置窗口，保留摄像头窗口；图标和自绘 tooltip 同属被排除的窗口。排除目标无法解析时直接报错，不回退到未过滤采集。实现参考 [Cap 的窗口排除代码](https://github.com/CapSoftware/Cap/blob/main/apps/desktop/src-tauri/src/window_exclusion.rs) 与 [Apple SCContentFilter](<https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(display:excludingwindows:)>)；不能只依赖 [Electron setContentProtection](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows)。macOS 这条新链路尚待原生编译和真机验收，Windows 的测试结果不代表 macOS 已验证。

形状／悬停交互参考 [Loom 官方说明](https://support.atlassian.com/loom/docs/use-looms-different-capture-modes)，尺寸数值为本库设计值，并非 Loom 公布的标准。

系统声音录制电脑播放的声音（扬声器或耳机），不是音量/输出设备开关；Electron 当前系统回环 API 不提供输出设备选择参数。麦克风通过 `microphoneDeviceId` 选择输入。`camera: true` 和 `cameraDeviceId` 可默认启用指定摄像头；默认摄像头关闭。

准备界面的麦克风、摄像头箭头直接弹出设备下拉菜单，包含系统默认、可用设备及当前选择标记；选择后收起，点击外部或 Esc 取消选择。菜单固定白底、深色文字、浅灰悬停和蓝色勾选，6px 圆角；由独立轻量弹出窗口承载，不修改宿主主题，系统深色模式下仍保持白色。准备面板不会新增内嵌列表，也不调整窗口高度或重新居中。展开、取消和重复选择同一设备不会重新初始化录制流；切换到其他设备时才按既有逻辑更新采集。设备热插拔会关闭旧菜单，下次展开重新枚举。

准备失败时，在开始按钮区域显示可重试的简短提示；设备相关提示可关闭，重试对应操作会清除旧提示。提示不增加面板高度，也不会产生页面滚动条。设备缺失、访问被拒绝、设备启动失败和列表加载失败分别提示，底层错误仅保留在控制台，不直接铺在界面上。

摄像头显示为选区内的固定尺寸小窗，只能在选区内拖动；画面直接进入屏幕采集，因此输出位置与小窗位置一致。停止、取消和失败均释放设备；录制中暂不切换设备。GIF 可录入摄像头画面，但没有声音。媒体设备 ID 属于会话，不应作为跨安装稳定标识。

## macOS 宿主能力

- 屏幕录制权限属于宿主应用身份，开发版 Electron 与签名安装版需要分别授权。
- 麦克风：宿主 Info.plist 提供 `NSMicrophoneUsageDescription`；可由上述前置入口提前请求权限；未授权时在准备阶段处理，不在点击开始后处理。
- 摄像头：宿主 Info.plist 提供 `NSCameraUsageDescription`。
- 系统音：遵循 Electron 对 macOS 版本和 `NSAudioCaptureUsageDescription` 的要求。未返回音频轨道时明确报错；不自动切成无声视频。详见 [Electron 官方说明](https://www.electronjs.org/docs/latest/api/desktop-capturer)。
- 录制使用库自己的内存 session，不覆盖宿主 `defaultSession` 的媒体处理器。
- 辅助功能权限只服务于 AX 容器嗅探，手动框选录制不依赖它。
- 在 Mac 上运行 `pnpm run build:native:mac:universal`，构建两个 helper（原截图 helper 和新增 `snapora-macos-recording`），再运行 `pnpm run build`。发布检查要求两个二进制均包含 arm64/x86_64；当前 Windows 开发环境不能生成新 macOS 二进制。运行时不要求宿主安装 Swift 或 FFmpeg。
- 两个 helper 均需 ASAR 解包，宿主发布时使用自己的 Developer ID 签名并完成公证；开发用 ad-hoc 签名不替代发布签名。屏幕授权需在最终签名宿主及 helper 身份下验证。打包还需包含 `dist/recording/preload.cjs`、`dist/overlay/recording.html`、`recording-devices.html`、`camera.html`、`camera-controls.html`、`recording-preview.html` 及整个 assets 目录。
- macOS 视频路径为 ScreenCaptureKit → VideoToolbox H.264 → 压缩包 IPC → MP4 封装；GIF 解码同一条已排除控件的画面，再量化输出。音频继续使用 Electron 采集及 AAC 编码。原生端最多三个未确认压缩包，消费慢时在编码前跳过采样，不丢弃已编码参考帧；静态桌面仅保留一帧最新画面。没有逐帧传输全屏原始图像，也不缓存整段视频。

## 验证

```sh
pnpm run demo
pnpm run demo:recording-smoke
```

demo 增加独立录制按钮和 MP4 秒数输入。真实录制回归通过环境变量设置时长：`SNAPORA_SMOKE_SECONDS=3600`、`SNAPORA_GIF_SECONDS=60`、`SNAPORA_SMOKE_AUDIO=system`；PowerShell 使用 `$env:变量名='值'` 后运行 smoke 命令。该脚本只操作自己创建的窗口，生成 MP4/GIF、验证预览解码/暂停/自动停止/保存，并把进程内存样本写入输出目录的 `results.json`。不会替宿主授权 macOS 系统权限。

当前验证详情见仓库 `docs/recording-implementation.md`。FFprobe 仅用于开发验证输出，不参与运行时录制。Mediabunny/gifenc 仅作为构建依赖，所需代码已打包进录制页面，不要求宿主额外安装整套编码库。捆绑依赖及许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。录制界面目前提供中文和英文，其他 locale 使用英文；原截图语言资源不变。

设备验证命令：`pnpm run demo:recording-media-smoke` 默认使用 Chromium 测试摄像头和麦克风。设置 `SNAPORA_MEDIA_REAL=1` 使用本机真实设备；可设置 `SNAPORA_TEST_FFMPEG` 为开发机 FFmpeg 路径，自动检查导出帧中的摄像头位置与音频频率成分（仅测试依赖）。真实模式播放低音量 440Hz 测试音，录制系统回环；模拟模式使用 660Hz 麦克风信号。测试媒体保存在打印的临时目录，不上传。

`pnpm exec electron test/demo/native-recording-engine-smoke.cjs` 可在两端验证新增 H.264 压缩包到 MP4/GIF 的消费路径，使用合成图像，不要求桌面解锁。它不验证 macOS 系统采集和窗口排除；后两项必须在已授权、已解锁的 Mac 桌面上运行媒体回归。媒体回归已同时覆盖 Windows/macOS 录制时的设置栏和中英文 tooltip。
