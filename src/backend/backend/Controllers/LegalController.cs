using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Net;
using System.Text;

namespace Backend.Controllers
{
    // Public, unauthenticated HTML versions of the in-app legal screens
    // (legal/terms.tsx, legal/privacy.tsx). App Store Connect requires a real
    // public URL for the privacy policy at submission — the in-app screen
    // alone doesn't satisfy that, since it's only reachable after installing
    // the app.
    //
    // Content here is a hand-kept copy of src/frontend/constants/legal.ts,
    // not a shared source — there's no build step linking a TS constants file
    // into this .NET project. If the policy text changes, update both. Each
    // section below is commented with which TS section it mirrors so the two
    // don't quietly drift.
    [ApiController]
    public class LegalController : ControllerBase
    {
        private const string SupportEmail = "support@moviespaces.org";
        private const string LastUpdated = "August 8, 2026";

        private static readonly (string Heading, string Body)[] TermsSections =
        {
            ("Agreement to These Terms",
                "MovieSpaces (\"the app,\" \"we,\" \"us\") is operated by Olaoluwa Kayode, an individual. By creating an account or using MovieSpaces, you agree to these Terms of Service. If you don't agree, please don't use the app. We may update these Terms as the app changes; we'll update the date shown at the top of this document, and continuing to use MovieSpaces after an update means you accept the revised Terms."),
            ("Eligibility",
                "You must be at least 13 years old to use MovieSpaces. If you are under the age of majority where you live, you may only use the app with the involvement of a parent or guardian. By using MovieSpaces you confirm you meet these requirements and that you aren't barred from using the service under any applicable law."),
            ("What MovieSpaces Is — and Isn't",
                "MovieSpaces helps you organize and join movie nights (\"Spaces\") — public gatherings at a theater, or private watch parties you coordinate with friends. We show showtime and cost-split information for convenience only. MovieSpaces does not sell tickets, process payments, hold funds, or act as a party to any venue booking or reservation. Any money, tickets, or bookings are handled entirely outside the app, between you and the venue or your group. Showtimes are entered by hosts and are not independently verified by us — always confirm details directly with the venue before you go."),
            ("Your Account",
                "You're responsible for the accuracy of the information you provide (display name, username, profile photo, theater memberships) and for keeping your account credentials secure. You're responsible for activity that happens under your account. Tell us at support@moviespaces.org if you believe your account has been accessed without your permission."),
            ("Your Content and Who Owns It",
                "You keep ownership of everything you create in MovieSpaces — your Spaces, messages, hangout notes, profile photo, and any other content you post. You grant us a non-exclusive, worldwide, royalty-free license to host, store, reproduce, and display that content only as needed to operate the app: showing your Space to its members, delivering your messages to their recipients, and displaying your profile to people you share a Space with. This license exists solely so the app can function, ends when you delete the content or your account, and does not let us sell your content, use it in advertising, or license it to anyone else."),
            ("Acceptable Use",
                "Don't use MovieSpaces to post or send anything illegal, harassing, hateful, threatening, defamatory, sexually explicit, or that infringes someone else's rights. Don't impersonate anyone, scrape or bulk-download other users' data, probe or interfere with the app's security, use automated systems to create accounts or send messages, or use the app to advertise, spam, or run a scam. Don't create Spaces for events that don't exist or that you can't actually host."),
            ("Objectionable Content and Enforcement",
                "There is no tolerance for objectionable content or abusive behavior on MovieSpaces. You can report a Space or a chat message from a Report action in the app, and you can block another user from a conversation or from your friends list — blocking hides their content from you. When content or a user is reported, we review it and act on violations — removing content, and suspending or removing the offending account — promptly, typically within 24 hours. Users who repeatedly violate these Terms will lose access to the app."),
            ("Copyright and DMCA Notices",
                "We respect intellectual property rights and respond to valid notices under the Digital Millennium Copyright Act. If you believe content on MovieSpaces infringes your copyright, send a notice to support@moviespaces.org with: (1) your physical or electronic signature; (2) identification of the copyrighted work you claim was infringed; (3) identification of the material you claim is infringing and enough detail for us to locate it, such as the Space code or the approximate time a message was sent; (4) your address, telephone number, and email address; (5) a statement that you have a good-faith belief the use isn't authorized by the copyright owner, its agent, or the law; and (6) a statement, under penalty of perjury, that the information in your notice is accurate and that you are the copyright owner or authorized to act on their behalf. We will remove or disable access to material that is the subject of a valid notice and will notify the user who posted it. That user may submit a counter-notice containing the elements required by 17 U.S.C. § 512(g). We terminate the accounts of repeat infringers."),
            ("Third-Party Services and Links",
                "MovieSpaces links out to services we don't control — Google search results for showtimes, ticketing sites such as Fandango, theater websites, and links pasted by hosts. We don't endorse, verify, or take responsibility for those sites or anything you do on them, and their own terms and privacy policies apply. Movie and TV information is provided by OMDb and theater information by Google Places; we don't guarantee it's accurate or current. Be careful before entering personal or payment information on any link a host has added to a Space."),
            ("Service Availability and Changes",
                "We may change, suspend, or discontinue any part of MovieSpaces at any time, including features you rely on. The app runs on hosted infrastructure and may be unavailable during maintenance or outages. We don't guarantee any level of uptime, and we're not liable for data or plans lost because the service was unavailable."),
            ("Termination",
                "You can delete your account at any time from Profile → Delete Account, or by emailing support@moviespaces.org. We may suspend or terminate accounts that violate these Terms, abuse other users, misuse the reporting or blocking system, or create legal risk for us or other users. Sections that by their nature should survive termination — content licenses already granted for content you haven't deleted, disclaimers, limitation of liability, indemnification, and governing law — survive."),
            ("Disclaimers",
                "MovieSpaces is provided \"as is\" and \"as available,\" without warranties of any kind, whether express, implied, or statutory, including any implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement. We don't warrant that the app will be uninterrupted, secure, or error-free, or that any information in it — including host-entered showtimes, venue details, costs, or movie data — is accurate or complete. We are not responsible for the conduct of other users, online or in person, and MovieSpaces is not a party to and does not supervise any in-person gathering organized through it. Some jurisdictions don't allow the exclusion of implied warranties, so some of these exclusions may not apply to you."),
            ("Limitation of Liability",
                "To the fullest extent permitted by law, Olaoluwa Kayode will not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for any loss of profits, data, goodwill, or business opportunity, arising out of or relating to your use of MovieSpaces — even if we've been advised such damages are possible. To the fullest extent permitted by law, our total liability for all claims relating to the app is limited to the greater of the amount you paid us in the twelve months before the claim (which, for a free app, is zero) or twenty-five US dollars. This limitation applies to all theories of liability, whether contract, tort, or otherwise. Some jurisdictions don't allow certain limitations, so parts of this section may not apply to you."),
            ("Indemnification",
                "You agree to indemnify and hold harmless Olaoluwa Kayode from any claims, damages, losses, liabilities, and reasonable legal fees arising out of your content, your use or misuse of MovieSpaces, your violation of these Terms, or your violation of anyone else's rights — including anything arising from an in-person gathering you organize or attend."),
            ("Governing Law and Disputes",
                "These Terms are governed by the laws of the State of Texas, United States, without regard to its conflict-of-law rules. You and we agree that any dispute will be brought in the state or federal courts located there, and we each consent to their jurisdiction. If you're a consumer in the European Union, United Kingdom, or another jurisdiction whose law gives you the right to bring claims locally, nothing here removes that right. Before filing anything, please email support@moviespaces.org — nearly everything can be resolved that way."),
            ("Apple and Google App Store Terms",
                "If you downloaded MovieSpaces from the Apple App Store or Google Play, you also agree to that store's own terms. These Terms are between you and Olaoluwa Kayode only — not Apple or Google. Apple and Google have no obligation to provide support or maintenance for MovieSpaces, and are not responsible for any claim relating to the app, including product liability, legal compliance, or intellectual property claims. Apple and its subsidiaries are third-party beneficiaries of these Terms and may enforce them against you. You confirm you aren't located in a country subject to a US Government embargo or designated as terrorist-supporting, and that you're not on any US Government restricted-parties list."),
            ("Miscellaneous",
                "These Terms, together with the Privacy Policy, are the entire agreement between you and us about MovieSpaces. If any provision is found unenforceable, the rest stays in effect. Our not enforcing a provision isn't a waiver of it. You may not transfer your rights under these Terms; we may transfer ours in connection with a merger, acquisition, or sale of assets."),
            ("Contact",
                "Questions about these Terms? Email support@moviespaces.org."),
        };

        private static readonly (string Heading, string Body)[] PrivacySections =
        {
            ("Who We Are",
                "MovieSpaces is operated by Olaoluwa Kayode, an individual based in the State of Texas, United States. For users in the European Economic Area and the United Kingdom, Olaoluwa Kayode is the \"data controller\" for the personal data described in this policy. This policy explains what we collect, why, who we share it with, and the rights you have over it. Questions or requests: support@moviespaces.org."),
            ("What We Collect",
                "Account information: your email address, display name, username, and profile photo. You sign in with an email address and password, handled through Supabase Auth, which stores your password in hashed form we never see. If we later offer sign-in with Apple or Google, we would receive your email address and name from that provider — never your password. Content you create: Spaces you host or join, group chat messages, direct messages, hangout notes, and the theater memberships you select. Your friend connections and the block and report records you create. Device location, only if you grant permission, used to find nearby theaters and show distances — we use it in the moment and don't build a location history. A push notification token, only if you grant permission, so we can send booking updates, reminders, and new-message alerts. Technical data collected automatically when the app talks to our servers: IP address, device and operating system type, app version, and timestamps, kept in server logs. Diagnostics: crash reports and error traces, including the device model, OS version, and app state at the time of the error, collected through Sentry so we can fix bugs."),
            ("What We Don't Collect",
                "We don't collect payment or financial information — MovieSpaces takes no payments. We don't collect precise contact lists, health data, biometrics, or government identifiers. We don't use advertising SDKs, we don't track you across other companies' apps or websites, and we don't build advertising profiles. We never sell your personal information."),
            ("How We Use It",
                "To run the app's core features: creating and joining Spaces, group and direct messaging, RSVPs, showtime reminders, nearby-theater search, the CineMind daily puzzle and its leaderboards, and keeping your profile in sync across devices. To keep the service safe: reviewing reports, enforcing blocks, preventing spam and abuse, and rate-limiting requests. To fix problems: diagnosing crashes and errors. To communicate with you: account emails such as sign-up confirmation and password resets, and push notifications you've opted into. We don't use your data for advertising or automated decision-making that produces legal or similarly significant effects."),
            ("Legal Bases for Processing (EEA and UK)",
                "If you're in the EEA or UK, we process your personal data on these bases. Performance of a contract: providing the account, Spaces, messaging, and other features you asked for. Consent: device location, push notifications, and photo library access — each requested through your device's permission prompt, and each revocable at any time in your device settings, with no effect on processing that already happened. Legitimate interests: keeping the service secure and abuse-free, fixing bugs, and understanding crashes — balanced against your rights and limited to what's necessary. Legal obligation: retaining or disclosing information where the law requires it."),
            ("Who We Share It With",
                "Other users: people in a Space can see your display name, username, profile photo, and RSVP status. Group chat messages are visible to everyone in that Space. Direct messages are visible only to you and the person you're messaging. CineMind leaderboards show your display name and score to other players. Service providers who process data only on our instructions and only to run the app: Supabase (accounts, database, chat storage, profile photo storage), Render (API hosting and server logs), Sentry (crash and error reporting), Resend (transactional email such as password resets), Expo (push notification delivery), Google Places (theater search — a search query and, if permitted, approximate location), OMDb (movie and TV information — title searches only, no personal data), and Apple and Google (only if you choose to sign in with them). Legal and safety: we may disclose information if required by law or valid legal process, or where we believe in good faith it's necessary to protect someone's safety or investigate abuse. Business transfer: if the app is ever transferred to someone else, your information may transfer with it, and this policy will continue to apply until you're told otherwise. We do not sell your personal information and we don't share it for cross-context behavioral advertising."),
            ("International Data Transfers",
                "Our infrastructure providers store and process data on servers in the United States. If you use MovieSpaces from the EEA, the UK, or elsewhere outside the US, your information will be transferred to and processed in the US, which may have different data protection laws than your country. Where required, our providers rely on the European Commission's Standard Contractual Clauses or an equivalent transfer mechanism to protect that data."),
            ("Your Rights (EEA, UK, and elsewhere)",
                "Depending on where you live, you may have the right to: access the personal data we hold about you; correct inaccurate data; delete your data; restrict or object to certain processing; receive your data in a portable, machine-readable format; and withdraw consent you previously gave, at any time. Many of these you can exercise directly in the app — edit your profile from the Profile tab, revoke location or notification permissions in your device settings, and delete everything from Profile → Delete Account. For anything else, email support@moviespaces.org and we'll respond within 30 days. You won't be charged or treated differently for exercising these rights. If you're in the EEA or UK and think we've handled your data improperly, you also have the right to complain to your local data protection authority."),
            ("Your California Privacy Rights",
                "If you're a California resident, the CCPA as amended by the CPRA gives you the right to know what personal information we collect and how we use and disclose it (described throughout this policy), the right to delete it, the right to correct inaccurate information, and the right to opt out of its sale or sharing. We do not sell personal information and we do not share it for cross-context behavioral advertising, so there is nothing to opt out of — and we have not sold or shared personal information in the preceding twelve months. We don't knowingly collect or sell the personal information of anyone under 16. Exercise any of these rights in the app or by emailing support@moviespaces.org; we may need to verify your identity through the email address on your account before acting. You may use an authorized agent, who will need written permission from you. We will not deny you service, charge you a different price, or provide a lesser quality of service for exercising your rights. The categories we collect map to the CCPA's categories as follows: identifiers (email, name, username, user ID, IP address), internet or network activity (app interactions and error logs), geolocation data (only with permission), and audio/visual data (a profile photo, only if you upload one). We collect these for the business purposes described in \"How We Use It.\""),
            ("Deleting Your Account and Data",
                "You can permanently delete your account at any time from Profile → Delete Account inside the app — no email required and no waiting period. You can also request deletion by emailing support@moviespaces.org from your account's email address. Deleting your account removes your profile, your chat messages, your friend connections, and your push notification token, and deletes any Spaces you host — those disappear for their other members too, exactly as if you'd deleted each Space manually. Spaces you only joined stay intact for the remaining members; you're simply removed from them. Deletion takes effect immediately and cannot be undone. Backups and server logs may retain some data for up to 30 days before they cycle out, and we may keep the minimum records needed to comply with a legal obligation or to enforce a prior ban."),
            ("Data Retention",
                "We keep your account data for as long as your account exists. Server logs containing IP addresses are retained for a short period for security and debugging and then rotated out. Crash and error reports are retained by Sentry for up to 90 days. Reports you file about content or users are kept while we review them and for a period afterward so we can identify repeat offenders. Cancelled Spaces remain visible to their members for reference unless the host deletes them."),
            ("Security",
                "All traffic between the app and our servers is encrypted in transit with HTTPS. Passwords are hashed by Supabase Auth and are never visible to us. Access to the database is restricted by row-level security rules so that, for example, direct messages are readable only by the two people in the conversation. No system is perfectly secure, and we can't guarantee absolute security — but if a breach affects your personal data, we'll notify you and any relevant regulator as required by law."),
            ("Reporting and Blocking",
                "If you report a Space or a chat message, we store the report — who filed it, what was reported, and any reason given — so we can review and act on it. Reports are not visible to other users, and we don't tell the reported person who filed the report. Blocking another user hides their content from you and doesn't notify them."),
            ("Children's Privacy",
                "MovieSpaces is not directed to children under 13, and we don't knowingly collect personal information from them. If you believe a child under 13 has created an account, email support@moviespaces.org and we'll delete the account and its data promptly."),
            ("Changes to This Policy",
                "We may update this Privacy Policy as MovieSpaces changes. When we do, we'll update the \"Last updated\" date at the top. If a change materially affects how we use your personal data, we'll give you notice in the app or by email before it takes effect."),
            ("Contact",
                "Questions about this policy, or want to exercise any of the rights above? Email support@moviespaces.org and we'll respond within 30 days."),
        };

        [HttpGet("/legal/privacy")]
        [AllowAnonymous]
        public IActionResult Privacy() => Content(RenderPage("Privacy Policy", PrivacySections), "text/html");

        [HttpGet("/legal/terms")]
        [AllowAnonymous]
        public IActionResult Terms() => Content(RenderPage("Terms of Service", TermsSections), "text/html");

        // App Store Connect requires a Support URL separate from the privacy
        // policy one. It only has to be a reachable page telling a user how to
        // get help — served from here so there's no second thing to host.
        private static readonly (string Heading, string Body)[] SupportSections =
        {
            ("Getting Help",
                $"Email {SupportEmail} with any question, bug report, or account request. Include your account email and, if it's about a specific Space, its 6-character Space code — that's usually enough to sort things out in one reply. We aim to respond within two business days."),
            ("Reporting Content or a User",
                "Every Space, chat message, and profile has a Report action in the app, and you can block another user from their profile or the member list. Reported content is reviewed and acted on promptly, typically within 24 hours. If you'd rather report something by email, use the address above."),
            ("Deleting Your Account",
                "Profile → Delete Account removes your profile, your messages, and any Spaces you host. It takes effect immediately and can't be undone. You don't need to contact us to do it."),
            ("Common Questions",
                "MovieSpaces doesn't sell tickets or process payments — hosts enter showtimes themselves and any money is handled directly between you, your group, and the venue, so always confirm details with the venue before you go. Showtime and cost information in a Space is provided by its host, not verified by us."),
        };

        [HttpGet("/support")]
        [AllowAnonymous]
        public IActionResult Support() => Content(RenderPage("Support", SupportSections), "text/html");

        // SECURITY: every section is a compile-time literal above (no user
        // input reaches this page), but HtmlEncode is applied anyway — same
        // discipline as SpaceInvitePage, so this stays safe if a section is
        // ever templated from a variable later.
        private static string RenderPage(string title, (string Heading, string Body)[] sections)
        {
            var sectionsHtml = new StringBuilder();
            foreach (var (heading, body) in sections)
            {
                sectionsHtml.Append($@"
                <section>
                    <h2>{WebUtility.HtmlEncode(heading)}</h2>
                    <p>{WebUtility.HtmlEncode(body)}</p>
                </section>");
            }

            return $@"
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='utf-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1'>
            <title>{WebUtility.HtmlEncode(title)} - MovieSpaces</title>
            <style>
                * {{ margin: 0; padding: 0; box-sizing: border-box; }}
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    background: #16100D;
                    color: #F7F0E8;
                    padding: 32px 20px 64px;
                    max-width: 640px;
                    margin: 0 auto;
                    line-height: 1.5;
                }}
                h1 {{ font-size: 26px; font-weight: 800; margin-bottom: 6px; }}
                .updated {{ color: #B3A296; font-size: 13px; margin-bottom: 32px; }}
                h2 {{ font-size: 16px; font-weight: 700; margin-bottom: 8px; color: #EF8A3C; }}
                p {{ font-size: 14px; color: #F7F0E8; margin-bottom: 24px; }}
                a {{ color: #EF8A3C; }}
                .home {{
                    display: inline-block;
                    color: #B3A296;
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 600;
                    margin-bottom: 24px;
                }}
                .home:hover {{ color: #EF8A3C; }}
            </style>
        </head>
        <body>
            <a class='home' href='https://moviespaces.org'>&larr; moviespaces.org</a>
            <h1>{WebUtility.HtmlEncode(title)}</h1>
            <p class='updated'>Last updated {WebUtility.HtmlEncode(LastUpdated)}</p>
            {sectionsHtml}
        </body>
        </html>";
        }
    }
}
