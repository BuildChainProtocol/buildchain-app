import type { Metadata } from 'next'
import Link from 'next/link'
import { BuildChainLogo } from '@/components/shared/BuildChainLogo'

export const metadata: Metadata = {
  title: 'Terms of Service | BuildChain Protocol',
  description:
    'The terms that apply to the BuildChain Protocol website and its pilot construction-loan draw platform on the XRP Ledger test network.',
}

const LAST_UPDATED = 'November 27, 2026'
const CONTACT_EMAIL = 'info@buildchain.finance'

// A block is either a paragraph (string) or a bulleted list (string[]).
type Block = string | string[]
type Section = { title: string; body: Block[] }

const sections: Section[] = [
  {
    title: 'About these terms',
    body: [
      'These Terms of Service (the “Terms”) are an agreement between you and BuildChain Protocol, Inc., a Delaware corporation (“BuildChain™,” “we,” “us”). They cover the website at https://www.buildchain.finance and the BuildChain construction-loan draw platform (together, the “service”).',
      'By visiting the site or using the service, you agree to these Terms. If you do not agree, do not use the service.',
      'If you and BuildChain have signed a separate written agreement, such as a pilot agreement, that agreement controls wherever it conflicts with these Terms.',
    ],
  },
  {
    title: 'Who can use the service',
    body: [
      'The service is for businesses and their staff in the United States. You must be at least 18 years old.',
      'If you use the service for a company or other organization, you confirm that you are authorized to accept these Terms for it, and “you” means both you and that organization.',
    ],
  },
  {
    title: 'The service is a pilot on a test network',
    body: [
      'Please read this section carefully.',
      [
        'The service is in a pilot. It runs on the XRP Ledger test network.',
        'No real funds move through the service today. Test-network records, tokens and balances have no monetary value and cannot be redeemed for anything.',
        'A record on the test network is not a payment, and it does not show that money was disbursed. Any real disbursement on a loan happens outside the service, between the lender and its borrower, under their own loan documents.',
        'Production settlement is planned in RLUSD, a US-dollar stablecoin issued by a third party, not by BuildChain. That is a plan, not a promise, and it is not available today.',
        'Features may change, break or be removed during the pilot. The test network is run by others and may be reset, which can remove test records.',
        'Do not rely on the pilot as your only record of a loan, draw, inspection or lien waiver. Keep your own records.',
      ],
    ],
  },
  {
    title: 'What the service does and does not do',
    body: [
      'The service is software. Lenders, borrowers, contractors and inspectors use it to manage construction-loan draws. It records draw approvals, inspections and lien waivers on the XRP Ledger.',
      'The service is designed to be non-custodial. A lender approves a draw by signing in its own wallet, using the Xaman wallet app. BuildChain does not hold your funds and does not hold your private keys.',
      'BuildChain does not lend money, does not decide whether a draw should be approved, does not inspect work, and does not prepare or review your legal documents. Each lender makes its own credit and draw decisions. Each inspector is responsible for its own inspections. Each user is responsible for the accuracy of what it submits.',
    ],
  },
  {
    title: 'No legal, financial or investment advice',
    body: [
      'Nothing on the site or in the service is legal, financial, tax or investment advice. Nothing in the service is a recommendation to make a loan, approve a draw, sign a lien waiver, or buy, sell or hold any digital asset.',
      'Lien-waiver forms, document templates and any other wording the service provides are for convenience only. Lien and lending laws differ from state to state. Have your own attorney review your lien waivers and loan documents before you rely on them.',
    ],
  },
  {
    title: 'Your account',
    body: [
      'You need an account to use the platform. Give us accurate and complete information and keep it up to date.',
      'Keep your sign-in details confidential. Do not share your account or let anyone else use it. You are responsible for what happens under your account.',
      'Tell us right away at ' +
        CONTACT_EMAIL +
        ' if you think someone has used your account without permission.',
      'We may suspend or close an account that breaks these Terms or that we reasonably believe is a security risk.',
    ],
  },
  {
    title: 'Wallets, the XRP Ledger and digital-asset risks',
    body: [
      'Some actions in the service are recorded on the XRP Ledger, a public network run by independent parties and not by BuildChain. By using the service you accept the following:',
      [
        'Ledger transactions are irreversible. Once a transaction is confirmed, BuildChain cannot reverse, cancel or change it.',
        'Ledger records are public and permanent. Anyone can read them, and nobody can delete them, including BuildChain.',
        'You are solely responsible for your own wallet, private keys, recovery phrase and XRP Ledger accounts. BuildChain never has your private keys. We cannot recover lost keys, restore access to a wallet, or recover assets sent to a wrong address.',
        'Check every signing request in your wallet before you approve it. You are responsible for what you sign.',
        'The Xaman wallet app is run by its own company under its own terms. BuildChain does not control it and is not responsible for it.',
        'We do not promise that the XRP Ledger, its test network or any wallet will be available, will perform in any particular way, or will keep operating.',
        'Digital assets, including stablecoins, carry risks. They can lose value, the issuer can fail or freeze them, software can fail, and the laws that apply to them can change. You accept those risks for any digital asset you choose to use.',
      ],
      'Do not put personal information, such as Social Security numbers, bank account numbers or borrower personal details, into anything that is written to the ledger.',
    ],
  },
  {
    title: 'Fees',
    body: [
      'We do not charge fees during the pilot.',
      'The stated price for production use is 0.30% of each draw disbursement, paid by the lender. Nothing is charged now. No fee will apply to you until we have told you about it in advance and you have agreed to it.',
    ],
  },
  {
    title: 'Your data and privacy',
    body: [
      'Our Privacy Policy, at https://www.buildchain.finance/privacy, explains what information we collect and how we use it. It is part of these Terms.',
      'You keep ownership of the information and documents you submit to the service (“your data”). You give BuildChain a non-exclusive licence to use, store and process your data in order to provide and improve the service. That includes showing it to the other parties on the same loan and writing the related records to the XRP Ledger.',
      'You confirm that your data is accurate and that you have the rights and permissions needed to submit it.',
    ],
  },
  {
    title: 'Acceptable use',
    body: [
      'You agree not to:',
      [
        'Submit false, fraudulent or misleading draw requests, lien waivers, inspection records or other information.',
        'Try to get around, manipulate or exploit the way the service or its ledger records work.',
        'Break any law or regulation, or infringe anyone else’s rights.',
        'Upload malware, ransomware or other harmful code.',
        'Pretend to be another person or company, or misstate who you work for.',
        'Use the service in a way that could harm, disable or overload our systems.',
        'Share your sign-in details or let an unauthorized person use your account.',
        'Reverse engineer, decompile or disassemble any part of the service, except where the law does not allow this restriction.',
        'Scrape the site or the service by automated means.',
        'Copy the service or build derivative works from it.',
      ],
      'If you break these rules, we may suspend or close your account at once. You may also face civil or criminal liability.',
    ],
  },
  {
    title: 'Intellectual property',
    body: [
      'BuildChain owns the service, the site and the technology behind them, including all related intellectual property rights. BUILDCHAIN™ and BuildChain™ are trademarks of BuildChain Protocol, Inc. These Terms do not give you any ownership of the service or any right to use our trademarks.',
      'While you follow these Terms, we give you a limited, non-exclusive, non-transferable, revocable licence to use the service for your own internal business purposes for as long as you have access.',
      'If you send us feedback or suggestions, we may use them without any obligation to you.',
    ],
  },
  {
    title: 'Third-party services',
    body: [
      'The service depends on services run by others, including the XRP Ledger network, the Xaman wallet, and our hosting, database and email providers. It can also connect to Building Block (bblock.build), a construction-management product owned by BuildChain Protocol, Inc., for projects that link the two.',
      'Services run by other companies are governed by their own terms. We are not responsible for them, or for websites we link to but do not run.',
    ],
  },
  {
    title: 'Disclaimers',
    body: [
      'THE SERVICE AND THE SITE ARE PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTY OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED BY LAW, BUILDCHAIN DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT.',
      'BUILDCHAIN DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE OR FREE OF HARMFUL CODE, OR THAT ANY INFORMATION ON THE SITE OR IN THE SERVICE IS ACCURATE OR COMPLETE.',
      'The service is a pilot. We do not promise any level of uptime, and we do not promise that data or test-network records will be preserved.',
    ],
  },
  {
    title: 'Limitation of liability',
    body: [
      'TO THE MAXIMUM EXTENT PERMITTED BY LAW, BUILDCHAIN WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST DATA OR BUSINESS INTERRUPTION, EVEN IF WE HAVE BEEN TOLD THAT SUCH DAMAGES ARE POSSIBLE.',
      'TO THE MAXIMUM EXTENT PERMITTED BY LAW, BUILDCHAIN’S TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE TOTAL FEES YOU PAID TO BUILDCHAIN IN THE 12 MONTHS BEFORE THE CLAIM AROSE, OR (B) ONE HUNDRED US DOLLARS ($100.00).',
      'Some laws do not allow certain limits on liability. Where that is the case, these limits apply only as far as the law allows.',
    ],
  },
  {
    title: 'Indemnification',
    body: [
      'You agree to indemnify, defend and hold harmless BuildChain and its officers, directors, employees, agents and successors from any claims, damages, liabilities, costs and expenses (including reasonable attorneys’ fees) that arise out of or relate to:',
      [
        'your use of the service;',
        'your breach of these Terms;',
        'your data;',
        'your violation of any law or of anyone else’s rights; or',
        'any fraudulent draw request or falsified lien waiver or inspection record submitted through your account.',
      ],
    ],
  },
  {
    title: 'Term and termination',
    body: [
      'These Terms apply from the first time you visit the site or use the service, and they continue until your access ends.',
      'You may stop using the service at any time. To close your account, email ' +
        CONTACT_EMAIL +
        '.',
      'We may end your access at once for cause, including a material breach of these Terms or fraudulent activity. We may also end your access, or end the pilot, for any reason on 30 days’ notice.',
      'When your access ends, your licence to use the service ends. You can ask us for a copy of your data or ask us to delete it by emailing ' +
        CONTACT_EMAIL +
        ', as described in the Privacy Policy. Records on the XRP Ledger cannot be deleted by anyone.',
      'These sections continue to apply after your access ends: 5 (No legal, financial or investment advice), 7 (Wallets, the XRP Ledger and digital-asset risks), 9 (Your data and privacy), 11 (Intellectual property), 13 (Disclaimers), 14 (Limitation of liability), 15 (Indemnification), 18 (Dispute resolution), 19 (Governing law) and 20 (General).',
    ],
  },
  {
    title: 'Changes to these terms',
    body: [
      'We may change these Terms. When we do, we will change the “Last updated” date at the top of this page. For a material change, we will give you 30 days’ notice by email or with a notice on the site.',
      'If you keep using the service after a change takes effect, you accept the changed Terms.',
    ],
  },
  {
    title: 'Dispute resolution',
    body: [
      'Informal resolution first. Before starting arbitration, the party with a dispute must send the other party written notice of it. Both parties will then try in good faith to resolve it for 30 days.',
      'Arbitration. If the dispute is not resolved in that time, it will be resolved by binding arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules. The arbitration will take place in Maricopa County, Arizona.',
      'No class actions. You waive any right to take part in a class action, class arbitration or representative proceeding against BuildChain.',
      'Small claims. Either party may bring an eligible claim in small claims court instead of arbitration.',
    ],
  },
  {
    title: 'Governing law',
    body: [
      'These Terms are governed by the laws of the State of Delaware, without regard to its conflict-of-laws rules.',
    ],
  },
  {
    title: 'General',
    body: [
      [
        'Entire agreement. These Terms, the Privacy Policy and any separate written agreement you have signed with BuildChain are the entire agreement between you and BuildChain about the service.',
        'Severability. If any part of these Terms is found unenforceable, the rest stays in effect.',
        'No waiver. If we do not enforce a provision, that is not a waiver of it.',
        'Assignment. BuildChain may assign these Terms in connection with a merger, acquisition or sale of assets. You may not assign these Terms without our prior written consent.',
        'Notices. Send notices to BuildChain at ' +
          CONTACT_EMAIL +
          '. We will send notices to you at the email address on your account.',
        'Events outside our control. BuildChain is not liable for delays or failures caused by events beyond its reasonable control, including XRP Ledger network outages, natural disasters and government actions.',
      ],
    ],
  },
  {
    title: 'Contact us',
    body: ['Questions about these Terms: BuildChain Protocol, Inc., ' + CONTACT_EMAIL + '.'],
  },
]

export default function TermsPage() {
  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--bc-dark)', color: '#e8edf2' }}
    >
      <main
        className="mx-auto px-4 sm:px-8 py-12 sm:py-16"
        style={{ maxWidth: 760, lineHeight: 1.7 }}
      >
        <Link href="/" aria-label="BuildChain Protocol home" style={{ display: 'inline-block' }}>
          <BuildChainLogo variant="lockup" height={72} alt="BuildChain Protocol" />
        </Link>

        <h1 className="text-3xl sm:text-4xl font-bold mt-10" style={{ lineHeight: 1.2 }}>
          Terms of Service
        </h1>
        <p className="text-sm mt-3" style={{ color: 'var(--bc-muted)' }}>
          Last updated: {LAST_UPDATED}
        </p>

        <div className="mt-10">
          {sections.map((section, i) => (
            <section
              key={section.title}
              className="pt-8 mt-8 border-t"
              style={{ borderColor: 'var(--bc-border)' }}
            >
              <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--bc-gold)' }}>
                {i + 1}. {section.title}
              </h2>
              {section.body.map((block, j) =>
                typeof block === 'string' ? (
                  <p key={j} className="mb-4">
                    {block}
                  </p>
                ) : (
                  <ul key={j} className="list-disc pl-6 mb-4 space-y-2">
                    {block.map((item, k) => (
                      <li key={k}>{item}</li>
                    ))}
                  </ul>
                )
              )}
            </section>
          ))}
        </div>

        <footer
          className="mt-12 pt-8 border-t text-sm flex flex-wrap gap-x-6 gap-y-2"
          style={{ borderColor: 'var(--bc-border)', color: 'var(--bc-muted)' }}
        >
          <Link href="/privacy" className="hover:underline" style={{ color: 'var(--bc-gold)' }}>
            Privacy Policy
          </Link>
          <Link href="/" className="hover:underline" style={{ color: 'var(--bc-gold)' }}>
            Home
          </Link>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="hover:underline"
            style={{ color: 'var(--bc-gold)' }}
          >
            {CONTACT_EMAIL}
          </a>
          <span>BuildChain Protocol, Inc.</span>
        </footer>
      </main>
    </div>
  )
}
