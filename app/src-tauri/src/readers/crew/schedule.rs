//! When the fleet snapshot runs (build spec §6.6): at most once every 5 s, whatever woke it. A change of
//! `data/backlog.md` or `state/home-summary.json`, the Crew page showing, and `Manual` run it as soon as that allows;
//! the baseline runs it 60 s after the last run while the page is on screen and 300 s otherwise; after failures the
//! baseline backs off 5 → 10 → 20 → 30 minutes, until a success or `Manual` resets it. Pure: the loop passes the time.

const MIN_GAP_MS: i64 = 5_000;
const VISIBLE_MS: i64 = 60_000;
const HIDDEN_MS: i64 = 300_000;
const BACKOFF_MS: [i64; 4] = [300_000, 600_000, 1_200_000, 1_800_000];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CrewWake {
    /// One of the two trigger files changed (already debounced by the loop).
    File,
    /// The Crew page came on screen.
    Visible,
    /// "Refresh readings" in the palette.
    Manual,
    /// The baseline's own timer.
    Tick,
    /// Herdr only: the Work page wants a fresh view for its chrome, or the launcher just changed the session. The fleet
    /// snapshot does not run for it.
    Herdr,
}

#[derive(Debug, Default)]
pub(crate) struct Schedule {
    last_run: Option<i64>,
    visible: bool,
    failures: u32,
}

impl Schedule {
    pub(crate) fn new() -> Self {
        Schedule::default()
    }

    pub(crate) fn set_visible(&mut self, visible: bool) {
        self.visible = visible;
    }

    /// When a run woken by `wake` at `now` may start: never sooner than 5 s after the last one. The backoff delays only
    /// the baseline — a trigger file still runs the snapshot, because Firstmate changed something.
    pub(crate) fn run_at(&self, wake: &CrewWake, now: i64) -> i64 {
        let Some(last) = self.last_run else { return now };
        let earliest = now.max(last + MIN_GAP_MS);
        match wake {
            CrewWake::File | CrewWake::Visible | CrewWake::Manual | CrewWake::Herdr => earliest,
            CrewWake::Tick => {
                let wait = match self.failures {
                    0 if self.visible => VISIBLE_MS,
                    0 => HIDDEN_MS,
                    n => BACKOFF_MS[(n as usize - 1).min(BACKOFF_MS.len() - 1)],
                };
                (last + wait).max(last + MIN_GAP_MS)
            }
        }
    }

    /// `Manual` starts the backoff over, as a success does.
    pub(crate) fn reset(&mut self) {
        self.failures = 0;
    }

    pub(crate) fn finished(&mut self, now: i64, ok: bool) {
        self.last_run = Some(now);
        self.failures = if ok { 0 } else { self.failures.saturating_add(1) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_000_000;

    #[test]
    fn the_first_run_is_at_once() {
        assert_eq!(Schedule::new().run_at(&CrewWake::Tick, T0), T0);
        assert_eq!(Schedule::new().run_at(&CrewWake::File, T0), T0);
    }

    #[test]
    fn five_seconds_apart_at_most() {
        let mut s = Schedule::new();
        s.finished(T0, true);
        assert_eq!(s.run_at(&CrewWake::File, T0 + 1_000), T0 + 5_000, "a second File wake 1 s later waits for +5 s");
        assert_eq!(s.run_at(&CrewWake::Visible, T0 + 1_000), T0 + 5_000);
        assert_eq!(s.run_at(&CrewWake::Manual, T0 + 1_000), T0 + 5_000);
        assert_eq!(s.run_at(&CrewWake::File, T0 + 9_000), T0 + 9_000, "later than 5 s runs at once");
    }

    #[test]
    fn visible_60_hidden_300() {
        let mut s = Schedule::new();
        s.finished(T0, true);
        assert_eq!(s.run_at(&CrewWake::Tick, T0), T0 + 300_000);
        s.set_visible(true);
        assert_eq!(s.run_at(&CrewWake::Tick, T0), T0 + 60_000);
    }

    #[test]
    fn backoff_then_reset() {
        let mut s = Schedule::new();
        s.set_visible(true);
        let mut now = T0;
        for minutes in [5, 10, 20, 30, 30] {
            s.finished(now, false);
            let next = s.run_at(&CrewWake::Tick, now);
            assert_eq!(next - now, minutes * 60_000, "after {} failures", s.failures);
            now = next;
        }
        s.finished(now, false);
        assert_eq!(s.run_at(&CrewWake::Tick, now), now + 30 * 60_000);
        assert_eq!(s.run_at(&CrewWake::File, now + 1_000), now + 5_000, "a trigger file is not held back by the backoff");
        s.finished(now, true);
        assert_eq!(s.run_at(&CrewWake::Tick, now), now + 60_000, "a success resets");
        s.finished(now, false);
        s.finished(now, false);
        s.reset();
        s.finished(now, false);
        assert_eq!(s.run_at(&CrewWake::Tick, now), now + 300_000, "Manual resets: the next failure backs off from 5 min");
    }
}
