/**
 * 正在发生事件事记：存于 Cloudflare KV（wrangler 绑定 OSINT_POINTER_KV）。
 * 本地与部署都走 wrangler 配置的 KV 绑定，无需 REST API / API Token。
 */

const KV_KEY_ONGOING = "ongoing";

export type OngoingEntry = {
  topic: string;
  lastSeen: number;
  summary?: string;
};

export type OngoingState = {
  updateId: number;
  events: OngoingEntry[];
};

/** wrangler 绑定的 KV 接口（get/put） */
export type KvBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

const MAX_UPDATES_WITHOUT_MENTION = 6;

/** 从 KV 读取事记，读失败返回 null。 */
export async function getOngoingState(kv: KvBinding): Promise<OngoingState | null> {
  try {
    const raw = await kv.get(KV_KEY_ONGOING);
    if (raw == null) return null;
    const data = JSON.parse(raw) as OngoingState;
    if (typeof data.updateId !== "number" || !Array.isArray(data.events)) return null;
    return data;
  } catch {
    return null;
  }
}

/** 写入事记到 KV，写失败静默忽略。 */
export async function putOngoingState(state: OngoingState, kv: KvBinding): Promise<void> {
  try {
    await kv.put(KV_KEY_ONGOING, JSON.stringify(state));
  } catch (e) {
    console.warn("[ongoing-kv] put error:", e);
  }
}

/** 剔除超过 6 次更新未提及的条目，返回新 state（不修改原对象）。 */
export function pruneOngoingEvents(state: OngoingState): OngoingState {
  const nextId = state.updateId + 1;
  const events = state.events.filter(
    (e) => nextId - e.lastSeen <= MAX_UPDATES_WITHOUT_MENTION
  );
  return { updateId: state.updateId, events };
}

/** 格式化为发给 LLM 的简短上下文（省 token）。 */
export function formatOngoingContext(state: OngoingState): string {
  if (state.events.length === 0) return "";
  const lines = state.events.map((e) => (e.summary ? `${e.topic}: ${e.summary}` : e.topic));
  return lines.join("；");
}

/** 从本轮 LLM 返回的持续事件更新事记，并递增 updateId。返回新 state。 */
export function mergeOngoingFromEvents(
  state: OngoingState,
  ongoingEvents: Array<{ parentTopic?: string; title?: string; causeEffect?: string }>
): OngoingState {
  const nextId = state.updateId + 1;
  const byTopic = new Map<string, OngoingEntry>();
  for (const e of state.events) {
    byTopic.set(e.topic, { ...e });
  }
  for (const ev of ongoingEvents) {
    const topic = (ev.parentTopic || ev.title || "").trim();
    if (!topic) continue;
    const summary = (ev.causeEffect || ev.title || "").slice(0, 80);
    byTopic.set(topic, {
      topic,
      lastSeen: nextId,
      summary: summary || undefined,
    });
  }
  return {
    updateId: nextId,
    events: [...byTopic.values()],
  };
}
