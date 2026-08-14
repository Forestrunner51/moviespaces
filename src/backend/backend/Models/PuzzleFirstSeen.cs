using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // Server-side start-of-clock for CineMind. Written the FIRST time a user
    // is served today's puzzle; Submit computes time-taken from this instant
    // rather than trusting the client's stopwatch. Defeats the
    // screenshot-quit-think-relaunch reset (the app restart used to re-anchor
    // the client timer) and clock tampering: thinking offline is still
    // possible — it just costs real elapsed time, which is the defense.
    public class PuzzleFirstSeen
    {
        [Column("user_id")]
        public string UserId { get; set; } = "";

        [Column("puzzle_date")]
        public DateOnly PuzzleDate { get; set; }

        [Column("first_seen_utc")]
        public DateTime FirstSeenUtc { get; set; } = DateTime.UtcNow;
    }
}
