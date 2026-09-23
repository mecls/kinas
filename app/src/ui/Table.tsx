import type { HTMLAttributes, ReactNode } from "react";
import "./Table.css";

// DESIGN.md §4 Table. Columns say which are numbers (right-aligned, mono); rows are plain records keyed by column, and
// `rowProps` puts attributes on a row's <tr> (a `data-model` a test or a caller finds it by). The table sits in a
// wrapper that scrolls sideways when it is wider than its column (Table.css says why it is not clipped instead);
// `className` and the rest go on the table itself, where callers and tests find them.

export interface Column {
  key: string;
  label: ReactNode;
  align?: "left" | "right";
}

export function Table({
  columns,
  rows,
  caption,
  rowKey,
  rowProps,
  className,
  ...rest
}: {
  columns: Column[];
  rows: Record<string, ReactNode>[];
  caption?: ReactNode;
  rowKey?: (row: Record<string, ReactNode>, i: number) => string;
  rowProps?: (row: Record<string, ReactNode>, i: number) => HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string>;
} & HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="ui-table-wrap">
      <table className={className ? `ui-table ${className}` : "ui-table"} {...rest}>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "ui-table-r" : undefined} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i} {...rowProps?.(row, i)}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === "right" ? "ui-table-r" : undefined}>
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
