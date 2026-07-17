using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    public class Space
    {
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("movie_id")]
        public string MovieId { get; set; } = "";

        [Column("movie_title")]
        public string MovieTitle { get; set; } = "";

        [Column("movie_poster_url")]
        public string? MoviePosterUrl { get; set; }

        [Column("theater_id")]
        public string TheaterId { get; set; } = "";

        [Column("theater_name")]
        public string TheaterName { get; set; } = "";

        [Column("showtime")]
        public DateTime Showtime { get; set; }

        [Column("target_amount")]
        public decimal TargetAmount { get; set; }

        [Column("current_amount")]
        public decimal CurrentAmount { get; set; } = 0m;

        [Column("deadline")]
        public DateTime Deadline { get; set; }

        // 'funding' | 'successful' | 'failed' | 'cancelled'
        [Column("status")]
        public string Status { get; set; } = "funding";

        [Column("creator_id")]
        public Guid CreatorId { get; set; }

        // Caps how many people can pledge into this space (e.g. a full
        // theater rental's fixed seat count). Null = uncapped.
        [Column("max_participants")]
        public int? MaxParticipants { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [Column("updated_at")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public List<SpacePledge> Pledges { get; set; } = new();
    }

    public class SpacePledge
    {
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("space_id")]
        public Guid SpaceId { get; set; }

        [Column("user_id")]
        public Guid UserId { get; set; }

        [Column("pledge_amount")]
        public decimal PledgeAmount { get; set; }

        [Column("stripe_intent_id")]
        public string StripeIntentId { get; set; } = "";

        // 'authorized' | 'captured' | 'released' | 'failed'
        [Column("status")]
        public string Status { get; set; } = "authorized";

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [Column("updated_at")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
