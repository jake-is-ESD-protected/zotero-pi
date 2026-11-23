import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SandboxAccess } from "../extensions/zotero/access.ts";

test("saved sandbox read/write rules are honored, denies take precedence", async () => {
	const guard = new SandboxAccess({ cwd: "/project", global: { filesystem: { allowRead: ["/pdfs"], allowWrite: ["/pdfs"], denyWrite: ["*.key"] } } });
	await guard.read("/pdfs/a.pdf"); await guard.write("/pdfs/a.pdf.md");
	await assert.rejects(guard.write("/pdfs/secret.key"), /denyWrite/);
	await assert.rejects(guard.read("/outside/a.pdf"), /Sandbox approval required/);
	await assert.rejects(guard.write("/outside/a.pdf"), /Sandbox approval required/);
});
test("local sandbox arrays extend global rules; empty arrays do not restore defaults", async () => {
	const guard = new SandboxAccess({ cwd: "/project", global: { filesystem: { allowRead: ["/one"], allowWrite: [] } }, project: { filesystem: { allowRead: ["/two"] } } });
	await guard.read("/one/a"); await guard.read("/two/b");
	await assert.rejects(guard.write("/project/a"), /approval required/);
});
test("network allow/deny matching applies to localhost and external hosts", () => {
	const guard = new SandboxAccess({ cwd: "/project", global: { network: { allowedDomains: ["127.0.0.1", "*.example.org"], deniedDomains: ["blocked.example.org"] } } });
	guard.domain("127.0.0.1"); guard.domain("docs.example.org");
	assert.throws(() => guard.domain("blocked.example.org"), /deniedDomains/);
	assert.throws(() => guard.domain("other.org"), /approval required/);
});
test("sandbox disabled bypasses own policy, not the operating system", async () => {
	const guard = new SandboxAccess({ cwd: "/project", enabled: false });
	await guard.read("/elsewhere"); await guard.write("/elsewhere"); guard.domain("example.org");
});
test("symlinks cannot escape an allowed PDF directory", async t => {
	const dir = await mkdtemp(join(tmpdir(), "zotero-access-")); t.after(() => rm(dir, { recursive: true, force: true }));
	await mkdir(join(dir, "allowed")); await mkdir(join(dir, "outside")); await symlink(join(dir, "outside"), join(dir, "allowed", "escape"));
	const guard = new SandboxAccess({ cwd: dir, global: { filesystem: { allowRead: [join(dir, "allowed")], allowWrite: [join(dir, "allowed")] } } });
	await assert.rejects(guard.read(join(dir, "allowed", "escape", "file")), /approval required/);
	await assert.rejects(guard.write(join(dir, "allowed", "escape", "file")), /approval required/);
});
