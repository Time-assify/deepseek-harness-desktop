# DeepSeek Harness 桌面版

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的非官方桌面客户端。基于 Electron 封装官方 Web UI，双击即用，无需命令行。

> 注意：DeepSeek Harness 目前处于 developer preview 阶段，上游可能有破坏性变更。本应用将 `@deepseek-ai/dsh` 锁定为 `0.1.1-rc.2` 精确版本。

## 特性

- **开箱即用**：启动时自动拉起内置的 dsh Web 服务（监听 127.0.0.1，端口自动选择），就绪后窗口内加载官方 Web UI
- **无边框界面**：主窗口无系统边框，顶部自绘标题栏（浅色/深色主题快速切换、Windows 风格窗口控制、插件/仪表盘/设置快捷入口）
- **深色/浅色主题**：一键切换，标题栏、设置/插件/仪表盘及官方 Web UI 全部同步
- **系统托盘**：关闭主窗口最小化到托盘，托盘右键菜单（显示主窗口 / 设置 / 插件商店 / 仪表盘 / 重启服务 / 退出），左键单击/双击恢复窗口
- **图形化设置**：API Key 写入 `~/.dsh/.env`（与官方 CLI 共享配置），可选自定义 API 地址与端口
- **多配置切换**：把常用配置（Key / API 地址 / 端口）保存为命名方案，一键切换自动重启
- **插件商店**：内置 npm 市场搜索（关键词 `dsh-plugin`），展示发布者/最近更新/月下载量，支持相关度 / 热门 / 最新排序，一键安装/卸载插件到 web profile（内置 pnpm，无需用户安装 Node/pnpm），安装后自动同步 `dsh.profile.bundles` 并重启服务
- **会话成本仪表盘**：解析 `~/.dsh/sessions` 的 zstd 会话日志，统计每个会话的输入/缓存/输出 token 与成本估算（按 DeepSeek 官方价格）
- **便携版**：应用目录放一个 `portable.txt`（或设置环境变量 `DSH_DESKTOP_PORTABLE=1`），所有数据（dsh 数据 + 应用设置）都保存在应用目录的 `data\` 下，U 盘随身带
- **进程托管**：dsh 作为子进程随应用启停，退出时清理整个进程树，不留孤儿进程
- **启动页 + 实时日志**：启动过程中显示服务日志，失败时可诊断
- **与官方 CLI 完全兼容**：共享 `~/.dsh` 数据目录，CLI 和桌面端看到相同的会话、插件与配置
- **单实例**：重复启动自动聚焦已有窗口

## 系统要求

- Windows 10/11（x64）
- [Node.js](https://nodejs.org/) `^22.19 || >=24`（开发/打包需要）
- [pnpm](https://pnpm.io/) ≥ 10（开发/打包需要）
- 可选：DeepSeek API Key（没有也能打开界面，发送消息前配置即可）

## 获取与快速开始（开发）

```sh
# 1. 克隆本仓库并进入目录
git clone https://github.com/Time-assify/deepseek-harness-desktop.git
cd deepseek-harness-desktop

# 2. 安装依赖
pnpm install --config.minimumReleaseAge=0

# 3. 启动
pnpm start
```

> 不想用 git？也可以直接点击仓库页面的绿色 **Code → Download ZIP** 下载解压，然后执行第 2、3 步。

> 锁文件里的包发布较新时，pnpm 11 的 minimumReleaseAge 供应链策略可能拒绝安装，用 `--config.minimumReleaseAge=0` 跳过（仓库内 `pnpm-workspace.yaml` 已配置 `minimumReleaseAgeStrict: false`，通常不需要）。

## 打包

```sh
pnpm run dist        # 生成 NSIS 安装包 + 便携版 exe（release/ 目录）
pnpm run dist:dir    # 仅生成免安装目录，用于快速验证
```

打包产物依赖 electron-builder 下载辅助二进制，国内网络可提前设置：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

## 工作原理

```
Electron 主进程
├─ 主窗口（无边框 BrowserWindow）
│   ├─ 标题栏 titlebar.html（WebContentsView：主题切换 / 窗口控制 / 快捷入口）
│   ├─ 内容区（WebContentsView）
│   │   ├─ 启动页 loading.html（日志 + 状态 + 功能入口）
│   │   └─ 就绪后加载 http://127.0.0.1:<port>（官方 Web UI）
│   └─ 系统托盘 Tray
├─ 设置窗口 settings.html（API Key / Base URL / 端口 / 配置方案）
├─ 插件商店窗口 plugins.html（npm 搜索 + 元数据 + 排序 + 安装/卸载）
├─ 仪表盘窗口 dashboard.html（会话 token 统计 + 成本估算）
└─ dsh 子进程
    └─ electron.exe（ELECTRON_RUN_AS_NODE=1）--expose-internals
        node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --host 127.0.0.1 --port <n>
```

要点：

- 复用 Electron 自带的 Node 运行时启动 dsh，**不要求用户单独安装 Node**
- 传递 `--expose-internals`：dsh 的 cordis loader 需要访问 Node 内部 ESM loader 来解析用户 profile 的插件；否则它会退回 `node-addon-require-builtin` 原生模块，而该模块的二进制只匹配系统 Node ABI，在 Electron 下加载失败
- 端口默认 0（由操作系统分配），从 dsh 的 `dsh web: http://...` 就绪输出行解析实际 URL
- 插件安装复用内置的 pnpm 包（`node_modules/pnpm/bin/pnpm.cjs`），在 profile 目录执行 `add`/`remove`，再按官方规则同步 `dsh.profile.bundles`（声明 `dsh.bundle.patch` 的依赖自动进层，反之移除）
- 会话日志为**多帧 zstd** 格式（`session.jsonl.zstd`），按 magic 切帧后用 Node 内置 `node:zlib` 解压，从 `assistant/chunk` 的 usage 事件累计 token

## 数据与配置位置

| 内容 | 位置 |
| --- | --- |
| dsh 数据（会话、插件 profile、凭据） | `~/.dsh`（便携版：`<应用目录>\data\dsh`） |
| API Key | `~/.dsh/.env`（`DEEPSEEK_API_KEY=...`） |
| 本应用设置（端口、Base URL、配置方案） | `%APPDATA%\DeepSeek Harness\settings.json`（便携版：`<应用目录>\data\userData`） |
| dsh 用户插件 profile | `~/.dsh/profiles/web/` |

## 成本估算口径

- 价格表（每百万 token，人民币）：deepseek-chat 输入 ¥2 / 缓存读 ¥0.5 / 输出 ¥8；deepseek-reasoner 输入 ¥4 / 缓存读 ¥1 / 输出 ¥16
- 输入成本 =（输入 - 缓存读）× 输入价 + 缓存读 × 缓存读价；无法识别的模型按 deepseek-chat 估算，仅供参考

## License

[MIT](LICENSE)

本应用封装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT License），版权归 DeepSeek AI 所有；本项目与 DeepSeek AI 无隶属关系。
