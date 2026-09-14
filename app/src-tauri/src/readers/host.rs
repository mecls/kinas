//! This Mac's CPU, memory and disk (PRD R27).
//!
//! macOS has several defensible "memory used" and "disk free" numbers; these are the ones Kinas shows,
//! defined once: memory used = total − available; disk = the `/System/Volumes/Data` volume, read two ways:
//! free space from statfs (what `df` reports; purgeable space counts as used), and "available" as Finder
//! shows it — free space plus the purgeable space macOS clears for the user. The Usage page leads with
//! Finder's number, because that is the one Miguel compares against.

use rusqlite::{params, Connection};
use std::ffi::CString;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
const DATA_VOLUME: &str = "/System/Volumes/Data";

#[derive(Debug, Clone, PartialEq)]
pub struct HostReading {
    pub cpu_pct: f64,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub disk_used_gb: f64,
    pub disk_total_gb: f64,
    /// Finder's "available", in GiB; `None` when macOS does not report it.
    pub disk_available_gb: Option<f64>,
}

/// `scutil --get LocalHostName`, falling back to "this-mac" if it fails or takes longer than 2 s.
pub fn machine_name() -> String {
    run_with_timeout("/usr/sbin/scutil", &["--get", "LocalHostName"], Duration::from_secs(2))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "this-mac".into())
}

fn run_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<String> {
    let mut child = Command::new(program).args(args).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                let mut out = String::new();
                std::io::Read::read_to_string(child.stdout.as_mut()?, &mut out).ok()?;
                return Some(out);
            }
            Ok(Some(_)) => return None,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// Keeps the previous CPU sample so every reading covers at least 200 ms.
pub struct HostSampler {
    sys: sysinfo::System,
    last_cpu_refresh: Instant,
}

impl Default for HostSampler {
    fn default() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_cpu_usage();
        HostSampler { sys, last_cpu_refresh: Instant::now() }
    }
}

impl HostSampler {
    pub fn sample(&mut self) -> Result<HostReading, String> {
        let since = self.last_cpu_refresh.elapsed();
        if since < sysinfo::MINIMUM_CPU_UPDATE_INTERVAL {
            std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL - since);
        }
        self.sys.refresh_cpu_usage();
        self.last_cpu_refresh = Instant::now();
        self.sys.refresh_memory();

        let mem_total = self.sys.total_memory() as f64;
        let mem_available = self.sys.available_memory() as f64;
        if mem_total <= 0.0 {
            return Err("sysinfo reported no memory".into());
        }
        let (disk_total, disk_free) = volume_space(DATA_VOLUME)?;
        Ok(HostReading {
            cpu_pct: f64::from(self.sys.global_cpu_usage()).clamp(0.0, 100.0),
            mem_used_gb: (mem_total - mem_available).max(0.0) / GIB,
            mem_total_gb: mem_total / GIB,
            disk_used_gb: (disk_total - disk_free).max(0.0) / GIB,
            disk_total_gb: disk_total / GIB,
            disk_available_gb: available_for_important_usage(DATA_VOLUME).ok().map(|bytes| bytes / GIB),
        })
    }
}

/// (total bytes, bytes available to the user) from statfs, the numbers `df -k` reports.
pub fn volume_space(path: &str) -> Result<(f64, f64), String> {
    let c_path = CString::new(path).map_err(|e| e.to_string())?;
    // SAFETY: statfs fills the zeroed struct for a valid NUL-terminated path.
    let mut stats: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c_path.as_ptr(), &mut stats) } != 0 {
        return Err(format!("statfs {path}: {}", std::io::Error::last_os_error()));
    }
    let block = f64::from(stats.f_bsize);
    Ok((stats.f_blocks as f64 * block, stats.f_bavail as f64 * block))
}

/// Bytes Finder reports as "available" on the volume holding `path`: free space plus the purgeable space
/// macOS will clear for the user (`NSURLVolumeAvailableCapacityForImportantUsageKey`).
pub fn available_for_important_usage(path: &str) -> Result<f64, String> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSNumber, NSString, NSURLVolumeAvailableCapacityForImportantUsageKey, NSURL};

    if !std::path::Path::new(path).exists() {
        return Err(format!("{path}: no such volume"));
    }
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let mut value: Option<Retained<AnyObject>> = None;
    // SAFETY: the key is an immutable Foundation constant; `value` receives an owned object or stays None.
    unsafe { url.getResourceValue_forKey_error(&mut value, NSURLVolumeAvailableCapacityForImportantUsageKey) }
        .map_err(|e| format!("{path}: {}", e.localizedDescription()))?;
    let number = value
        .ok_or_else(|| format!("{path}: no available capacity reported"))?
        .downcast::<NSNumber>()
        .map_err(|_| format!("{path}: available capacity is not a number"))?;
    Ok(number.as_i64() as f64)
}

pub fn write_host(conn: &Connection, org_id: &str, machine: &str, reading: &HostReading, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO hosts (org_id, machine, cpu_pct, mem_used_gb, mem_total_gb, disk_used_gb, disk_total_gb, disk_available_gb, services, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '[]', ?9)
         ON CONFLICT (org_id, machine) DO UPDATE SET
           cpu_pct = excluded.cpu_pct, mem_used_gb = excluded.mem_used_gb, mem_total_gb = excluded.mem_total_gb,
           disk_used_gb = excluded.disk_used_gb, disk_total_gb = excluded.disk_total_gb,
           disk_available_gb = excluded.disk_available_gb, updated_at = excluded.updated_at",
        params![
            org_id,
            machine,
            reading.cpu_pct,
            reading.mem_used_gb,
            reading.mem_total_gb,
            reading.disk_used_gb,
            reading.disk_total_gb,
            reading.disk_available_gb,
            now
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn machine_name_is_not_empty() {
        assert!(!machine_name().is_empty());
    }

    #[test]
    fn samples_are_within_physical_bounds() {
        let mut sampler = HostSampler::default();
        for _ in 0..2 {
            let r = sampler.sample().unwrap();
            assert!((0.0..=100.0).contains(&r.cpu_pct), "{r:?}");
            assert!(r.mem_total_gb > 0.5 && r.mem_used_gb <= r.mem_total_gb, "{r:?}");
            assert!(r.disk_total_gb > 1.0 && r.disk_used_gb <= r.disk_total_gb, "{r:?}");
            assert!(r.disk_available_gb.is_some_and(|a| a > 0.0 && a <= r.disk_total_gb), "{r:?}");
        }
    }

    #[test]
    fn finder_available_counts_purgeable_space_on_top_of_free_space() {
        let (total, free) = volume_space(DATA_VOLUME).unwrap();
        let available = available_for_important_usage(DATA_VOLUME).unwrap();
        // Purgeable space only adds; 1 % of slack covers files written between the two reads.
        assert!(available >= free * 0.99 && available <= total, "free {free} · available {available} · total {total}");
    }

    #[test]
    fn a_second_sample_waits_for_the_cpu_interval() {
        let mut sampler = HostSampler::default();
        let started = Instant::now();
        sampler.sample().unwrap();
        assert!(started.elapsed() >= sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    }

    #[test]
    fn missing_volume_is_an_error() {
        assert!(volume_space("/definitely/not/a/volume").is_err());
        assert!(available_for_important_usage("/definitely/not/a/volume").is_err());
    }

    #[test]
    fn writing_twice_keeps_one_row_per_machine() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let reading = HostReading { cpu_pct: 12.5, mem_used_gb: 7.0, mem_total_gb: 16.0, disk_used_gb: 200.0, disk_total_gb: 460.0, disk_available_gb: Some(280.0) };
        write_host(&store.conn(), store.org_id(), "mac", &reading, 1).unwrap();
        write_host(&store.conn(), store.org_id(), "mac", &HostReading { cpu_pct: 50.0, disk_available_gb: None, ..reading }, 2).unwrap();
        let (count, cpu, available, updated): (i64, f64, Option<f64>, i64) = store
            .conn()
            .query_row("SELECT count(*), max(cpu_pct), max(disk_available_gb), max(updated_at) FROM hosts", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap();
        assert_eq!((count, cpu, available, updated), (1, 50.0, None, 2));
    }
}
