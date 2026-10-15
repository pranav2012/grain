// Lints PR files with the reviewer's own ESLint and config file (from their clone).
// Usage: node eslint-runner.cjs <clone> <worktree> <config file> <files...>
const path = require('path')
const [clone, worktree, config, ...files] = process.argv.slice(2)
const { ESLint } = require(require.resolve('eslint', { paths: [clone] }))

;(async () => {
  const eslint = new ESLint({
    cwd: worktree,
    overrideConfigFile: config,
    // Type-aware rules read the PR's own tsconfig, not the clone's.
    overrideConfig: { languageOptions: { parserOptions: { tsconfigRootDir: worktree } } },
    errorOnUnmatchedPattern: false,
  })
  const kept = []
  for (const f of files) if (!(await eslint.isPathIgnored(path.join(worktree, f)))) kept.push(f)
  const results = kept.length ? await eslint.lintFiles(kept) : []
  const out = []
  for (const r of results) {
    const file = path.relative(worktree, r.filePath).split(path.sep).join('/')
    for (const m of r.messages) {
      const meta = m.ruleId && eslint.getRulesMetaForResults([r])[m.ruleId]
      out.push({
        file,
        line: m.line ?? 1,
        endLine: m.endLine ?? m.line ?? 1,
        column: m.column ?? 1,
        length: m.endLine === m.line && m.endColumn ? m.endColumn - m.column : null,
        severity: m.severity === 2 ? 'error' : 'warning',
        message: m.message,
        source: 'ESLint',
        code: m.ruleId ?? null,
        url: meta?.docs?.url ?? null,
      })
    }
  }
  process.stdout.write(JSON.stringify(out))
})().catch((e) => {
  process.stderr.write(String(e && e.message ? e.message : e))
  process.exit(1)
})
