'use strict';
function reportFor(status, connection) {
  // Explicit schema: never serialize settings, form payloads, URLs with credentials, or subprocess output.
  return {
    schemaVersion: 1, application: 'Qicheng Claude Deployer', version: status.appVersion,
    exportedAt: new Date().toISOString(), targetPlatform: 'Windows 10/11 x64',
    observed: { platform: status.platform, arch: status.arch, osVersion: status.osVersion, supported: status.supported, preview: status.preview },
    components: status.components.map(c => ({ id: c.id, status: c.status, version: c.version })),
    configuration: { exists: status.config.exists, valid: status.config.valid, hasKey: status.config.hasKey },
    connection: connection ? { status: connection.status, httpStatus: connection.httpStatus ?? null, latencyMs: connection.latencyMs ?? null, checkedAt: connection.checkedAt } : { status: 'not_tested' },
    limits: ['配置存在不代表模型调用成功。', '短文本 API 成功不代表客户端登录、工具调用或所有模型可用。', '未包含密钥、配置备份、用户路径、服务商返回正文或聊天记录。']
  };
}
module.exports = { reportFor };
