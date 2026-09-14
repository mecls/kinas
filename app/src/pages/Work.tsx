import { Terminal } from "../terminal/Terminal.tsx";

export function WorkPage({ active }: { active: boolean }) {
  return (
    <div className="work" data-active={active}>
      <Terminal active={active} />
    </div>
  );
}
