// Drafted from standard consumer-app templates and tailored to what this app
// actually does. NOT reviewed by a lawyer — fine for launching a free app with
// no payments and no sensitive data, which is what this is. Get a real review
// before taking payments, handling health/financial data, or onboarding
// corporate users.
//
// THREE things here go stale fastest — check them whenever either doc changes:
//   1. LEGAL_LAST_UPDATED
//   2. SUPPORT_EMAIL (must be an inbox that is actually monitored — GDPR/CCPA
//      rights requests and DMCA notices arrive here)
//   3. The subprocessor list in "Who We Share It With" — add a row whenever a
//      new third-party service starts touching user data.
//
// This file is mirrored by hand in src/backend/backend/Controllers/
// LegalController.cs, which serves the public HTML versions that App Store
// Connect and Google Play require. THERE IS NO SHARED SOURCE — change one,
// change the other, or the in-app and hosted policies silently diverge.
export const LEGAL_LAST_UPDATED = "August 8, 2026";

// Rights requests, deletion requests, DMCA notices and support all land here.
// Must be a real, monitored inbox on the domain — if it bounces, the app is
// making a promise it can't keep in a legal document.
export const SUPPORT_EMAIL = "support@moviespaces.org";

// The operator named as data controller / service provider. An individual sole
// operator, not a company — say so plainly rather than implying a corporate
// entity that doesn't exist.
export const OPERATOR_NAME = "Olaoluwa Kayode";

// Governing law for the Terms. Set to the operator's own state of residence.
export const GOVERNING_JURISDICTION = "the State of Texas, United States";

export interface LegalSection {
  heading: string;
  body: string;
}

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "Agreement to These Terms",
    body:
      `MovieSpaces ("the app," "we," "us") is operated by ${OPERATOR_NAME}, an individual. By creating an account or using MovieSpaces, you agree to these Terms of Service. If you don't agree, please don't use the app. We may update these Terms as the app changes; we'll update the date shown at the top of this document, and continuing to use MovieSpaces after an update means you accept the revised Terms.`,
  },
  {
    heading: "Eligibility",
    body:
      `You must be at least 13 years old to use MovieSpaces. If you are under the age of majority where you live, you may only use the app with the involvement of a parent or guardian. By using MovieSpaces you confirm you meet these requirements and that you aren't barred from using the service under any applicable law.`,
  },
  {
    heading: "What MovieSpaces Is — and Isn't",
    body:
      `MovieSpaces helps you organize and join movie nights ("Spaces") — public gatherings at a theater, or private watch parties you coordinate with friends. We show showtime and cost-split information for convenience only. MovieSpaces does not sell tickets, process payments, hold funds, or act as a party to any venue booking or reservation. Any money, tickets, or bookings are handled entirely outside the app, between you and the venue or your group. Showtimes are entered by hosts and are not independently verified by us — always confirm details directly with the venue before you go.`,
  },
  {
    heading: "Your Account",
    body:
      `You're responsible for the accuracy of the information you provide (display name, username, profile photo, theater memberships) and for keeping your account credentials secure. You're responsible for activity that happens under your account. Tell us at ${SUPPORT_EMAIL} if you believe your account has been accessed without your permission.`,
  },
  {
    heading: "Your Content and Who Owns It",
    body:
      `You keep ownership of everything you create in MovieSpaces — your Spaces, messages, hangout notes, profile photo, and any other content you post. You grant us a non-exclusive, worldwide, royalty-free license to host, store, reproduce, and display that content only as needed to operate the app: showing your Space to its members, delivering your messages to their recipients, and displaying your profile to people you share a Space with. This license exists solely so the app can function, ends when you delete the content or your account, and does not let us sell your content, use it in advertising, or license it to anyone else.`,
  },
  {
    heading: "Acceptable Use",
    body:
      `Don't use MovieSpaces to post or send anything illegal, harassing, hateful, threatening, defamatory, sexually explicit, or that infringes someone else's rights. Don't impersonate anyone, scrape or bulk-download other users' data, probe or interfere with the app's security, use automated systems to create accounts or send messages, or use the app to advertise, spam, or run a scam. Don't create Spaces for events that don't exist or that you can't actually host.`,
  },
  {
    heading: "Objectionable Content and Enforcement",
    body:
      `There is no tolerance for objectionable content or abusive behavior on MovieSpaces. You can report a Space or a chat message from a Report action in the app, and you can block another user from a conversation or from your friends list — blocking hides their content from you. When content or a user is reported, we review it and act on violations — removing content, and suspending or removing the offending account — promptly, typically within 24 hours. Users who repeatedly violate these Terms will lose access to the app.`,
  },
  {
    heading: "Copyright and DMCA Notices",
    body:
      `We respect intellectual property rights and respond to valid notices under the Digital Millennium Copyright Act. If you believe content on MovieSpaces infringes your copyright, send a notice to ${SUPPORT_EMAIL} with: (1) your physical or electronic signature; (2) identification of the copyrighted work you claim was infringed; (3) identification of the material you claim is infringing and enough detail for us to locate it, such as the Space code or the approximate time a message was sent; (4) your address, telephone number, and email address; (5) a statement that you have a good-faith belief the use isn't authorized by the copyright owner, its agent, or the law; and (6) a statement, under penalty of perjury, that the information in your notice is accurate and that you are the copyright owner or authorized to act on their behalf. We will remove or disable access to material that is the subject of a valid notice and will notify the user who posted it. That user may submit a counter-notice containing the elements required by 17 U.S.C. § 512(g). We terminate the accounts of repeat infringers.`,
  },
  {
    heading: "Third-Party Services and Links",
    body:
      `MovieSpaces links out to services we don't control — Google search results for showtimes, ticketing sites such as Fandango, theater websites, and links pasted by hosts. We don't endorse, verify, or take responsibility for those sites or anything you do on them, and their own terms and privacy policies apply. Movie and TV information is provided by OMDb and theater information by Google Places; we don't guarantee it's accurate or current. Be careful before entering personal or payment information on any link a host has added to a Space.`,
  },
  {
    heading: "Service Availability and Changes",
    body:
      `We may change, suspend, or discontinue any part of MovieSpaces at any time, including features you rely on. The app runs on hosted infrastructure and may be unavailable during maintenance or outages. We don't guarantee any level of uptime, and we're not liable for data or plans lost because the service was unavailable.`,
  },
  {
    heading: "Termination",
    body:
      `You can delete your account at any time from Profile → Delete Account, or by emailing ${SUPPORT_EMAIL}. We may suspend or terminate accounts that violate these Terms, abuse other users, misuse the reporting or blocking system, or create legal risk for us or other users. Sections that by their nature should survive termination — content licenses already granted for content you haven't deleted, disclaimers, limitation of liability, indemnification, and governing law — survive.`,
  },
  {
    heading: "Disclaimers",
    body:
      `MovieSpaces is provided "as is" and "as available," without warranties of any kind, whether express, implied, or statutory, including any implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement. We don't warrant that the app will be uninterrupted, secure, or error-free, or that any information in it — including host-entered showtimes, venue details, costs, or movie data — is accurate or complete. We are not responsible for the conduct of other users, online or in person, and MovieSpaces is not a party to and does not supervise any in-person gathering organized through it. Some jurisdictions don't allow the exclusion of implied warranties, so some of these exclusions may not apply to you.`,
  },
  {
    heading: "Limitation of Liability",
    body:
      `To the fullest extent permitted by law, ${OPERATOR_NAME} will not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for any loss of profits, data, goodwill, or business opportunity, arising out of or relating to your use of MovieSpaces — even if we've been advised such damages are possible. To the fullest extent permitted by law, our total liability for all claims relating to the app is limited to the greater of the amount you paid us in the twelve months before the claim (which, for a free app, is zero) or twenty-five US dollars. This limitation applies to all theories of liability, whether contract, tort, or otherwise. Some jurisdictions don't allow certain limitations, so parts of this section may not apply to you.`,
  },
  {
    heading: "Indemnification",
    body:
      `You agree to indemnify and hold harmless ${OPERATOR_NAME} from any claims, damages, losses, liabilities, and reasonable legal fees arising out of your content, your use or misuse of MovieSpaces, your violation of these Terms, or your violation of anyone else's rights — including anything arising from an in-person gathering you organize or attend.`,
  },
  {
    heading: "Governing Law and Disputes",
    body:
      `These Terms are governed by the laws of ${GOVERNING_JURISDICTION}, without regard to its conflict-of-law rules. You and we agree that any dispute will be brought in the state or federal courts located there, and we each consent to their jurisdiction. If you're a consumer in the European Union, United Kingdom, or another jurisdiction whose law gives you the right to bring claims locally, nothing here removes that right. Before filing anything, please email ${SUPPORT_EMAIL} — nearly everything can be resolved that way.`,
  },
  {
    heading: "Apple and Google App Store Terms",
    body:
      `If you downloaded MovieSpaces from the Apple App Store or Google Play, you also agree to that store's own terms. These Terms are between you and ${OPERATOR_NAME} only — not Apple or Google. Apple and Google have no obligation to provide support or maintenance for MovieSpaces, and are not responsible for any claim relating to the app, including product liability, legal compliance, or intellectual property claims. Apple and its subsidiaries are third-party beneficiaries of these Terms and may enforce them against you. You confirm you aren't located in a country subject to a US Government embargo or designated as terrorist-supporting, and that you're not on any US Government restricted-parties list.`,
  },
  {
    heading: "Miscellaneous",
    body:
      `These Terms, together with the Privacy Policy, are the entire agreement between you and us about MovieSpaces. If any provision is found unenforceable, the rest stays in effect. Our not enforcing a provision isn't a waiver of it. You may not transfer your rights under these Terms; we may transfer ours in connection with a merger, acquisition, or sale of assets.`,
  },
  {
    heading: "Contact",
    body: `Questions about these Terms? Email ${SUPPORT_EMAIL}.`,
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "Who We Are",
    body:
      `MovieSpaces is operated by ${OPERATOR_NAME}, an individual based in ${GOVERNING_JURISDICTION}. For users in the European Economic Area and the United Kingdom, ${OPERATOR_NAME} is the "data controller" for the personal data described in this policy. This policy explains what we collect, why, who we share it with, and the rights you have over it. Questions or requests: ${SUPPORT_EMAIL}.`,
  },
  {
    heading: "What We Collect",
    body:
      `Account information: your email address, display name, username, and profile photo. You sign in with an email address and password, handled through Supabase Auth, which stores your password in hashed form we never see. If we later offer sign-in with Apple or Google, we would receive your email address and name from that provider — never your password. Content you create: Spaces you host or join, group chat messages, direct messages, hangout notes, and the theater memberships you select. Your friend connections and the block and report records you create. Device location, only if you grant permission, used to find nearby theaters and show distances — we use it in the moment and don't build a location history. A push notification token, only if you grant permission, so we can send booking updates, reminders, and new-message alerts. Technical data collected automatically when the app talks to our servers: IP address, device and operating system type, app version, and timestamps, kept in server logs. Diagnostics: crash reports and error traces, including the device model, OS version, and app state at the time of the error, collected through Sentry so we can fix bugs.`,
  },
  {
    heading: "What We Don't Collect",
    body:
      `We don't collect payment or financial information — MovieSpaces takes no payments. We don't collect precise contact lists, health data, biometrics, or government identifiers. We don't use advertising SDKs, we don't track you across other companies' apps or websites, and we don't build advertising profiles. We never sell your personal information.`,
  },
  {
    heading: "How We Use It",
    body:
      `To run the app's core features: creating and joining Spaces, group and direct messaging, RSVPs, showtime reminders, nearby-theater search, the CineMind daily puzzle and its leaderboards, and keeping your profile in sync across devices. To keep the service safe: reviewing reports, enforcing blocks, preventing spam and abuse, and rate-limiting requests. To fix problems: diagnosing crashes and errors. To communicate with you: account emails such as sign-up confirmation and password resets, and push notifications you've opted into. We don't use your data for advertising or automated decision-making that produces legal or similarly significant effects.`,
  },
  {
    heading: "Legal Bases for Processing (EEA and UK)",
    body:
      `If you're in the EEA or UK, we process your personal data on these bases. Performance of a contract: providing the account, Spaces, messaging, and other features you asked for. Consent: device location, push notifications, and photo library access — each requested through your device's permission prompt, and each revocable at any time in your device settings, with no effect on processing that already happened. Legitimate interests: keeping the service secure and abuse-free, fixing bugs, and understanding crashes — balanced against your rights and limited to what's necessary. Legal obligation: retaining or disclosing information where the law requires it.`,
  },
  {
    heading: "Who We Share It With",
    body:
      `Other users: people in a Space can see your display name, username, profile photo, and RSVP status. Group chat messages are visible to everyone in that Space. Direct messages are visible only to you and the person you're messaging. CineMind leaderboards show your display name and score to other players. Service providers who process data only on our instructions and only to run the app: Supabase (accounts, database, chat storage, profile photo storage), Render (API hosting and server logs), Sentry (crash and error reporting), Resend (transactional email such as password resets), Expo (push notification delivery), Google Places (theater search — a search query and, if permitted, approximate location), OMDb (movie and TV information — title searches only, no personal data), and Apple and Google (only if you choose to sign in with them). Legal and safety: we may disclose information if required by law or valid legal process, or where we believe in good faith it's necessary to protect someone's safety or investigate abuse. Business transfer: if the app is ever transferred to someone else, your information may transfer with it, and this policy will continue to apply until you're told otherwise. We do not sell your personal information and we don't share it for cross-context behavioral advertising.`,
  },
  {
    heading: "International Data Transfers",
    body:
      `Our infrastructure providers store and process data on servers in the United States. If you use MovieSpaces from the EEA, the UK, or elsewhere outside the US, your information will be transferred to and processed in the US, which may have different data protection laws than your country. Where required, our providers rely on the European Commission's Standard Contractual Clauses or an equivalent transfer mechanism to protect that data.`,
  },
  {
    heading: "Your Rights (EEA, UK, and elsewhere)",
    body:
      `Depending on where you live, you may have the right to: access the personal data we hold about you; correct inaccurate data; delete your data; restrict or object to certain processing; receive your data in a portable, machine-readable format; and withdraw consent you previously gave, at any time. Many of these you can exercise directly in the app — edit your profile from the Profile tab, revoke location or notification permissions in your device settings, and delete everything from Profile → Delete Account. For anything else, email ${SUPPORT_EMAIL} and we'll respond within 30 days. You won't be charged or treated differently for exercising these rights. If you're in the EEA or UK and think we've handled your data improperly, you also have the right to complain to your local data protection authority.`,
  },
  {
    heading: "Your California Privacy Rights",
    body:
      `If you're a California resident, the CCPA as amended by the CPRA gives you the right to know what personal information we collect and how we use and disclose it (described throughout this policy), the right to delete it, the right to correct inaccurate information, and the right to opt out of its sale or sharing. We do not sell personal information and we do not share it for cross-context behavioral advertising, so there is nothing to opt out of — and we have not sold or shared personal information in the preceding twelve months. We don't knowingly collect or sell the personal information of anyone under 16. Exercise any of these rights in the app or by emailing ${SUPPORT_EMAIL}; we may need to verify your identity through the email address on your account before acting. You may use an authorized agent, who will need written permission from you. We will not deny you service, charge you a different price, or provide a lesser quality of service for exercising your rights. The categories we collect map to the CCPA's categories as follows: identifiers (email, name, username, user ID, IP address), internet or network activity (app interactions and error logs), geolocation data (only with permission), and audio/visual data (a profile photo, only if you upload one). We collect these for the business purposes described in "How We Use It."`,
  },
  {
    heading: "Deleting Your Account and Data",
    body:
      `You can permanently delete your account at any time from Profile → Delete Account inside the app — no email required and no waiting period. You can also request deletion by emailing ${SUPPORT_EMAIL} from your account's email address. Deleting your account removes your profile, your chat messages, your friend connections, and your push notification token, and deletes any Spaces you host — those disappear for their other members too, exactly as if you'd deleted each Space manually. Spaces you only joined stay intact for the remaining members; you're simply removed from them. Deletion takes effect immediately and cannot be undone. Backups and server logs may retain some data for up to 30 days before they cycle out, and we may keep the minimum records needed to comply with a legal obligation or to enforce a prior ban.`,
  },
  {
    heading: "Data Retention",
    body:
      `We keep your account data for as long as your account exists. Server logs containing IP addresses are retained for a short period for security and debugging and then rotated out. Crash and error reports are retained by Sentry for up to 90 days. Reports you file about content or users are kept while we review them and for a period afterward so we can identify repeat offenders. Cancelled Spaces remain visible to their members for reference unless the host deletes them.`,
  },
  {
    heading: "Security",
    body:
      `All traffic between the app and our servers is encrypted in transit with HTTPS. Passwords are hashed by Supabase Auth and are never visible to us. Access to the database is restricted by row-level security rules so that, for example, direct messages are readable only by the two people in the conversation. No system is perfectly secure, and we can't guarantee absolute security — but if a breach affects your personal data, we'll notify you and any relevant regulator as required by law.`,
  },
  {
    heading: "Reporting and Blocking",
    body:
      `If you report a Space or a chat message, we store the report — who filed it, what was reported, and any reason given — so we can review and act on it. Reports are not visible to other users, and we don't tell the reported person who filed the report. Blocking another user hides their content from you and doesn't notify them.`,
  },
  {
    heading: "Children's Privacy",
    body:
      `MovieSpaces is not directed to children under 13, and we don't knowingly collect personal information from them. If you believe a child under 13 has created an account, email ${SUPPORT_EMAIL} and we'll delete the account and its data promptly.`,
  },
  {
    heading: "Changes to This Policy",
    body:
      `We may update this Privacy Policy as MovieSpaces changes. When we do, we'll update the "Last updated" date at the top. If a change materially affects how we use your personal data, we'll give you notice in the app or by email before it takes effect.`,
  },
  {
    heading: "Contact",
    body:
      `Questions about this policy, or want to exercise any of the rights above? Email ${SUPPORT_EMAIL} and we'll respond within 30 days.`,
  },
];
