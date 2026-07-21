using System;
using System.Collections.Generic;
// 1. Add this namespace so the [Column] attribute works
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    public class Group
    {
        public Guid Id { get; set; } = Guid.NewGuid();

        // Nicer, human-readable share identifier alongside Id (e.g.
        // "friday-movie-night-a8f1") — additive, not a replacement. Existing
        // links/routes are all Id-based and keep working unchanged; Slug is
        // just available for a friendlier share URL if/when wired up.
        // Nullable since legacy rows predate this column.
        [Column("slug")]
        public string? Slug { get; set; }

        public string HostName { get; set; } = "";

        // 2. Map this property directly to lowercase snake_case
        [Column("user_id")]
        public string UserId { get; set; } = "";

        // Nullable — a Private Rental isn't tied to a real MovieGlu catalog
        // entry (the theater/showtime was booked independently, outside the
        // app), so these only have real values for Public Gatherings.
        public int? CinemaId { get; set; }
        public string CinemaName { get; set; } = "";
        public int? FilmId { get; set; }
        public string FilmName { get; set; } = "";
        public string ShowTime { get; set; } = "";
        public string ShowDate { get; set; } = "";
        public string BookingUrl { get; set; } = "";
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
        public string? PostActivities { get; set; }

        // Freeform detail alongside PostActivities (e.g. "Grabbing drinks at
        // the bar across the street") — only meaningful when at least one
        // activity tag is set.
        [Column("hangout_notes")]
        public string? HangoutNotes { get; set; }

        // Google Places-sourced theater identity (replaces the old MovieGlu
        // numeric CinemaId, which stays around unused rather than being
        // dropped — no destructive column removal against live data).
        [Column("google_place_id")]
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
        // "Episodes 1 & 2 Double Feature"). Its presence is itself the signal
        // that a Space is a TV watch party — no separate category column,
        // since that'd be redundant with a field that already implies it.
        [Column("season_episode_info")]
        public string? SeasonEpisodeInfo { get; set; }

        // Set once the "starting in 2 hours" reminder push has gone out, so
        // the reminder background service doesn't re-notify the same Space
        // every time it polls.
        [Column("reminder_sent")]
        public bool ReminderSent { get; set; } = false;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public List<GroupMember> Members { get; set; } = new();
    }

    public class GroupMember
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid GroupId { get; set; }
        public string Name { get; set; } = "";

        // 3. Map this property directly to lowercase snake_case as well
        [Column("user_id")]
        public string UserId { get; set; } = "";

        public bool Confirmed { get; set; } = false;
        public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    }
}
