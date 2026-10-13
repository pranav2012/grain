# Design system

Grain's UI is dark, dense and keyboard-first. Every component uses the tokens in
`ui/src/styles/index.css` and the primitives in `ui/src/components/ui/`.
`pnpm --dir ui lint` fails on raw hex/rgb colours, pixel font sizes and one-off radii in components.

## Tokens

| Group | Tokens | Use |
| --- | --- | --- |
| Surfaces | `canvas` < `surface` < `raised` | Page, then panels and cards, then hover and selected rows |
| Lines | `line`, `line-strong` | Borders and dividers; `line-strong` for empty map bands |
| Text | `fg` > `fg-muted` > `fg-subtle` > `fg-faint` | Content, secondary prose, labels and meta, hints |
| Strong | `strong`, `fg-on-strong` | The one primary button per view |
| Meaning | `success`, `danger`, `warning`, `accent` | Reviewed, risk or change requested, changed since review or caution, focus and "yours" |
| Overlay | `scrim`, `shadow-overlay`, `shadow-float` | Modal backdrop, dialogs, floating cards |

Colour carries meaning only. Don't use `success`/`danger`/`warning`/`accent` for decoration.

**Type scale** (`text-*`): `2xs` 11px (badges, kbd) · `xs` 11.5px (meta) · `sm` 12px (help text, small controls) ·
`base` 13px (body) · `md` 15px (search inputs) · `lg` 17px (dialog titles) · `xl` 20px (block titles, big numbers).

**Radius**: `rounded-xs` map bands · `rounded-sm` badges, kbd, segments · `rounded-md` buttons, rows ·
`rounded-lg` cards, inputs · `rounded-xl` dialogs.

**Spacing** uses Tailwind's 4px scale (`gap-1.5`, `px-3`, `py-2.5`…), never pixel values.

## Primitives (`components/ui/`)

| Primitive | For |
| --- | --- |
| `Button` (`default`, `primary`, `danger`, `ghost`; sizes `sm`, `md`, `icon`) | Actions |
| `LinkButton` | Quiet inline actions: Delete, Reply, Resolve, Ask |
| `Badge` (tones) | Small states and tags: Draft, yours, layer numbers |
| `Card` (`float`) | Bordered panels: comments, threads, toasts |
| `Input`, `Textarea`, `SearchInput` | Text entry |
| `Choice`, `ChoiceGroup` | Radio options shown as cards (settings, verdicts) |
| `ListOption`, `ListMessage` | Keyboard listboxes (palette, picker) |
| `Dialog`, `DialogTitle`, `DialogActions`, `Scrim` | Modals |
| `Segmented` | Two to four mutually exclusive views |
| `Progress` | Reviewed / needs-changes bar |
| `SectionLabel` | Headings inside panels |
| `Kbd`, `InlineCode` | Shortcuts, code in prose |

Need something new? Add it here first, then use it.
