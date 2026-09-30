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

        // Free text, optional. Crews only fill when several people are in the
        // SAME metro picking the same showing, so a list of 300 emails with no
        // locations can't answer the one question that matters on launch day:
        // is there anywhere with enough people to fill a crew. Free text
        // rather than a picker because "Plano", "DFW" and "75024" are all
        // useful answers and a dropdown would just lose the ones that don't
        // fit it.
        [MaxLength(120)]
        public string? City { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
