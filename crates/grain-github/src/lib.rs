//! GitHub access through the user's own `gh` login. Grain never reads or stores the token.

mod clone;
mod codeowners;
mod gh;
mod pr_ref;
mod pulls;
mod repos;
mod submit;
mod threads;

pub use clone::clone_partial;
pub use codeowners::{CODEOWNERS_PATHS, CodeOwners, is_owner};
pub use pr_ref::{LOCAL_OWNER, PrRef};
pub use pulls::{
    Author, PrDetails, PrSummary, my_open_prs, pr_details, pr_is_open, repo_open_prs, review_requests, viewer,
    viewer_teams,
};
pub use repos::{RepoSummary, repos};
pub use submit::{LineComment, PayloadComment, ReviewEvent, ReviewPayload, submit_review};
pub use threads::{
    Conversation, ReviewThread, SubmittedReview, ThreadComment, conversation, reply_to_thread, set_thread_resolved,
};
