using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // Tracks when each metro was last scraped, so showtimes are pulled from
    // Apify on demand (and at most once per TTL window) rather than on a
    // blanket nightly schedule for cities nobody is using.
    //
    // This row doubles as the concurrency lock: claiming a refresh is an
    // atomic conditional update on LastScrapedAt, so a burst of users hitting
    // a stale metro triggers exactly one billable Apify run, not one per
    // request.
    [Table("metro_scrape_logs")]
    public class MetroScrapeLog
    {
        [Key]
        [Column("metro_slug")]
        [MaxLength(60)]
        public string MetroSlug { get; set; } = "";

        // Set when a refresh is *claimed*, not when it completes — that's what
        // makes it an effective lock. The webhook stamps it again on success.
        [Column("last_scraped_at")]
        public DateTime LastScrapedAt { get; set; }

        // "refreshing" once a run is triggered, "ok" once the webhook lands
        // rows, "failed" if the trigger itself errored.
        [Column("status")]
        [MaxLength(20)]
        public string Status { get; set; } = "refreshing";

        [Column("last_row_count")]
        public int LastRowCount { get; set; }
    }
}
