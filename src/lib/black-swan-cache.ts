/**
 * 黑天鹅分析结果本地 JSON 文件缓存（仅 Node 环境）。
 * 优先读缓存，过期或不存在时重新拉取并写入。部署到 Cloudflare Workers 时无 fs，需改用 KV 等。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const CACHE_DIR = ".cache";
const CACHE_FILE = "black-swan.json";
const TTL_MS = 5 * 60 * 1000; // 5 分钟

export type CachedPayload = {
  summary: unknown;
  metrics: unknown;
  meta: unknown;
  osintPosts: unknown[];
};

function getCachePath(): string {
  return join(process.cwd(), CACHE_DIR, CACHE_FILE);
}

export function readCache(): CachedPayload | null {
  try {
    const path = getCachePath();
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as { cachedAt: number; payload: CachedPayload };
    if (Date.now() - data.cachedAt > TTL_MS) return null;
    return data.payload;
  } catch {
    return null;
  }
}

/** 读取缓存并返回 payload 与时间戳，不做过期判断，供「30 分钟内是否有效」等逻辑使用 */
export function readCacheWithMeta(): { payload: CachedPayload; cachedAt: number } | null {
  try {
    const path = getCachePath();
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as { cachedAt: number; payload: CachedPayload };
    return { payload: data.payload, cachedAt: data.cachedAt };
  } catch {
    return null;
  }
}

export function writeCache(payload: CachedPayload): void {
  try {
    const dir = join(process.cwd(), CACHE_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = getCachePath();
    const data = { cachedAt: Date.now(), payload };
    writeFileSync(path, JSON.stringify(data), "utf-8");
  } catch {
    // 写入失败静默忽略
  }
}

/** 当前运行环境是否有 fs（Node），无则不可用缓存 */
export function isCacheAvailable(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null;
}
