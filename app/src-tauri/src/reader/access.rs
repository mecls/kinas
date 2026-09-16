//! What the reader may open (PRD R2, R3, R8–R10). Every path is judged on disk, after symlinks, against the
//! projects root or a path Miguel allowed by hand. The socket and every reader command call these, so nothing is
//! trusted because the CLI (or the webview) checked it first.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Larger markdown is refused in the reader (R10). The largest markdown file under the root was 2 342 lines.
pub const MAX_MARKDOWN_BYTES: u64 = 2 * 1024 * 1024;
/// Larger images are shown as their alt text (R20).
pub const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
pub const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Dir,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Denied {
    Missing,
    NotMarkdown,
    Outside,
    TooLarge(u64),
    NotUtf8,
    Unreadable(String),
}

impl Denied {
    /// The socket protocol's error code (R17).
    pub fn code(&self) -> &'static str {
        match self {
            Denied::Missing => "missing",
            Denied::NotMarkdown => "not_markdown",
            Denied::Outside => "outside",
            Denied::TooLarge(_) => "too_large",
            Denied::NotUtf8 => "not_utf8",
            Denied::Unreadable(_) => "unreadable",
        }
    }

    /// The one line `kinas open` prints for this refusal (R5, R6, R12). `root` is the root's real path.
    pub fn cli_message(&self, path: &Path, root: &Path) -> String {
        let path = path.display();
        match self {
            Denied::Missing => format!("kinas open: no such file: {path}"),
            Denied::NotMarkdown => format!("kinas open: {path} is not a .md or .mdx file"),
            Denied::Outside => format!("kinas open: {path} is outside {}; add --anywhere to ask Kinas to open it", root.display()),
            Denied::TooLarge(bytes) => format!("kinas open: {path} is too large to read here ({})", megabytes(*bytes)),
            Denied::NotUtf8 => format!("kinas open: {path} is not UTF-8 text"),
            Denied::Unreadable(e) => format!("kinas open: could not read {path}: {e}"),
        }
    }

    /// The line the reader shows for this refusal (§4 of the build spec).
    pub fn reader_message(&self, path: &Path) -> String {
        match self {
            Denied::Missing => format!("No such file: {}", path.display()),
            Denied::NotMarkdown => format!("Kinas reads only .md and .mdx: {}", path.display()),
            Denied::Outside => format!("{} is outside the projects root", path.display()),
            Denied::TooLarge(bytes) => format!("Too large to read here ({})", megabytes(*bytes)),
            Denied::NotUtf8 => "Not UTF-8 text".into(),
            Denied::Unreadable(e) => format!("Could not read {}: {e}", path.display()),
        }
    }
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1_000_000.0)
}

/// How many bytes of a file's head decide whether it is text (R1).
///
/// One page. WHATWG mimesniff looks at 1445; 4096 costs the same syscall and catches a text header over a binary
/// payload — a `.sqlite`, a uuencoded blob — which 1445 can miss.
//
// `allow(dead_code)` until task 2.0 calls these from `read_text` and `list_dir`. Task 1.0 writes the rule and its
// shared case table before anything uses it, so the Rust and TypeScript halves cannot be born disagreeing — and
// clippy runs with `-D warnings`, so the attribute is what lets that land as its own commit. Remove all three in
// 2.0. Build 2 did the same for `mod reader` until task 4.1.
#[allow(dead_code)]
pub const SNIFF_BYTES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum Content {
    Text,
    Binary,
}

/// Whether a file's head reads as text (R1).
///
/// Two tests, in order: no binary-data byte, then valid UTF-8. The byte set is taken verbatim from WHATWG
/// mimesniff's "binary data byte" — `0x00–0x08`, `0x0B`, `0x0E–0x1A`, `0x1C–0x1F` — which is the algorithm
/// browsers already use to decide `text/plain` against `application/octet-stream`. Do not replace it with a
/// control-character ratio: a ratio needs a threshold, every threshold is arbitrary, and this one is citable.
///
/// Two absences earn their place. `0x1B` (ESC) is not a binary byte, so an ANSI-coloured log opens. `0x09`,
/// `0x0A`, `0x0C` and `0x0D` are not either, so tabs and newlines open. `0x08` is, which is what makes ELF,
/// Mach-O, PNG and zip fail inside their first bytes.
///
/// A multi-byte sequence chopped by the 4096-byte window is tolerated: the rest of it is simply not here yet,
/// so up to three trailing bytes are dropped before the last UTF-8 attempt. An empty head is text.
#[allow(dead_code)] // Until task 2.0 calls it; see the note on SNIFF_BYTES above.
pub fn sniff(head: &[u8]) -> Content {
    let head = head.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(head);
    if head.iter().any(|b| matches!(b, 0x00..=0x08 | 0x0B | 0x0E..=0x1A | 0x1C..=0x1F)) {
        return Content::Binary;
    }
    if std::str::from_utf8(head).is_ok() {
        return Content::Text;
    }
    for cut in 1..=3.min(head.len()) {
        if std::str::from_utf8(&head[..head.len() - cut]).is_ok() {
            return Content::Text;
        }
    }
    Content::Binary
}

/// `.md` or `.mdx`, case-insensitive (R3). Callers pass the real path, so a `plan.md` link to a `.txt` is refused.
pub fn is_markdown(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("mdx"))
}

pub fn is_image(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| IMAGE_EXTENSIONS.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

fn io_denied(e: std::io::Error) -> Denied {
    if e.kind() == std::io::ErrorKind::NotFound || e.raw_os_error() == Some(libc::ENOTDIR) {
        Denied::Missing
    } else {
        Denied::Unreadable(e.to_string())
    }
}

/// The real path and what it is. A directory is accepted (R4); a file must be markdown by its real name (R3).
pub fn resolve(path: &Path) -> Result<(PathBuf, Kind), Denied> {
    let real = std::fs::canonicalize(path).map_err(io_denied)?;
    let meta = std::fs::metadata(&real).map_err(io_denied)?;
    if meta.is_dir() {
        return Ok((real, Kind::Dir));
    }
    if !meta.is_file() || !is_markdown(&real) {
        return Err(Denied::NotMarkdown);
    }
    Ok((real, Kind::File))
}

/// The root's real path, or the root as given when it does not exist.
pub fn real_root(root: &Path) -> PathBuf {
    std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf())
}

/// `real` is `base` or inside it (R2). Compared as text with a trailing `/`, so `SintraLabs-old` is not inside
/// `SintraLabs`. `real` must already be canonical; `base` is canonicalized here.
pub fn inside(real: &Path, base: &Path) -> bool {
    let base = real_root(base);
    if real == base {
        return true;
    }
    let base = base.to_string_lossy();
    let prefix = format!("{}/", base.trim_end_matches('/'));
    real.to_string_lossy().starts_with(&prefix)
}

/// Inside the root, or equal to or under a path Miguel allowed (R8, R9).
pub fn permitted(real: &Path, root: &Path, allowed: &HashSet<PathBuf>) -> bool {
    inside(real, root) || allowed.iter().any(|a| inside(real, a))
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Text {
    pub text: String,
    /// FNV-1a 64 of the bytes, in hex: a reload with the same hash does nothing (R30).
    pub hash: String,
    pub mtime_ms: i64,
    pub size: u64,
}

/// Reads a markdown file whose real path was already resolved and permitted (R10).
pub fn read_markdown(real: &Path) -> Result<Text, Denied> {
    let meta = std::fs::metadata(real).map_err(io_denied)?;
    if meta.len() > MAX_MARKDOWN_BYTES {
        return Err(Denied::TooLarge(meta.len()));
    }
    let bytes = std::fs::read(real).map_err(io_denied)?;
    let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    let hash = fnv1a(body);
    let text = String::from_utf8(body.to_vec()).map_err(|_| Denied::NotUtf8)?;
    let mtime_ms = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
    Ok(Text { text, hash, mtime_ms, size: meta.len() })
}

pub fn fnv1a(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// How the reader's header names a path (R33): relative to the root inside it, `~/…` under the home folder,
/// absolute otherwise.
pub fn display_path(real: &Path, root: &Path, home: &Path) -> String {
    let root = real_root(root);
    if let Ok(rel) = real.strip_prefix(&root) {
        let rel = rel.to_string_lossy();
        return if rel.is_empty() { ".".into() } else { rel.into_owned() };
    }
    if let Ok(rel) = real.strip_prefix(real_root(home)) {
        return format!("~/{}", rel.to_string_lossy());
    }
    real.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    struct Tree {
        _dir: tempfile::TempDir,
        base: PathBuf,
        root: PathBuf,
    }

    fn tree() -> Tree {
        let dir = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(dir.path()).unwrap();
        let root = base.join("root");
        for d in ["root/docs", "root-old", "outside/a/b"] {
            fs::create_dir_all(base.join(d)).unwrap();
        }
        for f in ["root/a.md", "root/UPPER.MD", "root/notes.txt", "root-old/x.md", "outside/b.md", "outside/a/b/c.md", "root/docs/README.md"] {
            fs::write(base.join(f), "# x\n").unwrap();
        }
        symlink(base.join("outside/b.md"), root.join("link.md")).unwrap();
        symlink(root.join("notes.txt"), root.join("plan.md")).unwrap();
        Tree { _dir: dir, base, root }
    }

    #[test]
    fn a_markdown_file_inside_the_root_resolves() {
        let t = tree();
        let (real, kind) = resolve(&t.root.join("a.md")).unwrap();
        assert_eq!((real.clone(), kind), (t.root.join("a.md"), Kind::File));
        assert!(inside(&real, &t.root));
        assert_eq!(resolve(&t.root.join("UPPER.MD")).unwrap().1, Kind::File);
        assert_eq!(resolve(&t.root.join("docs")).unwrap().1, Kind::Dir);
    }

    #[test]
    fn a_sibling_whose_name_starts_with_the_root_is_outside() {
        let t = tree();
        let (real, _) = resolve(&t.base.join("root-old/x.md")).unwrap();
        assert!(!inside(&real, &t.root));
    }

    #[test]
    fn a_symlink_is_judged_by_its_target() {
        let t = tree();
        let (real, _) = resolve(&t.root.join("link.md")).unwrap();
        assert_eq!(real, t.base.join("outside/b.md"));
        assert!(!inside(&real, &t.root));
        assert_eq!(resolve(&t.root.join("plan.md")), Err(Denied::NotMarkdown));
    }

    #[test]
    fn a_missing_path_is_missing_and_never_created() {
        let t = tree();
        assert_eq!(resolve(&t.root.join("new.md")), Err(Denied::Missing));
        assert_eq!(resolve(&t.root.join("a.md/child.md")), Err(Denied::Missing));
        assert!(!t.root.join("new.md").exists());
    }

    #[test]
    fn an_allowed_folder_covers_everything_under_it() {
        let t = tree();
        let (deep, _) = resolve(&t.base.join("outside/a/b/c.md")).unwrap();
        let mut allowed = HashSet::new();
        assert!(!permitted(&deep, &t.root, &allowed));
        allowed.insert(t.base.join("outside"));
        assert!(permitted(&deep, &t.root, &allowed));
    }

    #[test]
    fn markdown_is_read_with_limits() {
        let t = tree();
        let big = t.root.join("big.md");
        fs::write(&big, vec![b'a'; (MAX_MARKDOWN_BYTES + 1) as usize]).unwrap();
        assert!(matches!(read_markdown(&big), Err(Denied::TooLarge(_))));
        let bad = t.root.join("bad.md");
        fs::write(&bad, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(read_markdown(&bad), Err(Denied::NotUtf8));
        let bom = t.root.join("bom.md");
        fs::write(&bom, b"\xEF\xBB\xBF# Title\n").unwrap();
        let text = read_markdown(&bom).unwrap();
        assert_eq!(text.text, "# Title\n");
        assert_eq!(text.hash, fnv1a(b"# Title\n"));
    }

    #[test]
    fn the_header_names_paths_from_the_root_or_home() {
        let t = tree();
        assert_eq!(display_path(&t.root.join("docs/README.md"), &t.root, Path::new("/nowhere")), "docs/README.md");
        assert_eq!(display_path(&t.base.join("outside/b.md"), &t.root, &t.base), "~/outside/b.md");
        assert_eq!(display_path(&t.base.join("outside/b.md"), &t.root, Path::new("/nowhere")), t.base.join("outside/b.md").display().to_string());
    }

    // The same cases as cli/src/sniff.test.ts, so the CLI and the app agree on what a text file is. The table
    // stores bytes as hex because a NUL cannot be written as JSON text.
    #[test]
    fn the_sniff_matches_the_shared_cases() {
        #[derive(serde::Deserialize)]
        struct Case {
            name: String,
            hex: String,
            expected: String,
        }

        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/reader/sniff-cases.json");
        let cases: Vec<Case> = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert!(!cases.is_empty());
        for c in cases {
            assert!(c.hex.len() % 2 == 0, "odd hex: {}", c.name);
            let bytes: Vec<u8> = (0..c.hex.len()).step_by(2).map(|i| u8::from_str_radix(&c.hex[i..i + 2], 16).unwrap()).collect();
            let got = match sniff(&bytes) {
                Content::Text => "text",
                Content::Binary => "binary",
            };
            assert_eq!(got, c.expected, "{}", c.name);
        }
    }

    #[test]
    fn only_markdown_and_known_images_pass_the_extension_checks() {
        assert!(is_markdown(Path::new("/a/b.MDX")));
        assert!(!is_markdown(Path::new("/a/b.markdown")));
        assert!(is_image(Path::new("/a/b.SVG")));
        assert!(!is_image(Path::new("/a/b.pdf")));
    }
}
