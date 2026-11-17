import { useState } from "react";
import { applyAccent } from "../theme.ts";
import { BRAND_ACCENT, describe, isAccent, passes, SWATCHES } from "./accent.ts";
import { Button } from "./Button.tsx";
import "./Field.css";

// DESIGN.md §4 "Accent field": a colour control in Settings → Appearance that shows the contrast of the ink on the
// accent in both themes and will not save a shade under 4.5:1 in either — it offers the nearest one that passes.
// The page is repainted the moment a shade is chosen (applyAccent), before the store answers, so the choice is seen
// where it matters; `onChange` stores it. Plain markup in slice 1 of the design-system build; its sheet lands with
// the Settings cards.

export function AccentField({ value, onChange }: { value: string | null; onChange: (hex: string | null) => void }) {
  const current = value ?? BRAND_ACCENT;
  const [tried, setTried] = useState<string | null>(null);
  const shown = tried ?? current;
  const verdict = describe(shown);

  const choose = (hex: string | null) => {
    setTried(null);
    applyAccent(hex);
    onChange(hex);
  };
  const tryShade = (hex: string) => {
    if (!isAccent(hex)) return;
    if (passes(hex)) choose(hex === BRAND_ACCENT ? null : hex);
    else setTried(hex);
  };

  return (
    <div className="ui-accent" data-accent={current}>
      <div className="ui-accent-swatches" role="group" aria-label="Accent">
        {SWATCHES.map((s) => (
          <button
            key={s.hex}
            type="button"
            className="ui-accent-swatch"
            aria-label={`Accent ${s.name}`}
            aria-pressed={current === s.hex}
            style={{ "--c": s.hex } as React.CSSProperties}
            onClick={() => choose(s.hex === BRAND_ACCENT ? null : s.hex)}
          />
        ))}
        <input type="color" className="ui-accent-any" aria-label="Accent" value={shown} onChange={(e) => tryShade(e.currentTarget.value.toLowerCase())} />
      </div>
      <p className="ui-accent-contrast" data-testid="accent-contrast" data-passes={verdict.offer === null ? "true" : "false"}>
        {verdict.text}
        {verdict.offer && (
          <>
            {" "}
            <Button kind="text" onClick={() => choose(verdict.offer)}>
              Use it
            </Button>
          </>
        )}
      </p>
    </div>
  );
}
