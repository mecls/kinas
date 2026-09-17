//! Everything that fills the store with readings (PRD R11–R27). Each reader writes its own rows and its
//! `reader_status`; the runtime in `runtime.rs` decides when they run.

pub mod claude_plan;
pub mod convex;
pub mod host;
pub mod logs;
pub mod ollama_cloud;
pub mod poller;
pub mod runtime;
