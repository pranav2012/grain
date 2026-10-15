import { Dialog, DialogTitle } from '@/components/ui/Dialog'
import { Kbd } from '@/components/ui/Kbd'

const shortcuts: [string, string][] = [
  ['j / k', 'Next or previous file'],
  ['Shift J / K', 'Next or previous chapter (user flow)'],
  ['v', 'Mark the file viewed, then go to the next one not viewed'],
  ['b', 'Back to where you were before a jump'],
  ['Line numbers', 'Click or drag to comment on lines'],
  ['⌘ click a name', 'Go to its definition'],
  ['1 / 2 / 3', 'Self review, peer review, maintainer'],
  ['s', 'Switch between unified and split diff'],
  ['m', 'Show your code (CODEOWNERS) as the first chapter'],
  ['⌘K', 'Jump to any file or run a command'],
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
