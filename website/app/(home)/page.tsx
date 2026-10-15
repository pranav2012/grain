import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AnimatedLogo } from '@/components/home/animated-logo';
import { Features } from '@/components/home/features';
import { FlowDemo } from '@/components/home/flow-demo';
import { InstallTabs } from '@/components/home/install-tabs';
import { ProductDemo } from '@/components/home/product-demo';
import { Reveal } from '@/components/home/reveal';

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-6xl overflow-x-clip px-6">
      <section className="relative flex flex-col items-center pb-16 pt-20 text-center md:pt-28">
        <div className="animate-glow pointer-events-none absolute inset-x-0 top-6 -z-10 mx-auto h-80 max-w-2xl rounded-full bg-fd-primary/20 blur-3xl" />
        <div className="animate-fade-up mb-8">
          <AnimatedLogo />
        </div>
        <h1 className="animate-fade-up max-w-3xl text-4xl font-bold tracking-tight [animation-delay:120ms] md:text-6xl">
          Review PRs as user flows, <span className="text-fd-primary">not file lists</span>
        </h1>
        <p className="animate-fade-up mt-6 max-w-xl text-lg text-fd-muted-foreground [animation-delay:220ms]">
          grain shows each changed screen&apos;s code in the order it runs. Review what users hit together. Skim the rest.
        </p>
        <div className="animate-fade-up mt-8 flex flex-wrap justify-center gap-3 [animation-delay:320ms]">
          <Link
            href="/docs/start/install"
            className="group inline-flex items-center gap-2 rounded-full bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground shadow-lg shadow-fd-primary/25 transition-all hover:shadow-fd-primary/40 active:scale-95"
          >
            Get started <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://github.com/pranav2012/grain"
            className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 font-medium transition-colors hover:bg-fd-accent active:scale-95"
          >
            View on GitHub
          </a>
        </div>
        <div className="animate-fade-up mt-10 w-full max-w-2xl [animation-delay:420ms]">
          <InstallTabs />
        </div>
      </section>

      <section className="pb-12">
        <Reveal>
          <ProductDemo />
        </Reveal>
      </section>

      <FlowDemo />

      <section className="py-16">
        <Reveal className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">What you get</h2>
        </Reveal>
        <Features />
      </section>

      <Reveal>
        <section className="py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Try it on your next review</h2>
          <p className="mt-3 text-fd-muted-foreground">
            <code className="rounded bg-fd-muted px-1.5 py-0.5 text-sm">grain owner/repo#123</code>
          </p>
          <Link href="/docs" className="group mt-6 inline-flex items-center gap-2 font-medium text-fd-primary">
            Read the docs <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </section>
      </Reveal>

      <footer className="border-t py-8 text-center text-sm text-fd-muted-foreground">Apache-2.0 · Runs locally · Made for reviewers</footer>
    </div>
  );
}
