// Agent 运行时冒烟测试：验证客服 Agent 的工具白名单为 allow: []，
// 且 DSH 不支持 restrict 时 fail-closed（拒绝本轮接待）。
import assert from "node:assert/strict";
import { runConversationTurn } from "../src/agents.js";

function makeStore() {
  return {
    getTier: () => null,
    searchKnowledge: () => [],
  };
}

async function runWith(agentCtxTools) {
  let listener;
  const agentObj = {
    ctx: {
      on(event, fn) {
        if (event === "session/event") listener = fn;
        return () => {};
      },
    },
    send() {
      queueMicrotask(() => listener(null, {
        type: "assistant/message",
        data: { message: { content: [{ type: "text", text: "好的" }] } },
      }));
      queueMicrotask(() => listener(null, {
        type: "turn/end",
        data: { reason: { kind: "completed" } },
      }));
    },
    whenIdle: async () => {},
    cancel() {},
  };
  const ctx = {
    logger: { warn() {}, error() {} },
    agents: {
      create: async ({ setup }) => {
        const agentCtx = {
          systemPrompt: { section() {}, suppressRuntimeContext() {} },
          tools: agentCtxTools,
        };
        await setup(agentCtx);
        return { agent: agentObj, dispose: async () => {} };
      },
    },
  };
  return runConversationTurn({ ctx, store: makeStore(), config: { agentTimeoutMs: 1000 } }, {
    merchant: { id: "m1", name: "店铺A", data_dir: "/tmp" },
    agent: { id: "a1", name: "客服A", persona: "", tier_id: null },
    conversation: { dsh_session_id: "s1", meta: {} },
    content: "你好",
  }).then((result) => ({ result, restrictArgs: agentCtxTools.lastArgs }));
}

const happy = await runWith({
  restrict(args) { this.lastArgs = args; return () => {}; },
});
assert.deepEqual(happy.restrictArgs, { allow: [] }, "tools.restrict 必须使用 allow: [] 白名单");
assert.equal(happy.result.text, "好的", "正常回合应返回模型文本");

await assert.rejects(
  () => runWith({}),
  /不支持 tools\.restrict|tools\.restrict/,
  "DSH 不支持 tools.restrict 时必须 fail-closed",
);

console.log("AGENT TOOL ISOLATION CHECKS PASSED");
