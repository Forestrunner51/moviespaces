using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    // One row per named site-wide counter. Currently only "clapper" — the
    // marketing site's press-for-fun clapperboard. Increments are atomic
    // SQL updates; this entity exists mostly so EF migrations own the table.
    public class SiteCounter
    {
        [Key]
        [MaxLength(50)]
        public string Key { get; set; } = "";

        public long Count { get; set; }
    }
}
