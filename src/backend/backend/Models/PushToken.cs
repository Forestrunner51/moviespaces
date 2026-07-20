using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // One Expo push token per user — upserted on login/app-launch. A user
    // reinstalling or switching devices just overwrites their old token.
    public class PushToken
    {
        [Key]
        [Column("user_id")]
        public string UserId { get; set; } = "";

        public string Token { get; set; } = "";

        [Column("updated_at")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
