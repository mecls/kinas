import type { CrewTaskDetail, CrewWord } from "../api.ts";
import type { Check } from "../ui/Panel.tsx";
import type { BadgeState } from "../ui/StatusBadge.tsx";
import type { TimelineItem } from "../ui/Timeline.tsx";
import { BADGE_OF } from "./board.ts";

// The task detail's words (build spec §4 Task detail; mockup task-detail.html): pure, so detail.test.ts holds them and
// crew/TaskDetail.tsx only draws. Everything here is what Firstmate or GitHub said — no plan, no recommendation.

/** A 24-hour local clock, "09:31". */
export const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

/** "ship · no-mistakes · yolo off · claude · herdr · observed 09:31", without the parts Firstmate did not say. */
export function settingsLine(d: CrewTaskDetail): string {
  const observed = d.state_observed_at ? Date.parse(d.state_observed_at) : NaN;
  return [d.task.kind, d.mode, d.mode ? (d.yolo ? "yolo on" : "yolo off") : null, d.task.harness, d.backend, Number.isNaN(observed) ? null : `observed ${clock(observed)}`]
    .filter((p): p is string => !!p)
    .join(" · ");
}

const REVIEW: Record<string, string> = { REVIEW_REQUIRED: "review required", APPROVED: "approved", CHANGES_REQUESTED: "changes requested" };

/** "PR #121 · open · mergeable · review required": GitHub's words, lower-cased, only those `gh` has given. */
export function prDetail(d: CrewTaskDetail): string | null {
  const pr = d.task.pr;
  if (!pr) return null;
  const parts = [`PR #${pr.number}`];
  if (pr.state) parts.push(pr.state.toLowerCase());
  if (pr.draft) parts.push("draft");
  if (pr.mergeable === "MERGEABLE") parts.push("mergeable");
  else if (pr.mergeable === "CONFLICTING") parts.push("conflicting");
  if (d.pr_review) parts.push(REVIEW[d.pr_review] ?? d.pr_review.toLowerCase().replaceAll("_", " "));
  return parts.join(" · ");
}

const FAILING = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

/** Each check as the ChecksList draws it: passed in --ok, failing in --danger, running in --meter, the rest quiet. */
export function checksOf(d: CrewTaskDetail): Check[] {
  return d.checks.map((c) => {
    const state: BadgeState = c.conclusion === "SUCCESS" ? "done" : FAILING.has(c.conclusion) ? "red" : c.conclusion === "PENDING" ? "working" : "stale";
    const result = c.conclusion === "SUCCESS" ? "passed" : FAILING.has(c.conclusion) ? "failed" : c.conclusion === "PENDING" ? "running" : c.conclusion.toLowerCase().replaceAll("_", " ");
    return { state, name: c.name, result };
  });
}

const WORDS = new Set(Object.keys(BADGE_OF));

/** One timeline dot per event kind: a word by its badge, a PR as PR open, checks red or green, an order in --ink. */
function stateOf(kind: string, text: string): BadgeState | "order" {
  switch (kind) {
    case "word":
      return WORDS.has(text) ? BADGE_OF[text as CrewWord] : "unknown";
    case "state":
      return WORDS.has(text) ? BADGE_OF[text as CrewWord] : "stale";
    case "pr":
      return "pr";
    case "checks":
      return text.includes("failing") ? "red" : "done";
    case "order":
      return "order";
    case "gone":
      return "gone";
    case "returned":
      return "working";
    default:
      return "stale";
  }
}

/** The timeline, oldest first as Rust sends it. */
export function timelineOf(d: CrewTaskDetail): TimelineItem[] {
  return d.events.map((e) => ({ time: clock(e.at), text: e.text, state: stateOf(e.kind, e.text) }));
}

/** "present", "gone", or null before Firstmate has made one. */
export function worktreeWord(d: CrewTaskDetail): string | null {
  return d.worktree_present === null ? null : d.worktree_present ? "present" : "gone";
}
