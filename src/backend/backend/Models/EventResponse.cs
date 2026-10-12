using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    // One row per person per Space, written after the night is over.
    //
    // This exists because the app had no idea what happened after a
    // showtime. Five people joining a crew and one turning up looked
    // identical in the database to five people turning up, so "is anyone
    // actually going?" — the only question that matters for a product about
    // meeting in person — was unanswerable.
    //
    // It is deliberately NOT a reputation system. There is no score, nothing
    // is shown to other members, and a missed night costs you nothing. The
    // prompt that writes this row asks how the film was, not whether you let
    // anyone down; attendance is the byproduct, not the point. If flaking
    // later turns out to be a real problem, this is the data that would say
    // so — but building the punishment before the evidence would just make
    // joining more expensive at the moment we need it to be free.
    public class EventResponse
    {
        public long Id { get; set; }

        public Guid GroupId { get; set; }

        [MaxLength(100)]
        public string UserId { get; set; } = "";

        public bool Attended { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
