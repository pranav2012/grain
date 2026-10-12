//! Precise "who uses this" answers from outside the engine (e.g. a language server), used in
//! place of the name-based entity graph for the files they support.

use sem_core::model::change::SemanticChange;

/// Answers which files reference a declaration. Implementations return `None` for files they
/// don't support or when they fail, so the engine falls back to its entity graph.
pub trait UsageProvider: Sync {
    /// Repository-relative files referencing the symbol declared at `line`:`character`
    /// (0-based; `character` in UTF-16 code units, as in LSP) in `file`.
    fn referencing_files(&self, file: &str, line: u32, character: u32) -> Option<Vec<String>>;
}

/// Where an entity's name is declared at head, in LSP coordinates: the first line of the
/// entity's text that contains its name as a whole word.
pub(crate) fn name_position(c: &SemanticChange) -> Option<(u32, u32)> {
    let text = c.after_content.as_deref()?;
    let name = c.entity_name.as_str();
    let is_word = |ch: Option<char>| ch.is_some_and(|ch| ch.is_alphanumeric() || ch == '_' || ch == '$');
    for (offset, line) in text.lines().enumerate().take(20) {
        for (at, _) in line.match_indices(name) {
            if !is_word(line[..at].chars().next_back()) && !is_word(line[at + name.len()..].chars().next()) {
                let character = line[..at].encode_utf16().count();
                let line = c.start_line.checked_sub(1)? + offset;
                return Some((u32::try_from(line).ok()?, u32::try_from(character).ok()?));
            }
        }
    }
    None
}
