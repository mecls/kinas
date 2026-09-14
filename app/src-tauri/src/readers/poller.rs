//! When the Ollama reader may make a request (PRD R13). Pure scheduling on a supplied clock, so it is
//! tested without waiting.

pub const CADENCE_MS: i64 = 5 * 60 * 1000;
/// Whatever the trigger, at most one request per 60 s.
pub const MIN_GAP_MS: i64 = 60 * 1000;
/// A visible page refreshes readings older than this.
pub const VISIBLE_REFRESH_AGE_MS: i64 = 60 * 1000;
/// HTTP 429 waits 5 → 10 → 20 → 30 min (cap), or longer if Retry-After says so.
pub const BACKOFF_MS: [i64; 4] = [5 * 60 * 1000, 10 * 60 * 1000, 20 * 60 * 1000, 30 * 60 * 1000];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// The regular cadence.
    Tick,
    /// The Usage page became visible; `reading_age_ms` is None when there is no reading yet.
    Visible { reading_age_ms: Option<i64> },
    /// "Refresh readings" from the palette, or a key just saved in Settings.
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Result {
    Done,
    RateLimited { retry_after_s: Option<u64> },
}

#[derive(Debug, Clone)]
pub struct Poller {
    next_due: i64,
    blocked_until: i64,
    last_request: Option<i64>,
    backoff_step: usize,
}

impl Poller {
    /// Due immediately.
    pub fn new(now: i64) -> Self {
        Poller { next_due: now, blocked_until: 0, last_request: None, backoff_step: 0 }
    }

    pub fn should_request(&self, trigger: Trigger, now: i64) -> bool {
        if self.last_request.is_some_and(|last| now - last < MIN_GAP_MS) || now < self.blocked_until {
            return false;
        }
        match trigger {
            Trigger::Tick => now >= self.next_due,
            Trigger::Visible { reading_age_ms } => reading_age_ms.is_none_or(|age| age > VISIBLE_REFRESH_AGE_MS),
            Trigger::Manual => true,
        }
    }

    pub fn record(&mut self, result: Result, now: i64) {
        self.last_request = Some(now);
        match result {
            Result::Done => {
                self.backoff_step = 0;
                self.blocked_until = 0;
                self.next_due = now + CADENCE_MS;
            }
            Result::RateLimited { retry_after_s } => {
                let backoff = BACKOFF_MS[self.backoff_step.min(BACKOFF_MS.len() - 1)];
                let retry_after = retry_after_s.map_or(0, |s| i64::try_from(s).unwrap_or(i64::MAX / 2).saturating_mul(1000));
                let wait = backoff.max(retry_after);
                self.backoff_step += 1;
                self.blocked_until = now + wait;
                self.next_due = now + wait;
            }
        }
    }

    /// No request was made (no key saved): look again after a normal cadence, without counting a request,
    /// so saving a key can trigger a poll at once.
    pub fn skip(&mut self, now: i64) {
        self.next_due = now + CADENCE_MS;
    }

    /// How long the reader thread may sleep before the next tick is due.
    pub fn sleep_ms(&self, now: i64) -> i64 {
        (self.next_due.max(self.blocked_until) - now).clamp(1_000, CADENCE_MS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60 * 1000;

    #[test]
    fn polls_now_then_every_five_minutes() {
        let mut p = Poller::new(0);
        assert!(p.should_request(Trigger::Tick, 0));
        p.record(Result::Done, 0);
        assert!(!p.should_request(Trigger::Tick, 5 * MIN - 1));
        assert!(p.should_request(Trigger::Tick, 5 * MIN));
    }

    #[test]
    fn never_more_than_one_request_per_minute_whatever_the_trigger() {
        let mut p = Poller::new(0);
        p.record(Result::Done, 0);
        for trigger in [Trigger::Manual, Trigger::Visible { reading_age_ms: None }, Trigger::Tick] {
            assert!(!p.should_request(trigger, MIN - 1), "{trigger:?}");
        }
        assert!(p.should_request(Trigger::Manual, MIN));
    }

    #[test]
    fn visible_refreshes_only_readings_older_than_a_minute() {
        let mut p = Poller::new(0);
        p.record(Result::Done, 0);
        assert!(!p.should_request(Trigger::Visible { reading_age_ms: Some(MIN) }, 2 * MIN));
        assert!(p.should_request(Trigger::Visible { reading_age_ms: Some(MIN + 1) }, 2 * MIN));
        assert!(p.should_request(Trigger::Visible { reading_age_ms: None }, 2 * MIN));
    }

    #[test]
    fn rate_limits_back_off_5_10_20_30_then_stay_at_30() {
        let mut p = Poller::new(0);
        let mut now = 0;
        for expected in [5, 10, 20, 30, 30] {
            p.record(Result::RateLimited { retry_after_s: None }, now);
            assert!(!p.should_request(Trigger::Manual, now + expected * MIN - 1), "blocked for {expected} min");
            now += expected * MIN;
            assert!(p.should_request(Trigger::Tick, now), "due after {expected} min");
        }
        p.record(Result::Done, now);
        p.record(Result::RateLimited { retry_after_s: None }, now + 10 * MIN);
        assert!(p.should_request(Trigger::Tick, now + 15 * MIN), "a success resets the backoff to 5 min");
    }

    #[test]
    fn retry_after_wins_when_longer() {
        let mut p = Poller::new(0);
        p.record(Result::RateLimited { retry_after_s: Some(900) }, 0);
        assert!(!p.should_request(Trigger::Tick, 15 * MIN - 1));
        assert!(p.should_request(Trigger::Tick, 15 * MIN));
    }

    #[test]
    fn a_skipped_poll_does_not_block_a_manual_one() {
        let mut p = Poller::new(0);
        p.skip(0);
        assert!(!p.should_request(Trigger::Tick, MIN));
        assert!(p.should_request(Trigger::Manual, 1), "saving a key polls at once");
    }

    #[test]
    fn sleep_is_bounded() {
        let mut p = Poller::new(0);
        p.record(Result::Done, 0);
        assert_eq!(p.sleep_ms(0), 5 * MIN);
        assert_eq!(p.sleep_ms(5 * MIN), 1_000);
    }
}
