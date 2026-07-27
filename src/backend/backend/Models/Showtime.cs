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

        // Named StartsAt rather than Showtime so the property doesn't collide
        // with the type name; the column keeps the spec's `showtime` name.
        [Column("showtime")]
        public DateTime StartsAt { get; set; }

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
