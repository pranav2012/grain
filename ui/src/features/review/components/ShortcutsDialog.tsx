import { Dialog, DialogTitle } from '@/components/ui/Dialog'
import { Kbd } from '@/components/ui/Kbd'

const shortcuts: [string, string][] = [
  ['j / k', 'Next or previous step'],
  ['Shift J / K', 'Next or previous stage'],
  ['h', 'Back to the overview'],
  ['space', 'Mark the step reviewed, then go to the next open step'],
  ['x', 'Request a change or ask the agent to fix'],
  ['c', 'Note on the whole step'],
  ['a', 'Explain this step with your AI agent (opt-in)'],
  ['Line numbers', 'Click or drag to comment on lines'],
  ['1 / 2 / 3', 'Self review, peer review, maintainer'],
  ['s', 'Switch between unified and side-by-side diff'],
  ['m', 'Show your code (CODEOWNERS) as the first stage'],
  [']', 'Show or hide the context panel'],
  ['⌘K', 'Jump anywhere or run a command'],
  ['⌘O', 'Open another pull request'],
  [',', 'Settings'],
  ['Shift Enter', 'Finish the review'],
]

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose} className="p-5">
      <DialogTitle>Keyboard shortcuts</DialogTitle>
      <div className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-4.5 gap-y-2.5">
        {shortcuts.map(([k, d]) => (
          <div key={k} className="contents">
            <Kbd className="justify-self-start">{k}</Kbd>
            <span className="text-fg-subtle">{d}</span>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
