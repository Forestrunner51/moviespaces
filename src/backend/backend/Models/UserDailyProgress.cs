using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // A user's single completion of a single day's puzzle.
    //
    // (UserId, PuzzleDate) is enforced UNIQUE in AppDbContext — that
    // constraint IS the once-per-day rule. Enforcing it only in application
    // code would let two concurrent submits both pass the "have you played?"
    // check and double-score, so the database is the real gate.
    [Table("user_daily_progress")]
    public class UserDailyProgress
    {
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        // Supabase auth user id, stored as text to match the rest of this
        // backend (Groups.UserId, PushToken.UserId).
        [Column("user_id")]
        [MaxLength(64)]
        public string UserId { get; set; } = "";

        [Column("puzzle_date")]
        public DateOnly PuzzleDate { get; set; }

        [Column("time_taken_ms")]
        public int TimeTakenMs { get; set; }

        [Column("score")]
        public int Score { get; set; }

        // Serialized SubmittedAnswers — what they actually guessed, kept so
        // the share grid can be reconstructed after the fact and so a
        // disputed score is auditable.
        [Column("guess_history_json")]
        public string GuessHistoryJson { get; set; } = "{}";

        [Column("completed_at")]
        public DateTime CompletedAt { get; set; } = DateTime.UtcNow;

        // Denormalized display name, captured at submit time.
        //
        // The global leaderboard spans every player, not just people who share
        // a Space, so there's no GroupMembers row to read a name from. Names
        // live on Supabase's `profiles` table, which this backend deliberately
        // never queries (the client owns that read everywhere else in the app)
        // — so the client sends it and it's stored here. Denormalizing also
        // keeps the leaderboard a single-table read instead of a per-row
        // cross-database lookup.
        [Column("display_name")]
        [MaxLength(60)]
        public string? DisplayName { get; set; }

        // Denormalized streak as of THIS completion. Kept per-row rather than
        // on a user record so the value is a historical fact ("you were on 12
        // when you played #42") instead of something that silently changes
        // when the streak later breaks — the share grid quotes it.
        [Column("streak_count")]
        public int StreakCount { get; set; }

        // How many of the day's 5 challenges were solved (0-5), computed once
        // at submit time. Score alone can't answer this anymore now that
        // Mystery Movie/TV score by attempts used and difficulty instead of a
        // flat 0-or-100 — a raw score like 275 no longer maps to a clean
        // "N of 5 solved" count. Denormalized here (same reasoning as
        // StreakCount above) so the stats distribution chart doesn't need to
        // re-grade a user's entire history against each day's puzzle payload
        // just to answer "how many did you usually get."
        [Column("challenges_solved_count")]
        public int ChallengesSolvedCount { get; set; }
    }
}
