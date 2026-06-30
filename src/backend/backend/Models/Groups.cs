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

        public int CinemaId { get; set; }
        public string CinemaName { get; set; } = "";
        public int FilmId { get; set; }
        public string FilmName { get; set; } = "";
        public string ShowTime { get; set; } = "";
        public string ShowDate { get; set; } = "";
        public string BookingUrl { get; set; } = "";
        public string Status { get; set; } = "pending";
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
