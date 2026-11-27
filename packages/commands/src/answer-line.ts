// The line the first mate reads for an answer (build spec §12 slice 10.2): `On <task> (<key>): <words>`, held equal to the
// Mac's `crew/answer.rs` `line` and `answer_text` by `fixtures/answer-lines.json`, which both sides read. A phone's answer
// reaches the companion as a kind and some typed words; the companion builds the line here, never from the phone's own
// wording of it.

export type AnswerKind = "approve" | "deny" | "answer";

/** The most typed words an answer takes, in UTF-8 bytes: the Mac's `MAX_ANSWER_BYTES`. */
export const MAX_TYPED_BYTES = 4_096;

/** The answer's words, or null: an Answer with nothing typed, or any typed text over the cap, is no answer. */
export function answerText(kind: AnswerKind, typed: string): string | null {
  const text = typed.replaceAll("\u0000", "").trim();
  if (new TextEncoder().encode(text).length > MAX_TYPED_BYTES) return null;
  switch (kind) {
    case "approve":
      return "Approved — go ahead.";
    case "deny":
      return text === "" ? "Denied." : `Denied — ${text}`;
    case "answer":
      return text === "" ? null : text;
  }
}

/** `On <task> (<key>): <words>`; a held task's decision is keyed by the task itself, so it reads `On <task>: <words>`. */
export function answerLine(task: string, key: string, kind: AnswerKind, typed: string): string | null {
  const words = answerText(kind, typed);
  if (words === null) return null;
  return key === task ? `On ${task}: ${words}` : `On ${task} (${key}): ${words}`;
}
