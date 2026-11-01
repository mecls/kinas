// A read that fails after a good one (ADR 0004): the good one stays on screen, and one line says so, or its numbers
// freeze and their captions stop ageing with nothing on screen to tell why. The words are the ones the pages already
// use for a reader's own failure — "Convex: deploy key rejected · showing the last reading". Pure, so
// readFailure.test.ts holds it.

/** What failed to read, as the line names it. The crew's own errors already say "could not read the crew", and the
 *  task panel's "could not read the task". */
const LEAD = {
  usage: "Could not read the readings",
  crew: "Crew",
  task: "Task",
  settings: "Could not read the settings",
} as const;

/** The line, or null with no failure. `hasLast`: a good reading is still drawn, so the line says it is the last one. */
export function failedRead(what: keyof typeof LEAD, error: string | null, hasLast: boolean): string | null {
  if (error === null) return null;
  return `${LEAD[what]}: ${error}${hasLast ? " · showing the last reading" : ""}`;
}
