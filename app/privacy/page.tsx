import type { Metadata } from 'next'
import Link from 'next/link'
import { BuildChainLogo } from '@/components/shared/BuildChainLogo'

export const metadata: Metadata = {
  title: 'Privacy Policy | BuildChain Protocol',
  description:
    'What information BuildChain Protocol, Inc. collects, why, who it is shared with, and what is recorded on the public XRP Ledger.',
}

const LAST_UPDATED = 'November 27, 2026'
const CONTACT_EMAIL = 'info@buildchain.finance'

// A block is either a paragraph (string) or a bulleted list (string[]).
type Block = string | string[]
type Section = { title: string; body: Block[] }

const sections: Section[] = [
  {
    title: 'Who we are and what this policy covers',
    body: [
      'BuildChain Protocol, Inc. (“BuildChain™,” “we,” “us”) is a Delaware corporation. We run a construction-loan draw platform for lenders, borrowers, contractors and inspectors. The platform records draw approvals, inspections and lien waivers on the XRP Ledger.',
      'This policy explains what information we collect when you visit https://www.buildchain.finance or use the platform (together, the “service”), why we collect it, who we share it with, and the choices you have.',
      'The service is for businesses and their staff in the United States. If you do not agree with this policy, please do not use the service.',
    ],
  },
  {
    title: 'The service is a pilot',
    body: [
      'The service is in a pilot that runs on the XRP Ledger test network. No real funds move through the service today, and we do not charge fees during the pilot. We do not collect payment-card data.',
      'If that changes, we will update this policy before the change takes effect.',
    ],
  },
  {
    title: 'Information we collect',
    body: [
      'Information you or your company give us:',
      [
        'Account details: your email address, name, company name and role (for example lender, borrower, contractor or inspector).',
        'Lender and borrower records: contact name, phone number, and contractor licence number and licence state.',
        'Loan and project information: project address, loan amount, budgets, draw requests, documents you upload, and inspection notes and photos if they are uploaded.',
        'Wallet addresses: the public XRP Ledger wallet addresses used with a loan. We never receive or store your private keys or wallet secret.',
        'Messages: what you send us when you email us.',
      ],
      'Information recorded as you use the service:',
      [
        'An activity log of actions taken in the platform, such as who submitted, approved or signed something and when.',
        'Standard server logs, such as IP address, browser type, the pages or endpoints requested, and the time of each request.',
      ],
      'Passwords are handled by our authentication provider. BuildChain staff cannot see your password.',
      'Please do not upload documents that contain personal information the service does not need, such as Social Security numbers or bank account numbers.',
    ],
  },
  {
    title: 'How we use information',
    body: [
      'We use the information described above to:',
      [
        'Run the service: create and manage accounts, loans, draw requests, inspections and lien waivers.',
        'Show each loan to the lender, borrower, contractor and inspector who work on it.',
        'Record draw approvals, inspections and lien waivers on the XRP Ledger.',
        'Send service emails, such as account messages and notices about a draw.',
        'Answer your questions and requests.',
        'Keep the service secure, find and fix problems, and prevent fraud and misuse.',
        'Improve the service.',
        'Comply with the law and respond to lawful requests.',
      ],
    ],
  },
  {
    title: 'What goes on the public XRP Ledger',
    body: [
      'The XRP Ledger is a public network. Anyone can read what is recorded on it.',
      'When a draw approval, inspection or lien waiver is recorded, the service writes a transaction record or an NFT record to the ledger. Those records contain internal draw or inspection ID numbers, dollar amounts and timestamps. They are tied to the public wallet addresses that sent or received them. We do not put names or contact details in ledger records.',
      'Ledger records are public and permanent. Nobody can delete or change them, including BuildChain. If you ask us to delete your information, we can delete what is held in our own systems, but we cannot remove anything already recorded on the ledger.',
      'During the pilot these records are written to the XRP Ledger test network. The operators of that network may reset it, which is outside our control.',
    ],
  },
  {
    title: 'Who we share information with',
    body: [
      'We do not sell, rent or trade your personal information. We share it only in these cases:',
      [
        'Other people on the same loan. The lender, borrower, contractor and inspector on a loan can see the loan and project information they need for their part of the work.',
        'Supabase: database, authentication and file storage.',
        'Vercel: website and application hosting.',
        'Resend: delivery of service emails.',
        'Xaman: wallet signing requests. When you are asked to sign in your wallet, the request is sent through Xaman. The Xaman wallet app is run by its own company under its own terms and privacy policy.',
        'The XRP Ledger network: the public records described in the section above.',
        'Building Block (bblock.build): a construction-management product owned by BuildChain Protocol, Inc. For projects that connect the two products, BuildChain and Building Block exchange draw, inspection and lien-waiver information.',
        'Professional advisers, such as our attorneys and accountants, who are bound to keep the information confidential.',
        'When the law requires it, such as a court order, or when needed to protect the rights, property or safety of BuildChain, our users or the public.',
        'A business transfer. If BuildChain is involved in a merger, acquisition, financing or sale of assets, information may be transferred as part of it. We will tell you if ownership of your information changes.',
        'With your consent, for any other purpose.',
      ],
    ],
  },
  {
    title: 'Cookies',
    body: [
      'We use only the cookies needed to keep you signed in. We do not use advertising cookies or tracking cookies.',
      'You can block cookies in your browser settings, but you will not be able to stay signed in to the platform if you do.',
    ],
  },
  {
    title: 'How long we keep information',
    body: [
      'We keep account, loan and project information for as long as your account or your company’s account is open, and afterwards for as long as we need it to keep proper business records, resolve disputes or meet legal obligations.',
      'When we no longer need information, we delete it or remove the details that identify you. You can ask us to delete information sooner (see “Your choices and requests” below).',
      'Records on the XRP Ledger are not held by us and cannot be deleted by anyone.',
    ],
  },
  {
    title: 'Security',
    body: [
      'We use access controls and encryption in transit to protect the information in our systems.',
      'No system is completely secure, and we cannot guarantee absolute security. If you think your account or information has been compromised, email us right away at ' +
        CONTACT_EMAIL +
        '.',
    ],
  },
  {
    title: 'Your choices and requests',
    body: [
      'You can ask us to:',
      [
        'Tell you what personal information we hold about you and give you a copy.',
        'Correct information that is wrong.',
        'Delete your personal information.',
      ],
      'To make a request, email ' +
        CONTACT_EMAIL +
        '. We may need to confirm who you are before we act. We aim to respond within 45 days.',
      'Some limits apply. We may keep information that we are required by law to keep or that we need to resolve a dispute. Loan records may belong to the lender or company that set up the loan, and we may need to check with them. We cannot delete or change records on the XRP Ledger.',
      'We will not treat you unfairly for making a request.',
    ],
  },
  {
    title: 'California and other state residents',
    body: [
      'California law, and the laws of some other states, give residents rights to know what personal information a business has collected about them, to have it corrected or deleted, and not to be discriminated against for using those rights. Whether a given law applies depends on the business and the situation. We will honour a verified request to the extent the law that applies to us requires.',
      'BuildChain does not sell personal information and does not share it for cross-context behavioural advertising.',
      'To make a request, email ' + CONTACT_EMAIL + '.',
    ],
  },
  {
    title: 'Links and third-party services',
    body: [
      'The service may link to websites and tools we do not run, such as XRP Ledger explorers and the Xaman wallet. This policy does not cover them. Please read their own privacy policies. We are not responsible for how they handle your information.',
    ],
  },
  {
    title: 'Children',
    body: [
      'The service is for business users who are 18 or older. It is not directed to children, and we do not knowingly collect personal information from anyone under 18. If you believe a minor has given us personal information, email ' +
        CONTACT_EMAIL +
        ' and we will delete it.',
    ],
  },
  {
    title: 'Changes to this policy',
    body: [
      'We may update this policy as the service, the technology or the law changes. When we do, we will change the “Last updated” date at the top of this page. If a change is significant, we will also tell you by email or with a notice on the site.',
      'If you keep using the service after an update takes effect, the updated policy applies to you.',
    ],
  },
  {
    title: 'Contact us',
    body: [
      'Questions or requests about this policy or your information: BuildChain Protocol, Inc., ' +
        CONTACT_EMAIL +
        '.',
    ],
  },
]

export default function PrivacyPage() {
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
          Privacy Policy
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
          <Link href="/terms" className="hover:underline" style={{ color: 'var(--bc-gold)' }}>
            Terms of Service
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
