import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" width={24} height={24} className="rounded-md" />
          {appName}
        </span>
      ),
    },
    links: [{ text: 'Docs', url: '/docs', active: 'nested-url', on: 'nav' }],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
