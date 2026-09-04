using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    // One row per behavioral event — the minimal instrumentation that makes
    // post-launch decisions data instead of vibes (steer override rate,
    // CineMind-only session share, crew vs club traction). Deliberately
    // dumb: a name, who, when. No properties bag, no sessions, no vendor.
    public class AppEvent
    {
        public long Id { get; set; }

        [MaxLength(60)]
        public string Name { get; set; } = "";

        [MaxLength(100)]
        public string UserId { get; set; } = "";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
