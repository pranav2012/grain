//! A ledger of AI requests (`~/.grain/usage.jsonl`, one line each), for showing spend and capping it per day.

use std::io::Write as _;
use std::time::{SystemTime, UNIX_EPOCH};

use grain_agent::{Agent, Usage};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Home;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    /// Unix seconds.
    pub at: u64,
    /// Local calendar day, `YYYY-MM-DD`.
    pub day: String,
    /// Review id (`owner/repo/123`).
    pub pr: String,
    /// `summary`, `chapter`, `ask` or `review`.
    pub kind: String,
    pub agent: Agent,
    pub usage: Usage,
}

/// Spend so far, for the UI.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Spend {
    pub today: f64,
    pub month: f64,
    /// For the PR asked about, all time.
    pub this_pr: f64,
    /// Daily cap from settings; 0 means none.
    pub daily_budget: f64,
    /// True when any of today's costs are estimates.
    pub estimated: bool,
}

/// Seconds east of UTC for this machine's time zone (from `date +%z`); 0 when unknown.
fn utc_offset() -> i64 {
    static OFFSET: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
    *OFFSET.get_or_init(|| {
        let out = std::process::Command::new("date").arg("+%z").output().ok();
        let z = out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        let (sign, digits) = match z.split_at_checked(1) {
            Some(("-", d)) => (-1, d),
            Some(("+", d)) => (1, d),
            _ => return 0,
        };
        let h: i64 = digits.get(..2).and_then(|x| x.parse().ok()).unwrap_or(0);
        let m: i64 = digits.get(2..4).and_then(|x| x.parse().ok()).unwrap_or(0);
        sign * (h * 3600 + m * 60)
    })
}

/// `YYYY-MM-DD` for Unix seconds in local time (civil-from-days, no date library needed).
pub fn local_day(unix: u64) -> String {
    let days = (unix.cast_signed() + utc_offset()).div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// A dollar amount as the UI shows it: cents, whole dollars from $10, `<$0.01` for tiny amounts.
fn usd(n: f64) -> String {
    if n > 0.0 && n < 0.01 {
        "<$0.01".into()
    } else if n >= 10.0 {
        format!("${n:.0}")
    } else {
        format!("${n:.2}")
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

impl Home {
    fn usage_path(&self) -> std::path::PathBuf {
        self.root.join("usage.jsonl")
    }

    /// Appends one AI request to the ledger.
    pub fn record_usage(&self, pr: &str, kind: &str, agent: Agent, usage: &Usage) {
        let at = now();
        let record = UsageRecord {
            at,
            day: local_day(at),
            pr: pr.to_string(),
            kind: kind.to_string(),
            agent,
            usage: usage.clone(),
        };
        let Ok(line) = serde_json::to_string(&record) else { return };
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(self.usage_path()) {
            let _ = writeln!(f, "{line}");
        }
    }

    pub fn usage_records(&self) -> Vec<UsageRecord> {
        std::fs::read_to_string(self.usage_path())
            .unwrap_or_default()
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect()
    }

    /// Today's, this month's and one PR's spend, with the daily cap.
    pub fn spend(&self, pr: Option<&str>) -> Spend {
        let today = local_day(now());
        let month = &today[..7];
        let mut s = Spend { daily_budget: self.load_settings().daily_budget_usd, ..Spend::default() };
        for r in self.usage_records() {
            let cost = r.usage.cost_usd;
            if r.day == today {
                s.today += cost;
                s.estimated |= r.usage.estimated;
            }
            if r.day.starts_with(month) {
                s.month += cost;
            }
            if Some(r.pr.as_str()) == pr {
                s.this_pr += cost;
            }
        }
        s
    }

    /// Why no new AI request may start today, if the daily cap is reached.
    pub fn over_budget(&self) -> Option<String> {
        let s = self.spend(None);
        (s.daily_budget > 0.0 && s.today >= s.daily_budget).then(|| {
            format!(
                "Today's AI budget is used up (about {} of {}). AI pauses until tomorrow; raise the budget in Settings to continue.",
                usd(s.today),
                usd(s.daily_budget)
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn days_from_unix_seconds() {
        let d = local_day(1_789_000_000);
        assert_eq!(d.len(), 10);
        assert!(d.starts_with("2026-"));
    }
}
