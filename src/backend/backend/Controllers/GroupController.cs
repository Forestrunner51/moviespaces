using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Backend.Data;
using Backend.Models;
using System.Security.Claims;
using Microsoft.Extensions.Logging; // Added for logging

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class GroupController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly ILogger<GroupController> _logger; // Added logger instance variable

        // Injected the logger alongside your DB context
        public GroupController(AppDbContext db, ILogger<GroupController> logger)
        {
            _db = db;
            _logger = logger;
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
        [HttpGet("/space/{id}")]
        [AllowAnonymous]
        public async Task<IActionResult> SpaceInvitePage(Guid id)
        {
            var group = await _db.Groups
                .Include(g => g.Members)
                .FirstOrDefaultAsync(g => g.Id == id);

            if (group == null) return NotFound();

            var html = $@"
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='utf-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1'>
            <title>{group.FilmName} - MovieSpace</title>
            <meta property='og:title' content='{group.FilmName} - MovieSpace'>
            <meta property='og:description' content='{group.HostName} is watching {group.FilmName} at {group.CinemaName} on {group.ShowDate} at {group.ShowTime}. Join them!'>
            <style>
                * {{ margin: 0; padding: 0; box-sizing: border-box; }}
                body {{ font-family: -apple-system, sans-serif; background: #111; color: #fff; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }}
                .card {{ background: #1a1a1a; border-radius: 16px; padding: 32px; max-width: 400px; width: 100%; text-align: center; }}
                .emoji {{ font-size: 48px; margin-bottom: 16px; }}
                h1 {{ font-size: 24px; font-weight: bold; margin-bottom: 8px; }}
                .details {{ color: #888; font-size: 14px; margin-bottom: 8px; }}
                .host {{ color: #aaa; font-size: 14px; margin-bottom: 24px; }}
                .members {{ background: #222; border-radius: 8px; padding: 12px; margin-bottom: 24px; }}
                .members-title {{ font-size: 12px; color: #666; margin-bottom: 8px; }}
                .member {{ font-size: 14px; color: #ccc; padding: 4px 0; }}
                input {{ width: 100%; padding: 14px; border-radius: 8px; border: none; background: #222; color: #fff; font-size: 16px; margin-bottom: 12px; outline: none; }}
                input::placeholder {{ color: #555; }}
                button {{ width: 100%; padding: 16px; border-radius: 8px; border: none; background: #E50914; color: #fff; font-size: 18px; font-weight: bold; cursor: pointer; }}
                .app-link {{ margin-top: 16px; font-size: 12px; color: #555; }}
                .confirmed {{ color: #34C759; font-size: 24px; margin-bottom: 8px; }}
            </style>
        </head>
        <body>
            <div class='card'>
                <div class='emoji'>🎬</div>
                <h1>{group.FilmName}</h1>
                <p class='details'>{group.CinemaName} • {group.ShowTime}</p>
                <p class='details'>{group.ShowDate}</p>
                <p class='host'>Hosted by {group.HostName}</p>

                <div class='members'>
                    <div class='members-title'>WHO'S GOING ({group.Members.Count})</div>
                    {string.Join("", group.Members.Select(m => $"<div class='member'>{(m.Confirmed ? "✓" : "○")} {m.Name}</div>"))}
                </div>

                <div id='form'>
                    <input type='text' id='name' placeholder='Your name' />
                    <button onclick='joinSpace()'>🎟 I'm In!</button>
                </div>
                <div id='success' style='display:none'>
                    <div class='confirmed'>✓ You're in!</div>
                    <p style='color:#888'>The host will be notified.</p>
                </div>
                <p class='app-link'>Get the MovieSpace app for the best experience</p>
            </div>

            <script>
                // Try to open app if installed
                const appLink = 'moviespaces://join?groupId={id}';
                setTimeout(() => {{ window.location = appLink; }}, 100);

                async function joinSpace() {{
                    const name = document.getElementById('name').value.trim();
                    if (!name) return;

                    const res = await fetch('/api/group/{id}/join-web', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{ name }})
                    }});

                    if (res.ok) {{
                        document.getElementById('form').style.display = 'none';
                        document.getElementById('success').style.display = 'block';
                    }}
                }}
            </script>
        </body>
        </html>";

            return Content(html, "text/html");
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
        [Authorize]
        public async Task<IActionResult> GetMySpaces()
        {
            try
            {
                // 1. Extract the secure User ID directly from the validated JWT claims matrix
                string userId = GetUserId();

                if (string.IsNullOrEmpty(userId))
                {
                    return Unauthorized(new { error = "User identity could not be extracted from the token." });
                }

                // 2. FIXED: Changed _context to _db to resolve CS0103 compile error
                var mySpaces = await _db.Groups
                    .Include(g => g.Members)
                    .Where(g => g.UserId == userId || g.Members.Any(m => m.UserId == userId))
                    .OrderByDescending(g => g.CreatedAt)
                    .ToListAsync();

                return Ok(mySpaces);
            }
            catch (Exception ex)
            {
                // FIXED: _logger is now defined via the constructor dependency pipeline
                _logger.LogError(ex, "An error occurred while fetching user spaces.");
                return StatusCode(500, new { error = "Internal server error occurred." });
            }
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

        [HttpPost("{id}/join-web")]
        [AllowAnonymous]
        public async Task<IActionResult> JoinGroupWeb(Guid id, [FromBody] JoinGroupRequest req)
        {
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            var member = new GroupMember
            {
                GroupId = id,
                Name = req.Name,
                UserId = "",
                Confirmed = true
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
