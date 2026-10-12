import { Dialog } from '@/components/ui/Dialog'
import { Kbd } from '@/components/ui/Kbd'

const shortcuts: [string, string][] = [
  ['j / k', 'Next or previous block'],
  ['Shift J / K', 'Next or previous chapter'],
  ['space', 'Primary action for the mode, then jump to the next open block'],
  ['x', 'Request a change or ask the agent to fix'],
  ['c', 'Note on the whole block'],
  ['a', 'Summarize this block with your AI agent (opt-in)'],
  ['Line numbers', 'Click or drag to comment on lines'],
  ['1 / 2 / 3', 'Self review, peer review, maintainer'],
  ['s', 'Switch between unified and side-by-side diff'],
  [']', 'Show or hide the context panel'],
  ['⌘K', 'Jump anywhere or run a command'],
  ['⌘O', 'Open another pull request'],
  [',', 'Settings'],
  ['Shift Enter', 'Finish the review'],
]

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose} className="p-5">
      <h2 className="text-[17px] font-semibold">Keyboard shortcuts</h2>
      <div className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-[18px] gap-y-2.5">
        {shortcuts.map(([k, d]) => (
          <div key={k} className="contents">
            <Kbd className="justify-self-start">{k}</Kbd>
            <span className="text-fog">{d}</span>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
