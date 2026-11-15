use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use clap::{Parser, Subcommand};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use instagram_monitor::config::load_config;
use instagram_monitor::scheduler::{run_observation_cycle, run_scheduler_loop};
use instagram_monitor::server::start_web_server;
use instagram_monitor::session::get_session_status;
use instagram_monitor::storage::{
    acquire_rust_daemon_lock, check_rust_daemon_running, load_state, read_recent_events,
};
use instagram_monitor::telegram::test_telegram_connection;

#[derive(Parser)]
#[command(name = "instagram-monitor")]
#[command(about = "Ultra-Low Memory Native Rust Daemon for Instagram Profile Visibility Monitoring", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Run an immediate observation check on the active target profile
    Check,
    /// Start the background observation daemon loop
    Start {
        #[arg(short, long)]
        foreground: bool,
    },
    /// Show current daemon execution state, active target, and metrics
    Status,
    /// Send a test notification to your configured Telegram chat
    #[command(name = "test:telegram")]
    TestTelegram,
    /// Send a test notification (alias)
    TestTelegramAlias,
    /// Launch the embedded Web GUI dashboard on port 3848
    Gui {
        #[arg(short, long, default_value_t = 3848)]
        port: u16,
    },
    /// Display recent observation events
    History {
        #[arg(short, long, default_value_t = 20)]
        limit: usize,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cli = Cli::parse();
    let config = load_config().unwrap_or_default();

    match cli.command.unwrap_or(Commands::Status) {
        Commands::Check => {
            println!("\n==============================================");
            println!("   INSTAGRAM OBSERVATION CHECK (RUST NATIVE)  ");
            println!("==============================================");
            println!("Target Profile:   @{}", config.target_username);
            println!("Target URL:       {}", config.target_url);
            println!("Executing fast check pipeline...\n");

            let (result, duration_ms, source) = run_observation_cycle(&config).await;
            let obs = result.next_state.current_observation;

            println!("----------------------------------------------");
            println!("Observation State:    {}", obs);
            println!("Transition Detected:  {}", if result.is_transition { "YES" } else { "NO" });
            println!("Transition Type:      {}", result.transition_type);
            println!("Execution Engine:     {}", source);
            println!("Latency:              {} ms", duration_ms);
            println!("==============================================\n");
        }

        Commands::Status => {
            let (is_running, pid) = check_rust_daemon_running();
            let state = load_state();
            let (has_session, cookies_count) = get_session_status();

            println!("\n==============================================");
            println!("   INSTAGRAM VISIBILITY MONITOR — RUST STATUS ");
            println!("==============================================");
            println!("Daemon Process:       {}", if is_running { format!("RUNNING (PID: {:?})", pid) } else { "STOPPED".to_string() });
            println!("Target Profile:       @{}", config.target_username);
            println!("Target URL:           {}", config.target_url);
            println!("Schedule Mode:        {}", config.schedule_mode);
            println!("Interval:             {} min (or {}s-{}s)", config.fixed_interval_minutes, config.random_min_seconds, config.random_max_seconds);
            println!("Telegram Alerts:      {}", if config.telegram_notifications_enabled { "ENABLED" } else { "DISABLED" });
            println!("Secondary Session:    {}", if has_session { format!("AUTHENTICATED ({} cookies)", cookies_count) } else { "UNAUTHENTICATED".to_string() });
            println!("----------------------------------------------");
            println!("Current Observation:  {}", state.current_observation);
            println!("Last Reliable State:  {:?}", state.last_reliable_state);
            println!("Consecutive Unknowns: {}", state.consecutive_unknown_count);
            println!("==============================================\n");
        }

        Commands::TestTelegram | Commands::TestTelegramAlias => {
            println!("Dispatching test alert using credentials from config...");
            match test_telegram_connection(&config.telegram_bot_token, &config.telegram_chat_id, &config.target_username).await {
                Ok(_) => {
                    println!("✓ Test notification delivered successfully to Telegram chat!");
                }
                Err(e) => {
                    eprintln!("✗ Telegram delivery failed: {}", e);
                }
            }
        }

        Commands::Start { foreground: _ } => {
            let _lock = match acquire_rust_daemon_lock() {
                Ok(l) => l,
                Err(err) => {
                    eprintln!("✗ Error: {}", err);
                    return Ok(());
                }
            };

            println!("✓ Rust monitor daemon started successfully in background.");
            let shutdown_signal = Arc::new(AtomicBool::new(false));
            let s_sig = shutdown_signal.clone();

            tokio::spawn(async move {
                tokio::signal::ctrl_c().await.expect("Failed to listen for Ctrl+C");
                println!("\nReceived shutdown signal. Gracefully exiting...");
                s_sig.store(true, Ordering::Relaxed);
            });

            run_scheduler_loop(shutdown_signal).await;
        }

        Commands::Gui { port } => {
            start_web_server(port).await;
        }

        Commands::History { limit } => {
            let events = read_recent_events(limit);
            println!("\nRecent Observation Events (Last {}):", events.len());
            for ev in events {
                println!(
                    "[{}] @{} -> {} ({} in {}ms via {})",
                    ev.timestamp, ev.username, ev.observed_state, ev.transition_type, ev.duration_ms, ev.source
                );
            }
            println!();
        }
    }

    Ok(())
}
