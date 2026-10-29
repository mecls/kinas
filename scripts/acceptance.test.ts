import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AC-10's leak scan reads the store and the logs under `~/Library/Application Support/ai.sintralabs.kinas` — a path
// with a space in it. Run against a home of that shape: a clean store must PASS, and a leak must name the file whole.
// The Keychain is never asked (the key prefixes are given), the private-names grep looks for a name no file has, and
// nothing outside the scratch home is touched; the installed-app checks fail here, as they do on any Mac without it.

const repo = join(import.meta.dir, "..");
const scratch = mkdtempSync(join(tmpdir(), "kinas-ac10-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function ac10(name: string, storeText: string): { out: string; store: string } {
  const home = join(scratch, name, "home dir");
  const data = join(home, "Library/Application Support/ai.sintralabs.kinas");
  const logs = join(home, "Library/Logs/ai.sintralabs.kinas");
  mkdirSync(data, { recursive: true });
  mkdirSync(logs, { recursive: true });
  const store = join(data, "kinas.sqlite");
  writeFileSync(store, storeText);
  writeFileSync(join(logs, "kinas.log"), `store open at ${store}\n`);
  const r = spawnSync("bash", ["scripts/acceptance.sh", "ac10"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      KINAS_PRIVATE_NAMES: "no-such-name-9c2e",
      KINAS_CONVEX_KEY_PREFIX: "convex-9c2e-",
      KINAS_HOSTINGER_TOKEN_PREFIX: "hosting-9c2e",
    },
  });
  return { out: `${r.stdout}${r.stderr}`, store };
}

test("a clean store under a path with a space passes the leak scan", () => {
  const { out } = ac10("clean", "nothing secret here\n");
  expect(out).toContain("PASS  no sk-ant- in the store or the logs");
  expect(out).toContain("PASS  no Bearer or Convex credential header in the store or the logs");
  expect(out).toContain("PASS  the Convex deploy key is not in the store, the logs or kinas status --json");
  expect(out).toContain("PASS  the Hostinger API token is not in the store, the logs or kinas status --json");
});

test("a leak is named by its file, path and all", () => {
  const { out, store } = ac10("leaky", "sk-ant-9c2e\nAuthorization: Bearer x\nconvex-9c2e-rest\n");
  expect(out).toContain(`FAIL  sk-ant- found:`);
  expect(out).toContain(`${store}: 1`);
  expect(out).toContain("FAIL  a credential header was found:");
  expect(out).toContain("FAIL  the Convex deploy key leaked");
});
