'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

const commands: [string, string][] = [
  ['Homebrew', 'brew install pranav2012/tap/grain'],
  ['curl', 'curl -LsSf https://github.com/pranav2012/grain/releases/latest/download/grain-installer.sh | sh'],
  ['npm', 'npm i -g grain-ci'],
  ['pnpm', 'pnpm add -g grain-ci'],
  ['bun', 'bun add -g grain-ci'],
];

export function InstallTabs() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const command = commands[active][1];

  function copy() {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-fd-card/80 text-left backdrop-blur">
      <div className="flex gap-1 overflow-x-auto border-b px-2 pt-2">
        {commands.map(([label], i) => (
          <button
            key={label}
            type="button"
            onClick={() => setActive(i)}
            className={`relative px-3 pb-2 pt-1 text-sm transition-colors ${
              i === active ? 'font-medium text-fd-foreground' : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
          >
            {label}
            <span
              className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-fd-primary transition-transform duration-300 ${i === active ? 'scale-x-100' : 'scale-x-0'}`}
            />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 px-4 py-3 font-mono text-sm">
        <span className="select-none text-fd-primary">$</span>
        <code key={command} className="animate-fade-up flex-1 overflow-x-auto whitespace-nowrap [animation-duration:0.35s]">
          {command}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy command"
          className="grid size-8 place-items-center rounded-md text-fd-muted-foreground transition-all hover:bg-fd-accent hover:text-fd-foreground active:scale-90"
        >
          {copied ? <Check className="size-4 text-fd-primary animate-fade-up [animation-duration:0.25s]" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}
