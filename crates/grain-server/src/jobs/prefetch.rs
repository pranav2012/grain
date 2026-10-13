use crate::state::Shared;

/// How many of the newest review requests to keep ready.
const PREFETCH: usize = 5;

/// Prepares the newest review requests so they open instantly. Git and grouping only, never AI;
/// repos the reviewer hasn't set up yet are skipped unless their clone is found (Grain would
/// have to ask first).
pub(crate) fn run(app: &Shared) {
    let settings = app.settings();
    if !settings.prefetch {
        return;
    }
    let Ok(requests) = grain_github::review_requests() else { return };
    for p in requests.iter().filter(|p| !p.is_draft).take(PREFETCH) {
        let Some(pr) = grain_github::PrRef::parse(&format!("{}#{}", p.repo, p.number)) else { continue };
        let known = grain_git::is_repo(&app.home.clone_dir(&pr))
            || crate::local_repos::resolve(&app.home, &settings, &pr.owner, &pr.repo).is_some();
        if known && !app.is_busy(&pr) {
            app.open(pr, false, false);
        }
    }
}
