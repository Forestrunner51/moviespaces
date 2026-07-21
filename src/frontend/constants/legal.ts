// Drafted, non-legal-review copy — good enough to ship an MVP and satisfy
// store requirements, but a lawyer should review before this app scales.
// LAST_UPDATED and the support address are the two things most likely to go
// stale; update both if either the policy or the contact changes.
export const LEGAL_LAST_UPDATED = "July 21, 2026";
export const SUPPORT_EMAIL = "airdisciple23@gmail.com";

export interface LegalSection {
  heading: string;
  body: string;
}

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "Agreement to Terms",
    body:
      `By creating an account or using MovieSpaces, you agree to these Terms. If you don't agree, please don't use the app. We may update these Terms as the app changes; continuing to use MovieSpaces after an update means you accept the revised Terms.`,
  },
  {
    heading: "What MovieSpaces Is",
    body:
      `MovieSpaces helps you organize and join movie watch parties ("Spaces") — public gatherings at a theater or private rentals/watch parties you coordinate with friends. We show approximate showtime and cost-split information for convenience; MovieSpaces does not sell tickets, process payments, or act as a party to any venue booking. Any money, tickets, or bookings involved in a Space are handled entirely outside the app, between you and the venue or your group.`,
  },
  {
    heading: "Your Account",
    body:
      `You're responsible for the accuracy of the information you provide (display name, username, profile photo, theater memberships) and for keeping your account secure. You must be at least 13 years old to use MovieSpaces.`,
  },
  {
    heading: "User-Generated Content",
    body:
      `Spaces, group chat messages, hangout notes, and profile content are created by users, not MovieSpaces. You're responsible for what you post. Don't post anything illegal, harassing, hateful, or that infringes someone else's rights. We provide Report and Block tools in-app — use them, and we may remove content or suspend accounts that violate these Terms.`,
  },
  {
    heading: "Location & Showtimes",
    body:
      `Showtimes are entered by hosts and aren't independently verified — always confirm details directly with the venue before you go. If you enable location access, we use it only to find nearby theaters and calculate distance; you can decline and still use the app with reduced functionality.`,
  },
  {
    heading: "Termination",
    body:
      `You can delete your account at any time from Profile. We may suspend or terminate accounts that violate these Terms, abuse other users, or misuse the reporting/blocking system.`,
  },
  {
    heading: "Disclaimers & Liability",
    body:
      `MovieSpaces is provided "as is," without warranties of any kind. We're not responsible for the conduct of other users, the accuracy of host-provided showtimes or costs, or anything that happens at an in-person Space. To the fullest extent permitted by law, MovieSpaces isn't liable for indirect, incidental, or consequential damages arising from your use of the app.`,
  },
  {
    heading: "Contact",
    body: `Questions about these Terms? Reach us at ${SUPPORT_EMAIL}.`,
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "What We Collect",
    body:
      `Account info (email, display name, username, profile photo) via Supabase Auth; Space and group chat content you create; theater memberships you select; device location, only if you grant permission, used to find nearby theaters and show distance; a push notification token, only if you grant permission, used to notify you about bookings, reminders, and new messages; and basic crash/error diagnostics if something goes wrong in the app.`,
  },
  {
    heading: "How We Use It",
    body:
      `To run the core features of the app — creating and joining Spaces, group chat, showtime reminders, nearby-theater search, and keeping your profile in sync across devices. We don't sell your data, and we don't use it for third-party advertising.`,
  },
  {
    heading: "Who We Share It With",
    body:
      `Other members of a Space can see your display name, username, and profile photo, and (if you join) your confirmation status. Group chat messages are visible to everyone in that Space. We use a small number of service providers to run the app: Supabase (accounts, database, chat, photo storage), Expo (push notifications), Google Places (theater search), TMDb (movie/show data), and Sentry (crash and error reporting). These providers process data only as needed to provide their service to us.`,
  },
  {
    heading: "Reporting & Blocking",
    body:
      `If you report a message, Space, or user, we store the report (who filed it, what was reported, and why) so we can review it — reports aren't visible to other users. Blocking someone hides their messages and listings from you; it doesn't notify them.`,
  },
  {
    heading: "Your Choices",
    body:
      `You can edit your profile info at any time from the Profile tab, revoke location or notification permissions from your device settings, and permanently delete your account from Profile → Delete Account. Deleting your account removes your profile, chat messages, and push token, and deletes any Spaces you host outright (they disappear for other members too, the same as manually deleting a Space). Spaces you've only joined, not hosted, stay intact for the remaining members — you're just removed from them. This can't be undone.`,
  },
  {
    heading: "Data Retention",
    body:
      `We keep your data for as long as your account is active. Cancelled or deleted Spaces are kept for reference rather than being purged, unless you delete them yourself.`,
  },
  {
    heading: "Children",
    body: `MovieSpaces is not intended for children under 13, and we don't knowingly collect data from them.`,
  },
  {
    heading: "Changes to This Policy",
    body:
      `We may update this Privacy Policy as MovieSpaces changes. We'll update the date below when we do.`,
  },
  {
    heading: "Contact",
    body: `Questions about your data? Reach us at ${SUPPORT_EMAIL}.`,
  },
];
