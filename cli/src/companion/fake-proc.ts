// Tests only: a Linux /proc as proc.ts reads it, in a test root's `proc` folder. Each process is a folder with its
// `status`, `cmdline` and `environ` files and its `exe`, `cwd` and `ns/pid` links (dangling links are fine: only their
// text is read). `self` is the companion's own process, in the host's namespace.

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HOST_NS = "pid:[4026531836]";
export const SANDBOX_NS = "pid:[4026532999]";

export interface FakeProc {
  pid: number;
  ppid: number;
  uid?: number;
  exe: string;
  cwd?: string;
  cmdline: string[];
  env?: Record<string, string>;
  ns?: string;
  seccomp?: number;
  noNewPrivs?: number;
  /** Leave `environ` unreadable, as /proc does for a process that is not the reader's. */
  noEnviron?: boolean;
}

function link(target: string, at: string): void {
  rmSync(at, { force: true });
  symlinkSync(target, at);
}

export function fakeProc(root: string, procs: FakeProc[], uid = 1001): void {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "self", "ns"), { recursive: true });
  link(HOST_NS, join(root, "self", "ns", "pid"));
  for (const p of procs) {
    const dir = join(root, String(p.pid));
    mkdirSync(join(dir, "ns"), { recursive: true });
    writeFileSync(
      join(dir, "status"),
      [`Name:\t${p.exe.split("/").pop()}`, `PPid:\t${p.ppid}`, `Uid:\t${p.uid ?? uid}\t${p.uid ?? uid}\t${p.uid ?? uid}\t${p.uid ?? uid}`, `NoNewPrivs:\t${p.noNewPrivs ?? 0}`, `Seccomp:\t${p.seccomp ?? 0}`, ""].join("\n"),
    );
    writeFileSync(join(dir, "cmdline"), p.cmdline.map((a) => `${a}\0`).join(""));
    if (!p.noEnviron) {
      writeFileSync(
        join(dir, "environ"),
        Object.entries(p.env ?? {})
          .map(([k, v]) => `${k}=${v}\0`)
          .join(""),
      );
    }
    link(p.exe, join(dir, "exe"));
    link(p.cwd ?? "/", join(dir, "cwd"));
    link(p.ns ?? HOST_NS, join(dir, "ns", "pid"));
  }
}
