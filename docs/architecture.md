# 架构

## 依赖边界

| 层 | 职责 | 允许的运行时依赖 |
| --- | --- | --- |
| main | 应用生命周期、可信 IPC、会话与进程服务 | Node、Electron、shared |
| preload | 白名单 API 与事件订阅 | Electron |
| shared | 契约、快捷键、状态与统计纯逻辑 | shared |
| renderer | React 页面、交互和终端显示 | React、xterm、shared |
| pi | Pi 宿主扩展和正文定位 | Pi 宿主 API、定位适配 |

`tests/architecture.test.cjs` 检查导入边界；`npm run check` 与 CI 执行检查。类型契约由 TypeScript strict 和编译期正反例验证。失败输出指向文件、依赖或类型位置，提交与测试日志用于追溯。

## 渲染与状态

- `WorkspaceController` 是窗口级状态入口，通过 `useSyncExternalStore` 接入 React。
- 导航、提醒和筛选由独立模型管理；组件派生筛选与统计，不持久化重复结果。
- 手动未读仅存于现有 GUI 配置，以项目与会话文件身份隔离（复用规范化路径散列，不依赖可重复的 session-id），不写 Pi 历史。完成未读仍按运行状态独立确认；被动刷新、右键菜单归还焦点不撤销手动标记。`tests/core.test.cjs`、`tests/react-state.test.cjs` 与侧栏回归验证持久化、显式打开确认和过期清理；功能不增加独立配置文件。
- 会话组织状态复用 `projects.json`：`sessionMarks` 只有 `favorite / pinned` 两种；收藏只影响收藏视图，项目置顶独立且不进入全局分区。旧 `globalPinned` 在加载边界迁移为 `favorite + pinned` 并删除旧字段。项目 `pinned` 与手动顺序分离。主进程的原生菜单复用会话归属校验和互斥入口，不新增任意路径写入 IPC；未保存历史不接受持久标记。取消、删除、隐藏、目录替换后移除空/失效记录，扫描有警告时保留；不另建数据库、配置文件、定时器或同步机制。退出该功能时可整体删除标记字段、菜单和派生展示，不影响 Pi 历史；维护者通过 store、selector、类型测试及侧栏回归验证约束，失败由 CI/回归日志暴露，沿提交追溯。三 Tab 替代原最近会话的时间过滤，统计视图仍保留活动时间/状态筛选；置顶排序不绕过当前 Tab 或搜索，项目快捷键跟随实际置顶顺序。
- 会话和项目文件夹左侧的静态细竖线共用形状/颜色样式，只派生自本应用存活的 Pi，不持久化、不轮询外部进程。会话排序只取历史创建/对话消息时间，进程启动、恢复时追加的模型/思考配置等元数据不算对话活动；已保存行使用文件键保持 React 身份稳定。`tests/catalog.test.cjs`、`tests/navigation.test.cjs` 和真实 Pi 侧栏回归验证恢复、刷新与切换不跳位，实际新消息仍更新排序；不引入排序快照、额外缓存或持久字段。收藏五角星与置顶图钉独立于运行/未读/选中状态。移除的右上角 iTerm 按钮及其专用 IPC 同步删除，原项目右键入口继续使用主进程固定命令。
- React 负责页面、列表、表单和对话框。没有旧 DOM 渲染器或 HTML 注入层。
- Pi 共用 `WorkspaceState.activeTabs`、访问历史、主工作区和关闭回退。Shell 只在系统 Terminal 打开，不进入应用状态。此模型替代独立的上下终端、Shell 显隐状态、水平拖拽及高度设置；旧快捷键只在读取边界迁移，下一次保存移除旧命令。标签状态测试、真实 Pi 草稿/GPU 与生命周期回归执行约束；Shell 外置不保留第二套面板逻辑。
- ⌘W 与标签 × 结束当前 Pi 进程；working/running/blocked 弹一次确认并把「结束进程」设为默认按钮，done/idle/error 直接结束。`WorkspaceState` 不再维护 backgroundTabs/backgroundOrder，也不存在“已关闭标签但仍在后台”的 UI 状态；退出时选择保留 Pi 由 detach + 下次启动 adopt 完成，与标签关闭无关。
- ⌘K 命令面板由渲染器从项目、会话与命令派生，不持久化查询；⌘J/⇧⌘J 按等待输入 > 错误 > 未读完成 > 运行中排序，跨项目跳转。两者不新增 IPC 或配置文件。
- 会话页是唯一会话入口：`statsVisible` 在列表与统计之间切换，`MonitorPanel` 以 embedded 模式复用；独立 monitor 路由、侧栏入口、⌘⇧M 与原生菜单项已删除。统计筛选（活动时间/运行状态/排序）与列表筛选互不串页，导航历史不再出现 monitor。
- 应用导航只使用含 ⌘ 的组合：⌘↑/↓ 切换侧栏会话，⌘←/→ 切换标签，⌘1–9/0 切换可见项目。单独 Option、Ctrl 及其组合不被应用拦截，保留给 Pi 与文本输入，包括 Pi 的 Ctrl+] 字符跳转。长按 ⌘ 500ms 显示当前配置的导航提示，松开或失焦清理；已打开的 Pi 立即切换，未打开的历史松开后需 Enter 确认。方向导航由 renderer 处理，文本框保留编辑操作；项目编号、菜单和设置共用快捷键定义。旧的不安全绑定加载时逐项丢弃，不影响其他有效自定义；`tests/keyboard-navigation.test.cjs` 与 `tests/shortcuts-navigation.test.cjs` 验证事件透传、冲突和迁移。
- 新手引导复用原生 Dialog 和现有偏好 IPC，只在窗口启动且 `onboardingSeen` 未设置时自动展示；跳过、Esc 或完成均记入 `projects.json`，设置页可重新打开。不自动启动会话、不要求执行快捷键，键帽从当前绑定派生（含禁用项），替代首次使用只能查 README 的负担。存储校验、控制器单测和 `tests/onboarding-smoke.cjs` 验证首次展示、持久化、键盘翻页与模态隔离；CI/回归输出及提交定位责任和上下文。无新文件存储、遥测或后台循环；若后续改为上下文内提示，维护者可整体删除引导组件和此偏好字段，不影响 Pi 数据。
- 项目排序用指针手势替代标题按钮上的原生 HTML 拖放，可从名称/握柄开始、落在展开会话区域；5px 阈值区分点击，拖动后抑制鼠标点击但不影响键盘操作。整组插入线与边缘滚动只在手势中存在，松开、Esc、失焦、pointercancel、丢失捕获或卸载均释放捕获和动画帧。排序复用现有完整置换 IPC 与配置，不新增持久字段；筛选隐藏项不丢失、置顶组不越界。`tests/project-order.test.cjs`（CI）与 `tests/project-drag-smoke.cjs`（发布回归）验证顺序、真实指针、取消与滚动停止，失败日志及提交追溯维护者；无需该交互时可整体删除 hook/握柄/反馈，保留右键排序及原有数据。
- 主题令牌集中在 `styles.css` 的 `:root` 与 sidebar 覆盖块；终端配色独立在 `shared/terminal-theme.ts`，两处共享背景、光标与选区颜色以保持接缝一致。
- 界面文案走 `shared/i18n.ts` 的中文 source key 词表；zh-CN 默认返回原文，en-US 查 `shared/locales/*`。语言偏好由 `publishPreferences` 同步 main/renderer，切换只重渲染，不重启终端；主进程菜单与错误在产生文案时翻译。静态词表/占位符/源码覆盖由 `tests/i18n.test.cjs` 约束，英文运行时无中文残留由 `tests/i18n-smoke.cjs` 验证；维护规则见 `docs/i18n.md`。
- 顶部单行标题与贯穿窗口的侧栏分界线由网格位置约束；回归验证 48px 标题栏、原生按钮安全区、历史图标无障碍名称和主区起始位置，替代旧双层标题与右侧工具块。原生菜单使用可重建的模板图集，测试对齐 SVG 图集顺序、像素及逻辑尺寸；无菜单轮询、外部图标依赖或额外设置。
- `TerminalRegistry` 管理 xterm 实例、GPU 上下文和待挂载输出。输出直接写入终端并确认，不进入 React 状态。OSC 8 网页链接在全屏 Pi 捕获鼠标时由 Pi 打开；本地 OSC 8 链接在全屏下由 Console 截获鼠标事件，按会话工作目录解析并由主进程在 Finder 中定位，不自动执行文件。IPC 校验会话运行身份、路径存在及协议，拒绝远程文件与其他协议；文本选择和普通 URL 保持原行为。无滚轮报告能力的 Pi 不允许 xterm 将滚轮转为上下键；有鼠标协议时仍由 Pi 滚动。`tests/local-link.test.cjs`、`tests/terminal-links.test.cjs`、真实 xterm 和 Pi 冒烟回归验证协议、单一处理方、坐标与滚轮。若上游 Pi 提供安全且具备同等行为的本地链接处理，可删除 Console 的本地拦截和专用 IPC。
- Relay 的 1 MiB 输出环可能丢失启动时的鼠标模式。新 relay 从 PTY 输出增量跟踪鼠标和焦点模式，重接管时在回放后输出权威快照；旧 relay 无快照，仅当回放达到上限且重接管全屏 Pi 时，在回放前补默认模式，后续控制序列仍可关闭或改变模式。这是旧进程状态不可知时的有限假设，不适用于精确恢复旧进程里已进入外部程序的模式。`tests/terminal-mouse-modes.test.cjs`、`tests/relay-client.test.cjs` 和 `npm run test:relay` 验证截断、模式变更与控制字符串；旧 relay 全部退出后可由维护者删除 `legacyPiReplay` 兼容分支。
- 终端实例以运行身份为生命周期边界；切页只改变可见性。隐藏释放 GPU，上下文可按需重建，草稿不重建。
- Effect 在卸载时释放事件订阅、Observer、计时器和终端资源。GUI 拥有的 OS 进程只由主进程管理。

## 安全与验证

preload 在 sandbox 内只加载 Electron；所有其他导入为类型。主进程校验 IPC 来源，并保留输入和文件操作的运行时验证。静态类型不是权限边界。

Electron 回归覆盖真实 PTY、草稿、快捷键、导航与生命周期。诊断状态仅在显式测试模式下暴露，普通窗口不安装该接口。测试不请求模型、不执行真实 Pi 更新。

`src/pi/pi-gui-bridge.ts` 由本机 Pi 加载其 SDK，不纳入桌面 tsc 编译。该边界通过真实 Pi 导航与打包回归验证，不额外安装第二套 Pi。

## 会话宿主与退出

- 每个 Pi 由独立 relay 进程持有 PTY。relay 以 detached 方式启动，通过 `/tmp/pc-<uid>/` 下 0600 的 Unix socket 与主进程通信并校验 token；主进程退出或崩溃不会结束 relay。主进程只持有 socket 客户端，不再直接拥有 PTY。
- 运行状态写入 GUI 配置目录 `sessions/<id>.json`（0600，200ms 去抖），只含进程身份、项目、会话文件、标签、尺寸与状态，不含输入输出或凭据。启动 500ms 后扫描并 attach，relay 重放最多 1MiB 输出，客户端随后触发一次 resize 让 Pi 重绘。
- 退出默认 detach；「结束全部会话…」走进程树终止（TERM/KILL 并核验存活）。不按空闲时间回收；PTY 退出时 relay 清理 socket，SessionStore 删除记录。
- 渲染进程崩溃时主进程先 detach、重载界面并重新 adopt；60 秒内连续崩溃超过 2 次才停止全部受管终端，避免不可见任务与崩溃循环。
- 单测覆盖 relay 客户端与 SessionStore；真实 PTY 由本地 `npm run test:relay`（需要 PTY 权限）覆盖，`tests/lifecycle-smoke.cjs` 继续验证 40 次短 PTY、6 轮标签关闭、FD 基线、xterm 释放及 `--no-session` 不写 JSONL。

## 生命周期与更新

- 主动关闭时先定位其进程树，再 TERM/KILL 并限时核验存活状态；不是只删除 UI 记录。
- 版本查询只有一个缓存和一个在途 Promise；进入设置不重复创建 shell，人工刷新和 Pi 更新完成时失效。单测约束并发、失败及失效竞态。
- 已打包应用默认启动后查询一次 GitHub 公开 Release，此后每次检查完成一小时后再查；设置中关闭后立即取消计时，测试与沙箱不自动联网。只比较 GitHub 发布订阅源中的已发布版本：正式版只看正式版，候选版也看候选版；订阅源只提供最近的 Release，未找到兼容版本时可手动查看发布页。超时、限流或无匹配结果不立即重试，下一次定时检查或人工检查可重试；同一版本每次运行最多提示一次，不覆盖已有会话提醒。结果仅供提示与打开固定 GitHub Release 页面，不下载、执行或替换应用，不上传会话；Pi 与插件更新仍由 `pi update` 在本机执行。`tests/app-release.test.cjs`、`tests/react-state.test.cjs` 与设置回归约束版本、渠道、网络边界、计时退出及错误。未来引入可信签名和完整更新机制后，由维护者删除本提示机制或明确其替代关系。

## 构建与退出

`tsc` 检查全部桌面源码；Node 模块输出到 `build/`，esbuild 生成 React 静态资源。生产环境没有开发服务器或新增 HTTP 端口。

构建替代旧脚本加载链和手工 DOM 更新；`build/` 每次清理重建，可整体删除。Pi 适配只随本应用加载，可连同 `pi/` 模块整体移除。发布工具不参与应用运行，且不绑定仓库所有者。
