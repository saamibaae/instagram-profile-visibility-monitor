use std::collections::HashMap;
use instagram_monitor::classifier::*;
use instagram_monitor::state_machine::*;

#[test]
fn test_classify_visible_profile() {
    let mut meta = HashMap::new();
    meta.insert("og:title".to_string(), "Instagram (@instagram)".to_string());
    meta.insert("og:url".to_string(), "https://www.instagram.com/instagram/".to_string());

    let snapshot = PageSnapshot {
        url: "https://www.instagram.com/instagram/".to_string(),
        title: "Instagram (@instagram) • Instagram photos and videos".to_string(),
        body_text: "instagram 500M followers 7,000 posts Discover more from instagram".to_string(),
        headings: vec!["instagram".to_string()],
        meta,
    };

    let obs = classify_page_snapshot(&snapshot, "instagram");
    assert_eq!(obs.state, ObservationState::VISIBLE);
    assert_eq!(obs.confidence, Confidence::HIGH);
    assert_eq!(obs.target_username, "instagram");
}

#[test]
fn test_classify_private_profile() {
    let mut meta = HashMap::new();
    meta.insert("og:title".to_string(), "Private User (@targetuser)".to_string());

    let snapshot = PageSnapshot {
        url: "https://www.instagram.com/targetuser/".to_string(),
        title: "Private User (@targetuser) • Instagram".to_string(),
        body_text: "This account is private. Follow to see their photos and videos.".to_string(),
        headings: vec!["targetuser".to_string(), "This account is private".to_string()],
        meta,
    };

    let obs = classify_page_snapshot(&snapshot, "targetuser");
    assert_eq!(obs.state, ObservationState::VISIBLE);
    assert_eq!(obs.confidence, Confidence::HIGH);
    assert!(obs.reason.contains("Private Account"));
}

#[test]
fn test_classify_unavailable_profile() {
    let snapshot = PageSnapshot {
        url: "https://www.instagram.com/instagram/".to_string(),
        title: "Page Not Found • Instagram".to_string(),
        body_text: "Sorry, this page isn't available. The link you followed may be broken, or the page may have been removed.".to_string(),
        headings: vec!["Sorry, this page isn't available.".to_string()],
        meta: HashMap::new(),
    };

    let obs = classify_page_snapshot(&snapshot, "instagram");
    assert_eq!(obs.state, ObservationState::UNAVAILABLE);
    assert_eq!(obs.confidence, Confidence::HIGH);
    assert!(obs.reason.contains("page-unavailable notice"));
}

#[test]
fn test_classify_login_wall() {
    let snapshot = PageSnapshot {
        url: "https://www.instagram.com/accounts/login/".to_string(),
        title: "Login • Instagram".to_string(),
        body_text: "Log in to Instagram to see photos and videos from friends.".to_string(),
        headings: vec!["Login".to_string()],
        meta: HashMap::new(),
    };

    let obs = classify_page_snapshot(&snapshot, "instagram");
    assert_eq!(obs.state, ObservationState::UNKNOWN);
    assert_eq!(obs.confidence, Confidence::HIGH);
    assert!(obs.reason.contains("Authentication wall"));
}

#[test]
fn test_classify_security_challenge() {
    let snapshot = PageSnapshot {
        url: "https://www.instagram.com/challenge/action/".to_string(),
        title: "Instagram".to_string(),
        body_text: "Help us confirm you own this account. Enter the code we sent to your email.".to_string(),
        headings: vec!["Confirm your account".to_string()],
        meta: HashMap::new(),
    };

    let obs = classify_page_snapshot(&snapshot, "instagram");
    assert_eq!(obs.state, ObservationState::UNKNOWN);
    assert_eq!(obs.confidence, Confidence::HIGH);
    assert!(obs.reason.contains("challenge"));
}

#[test]
fn test_classify_rate_limit() {
    let snapshot = PageSnapshot {
        url: "https://www.instagram.com/instagram/".to_string(),
        title: "Instagram".to_string(),
        body_text: "Please wait a few minutes before trying again. Action blocked.".to_string(),
        headings: vec![],
        meta: HashMap::new(),
    };

    let obs = classify_page_snapshot(&snapshot, "instagram");
    assert_eq!(obs.state, ObservationState::UNKNOWN);
    assert_eq!(obs.confidence, Confidence::HIGH);
    assert!(obs.reason.contains("rate limit"));
}

#[test]
fn test_classify_blank_or_skeleton_dom() {
    let snapshot = PageSnapshot {
        url: "https://www.instagram.com/instagram/".to_string(),
        title: "".to_string(),
        body_text: "".to_string(),
        headings: vec![],
        meta: HashMap::new(),
    };

    let obs = classify_page_snapshot(&snapshot, "instagram");
    assert_eq!(obs.state, ObservationState::UNKNOWN);
    assert_eq!(obs.confidence, Confidence::LOW);
    assert!(obs.reason.contains("unhydrated skeleton DOM"));
}
