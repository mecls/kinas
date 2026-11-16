//! The palette's file search (tasks/interface-polish, PRD rules 13, 15 and 18; build-spec §11.2).
//!
//! Every file and folder name under the projects folder, walked as `kinas open` walks it (names starting with a dot
//! and `SKIPPED` left out, `INDEX_DEPTH` folders deep), held in memory with its name and path folded for case and
//! accents. The palette warms it when it opens; a search scores the held entries and never walks. An index older
//! than `INDEX_MAX_AGE_MS` is rebuilt on its own thread while the old one keeps answering, so a file made in the last
//! five minutes can be missing until then (build-spec §11.5, 1).
//!
//! The index never leaves the projects folder (invariant 4): the root is canonicalised once and no symbolic link is
//! followed or listed, so every path is the canonical root joined with names the walk read — inside it by
//! construction. Nothing here writes a row, a setting or a file, and the log gets counts and durations only, never a
//! query, a name or a path (invariant 5).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use serde::Serialize;
use tauri::Manager;

use crate::reader::access::{self, Kind};

pub const INDEX_CAP: usize = 200_000;
pub const INDEX_DEPTH: usize = 8;
pub const INDEX_MAX_AGE_MS: i64 = 300_000;
/// Left out wherever they are, with every name that starts with a dot (`cli/src/find.ts`'s `SKIPPED`).
pub const SKIPPED: [&str; 6] = ["node_modules", "target", "dist", "build", "Pods", ".git"];
/// A search slower than this is logged, by its count and its time (rule 18's budget).
const SLOW_SEARCH_MS: u128 = 100;

/// The managed index: the last complete walk, and whether a walk is running.
#[derive(Default)]
pub struct Index(Mutex<IndexState>);

#[derive(Default)]
struct IndexState {
    ready: Option<Arc<Built>>,
    building: bool,
}

/// One complete walk of one root.
struct Built {
    root: PathBuf,
    at_ms: i64,
    entries: Vec<Entry>,
    capped: bool,
}

struct Entry {
    /// The canonical root joined with the walked names: the real path the reader opens.
    path: PathBuf,
    /// The path under the projects folder, as the sidebar writes it.
    display: String,
    name: String,
    folded_name: String,
    folded_path: String,
    kind: Kind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileMatch {
    /// The real path, as the reader opens it.
    pub path: String,
    /// The path under the projects folder, as the sidebar writes it.
    pub display_path: String,
    pub name: String,
    pub kind: Kind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileSearch {
    /// No complete index of this root yet: the group says "Indexing files…" (rule 18).
    pub indexing: bool,
    /// The index stopped at `INDEX_CAP`: the group says only the first entries are searched.
    pub capped: bool,
    pub matches: Vec<FileMatch>,
    /// How many more matched than `limit`.
    pub more: u32,
}

impl Index {
    fn state(&self) -> MutexGuard<'_, IndexState> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// True when a walk of `root` should start now — none held for it, or the held one is old — and none is running;
    /// the caller then owns the walk and hands it to `finish`.
    fn claim(&self, root: &Path, now_ms: i64) -> bool {
        let mut state = self.state();
        let fresh = state.ready.as_ref().is_some_and(|b| b.root == root && now_ms - b.at_ms < INDEX_MAX_AGE_MS);
        if fresh || state.building {
            return false;
        }
        state.building = true;
        true
    }

    fn finish(&self, built: Option<Built>) {
        let mut state = self.state();
        if let Some(built) = built {
            state.ready = Some(Arc::new(built));
        }
        state.building = false;
    }

    /// The held walk of `root`, if there is one — an old one included: it answers while its successor is walked.
    fn ready_for(&self, root: &Path) -> Option<Arc<Built>> {
        self.state().ready.as_ref().filter(|b| b.root == root).cloned()
    }
}

/// Starts the index, or rebuilds it on its own thread when it is old. Returns at once.
#[tauri::command]
pub async fn files_index_warm(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        warm(&app);
    })
    .await
    .map_err(|e| e.to_string())
}

/// The best `limit` files and folders whose name or path matches `query`, under the projects folder only.
#[tauri::command]
pub async fn files_search(app: tauri::AppHandle, query: String, limit: u32) -> Result<FileSearch, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = warm(&app);
        match app.state::<Index>().ready_for(&root) {
            Some(built) => search(&built, &query, limit as usize),
            None => FileSearch { indexing: true, capped: false, matches: Vec::new(), more: 0 },
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Claims a walk when one is due and runs it on `kinas-file-index`. Returns the canonical root it judged.
fn warm(app: &tauri::AppHandle) -> PathBuf {
    let root = access::real_root(&crate::paths::projects_root_of(&app.state::<crate::store::Store>()));
    if app.state::<Index>().claim(&root, crate::store::now_ms()) {
        let (walker, walked) = (app.clone(), root.clone());
        let spawned = std::thread::Builder::new()
            .name("kinas-file-index".into())
            .spawn(move || walker.state::<Index>().finish(Some(build(&walked))));
        if spawned.is_err() {
            log::warn!("file index: the walk could not start");
            app.state::<Index>().finish(None);
        }
    }
    root
}

/// The walk (invariant 4). `root` must be canonical. Breadth first, each folder's names in order, so a capped index
/// holds the shallowest entries and two walks of one tree agree.
fn build(root: &Path) -> Built {
    build_with_cap(root, INDEX_CAP)
}

fn build_with_cap(root: &Path, cap: usize) -> Built {
    let started = Instant::now();
    let mut entries = Vec::new();
    let mut capped = false;
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
    'walk: while let Some((dir, depth)) = queue.pop_front() {
        let Ok(read) = std::fs::read_dir(&dir) else { continue };
        let mut children: Vec<(String, bool)> = read
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                // `DirEntry::file_type` does not follow a link: a symbolic link is neither, so it is never listed.
                let kind = e.file_type().ok()?;
                let name = e.file_name().into_string().ok()?;
                (kind.is_dir() || kind.is_file()).then_some((name, kind.is_dir()))
            })
            .filter(|(name, _)| !name.starts_with('.') && !SKIPPED.contains(&name.as_str()))
            .collect();
        children.sort();
        for (name, is_dir) in children {
            if entries.len() >= cap {
                capped = true;
                break 'walk;
            }
            let path = dir.join(&name);
            let Ok(rel) = path.strip_prefix(root) else { continue };
            let display = rel.to_string_lossy().into_owned();
            if is_dir && depth < INDEX_DEPTH {
                queue.push_back((path.clone(), depth + 1));
            }
            entries.push(Entry {
                folded_name: fold(&name),
                folded_path: fold(&display),
                kind: if is_dir { Kind::Dir } else { Kind::File },
                path,
                display,
                name,
            });
        }
    }
    log::info!("{}", index_line(entries.len(), capped, started.elapsed().as_millis()));
    Built { root: root.to_path_buf(), at_ms: crate::store::now_ms(), entries, capped }
}

fn index_line(count: usize, capped: bool, ms: u128) -> String {
    format!("file index: {count} entries in {ms} ms{}", if capped { ", capped" } else { "" })
}

fn slow_search_line(count: usize, ms: u128) -> Option<String> {
    (ms > SLOW_SEARCH_MS).then(|| format!("file search: slow, {count} entries in {ms} ms"))
}

/// The best `limit` matches, best first: by `score`, then the shorter path, then the path's letters.
fn search(built: &Built, query: &str, limit: usize) -> FileSearch {
    let started = Instant::now();
    let folded = fold(query.trim());
    let mut hits: Vec<(u32, &Entry)> = if folded.is_empty() {
        Vec::new()
    } else {
        built.entries.iter().filter_map(|e| score(&folded, e).map(|s| (s, e))).collect()
    };
    let order = |(sa, a): &(u32, &Entry), (sb, b): &(u32, &Entry)| sb.cmp(sa).then(a.display.len().cmp(&b.display.len())).then(a.display.cmp(&b.display));
    let more = hits.len().saturating_sub(limit) as u32;
    // A short query can match most of the index: the best `limit` are picked out first, and only they are sorted.
    if hits.len() > limit && limit > 0 {
        hits.select_nth_unstable_by(limit - 1, order);
        hits.truncate(limit);
    }
    hits.sort_by(order);
    let matches = hits
        .into_iter()
        .take(limit)
        .map(|(_, e)| FileMatch { path: e.path.display().to_string(), display_path: e.display.clone(), name: e.name.clone(), kind: e.kind })
        .collect();
    if let Some(line) = slow_search_line(built.entries.len(), started.elapsed().as_millis()) {
        log::info!("{line}");
    }
    FileSearch { indexing: false, capped: built.capped, matches, more }
}

/// Lowercase, without accents: combining marks (U+0300–U+036F) dropped and precomposed Latin letters taken to their
/// base, so a name stored composed and one stored decomposed fold alike (rule 15). A table, not a library (Gate 2):
/// letters outside it fold by case only. `app/src/palette/match.ts` folds the same way for the webview's groups.
pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars().flat_map(char::to_lowercase) {
        if c.is_ascii() {
            out.push(c);
            continue;
        }
        if ('\u{300}'..='\u{36f}').contains(&c) {
            continue;
        }
        match LATIN.iter().find(|(from, _)| from.contains(c)) {
            Some((_, to)) => out.push_str(to),
            None => out.push(c),
        }
    }
    out
}

/// Lowercase precomposed Latin letters and what each folds to.
const LATIN: [(&str, &str); 28] = [
    ("àáâãäåāăąǎǟǡǻȁȃȧạảấầẩẫậắằẳẵặ", "a"),
    ("çćĉċč", "c"),
    ("ďđ", "d"),
    ("èéêëēĕėęěȅȇȩẹẻẽếềểễệ", "e"),
    ("ĝğġģǧǵ", "g"),
    ("ĥħ", "h"),
    ("ìíîïĩīĭįıǐȉȋỉị", "i"),
    ("ĵǰ", "j"),
    ("ķǩ", "k"),
    ("ĺļľŀł", "l"),
    ("ñńņňǹ", "n"),
    ("òóôõöøōŏőơǒǫǭǿȍȏȫȭȯȱọỏốồổỗộớờởỡợ", "o"),
    ("ŕŗřȑȓ", "r"),
    ("śŝşšș", "s"),
    ("ţťŧț", "t"),
    ("ùúûüũūŭůűųưǔǖǘǚǜȕȗụủứừửữự", "u"),
    ("ŵẁẃẅ", "w"),
    ("ýÿŷỳỵỷỹ", "y"),
    ("źżž", "z"),
    ("æ", "ae"),
    ("œ", "oe"),
    ("ß", "ss"),
    ("þ", "th"),
    ("ð", "d"),
    ("ĳ", "ij"),
    ("ŉ", "n"),
    ("ſ", "s"),
    ("ŋ", "n"),
];

/// Higher is better; `None` is no match. A name match beats any path match, and a match at the start of a word
/// beats one inside a word (rule 15): the whole name, then the name's start, a word in the name, inside the name,
/// a word in the path, inside the path.
fn score(folded_query: &str, e: &Entry) -> Option<u32> {
    let q = folded_query;
    if q.is_empty() {
        return None;
    }
    let tier = if e.folded_name == q {
        6
    } else if e.folded_name.starts_with(q) {
        5
    } else if at_word_start(&e.folded_name, q) {
        4
    } else if e.folded_name.contains(q) {
        3
    } else if at_word_start(&e.folded_path, q) {
        2
    } else if e.folded_path.contains(q) {
        1
    } else {
        return None;
    };
    Some(tier)
}

/// `q` occurs in `s` right after the start or a character that is not a letter or a digit.
fn at_word_start(s: &str, q: &str) -> bool {
    s.match_indices(q).any(|(i, _)| s[..i].chars().next_back().is_none_or(|c| !c.is_alphanumeric()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;

    /// A tree under a fresh temporary folder: `dirs` made, then `files` written. Returns the folder and its canonical
    /// path, the root `build` expects.
    fn tree(dirs: &[&str], files: &[&str]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        for d in dirs {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        for f in files {
            let path = root.join(f);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "x").unwrap();
        }
        (dir, root)
    }

    fn displays(built: &Built) -> Vec<&str> {
        built.entries.iter().map(|e| e.display.as_str()).collect()
    }

    fn entry(display: &str) -> Entry {
        let name = display.rsplit('/').next().unwrap().to_string();
        Entry {
            path: PathBuf::from("/root").join(display),
            display: display.into(),
            folded_name: fold(&name),
            folded_path: fold(display),
            name,
            kind: Kind::File,
        }
    }

    #[test]
    fn fold_takes_a_composed_and_a_decomposed_name_alike() {
        let composed = "reuni\u{e3}o";
        let decomposed = "reunia\u{303}o";
        assert_ne!(composed, decomposed);
        assert_eq!(fold(composed), "reuniao");
        assert_eq!(fold(decomposed), "reuniao");
    }

    #[test]
    fn fold_lowers_case_and_takes_latin_letters_to_their_base() {
        assert_eq!(fold("Ångström"), "angstrom");
        assert_eq!(fold("ÇÃO Straße Æsir Œuvre Łódź Þór"), "cao strasse aesir oeuvre lodz thor");
        assert_eq!(fold("Ünïcödé.MD"), "unicode.md");
        // Outside the table, by case only.
        assert_eq!(fold("Привет"), "привет");
    }

    #[test]
    fn index_skips() {
        let deep9 = "d1/d2/d3/d4/d5/d6/d7/d8/d9/deep9.md";
        let (_dir, root) = tree(
            &[],
            &[
                "keep.md",
                ".hidden.md",
                ".config/inside.md",
                "node_modules/pkg/index.js",
                "target/debug/app",
                "dist/out.js",
                "build/out.js",
                "Pods/pod.swift",
                "app/.git/HEAD",
                "app/src/main.rs",
                "d1/d2/d3/d4/d5/d6/d7/d8/deep8.md",
                deep9,
            ],
        );
        let built = build(&root);
        let seen = displays(&built);
        for kept in ["keep.md", "app", "app/src", "app/src/main.rs", "d1/d2/d3/d4/d5/d6/d7/d8/deep8.md", "d1/d2/d3/d4/d5/d6/d7/d8/d9"] {
            assert!(seen.contains(&kept), "{kept} should be indexed: {seen:?}");
        }
        for skipped in [".hidden.md", ".config", "node_modules", "target", "dist", "build", "Pods", "app/.git", deep9] {
            assert!(!seen.iter().any(|s| *s == skipped || s.starts_with(&format!("{skipped}/"))), "{skipped} should not be indexed: {seen:?}");
        }
        assert!(!built.capped);
        assert_eq!(built.root, root);
        // Breadth first, each folder's names in order: the root's own entries lead.
        assert_eq!(&seen[..4], ["app", "d1", "keep.md", "app/src"]);
    }

    #[test]
    fn index_never_follows_a_symlink_out() {
        let (_outside_dir, outside) = tree(&["secret"], &["secret/plans.md", "loose.md"]);
        let (_dir, root) = tree(&[], &["in.md"]);
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        std::os::unix::fs::symlink(outside.join("loose.md"), root.join("loose.md")).unwrap();
        let built = build(&root);
        assert_eq!(displays(&built), ["in.md"]);
        assert!(built.entries.iter().all(|e| e.path.starts_with(&root) && access::inside(&e.path, &root)));
        let found = search(&built, "plans", 10);
        assert!(found.matches.is_empty());
    }

    #[test]
    fn index_caps() {
        let files: Vec<String> = (0..3).map(|i| format!("f{i}.md")).collect();
        let (_dir, root) = tree(&[], &files.iter().map(String::as_str).collect::<Vec<_>>());
        // The cap itself is too many files for a test; the same walk with the cap at two proves the stop.
        let built = build_with_cap(&root, 2);
        assert!(built.capped);
        assert_eq!(displays(&built), ["f0.md", "f1.md"]);
        let exact = build_with_cap(&root, 3);
        assert!(!exact.capped, "a tree of exactly the cap is complete");
        assert_eq!(INDEX_CAP, 200_000);
    }

    #[test]
    fn a_word_start_ranks_above_inside_a_word_and_a_name_above_a_path() {
        let s = |q: &str, d: &str| score(&fold(q), &entry(d));
        assert!(s("inv", "inventory.ts") > s("inv", "reinvent.ts"));
        assert!(s("inv", "src/reinvent.ts") > s("inv", "invoices/notes.md"), "a name hit beats a path hit");
        assert!(s("notes", "notes") > s("notes", "notes.md"));
        assert!(s("plan", "my-plan.md") > s("plan", "airplane.md"));
        assert!(s("invoices", "invoices/notes.md") > s("voices", "invoices/notes.md"));
        assert_eq!(s("zzz", "inventory.ts"), None);
        assert_eq!(s("", "inventory.ts"), None);
        assert_eq!(s("reuniao", "atas/Reunião de março.md"), Some(5));
    }

    #[test]
    fn search_answers_best_first_and_counts_the_rest() {
        let (_dir, root) = tree(&[], &["reinvent.ts", "inventory.ts", "deep/inventory.ts", "invoices/a.md", "invoices/b.md", "other.md"]);
        let built = build(&root);
        let found = search(&built, "  INV ", 3);
        let names: Vec<&str> = found.matches.iter().map(|m| m.display_path.as_str()).collect();
        assert_eq!(names, ["invoices", "inventory.ts", "deep/inventory.ts"]);
        assert_eq!(found.more, 3, "reinvent.ts and the two files under invoices/ matched too");
        assert_eq!(found.matches[0].kind, Kind::Dir);
        assert_eq!(found.matches[1].path, root.join("inventory.ts").display().to_string());
        assert!(!found.indexing && !found.capped);
        assert!(search(&built, "   ", 3).matches.is_empty());
        assert_eq!(search(&built, "inv", 0).more, 6);
    }

    #[test]
    fn the_index_is_claimed_once_answers_while_old_and_is_walked_again_when_old_or_moved() {
        let index = Index::default();
        let (a, b) = (Path::new("/a"), Path::new("/b"));
        assert!(index.ready_for(a).is_none());
        assert!(index.claim(a, 0));
        assert!(!index.claim(a, 0), "one walk at a time");
        index.finish(Some(Built { root: a.into(), at_ms: 1_000, entries: Vec::new(), capped: false }));
        assert!(!index.claim(a, 1_000 + INDEX_MAX_AGE_MS - 1), "fresh");
        assert!(index.claim(a, 1_000 + INDEX_MAX_AGE_MS), "old");
        assert!(index.ready_for(a).is_some(), "the old walk answers while the new one runs");
        index.finish(None);
        assert!(index.ready_for(a).is_some(), "a walk that never ran leaves the held one");
        assert!(index.ready_for(b).is_none(), "another root has no index");
        assert!(index.claim(b, 2_000), "a moved root is walked at once");
    }

    #[test]
    fn the_log_lines_carry_counts_and_times_alone() {
        assert_eq!(index_line(41_235, false, 812), "file index: 41235 entries in 812 ms");
        assert_eq!(index_line(200_000, true, 9_100), "file index: 200000 entries in 9100 ms, capped");
        assert_eq!(slow_search_line(41_235, 100), None);
        assert_eq!(slow_search_line(41_235, 101).as_deref(), Some("file search: slow, 41235 entries in 101 ms"));
    }

    /// Rule 18's budget over a real folder (build-spec 2.4), in the debug build the tests run in:
    /// `KINAS_INDEX_PROBE=<folder> cargo test --lib search::tests::probe -- --ignored --nocapture`. It prints counts
    /// and times only, never a name or a path.
    #[test]
    #[ignore = "reads a real folder; run by hand"]
    fn probe() {
        let Some(root) = std::env::var_os("KINAS_INDEX_PROBE") else { return };
        let root = access::real_root(Path::new(&root));
        let started = Instant::now();
        let built = build(&root);
        let walk_ms = started.elapsed().as_millis();
        let queries = ["readme", "inv", "a", "e", "package.json", "reuniao", "src", "test", "zzzz", "index"];
        let mut slowest = 0;
        let mut matched = 0;
        for q in queries {
            let t = Instant::now();
            let found = search(&built, q, 50);
            slowest = slowest.max(t.elapsed().as_millis());
            matched += found.matches.len() + found.more as usize;
        }
        println!("probe: {} entries (capped: {}), walk {walk_ms} ms; {} searches, {matched} matches, slowest {slowest} ms", built.entries.len(), built.capped, queries.len());
        assert!(slowest <= 100, "rule 18: a search took {slowest} ms");
    }

    /// Every record the process logs from here on, for `search_logs_no_query_or_path`.
    struct Captured(Mutex<Vec<String>>);

    impl log::Log for Captured {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }
        fn log(&self, record: &log::Record) {
            self.0.lock().unwrap().push(format!("{} {}", record.target(), record.args()));
        }
        fn flush(&self) {}
    }

    fn captured() -> &'static Captured {
        static SINK: OnceLock<&'static Captured> = OnceLock::new();
        SINK.get_or_init(|| {
            let sink: &'static Captured = Box::leak(Box::new(Captured(Mutex::new(Vec::new()))));
            log::set_logger(sink).expect("no other test installs a logger");
            log::set_max_level(log::LevelFilter::Trace);
            sink
        })
    }

    #[test]
    fn search_logs_no_query_or_path() {
        let sink = captured();
        let (_dir, root) = tree(&["folder-7f3a"], &["folder-7f3a/name-7f3a.md", "other.md"]);
        let built = build(&root);
        let found = search(&built, "name-7f3a", 10);
        assert_eq!(found.matches.len(), 1);
        let lines = sink.0.lock().unwrap().clone();
        let ours: Vec<&String> = lines.iter().filter(|l| l.contains("file index: 3 entries in ")).collect();
        assert!(!ours.is_empty(), "the walk logs its count: {lines:?}");
        let root_text = root.display().to_string();
        for line in &lines {
            assert!(!line.contains("7f3a") && !line.contains(&root_text), "a name or a path reached the log: {line}");
        }
    }
}
