import { cn } from '@/lib/cn'
import { usd } from '@/lib/format'
import type { Spend } from '@/types/generated/Spend'

/** Top bar: today's AI spend against the daily budget; details on hover. */
export function SpendChip({ spend }: { spend: Spend }) {
  const capped = spend.dailyBudget > 0
  const over = capped && spend.today >= spend.dailyBudget
  const near = capped && spend.today >= spend.dailyBudget * 0.8
  const title = [
    `Today ${usd(spend.today)}${capped ? ` of ${usd(spend.dailyBudget)} budget` : ''}`,
    `This month ${usd(spend.month)}`,
    `This PR ${usd(spend.thisPr)}`,
    spend.estimated ? 'Some costs are estimated from token counts.' : '',
    'At API prices; on a subscription this is usage, not a bill.',
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span title={title} className={cn('text-xs whitespace-nowrap tabular-nums', over ? 'text-danger' : near ? 'text-warning' : 'text-fg-faint')}>
      {usd(spend.today)} today
    </span>
  )
}
