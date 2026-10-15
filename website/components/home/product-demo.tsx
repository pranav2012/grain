'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const W = 1040;
const H = 600;
const AGENT = 'Claude Code';

interface DemoState {
  file: 0 | 1;
  viewed: number;
  modal: boolean;
  error: boolean;
  select: boolean;
  draft: boolean;
  ask: 'none' | 'thinking' | 'answer';
  spend: string;
  finding: 'none' | 'shown' | 'kept';
  dialog: 'none' | 'open' | 'approve' | 'posted';
  keys: string | null;
  caption: string;
  cursor: string | null;
  click: number;
}

const initial: DemoState = {
  file: 0,
  viewed: 0,
  modal: false,
  error: false,
  select: false,
  draft: false,
  ask: 'none',
  spend: '$0.00',
  finding: 'none',
  dialog: 'none',
  keys: null,
  caption: 'Files in the order the checkout page runs them',
  cursor: 'outline',
  click: 0,
};

// The script: at each time (ms), merge in a change. `click: 1` plays a click ripple.
const script: [number, Partial<DemoState>][] = [
  [1200, { cursor: 'viewed', caption: 'Mark a file viewed' }],
  [2100, { viewed: 1, keys: 'v', click: 1 }],
  [2900, { file: 1, keys: null, cursor: 'token', caption: 'Next file in the flow' }],
  [4500, { modal: true, keys: '⌘ click', click: 1, cursor: 'modal-line', caption: 'Jump to any definition' }],
  [6900, { cursor: 'modal-close', keys: null }],
  [7600, { modal: false, click: 1 }],
  [8200, { error: true, cursor: 'error', caption: 'Type and lint errors, right on the line' }],
  [10200, { select: true, cursor: 'gutter', caption: 'Select lines to comment or ask' }],
  [11000, { draft: true, cursor: 'explain' }],
  [12000, { draft: false, ask: 'thinking', click: 1, keys: null, cursor: 'thread-head', caption: `Ask your own agent (${AGENT}, Codex or OpenCode)` }],
  [13400, { ask: 'answer', spend: '$0.04' }],
  [16400, { cursor: 'spend', caption: 'Every AI request is counted against a daily budget' }],
  [18000, { finding: 'shown', cursor: 'keep', caption: 'Optional second opinion, waiting for you' }],
  [19800, { finding: 'kept', click: 1, caption: 'Keep it as a draft comment' }],
  [21000, { dialog: 'open', keys: '⇧ Enter', cursor: 'approve', caption: 'Submit your review' }],
  [22400, { dialog: 'approve', keys: null, click: 1 }],
  [23200, { cursor: 'submit' }],
  [24000, { dialog: 'posted', click: 1, cursor: 'done', caption: 'Posted to GitHub as one review' }],
  [26500, { ...initial }],
];
const LOOP = 26500;

const outline = [
  { kind: 'flow', title: 'Checkout page', files: ['checkout.tsx', 'useCart.ts', 'CouponField.tsx', 'money.ts'] },
  { kind: 'area', title: 'Also changed', files: ['cart.ts'] },
  { kind: 'routine', title: 'Routine', files: ['pnpm-lock.yaml'] },
];

type Line = { t: ' ' | '+' | '-'; code: ReactNode; mark?: 'error' | 'finding' };

const tok = {
  k: (s: string) => <span className="text-[#c792ea]">{s}</span>,
  f: (s: string) => <span className="text-[#82aaff]">{s}</span>,
  s: (s: string) => <span className="text-[#c3e88d]">{s}</span>,
  c: (s: string) => <span className="text-[#ffcb6b]">{s}</span>,
  m: (s: string) => <span className="text-[#5d636e]">{s}</span>,
};

const diffs: { path: string; stats: string; usedBy: string[]; lines: Line[] }[] = [
  {
    path: 'app/checkout/page.tsx',
    stats: '+4 −1',
    usedBy: ['route /checkout'],
    lines: [
      { t: ' ', code: <>{tok.k('export default function')} {tok.f('CheckoutPage')}() {'{'}</> },
      { t: ' ', code: <>  {tok.k('const')} {'{'} items, total {'}'} = {tok.f('useCart')}()</> },
      { t: '+', code: <>  {tok.k('const')} [coupon, setCoupon] = {tok.f('useState')}&lt;{tok.c('Coupon')}&gt;()</> },
      { t: '+', code: <>  {tok.k('const')} due = {tok.f('applyCoupon')}(total, coupon)</> },
      { t: ' ', code: <>  {tok.k('return')} (</> },
      { t: ' ', code: <>    &lt;{tok.c('Page')} title={tok.s('"Checkout"')}&gt;</> },
      { t: '+', code: <>      &lt;{tok.c('CouponField')} onApply={'{'}setCoupon{'}'} /&gt;</> },
      { t: '-', code: <>      &lt;{tok.c('Summary')} total={'{'}total{'}'} /&gt;</> },
      { t: '+', code: <>      &lt;{tok.c('Summary')} total={'{'}due{'}'} /&gt;</> },
    ],
  },
  {
    path: 'hooks/useCart.ts',
    stats: '+5 −1',
    usedBy: ['CheckoutPage', 'CartDrawer'],
    lines: [
      { t: ' ', code: <>{tok.k('export function')} {tok.f('useCart')}() {'{'}</> },
      { t: ' ', code: <>  {tok.k('const')} items = {tok.f('useStore')}((s) =&gt; s.items)</> },
      { t: '-', code: <>  {tok.k('const')} total = items.{tok.f('reduce')}((n, i) =&gt; n + i.price, 0)</> },
      { t: '+', code: <>  {tok.k('const')} total = items.{tok.f('reduce')}((n, i) =&gt; n + i.price * i.qty, 0)</> },
      {
        t: '+',
        mark: 'error',
        code: (
          <>
            {'  '}
            {tok.k('return')} {'{'} items, total: <span data-t="token">{tok.f('formatPrice')}</span>(total) {'}'}
          </>
        ),
      },
      { t: ' ', code: <>{'}'}</> },
      { t: '+', code: <>{tok.k('export function')} {tok.f('applyCoupon')}(total: {tok.c('number')}, c?: {tok.c('Coupon')}) {'{'}</> },
      { t: '+', mark: 'finding', code: <>  {tok.k('return')} c ? total - c.amount : total</> },
      { t: '+', code: <>{'}'}</> },
    ],
  },
];

const moneyTs: ReactNode[] = [
  <>{tok.k('import')} {'{'} CURRENCY {'}'} {tok.k('from')} {tok.s("'./config'")}</>,
  <></>,
  tok.m('/** Formats cents as a price, e.g. 1999 → "$19.99". */'),
  <>{tok.k('export function')} {tok.f('formatPrice')}(cents: {tok.c('number')}): {tok.c('string')} {'{'}</>,
  <>  {tok.k('return new')} Intl.{tok.f('NumberFormat')}({tok.s("'en-US'")}, {'{'}</>,
  <>    style: {tok.s("'currency'")},</>,
  <>    currency: CURRENCY,</>,
  <>  {'}'}).{tok.f('format')}(cents / 100)</>,
  <>{'}'}</>,
  <></>,
  <>{tok.k('export function')} {tok.f('toCents')}(value: {tok.c('string')}): {tok.c('number')} {'{'}</>,
  <>  {tok.k('return')} Math.{tok.f('round')}({tok.f('parseFloat')}(value) * 100)</>,
  <>{'}'}</>,
];

const ANSWER =
  'Adds applyCoupon, which subtracts the coupon from the total. Nothing stops c.amount from being larger than total, so checkout can show a negative price.';

// Reveals `text` a few characters at a time, like an answer streaming in.
function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setN((v) => (v >= text.length ? v : v + 3)), 28);
    return () => clearInterval(timer);
  }, [text]);
  return <>{text.slice(0, n)}</>;
}

// Plays the script on a loop while the mock is on screen; with reduced motion it shows one still frame.
function useScript() {
  const [state, setState] = useState(initial);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const still = setTimeout(
        () => setState({ ...initial, file: 1, viewed: 1, error: true, ask: 'answer', spend: '$0.04', finding: 'shown', cursor: null }),
        0,
      );
      return () => clearTimeout(still);
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      timers = script.map(([at, patch]) =>
        setTimeout(() => setState((s) => ({ ...s, ...patch, click: patch.click ? s.click + 1 : s.click })), at),
      );
      timers.push(setTimeout(run, LOOP));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [visible]);

  return { state, ref };
}

const btn = 'rounded-md border px-3 py-1 text-[13px]';
const btnDefault = `${btn} border-[#2b2f38] bg-[#1d2027] text-[#e4e6ea]`;
const btnPrimary = `${btn} border-[#e4e6ea] bg-[#e4e6ea] font-medium text-[#16181d]`;
const aiTag = <span className="rounded-sm border border-[#8592f5]/40 px-1 text-[11px] font-semibold text-[#8592f5]">AI</span>;

export function ProductDemo() {
  const { state, ref } = useScript();
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [cursor, setCursor] = useState({ x: 520, y: 330 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => setScale(Math.min(1, el.clientWidth / W));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  // Moves the fake cursor to the centre of the element named by `state.cursor`.
  useEffect(() => {
    if (!state.cursor || !stage.current) return;
    const frame = requestAnimationFrame(() => {
      const target = stage.current?.querySelector(`[data-t="${state.cursor}"]`);
      if (!target || !stage.current) return;
      const a = stage.current.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      setCursor({ x: (b.left - a.left + b.width / 2) / scale, y: (b.top - a.top + b.height / 2) / scale });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.cursor, state.file, state.finding, state.dialog, state.modal, state.draft, state.ask, scale]);

  const diff = diffs[state.file];
  const lineNo = (i: number) => i + 12;
  const selected = (i: number) => state.select && state.file === 1 && lineNo(i) >= 18;
  const posted = state.dialog === 'posted';
  const verdict = state.dialog === 'approve' || posted ? 'APPROVE' : 'COMMENT';

  return (
    <div ref={ref} className="w-full" style={{ height: H * scale }}>
      <div
        ref={stage}
        className="relative origin-top-left overflow-hidden rounded-xl border border-white/10 bg-[#16181d] font-sans text-[13px] text-[#e4e6ea] shadow-2xl shadow-black/40 select-none"
        style={{ width: W, height: H, transform: `scale(${scale})` }}
        aria-label="Animated demo of reviewing a pull request in grain"
        role="img"
      >
        <div className="flex h-9 items-center gap-2 border-b border-[#2b2f38] bg-[#1d2027] px-3.5">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <span className="mx-auto rounded-md bg-[#16181d] px-24 py-1 text-[11.5px] text-[#8a909b]">grain.localhost/acme/storefront/pull/482</span>
        </div>

        <div className="flex h-11 items-center gap-3 border-b border-[#2b2f38] px-4">
          <img src="/favicon.svg" alt="" width={18} height={18} className="rounded" />
          <span className="font-medium">Add coupon codes to checkout</span>
          <span className="text-[#5d636e]">acme/storefront #482</span>
          <span
            className={`ml-auto rounded-full border border-[#e46a5e]/40 bg-[#e46a5e]/10 px-2.5 py-0.5 text-[11.5px] text-[#e46a5e] transition-all duration-500 ${state.error ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}
          >
            ✕ 1 error
          </span>
          <span
            data-t="spend"
            className={`text-[11.5px] tabular-nums transition-colors duration-500 ${state.spend === '$0.00' ? 'text-[#5d636e]' : 'text-[#c7cad1]'}`}
          >
            <span key={state.spend} className="inline-block animate-fade-up [animation-duration:0.4s]">
              {state.spend}
            </span>{' '}
            today
          </span>
          <span className={btnPrimary}>Submit review</span>
        </div>

        <div className="grid h-[calc(100%-5rem)] grid-cols-[210px_1fr_250px]">
          <nav className="flex flex-col border-r border-[#2b2f38] px-2 py-3" data-t="outline">
            <p className="mb-1 px-2.5 text-[11px] font-semibold tracking-wide text-[#5d636e] uppercase">Read in this order</p>
            {outline.map((c, ci) => (
              <div key={c.title} className="mb-2">
                <p className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium">
                  {c.kind === 'flow' && <span className="text-[11px] font-semibold tracking-wide text-[#8592f5] uppercase">flow</span>}
                  <span className={c.kind === 'routine' ? 'text-[#8a909b]' : ''}>{c.title}</span>
                  <span className="ml-auto text-[11px] font-normal text-[#5d636e]">
                    {ci === 0 ? state.viewed : 0}/{c.files.length}
                  </span>
                </p>
                {c.files.map((f, fi) => {
                  const viewed = ci === 0 && fi < state.viewed;
                  const current = ci === 0 && fi === state.file;
                  return (
                    <div
                      key={f}
                      className={`ml-2 flex items-center gap-2 border-l py-0.5 pl-3 pr-2 text-[12px] transition-colors duration-300 ${
                        current ? 'border-[#8592f5] text-[#e4e6ea]' : 'border-[#2b2f38] text-[#8a909b]'
                      }`}
                    >
                      <span
                        className={`size-3 shrink-0 rounded-full border-[1.5px] transition-all duration-300 ${viewed ? 'scale-110 border-[#62b58c] bg-[#62b58c]' : 'border-[#3a3f4a]'}`}
                      />
                      <span className={`flex-1 truncate ${viewed ? 'text-[#5d636e]' : ''}`}>{f}</span>
                      {ci === 0 && fi === 1 && (
                        <span className={`size-1.5 rounded-full bg-[#e46a5e] transition-opacity duration-500 ${state.error ? 'opacity-100' : 'opacity-0'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="mt-auto border-t border-[#2b2f38] px-2.5 pt-3">
              <div className="h-1 overflow-hidden rounded-full bg-[#2b2f38]">
                <div className="h-full bg-[#62b58c] transition-all duration-500" style={{ width: `${(state.viewed / 6) * 100}%` }} />
              </div>
              <p className="mt-1.5 text-[11.5px] text-[#5d636e]">{state.viewed} of 6 files viewed</p>
            </div>
          </nav>

          <main className="relative overflow-hidden px-4 py-3">
            <div key={state.file} className="animate-fade-up [animation-duration:0.5s]">
              <div className="flex items-center gap-3 rounded-t-lg border border-[#2b2f38] bg-[#1d2027] px-3 py-2">
                <span className="font-mono text-[12px]">{diff.path}</span>
                <span className="text-[11.5px] text-[#5d636e]">{diff.stats}</span>
                <span className="ml-auto flex items-center gap-1.5 text-[12px] text-[#8a909b]" data-t="viewed">
                  <span
                    className={`grid size-3.5 place-items-center rounded-sm border text-[9px] transition-colors ${
                      state.file === 0 && state.viewed > 0 ? 'border-[#62b58c] bg-[#62b58c] text-[#16181d]' : 'border-[#3a3f4a]'
                    }`}
                  >
                    {state.file === 0 && state.viewed > 0 ? '✓' : ''}
                  </span>
                  Viewed
                </span>
              </div>
              <div className="flex items-center gap-2 border-x border-[#2b2f38] bg-[#16181d] px-3 py-1.5 text-[11.5px]">
                <span className="text-[#5d636e]">used by</span>
                {diff.usedBy.map((u) => (
                  <span key={u} className="rounded-sm bg-[#232731] px-1.5 py-0.5 font-mono text-[#c7cad1]">
                    {u}
                  </span>
                ))}
              </div>
              <div className="rounded-b-lg border border-[#2b2f38] py-1 font-mono text-[12.5px] leading-[22px]">
                {diff.lines.map((l, i) => (
                  <div key={i}>
                    <div
                      className={`flex whitespace-pre transition-colors duration-300 ${
                        selected(i) ? 'bg-[#8592f5]/15' : l.t === '+' ? 'bg-[#62b58c]/10' : l.t === '-' ? 'bg-[#e46a5e]/10' : ''
                      } ${l.mark === 'finding' && state.finding !== 'none' ? 'ring-1 ring-inset ring-[#d8a443]/40' : ''}`}
                    >
                      <span
                        data-t={lineNo(i) === 19 && state.file === 1 ? 'gutter' : undefined}
                        className={`w-9 shrink-0 pr-2 text-right ${selected(i) ? 'text-[#8592f5]' : 'text-[#5d636e]'}`}
                      >
                        {lineNo(i)}
                      </span>
                      <span className={`w-4 shrink-0 ${l.t === '+' ? 'text-[#62b58c]' : l.t === '-' ? 'text-[#e46a5e]' : ''}`}>{l.t}</span>
                      <span className={l.mark === 'error' && state.error ? 'underline decoration-[#e46a5e] decoration-wavy decoration-1 underline-offset-4' : ''}>
                        {l.code}
                      </span>
                    </div>
                    {l.mark === 'error' && (
                      <div className={`grid transition-all duration-500 ${state.error ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                        <div className="overflow-hidden">
                          <div className="ml-13 flex items-center gap-2 border-l-2 border-[#e46a5e] bg-[#e46a5e]/10 px-3 py-1 font-sans text-[12px]" data-t="error">
                            <span className="text-[#e46a5e]">✕</span>
                            Type &apos;string&apos; is not assignable to type &apos;number&apos;.
                            <span className="text-[#5d636e]">ts(2322)</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {state.file === 1 && state.draft && (
                <div className="mt-2 flex animate-fade-up flex-col gap-1.5 font-sans [animation-duration:0.3s]">
                  <span data-t="explain" className="self-start rounded-md px-2 py-0.5 text-[12px] text-[#8592f5] hover:bg-[#1d2027]">
                    Explain these lines with {AGENT}
                  </span>
                  <div className="rounded-lg border border-[#2b2f38] bg-[#16181d] px-3 py-2 text-[12.5px] text-[#5d636e]">Comment on lines 18–20</div>
                </div>
              )}

              {state.file === 1 && state.ask !== 'none' && (
                <div
                  data-t="thread"
                  className="mt-2 animate-fade-up overflow-hidden rounded-lg border border-[#8592f5]/50 bg-[#1d2027] font-sans shadow-[0_12px_40px_rgb(0_0_0/0.45)] [animation-duration:0.35s]"
                >
                  <div className="flex items-center gap-2 border-b border-[#2b2f38] px-3 py-1.5 text-[11.5px] text-[#8a909b]">
                    {aiTag}
                    <span data-t="thread-head" className="font-mono">useCart.ts:18-20</span>
                    <span className="ml-auto">Collapse</span>
                  </div>
                  <div className="px-3 py-2 text-[12px]">
                    <p className="text-[#8a909b]">What do these lines do, and is anything off?</p>
                    <p className="mt-0.5 min-h-[36px] leading-relaxed text-[#c7cad1]">
                      {state.ask === 'thinking' ? <span className="animate-pulse">{AGENT} is thinking…</span> : <Typed text={ANSWER} />}
                    </p>
                    {state.ask === 'answer' && <span className="text-[11.5px] text-[#8a909b] underline underline-offset-2">turn into comment</span>}
                  </div>
                  <div className="flex gap-2 border-t border-[#2b2f38] px-3 py-2">
                    <span className="flex-1 rounded-lg border border-[#2b2f38] bg-[#16181d] px-3 py-1 text-[12px] text-[#5d636e]">Ask a follow-up…</span>
                    <span className="rounded-md border border-[#2b2f38] bg-[#1d2027] px-2 py-0.5 text-[12px] text-[#5d636e]">Ask</span>
                  </div>
                </div>
              )}
            </div>
          </main>

          <aside className="border-l border-[#2b2f38] px-3 py-3">
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-[#5d636e] uppercase">Second opinion</p>
            <div
              className={`rounded-md border border-l-[3px] border-[#2b2f38] bg-[#1d2027] px-2.5 py-1.5 text-[12px] transition-all duration-500 ${
                state.finding === 'none' ? 'translate-x-6 opacity-0' : 'translate-x-0 opacity-100'
              } ${state.finding === 'kept' ? 'border-l-[#8592f5]' : 'border-l-[#d8a443]'}`}
              style={{ marginTop: state.file === 1 ? 250 : 0 }}
            >
              <p className="flex items-baseline gap-1.5">
                {aiTag}
                <span className="text-[11px] font-semibold tracking-wide text-[#d8a443] uppercase">Bug</span>
                <span className="text-[11px] text-[#5d636e]">80</span>
                <span className="ml-auto text-[11px] text-[#5d636e]">waiting for you</span>
              </p>
              <p className="mt-1 leading-snug text-[#c7cad1]">Total can go negative when the coupon is larger than the subtotal.</p>
              {state.finding === 'kept' ? (
                <p className="mt-1.5 text-[11px] text-[#8592f5]">Draft comment · posts with your review</p>
              ) : (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span data-t="keep" className="rounded-md border border-[#e4e6ea] bg-[#e4e6ea] px-2 py-0.5 text-[12px] font-medium text-[#16181d]">
                    Keep
                  </span>
                  <span className="px-2 py-0.5 text-[12px] text-[#8a909b]">Edit</span>
                  <span className="text-[11.5px] text-[#8a909b]">Dismiss</span>
                </div>
              )}
            </div>
          </aside>
        </div>

        <div
          className={`absolute inset-x-0 bottom-0 top-9 flex items-center justify-center bg-[rgb(8_9_12/0.6)] transition-opacity duration-300 ${state.modal ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <div
            className={`flex h-[86%] w-[92%] flex-col overflow-hidden rounded-xl border border-[#2b2f38] bg-[#1d2027] shadow-[0_24px_80px_rgb(0_0_0/0.55)] transition-transform duration-300 ${state.modal ? 'scale-100' : 'scale-95'}`}
          >
            <header className="flex items-center gap-2 border-b border-[#2b2f38] px-3 py-2 text-[12px]">
              <span className="font-mono text-[11.5px]">
                <span className="text-[#5d636e]">lib/</span>
                <span className="font-semibold">money.ts</span>
                <span className="text-[#5d636e]">:4</span>
              </span>
              <span className="rounded-sm border border-[#62b58c]/40 px-1.5 text-[11px] text-[#62b58c]">changed in this PR</span>
              <span className="ml-auto flex items-center gap-3 text-[11.5px]">
                <span className="text-[#5d636e]">
                  <kbd className="rounded-sm border border-[#3a3f4a] px-1 font-sans">⌘</kbd> click: definition ·{' '}
                  <kbd className="rounded-sm border border-[#3a3f4a] px-1 font-sans">⇧⌘</kbd> click: references
                </span>
                <span className="text-[#8a909b]">Go to it in the review →</span>
                <span className="text-[#8a909b]">GitHub ↗</span>
                <span data-t="modal-close" className="text-[#8a909b]">
                  Close
                </span>
              </span>
            </header>
            <div className="flex-1 bg-[#16181d] py-2 font-mono text-[12.5px] leading-[22px]">
              {moneyTs.map((code, i) => (
                <div
                  key={i}
                  data-t={i === 3 ? 'modal-line' : undefined}
                  className={`flex whitespace-pre ${i === 3 ? 'outline outline-1 -outline-offset-1 outline-[#8592f5]' : ''} ${i >= 10 ? 'bg-[#62b58c]/12' : ''}`}
                >
                  <span className="w-12 shrink-0 pr-4 text-right text-[#5d636e]">{i + 1}</span>
                  <span>{code}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          className={`absolute inset-x-0 bottom-0 top-9 flex items-start justify-center bg-[rgb(8_9_12/0.6)] pt-5 transition-opacity duration-300 ${state.dialog === 'none' ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        >
          <div
            className={`w-[460px] rounded-xl border border-[#2b2f38] bg-[#1d2027] p-5 shadow-[0_24px_80px_rgb(0_0_0/0.55)] transition-all duration-300 ${state.dialog === 'none' ? 'translate-y-1.5 opacity-0' : 'translate-y-0 opacity-100'}`}
          >
            {posted ? (
              <div key="posted" className="animate-fade-up [animation-duration:0.3s]">
                <p className="mb-1 text-[17px] font-semibold">Posted to GitHub</p>
                <p className="mb-3.5 leading-relaxed text-[#8a909b]">Your review is on pull request #482. Posted comments won&apos;t be sent again.</p>
                <div className="mt-4 flex justify-end gap-2">
                  <span className={btnDefault}>Open on GitHub</span>
                  <span data-t="done" className={btnPrimary}>
                    Done
                  </span>
                </div>
              </div>
            ) : (
              <>
                <p className="mb-1 text-[17px] font-semibold">Submit review</p>
                <div className="mb-1 mt-2.5 flex gap-4.5">
                  {[
                    ['1/6', 'files viewed'],
                    ['1', 'comments to post'],
                    ['0', 'changes requested'],
                  ].map(([n, label]) => (
                    <div key={label} className="flex flex-col">
                      <b className="text-[20px] font-semibold tabular-nums">{n}</b>
                      <span className="text-[11.5px] text-[#8a909b]">{label}</span>
                    </div>
                  ))}
                </div>
                <p className="mb-3 leading-relaxed text-[#8a909b]">5 files are not viewed yet. You can finish now and come back to them later.</p>
                <div className="my-3 flex flex-col gap-1.5">
                  {[
                    ['COMMENT', 'Comment', 'Share your comments without a decision.'],
                    ['APPROVE', 'Approve', 'The change is good to merge.'],
                    ['REQUEST_CHANGES', 'Request changes', 'The author must address your comments before merging.'],
                  ].map(([id, label, help]) => {
                    const on = id === verdict;
                    return (
                      <div
                        key={id}
                        data-t={id === 'APPROVE' ? 'approve' : undefined}
                        className={`grid grid-cols-[14px_1fr] gap-2.5 rounded-lg border px-3 py-2.5 transition-colors duration-200 ${on ? 'border-[#8a909b] bg-[#232731]' : 'border-[#2b2f38]'}`}
                      >
                        <span
                          className={`mt-[3px] size-3.5 rounded-full border-[1.5px] ${on ? 'border-[#e4e6ea] bg-[radial-gradient(#e4e6ea_35%,transparent_40%)]' : 'border-[#5d636e]'}`}
                        />
                        <span>
                          {label}
                          <small className="mt-0.5 block text-[12px] text-[#8a909b]">{help}</small>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="min-h-12 rounded-lg border border-[#2b2f38] bg-[#16181d] p-2.5 text-[#5d636e]">Overall comment (optional)</div>
                <p className="mt-2.5 text-[11.5px] text-[#8a909b]">Posts one review as you with 1 line comment.</p>
                <div className="mt-4 flex justify-end gap-2">
                  <span className={btnDefault}>Keep reviewing</span>
                  <span data-t="submit" className={btnPrimary}>
                    {verdict === 'APPROVE' ? 'Approve on GitHub' : 'Post comments to GitHub'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className={`absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 transition-opacity duration-300 ${state.dialog === 'open' || state.dialog === 'approve' ? 'opacity-0' : 'opacity-100'} whitespace-nowrap rounded-full border border-white/10 bg-black/75 px-4 py-2 text-[12.5px] text-white shadow-lg backdrop-blur`}>
          {state.keys && (
            <kbd key={state.keys} className="animate-fade-up rounded border border-white/25 bg-white/10 px-1.5 font-mono text-[11.5px] [animation-duration:0.25s]">
              {state.keys}
            </kbd>
          )}
          <span key={state.caption} className="animate-fade-up [animation-duration:0.3s]">
            {state.caption}
          </span>
        </div>

        <div
          className="pointer-events-none absolute left-0 top-0 z-20 transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
        >
          <span key={state.click} className={state.click ? 'absolute -left-3 -top-3 size-6 animate-ping rounded-full bg-white/40 [animation-iteration-count:1]' : ''} />
          <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow">
            <path d="M1 1l6.5 17 2.4-7.1L17 8.5z" fill="#fff" stroke="#000" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
