using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Backend.Data;
using Backend.Models;
using System.Security.Claims;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class GroupController : ControllerBase
    {
        private readonly AppDbContext _db;

        public GroupController(AppDbContext db)
        {
            _db = db;
        }

        private string GetUserId() =>
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? "";

        [HttpPost]
        public async Task<IActionResult> CreateGroup([FromBody] CreateGroupRequest req)
        {
            var userId = GetUserId();

            var group = new Group
            {
                HostName = req.HostName,
                UserId = userId,
                CinemaId = req.CinemaId,
                CinemaName = req.CinemaName,
                FilmId = req.FilmId,
                FilmName = req.FilmName,
                ShowTime = req.ShowTime,
                ShowDate = req.ShowDate,
                BookingUrl = req.BookingUrl
            };

            group.Members.Add(new GroupMember
            {
                GroupId = group.Id,
                Name = req.HostName,
                UserId = userId,
                Confirmed = true
            });

            _db.Groups.Add(group);
            await _db.SaveChangesAsync();

            return Ok(new { groupId = group.Id });
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetGroup(Guid id)
        {
            var group = await _db.Groups
                .Include(g => g.Members)
                .FirstOrDefaultAsync(g => g.Id == id);

            if (group == null) return NotFound();
            return Ok(group);
        }

        [HttpGet("search")]
        public async Task<IActionResult> SearchSpaces([FromQuery] int filmId)
        {
            var spaces = await _db.Groups
                .Include(g => g.Members)
                .Where(g => g.FilmId == filmId && g.Status == "pending")
                .OrderByDescending(g => g.CreatedAt)
                .ToListAsync();

            return Ok(spaces);
        }

        [HttpGet("mine")]
        public async Task<IActionResult> GetMySpaces()
        {
            var userId = GetUserId();

            var spaces = await _db.Groups
                .Include(g => g.Members)
                .Where(g => g.Members.Any(m => m.UserId == userId))
                .OrderByDescending(g => g.CreatedAt)
                .ToListAsync();

            return Ok(spaces);
        }

        [HttpPost("{id}/join")]
        public async Task<IActionResult> JoinGroup(Guid id, [FromBody] JoinGroupRequest req)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            var member = new GroupMember
            {
                GroupId = id,
                Name = req.Name,
                UserId = userId,
                Confirmed = false
            };

            _db.GroupMembers.Add(member);
            await _db.SaveChangesAsync();

            return Ok(new { memberId = member.Id });
        }

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
