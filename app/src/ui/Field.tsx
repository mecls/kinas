import type { InputHTMLAttributes, ReactNode } from "react";
import "./Field.css";

// DESIGN.md §4 Settings field and Switch.

export function Field({ label, help, children, htmlFor }: { label: ReactNode; help?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="ui-field-control">{children}</div>
      {help && <p className="ui-field-help">{help}</p>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={className ? `ui-input ${className}` : "ui-input"} {...rest} />;
}

export function Switch({ checked, onChange, "aria-label": label }: { checked: boolean; onChange: (next: boolean) => void; "aria-label": string }) {
  return <button type="button" role="switch" className="ui-switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}
