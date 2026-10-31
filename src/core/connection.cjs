'use strict';
const { normalizeProvider, AppError } = require('./config.cjs');

async function testConnection(input, fetcher = fetch) {
  const p = normalizeProvider(input);
  if (!p.model) throw new AppError('MODEL_REQUIRED', '连接测试需要服务商实际支持的模型 ID，请从控制台复制。');
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (p.authType === 'api_key') headers['x-api-key'] = p.apiKey;
  else headers.authorization = 'Bearer ' + p.apiKey;
  try {
    const response = await fetcher(p.baseUrl + '/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model: p.model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }] }), redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
    const result = { status: 'failed', httpStatus: response.status, latencyMs: Date.now() - started, model: p.model };
    if (!response.ok) {
      await response.body?.cancel();
      const labels = { 401: '认证失败，请检查密钥与认证类型。', 403: '服务商拒绝访问，请检查账户/模型权限或网络限制。', 404: '接口或模型不存在，请检查 API 基址与模型 ID。', 429: '请求受限或额度不足，请在服务商控制台检查。' };
      return { ...result, message: labels[response.status] || `服务商返回 HTTP ${response.status}。请检查服务状态。` };
    }
    let bytes = 0; const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 128 * 1024) { controller.abort(); return { ...result, message: '响应异常过大，已停止读取。' }; }
      chunks.push(Buffer.from(chunk));
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return { ...result, message: '接口没有返回合法 JSON；可能是网页、登录页或网关拦截。' }; }
    if (data.type !== 'message' || data.role !== 'assistant' || !Array.isArray(data.content) || !data.content.some(c => c.type === 'text' && typeof c.text === 'string' && c.text.trim())) return { ...result, message: 'HTTP 成功，但响应不符合 Anthropic Messages 文本格式。' };
    return { ...result, status: 'passed', message: '一次短文本请求成功。仍需在 VS Code 中打开项目并确认实际对话与工具使用。' };
  } catch (e) {
    return { status: 'failed', latencyMs: Date.now() - started, model: p.model, message: controller.signal.aborted ? '请求超时。请检查网络、服务商状态或已有代理；未自动重试。' : '连接失败（DNS、TLS、重定向或网络拦截）。请检查地址和网络；未自动重试。' };
  } finally { clearTimeout(timer); }
}
module.exports = { testConnection };
