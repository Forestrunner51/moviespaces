using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    // "Notify me when it launches" emails from the marketing site — the
    // audience that gets the App Store link on day one.
    public class LaunchSignup
    {
        public int Id { get; set; }

        [MaxLength(320)]
        public string Email { get; set; } = "";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
