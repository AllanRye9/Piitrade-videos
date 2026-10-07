import LegalLayout from './LegalLayout';

export default function DmcaPage() {
  return (
    <LegalLayout title="Copyright & DMCA Policy" lastUpdated="[DATE]">
      <p>
        Piitrade respects the intellectual property rights of others and expects users of Piitrade Videos to do the
        same. This policy explains how to report content you believe infringes your copyright, and how a user can
        respond to a claim made against their content.
      </p>

      <h2>1. In-app reporting vs. a formal copyright claim</h2>
      <p>
        Any video can be flagged using the in-app <strong>Report</strong> button, which places it in our moderation
        queue for review. For a formal copyright claim under the DMCA (or an equivalent process in your country), use
        the notice process below instead — it carries specific legal requirements the in-app report doesn't need to
        meet.
      </p>

      <h2>2. Filing a takedown notice</h2>
      <p>
        Send a notice to our designated agent (below) that includes:
      </p>
      <ul>
        <li>your physical or electronic signature;</li>
        <li>identification of the copyrighted work you claim is infringed;</li>
        <li>the specific video URL (e.g. <code>piitrade.com/v/...</code>) or other location of the material;</li>
        <li>your contact information (address, phone number, email);</li>
        <li>
          a statement that you have a good-faith belief the use is not authorized by the copyright owner, its agent,
          or the law;
        </li>
        <li>
          a statement, made under penalty of perjury, that the information in the notice is accurate and that you
          are the copyright owner or authorized to act on their behalf.
        </li>
      </ul>
      <p>
        Notices missing these elements may not be actionable. We may remove or disable access to the reported
        content and notify the uploader.
      </p>

      <h2>3. Counter-notice</h2>
      <p>
        If your content was removed and you believe this was a mistake or misidentification, you may submit a
        counter-notice including:
      </p>
      <ul>
        <li>your physical or electronic signature;</li>
        <li>identification of the removed content and where it appeared before removal;</li>
        <li>
          a statement, under penalty of perjury, that you have a good-faith belief the content was removed as a
          result of mistake or misidentification;
        </li>
        <li>your name, address, and phone number, and a statement consenting to the jurisdiction of the courts in [JURISDICTION].</li>
      </ul>
      <p>
        Upon a valid counter-notice, we may restore the content unless the original complainant informs us they've
        filed a court action seeking to restrain the uploader from the infringing activity.
      </p>

      <h2>4. Repeat infringers</h2>
      <p>We may suspend or terminate accounts found to be repeat infringers.</p>

      <h2>5. Designated agent</h2>
      <p>
        Copyright notices and counter-notices should be sent to:
        <br />
        [DESIGNATED AGENT NAME]
        <br />
        [ADDRESS]
        <br />
        <a href="mailto:[DMCA CONTACT EMAIL]">[DMCA CONTACT EMAIL]</a>
      </p>
    </LegalLayout>
  );
}
