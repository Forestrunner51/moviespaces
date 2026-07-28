using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // One row per theater in CinemaClock's own per-metro directory
    // (cinemaclock.com/{metro}/movie-theaters), scraped directly — NOT
    // through the paid Apify actor, which has no endpoint to list theaters.
    //
    // This exists to solve a real, observed limitation: getCityShowtimes
    // enumerates theater-by-theater and is capped at 500 rows, so a metro
    // with 80+ theaters (confirmed: Dallas has 81) may never reach a theater
    // late in its internal ordering no matter how high maxItems is set —
    // there's no pagination/offset parameter, so re-running just returns the
    // same leading theaters again. Knowing every theater's exact CinemaClock
    // URL up front lets us call getTheaterShowtimes directly, scoped to one
    // theater, with no cap or ordering problem to hit.
    //
    // Name/Url come verbatim from CinemaClock's own listing, so Name is what
    // getTheaterShowtimes results should report back as theaterName — an
    // exact match, not a fuzzy one, for anything covered by this table.
    [Table("cinemaclock_theaters")]
    public class CinemaClockTheater
    {
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("metro_slug")]
        [MaxLength(60)]
        public string MetroSlug { get; set; } = "";

        [Column("name")]
        [MaxLength(255)]
        public string Name { get; set; } = "";

        [Column("url")]
        public string Url { get; set; } = "";

        [Column("address")]
        [MaxLength(500)]
        public string? Address { get; set; }

        // Null until geocoded — a theater is still useful for name-exact
        // matching without coordinates, just not for the geo nearest-match.
        [Column("latitude")]
        public double? Latitude { get; set; }

        [Column("longitude")]
        public double? Longitude { get; set; }

        // Drives the periodic re-crawl: theaters close, rebrand, or move,
        // and this table isn't refreshed by the same 48h TTL as showtimes —
        // it's closer to static data, so it's checked on a much longer cycle.
        [Column("last_verified_at")]
        public DateTime LastVerifiedAt { get; set; } = DateTime.UtcNow;
    }
}
