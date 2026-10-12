//! Path-based classification: file kinds, tests, architectural layers and language families.

#[allow(clippy::case_sensitive_file_extension_comparisons, reason = "the path is lowercased first")]
pub(crate) fn kind_of(path: &str) -> &'static str {
    let p = path.to_lowercase();
    let name = p.rsplit('/').next().unwrap_or(&p);
    if matches!(
        name,
        "package-lock.json"
            | "yarn.lock"
            | "pnpm-lock.yaml"
            | "podfile.lock"
            | "gemfile.lock"
            | "cargo.lock"
            | "bun.lockb"
    ) {
        "lockfile"
    } else if p.contains("/generated/")
        || p.contains("__generated__")
        || name.ends_with(".snap")
        || name.contains(".min.")
    {
        "generated"
    } else if [".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp", ".ttf", ".otf", ".woff", ".woff2", ".mp4", ".json"]
        .iter()
        .any(|e| name.ends_with(e) && !name.ends_with("package.json") && !name.ends_with("tsconfig.json"))
    {
        "asset"
    } else if name.ends_with(".md") || name.ends_with(".mdx") {
        "docs"
    } else if name.ends_with(".yml")
        || name.ends_with(".yaml")
        || name.ends_with(".toml")
        || name.starts_with('.')
        || name.ends_with("package.json")
        || name.ends_with("tsconfig.json")
        || name.ends_with(".gradle")
        || name.ends_with(".plist")
        || name.ends_with(".xml")
    {
        "config"
    } else {
        "code"
    }
}

pub(crate) fn is_test_path(p: &str) -> bool {
    p.contains(".test.")
        || p.contains(".spec.")
        || p.contains("__tests__/")
        || p.contains("/test/")
        || p.contains("/tests/")
}

/// Strips test markers and extension: `a/b/foo.test.tsx` -> `foo`.
pub(crate) fn stem(p: &str) -> String {
    let name = p.rsplit('/').next().unwrap_or(p);
    name.split('.').next().unwrap_or(name).to_string()
}

/// Foundations-first layer from path conventions: 0 types/data/services, 1 hooks/state, 2 components, 3 screens, 4 other.
pub(crate) fn layer_of(path: &str) -> u8 {
    let p = format!("/{}", path.to_lowercase());
    let has = |xs: &[&str]| xs.iter().any(|x| p.contains(x));
    if p.ends_with(".d.ts")
        || has(&[
            "/types/",
            "/models/",
            "/schema",
            "/constants/",
            "/api/",
            "/services/",
            "/store/",
            "/util/",
            "/utils/",
            "/lib/",
            "/migrations/",
            "/db/",
        ])
    {
        0
    } else if has(&["/hooks/", "/context/", "/contexts/", "/providers/", "/state/"])
        || p.rsplit('/').next().is_some_and(|n| n.starts_with("use"))
    {
        1
    } else if has(&["/components/", "/atoms/", "/molecules/", "/ui/", "/widgets/"]) {
        2
    } else if has(&["/screens/", "/pages/", "/app/", "/routes/", "/views/"]) {
        3
    } else {
        4
    }
}

/// Files that can reference each other's symbols share a family.
pub(crate) fn lang_family(path: &str) -> Option<&'static str> {
    let ext = path.rsplit_once('.')?.1;
    Some(match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" | "vue" | "svelte" => "js",
        "py" => "py",
        "go" => "go",
        "rs" => "rs",
        "java" | "kt" | "kts" | "scala" => "jvm",
        "swift" | "m" | "mm" | "h" => "apple",
        "c" | "cc" | "cpp" | "hpp" => "c",
        "rb" => "rb",
        "php" => "php",
        "cs" => "cs",
        "dart" => "dart",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_test_path, kind_of, lang_family, layer_of, stem};

    #[test]
    fn classifies_file_kinds() {
        assert_eq!(kind_of("ios/Podfile.lock"), "lockfile");
        assert_eq!(kind_of("src/__generated__/schema.ts"), "generated");
        assert_eq!(kind_of("src/i18n/messages/de.json"), "asset");
        assert_eq!(kind_of("package.json"), "config");
        assert_eq!(kind_of("docs/README.MD"), "docs");
        assert_eq!(kind_of("src/app/page.tsx"), "code");
    }

    #[test]
    fn detects_tests_and_stems() {
        assert!(is_test_path("src/hooks/__tests__/useThing.test.ts"));
        assert!(!is_test_path("src/hooks/useThing.ts"));
        assert_eq!(stem("src/hooks/__tests__/useThing.test.ts"), "useThing");
    }

    #[test]
    fn orders_layers_foundations_first() {
        assert!(layer_of("src/types/voucher.ts") < layer_of("src/hooks/useVoucher.ts"));
        assert!(layer_of("src/hooks/useVoucher.ts") < layer_of("src/components/Voucher.tsx"));
        assert!(layer_of("src/components/Voucher.tsx") < layer_of("src/screens/VoucherScreen.tsx"));
    }

    #[test]
    fn groups_languages_that_can_reference_each_other() {
        assert_eq!(lang_family("a.tsx"), lang_family("b.mjs"));
        assert_ne!(lang_family("a.ts"), lang_family("b.py"));
        assert_eq!(lang_family("Makefile"), None);
    }
}
