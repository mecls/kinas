//! Kinas's own secret, the Ollama Cloud API key, in the macOS Keychain (PRD R4).
//!
//! Written through `/usr/bin/security -i`, which reads the whole command — key included — from stdin, so
//! the key is never in argv where `ps` could show it. (`add-generic-password -w` with the key typed at its
//! prompt keeps only the first 128 characters.) Every write is read back before it counts as saved. Items
//! created by `security` stay readable by it without a prompt, so unsigned rebuilds of Kinas do not re-prompt.

use std::io::Write;
use std::process::{Command, Stdio};

pub const SERVICE: &str = "ai.sintralabs.kinas";
pub const OLLAMA_ACCOUNT: &str = "ollama-cloud-api-key";
const SECURITY: &str = "/usr/bin/security";
/// `security` exits 44 when the item does not exist.
const NOT_FOUND: i32 = 44;

/// The app's key store, managed as Tauri state for the Settings commands.
pub struct Keys(pub std::sync::Arc<dyn KeyStore>);

pub trait KeyStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn remove(&self, account: &str) -> Result<(), String>;
}

pub struct MacKeychain;

/// `security -i` splits its command line on whitespace and quotes; API keys never contain either.
fn quotable(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err("the key is empty".into());
    }
    if value.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\\') {
        return Err("the key can't contain spaces, line breaks, quotes or backslashes".into());
    }
    Ok(())
}

impl KeyStore for MacKeychain {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        let out = Command::new(SECURITY)
            .args(["find-generic-password", "-s", SERVICE, "-a", account, "-w"])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("could not run security: {e}"))?;
        match out.status.code() {
            Some(0) => Ok(Some(String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string()).filter(|s| !s.is_empty())),
            Some(NOT_FOUND) => Ok(None),
            code => Err(format!("Keychain read failed (exit {})", code.map_or("signal".into(), |c| c.to_string()))),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        quotable(secret)?;
        quotable(account)?;
        let mut child = Command::new(SECURITY)
            .arg("-i")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not run security: {e}"))?;
        {
            let stdin = child.stdin.as_mut().ok_or("could not open security's stdin")?;
            stdin
                .write_all(format!("add-generic-password -U -s \"{SERVICE}\" -a \"{account}\" -w \"{secret}\"\n").as_bytes())
                .map_err(|e| format!("could not pass the key to security: {e}"))?;
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("Keychain write failed (exit {})", status.code().map_or("signal".into(), |c| c.to_string())));
        }
        match self.get(account)? {
            Some(stored) if stored == secret => Ok(()),
            _ => Err("the Keychain did not keep the key as entered".into()),
        }
    }

    fn remove(&self, account: &str) -> Result<(), String> {
        let status = Command::new(SECURITY)
            .args(["delete-generic-password", "-s", SERVICE, "-a", account])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("could not run security: {e}"))?;
        match status.code() {
            Some(0) | Some(NOT_FOUND) => Ok(()),
            code => Err(format!("Keychain delete failed (exit {})", code.map_or("signal".into(), |c| c.to_string()))),
        }
    }
}

/// For tests and e2e runs (`KINAS_E2E_MEMORY_KEYCHAIN=1`, debug builds only): never touches the Keychain.
#[cfg(any(test, debug_assertions))]
#[derive(Default)]
pub struct MemoryKeyStore(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(any(test, debug_assertions))]
impl KeyStore for MemoryKeyStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(account.into(), secret.into());
        Ok(())
    }
    fn remove(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_ACCOUNT: &str = "kinas-unit-test-account";
    // Its own account: cargo runs tests in parallel, and the round-trip test removes TEST_ACCOUNT.
    const TEST_ACCOUNT_LONG: &str = "kinas-unit-test-account-long";

    #[test]
    fn real_keychain_round_trip_under_a_test_account() {
        let keychain = MacKeychain;
        keychain.remove(TEST_ACCOUNT).unwrap();
        assert_eq!(keychain.get(TEST_ACCOUNT).unwrap(), None);
        keychain.set(TEST_ACCOUNT, "ollama-FAKE-key-1").unwrap();
        assert_eq!(keychain.get(TEST_ACCOUNT).unwrap().as_deref(), Some("ollama-FAKE-key-1"));
        keychain.set(TEST_ACCOUNT, "ollama-FAKE-key-2").unwrap();
        assert_eq!(keychain.get(TEST_ACCOUNT).unwrap().as_deref(), Some("ollama-FAKE-key-2"));
        keychain.remove(TEST_ACCOUNT).unwrap();
        assert_eq!(keychain.get(TEST_ACCOUNT).unwrap(), None);
    }

    #[test]
    fn long_keys_are_stored_whole() {
        // `security add-generic-password -w` reading a prompt from stdin keeps only the first 128 characters.
        let long = format!("ollama-FAKE-{}", "x".repeat(288));
        let keychain = MacKeychain;
        keychain.set(TEST_ACCOUNT_LONG, &long).unwrap();
        assert_eq!(keychain.get(TEST_ACCOUNT_LONG).unwrap().as_deref(), Some(long.as_str()));
        keychain.remove(TEST_ACCOUNT_LONG).unwrap();
    }

    #[test]
    fn keys_security_cannot_quote_are_refused() {
        for bad in ["with space", "with\"quote", "with\\backslash", "tab\there"] {
            assert!(MacKeychain.set(TEST_ACCOUNT, bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn multi_line_keys_are_refused() {
        assert!(MacKeychain.set(TEST_ACCOUNT, "a\nb").is_err());
        assert!(MacKeychain.set(TEST_ACCOUNT, "").is_err());
    }

    #[test]
    fn the_key_never_goes_through_argv() {
        let source = include_str!("keychain.rs");
        // The impl's set(), not the trait's declaration of it.
        let mac = &source[source.find("impl KeyStore for MacKeychain").unwrap()..];
        let set_fn = &mac[mac.find("fn set(&self").unwrap()..mac.find("fn remove(&self").unwrap()];
        let argv: Vec<&str> = set_fn.lines().filter(|l| l.contains(".arg(") || l.contains(".args(")).collect();
        assert_eq!(argv, ["            .arg(\"-i\")"], "security's argv in set()");
    }
}
