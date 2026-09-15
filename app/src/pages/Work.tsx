import type { Shortcuts } from "../settings/shortcuts.ts";
import { Terminal } from "../terminal/Terminal.tsx";

export function WorkPage({ active, shortcuts }: { active: boolean; shortcuts: Shortcuts }) {
  return (
    <div className="work" data-active={active}>
      <Terminal active={active} shortcuts={shortcuts} />
    </div>
  );
}
