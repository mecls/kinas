//! The Herdr actions with the agents on a VPS (build spec §11.2, slice 3; ADR 0024): every Herdr call but the Work
//! page's attach goes to `kinas companion` through the one door, and the companion runs it on the VPS's `default`
//! session with the Mac's own argv (cli/src/companion/actions.ts, herdr.ts). This module only asks and reads the
//! answer; the rules — when the launcher types, what a twin folder is — live there, tested against the Mac's.
//!
//! The companion answers `{ done: <word> }` or `{ cannot: <code> }`; each becomes the outcome or the one line the Mac
//! shows on its own path, and a door that fails says `can't reach vps-1: …`.

use super::launch::Launched;
use super::CrewError;
use crate::herdr::View;
use crate::place::{place, Place};
use crate::readers::runtime::ReaderControl;
use crate::remote::{self, Request, Unreachable};
use crate::store::Store;
use tauri::{AppHandle, Manager};

/// The VPS's target and label, when the agents run there.
pub(crate) fn vps(app: &AppHandle) -> Option<(String, String)> {
    let store = app.state::<Store>();
    let conn = store.conn();
    match place(&conn, store.org_id()) {
        Place::Vps { target, label } => Some((target, label)),
        Place::Mac => None,
    }
}

/// What the companion said: the word it did, or the code it could not.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Answer {
    Done(String),
    Cannot(String),
}

/// The reply's outcome; anything else is not an answer of this Kinas's companion.
pub(crate) fn answer_of(reply: &serde_json::Value) -> Result<Answer, Unreachable> {
    let word = |k: &str| reply.get(k).and_then(serde_json::Value::as_str).filter(|w| w.len() <= 40 && w.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
    match (word("done"), word("cannot")) {
        (Some(w), None) => Ok(Answer::Done(w.to_string())),
        (None, Some(c)) => Ok(Answer::Cannot(c.to_string())),
        _ => Err(Unreachable::BadReply),
    }
}

/// A code the companion could not get past, in the words the Mac's own path uses, with the VPS named where it matters.
pub(crate) fn cannot_words(code: &str, label: &str) -> (&'static str, String) {
    match code {
        "not-installed" => ("not_installed", format!("Firstmate isn't installed on {label} — Settings → Where agents run")),
        // ADR 0026: the first mate is launched only with Kinas's relay instruction, which Settings installs.
        "no-instruction" => ("not_installed", format!("Kinas's relay instruction isn't on {label} — Settings → Where agents run")),
        "herdr-not-running" => ("herdr_not_running", format!("Herdr isn't running on {label}")),
        "no-workspace" => ("no_task", "That task has no pane in this session".into()),
        "not-there" => ("not_there", format!("That folder isn't in {label}'s projects folder")),
        _ => ("herdr_failed", format!("Herdr on {label} did not do it")),
    }
}

fn ask(app: &AppHandle, target: &str, request: &Request) -> Result<serde_json::Value, Unreachable> {
    let data_dir = app.state::<ReaderControl>().data_dir().to_path_buf();
    remote::call(target, &data_dir, request)
}

fn unreachable(why: Unreachable, label: &str) -> CrewError {
    CrewError { code: "unreachable", message: why.words(label) }
}

/// One action at a time, as on this Mac (`herdr::OPENING`): two quick clicks never make two workspaces there.
fn act(app: &AppHandle, request: &Request) -> Result<String, CrewError> {
    let Some((target, label)) = vps(app) else { return Err(CrewError::internal("the agents run on this Mac")) };
    let _one_at_a_time = crate::herdr::OPENING.lock().unwrap_or_else(|p| p.into_inner());
    let reply = ask(app, &target, request).map_err(|why| unreachable(why, &label))?;
    match answer_of(&reply).map_err(|why| unreachable(why, &label))? {
        Answer::Done(word) => Ok(word),
        Answer::Cannot(code) => {
            let (code, message) = cannot_words(&code, &label);
            Err(CrewError { code, message })
        }
    }
}

/// Launch the first mate on the VPS: focused, run or created, as the Mac's launcher says it.
pub(crate) fn launch(app: &AppHandle) -> Result<Launched, CrewError> {
    match act(app, &Request::LaunchFirstMate)?.as_str() {
        "focused" => Ok(Launched::Focused),
        "run" => Ok(Launched::Run),
        "created" => Ok(Launched::Created),
        other => Err(CrewError::internal(format!("the Linux machine answered the launch with {other:?}"))),
    }
}

/// Focus a workspace on the VPS.
pub(crate) fn focus(app: &AppHandle, workspace: &str) -> Result<(), CrewError> {
    act(app, &Request::Focus { workspace: workspace.to_string() }).map(|_| ())
}

/// Open in the terminal on the VPS (PRD rule 6): the folder's twin under the VPS's projects folder, by the same label,
/// focused or made there — or the one line saying it is not there. `real` is the Mac folder the reader checked.
pub(crate) fn open(app: &AppHandle, real: &std::path::Path, root: &std::path::Path, label: &str) -> Result<crate::reader::workspace::Opened, String> {
    use crate::reader::workspace::Opened;
    let Some((_, place_label)) = vps(app) else { return Err("the agents run on this Mac".into()) };
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let folder = relative_folder(real, &root).ok_or_else(|| format!("That folder isn't in {place_label}'s projects folder"))?;
    match act(app, &Request::OpenWorkspace { folder, label: label.to_string() }).map_err(|e| e.message)?.as_str() {
        "focused" => Ok(Opened::Focused),
        "created" => Ok(Opened::Created),
        other => Err(format!("the Linux machine answered Open in the terminal with {other:?}")),
    }
}

/// Herdr's view of the VPS's `default` session and its focused pane's foreground, read now. None when the door or
/// Herdr there did not answer.
pub(crate) fn view(app: &AppHandle) -> Option<(View, Vec<String>)> {
    let (target, _) = vps(app)?;
    let reply = ask(app, &target, &Request::View).ok()?;
    view_of(&reply)
}

pub(crate) fn view_of(reply: &serde_json::Value) -> Option<(View, Vec<String>)> {
    let view = crate::herdr::parse_view(reply.get("herdr_view")?.as_str()?).ok()?;
    let fg = reply.get("herdr_foreground").and_then(serde_json::Value::as_str).map(crate::herdr::parse_foreground).unwrap_or_default();
    Some((view, fg))
}

/// A Mac folder's twin on the VPS: its path relative to the projects folder, or None when it is not under it. The
/// companion checks the rest there (it exists, it is a folder, its real path stays inside).
pub(crate) fn relative_folder(real: &std::path::Path, root: &std::path::Path) -> Option<String> {
    use std::path::Component;
    let rel = real.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| match c {
            Component::Normal(p) => p.to_str().map(str::to_string),
            _ => None,
        })
        .collect::<Option<_>>()?;
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn a_reply_is_one_word_done_or_one_code_cannot() {
        assert_eq!(answer_of(&json!({"v": 1, "done": "created"})), Ok(Answer::Done("created".into())));
        assert_eq!(answer_of(&json!({"v": 1, "cannot": "not-there"})), Ok(Answer::Cannot("not-there".into())));
        for bad in [json!({"v": 1}), json!({"done": "x", "cannot": "y"}), json!({"done": 3}), json!({"done": "Rm -rf"}), json!({"cannot": "x".repeat(41)})] {
            assert_eq!(answer_of(&bad), Err(Unreachable::BadReply), "{bad}");
        }
    }

    #[test]
    fn what_could_not_be_done_is_said_as_the_mac_says_it_naming_the_vps() {
        assert_eq!(cannot_words("herdr-not-running", "vps-1"), ("herdr_not_running", "Herdr isn't running on vps-1".to_string()));
        assert_eq!(cannot_words("not-there", "vps-1").1, "That folder isn't in vps-1's projects folder");
        assert_eq!(cannot_words("no-workspace", "vps-1").0, "no_task");
        assert_eq!(
            cannot_words("no-instruction", "vps-1"),
            ("not_installed", "Kinas's relay instruction isn't on vps-1 — Settings → Where agents run".to_string())
        );
        assert_eq!(cannot_words("something-new", "vps-1").0, "herdr_failed");
    }

    #[test]
    fn the_view_reads_as_the_local_one_does() {
        let fixture = |n: &str| std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(n)).unwrap();
        let reply = json!({"v": 1, "herdr_view": fixture("herdr-api-snapshot.captured.json"), "herdr_foreground": fixture("herdr-process-info.claude.captured.json")});
        let (view, fg) = view_of(&reply).unwrap();
        assert_eq!(view.focused_pane.as_deref(), Some("w1:p1"));
        assert_eq!(fg, crate::herdr::parse_foreground(&fixture("herdr-process-info.claude.captured.json")));
        assert!(view_of(&json!({"v": 1, "herdr_view": null, "herdr_foreground": null})).is_none());
    }

    #[test]
    fn a_folder_s_twin_is_its_path_under_the_projects_folder() {
        let root = Path::new("/p");
        assert_eq!(relative_folder(Path::new("/p/kinas/docs"), root).as_deref(), Some("kinas/docs"));
        assert_eq!(relative_folder(Path::new("/p"), root).as_deref(), Some(""));
        assert_eq!(relative_folder(Path::new("/elsewhere/x"), root), None);
        assert_eq!(relative_folder(Path::new("/p/../etc"), root), None);
    }
}
