import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { featureLine, featuresOf, parseStatus } from "./features.ts";

// Features in progress (build spec §11.4 features.test.ts, AC-19): a status at Gate 1 in progress is listed; all
// approved and ticked is not; a nested `  - Mockups:` is not a gate; `_templates` is skipped; garbage reads
// `status unreadable`.

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const GATE_ONE = `# Status: a
- Gate 1 · Product: in progress
  - Mockups: pending
- Gate 2 · Architecture: pending

## Slices
- [ ] Slice 1 · tracer bullet: x
`;

const DONE = `# Status: b
- Gate 1 · Product: APPROVED 2026-09-23
  - Mockups: APPROVED 2026-09-23
- Gate 2 · Architecture: APPROVED 2026-09-23, twice — see the notes
- Gate 3 · Program design: APPROVED 2026-09-24
- Gate 4 · Slice plan: APPROVED 2026-09-24

## Slices
- [x] Slice 1 · tracer bullet: a card
- [x] Slice 2 · installed
`;

test("a nested line is not a gate, and the first unapproved gate is the line", () => {
  const s = parseStatus(GATE_ONE)!;
  expect(s.gates.map((g) => g.name)).toEqual(["Product", "Architecture"]);
  expect(featureLine(s)).toBe("Gate 1 · Product in progress");
  expect(featureLine(parseStatus(DONE))).toBeNull();
  expect(featureLine(parseStatus("garbage with no gates"))).toBe("status unreadable");
});

test("all gates approved: the first slice not ticked, counted", () => {
  const mid = DONE.replace("- [x] Slice 2 · installed", "- [ ] Slice 2 · installed\n- [ ] Slice 3 · launchable");
  expect(featureLine(parseStatus(mid))).toBe("slice 2 of 3 — Slice 2 · installed");
  expect(featureLine(parseStatus(DONE.replace("Gate 3 · Program design: APPROVED 2026-09-24", "Gate 3 · Program design: in progress (§11)")))).toBe(
    "Gate 3 · Program design in progress",
  );
});

test("featuresOf reads each project's tasks, skipping the templates and the finished", () => {
  const root = mkdtempSync(join(tmpdir(), "kinas-features-"));
  roots.push(root);
  const write = (project: string, slug: string, text: string) => {
    mkdirSync(join(root, project, "tasks", slug), { recursive: true });
    writeFileSync(join(root, project, "tasks", slug, "status.md"), text);
  };
  write("p-9c2e", "a-9c2e", GATE_ONE);
  write("p-9c2e", "b-9c2e", DONE);
  write("p-9c2e", "c-9c2e", "\u0000not a status\u0000");
  write("p-9c2e", "_templates", GATE_ONE);
  mkdirSync(join(root, "q-9c2e"), { recursive: true });
  const features = featuresOf([
    { name: "p-9c2e", path: join(root, "p-9c2e") },
    { name: "q-9c2e", path: join(root, "q-9c2e") },
    { name: "gone-9c2e", path: join(root, "gone-9c2e") },
  ]);
  expect(features).toEqual([
    { project: "p-9c2e", slug: "a-9c2e", line: "Gate 1 · Product in progress" },
    { project: "p-9c2e", slug: "c-9c2e", line: "status unreadable" },
  ]);
});

test("a status file saved with CRLF line endings reads as the same file with LF, not as unreadable", () => {
  // An editor that saves `\r\n` (or a checkout with core.autocrlf) leaves a `\r` at each line's end, and a JavaScript
  // `.` never matches it: every gate line failed, and a feature at Gate 1 read "status unreadable".
  const crlf = (text: string) => text.replaceAll("\n", "\r\n");
  expect(featureLine(parseStatus(crlf(GATE_ONE)))).toBe("Gate 1 · Product in progress");
  expect(featureLine(parseStatus(crlf(DONE)))).toBeNull();
  const mid = DONE.replace("- [x] Slice 2 · installed", "- [ ] Slice 2 · installed");
  expect(featureLine(parseStatus(crlf(mid)))).toBe("slice 2 of 2 — Slice 2 · installed");
});

test("a status.md that is not a regular file reads `status unreadable` at once, and is never opened", () => {
  // A repository can hold `tasks/x/status.md` as a symlink to /dev/zero, and a folder can hold a FIFO by that name. The
  // size check passed both (a device and a FIFO stat as 0 bytes), and readFileSync then never returned: /dev/zero grew
  // without bound (a gigabyte a second, measured), and a FIFO with no writer blocked — synchronously, so no deadline
  // could end it, and `kinas context`, every background refresh and every session hook hung with it. Run in a child, so
  // the failure is a timeout and not this test process blocked for good.
  const root = mkdtempSync(join(tmpdir(), "kinas-features-"));
  roots.push(root);
  mkdirSync(join(root, "p-9c2e", "tasks", "fifo-9c2e"), { recursive: true });
  expect(Bun.spawnSync(["mkfifo", join(root, "p-9c2e", "tasks", "fifo-9c2e", "status.md")]).exitCode).toBe(0);
  mkdirSync(join(root, "p-9c2e", "tasks", "ok-9c2e"), { recursive: true });
  writeFileSync(join(root, "p-9c2e", "tasks", "ok-9c2e", "status.md"), GATE_ONE);
  const code = `const { featuresOf } = await import(${JSON.stringify(join(import.meta.dir, "features.ts"))});
    process.stdout.write(JSON.stringify(featuresOf([{ name: "p-9c2e", path: ${JSON.stringify(join(root, "p-9c2e"))} }])));`;
  const child = Bun.spawnSync([process.execPath, "-e", code], { timeout: 15_000, killSignal: "SIGKILL" });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual([
    { project: "p-9c2e", slug: "fifo-9c2e", line: "status unreadable" },
    { project: "p-9c2e", slug: "ok-9c2e", line: "Gate 1 · Product in progress" },
  ]);
}, 30_000);
