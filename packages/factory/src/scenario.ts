// The factory's synthetic week, counted by hand (build spec §11.4). Shared by `week.test.ts`, the fixture
// `fixtures/factory-events.synthetic.jsonl` (written from EVENTS by `scenario.test.ts`'s check) and the e2e.
import type { FactoryEvent } from "./week.ts";

// The week is Mon 16 Nov 2026 00:00 to Mon 23 Nov 2026 00:00 Lisbon
// (UTC+0 in November, so a Lisbon clock reads as UTC). Times are written as `day hh:mm`, day 0 = Monday 16 Nov.
//
//  task  project  dispatched   merged       holds (held → ended)              red   other
//  a1    alpha    Mon 10:00    Mon 12:00    10:30 → answered 11:00            —
//  a2    alpha    Mon 09:00    Tue 09:00    13:00 → answered 14:30            yes
//  a3    alpha    Mon 08:00    Mon 20:00    09:30 → hold closed 10:30         —
//  a4    alpha    Fri 13 12:00 Wed 12:00    —                                 —     (cycle 5 days)
//  b1    beta     Wed 10:00    Wed 11:00    —                                 —
//  b2    beta     Wed 10:00    Wed 14:00    —                                 —
//  c1    gamma    Tue 20:00    never        22:00 → answered Wed 07:00        —     (a hold outside 09:00–21:00)
//  d1    gamma    Wed 08:00    never        —                                 yes   cleaned up Thu 10:00, not merged
//  p1    alpha    Mon 9 Nov    Thu 12 Nov   —                                 —     (merged the week before)
export const MON = Date.UTC(2026, 10, 16);
export const H = 3_600_000;
export const at = (day: number, hh: number, mm = 0) => MON + day * 24 * H + hh * H + mm * 60_000;
export const ev = (task: string, project: string, event: FactoryEvent["event"], when: number, value?: number): FactoryEvent => (value === undefined ? { task, project, event, at: when } : { task, project, event, at: when, value });

export const EVENTS: FactoryEvent[] = [
  ev("p1", "alpha", "dispatched", at(-7, 9)), ev("p1", "alpha", "merged", at(-4, 12)),
  ev("a1", "alpha", "dispatched", at(0, 10)), ev("a1", "alpha", "held", at(0, 10, 30)), ev("a1", "alpha", "answered", at(0, 11)), ev("a1", "alpha", "merged", at(0, 12)),
  ev("a2", "alpha", "dispatched", at(0, 9)), ev("a2", "alpha", "held", at(0, 13)), ev("a2", "alpha", "answered", at(0, 14, 30)), ev("a2", "alpha", "red", at(0, 15)), ev("a2", "alpha", "merged", at(1, 9)),
  ev("a3", "alpha", "dispatched", at(0, 8)), ev("a3", "alpha", "held", at(0, 9, 30)), ev("a3", "alpha", "hold_closed", at(0, 10, 30)), ev("a3", "alpha", "merged", at(0, 20)),
  ev("a4", "alpha", "dispatched", at(-3, 12)), ev("a4", "alpha", "merged", at(2, 12)),
  ev("b1", "beta", "dispatched", at(2, 10)), ev("b1", "beta", "merged", at(2, 11)),
  ev("b2", "beta", "dispatched", at(2, 10)), ev("b2", "beta", "merged", at(2, 14)),
  ev("c1", "gamma", "dispatched", at(1, 20)), ev("c1", "gamma", "held", at(1, 22)), ev("c1", "gamma", "answered", at(2, 7)),
  ev("d1", "gamma", "dispatched", at(2, 8)), ev("d1", "gamma", "red", at(2, 9)), ev("d1", "gamma", "cleaned_up", at(3, 10)),
  // Tokens (per task, per day): a1 100 + 50, a2 400, a3 1000.
  ev("a1", "alpha", "tokens", at(0, 23), 100), ev("a1", "alpha", "tokens", at(1, 23), 50), ev("a2", "alpha", "tokens", at(0, 23), 400), ev("a3", "alpha", "tokens", at(0, 23), 1000),
];
// The captain had Kinas focused Mon 09:00–12:30 and Wed 09:00–09:30: b1 and b2 (Wed 10:00 on) were done while he was away.
export const SPANS: [number, number][] = [[at(0, 9), at(0, 12, 30)], [at(2, 9), at(2, 9, 30)]];
export const PLAN = [{ at: at(-1, 12), pct: 90 }, { at: at(0, 12), pct: 41 }, { at: at(3, 12), pct: 62 }];

