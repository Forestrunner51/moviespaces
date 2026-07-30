using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // One puzzle per calendar day (UTC), shared globally — every player gets
    // the same three challenges, which is what makes the emoji grid
    // comparable between friends.
    //
    // PuzzleDate is the primary key, so the database itself enforces
    // "one puzzle per day": a race between two first-requests-of-the-day
    // resolves as a duplicate-key violation rather than two different
    // puzzles being served to different players.
    //
    // The payload is stored generated rather than recomputed on read. The
    // generator is deterministic (date + salt), but the CATALOG isn't frozen —
    // new films get added — so regenerating later could silently produce a
    // different puzzle than the one people already played and shared.
    [Table("daily_puzzles")]
    public class DailyPuzzle
    {
        // DateOnly maps to Postgres `date`, so there's no time component to
        // disagree about across timezones.
        [Key]
        [Column("puzzle_date")]
        public DateOnly PuzzleDate { get; set; }

        // Human-facing sequence number for the share grid ("CineMind #42").
        [Column("puzzle_number")]
        public int PuzzleNumber { get; set; }

        // Serialized DailyPuzzlePayload. Includes the answers, so this must
        // never be returned to a client wholesale — GameController projects a
        // redacted view.
        [Column("challenge_payload_json")]
        public string ChallengePayloadJson { get; set; } = "{}";

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
