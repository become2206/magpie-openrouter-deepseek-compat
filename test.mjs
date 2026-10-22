import assert from "node:assert/strict";
import test from "node:test";
import { onProvider } from "./openrouter-deepseek-thinking-signature.gateway.mjs";

const target = {
  protocol: "anthropic",
  provider: { id: "openrouter", model: "@preset/best-deepseek-v41-flash-1017" },
};
const tool = { type: "tool_use", id: "probe_1", name: "probe", input: { value: "ok" } };
const result = { type: "tool_result", tool_use_id: "probe_1", content: "ok" };
const request = () => ({
  model: "anthropic/local-alias",
  thinking: { type: "adaptive" },
  tools: [{ name: "probe", input_schema: { type: "object" } }],
  messages: [
    { role: "user", content: "Synthetic test." },
    { role: "assistant", content: [structuredClone(tool)] },
    { role: "user", content: [structuredClone(result)] },
  ],
});

test("adds signature fields to a tool-only turn, preserving input and unrelated fields", () => {
  const input = request();
  const snapshot = structuredClone(input);
  const output = onProvider(input, target);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(output.messages[1].content, [
    { type: "thinking", thinking: " ", signature: "" }, tool,
  ]);
  assert.strictEqual(output.tools, input.tools);
  assert.strictEqual(output.thinking, input.thinking);
  assert.strictEqual(output.messages[2], input.messages[2]);
  assert.equal(output.model, input.model);
  assert.equal(onProvider(output, target), undefined);
});

test("skips every other provider, protocol, and model without mutating data", () => {
  const contexts = [
    { ...target, provider: { id: "deepseek", model: "deepseek-flash" } },
    { ...target, provider: { id: "workbuddy-ai", model: "deepseek-v4.1-flash" } },
    { ...target, provider: { id: "openrouter", model: "@preset/best-glm-53-flash" } },
    { ...target, provider: { id: "openrouter", model: "@preset/best-minimax-m31-flash-free" } },
    { ...target, provider: { id: "openrouter", model: "anthropic/claude-sonnet-5.5" } },
    { ...target, provider: { id: "openrouter", model: "@preset/unknown-deepseek-name" } },
    { ...target, protocol: "chat" },
    { ...target, protocol: "responses" },
    { ...target, protocol: "gemini" },
    {}, undefined,
  ];
  for (const context of contexts) {
    const input = request();
    const snapshot = structuredClone(input);
    assert.equal(onProvider(input, context), undefined);
    assert.deepEqual(input, snapshot);
  }
});

test("allows the explicit legacy preset and native DeepSeek namespace", () => {
  for (const model of ["@preset/best-deepseek-v41-flash", "deepseek/deepseek-v4.1-flash-1017"]) {
    assert.ok(onProvider(request(), { ...target, provider: { id: "openrouter", model } }));
  }
});

test("keeps existing thinking, signatures, and cache fields verbatim", () => {
  for (const signature of ["", "existing-signed-data"]) {
    const input = request();
    input.messages[1].content.unshift({
      type: "thinking", thinking: "Existing thought", signature,
      cache_control: { type: "ephemeral" },
    });
    assert.equal(onProvider(input, target), undefined);
  }
});

test("fills only an absent signature on an existing thinking block", () => {
  const input = request();
  input.messages[1].content.unshift({ type: "thinking", thinking: "Existing thought" });
  const snapshot = structuredClone(input);
  const output = onProvider(input, target);
  assert.deepEqual(output.messages[1].content[0], {
    type: "thinking", thinking: "Existing thought", signature: "",
  });
  assert.deepEqual(input, snapshot);
});

test("preempts the core placeholder on a text answer after tool results", () => {
  const input = request();
  input.messages.push({ role: "assistant", content: [{ type: "text", text: "Done" }] });
  const output = onProvider(input, target);
  assert.deepEqual(output.messages[3].content[0], { type: "thinking", thinking: " ", signature: "" });
  assert.equal(output.messages[3].content[1].text, "Done");
});

test("does not add thinking to ordinary conversation or a mixed user turn", () => {
  for (const content of ["Hello", [result, { type: "text", text: "New question" }]]) {
    const input = { messages: [
      { role: "user", content },
      { role: "assistant", content: [{ type: "text", text: "Answer" }] },
    ] };
    assert.equal(onProvider(input, target), undefined);
  }
});

test("leaves redacted data intact while preempting the core unsigned replacement", () => {
  const input = { messages: [{ role: "assistant", content: [{ type: "redacted_thinking", data: "sealed" }] }] };
  const output = onProvider(input, target);
  assert.equal(output.messages[0].content[0].signature, "");
  assert.strictEqual(output.messages[0].content[1], input.messages[0].content[0]);
});
