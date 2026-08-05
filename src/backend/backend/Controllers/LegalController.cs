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
        private const string SupportEmail = "airdisciple23@gmail.com";
        private const string LastUpdated = "July 24, 2026";

        private static readonly (string Heading, string Body)[] TermsSections =
        {
            ("Agreement to Terms",
                "By creating an account or using MovieSpaces, you agree to these Terms. If you don't agree, please don't use the app. We may update these Terms as the app changes; continuing to use MovieSpaces after an update means you accept the revised Terms."),
            ("What MovieSpaces Is",
                "MovieSpaces helps you organize and join movie watch parties (\"Spaces\") — public gatherings at a theater or private rentals/watch parties you coordinate with friends. We show approximate showtime and cost-split information for convenience; MovieSpaces does not sell tickets, process payments, or act as a party to any venue booking. Any money, tickets, or bookings involved in a Space are handled entirely outside the app, between you and the venue or your group."),
            ("Your Account",
                "You're responsible for the accuracy of the information you provide (display name, username, profile photo, theater memberships) and for keeping your account secure. You must be at least 13 years old to use MovieSpaces."),
            ("User-Generated Content",
                "Spaces, group chat messages, direct messages, hangout notes, and profile content are created by users, not MovieSpaces. You're responsible for what you post. There is no tolerance for objectionable content or abusive behavior — don't post anything illegal, harassing, hateful, or that infringes someone else's rights. We provide Report and Block tools in-app; when content or a user is reported, we review it and act on violations — removing content and/or suspending or removing the offending user — promptly, typically within 24 hours."),
            ("Location & Showtimes",
                "Showtimes are entered by hosts and aren't independently verified — always confirm details directly with the venue before you go. If you enable location access, we use it only to find nearby theaters and calculate distance; you can decline and still use the app with reduced functionality."),
            ("Termination",
                "You can delete your account at any time from Profile. We may suspend or terminate accounts that violate these Terms, abuse other users, or misuse the reporting/blocking system."),
            ("Disclaimers & Liability",
                "MovieSpaces is provided \"as is,\" without warranties of any kind. We're not responsible for the conduct of other users, the accuracy of host-provided showtimes or costs, or anything that happens at an in-person Space. To the fullest extent permitted by law, MovieSpaces isn't liable for indirect, incidental, or consequential damages arising from your use of the app."),
            ("Contact", $"Questions about these Terms? Reach us at {SupportEmail}."),
        };

        private static readonly (string Heading, string Body)[] PrivacySections =
        {
            ("What We Collect",
                "Account info (email, display name, username, profile photo) via Supabase Auth — including when you sign in with Apple or Google; Space content, group chat messages, and direct messages you create; your friend connections; theater memberships you select; device location, only if you grant permission, used to find nearby theaters and show distance; a push notification token, only if you grant permission, used to notify you about bookings, reminders, and new messages; and basic crash/error diagnostics if something goes wrong in the app."),
            ("How We Use It",
                "To run the core features of the app — creating and joining Spaces, group chat, showtime reminders, nearby-theater search, and keeping your profile in sync across devices. We don't sell your data, and we don't use it for third-party advertising."),
            ("Who We Share It With",
                "Other members of a Space can see your display name, username, and profile photo, and (if you join) your confirmation status. Group chat messages are visible to everyone in that Space; direct messages are visible only to you and the friend you're messaging. We use a small number of service providers to run the app: Supabase (accounts, database, chat, photo storage), Apple and Google (only if you choose to sign in with them), Expo (push notifications), Google Places (theater search), TMDb (movie/show data), and Sentry (crash and error reporting). These providers process data only as needed to provide their service to us."),
            ("Reporting & Blocking",
                "If you report a message, Space, or user, we store the report (who filed it, what was reported, and why) so we can review it — reports aren't visible to other users. Blocking someone hides their messages and listings from you; it doesn't notify them."),
            ("Your Choices",
                "You can edit your profile info at any time from the Profile tab, revoke location or notification permissions from your device settings, and permanently delete your account from Profile → Delete Account. Deleting your account removes your profile, chat messages, and push token, and deletes any Spaces you host outright (they disappear for other members too, the same as manually deleting a Space). Spaces you've only joined, not hosted, stay intact for the remaining members — you're just removed from them. This can't be undone."),
            ("Data Retention",
                "We keep your data for as long as your account is active. Cancelled or deleted Spaces are kept for reference rather than being purged, unless you delete them yourself."),
            ("Children", "MovieSpaces is not intended for children under 13, and we don't knowingly collect data from them."),
            ("Changes to This Policy", "We may update this Privacy Policy as MovieSpaces changes. We'll update the date below when we do."),
            ("Contact", $"Questions about your data? Reach us at {SupportEmail}."),
        };

        [HttpGet("/legal/privacy")]
        [AllowAnonymous]
        public IActionResult Privacy() => Content(RenderPage("Privacy Policy", PrivacySections), "text/html");

        [HttpGet("/legal/terms")]
        [AllowAnonymous]
        public IActionResult Terms() => Content(RenderPage("Terms of Service", TermsSections), "text/html");

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
            </style>
        </head>
        <body>
            <h1>{WebUtility.HtmlEncode(title)}</h1>
            <p class='updated'>Last updated {WebUtility.HtmlEncode(LastUpdated)}</p>
            {sectionsHtml}
        </body>
        </html>";
        }
    }
}
