//! The Changes view's diff (rules 21 and 25): a file's text now against its text at the baseline, line by line,
//! unified. Pure over two strings. Three lines of context around each change; a longer unchanged run folds into one
//! row the webview can open. A diff that takes longer than its deadline is refused, never drawn coarse.

use std::time::{Duration, Instant};

use serde::Serialize;
use similar::{Algorithm, ChangeTag, TextDiff};

use super::{Mark, Millis};

pub const DIFF_DEADLINE: Duration = Duration::from_millis(500);
pub const CONTEXT_LINES: usize = 3;
/// A run folds only if at least this many lines would be hidden: folding three lines behind a row saves nothing.
pub const MIN_FOLDED: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RowKind {
    Context,
    Add,
    Remove,
}

/// One line of the diff. `old` and `new` are 1-based line numbers, one-sided for an added or removed line; `fold` is
/// the fold a hidden unchanged line belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DiffRow {
    pub kind: RowKind,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
    pub fold: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Fold {
    pub id: u32,
    pub lines: u32,
}

/// What the reader draws for a changed file.
#[derive(Clone, Debug, Serialize)]
pub struct DiffView {
    pub path: String,
    pub display_path: String,
    /// The projects root's real path, as `ReaderDoc.root`.
    pub root: String,
    /// As `ReaderDoc.ext`: the webview picks the highlighter from it.
    pub ext: String,
    pub since_ms: Millis,
    pub mark: Mark,
    pub added: u32,
    pub removed: u32,
    pub rows: Vec<DiffRow>,
    pub folds: Vec<Fold>,
    /// Some only for a deleted file: the text it had, which is what Copy copies (rule 22).
    pub baseline_text: Option<String>,
}

/// The diff ran out of time: rule 25 names both sizes instead.
#[derive(Debug, PartialEq, Eq)]
pub struct TooMany {
    pub before_lines: u32,
    pub after_lines: u32,
}

fn lines(text: &str) -> u32 {
    u32::try_from(text.lines().count()).unwrap_or(u32::MAX)
}

fn number(index: Option<usize>) -> Option<u32> {
    index.map(|i| u32::try_from(i + 1).unwrap_or(u32::MAX))
}

/// `before` to `after`, with its folds and the counts of added and removed lines. Myers, as `similar` runs it: past
/// `deadline` it would approximate, and an approximation is refused (rule 25).
pub fn diff(before: &str, after: &str, deadline: Duration) -> Result<(Vec<DiffRow>, Vec<Fold>, u32, u32), TooMany> {
    let until = Instant::now() + deadline;
    let text_diff = TextDiff::configure().algorithm(Algorithm::Myers).deadline(until).diff_lines(before, after);
    if Instant::now() >= until {
        return Err(TooMany { before_lines: lines(before), after_lines: lines(after) });
    }
    let (mut added, mut removed) = (0u32, 0u32);
    let mut rows: Vec<DiffRow> = text_diff
        .iter_all_changes()
        .map(|change| {
            let kind = match change.tag() {
                ChangeTag::Equal => RowKind::Context,
                ChangeTag::Insert => {
                    added += 1;
                    RowKind::Add
                }
                ChangeTag::Delete => {
                    removed += 1;
                    RowKind::Remove
                }
            };
            let text = change.value().strip_suffix('\n').unwrap_or(change.value());
            DiffRow { kind, old: number(change.old_index()), new: number(change.new_index()), text: text.strip_suffix('\r').unwrap_or(text).to_string(), fold: None }
        })
        .collect();
    let folds = fold_runs(&mut rows, CONTEXT_LINES, MIN_FOLDED);
    Ok((rows, folds, added, removed))
}

/// Folds each run of unchanged lines down to `context` lines on the side of every change it touches — the head of a
/// file keeps only its last lines, the tail only its first — when at least `min_folded` lines would be hidden. The
/// hidden rows carry their fold's id; the folds come back in order.
pub fn fold_runs(rows: &mut [DiffRow], context: usize, min_folded: usize) -> Vec<Fold> {
    let mut folds = Vec::new();
    let mut start = 0;
    while start < rows.len() {
        if rows[start].kind != RowKind::Context {
            start += 1;
            continue;
        }
        let end = rows[start..].iter().position(|r| r.kind != RowKind::Context).map_or(rows.len(), |n| start + n);
        let keep_head = if start == 0 { 0 } else { context };
        let keep_tail = if end == rows.len() { 0 } else { context };
        let len = end - start;
        if len >= keep_head + keep_tail + min_folded {
            let id = u32::try_from(folds.len()).unwrap_or(u32::MAX);
            let (from, to) = (start + keep_head, end - keep_tail);
            for row in &mut rows[from..to] {
                row.fold = Some(id);
            }
            folds.push(Fold { id, lines: u32::try_from(to - from).unwrap_or(u32::MAX) });
        }
        start = end;
    }
    folds
}

/// "1,204": the words of rule 25 group thousands.
pub fn grouped(n: u32) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn numbered(n: usize) -> String {
        (1..=n).map(|i| format!("line {i}\n")).collect()
    }

    fn shape(rows: &[DiffRow]) -> Vec<String> {
        rows.iter()
            .map(|r| {
                let sign = match r.kind {
                    RowKind::Context => ' ',
                    RowKind::Add => '+',
                    RowKind::Remove => '-',
                };
                let fold = r.fold.map(|f| format!(" [fold {f}]")).unwrap_or_default();
                format!("{sign}{:?}/{:?} {}{fold}", r.old, r.new, r.text)
            })
            .collect()
    }

    #[test]
    fn a_changed_line_is_one_removal_and_one_addition() {
        let (rows, folds, added, removed) = diff("one\ntwo\nthree\n", "one\nTWO\nthree\n", DIFF_DEADLINE).unwrap();
        assert_eq!(shape(&rows), [" Some(1)/Some(1) one", "-Some(2)/None two", "+None/Some(2) TWO", " Some(3)/Some(3) three"]);
        assert_eq!((folds, added, removed), (vec![], 1, 1));
    }

    #[test]
    fn three_lines_of_context_and_a_forty_line_run_folds() {
        let before = format!("first\n{}last\n", numbered(40));
        let after = format!("FIRST\n{}LAST\n", numbered(40));
        let (rows, folds, added, removed) = diff(&before, &after, DIFF_DEADLINE).unwrap();
        assert_eq!((added, removed), (2, 2));
        assert_eq!(folds, [Fold { id: 0, lines: 34 }]);
        let visible: Vec<&DiffRow> = rows.iter().filter(|r| r.fold.is_none()).collect();
        let texts: Vec<&str> = visible.iter().map(|r| r.text.as_str()).collect();
        assert_eq!(texts, ["first", "FIRST", "line 1", "line 2", "line 3", "line 38", "line 39", "line 40", "last", "LAST"]);
        assert_eq!(rows.iter().filter(|r| r.fold == Some(0)).count(), 34);
    }

    #[test]
    fn a_short_run_is_shown_rather_than_folded_and_the_ends_keep_only_the_side_that_touches_a_change() {
        // Nine unchanged lines between two changes: 3 + 3 kept leaves 3 to hide, fewer than MIN_FOLDED.
        let (_, folds, ..) = diff(&format!("a\n{}b\n", numbered(9)), &format!("A\n{}B\n", numbered(9)), DIFF_DEADLINE).unwrap();
        assert_eq!(folds, vec![]);
        // Twenty lines before the only change and twenty after: the head keeps its last three, the tail its first three.
        let (rows, folds, ..) = diff(&format!("{}x\n{}", numbered(20), numbered(20)), &format!("{}X\n{}", numbered(20), numbered(20)), DIFF_DEADLINE).unwrap();
        assert_eq!(folds, [Fold { id: 0, lines: 17 }, Fold { id: 1, lines: 17 }]);
        assert_eq!(rows.iter().position(|r| r.fold.is_none()), Some(17));
    }

    #[test]
    fn an_added_file_is_all_additions_and_a_deleted_file_all_removals() {
        let (rows, _, added, removed) = diff("", "# New\n\nText.\n", DIFF_DEADLINE).unwrap();
        assert_eq!((added, removed), (3, 0));
        assert!(rows.iter().all(|r| r.kind == RowKind::Add && r.old.is_none() && r.new.is_some()));
        let (rows, _, added, removed) = diff("# Old\n\nText.\n", "", DIFF_DEADLINE).unwrap();
        assert_eq!((added, removed), (0, 3));
        assert!(rows.iter().all(|r| r.kind == RowKind::Remove && r.new.is_none() && r.old.is_some()));
    }

    #[test]
    fn line_endings_are_not_part_of_the_text() {
        let (rows, ..) = diff("one\r\ntwo\r\n", "one\r\nTWO\r\n", DIFF_DEADLINE).unwrap();
        assert_eq!(rows.iter().map(|r| r.text.as_str()).collect::<Vec<_>>(), ["one", "two", "TWO"]);
        let (rows, ..) = diff("no newline", "no newline at the end", DIFF_DEADLINE).unwrap();
        assert_eq!(rows.iter().map(|r| r.text.as_str()).collect::<Vec<_>>(), ["no newline", "no newline at the end"]);
    }

    #[test]
    fn past_the_deadline_is_too_many() {
        let before = numbered(1204);
        let after = numbered(980).replace("line 5\n", "line five\n");
        assert_eq!(diff(&before, &after, Duration::ZERO), Err(TooMany { before_lines: 1204, after_lines: 980 }));
    }

    #[test]
    fn thousands_are_grouped() {
        assert_eq!([grouped(7), grouped(980), grouped(1204), grouped(1_000_000)], ["7", "980", "1,204", "1,000,000"]);
    }
}
