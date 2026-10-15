'use client';
import type { MouseEvent } from 'react';
import { FileCode2, GitBranch, Laptop, ScanSearch, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Reveal } from './reveal';

const features: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: GitBranch, title: 'Flows, not files', body: 'Code grouped by the screen it runs on.' },
  { icon: FileCode2, title: 'One page', body: 'Outline, Viewed marks, go to definition.' },
  { icon: TriangleAlert, title: 'Errors inline', body: 'Type and lint errors on changed lines.' },
  { icon: Sparkles, title: 'AI if you want it', body: 'Your own agent. Never posts for you.' },
  { icon: Laptop, title: 'Fully local', body: 'Your machine, your gh login.' },
  { icon: ScanSearch, title: 'Self-review', body: 'Check your branch before the PR.' },
];

// Moves the card's glow to follow the cursor.
function trackPointer(e: MouseEvent<HTMLDivElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--x', `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty('--y', `${e.clientY - rect.top}px`);
}

export function Features() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {features.map(({ icon: Icon, title, body }, i) => (
        <Reveal key={title} delay={i * 60}>
          <div
            onMouseMove={trackPointer}
            className="group relative h-full overflow-hidden rounded-xl border bg-fd-card p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-fd-primary/50"
          >
            <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(220px_circle_at_var(--x)_var(--y),rgb(16_185_129/0.12),transparent_70%)]" />
            <div className="relative flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-fd-primary/10 text-fd-primary transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                <Icon className="size-5" />
              </span>
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-fd-muted-foreground">{body}</p>
              </div>
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
