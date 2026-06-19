using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class GroupController : ControllerBase
    {
        private readonly AppDbContext _db;

        public GroupController(AppDbContext db)
        {
            _db = db;
        }

        // Create a new group
        [HttpPost]
        public async Task<IActionResult> CreateGroup([FromBody] CreateGroupRequest req)
        {
            var group = new Group
            {
                HostName = req.HostName,
                CinemaId = req.CinemaId,
                CinemaName = req.CinemaName,
                FilmId = req.FilmId,
                FilmName = req.FilmName,
                ShowTime = req.ShowTime,
                ShowDate = req.ShowDate,
                BookingUrl = req.BookingUrl
            };

            // Add host as first member
            group.Members.Add(new GroupMember
            {
                GroupId = group.Id,
                Name = req.HostName,
                Confirmed = true
            });

            _db.Groups.Add(group);
            await _db.SaveChangesAsync();

            return Ok(new { groupId = group.Id });
        }

        // Get group details
        [HttpGet("{id}")]
        public async Task<IActionResult> GetGroup(Guid id)
        {
            var group = await _db.Groups
                .Include(g => g.Members)
                .FirstOrDefaultAsync(g => g.Id == id);

            if (group == null) return NotFound();
            return Ok(group);
        }

        // Join a group
        [HttpPost("{id}/join")]
        public async Task<IActionResult> JoinGroup(Guid id, [FromBody] JoinGroupRequest req)
        {
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            var member = new GroupMember
            {
                GroupId = id,
                Name = req.Name,
                Confirmed = false
            };

            _db.GroupMembers.Add(member);
            await _db.SaveChangesAsync();

            return Ok(new { memberId = member.Id });
        }

        // Confirm attendance
        [HttpPost("{id}/confirm/{memberId}")]
        public async Task<IActionResult> ConfirmMember(Guid id, Guid memberId)
        {
            var member = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.Id == memberId && m.GroupId == id);

            if (member == null) return NotFound();

            member.Confirmed = true;
            await _db.SaveChangesAsync();

            return Ok();
        }

        // Mark group as booked
        [HttpPost("{id}/book")]
        public async Task<IActionResult> BookGroup(Guid id)
        {
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            group.Status = "booked";
            await _db.SaveChangesAsync();

            return Ok();
        }
    }

    public record CreateGroupRequest(
        string HostName,
        int CinemaId,
        string CinemaName,
        int FilmId,
        string FilmName,
        string ShowTime,
        string ShowDate,
        string BookingUrl
    );

    public record JoinGroupRequest(string Name);
}
