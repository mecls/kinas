import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function hub(): string {
  const dir = mkdtempSync(join(tmpdir(), "kinas-conventions-"));
  roots.push(dir);
  return dir;
}

/** readConventions in a child, so a read that never ends is a timeout here rather than this process stuck. */
function inChild(dir: string): { exitCode: number | null; docs: { path: string; title: string | null; length: number; truncated: boolean }[] | null } {
  const code = `const { readConventions } = await import(${JSON.stringify(join(import.meta.dir, "conventions.ts"))});
    const docs = await readConventions(${JSON.stringify(dir)});
    process.stdout.write(JSON.stringify(docs.map((d) => ({ path: d.path, title: d.title, length: d.body.length, truncated: d.truncated }))));`;
  const child = Bun.spawnSync([process.execPath, "-e", code], { timeout: 15_000, killSignal: "SIGKILL" });
  return { exitCode: child.exitCode, docs: child.exitCode === 0 ? JSON.parse(child.stdout.toString()) : null };
}

test("a hub AGENTS.md that is not a regular file is left out, never read: the conventions still come", () => {
  // The hub's AGENTS.md was read whole wherever it pointed. A FIFO never answered, and a link to /dev/zero never ended:
  // the 5 s deadline gave up on the section, but the read went on in the background a gigabyte a second until the
  // packet was done — every `kinas context`, refresh and session hook.
  for (const make of [(p: string) => Bun.spawnSync(["mkfifo", p]).exitCode, (p: string) => Bun.spawnSync(["ln", "-s", "/dev/zero", p]).exitCode]) {
    const dir = hub();
    expect(make(join(dir, "AGENTS.md"))).toBe(0);
    mkdirSync(join(dir, "rules"));
    writeFileSync(join(dir, "rules", "con-commits-9c2e.md"), "# Commits\n\nSay why.\n");
    expect(inChild(dir)).toEqual({ exitCode: 0, docs: [{ path: "rules/con-commits-9c2e.md", title: "Commits", length: 20, truncated: false }] });
  }
}, 60_000);

test("a convention past the 64 KB cut is read only as far as the cut: the rest still come, and memory stays flat", () => {
  // Every convention was read whole and cut afterwards. One of 5 GB — a con-*.md anywhere four levels under the hub,
  // which by default is the projects root — failed the read with ENOMEM, and the whole Conventions section went with
  // it, every rule from every agent's packet; a smaller one still cost its size in memory on every refresh. Sparse here:
  // 256 MB that take no disk, whose whole read shows in the child's peak memory.
  const dir = hub();
  writeFileSync(join(dir, "AGENTS.md"), "# Rules\n");
  mkdirSync(join(dir, "rules"));
  const huge = join(dir, "rules", "con-huge-9c2e.md");
  writeFileSync(huge, "# Huge\n");
  truncateSync(huge, 256 * 1024 * 1024);
  const code = `const { readConventions } = await import(${JSON.stringify(join(import.meta.dir, "conventions.ts"))});
    const before = process.resourceUsage().maxRSS;
    const docs = await readConventions(${JSON.stringify(dir)});
    const grew = process.resourceUsage().maxRSS - before;
    process.stdout.write(JSON.stringify({ grew, docs: docs.map((d) => ({ path: d.path, title: d.title, length: d.body.length, truncated: d.truncated })) }));`;
  const child = Bun.spawnSync([process.execPath, "-e", code], { timeout: 15_000, killSignal: "SIGKILL" });
  expect(child.exitCode).toBe(0);
  const { grew, docs } = JSON.parse(child.stdout.toString());
  expect(docs).toEqual([
    { path: "AGENTS.md", title: "Rules", length: 8, truncated: false },
    { path: "rules/con-huge-9c2e.md", title: "Huge", length: 64 * 1024, truncated: true },
  ]);
  // maxRSS is in kilobytes: well under the 256 MB a whole read takes.
  expect(grew).toBeLessThan(64 * 1024);
}, 30_000);
