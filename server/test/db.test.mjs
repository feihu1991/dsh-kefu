// SQLite 数据层冒烟测试：跨进程回合租约的互斥与过期行为。
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KefuStore } from "../src/db.js";

const dir = mkdtempSync(join(tmpdir(), "kefu-db-"));
const store = new KefuStore(join(dir, "k.sqlite"));
try {
  assert.equal(store.acquireTurnLock("c1", "owner-a", 60_000), true, "首次获取租约成功");
  assert.equal(store.acquireTurnLock("c1", "owner-b", 60_000), false, "未过期时第二个 owner 获取失败");
  store.releaseTurnLock("c1", "owner-b");
  assert.equal(store.acquireTurnLock("c1", "owner-b", 60_000), false, "错误 owner 不能释放租约");
  store.releaseTurnLock("c1", "owner-a");
  assert.equal(store.acquireTurnLock("c1", "owner-b", 60_000), true, "正确 owner 释放后可重新获取");

  // 模拟进程崩溃：租约过期后其它实例可接管
  store.db.prepare("UPDATE turn_locks SET expires_at = 0 WHERE conversation_id = ?").run("c1");
  assert.equal(store.acquireTurnLock("c1", "owner-c", 60_000), true, "租约过期后可被其它实例接管");
  store.releaseTurnLock("c1", "owner-c");
  console.log("TURN LOCK CHECKS PASSED");
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
