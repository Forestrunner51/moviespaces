using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // One screening of one film at one theater at one time.
    //
    // (MovieId, TheaterName, StartsAt) is enforced unique in AppDbContext so
    // the nightly ingest is idempotent: the scraper has no stable per-showtime
    // id, so without that key a re-run (or two overlapping runs covering the
    // same zip) would insert duplicate rows for the same screening.
    [Table("showtimes")]
    public class Showtime
    {
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("movie_id")]
        public Guid MovieId { get; set; }

        public NowPlayingMovie? Movie { get; set; }

        [Column("theater_name")]
        [MaxLength(255)]
        public string TheaterName { get; set; } = "";

        // LOCAL wall-clock time at the theater, stored as `timestamp without
        // time zone` (DateTimeKind.Unspecified).
        //
        // The scraper emits a bare clock time ("2:00 PM") and a bare date
        // ("Tue Jul 28") with no timezone or UTC offset anywhere, so we
        // genuinely do not know the instant this screening occurs — only the
        // wall-clock time a local moviegoer would read. Storing that as
        // `timestamptz` would force us to invent an offset and silently shift
        // every showtime by hours. Consumers should treat this as "the time
        // printed on the marquee", which is exactly what the create-space
        // date/time pickers want anyway.
        [Column("showtime")]
        public DateTime StartsAt { get; set; }

        // Scraper-provided city (e.g. "dallas"), used to disambiguate the
        // fuzzy theater-name match — chain names like "AMC NorthPark" repeat
        // across metros.
        [Column("city")]
        [MaxLength(120)]
        public string? City { get; set; }

        [Column("booking_link")]
        public string? BookingLink { get; set; }

        // e.g. "2D", "3D", "IMAX", "Recliner"
        [Column("format")]
        [MaxLength(50)]
        public string? Format { get; set; }

        [Column("zip_code")]
        [MaxLength(20)]
        public string? ZipCode { get; set; }

        [Column("updated_at")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
