import type { HostView, ReaderView } from "../api.ts";
import { asOf, gb, gib } from "./format.ts";

// This Mac (R27): CPU, memory used / total, and disk as Finder shows it — "available" counts the purgeable
// space macOS clears for you, in decimal GB — with the space free right now underneath.

export function MacTiles({ host, reader, now }: { host: HostView | null; reader: ReaderView | undefined; now: number }) {
  if (!host) {
    return (
      <section className="tiles" aria-label="This Mac">
        <p className="muted">{reader?.last_error ?? "Reading this Mac…"}</p>
      </section>
    );
  }
  const dead = host.state === "dead";
  const stale = host.state === "stale";
  const free = host.disk_total_gb - host.disk_used_gb;
  const available = host.disk_available_gb;
  const tiles = [
    { name: "CPU", value: host.cpu_pct === null || dead ? "—" : `${Math.round(host.cpu_pct)}%`, sub: "all cores" },
    { name: "Memory", value: dead ? "—" : gib(host.mem_used_gb), sub: `of ${gib(host.mem_total_gb)} used` },
    {
      name: "Disk",
      value: dead ? "—" : gb(available ?? free),
      sub: available === null ? `free of ${gb(host.disk_total_gb)}` : `available of ${gb(host.disk_total_gb)} · ${gb(free)} free now`,
    },
  ];
  return (
    <section className="tiles" aria-label="This Mac" data-state={host.state}>
      {tiles.map((t) => (
        <article className="tile" key={t.name} data-tile={t.name.toLowerCase()}>
          <header className="gauge-head">
            <span className="gauge-label">{t.name}</span>
            <span className={`dot dot-${host.state}`} />
          </header>
          <div className="tile-number">{t.value}</div>
          <p className="gauge-detail">{t.sub}</p>
          <p className={`gauge-asof${stale ? " is-stale" : ""}`}>
            {asOf(host.updated_at, now)}
            {stale && " · stale"} · {host.machine}
          </p>
        </article>
      ))}
    </section>
  );
}
