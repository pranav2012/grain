'use client';
import { useEffect, useRef, useState } from 'react';

type Kind = 'flow' | 'other' | 'routine';

const ROW = 44;
const NODE_X = 44;
const NODE_R = 12;

interface FileRow {
  path: string;
  kind: Kind;
  add: number;
  del: number;
  step?: number;
}

const files: FileRow[] = [
  { path: 'src/api/cart.ts', kind: 'flow', add: 3, del: 0, step: 3 },
  { path: 'src/components/CartItem.tsx', kind: 'flow', add: 6, del: 2, step: 4 },
  { path: 'src/components/PriceTag.tsx', kind: 'flow', add: 2, del: 1, step: 5 },
  { path: 'src/hooks/useCart.ts', kind: 'flow', add: 5, del: 1, step: 2 },
  { path: 'src/legacy/oldCart.ts', kind: 'other', add: 0, del: 14 },
  { path: 'src/pages/checkout.tsx', kind: 'flow', add: 4, del: 1, step: 1 },
  { path: 'src/utils/money.ts', kind: 'flow', add: 8, del: 0, step: 6 },
  { path: 'pnpm-lock.yaml', kind: 'routine', add: 212, del: 96 },
];

const flowLayout: (string | { heading: string })[] = [
  { heading: 'Checkout page' },
  'src/pages/checkout.tsx',
  'src/hooks/useCart.ts',
  'src/api/cart.ts',
  'src/components/CartItem.tsx',
  'src/components/PriceTag.tsx',
  'src/utils/money.ts',
  { heading: 'Also changed' },
  'src/legacy/oldCart.ts',
  { heading: 'Routine' },
  'pnpm-lock.yaml',
];

const headingRow = new Map<string, number>();
const flowRow = new Map<string, number>();
flowLayout.forEach((item, i) => (typeof item === 'string' ? flowRow.set(item, i) : headingRow.set(item.heading, i)));

const byStep = files.filter((f) => f.step).sort((a, b) => a.step! - b.step!);
const filesIndex = new Map(files.map((f, i) => [f.path, i]));
const centre = (row: number) => row * ROW + ROW / 2;

// The reading path through the A–Z list: one arc per jump, from the left edge of a step's circle to the next,
// in the gutter beside the circles. Longer jumps bulge further out so the arcs nest instead of crossing.
const EDGE = NODE_X - NODE_R - 2;
const jumpArcs = byStep.slice(1).map((f, i) => {
  const from = centre(filesIndex.get(byStep[i].path)!);
  const to = centre(filesIndex.get(f.path)!);
  const bulge = 10 + (Math.abs(to - from) / ROW) * 6;
  return {
    d: `M ${EDGE} ${from} C ${EDGE - bulge} ${from}, ${EDGE - bulge} ${to}, ${EDGE} ${to}`,
    arrow: `${EDGE} ${to}, ${EDGE - 6} ${to - 3.5}, ${EDGE - 6} ${to + 3.5}`,
  };
});
const jumps = byStep.length - 1;

const story: [string, string][] = [
  ['GitHub lists files A to Z', `To follow one change through the code, you jump around this list ${jumps} times.`],
  ['Start where the user starts', 'grain finds the entry point the PR touches: the checkout page.'],
  ['Follow what it calls', 'The page calls useCart, so that comes next.'],
  ['And what that calls', 'useCart loads the cart through the API client.'],
  ['Then what the page renders', 'Back at the page, it renders CartItem for each line.'],
  ['Down the component tree', 'CartItem renders PriceTag.'],
  ['Down to the helpers', 'PriceTag formats amounts with money.ts.'],
  ['One flow, top to bottom', 'Code no flow reaches and lockfiles move out of the way, to skim last.'],
];

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const range = (p: number, from: number, to: number) => clamp((p - from) / (to - from));

const STAGES = byStep.length + 1;

// Where each row sits after `stage` files have been pulled into the flow: the picked files in call order
// under the flow heading, then the rest still A–Z. The last stage is grain's full layout.
function layoutFor(stage: number) {
  const files_ = new Map<string, number>();
  const headings = new Map<string, number>();
  if (stage === 0) {
    files.forEach((f, i) => files_.set(f.path, i));
    return { files: files_, headings, rows: files.length };
  }
  if (stage >= STAGES) return { files: flowRow, headings: headingRow, rows: flowLayout.length };
  headings.set('Checkout page', 0);
  const picked = byStep.slice(0, stage);
  picked.forEach((f, i) => files_.set(f.path, i + 1));
  files.filter((f) => !picked.includes(f)).forEach((f, i) => files_.set(f.path, picked.length + 1 + i));
  return { files: files_, headings, rows: files.length + 1 };
}

// How far the reader has scrolled through `ref` while it is pinned: 0 at the start, 1 at the end.
function useScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const done = requestAnimationFrame(() => setP(1));
      return () => cancelAnimationFrame(done);
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setP(clamp(-rect.top / (rect.height - window.innerHeight)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return { ref, p };
}

// A PR's files, pinned on screen while the page scrolls: first GitHub's A–Z list with the jumps needed to
// follow one flow, then grain pulls the files into the flow one by one in call order, narrated on the left.
export function FlowDemo() {
  const { ref, p } = useScrollProgress();

  const draw = range(p, 0.04, 0.22);
  const stage = Math.min(STAGES, Math.floor(range(p, 0.24, 0.9) * (STAGES + 0.999)));
  const layout = layoutFor(stage);
  const picked = Math.min(stage, byStep.length);
  const settled = stage >= STAGES;
  const building = stage > 0 && !settled;
  const chainStart = picked > 0 ? centre(layout.files.get(byStep[0].path)!) : 0;
  const chainEnd = picked > 0 ? centre(layout.files.get(byStep[picked - 1].path)!) : 0;
  const [title, body] = story[stage];

  return (
    <section ref={ref} className="relative h-[300vh]">
      <div className="sticky top-14 flex h-[calc(100vh-3.5rem)] items-center py-3 md:py-6">
        <div className="grid w-full items-center gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-14">
          <div className="text-center md:text-left">
            <p className="text-sm font-medium text-fd-primary">Same PR. Better order.</p>
            <div key={stage} className="animate-fade-up [animation-duration:0.45s]">
              <p className="mt-3 font-mono text-xs uppercase tracking-widest md:mt-6 text-fd-muted-foreground">
                {stage === 0 ? 'Before' : settled ? 'After' : `Step ${picked} of ${byStep.length}`}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-balance md:text-4xl">{title}</h2>
              <p className="mt-2 text-fd-muted-foreground text-pretty md:mt-3 md:text-lg">{body}</p>
            </div>
            <div className="mt-4 flex justify-center gap-1.5 md:mt-8 md:justify-start" aria-hidden>
              {story.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-500 ${i === stage ? 'w-6 bg-fd-primary' : i < stage ? 'w-1.5 bg-fd-primary/50' : 'w-1.5 bg-fd-border'}`}
                />
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-fd-primary/10 blur-3xl" />
            <div className="overflow-hidden rounded-2xl border bg-fd-card shadow-2xl shadow-black/10">
              <div className="flex items-center gap-3 border-b px-4 py-2.5 text-sm">
                <span className="font-medium">acme/storefront #482</span>
                <span className="text-fd-muted-foreground">8 files</span>
                <span
                  className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-500 ${
                    stage === 0 ? 'bg-fd-muted text-fd-muted-foreground' : 'bg-fd-primary/15 text-fd-primary'
                  }`}
                >
                  {stage === 0 ? 'A–Z' : 'By flow'}
                </span>
              </div>

              <div className="relative mx-3 my-2 transition-[height] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)]" style={{ height: layout.rows * ROW }}>
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                  <g className="text-fd-muted-foreground transition-opacity duration-300" style={{ opacity: stage === 0 ? 0.75 : 0 }}>
                    {jumpArcs.map((arc, i) => {
                      const t = range(draw, i / jumpArcs.length, (i + 1) / jumpArcs.length);
                      return (
                        <g key={i} className="transition-opacity duration-300" style={{ opacity: t <= 0 ? 0 : t < 1 || draw >= 1 ? 1 : 0.55 }}>
                          <path
                            d={arc.d}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.25"
                            strokeLinecap="round"
                            pathLength={1}
                            strokeDasharray={1}
                            style={{ strokeDashoffset: 1 - t }}
                          />
                          <polygon points={arc.arrow} fill="currentColor" style={{ opacity: t >= 1 ? 1 : 0 }} className="transition-opacity duration-200" />
                        </g>
                      );
                    })}
                  </g>
                  <line
                    x1={NODE_X}
                    x2={NODE_X}
                    y1={chainStart}
                    y2={chainEnd}
                    className="stroke-fd-primary transition-all duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
                    strokeWidth="2"
                    style={{ opacity: picked > 1 ? 1 : 0 }}
                  />
                </svg>

                {flowLayout.map((item) =>
                  typeof item === 'string' ? null : (
                    <div
                      key={item.heading}
                      className="absolute inset-x-0 flex items-center gap-2 px-2 text-[13px] font-semibold transition-all duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
                      style={{
                        height: ROW,
                        transform: `translateY(${(layout.headings.get(item.heading) ?? headingRow.get(item.heading)!) * ROW}px)`,
                        opacity: layout.headings.has(item.heading) ? 1 : 0,
                      }}
                    >
                      <span className={item.heading === 'Checkout page' ? 'text-fd-foreground' : 'text-fd-muted-foreground'}>{item.heading}</span>
                      {item.heading === 'Checkout page' && (
                        <span className="rounded-full bg-fd-primary/15 px-2 py-0.5 text-[11px] font-medium text-fd-primary">user flow</span>
                      )}
                    </div>
                  ),
                )}

                {files.map((f) => {
                  const row = layout.files.get(f.path)!;
                  const inFlow = !!f.step && f.step <= picked;
                  const latest = building && f.step === picked;
                  const dimmed = (building && !inFlow) || (settled && !f.step);
                  const name = f.path.split('/').pop()!;
                  const dir = f.path.includes('/') ? f.path.slice(0, f.path.length - name.length - 1) : '';
                  return (
                    <div
                      key={f.path}
                      className={`absolute inset-x-0 flex items-center gap-3 rounded-xl pr-3 transition-[transform,opacity,background-color] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
                        latest ? 'bg-fd-primary/10' : ''
                      } ${dimmed ? 'opacity-45' : ''}`}
                      style={{ height: ROW, transform: `translateY(${row * ROW}px)` }}
                    >
                      <span className="flex w-[60px] shrink-0 justify-end pr-1">
                        {f.step ? (
                          <span
                            className={`z-10 grid size-6 place-items-center rounded-full text-[11px] font-semibold tabular-nums transition-all duration-300 ${
                              inFlow
                                ? `bg-fd-primary text-fd-primary-foreground ${latest ? 'scale-110 shadow-[0_0_0_5px] shadow-fd-primary/20' : ''}`
                                : 'bg-fd-card text-fd-foreground ring-1 ring-fd-muted-foreground/40'
                            }`}
                          >
                            {f.step}
                          </span>
                        ) : (
                          <span className="grid size-6 place-items-center">
                            <span className="size-1.5 rounded-full bg-fd-muted-foreground/40" />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-medium text-fd-foreground">{name}</span>
                        {dir && <span className="ml-2 text-xs text-fd-muted-foreground">{dir}</span>}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums">
                        {f.add > 0 && <span className="text-emerald-500">+{f.add}</span>}
                        {f.add > 0 && f.del > 0 && ' '}
                        {f.del > 0 && <span className="text-red-400">−{f.del}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
