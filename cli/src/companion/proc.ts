// The user's own processes as Linux's /proc shows them (ADR 0027): what setup's first-mate row and the workers'
// runtime check read. Read-only. Only processes of the companion's own uid are read past their status line; another
// user's environment cannot be read and is never tried. A value /proc does not give stays null — the callers treat a
// null where they need a fact as failing, never as passing.

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export interface Proc {
  pid: number;
  ppid: number;
  uid: number;
  /** `/proc/<pid>/exe`'s target, without a ` (deleted)` suffix. */
  exe: string | null;
  cwd: string | null;
  cmdline: string[] | null;
  /** Names and values; read only to find names Kinas sets or removes and the marker — never logged or returned. */
  environ: Map<string, string> | null;
  /** `pid:[<inode>]`. */
  pidNs: string | null;
  /** 0 off, 1 strict, 2 filter. */
  seccomp: number | null;
  noNewPrivs: number | null;
}

function readOr(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function linkOr(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

function field(status: string, name: string): number | null {
  const m = new RegExp(`^${name}:\\s*(\\d+)`, "m").exec(status);
  return m ? Number(m[1]) : null;
}

/** NUL-separated, as cmdline and environ are; a trailing NUL is not an empty last entry. */
export function nulSplit(text: string): string[] {
  const parts = text.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

export function environOf(text: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const entry of nulSplit(text)) {
    const eq = entry.indexOf("=");
    if (eq > 0) env.set(entry.slice(0, eq), entry.slice(eq + 1));
  }
  return env;
}

/** The companion's own PID namespace: the host's, for everything the companion starts. */
export function ownPidNs(procRoot: string): string | null {
  return linkOr(join(procRoot, "self", "ns", "pid"));
}

/** Every process of `uid`, read now. A process that ends mid-read is left out. */
export function readProcs(procRoot: string, uid: number): Proc[] {
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return [];
  }
  const out: Proc[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const dir = join(procRoot, name);
    const status = readOr(join(dir, "status"));
    if (status === null) continue;
    const owner = /^Uid:\s*(\d+)/m.exec(status);
    if (owner === null || Number(owner[1]) !== uid) continue;
    const cmd = readOr(join(dir, "cmdline"));
    const env = readOr(join(dir, "environ"));
    const exe = linkOr(join(dir, "exe"));
    out.push({
      pid: Number(name),
      ppid: field(status, "PPid") ?? -1,
      uid,
      exe: exe === null ? null : exe.replace(/ \(deleted\)$/, ""),
      cwd: linkOr(join(dir, "cwd")),
      cmdline: cmd === null ? null : nulSplit(cmd),
      environ: env === null ? null : environOf(env),
      pidNs: linkOr(join(dir, "ns", "pid")),
      seccomp: field(status, "Seccomp"),
      noNewPrivs: field(status, "NoNewPrivs"),
    });
  }
  return out;
}

/** Each process's descendants, by pid. */
export function childrenOf(procs: Proc[]): Map<number, Proc[]> {
  const kids = new Map<number, Proc[]>();
  for (const p of procs) {
    const list = kids.get(p.ppid) ?? [];
    list.push(p);
    kids.set(p.ppid, list);
  }
  return kids;
}

export function descendants(root: number, kids: Map<number, Proc[]>): Proc[] {
  const out: Proc[] = [];
  const todo = [root];
  const seen = new Set<number>([root]);
  while (todo.length > 0) {
    for (const c of kids.get(todo.pop()!) ?? []) {
      if (seen.has(c.pid)) continue;
      seen.add(c.pid);
      out.push(c);
      todo.push(c.pid);
    }
  }
  return out;
}
