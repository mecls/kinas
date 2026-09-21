//! The terminal pane's PTY (PRD R28, R32–R34).
//!
//! Output leaves this module as raw bytes and is never decoded here: decoding per read chunk
//! corrupts multi-byte characters split across reads, which is how box-drawing TUIs turn to garbage.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::ffi::{CStr, OsString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long the child gets between SIGHUP and SIGKILL when Kinas quits (R28).
pub const QUIT_GRACE: Duration = Duration::from_secs(2);

/// What the pane runs.
#[derive(Debug, Clone, PartialEq)]
pub struct Profile {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub set_env: Vec<(String, String)>,
}

impl Profile {
    /// `<shell> -l -i -c '<first>; exec <shell> -l -i'`, or just a login shell when `first` is None.
    /// Login + interactive because an app started by launchd inherits PATH /usr/bin:/bin:/usr/sbin:/sbin,
    /// while `herdr` (~/.local/bin) and `pi` (nvm) are added by the shell's startup files (R32).
    pub fn login_shell_then(shell: &str, first: Option<&str>, cwd: PathBuf, lang: String) -> Profile {
        let again = format!("exec {} -l -i", sh_quote(shell));
        let script = match first {
            Some(cmd) => format!("{cmd}; {again}"),
            None => again,
        };
        Profile {
            program: shell.to_string(),
            args: vec!["-l".into(), "-i".into(), "-c".into(), script],
            cwd,
            set_env: vec![
                ("TERM".into(), "xterm-256color".into()),
                ("COLORTERM".into(), "truecolor".into()),
                ("TERM_PROGRAM".into(), "kinas".into()),
                ("LANG".into(), lang),
            ],
        }
    }
}

/// The profile Kinas starts at launch. `light` is the ground the window is drawing on right now, for the launch
/// screen's logo (`launch_then_herdr`).
pub fn default_profile(light: bool) -> Profile {
    let home = home_dir();
    let projects = home.join("Documents/Projects/SintraLabs/apps");
    let cwd = if projects.is_dir() { projects } else { home };
    #[cfg_attr(not(debug_assertions), allow(unused_mut))]
    let mut profile = Profile::login_shell_then(&login_shell(), first_command(light).as_deref(), cwd, locale_lang());
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("KINAS_E2E_HERDR_CONFIG_PATH") {
        // Applied after the HERDR* strip, so the e2e session can carry a ⌃Tab binding.
        profile.set_env.push(("HERDR_CONFIG_PATH".into(), path.to_string_lossy().into_owned()));
    }
    profile
}

/// The pane opens on the Kinas launch screen, then `herdr` attaches the persistent `default` session (keymap.md).
/// Debug builds accept two test switches, which skip the launch screen: `KINAS_PANE_SHELL_ONLY` (no Herdr) and
/// `KINAS_HERDR_SESSION=<name>` (a throwaway session, so automated input never reaches `default` — build spec
/// invariant 20).
fn first_command(light: bool) -> Option<String> {
    #[cfg(debug_assertions)]
    {
        if std::env::var("KINAS_PANE_SHELL_ONLY").as_deref() == Ok("1") {
            return None;
        }
        if let Ok(name) = std::env::var("KINAS_HERDR_SESSION") {
            if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Some(format!("herdr session attach {name}"));
            }
        }
    }
    let cli = std::env::current_exe().ok().and_then(|exe| crate::cli_link::bundled_cli(&exe));
    Some(launch_then_herdr(cli.as_deref(), light))
}

/// The launch screen's exit code when q or Ctrl+C asks to stay in the shell (cli/src/main.ts).
const STAY_IN_SHELL: u8 = 10;

/// `KINAS_ENTER=herdr COLORFGBG='15;0' '<cli>'; [ $? -eq 10 ] || herdr`: the launch screen, then Herdr unless it was
/// asked to stay in the shell. The bundled CLI is run by path, because the pane can start before
/// `~/.local/bin/kinas` is linked. A launch screen that fails for any other reason still attaches Herdr, and outside
/// a bundle (development) there is no CLI to run, so the pane attaches Herdr directly, as before.
///
/// `COLORFGBG` ("fg;bg": `0;15` is a light ground) tells the launch screen which disc to draw its logo on
/// (packages/commands/src/theme.ts); its text reads on either. It rides on the CLI's own command line and is never
/// in the profile's environment: `herdr` here can start the server, which outlives the app, and a ground it
/// inherited would go stale in every pane.
pub fn launch_then_herdr(cli: Option<&Path>, light: bool) -> String {
    let ground = if light { "0;15" } else { "15;0" };
    match cli {
        Some(path) => format!("KINAS_ENTER=herdr COLORFGBG='{ground}' {}; [ $? -eq {STAY_IN_SHELL} ] || herdr", sh_quote(&path.to_string_lossy())),
        None => "herdr".into(),
    }
}

/// Every variable whose name contains HERDR. Inherited from a Herdr pane (how Kinas is developed),
/// they make `herdr` refuse with "nested herdr is disabled by default" (task 1.5).
pub fn herdr_vars<I: IntoIterator<Item = (OsString, OsString)>>(vars: I) -> Vec<OsString> {
    vars.into_iter()
        .map(|(k, _)| k)
        .filter(|k| k.to_string_lossy().to_ascii_uppercase().contains("HERDR"))
        .collect()
}

fn login_shell() -> String {
    // SAFETY: getpwuid returns a pointer into static storage or null; it is read immediately.
    let from_passwd = unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if pw.is_null() || (*pw).pw_shell.is_null() {
            None
        } else {
            CStr::from_ptr((*pw).pw_shell).to_str().ok().map(str::to_string)
        }
    };
    from_passwd
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("SHELL").ok())
        .unwrap_or_else(|| "/bin/zsh".into())
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// LANG from the environment when it names a UTF-8 locale, else from the macOS locale when such a
/// locale exists, else en_US.UTF-8 (R32).
fn locale_lang() -> String {
    if let Ok(lang) = std::env::var("LANG") {
        if lang.to_ascii_uppercase().contains("UTF-8") {
            return lang;
        }
    }
    let apple = std::process::Command::new("/usr/bin/defaults")
        .args(["read", "-g", "AppleLocale"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().split('@').next().unwrap_or("").to_string())
        .unwrap_or_default();
    let candidate = format!("{apple}.UTF-8");
    if !apple.is_empty() && std::path::Path::new("/usr/share/locale").join(&candidate).is_dir() {
        candidate
    } else {
        "en_US.UTF-8".into()
    }
}

pub(crate) fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

/// One running child in a PTY.
pub struct Session {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    pid: Option<u32>,
}

impl Session {
    /// Spawns `profile`. `on_data` receives raw output bytes; `on_exit` runs once, with the exit
    /// code, after the child has exited and all output has been delivered.
    pub fn spawn<D, E>(profile: &Profile, cols: u16, rows: u16, on_data: D, on_exit: E) -> Result<Session, String>
    where
        D: Fn(Vec<u8>) + Send + 'static,
        E: FnOnce(Option<u32>) + Send + 'static,
    {
        let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(&profile.program);
        cmd.args(&profile.args);
        cmd.cwd(&profile.cwd);
        for key in herdr_vars(std::env::vars_os()) {
            cmd.env_remove(key);
        }
        // The ground of whatever terminal started Kinas is not the pane's, and Herdr's server would keep it.
        cmd.env_remove("COLORFGBG");
        for (key, value) in &profile.set_env {
            cmd.env(key, value);
        }
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("could not start {}: {e}", profile.program))?;
        drop(pair.slave);
        let pid = child.process_id();
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        std::thread::Builder::new()
            .name("kinas-pty-reader".into())
            .spawn(move || {
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => on_data(buf[..n].to_vec()),
                        Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    }
                }
                let code = child.wait().ok().map(|status| status.exit_code());
                on_exit(code);
            })
            .map_err(|e| e.to_string())?;

        Ok(Session { writer: Mutex::new(writer), master: Mutex::new(pair.master), pid })
    }

    pub fn write(&self, bytes: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock().unwrap_or_else(|p| p.into_inner());
        writer.write_all(bytes).and_then(|_| writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .resize(size(cols, rows))
            .map_err(|e| e.to_string())
    }

    pub fn pid(&self) -> Option<u32> {
        self.pid
    }
}

/// SIGHUP to the child's process group, then SIGKILL once `grace` has passed with it still alive.
pub fn terminate(pid: u32, grace: Duration) {
    let Ok(pid) = i32::try_from(pid) else { return };
    // SAFETY: plain signal delivery; a negative pid addresses the process group the PTY child leads.
    unsafe { libc::kill(-pid, libc::SIGHUP) };
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        // SAFETY: signal 0 only checks whether the process still exists.
        if unsafe { libc::kill(pid, 0) } != 0 {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    // SAFETY: as above.
    unsafe { libc::kill(-pid, libc::SIGKILL) };
}

/// The pane's current session, shared with the Tauri commands and the quit handler.
#[derive(Default, Clone)]
pub struct PtyState {
    inner: Arc<Mutex<Current>>,
}

#[derive(Default)]
struct Current {
    session: Option<Arc<Session>>,
    generation: u64,
}

impl PtyState {
    /// Starts a new session, replacing (and terminating) any previous one, e.g. after a webview reload.
    pub fn start<D, E>(&self, profile: &Profile, cols: u16, rows: u16, on_data: D, on_exit: E) -> Result<Option<u32>, String>
    where
        D: Fn(Vec<u8>) + Send + 'static,
        E: FnOnce(Option<u32>) + Send + 'static,
    {
        let (previous, generation) = {
            let mut current = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            current.generation += 1;
            (current.session.take(), current.generation)
        };
        if let Some(pid) = previous.and_then(|s| s.pid()) {
            std::thread::spawn(move || terminate(pid, QUIT_GRACE));
        }
        let inner = Arc::clone(&self.inner);
        let session = Session::spawn(profile, cols, rows, on_data, move |code| {
            let mut current = inner.lock().unwrap_or_else(|p| p.into_inner());
            if current.generation == generation {
                current.session = None;
            }
            drop(current);
            on_exit(code);
        })?;
        let pid = session.pid();
        self.inner.lock().unwrap_or_else(|p| p.into_inner()).session = Some(Arc::new(session));
        Ok(pid)
    }

    pub fn session(&self) -> Result<Arc<Session>, String> {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .session
            .clone()
            .ok_or_else(|| "the terminal is not running".to_string())
    }

    /// Called when Kinas quits.
    pub fn shutdown(&self) {
        let session = self.inner.lock().unwrap_or_else(|p| p.into_inner()).session.take();
        if let Some(pid) = session.and_then(|s| s.pid()) {
            terminate(pid, QUIT_GRACE);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn sh(script: &str) -> Profile {
        Profile {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
            cwd: std::env::temp_dir(),
            set_env: Profile::login_shell_then("/bin/sh", None, PathBuf::new(), "en_US.UTF-8".into()).set_env,
        }
    }

    /// Runs a profile to completion and returns (all output, exit code).
    fn run(profile: &Profile, cols: u16, rows: u16) -> (Vec<u8>, Option<u32>) {
        let (data_tx, data_rx) = mpsc::channel();
        let (exit_tx, exit_rx) = mpsc::channel();
        let _session = Session::spawn(profile, cols, rows, move |b| data_tx.send(b).unwrap(), move |c| exit_tx.send(c).unwrap()).unwrap();
        let code = exit_rx.recv_timeout(Duration::from_secs(10)).expect("child did not exit");
        (data_rx.try_iter().flatten().collect(), code)
    }

    #[test]
    fn profile_runs_herdr_then_a_login_shell() {
        let p = Profile::login_shell_then("/bin/zsh", Some("herdr"), PathBuf::from("/x"), "pt_PT.UTF-8".into());
        assert_eq!(p.program, "/bin/zsh");
        assert_eq!(p.args, vec!["-l", "-i", "-c", "herdr; exec '/bin/zsh' -l -i"]);
        assert!(p.set_env.contains(&("TERM".into(), "xterm-256color".into())));
        assert!(p.set_env.contains(&("COLORTERM".into(), "truecolor".into())));
        assert!(p.set_env.contains(&("TERM_PROGRAM".into(), "kinas".into())));
        assert!(p.set_env.contains(&("LANG".into(), "pt_PT.UTF-8".into())));
    }

    #[test]
    fn the_pane_opens_on_the_launch_screen_then_herdr() {
        let cli = Path::new("/Applications/Kinas.app/Contents/MacOS/kinas-cli");
        // The ground rides on the launch screen's own command line, like KINAS_ENTER: "fg;bg", 15 being white.
        assert_eq!(launch_then_herdr(Some(cli), false), "KINAS_ENTER=herdr COLORFGBG='15;0' '/Applications/Kinas.app/Contents/MacOS/kinas-cli'; [ $? -eq 10 ] || herdr");
        assert_eq!(launch_then_herdr(Some(cli), true), "KINAS_ENTER=herdr COLORFGBG='0;15' '/Applications/Kinas.app/Contents/MacOS/kinas-cli'; [ $? -eq 10 ] || herdr");
        assert_eq!(launch_then_herdr(None, true), "herdr");
    }

    #[test]
    fn the_launch_screen_is_told_the_ground_and_herdr_is_not() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("kinas-pty-ground-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let write_script = |name: &str, body: &str| {
            let path = dir.join(name);
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        };
        // Herdr can start its server from this very call, and the server outlives the app: a ground it inherited
        // would go stale in every pane, where vim reads it. So neither the pane's value nor one Kinas was started
        // with (a development build, from a terminal that sets it) may reach it.
        write_script("herdr", r#"printf 'herdr:%s' "${COLORFGBG-unset}""#);
        let cli = write_script("kinas-cli", r#"printf 'screen:%s|' "$COLORFGBG""#);
        std::env::set_var("COLORFGBG", "12;8");
        for (light, expected) in [(true, "screen:0;15|herdr:unset"), (false, "screen:15;0|herdr:unset")] {
            let script = format!("PATH={}:\"$PATH\"; {}", sh_quote(&dir.to_string_lossy()), launch_then_herdr(Some(&cli), light));
            let (out, _) = run(&sh(&script), 80, 24);
            assert_eq!(String::from_utf8(out).unwrap(), expected, "light: {light}");
        }
        std::env::remove_var("COLORFGBG");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn herdr_attaches_after_the_launch_screen_unless_it_asked_to_stay_in_the_shell() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("kinas-pty-launch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let write_script = |name: &str, body: &str| {
            let path = dir.join(name);
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        };
        write_script("herdr", "printf herdr");
        // Enter (0) and a broken launch screen (1) go on to Herdr; q or Ctrl+C (10) stays in the shell.
        for (code, expected) in [(0, "screen:herdr|herdr"), (10, "screen:herdr|"), (1, "screen:herdr|herdr")] {
            let cli = write_script("kinas-cli", &format!("printf 'screen:%s|' \"$KINAS_ENTER\"\nexit {code}"));
            let script = format!("PATH={}:\"$PATH\"; {}", sh_quote(&dir.to_string_lossy()), launch_then_herdr(Some(&cli), false));
            let (out, _) = run(&sh(&script), 80, 24);
            assert_eq!(String::from_utf8(out).unwrap(), expected, "launch screen exit {code}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn shell_only_profile_just_execs_the_login_shell() {
        let p = Profile::login_shell_then("/bin/zsh", None, PathBuf::from("/x"), "en_US.UTF-8".into());
        assert_eq!(p.args[3], "exec '/bin/zsh' -l -i");
    }

    #[test]
    fn herdr_vars_are_found_case_insensitively_and_nothing_else() {
        let vars = [("HERDR_PANE_ID", "w1"), ("herdr_env", "1"), ("PATH", "/bin"), ("MY_HERDR_THING", "x")]
            .map(|(k, v)| (OsString::from(k), OsString::from(v)));
        let found: Vec<String> = herdr_vars(vars).into_iter().map(|k| k.into_string().unwrap()).collect();
        assert_eq!(found, vec!["HERDR_PANE_ID", "herdr_env", "MY_HERDR_THING"]);
    }

    #[test]
    fn child_gets_terminal_env_and_no_herdr_vars() {
        std::env::set_var("HERDR_KINAS_TEST_MARKER", "inherited");
        let (out, code) = run(&sh(r#"printf '%s|%s|%s' "$TERM" "$TERM_PROGRAM" "${HERDR_KINAS_TEST_MARKER-unset}""#), 80, 24);
        std::env::remove_var("HERDR_KINAS_TEST_MARKER");
        assert_eq!(code, Some(0));
        assert_eq!(String::from_utf8(out).unwrap(), "xterm-256color|kinas|unset");
    }

    #[test]
    fn output_is_raw_bytes() {
        // U+250C BOX DRAWINGS LIGHT DOWN AND RIGHT, then an invalid byte on purpose.
        let (out, _) = run(&sh(r"printf '\342\224\214\377'"), 80, 24);
        assert_eq!(out, vec![0xe2, 0x94, 0x8c, 0xff]);
    }

    #[test]
    fn exit_code_is_reported() {
        let (_, code) = run(&sh("exit 3"), 80, 24);
        assert_eq!(code, Some(3));
    }

    #[test]
    fn spawn_size_and_resize_reach_the_child() {
        let (out, _) = run(&sh("stty size"), 120, 40);
        assert_eq!(String::from_utf8_lossy(&out).trim(), "40 120");

        let (data_tx, data_rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel();
        let session = Session::spawn(&sh("sleep 0.5; stty size"), 80, 24, move |b| data_tx.send(b).unwrap(), move |c| exit_tx.send(c).unwrap()).unwrap();
        session.resize(100, 30).unwrap();
        exit_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let out: Vec<u8> = data_rx.try_iter().flatten().collect();
        assert_eq!(String::from_utf8_lossy(&out).trim(), "30 100");
    }

    #[test]
    fn input_reaches_the_child() {
        let (data_tx, data_rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel();
        let session = Session::spawn(&sh("read line; printf 'got:%s' \"$line\""), 80, 24, move |b| data_tx.send(b).unwrap(), move |c| exit_tx.send(c).unwrap()).unwrap();
        session.write(b"hello\r").unwrap();
        exit_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let out = String::from_utf8(data_rx.try_iter().flatten().collect()).unwrap();
        assert!(out.contains("got:hello"), "{out:?}");
    }

    #[test]
    fn terminate_hangs_up_then_the_child_is_gone() {
        let (exit_tx, exit_rx) = mpsc::channel();
        let session = Session::spawn(&sh("sleep 30"), 80, 24, |_| {}, move |c| exit_tx.send(c).unwrap()).unwrap();
        let started = Instant::now();
        terminate(session.pid().unwrap(), QUIT_GRACE);
        exit_rx.recv_timeout(Duration::from_secs(5)).expect("child survived terminate");
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn a_new_start_replaces_the_previous_session() {
        let state = PtyState::default();
        let (exit_tx, exit_rx) = mpsc::channel();
        let first = state.start(&sh("sleep 30"), 80, 24, |_| {}, move |c| exit_tx.send(c).unwrap()).unwrap();
        let second = state.start(&sh("sleep 30"), 80, 24, |_| {}, |_| {}).unwrap();
        assert_ne!(first, second);
        exit_rx.recv_timeout(Duration::from_secs(5)).expect("previous session was not terminated");
        assert_eq!(state.session().unwrap().pid(), second);
        state.shutdown();
        assert!(state.session().is_err());
    }
}
