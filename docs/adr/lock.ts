// Writes decisions.lock for the records in this folder — run after adding a record:
//   bun docs/adr/lock.ts
// It adds hashes for records the lock does not know and refuses to change one it does: an edited
// decision is not re-locked, it is superseded by a new record (adr.test.ts says so too).

import { writeFileSync } from "node:fs";
import { LOCK_PATH, listRecordFiles, readLock, readRecord } from "./records.ts";

const lock = readLock();
const next: { [number: string]: string } = { ...lock };
let added = 0;
for (const file of listRecordFiles()) {
  const r = readRecord(file);
  if (r.hash === null) {
    console.error(`${file} has no "## Decision" section`);
    process.exit(1);
  }
  const locked = lock[r.number];
  if (locked !== undefined && locked !== r.hash) {
    console.error(`${file}: its decision changed since it was locked — a decision is never edited; write a superseding record`);
    process.exit(1);
  }
  if (locked === undefined) {
    next[r.number] = r.hash;
    added++;
  }
}
writeFileSync(LOCK_PATH, `${JSON.stringify(next, null, 2)}\n`);
console.log(`decisions.lock: ${Object.keys(next).length} records, ${added} added`);
