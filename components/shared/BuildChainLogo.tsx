/**
 * The approved BuildChain logo, from the vector files in public/brand.
 *
 *   mark      the icon alone (square)
 *   wordmark  "BuildChain" alone
 *   lockup    icon + wordmark + PROTOCOL + tagline
 *
 * `reverse` (the default) is the version for dark backgrounds: the navy parts
 * are white and the gold stays gold. Pass reverse={false} on light backgrounds.
 */
import type { CSSProperties } from 'react'

const FILES = { mark: 'buildchain-mark', wordmark: 'buildchain-wordmark', lockup: 'buildchain-logo' } as const
const RATIO = { mark: 1, wordmark: 1062 / 179, lockup: 1480 / 507 } as const

export function BuildChainLogo({
  variant,
  height,
  reverse = true,
  alt,
  className,
  style,
}: {
  variant: keyof typeof FILES
  height: number
  reverse?: boolean
  /** Defaults to "BuildChain"; pass "" for a mark that sits next to the wordmark */
  alt?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/brand/${FILES[variant]}${reverse ? '-reverse' : ''}.svg`}
      alt={alt ?? 'BuildChain'}
      height={height}
      width={Math.round(height * RATIO[variant])}
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
    />
  )
}
