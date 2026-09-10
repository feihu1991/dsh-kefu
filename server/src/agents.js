// dsh-kefu — 店员 Agent 运行时：基于 DSH 的 ctx.agents（create/resume）执行客服对话
import { createUserMessage } from "@deepseek-ai/dsh-llm";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const CHUNK_MERGE_MS = 60; // 60ms 内合并 chunk，降低推送频率

/**
 * 收集一轮会话事件：流式文本增量 + 最终文本 + usage + 回合结束状态 + 错误详情。
 */
function collectTurn(agent, onChunk) {
  const state = { text: "", reasoning: "", usage: null, turnEnded: false, turnReason: null, errorDetail: null };
  const queue = { text: "", reasoning: "" };
  let timer = null;

  const flush = () => {
    if (!queue.text && !queue.reasoning) return;
    onChunk?.(queue.text, queue.reasoning);
    queue.text = "";
    queue.reasoning = "";
  };

  const listener = (session, event) => {
    switch (event.type) {
      case "assistant/chunk": {
        const c = event.data?.chunk;
        if (c?.type === "text-delta") queue.text += c.text;
        else if (c?.type === "reasoning-delta") queue.reasoning += c.text;
        else if (c?.type === "usage") state.usage = c.usage;
        if (queue.text || queue.reasoning) {
          if (!timer) timer = setTimeout(() => { timer = null; flush(); }, CHUNK_MERGE_MS);
        }
        break;
      }
      case "assistant/message": {
        const blocks = event.data?.message?.content ?? [];
        const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
        if (text) state.text = text;
        if (event.data?.usage) state.usage = event.data.usage;
        break;
      }
      case "turn/end": {
        state.turnEnded = true;
        state.turnReason = event.data?.reason?.kind ?? "completed";
        break;
      }
    }
  };
  const errorListener = (...args) => {
    const ev = args[args.length - 1];
    if (ev?.error?.message) state.errorDetail = String(ev.error.message);
  };
  const errorDisposer = agent.ctx.on("agent/error", errorListener);

  return {
    state,
    listener,
    stop: () => {
      errorDisposer();
      if (timer) { clearTimeout(timer); flush(); }
    },
  };
}

/**
 * 运行一轮客服对话。首次消息 create 该会话的 DSH Agent；之后 resume 恢复历史。
 *
 * @param {object} deps - { ctx, store, config }
 * @param {object} params
 * @param {object} params.merchant - 商家行
 * @param {object} params.agent - 店员 Agent 行
 * @param {object} params.conversation - 会话行（含 dsh_session_id、meta.started）
 * @param {string} params.content - 顾客消息文本
 * @param {(text: string, reasoning: string) => void} [params.onChunk] - 流式回调
 * @returns {Promise<{text: string, usage: object|null, turnReason: string}>}
 */
export async function runConversationTurn({ ctx, store, config }, { merchant, agent, conversation, content, onChunk }) {
  const tier = agent.tier_id ? store.getTier(agent.tier_id) : null;
  const provider = tier?.provider ?? config.defaultTier?.provider ?? "deepseek-official";
  const model = tier?.model ?? config.defaultTier?.model ?? "deepseek-v4-flash";
  const maxTokens = tier?.max_tokens ?? undefined;
  const sessionId = conversation.dsh_session_id;
  const cwd = merchant.data_dir;

  const agentOptions = { provider, model };
  if (maxTokens) agentOptions.maxTokens = maxTokens;
  // 知识库检索：把与顾客问题相关的商家资料注入人设（RAG v1，FTS5）
  let knowledge = [];
  try {
    knowledge = store.searchKnowledge(merchant.id, agent.id, content, 5);
  } catch (err) {
    ctx.logger?.warn?.(`[kefu] knowledge search failed: ${err?.message}`);
  }
  const persona = buildPersona(agent, merchant, tier, knowledge);

  // 第一次消息 -> create；之后 -> resume（会话由 DSH 持久化）
  const handle = conversation.meta?.started
    ? await ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions,
        setup: (agentCtx) => registerPersona(agentCtx, persona),
      })
    : await ctx.agents.create({
        sessionId,
        meta: { cwd, agentPreset: "kefu-agent" },
        agentOptions,
        setup: (agentCtx) => registerPersona(agentCtx, persona),
      });

  const agent_ = handle.agent;
  const { state, listener, stop } = collectTurn(agent_, onChunk);
  agent_.ctx.on("session/event", listener);

  try {
    const msg = createUserMessage({
      content: [{ type: "text", text: content }],
      source: { kind: "user", channel: "kefu" },
    });
    agent_.send(msg, "next-turn", true);

    const timeoutMs = config.agentTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    while (!state.turnEnded) {
      if (Date.now() > deadline) {
        agent_.cancel({ kind: "hook", reason: "kefu: turn timeout" }, { keepInbox: false });
        throw Object.assign(new Error("客服响应超时"), { code: "AGENT_TIMEOUT" });
      }
      await agent_.whenIdle();
      if (!state.turnEnded) {
        // 可能仍有后续唤醒（工具调用链等），让出事件循环再等
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (state.turnReason !== "completed") {
      const detail = state.errorDetail ? `（${state.errorDetail}）` : "";
      throw Object.assign(new Error(`客服回合未正常完成：${state.turnReason}${detail}`), { code: `TURN_${String(state.turnReason).toUpperCase()}` });
    }
    return { text: state.text.trim(), usage: state.usage, turnReason: state.turnReason };
  } finally {
    stop();
    try {
      await handle.dispose();
    } catch {
      // 释放失败不影响结果
    }
  }
}

/** 拼装 system prompt 人设（商家 + 店员 + 档位 + 知识库参考） */
function buildPersona(agent, merchant, tier, knowledge = []) {
  const parts = [];
  parts.push(`你是「${merchant.name}」店铺的在线客服「${agent.name}」。`);
  if (tier) parts.push(`你的服务等级：${tier.name}。`);
  if (agent.persona) parts.push(agent.persona);
  if (knowledge.length > 0) {
    parts.push("店铺知识库资料是权威依据：回答必须优先依据资料，资料明确写明的信息（如快递公司、发货时限、退换政策、优惠力度）要直接照实回答，不得含糊、不得自行编造；资料未覆盖的问题才说明无法确认并建议转人工。资料如下：");
    for (const doc of knowledge) {
      parts.push(`【${doc.title}】${doc.content}`);
    }
  }
  parts.push(
    "工作要求：礼貌、简洁、准确地回答顾客问题；不确定的事情不要编造，主动说明并建议转人工；回答使用与顾客相同的语言。"
  );
  return parts.join("\n");
}

/** 在 Agent 作用域内注册人设 system prompt section */
function registerPersona(agentCtx, persona) {
  // 1) 遮蔽全局身份 section（同名 scoped section 优先）
  agentCtx.systemPrompt?.section({
    name: "harness:identity",
    order: -100,
    text: "You are an AI customer-service assistant. Reply in the customer's language, keep answers concise and friendly.",
  });
  agentCtx.systemPrompt?.section({
    name: "app:web-surface",
    order: -98,
    text: "",
  });
  // 2) 人设/话术
  agentCtx.systemPrompt?.section({
    name: "kefu:persona",
    order: -50,
    text: persona,
  });
  // 3) 抑制动态运行时上下文（工作区/工具提示等噪音）
  agentCtx.systemPrompt?.suppressRuntimeContext?.();
  // 4) 客服 Agent 不需要任何 DSH 工具 —— 用 allow: [] 白名单全部禁用。
  //    restrict 不存在或调用失败时必须让本轮接待失败（fail-closed），
  //    绝不能吞掉错误后让 Agent 带着 bash/fs/web 等工具继续运行。
  if (typeof agentCtx.tools?.restrict !== "function") {
    throw new Error("dsh-kefu: 当前 DSH 不支持 tools.restrict，无法保证客服 Agent 不调用工具，已拒绝本次接待");
  }
  agentCtx.tools.restrict({ allow: [] });
}
