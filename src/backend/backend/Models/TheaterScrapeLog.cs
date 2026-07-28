using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // Per-theater equivalent of MetroScrapeLog: tracks when a SPECIFIC
    // CinemaClock theater (not a whole metro) was last scraped via
    // getTheaterShowtimes, and doubles as the same atomic-claim concurrency
    // lock — one billable Apify run per stale theater, no matter how many
    // requests for it arrive at once.
    [Table("theater_scrape_logs")]
    public class TheaterScrapeLog
    {
        // The CinemaClockTheater's own id — a theater scrape is meaningless
        // without knowing which directory entry it belongs to.
        [Key]
        [Column("theater_id")]
        public Guid TheaterId { get; set; }

        [Column("last_scraped_at")]
        public DateTime LastScrapedAt { get; set; }

        [Column("status")]
        [MaxLength(20)]
        public string Status { get; set; } = "refreshing";
    }
}
