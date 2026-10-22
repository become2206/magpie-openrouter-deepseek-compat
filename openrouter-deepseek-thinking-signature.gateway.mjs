// Magpie · OpenRouter DeepSeek 兼容插件
// 为 OpenRouter → DeepSeek 提供 Anthropic Messages 格式兼容，补齐缺失的 thinking.signature。
// 仅匹配 OpenRouter → DeepSeek；已有签名、思考内容和工具数据保持不变。
// Normalize thinking placeholder signatures for Magpie 0.1.1318.
// onProvider runs after routing but before Magpie's DeepSeek compatibility pass.
// Only OpenRouter + Anthropic Messages + the DeepSeek models below are in scope.
const DEEPSEEK_PRESETS = [
  "@preset/best-deepseek-v41-flash-1017",
  "@preset/best-deepseek-v41-flash",
];

function isTarget(ctx) {
  if (!ctx || ctx.protocol !== "anthropic" || !ctx.provider) return false;
  if (ctx.provider.id !== "openrouter") return false;
  const model = ctx.provider.model;
  return typeof model === "string" && (
    model.indexOf("deepseek/") === 0 || DEEPSEEK_PRESETS.indexOf(model) !== -1
  );
}

export function onProvider(body, ctx) {
  if (!isTarget(ctx) || !body || !Array.isArray(body.messages)) return;

  let changed = false;
  let afterToolResults = false;
  const messages = body.messages.slice();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message !== "object") {
      afterToolResults = false;
      continue;
    }
    const content = message.content;
    if (message.role !== "assistant") {
      afterToolResults = message.role === "user" && Array.isArray(content) &&
        content.length > 0 && content.every(block => block && block.type === "tool_result");
      continue;
    }

    const followsToolResults = afterToolResults;
    afterToolResults = false;
    if (!Array.isArray(content)) continue;

    const hasThinking = content.some(block => block && block.type === "thinking");
    const hasTool = content.some(block => block && block.type === "tool_use");
    const hasRedactedThinking = content.some(block => block && block.type === "redacted_thinking");
    let edited = false;
    const blocks = content.map(block => {
      // Existing signatures, including empty strings, are kept verbatim.
      if (block && block.type === "thinking" &&
          !Object.prototype.hasOwnProperty.call(block, "signature")) {
        edited = true;
        return Object.assign({}, block, { signature: "" });
      }
      return block;
    });

    if (!hasThinking && (hasTool || followsToolResults || hasRedactedThinking)) {
      // Preempt the core's placeholder with an OpenRouter-valid equivalent.
      // This is an empty compatibility placeholder, not fabricated reasoning.
      blocks.unshift({ type: "thinking", thinking: " ", signature: "" });
      edited = true;
    }

    if (edited) {
      messages[i] = Object.assign({}, message, { content: blocks });
      changed = true;
    }
  }

  // Undefined tells Magpie to retain the original bytes for unchanged requests.
  if (changed) return Object.assign({}, body, { messages });
}
