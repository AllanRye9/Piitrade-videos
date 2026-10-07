import LegalLayout from './LegalLayout';

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="[DATE]">
      <p>
        This Privacy Policy explains what information Piitrade Videos ("the Service," "we," "us") collects, how we
        use it, and the choices you have. It's written to reflect what the Service actually does, not generic
        boilerplate — if a feature described here doesn't exist yet, it isn't listed.
      </p>

      <h2>1. Information we collect</h2>
      <p>
        <strong>Account information.</strong> If you create an account: your email address and password (stored as a
        one-way hash, never in plain text). Optionally: a display name, public handle, avatar, and bio.
      </p>
      <p>
        <strong>Content you provide.</strong> Videos you upload, comments, and any text you enter (including in
        captions, which may contain hashtags you choose to add).
      </p>
      <p>
        <strong>Usage and device identifiers.</strong> Before — and independently of — creating an account, your
        browser is assigned a random session identifier, stored in your browser's local storage, used to remember
        things like videos you've liked or saved, your mute preference, and which onboarding hints you've already
        seen. This identifier is not itself your name or email; it becomes linked to your account only once you sign
        up or log in.
      </p>
      <p>
        <strong>Activity data.</strong> Likes, saves, follows, comments, shares, and views are recorded against the
        relevant session/account so the Service can display counts and personalize what you see.
      </p>

      <h2>2. How we use this information</h2>
      <ul>
        <li>To operate core features: the video feed, uploads, comments, follows, and notifications;</li>
        <li>To let you recover access to your account (password reset) and keep your handle/videos across devices;</li>
        <li>To connect you to the Piitrade Marketplace when you choose to make a purchase;</li>
        <li>To review content reported through the in-app report feature;</li>
        <li>To maintain the security and reliability of the Service, including rate-limiting abuse.</li>
      </ul>

      <h2>3. Sharing</h2>
      <p>We don't sell your personal information. We share limited data with:</p>
      <ul>
        <li>
          <strong>The Piitrade Marketplace</strong> — only if and when you choose to make a purchase, at which point
          the Marketplace's own privacy policy governs the information you provide it directly;
        </li>
        <li>
          <strong>Service providers</strong> who help us operate the Service (for example, media storage/CDN, email
          delivery for password resets, and an AI service used to identify products in a cropped video frame when
          you use visual search) — each only for that specific purpose;
        </li>
        <li>Authorities, where required by law.</li>
      </ul>

      <h2>4. Your choices</h2>
      <ul>
        <li>You can edit or remove your display name, avatar, and bio at any time in Settings;</li>
        <li>You can delete individual videos and comments you've posted;</li>
        <li>You can request deletion of your account by contacting us (see below);</li>
        <li>You can clear your browser's local storage to reset your anonymous session identifier at any time.</li>
      </ul>

      <h2>5. Data retention</h2>
      <p>
        We keep account and content data for as long as your account is active. If you delete your account, we
        remove personal identifiers within a reasonable period, except where retention is required for legal,
        security, or fraud-prevention reasons.
      </p>

      <h2>6. Children's privacy</h2>
      <p>
        The Service is not directed at children under 18 and we do not knowingly collect personal information from
        them. If you believe a minor has created an account, contact us and we will take appropriate action.
      </p>

      <h2>7. International users</h2>
      <p>
        If you're located outside [PRIMARY OPERATING COUNTRY], your information may be processed in a country with
        different data protection laws than your own.
      </p>

      <h2>8. Changes to this policy</h2>
      <p>We'll update the "Last updated" date above when this policy changes, and post the revised version here.</p>

      <h2>9. Contact</h2>
      <p>
        Questions, or a request to access or delete your data, can be sent to{' '}
        <a href="mailto:[CONTACT EMAIL]">[CONTACT EMAIL]</a>.
      </p>
    </LegalLayout>
  );
}
