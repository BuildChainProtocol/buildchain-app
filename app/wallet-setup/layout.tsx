import { onTestNetwork } from '@/lib/network'

// The page itself runs in the browser and cannot know which ledger network
// the site is on. This says so, and only while it is true.
export const dynamic = 'force-dynamic'

export default function WalletSetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {onTestNetwork() && (
        <p className="text-xs text-center px-6 pb-10" style={{ color: 'var(--bc-muted)' }}>
          BuildChain is in pilot on the XRP Ledger test network: no real funds move.
        </p>
      )}
    </>
  )
}
