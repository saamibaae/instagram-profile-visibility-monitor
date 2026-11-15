use std::collections::HashMap;
use chrono::Utc;
use regex::Regex;
use crate::state_machine::{Confidence, Observation, ObservationState};

#[derive(Debug, Clone, Default)]
pub struct PageSnapshot {
    pub url: String,
    pub title: String,
    pub body_text: String,
    pub headings: Vec<String>,
    pub meta: HashMap<String, String>,
}

pub fn normalize_username(raw: &str) -> String {
    let mut s = raw.trim().to_lowercase();
    if s.starts_with('@') {
        s.remove(0);
    }
    s
}

/// Classifies observed page snapshot against the 6-tier conservative heuristics.
pub fn classify_page_snapshot(
    snapshot: &PageSnapshot,
    target_username: &str,
) -> Observation {
    let norm_target = normalize_username(target_username);
    let url = snapshot.url.to_lowercase();
    let title = snapshot.title.trim().to_string();
    let title_lower = title.to_lowercase();
    let body_lower = snapshot.body_text.to_lowercase();
    let headings_lower: Vec<String> = snapshot.headings.iter().map(|h| h.to_lowercase()).collect();
    let now = Utc::now();

    // 1. Check for Login Walls, Checkpoints, and Challenges -> UNKNOWN (HIGH confidence)
    if url.contains("/accounts/login")
        || url.contains("/challenge/")
        || url.contains("/two_factor")
        || title_lower.starts_with("login")
        || title_lower.starts_with("log in")
        || body_lower.contains("log in to instagram")
        || body_lower.contains("enter the code we sent")
        || body_lower.contains("confirm your phone number")
        || body_lower.contains("checkpoint_required")
    {
        return Observation {
            state: ObservationState::UNKNOWN,
            confidence: Confidence::HIGH,
            observed_at: now,
            target_username: norm_target,
            reason: "Authentication wall or security challenge encountered".to_string(),
            source: "rust-classifier".to_string(),
        };
    }

    // 2. Check for Rate Limiting or Temporary Blocks -> UNKNOWN (HIGH confidence)
    if body_lower.contains("please wait a few minutes before trying again")
        || body_lower.contains("action blocked")
        || body_lower.contains("too many requests")
    {
        return Observation {
            state: ObservationState::UNKNOWN,
            confidence: Confidence::HIGH,
            observed_at: now,
            target_username: norm_target,
            reason: "Instagram rate limit or temporary action throttle detected".to_string(),
            source: "rust-classifier".to_string(),
        };
    }

    // 3. Check for Canonical Page Not Found / Unavailable -> UNAVAILABLE (HIGH confidence)
    let is_not_found_title = title.contains("Page Not Found") || title.contains("Page not found");
    let has_unavailable_heading = headings_lower.iter().any(|h| {
        h.contains("sorry, this page isn't available")
            || h.contains("sorry, this page is not available")
            || h.contains("page not found")
    });
    let has_unavailable_body = body_lower.contains("sorry, this page isn't available.")
        || body_lower.contains("the link you followed may be broken, or the page may have been removed.")
        || body_lower.contains("page not found");

    if is_not_found_title || has_unavailable_heading || has_unavailable_body {
        return Observation {
            state: ObservationState::UNAVAILABLE,
            confidence: Confidence::HIGH,
            observed_at: now,
            target_username: norm_target,
            reason: "Recognized canonical page-unavailable notice".to_string(),
            source: "rust-classifier".to_string(),
        };
    }

    // 4. Check for Target Profile Presence -> VISIBLE (HIGH confidence)
    let title_contains_handle = title != "Instagram"
        && (title_lower.contains(&format!("@{}", norm_target)) || title_lower.contains(&norm_target));
    let og_title = snapshot.meta.get("og:title").map(|s| s.to_lowercase()).unwrap_or_default();
    let og_url = snapshot.meta.get("og:url").map(|s| s.to_lowercase()).unwrap_or_default();
    let meta_matches = og_title.contains(&norm_target) || og_url.contains(&norm_target);
    let headings_contain_handle = headings_lower.iter().any(|h| h.contains(&norm_target));
    let has_private_notice = body_lower.contains("this account is private");

    let mut visible_score = 0;
    if title_contains_handle { visible_score += 2; }
    if meta_matches { visible_score += 2; }
    if headings_contain_handle { visible_score += 2; }
    if has_private_notice && (title_contains_handle || headings_contain_handle || meta_matches) {
        visible_score += 2;
    }

    if visible_score >= 2 {
        let reason = if has_private_notice {
            "Verified target profile structure (Private Account)"
        } else {
            "Verified target profile header and handle"
        };
        return Observation {
            state: ObservationState::VISIBLE,
            confidence: Confidence::HIGH,
            observed_at: now,
            target_username: norm_target,
            reason: reason.to_string(),
            source: "rust-classifier".to_string(),
        };
    }

    // 5. If page is blank, skeleton loader, or unhydrated -> UNKNOWN (LOW confidence)
    if body_lower.is_empty() || body_lower.len() < 50 || title.is_empty() || title == "Instagram" {
        return Observation {
            state: ObservationState::UNKNOWN,
            confidence: Confidence::LOW,
            observed_at: now,
            target_username: norm_target,
            reason: "Page not fully loaded or unhydrated skeleton DOM".to_string(),
            source: "rust-classifier".to_string(),
        };
    }

    // 6. Ambiguous / Unrecognized page structure -> UNKNOWN (LOW confidence)
    Observation {
        state: ObservationState::UNKNOWN,
        confidence: Confidence::LOW,
        observed_at: now,
        target_username: norm_target,
        reason: "Unrecognized page structure or ambiguous response".to_string(),
        source: "rust-classifier".to_string(),
    }
}

/// Simple, zero-dependency HTML snapshot extractor using regex
pub fn extract_snapshot_from_html(html: &str, url: &str) -> PageSnapshot {
    let mut snapshot = PageSnapshot {
        url: url.to_string(),
        ..Default::default()
    };

    // Extract title
    let title_re = Regex::new(r"(?i)<title[^>]*>([^<]*)</title>").unwrap();
    if let Some(caps) = title_re.captures(html) {
        snapshot.title = caps[1].trim().to_string();
    }

    // Extract headings: h1, h2, h3
    let heading_re = Regex::new(r"(?i)<h[1-3][^>]*>(.*?)</h[1-3]>").unwrap();
    let strip_tags_re = Regex::new(r"<[^>]+>").unwrap();
    for cap in heading_re.captures_iter(html) {
        let text = strip_tags_re.replace_all(&cap[1], " ").trim().to_string();
        if !text.is_empty() {
            snapshot.headings.push(text);
        }
    }

    // Extract meta tags: og:title, og:url, og:description
    let meta_re1 = Regex::new(r#"(?i)<meta[^>]*property=["']([^"']*)["'][^>]*content=["']([^"']*)["']"#).unwrap();
    for cap in meta_re1.captures_iter(html) {
        snapshot.meta.insert(cap[1].to_lowercase(), cap[2].to_string());
    }
    let meta_re2 = Regex::new(r#"(?i)<meta[^>]*content=["']([^"']*)["'][^>]*property=["']([^"']*)["']"#).unwrap();
    for cap in meta_re2.captures_iter(html) {
        snapshot.meta.insert(cap[2].to_lowercase(), cap[1].to_string());
    }

    // Extract body text (strip tags and limit to 10k chars)
    let body_re = Regex::new(r"(?is)<body[^>]*>(.*?)</body>").unwrap();
    let raw_body = if let Some(cap) = body_re.captures(html) {
        cap[1].to_string()
    } else {
        html.to_string()
    };
    let cleaned_body = strip_tags_re.replace_all(&raw_body, " ");
    let normalized_spaces = Regex::new(r"\s+").unwrap().replace_all(&cleaned_body, " ");
    let max_len = 10000.min(normalized_spaces.len());
    snapshot.body_text = normalized_spaces[..max_len].trim().to_string();

    snapshot
}
