//! Open in the terminal (reader PRD R37b): a folder gets a Herdr workspace of its own, and a second click finds it
//! again instead of making another. Kinas asks Herdr through its CLI (`crate::herdr`) with a fixed argv and sends it no
//! shell string at all. Nothing is typed into the Kinas terminal: its folder is fixed when the PTY spawns, restarting
//! it would drop Herdr's client, and a typed `cd` would reach Claude Code or Pi as a prompt.
//!
//! A Herdr workspace carries a label and no folder, so the label is the only key to find one by. It is therefore the
//! folder's display path — `kinas`, `kinas/docs`, `~/notes` — and not its bare name: two folders called `docs` must
//! not share a workspace. Herdr 0.9.0's shapes and flags were measured on 2026-09-21 in a throwaway session: flags
//! take their value as the next argument only (`--label=x` is an unknown option), a label with `/`, `~`, spaces and
//! 79 characters comes back as sent, and a workspace made with no label is named after its folder — so one Miguel
//! made by hand in `kinas` is found too, which is what he would want.

use std::path::Path;

use serde::Serialize;
use tauri::Manager;

use crate::herdr::{find_herdr, herdr_args, run, session, NOT_INSTALLED, NOT_RUNNING, OPENING};

const MAX_LABEL_CHARS: usize = 80;

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Opened {
    Created,
    Focused,
}

impl Opened {
    pub fn word(self) -> &'static str {
        match self {
            Opened::Created => "created",
            Opened::Focused => "focused",
        }
    }
}

/// The workspace label for a folder: its display path, the projects folder itself by its own name (it displays as
/// `.`), without control characters, and at most 80 characters keeping the **tail** — the tail is what tells two long
/// paths apart.
pub fn label_for(real: &Path, root: &Path, home: &Path) -> String {
    let shown = super::access::display_path(real, root, home);
    let shown = match real.file_name() {
        Some(name) if shown == "." => name.to_string_lossy().into_owned(),
        _ => shown,
    };
    let clean: String = shown.chars().filter(|c| !c.is_control()).collect();
    // `firstmate` is the first mate's own workspace (Firstmate's label, the crew's launcher finds it by it): a client
    // folder of that name gets a label of its own, or Open in the terminal would focus the first mate (build spec §6.17).
    if clean == crate::crew::pin::WORKSPACE_LABEL {
        return format!("{clean}-folder");
    }
    let count = clean.chars().count();
    if count <= MAX_LABEL_CHARS {
        return clean;
    }
    let tail: String = clean.chars().skip(count - (MAX_LABEL_CHARS - 1)).collect();
    format!("…{tail}")
}

/// `herdr api snapshot` → the workspace carrying `label`. Of several, the focused one, else the lowest number.
pub fn workspace_with_label(snapshot_json: &str, label: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(snapshot_json).ok()?;
    let mut matches: Vec<&serde_json::Value> =
        value.pointer("/result/snapshot/workspaces")?.as_array()?.iter().filter(|w| w.get("label").and_then(|l| l.as_str()) == Some(label)).collect();
    matches.sort_by_key(|w| {
        let focused = w.get("focused").and_then(|f| f.as_bool()) == Some(true);
        (!focused, w.get("number").and_then(|n| n.as_u64()).unwrap_or(u64::MAX))
    });
    matches.first()?.get("workspace_id")?.as_str().map(str::to_string)
}

/// One of Herdr's workspaces, as the palette lists it (interface polish, rule 13 Workspaces): its id, its label, whether it
/// holds the focus, and the folder of its first pane that reports one.
#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
pub struct HerdrWorkspace {
    pub id: String,
    pub label: String,
    pub focused: bool,
    pub cwd: Option<String>,
}

/// What the palette says when there is no Herdr to list: a plain-shell pane, no binary, or no answer.
pub const NO_HERDR: &str = "Herdr is not running";

/// The view's workspaces in Herdr's own order (its numbers).
pub(crate) fn workspaces_of(view: &crate::herdr::View) -> Vec<HerdrWorkspace> {
    let mut list: Vec<&crate::herdr::Workspace> = view.workspaces.iter().collect();
    list.sort_by_key(|w| w.number);
    list.into_iter()
        .map(|w| HerdrWorkspace {
            id: w.id.clone(),
            label: w.label.clone(),
            focused: w.focused,
            cwd: view.panes.iter().filter(|p| p.workspace_id == w.id).find_map(|p| p.cwd.clone()),
        })
        .collect()
}

/// The workspaces of the session the Work pane attaches, from the crew's live view of Herdr (asked again only when that
/// view is older than the chrome's 5 s). Lists; changes nothing.
#[tauri::command]
pub async fn herdr_workspaces(app: tauri::AppHandle) -> Result<Vec<HerdrWorkspace>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::readers::crew::live_view(&app, crate::readers::crew::HERDR_FRESH_MS).map(|v| workspaces_of(&v)).ok_or_else(|| NO_HERDR.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Focuses a workspace by its id, as Open in the terminal focuses one; the Work page then shows it. Nothing is typed.
#[tauri::command]
pub async fn herdr_focus_workspace(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // With the agents on a VPS, its Herdr, through the companion.
        if crate::crew::on_vps::vps(&app).is_some() {
            crate::crew::on_vps::focus(&app, &id).map_err(|e| e.message)?;
            app.state::<crate::readers::runtime::ReaderControl>().crew_herdr();
            return Ok(());
        }
        if crate::readers::crew::attached_session().is_none() {
            return Err(NO_HERDR.to_string());
        }
        let _one_at_a_time = OPENING.lock().unwrap_or_else(|p| p.into_inner());
        let herdr = find_herdr().ok_or_else(|| NOT_INSTALLED.to_string())?;
        crate::herdr::workspace_focus(&herdr, &id)?;
        // The crew's thread reads the new focus for the chrome.
        app.state::<crate::readers::runtime::ReaderControl>().crew_herdr();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `dir` has already been checked by the caller (R9) and is a folder.
pub fn open_folder(dir: &Path, label: &str) -> Result<Opened, String> {
    let _one_at_a_time = OPENING.lock().unwrap_or_else(|p| p.into_inner());
    let herdr = find_herdr().ok_or_else(|| NOT_INSTALLED.to_string())?;
    let session = session();
    let session = session.as_deref();
    let snapshot = run(&herdr, &herdr_args(session, &["api", "snapshot"])).map_err(|_| NOT_RUNNING.to_string())?;
    if let Some(id) = workspace_with_label(&snapshot, label) {
        run(&herdr, &herdr_args(session, &["workspace", "focus", &id]))?;
        return Ok(Opened::Focused);
    }
    let dir = dir.to_string_lossy();
    run(&herdr, &herdr_args(session, &["workspace", "create", "--cwd", &dir, "--label", label, "--focus"]))?;
    Ok(Opened::Created)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // What Herdr 0.9.0 printed on 2026-09-21 (throwaway session `kinas-ws-probe`), trimmed to what is read.
    const SNAPSHOT: &str = r#"{"id":"cli:api:snapshot","result":{"snapshot":{"focused_workspace_id":"w2","workspaces":[{"active_tab_id":"w1:t1","agent_status":"unknown","focused":false,"label":"sidebar-folders","number":1,"pane_count":1,"tab_count":1,"workspace_id":"w1"},{"active_tab_id":"w2:t1","agent_status":"unknown","focused":true,"label":"probe root/one two","number":2,"pane_count":1,"tab_count":1,"workspace_id":"w2"},{"active_tab_id":"w3:t1","agent_status":"unknown","focused":false,"label":"-x","number":3,"pane_count":1,"tab_count":1,"workspace_id":"w3"},{"active_tab_id":"w4:t1","agent_status":"unknown","focused":false,"label":"plain","number":4,"pane_count":1,"tab_count":1,"workspace_id":"w4"}]}}}"#;

    #[test]
    fn the_palette_lists_every_workspace_in_herdr_s_order_with_its_first_pane_s_folder() {
        use crate::herdr::{Pane, View, Workspace};
        let ws = |id: &str, label: &str, number: u32, focused: bool| Workspace { id: id.into(), label: label.into(), number, focused };
        let pane = |id: &str, w: &str, cwd: Option<&str>| Pane { id: id.into(), workspace_id: w.into(), tab_label: None, focused: false, cwd: cwd.map(str::to_string) };
        let view = View {
            focused_pane: None,
            workspaces: vec![ws("w3", "kinas/docs", 3, false), ws("w1", "firstmate", 1, false), ws("w2", "acme", 2, true)],
            panes: vec![pane("p1", "w1", None), pane("p2", "w1", Some("/h/firstmate")), pane("p3", "w2", Some("/p/acme")), pane("p4", "w3", None)],
        };
        let listed = workspaces_of(&view);
        assert_eq!(listed.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(), ["w1", "w2", "w3"]);
        assert_eq!(listed[0], HerdrWorkspace { id: "w1".into(), label: "firstmate".into(), focused: false, cwd: Some("/h/firstmate".into()) });
        assert!(listed[1].focused);
        assert_eq!(listed[2].cwd, None);
        assert!(workspaces_of(&View::default()).is_empty());
    }

    #[test]
    fn a_workspace_is_found_by_its_whole_label_and_by_nothing_less() {
        assert_eq!(workspace_with_label(SNAPSHOT, "probe root/one two"), Some("w2".into()));
        assert_eq!(workspace_with_label(SNAPSHOT, "-x"), Some("w3".into()));
        assert_eq!(workspace_with_label(SNAPSHOT, "one two"), None);
        assert_eq!(workspace_with_label(SNAPSHOT, "Plain"), None);
        assert_eq!(workspace_with_label(SNAPSHOT, ""), None);
        assert_eq!(workspace_with_label("not json", "plain"), None);
        assert_eq!(workspace_with_label(r#"{"result":{"snapshot":{}}}"#, "plain"), None);
    }

    #[test]
    fn of_several_with_one_label_the_focused_one_wins_and_otherwise_the_lowest_number() {
        let two = r#"{"result":{"snapshot":{"workspaces":[{"focused":false,"label":"docs","number":5,"workspace_id":"w5"},{"focused":false,"label":"docs","number":2,"workspace_id":"w2"},{"focused":true,"label":"docs","number":9,"workspace_id":"w9"}]}}}"#;
        assert_eq!(workspace_with_label(two, "docs"), Some("w9".into()));
        let none_focused = two.replace("\"focused\":true", "\"focused\":false");
        assert_eq!(workspace_with_label(&none_focused, "docs"), Some("w2".into()));
    }

    #[test]
    fn a_label_is_the_display_path_so_two_folders_with_one_name_do_not_share_a_workspace() {
        let root = PathBuf::from("/nowhere/projects");
        let home = PathBuf::from("/nowhere/home");
        assert_eq!(label_for(Path::new("/nowhere/projects/kinas"), &root, &home), "kinas");
        assert_eq!(label_for(Path::new("/nowhere/projects/kinas/docs"), &root, &home), "kinas/docs");
        assert_eq!(label_for(Path::new("/nowhere/projects/other/docs"), &root, &home), "other/docs");
        assert_eq!(label_for(Path::new("/nowhere/home/notes"), &root, &home), "~/notes");
        assert_eq!(label_for(Path::new("/elsewhere/notes"), &root, &home), "/elsewhere/notes");
    }

    #[test]
    fn label_for_firstmate_folder() {
        let root = PathBuf::from("/nowhere/projects");
        let home = PathBuf::from("/nowhere/home");
        assert_eq!(label_for(Path::new("/nowhere/projects/firstmate"), &root, &home), "firstmate-folder");
        assert_eq!(label_for(Path::new("/nowhere/projects/firstmate/docs"), &root, &home), "firstmate/docs");
        assert_eq!(label_for(Path::new("/nowhere/projects/firstmates"), &root, &home), "firstmates");
    }

    #[test]
    fn the_projects_folder_itself_is_labelled_with_its_own_name_not_a_dot() {
        let root = PathBuf::from("/nowhere/projects");
        assert_eq!(label_for(&root, &root, Path::new("/nowhere/home")), "projects");
    }

    #[test]
    fn a_label_has_no_control_characters_and_keeps_the_tail_of_a_long_path() {
        let root = PathBuf::from("/nowhere/projects");
        let home = PathBuf::from("/nowhere/home");
        assert_eq!(label_for(Path::new("/nowhere/projects/a\u{1b}[31mb\nc"), &root, &home), "a[31mbc");

        let long = format!("/nowhere/projects/{}/docs-one", "d".repeat(100));
        let label = label_for(Path::new(&long), &root, &home);
        assert_eq!(label.chars().count(), 80);
        assert!(label.starts_with('…') && label.ends_with("/docs-one"), "{label}");
        let other = label_for(Path::new(&long.replace("docs-one", "docs-two")), &root, &home);
        assert_ne!(label, other);

        let exact = format!("/nowhere/projects/{}", "e".repeat(80));
        assert_eq!(label_for(Path::new(&exact), &root, &home), "e".repeat(80));
    }

    #[test]
    fn what_the_webview_is_told_is_one_lowercase_word() {
        assert_eq!(serde_json::to_string(&Opened::Created).unwrap(), "\"created\"");
        assert_eq!(serde_json::to_string(&Opened::Focused).unwrap(), "\"focused\"");
        assert_eq!(Opened::Focused.word(), "focused");
    }
}
