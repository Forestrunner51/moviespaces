using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // One row per Roulette spin served to a user, so the next spin can avoid
    // repeating a film they've already seen this week.
    //
    // Persisted rather than held in IMemoryCache (which is where the in-flight
    // spin/answer lives) because the window is seven days: Render's free tier
    // restarts the process on every deploy and after each idle sleep, so an
    // in-memory history would reset several times a day and the guarantee
    // would quietly mean nothing.
    //
    // Deliberately NOT tied to UserDailyProgress or any streak/leaderboard
    // state — Roulette is unscored practice, and this table exists only to
    // make spins feel varied. Losing it entirely would cost nothing but
    // freshness, which is why cleanup below can prune freely.
    [Table("roulette_spin_history")]
    public class RouletteSpinHistory
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("user_id")]
        [MaxLength(128)]
        public string UserId { get; set; } = "";

        // The film that was spun (the one on the reveal card), not every film
        // in the challenge — repeats of the *supporting* films are far less
        // noticeable, and excluding those too would exhaust a thin genre pool
        // several times faster.
        [Column("imdb_id")]
        [MaxLength(32)]
        public string ImdbId { get; set; } = "";

        // Recorded but not currently used for exclusion: a repeat reads as a
        // repeat to the player whichever challenge is wrapped around it. Kept
        // so the rule could be loosened to (film, challengeType) later without
        // a migration and without a blind spot in the existing history.
        [Column("challenge_type")]
        [MaxLength(32)]
        public string ChallengeType { get; set; } = "";

        [Column("seen_at")]
        public DateTime SeenAt { get; set; } = DateTime.UtcNow;
    }
}
