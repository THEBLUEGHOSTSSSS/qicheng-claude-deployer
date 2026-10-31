# 集成与验证边界

## CC Switch

读取的发布版本：v4.0.22，GitHub 官方仓库，2026-10-30。
Windows x64 MSI SHA-256：`3082108e964090380001b65017e544472b8bc39f03b3ccff47f1eaf010bdaa58`。
下载后校验确切长度与 SHA-256，再调用 Windows MSI 安装器。失败不执行安装文件。

采用 `ccswitch://v1/import?resource=provider&app=claude`，所有字段 URL 编码；Anthropic 协议；`enabled=false`；不附带脚本、MCP 或远程配置。

v4.0.22 的 `build_claude_settings` 将链接密钥写入 `ANTHROPIC_AUTH_TOKEN`。因此导入只接收 Bearer 模式；API Key 模式明确停止，避免同时注入两个认证字段。

公开协议没有导入成功回执。部署器只能确认系统接受了打开请求，不能宣布已导入、已启用或可用。用户在 CC Switch 确认后再测试。

不写 `.cc-switch` 数据库，不启动其本地代理，不修改全局代理。项目未包含 CC Switch 代码或二进制；该软件通过官方渠道按需下载，遵循其 MIT 许可。

## 凭据与本机配置

不读取现有密钥到界面，不写页面存储，不打印表单或服务响应。配置检查输出布尔状态与最小摘要；报告使用明确字段白名单。测试参数中只含用户当次填写的 API Key，只有点击确认后才向填写的 HTTPS 地址发送。

Claude Code 的 `settings.json` 以及本项目备份使用明文。这是客户端配置约定，不声称加密保管。macOS/POSIX 使用受限文件模式；Windows 权限依赖用户目录继承 ACL，尚未做目标平台 ACL 验证。

文件写入：拒绝链接/硬链接的配置路径；备份原字节、校验摘要、临时文件写入后原子替换；预览快照与保存前状态不一致就停止。恢复只允许当前文件匹配本次写入摘要，不覆盖后续编辑。该机制不是针对同用户恶意竞态的 OS 隔离；实际使用应关闭其他会写配置的工具。

不覆盖 `apiKeyHelper` 或既有云平台认证。检测到 `CLAUDE_CONFIG_DIR` 时停止写入，避免写错目录。工作区配置、企业托管策略和其他客户端设置的完整优先级仍需在目标电脑核验。

## 桌面与安装入口

Electron renderer 开启 contextIsolation 和 sandbox，关闭 Node；preload 仅传受限动作，主进程再次校验来源与参数。只加载打包的本地资源，阻止任意导航/新窗口/权限请求。外链只允许固定文档和经过构造的协议链接。

安装只接受组件 ID；WinGet ID、扩展 ID、MSI 来源及参数均来自固定清单，不把用户表单拼入 shell。用户明确确认后才执行。WinGet 安装接受对应软件安装协议；部署器不申请远程操作或支付权限。

## 请求测试

HTTPS，固定 `/v1/messages`，一个请求，固定短文本，`max_tokens=16`，15 秒请求超时和 128 KiB 响应上限。禁止携带认证的 HTTP 重定向。HTTP 200 还须满足 Messages assistant 文本结构；不保存回复正文。

请求成功不证明模型身份、工具行为、账户长期额度、全部网络场景或桌面客户端可用。代理由 Electron/系统实际网络栈决定，可能与 Claude CLI 不同；本项目不改变系统代理和 TLS 校验。

## Windows 交付

ZIP 自带 Electron 运行时，不要求用户安装开发环境。外部组件仍需联网。构建平台是 macOS；没有 Windows 虚拟机或目标机器的实测回执时，状态保持“待目标验收”。不把静态检查、ZIP 解压、PE 头、截图或模拟宿主测试当作 Windows 实测。
