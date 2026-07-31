using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // One row per day on which the "your puzzle is ready" push went out.
    //
    // PuzzleDate is the primary key, so the database is what guarantees the
    // reminder fires once per day. Tracking it in memory instead would
    // re-send every time the process restarts — which on Render's free tier
    // happens on any deploy and after every idle sleep, so a user could be
    // pushed the same reminder several times in one day.
    [Table("cinemind_reminder_log")]
    public class CineMindReminderLog
    {
        [Key]
        [Column("puzzle_date")]
        public DateOnly PuzzleDate { get; set; }

        [Column("sent_at")]
        public DateTime SentAt { get; set; } = DateTime.UtcNow;

        // Recorded for sanity-checking reach when tuning the send hour.
        [Column("recipient_count")]
        public int RecipientCount { get; set; }
    }
}
