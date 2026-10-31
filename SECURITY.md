# 安全报告

当前仅维护最新 Alpha 版本，尚未提供生产安全保证。

发现密钥泄露、路径逃逸、任意命令执行或不安全配置覆盖等问题，请使用仓库 **Security → Report a vulnerability** 私下报告：

https://github.com/THEBLUEGHOSTSSSS/qicheng-claude-deployer/security/advisories/new

请描述受影响版本、复现条件和最小化的假数据示例。不要上传真实密钥或配置备份。如果真实密钥已经泄露，请先在对应服务商撤销或轮换；删除公开内容不能保证秘密已被撤回。

普通使用故障请使用 Issue 模板，并在提交前人工脱敏。不承诺固定响应时限或漏洞奖励。

## 已知边界

- Claude 配置和本地备份可能明文包含密钥。
- CC Switch 深链接携带密钥，仅在使用者确认后发送给本机协议处理程序。
- 当前包未单独代码签名，Windows ACL 和目标机行为仍待验证。
- 文件摘要和配置冲突检查不是针对同用户恶意进程的隔离机制。

更多实现说明见 [集成与安全边界](docs/integration.md)。
