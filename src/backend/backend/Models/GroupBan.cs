using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    // A user the host removed from a Space/crew. Removal without this was
    // toothless for crews: the match flow would happily re-seat the removed
    // person in the same open crew. Guests (empty user id) can't be banned —
    // they have no identity to ban.
    public class GroupBan
    {
        [Key]
        public Guid Id { get; set; }
        public Guid GroupId { get; set; }
        [MaxLength(100)]
        public string UserId { get; set; } = "";
    }
}
