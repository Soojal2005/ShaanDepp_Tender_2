/**
 * Text of the three legal pages. English only: legal wording should not be machine-translated,
 * so the Hindi site shows these pages in English with a short notice.
 * It describes what the system actually does; have Shan-Deep's adviser review it before launch,
 * and bump NOTICE_VERSION (and the privacy_notice_version default) when the privacy text changes.
 */
export const NOTICE_VERSION = 'v2026.1';
export const LEGAL_UPDATED = '26 October 2026';

/** `{email}`, `{phone}`, `{business}` and `{gst}` are filled in from the site configuration. */
export const LEGAL = {
  privacy: {
    title: 'Privacy Policy',
    intro: 'This policy explains what personal data Shan-Deep Management Advisory ("Shan-Deep", "we") collects through this website and the tender portal, why we collect it, and the choices you have under the Digital Personal Data Protection Act, 2023.',
    sections: [
      { h: 'Who we are', p: ['Shan-Deep Management Advisory is an advisory firm based in Bhopal, Madhya Pradesh (business registration {business}; GST {gst}). We decide why and how your personal data is used.', 'The website and portal are built and operated for us by Synquic, which handles data only on our instructions.'] },
      { h: 'What we collect', list: [
        'Enquiry and access-request forms: your name, business name, email address, phone number (optional), message (optional), the language you were using, when you gave consent and which version of this notice you saw, and your IP address, which we use to prevent spam and abuse.',
        'Portal accounts: the name, work email and role of each user, a hashed password (we never store the password itself), sign-in sessions, and the activity recorded in our audit log.',
        'Portal content: the alert profiles, saved searches, watchlists, submission cases and documents that you or your colleagues add.',
        'In your browser: your language choice, and a secure session cookie while you are signed in. We do not use advertising or analytics trackers.',
      ] },
      { h: 'Why we use it', list: [
        'To reply to your enquiry and to decide on, set up and support a portal account.',
        'To run the portal for subscribers: tender alerts, weekly reports, search and the submission desk.',
        'To keep the service secure, prevent misuse and keep an audit trail.',
        'To meet our legal and accounting obligations.',
      ] },
      { h: 'Your consent', p: ['We use the details you give on our forms with your consent, which you give by ticking the consent box. You can withdraw it at any time by writing to {email}; withdrawing does not affect what we did before.'] },
      { h: 'Who we share it with', p: ['We do not sell personal data. We share it only with providers that help us run the service: cloud database hosting, and email delivery through Microsoft 365. Tender information comes from a licensed data supplier and no personal data is sent to it. If you use the WhatsApp or call buttons, your message or call is handled by WhatsApp or your phone provider under their own terms.'] },
      { h: 'How long we keep it', p: ['Enquiry and access-request details are kept only as long as we need them to respond and to set up an account. We review them and delete those we no longer need, and we delete them sooner if you ask. Portal data is kept while the subscription is active and for a reasonable period afterwards, unless you ask us to remove it.'] },
      { h: 'Security', p: ['Each client\'s data is kept separate from every other client\'s by the database itself. Connections are encrypted, passwords are stored only as salted hashes, and staff access is limited by role and recorded.'] },
      { h: 'Your rights', p: ['Under the Digital Personal Data Protection Act, 2023 you may ask us for a summary of the personal data we hold about you, to correct or complete it, to erase it, and to withdraw consent. You may also nominate someone to exercise these rights for you if you cannot.', 'Write to {email} or call {phone}. If we have not resolved your concern, you may complain to the Data Protection Board of India.'] },
      { h: 'Changes to this policy', p: ['When we change this policy we update this page and its version number. The version you accepted is stored with each form you send.'] },
    ],
  },
  terms: {
    title: 'Terms of Service',
    intro: 'These terms apply when you use the Shan-Deep website and tender portal. By using them you agree to these terms. If you do not agree, please do not use them.',
    sections: [
      { h: 'The website and the portal', p: ['The public website is open to everyone. The tender portal is for subscribers: accounts are created by our team after a request is approved, and each account belongs to one named person.'] },
      { h: 'Your account', list: [
        'Keep your password confidential and do not share your sign-in with anyone else.',
        'Tell us at once if you think someone else has used your account.',
        'Your plan sets how many users, alert profiles and alerts per email you can have. We may suspend an account that is misused or whose subscription has ended.',
      ] },
      { h: 'Acceptable use', list: [
        'Do not copy tender data or reports in bulk with scripts or other automated means.',
        'Do not resell, publish or pass on tender data, alerts or reports without our written permission.',
        'Do not try to get around security or to see another client\'s data.',
        'Do not upload anything unlawful or that you have no right to share.',
      ] },
      { h: 'Tender information', p: ['Tender details come from a licensed data feed and from files we upload, so they can be late, incomplete or change after publication. Always check the official tender document and the issuing department\'s portal before you bid. We do not guarantee that any bid will succeed.'] },
      { h: 'Advisory and filing services', p: ['Services such as bid preparation, GeM, company registration, certification and filings are provided under a separate arrangement. Fees and timelines depend on your case and are confirmed with you before work starts.'] },
      { h: 'Ownership', p: ['The website, portal, reports and their design belong to Shan-Deep or its licensors. Documents and information you add remain yours; you allow us to use them to provide the service to you.'] },
      { h: 'Our responsibility', p: ['We work to keep the service available and accurate, but to the extent the law allows, we are not responsible for indirect or consequential loss, or for loss caused by tender information that was late, incomplete or later changed.'] },
      { h: 'Changes and law', p: ['We may update these terms and will change the date on this page when we do. These terms are governed by the laws of India.'] },
      { h: 'Contact', p: ['Questions about these terms: {email} or {phone}.'] },
    ],
  },
  disclaimer: {
    title: 'Disclaimer',
    intro: 'Please read this together with our Terms of Service.',
    sections: [
      { h: 'General information only', p: ['Content on this website is general information. It is not legal, tax or financial advice. Fees and timelines depend on your case and are confirmed before you start.'] },
      { h: 'No government affiliation', p: ['Shan-Deep Management Advisory is a private firm. Ministry, department and public body names are listed only to show the coverage of the tenders we follow. They do not mean that we are connected with, approved by or acting for any of them.'] },
      { h: 'Sample tenders', p: ['The tenders shown on the home page are illustrative samples. They are not live opportunities and should not be used to bid.'] },
      { h: 'Tender data and analysis', p: ['Tender information and results come from a licensed feed and from files we upload. We show a figure only when the source published it: anything else appears as "Not disclosed" or "Rate not published", never as zero or an estimate. Statistics based on fewer than five records are withheld. Rate bands and trends describe past tenders; they are not a prediction or a promise of what will win.'] },
      { h: 'No guarantee of results', p: ['We help you find, prepare and submit tenders. The decision to award a contract belongs to the issuing authority, and we cannot guarantee that a bid, registration or certificate will be successful.'] },
      { h: 'Language', p: ['The Hindi version of the site is provided for convenience. If the two versions differ, the English text applies.'] },
    ],
  },
};
