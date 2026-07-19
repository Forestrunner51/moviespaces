using System;
using System.Collections.Generic;
// 1. Add this namespace so the [Column] attribute works
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    public class Group
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string HostName { get; set; } = "";

        // 2. Map this property directly to lowercase snake_case
        [Column("user_id")]
        public string UserId { get; set; } = "";

        // Nullable — a Private Rental isn't tied to a real MovieGlu catalog
        // entry (the theater/showtime was booked independently, outside the
        // app), so these only have real values for Public Gatherings.
        public int? CinemaId { get; set; }
        public string CinemaName { get; set; } = "";
        public int? FilmId { get; set; }
        public string FilmName { get; set; } = "";
        public string ShowTime { get; set; } = "";
        public string ShowDate { get; set; } = "";
        public string BookingUrl { get; set; } = "";
        public string Status { get; set; } = "pending";

        // 'public_gathering' | 'private_rental'
        [Column("space_type")]
        public string SpaceType { get; set; } = "public_gathering";

        // Cents, not dollars — avoids floating-point precision loss on money.
        // Only set for private_rental; informational cost-splitting only,
        // the app never collects or moves this money itself.
        [Column("total_cost_cents")]
        public long? TotalCostCents { get; set; }

        [Column("max_capacity")]
        public int MaxCapacity { get; set; } = 40;

        // Comma-separated activity tags the host wants to do after the
        // movie/rental (e.g. "eat_out,walk") — kept as a simple delimited
        // string rather than a Postgres array column to avoid EF/Npgsql
        // array-mapping complexity for what's just a handful of tags.
        [Column("post_activities")]
        public string? PostActivities { get; set; }

        // Freeform detail alongside PostActivities (e.g. "Grabbing drinks at
        // the bar across the street") — only meaningful when at least one
        // activity tag is set.
        [Column("hangout_notes")]
        public string? HangoutNotes { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public List<GroupMember> Members { get; set; } = new();
    }

    public class GroupMember
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid GroupId { get; set; }
        public string Name { get; set; } = "";

        // 3. Map this property directly to lowercase snake_case as well
        [Column("user_id")]
        public string UserId { get; set; } = "";

        public bool Confirmed { get; set; } = false;
        public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    }
}
