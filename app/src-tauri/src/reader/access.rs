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

    #[test]
    fn only_markdown_and_known_images_pass_the_extension_checks() {
        assert!(is_markdown(Path::new("/a/b.MDX")));
        assert!(!is_markdown(Path::new("/a/b.markdown")));
        assert!(is_image(Path::new("/a/b.SVG")));
        assert!(!is_image(Path::new("/a/b.pdf")));
    }
}
