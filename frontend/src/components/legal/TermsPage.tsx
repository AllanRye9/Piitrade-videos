import LegalLayout from './LegalLayout';

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="[DATE]">
      <p>
        These Terms of Service ("Terms") govern your use of Piitrade Videos (the "Service"), operated by{' '}
        <strong>[LEGAL ENTITY NAME]</strong> ("Piitrade," "we," "us"). By creating an account or otherwise using the
        Service, you agree to these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old, or the age of legal majority in your jurisdiction, to create an account.
        By registering, you represent that you meet this requirement.
      </p>

      <h2>2. Your account</h2>
      <p>
        An account is required to upload videos, comment, follow creators, or complete a purchase. You're
        responsible for keeping your password confidential and for all activity under your account. You may set a
        public handle, display name, avatar, and bio; your handle is visible to other users at a public profile URL
        (<code>piitrade.com/u/your-handle</code>).
      </p>

      <h2>3. Content you post</h2>
      <p>
        You retain ownership of videos, comments, and other content you upload ("Your Content"). By posting Your
        Content, you grant Piitrade a worldwide, non-exclusive, royalty-free license to host, store, reproduce,
        display, and distribute it solely for the purpose of operating and promoting the Service (for example,
        showing your video in the feed, generating a thumbnail, or displaying it on your public profile).
      </p>
      <p>You agree not to upload content that:</p>
      <ul>
        <li>infringes someone else's intellectual property or other rights;</li>
        <li>is unlawful, fraudulent, or misrepresents a product for sale;</li>
        <li>is spam, or artificially inflates views, likes, follows, or comments;</li>
        <li>violates any applicable law, including consumer-protection or advertising law.</li>
      </ul>
      <p>
        We may remove content or suspend accounts that violate these Terms, based on our own review or on reports
        submitted through the in-app report feature. See our{' '}
        <a href="/legal/dmca">Copyright &amp; DMCA Policy</a> for copyright-specific takedowns.
      </p>

      <h2>4. Shopping through the Service</h2>
      <p>
        Piitrade Videos lets you discover products shown in videos and complete a purchase through the Piitrade
        Marketplace. Placing an order requires a separate Piitrade Marketplace account and is subject to the
        Marketplace's own terms, pricing, payment, shipping, and returns policies. Piitrade Videos is not the seller
        of record for marketplace purchases and is not responsible for order fulfillment, except as the Marketplace's
        own policies provide.
      </p>

      <h2>5. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate your account for violating these
        Terms, including repeated or serious content violations.
      </p>

      <h2>6. Disclaimers and limitation of liability</h2>
      <p>
        The Service is provided "as is" without warranties of any kind. To the maximum extent permitted by law,
        Piitrade is not liable for indirect, incidental, or consequential damages arising from your use of the
        Service.
      </p>

      <h2>7. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use of the Service after a change takes effect
        constitutes acceptance of the revised Terms.
      </p>

      <h2>8. Governing law</h2>
      <p>These Terms are governed by the laws of [JURISDICTION], without regard to conflict-of-law principles.</p>

      <h2>9. Contact</h2>
      <p>
        Questions about these Terms can be sent to <a href="mailto:[CONTACT EMAIL]">[CONTACT EMAIL]</a>.
      </p>
    </LegalLayout>
  );
}
