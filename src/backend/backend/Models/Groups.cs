using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
// 1. Add this namespace so the [Column] attribute works
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // Length ceilings for host-supplied text.
    //
    // Every one of these columns was unbounded `text` with no model, server, or
    // client validation — and FilmName/HostName/CinemaName are rendered into
    // the PUBLIC, unauthenticated /space/{id} invite page. Encoding was already
    // handled correctly there (see GroupController), so this was never an
    // injection risk; it was free unbounded storage and a way to make a real
    // host's shared invite link unusable by posting a megabyte of text into it.
    //
    // Deliberately generous — these exist to make abuse impractical, not to
    // second-guess a host. The longest real film title in wide release is under
    // 90 characters; 200 leaves room for a title plus a subtitle plus a year
    // without anyone ever hitting it by accident. GroupController validates
    // against these before the DB does, so an over-long value comes back as a
    // clear 400 rather than a truncation or a DbUpdateException.
    public static class GroupFieldLimits
    {
        public const int Name = 100;        // HostName, member Name
        public const int Title = 200;       // FilmName, SeasonEpisodeInfo
        public const int VenueName = 250;   // CinemaName / freeform address
        public const int ShortLabel = 60;   // ShowDate, ShowTime display strings
        public const int Notes = 1000;      // HangoutNotes
        public const int Url = 2048;        // BookingUrl, PosterPath
    }

    public class Group
    {
        public Guid Id { get; set; } = Guid.NewGuid();

        // Nicer, human-readable share identifier alongside Id (e.g.
        // "friday-movie-night-a8f1") — additive, not a replacement. Existing
        // links/routes are all Id-based and keep working unchanged; Slug is
        // just available for a friendlier share URL if/when wired up.
        // Nullable since legacy rows predate this column.
        [Column("slug")]
        [MaxLength(150)]
        public string? Slug { get; set; }

        // Short, typeable invite code (e.g. "K7XPQ2") — for a host reading it
        // aloud or texting it, where Slug's full "friday-movie-night-a8f1" is
        // too long to say or type reliably. Nullable for the same reason as
        // Slug: legacy rows predate the column and aren't backfilled.
        [Column("space_code")]
        public string? SpaceCode { get; set; }

        // Host-chosen at creation, independent of SpaceType — either a real
        // theater screening (public_gathering) or a custom venue/watch party
        // (private_rental) can be made invite-only. When true: excluded from
        // GetOpenSpaces (never discoverable by browsing Explore/Home) and
        // JoinGroup/JoinGroupWeb require the correct SpaceCode to be
        // presented, not just a known groupId — a real access check, not
        // just hiding from the browse feed. Distinct from IsPublic (Community
        // Spaces' evergreen-and-always-discoverable flag) — the two are
        // opposite ends of the same discoverability axis and should never
        // both be true on the same row.
        [Column("is_private")]
        public bool IsPrivate { get; set; } = false;

        // Public Community Spaces (e.g. "Horror Night Den") — evergreen,
        // genre-themed Spaces new users auto-join during onboarding so a
        // solo player has an active CineMind leaderboard on day one instead
        // of an empty one waiting for real-life friends to install the app.
        //
        // Deliberately its own bool rather than inferred from SpaceType or a
        // null ScreeningTime: those already mean other things (private
        // rental vs. public gathering; "no exact time set yet" for a real
        // one-off event), and conflating either with "this is a permanent
        // themed club" would misclassify real spaces that happen to share
        // the same incidental state.
        [Column("is_public")]
        public bool IsPublic { get; set; } = false;

        // e.g. "Horror", "Sci-Fi", "Blockbusters", "General" — only set for
        // IsPublic Spaces; drives which onboarding genre picks auto-join
        // which club. Free text rather than an enum: new theme clubs should
        // be addable by seeding a row, not by shipping a code change.
        [Column("genre_category")]
        [MaxLength(64)]
        public string? GenreCategory { get; set; }

        [MaxLength(GroupFieldLimits.Name)]
        public string HostName { get; set; } = "";

        // 2. Map this property directly to lowercase snake_case
        [Column("user_id")]
        public string UserId { get; set; } = "";

        // Nullable — a Private Rental isn't tied to a real MovieGlu catalog
        // entry (the theater/showtime was booked independently, outside the
        // app), so these only have real values for Public Gatherings.
        public int? CinemaId { get; set; }
        [MaxLength(GroupFieldLimits.VenueName)]
        public string CinemaName { get; set; } = "";
        public int? FilmId { get; set; }
        [MaxLength(GroupFieldLimits.Title)]
        public string FilmName { get; set; } = "";
        [MaxLength(GroupFieldLimits.ShortLabel)]
        public string ShowTime { get; set; } = "";
        [MaxLength(GroupFieldLimits.ShortLabel)]
        public string ShowDate { get; set; } = "";
        [MaxLength(GroupFieldLimits.Url)]
        public string BookingUrl { get; set; } = "";
        [MaxLength(32)]
        public string Status { get; set; } = "pending";

        // 'public_gathering' | 'private_rental'
        [Column("space_type")]
        public string SpaceType { get; set; } = "public_gathering";

        // Cents, not dollars — avoids floating-point precision loss on money.
        // Only set for private_rental; informational cost-splitting only,
        // the app never collects or moves this money itself.
        [Column("total_cost_cents")]
        public long? TotalCostCents { get; set; }

        [Column("max_capacity")]
        public int MaxCapacity { get; set; } = 40;

        // Comma-separated activity tags the host wants to do after the
        // movie/rental (e.g. "eat_out,walk") — kept as a simple delimited
        // string rather than a Postgres array column to avoid EF/Npgsql
        // array-mapping complexity for what's just a handful of tags.
        [Column("post_activities")]
        [MaxLength(500)]
        public string? PostActivities { get; set; }

        // Freeform detail alongside PostActivities (e.g. "Grabbing drinks at
        // the bar across the street") — only meaningful when at least one
        // activity tag is set.
        [Column("hangout_notes")]
        [MaxLength(GroupFieldLimits.Notes)]
        public string? HangoutNotes { get; set; }

        // Google Places-sourced theater identity (replaces the old MovieGlu
        // numeric CinemaId, which stays around unused rather than being
        // dropped — no destructive column removal against live data).
        [Column("google_place_id")]
        [MaxLength(200)]
        public string? GooglePlaceId { get; set; }

        [Column("theater_latitude")]
        public double? TheaterLatitude { get; set; }

        [Column("theater_longitude")]
        public double? TheaterLongitude { get; set; }

        // TMDb's movie id, now that films come from TMDb search instead of
        // MovieGlu's catalog. FilmId (MovieGlu's numeric id) stays unused
        // rather than repurposed, to avoid conflating two different id spaces.
        [Column("tmdb_movie_id")]
        public int? TmdbMovieId { get; set; }

        // Full TMDb poster URL, captured from the client at creation time (the
        // movie picker already has it) so the app can show real poster art on
        // Space cards without an extra TMDb lookup per card. Nullable — legacy
        // Spaces and "other"-type events (no movie) have none.
        [Column("poster_path")]
        [MaxLength(GroupFieldLimits.Url)]
        public string? PosterPath { get; set; }

        // Real chronological showtime, combining the host-picked date + time.
        // ShowDate/ShowTime stay as the display strings everything already
        // renders; this column exists so the backend can actually filter out
        // stale showtimes (couldn't reliably do that with free-text strings).
        [Column("screening_time")]
        public DateTime? ScreeningTime { get; set; }

        // Every showtime is host-entered now (no more automated MovieGlu
        // verification), so members can flag one that turns out to be wrong.
        // Simple counter, no dedupe — reporting abuse isn't a concern at
        // this scale, and dedupe would need per-user tracking this table
        // doesn't have a reason to carry otherwise.
        [Column("showtime_report_count")]
        public int ShowtimeReportCount { get; set; } = 0;

        // Only meaningful for TV watch parties (e.g. "Season 2 Premiere",
        // "Episodes 1 & 2 Double Feature").
        [Column("season_episode_info")]
        [MaxLength(GroupFieldLimits.Title)]
        public string? SeasonEpisodeInfo { get; set; }

        // "movie" | "tv" | "sports" | "gaming" | "awards" | "other" — only
        // meaningful for private_rental (a public_gathering is always a real
        // theater movie). Needed once private_rental grew past just
        // Movie/TV/"Other": sports, gaming, and awards are all equally
        // freeform FilmName text with nothing else to tell them apart, unlike
        // the old scheme where SeasonEpisodeInfo's presence alone implied TV.
        // Nullable — legacy rows predate this column; the client (see
        // eventCategoryOf in event-categories.ts) treats a null/missing
        // value as "movie" for public_gathering, "other" for private_rental
        // — it does NOT inspect SeasonEpisodeInfo to recover "tv" for a
        // legacy private rental, since this column and the TV activity
        // preset shipped in the same change (nothing predates it in
        // practice) and threading SeasonEpisodeInfo through every screen
        // that shows a category badge isn't worth it for a case that
        // shouldn't exist. Same nullability spirit as Slug/SpaceCode
        // elsewhere in this model, just without their inference fallback.
        [Column("event_category")]
        public string? EventCategory { get; set; }

        // Set once the "starting in 2 hours" reminder push has gone out, so
        // the reminder background service doesn't re-notify the same Space
        // every time it polls.
        [Column("reminder_sent")]
        public bool ReminderSent { get; set; } = false;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public List<GroupMember> Members { get; set; } = new();

        // Not persisted — set by GetGroup when a private Space is fetched by
        // someone who is neither host nor member and didn't present the invite
        // code. Members comes back empty in that case, and this is what lets
        // the client say "hidden until you join" instead of rendering a
        // truthful-looking "0 members".
        [NotMapped]
        public bool MembersHidden { get; set; } = false;
    }

    public class GroupMember
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid GroupId { get; set; }
        [MaxLength(GroupFieldLimits.Name)]
        public string Name { get; set; } = "";

        // 3. Map this property directly to lowercase snake_case as well
        [Column("user_id")]
        public string UserId { get; set; } = "";

        // Stable per-browser identity for web joiners (UserId == ""), who have
        // no account to key on. Without it, JoinGroupWeb could only de-dupe by
        // lowercased Name — so two different guests both called "Alex" silently
        // collapsed into one membership (the second got the first's memberId and
        // never actually joined), while one guest typing "alex" then "Alex Smith"
        // created two rows. Null for app members, who key on UserId instead.
        [MaxLength(200)]
        public string? GuestToken { get; set; }

        public bool Confirmed { get; set; } = false;
        public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    }
}
