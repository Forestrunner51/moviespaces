using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Backend.Data;
using Backend.Models;
using System.Security.Claims;
using System.Net;
using Microsoft.Extensions.Logging;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class GroupController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly ILogger<GroupController> _logger;

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

            var spaceType = req.SpaceType == "private_rental" ? "private_rental" : "public_gathering";
            if (spaceType == "private_rental" && (!req.TotalCostCents.HasValue || req.TotalCostCents.Value < 0))
                return BadRequest(new { error = "Total cost is required for a private rental." });

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
                BookingUrl = req.BookingUrl ?? "",
                SpaceType = spaceType,
                TotalCostCents = spaceType == "private_rental" ? req.TotalCostCents : null,
                MaxCapacity = req.MaxCapacity ?? 40,
                PostActivities = req.PostActivities != null && req.PostActivities.Length > 0
                    ? string.Join(",", req.PostActivities)
                    : null,
                HangoutNotes = req.PostActivities != null && req.PostActivities.Length > 0
                    ? req.HangoutNotes
                    : null,
                GooglePlaceId = req.GooglePlaceId,
                TheaterLatitude = req.TheaterLatitude,
                TheaterLongitude = req.TheaterLongitude,
                TmdbMovieId = req.TmdbMovieId,
                ScreeningTime = req.ScreeningTime,
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

            // SECURITY: HTML-encode all user-controlled strings before interpolating into
            // the page. FilmName / HostName / member Name are user-supplied (group creation,
            // join, join-web) and this page is public + unauthenticated, so unescaped values
            // here are a stored-XSS vector for every visitor who opens the invite link.
            var filmName = WebUtility.HtmlEncode(group.FilmName);
            var cinemaName = WebUtility.HtmlEncode(group.CinemaName);
            var hostName = WebUtility.HtmlEncode(group.HostName);
            var showTime = WebUtility.HtmlEncode(group.ShowTime);
            var showDate = WebUtility.HtmlEncode(group.ShowDate);

            var html = $@"
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='utf-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1'>
            <title>{filmName} - MovieSpace</title>
            <meta property='og:title' content='{filmName} - MovieSpace'>
            <meta property='og:description' content='{hostName} is watching {filmName} at {cinemaName} on {showDate} at {showTime}. Join them!'>
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
                .app-link {{ margin-top: 16px; font-size: 12px; color: #555; text-decoration: none; display: block; }}
                .confirmed {{ color: #34C759; font-size: 24px; margin-bottom: 8px; }}
            </style>
        </head>
        <body>
            <div class='card'>
                <div class='emoji'>🎬</div>
                <h1>{filmName}</h1>
                <p class='details'>{cinemaName} • {showTime}</p>
                <p class='details'>{showDate}</p>
                <p class='host'>Hosted by {hostName}</p>

                <div class='members'>
                    <div class='members-title'>WHO'S GOING ({group.Members.Count})</div>
                    {string.Join("", group.Members.Select(m => $"<div class='member'>{(m.Confirmed ? "✓" : "○")} {WebUtility.HtmlEncode(m.Name)}</div>"))}
                </div>

                <div id='form'>
                    <input type='text' id='name' placeholder='Your name' />
                    <button onclick='joinSpace()'>🎟 I'm In!</button>
                </div>
                <div id='success' style='display:none'>
                    <div class='confirmed'>✓ You're in!</div>
                    <p style='color:#888'>The host will be notified.</p>
                </div>
                <a href='moviespaces://space/{id}' class='app-link'>Open in the MovieSpace App</a>
            </div>

            <script>
                const appLink = 'moviespaces://space/{id}';
                setTimeout(() => {{ window.location = appLink; }}, 250);

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

        // NEW: General "open spaces" feed for the Explore tab. Unlike SearchSpaces (which
        // requires a filmId), this returns all open/pending spaces across films, optionally
        // narrowed by filmId and/or cinemaId. No auth required so Explore can show this to
        // signed-out browsers too.
        [HttpGet("open")]
        [AllowAnonymous]
        public async Task<IActionResult> GetOpenSpaces([FromQuery] int? filmId, [FromQuery] int? cinemaId)
        {
            var query = _db.Groups
                .Include(g => g.Members)
                .Where(g => g.Status == "pending")
                // Only filters spaces old enough to have a real ScreeningTime
                // recorded (post-MovieGlu-removal); older/legacy rows without
                // one stay visible rather than being hidden by a null check.
                .Where(g => g.ScreeningTime == null || g.ScreeningTime >= DateTime.UtcNow);

            if (filmId.HasValue)
                query = query.Where(g => g.FilmId == filmId.Value);

            if (cinemaId.HasValue)
                query = query.Where(g => g.CinemaId == cinemaId.Value);

            var spaces = await query
                .OrderByDescending(g => g.CreatedAt)
                .Take(50)
                .ToListAsync();

            return Ok(spaces);
        }

        [HttpGet("mine")]
        [Authorize]
        public async Task<IActionResult> GetMySpaces()
        {
            try
            {
                string userId = GetUserId();

                if (string.IsNullOrEmpty(userId))
                {
                    return Unauthorized(new { error = "User identity could not be extracted from the token." });
                }

                var mySpaces = await _db.Groups
                    .Include(g => g.Members)
                    .Where(g => g.UserId == userId || g.Members.Any(m => m.UserId == userId))
                    .OrderByDescending(g => g.CreatedAt)
                    .ToListAsync();

                return Ok(mySpaces);
            }
            catch (Exception ex)
            {
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

            // Guard: don't add a duplicate GroupMember row if this user already joined.
            var existing = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == userId);
            if (existing != null)
            {
                return Ok(new { memberId = existing.Id });
            }

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

            // Guard: web joiners have no UserId, so de-dupe on name instead (case-insensitive)
            // to avoid double-joins if the page reloads or the deep-link redirect races the click.
            var existing = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.GroupId == id
                    && m.UserId == ""
                    && m.Name.ToLower() == req.Name.Trim().ToLower());
            if (existing != null)
            {
                return Ok(new { memberId = existing.Id });
            }

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

        [HttpPost("{id}/unconfirm/{memberId}")]
        public async Task<IActionResult> UnconfirmMember(Guid id, Guid memberId)
        {
            var member = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.Id == memberId && m.GroupId == id);

            if (member == null) return NotFound();

            member.Confirmed = false;
            await _db.SaveChangesAsync();

            return Ok();
        }

        [HttpPost("{id}/report-showtime")]
        [AllowAnonymous]
        public async Task<IActionResult> ReportShowtime(Guid id)
        {
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            group.ShowtimeReportCount += 1;
            await _db.SaveChangesAsync();

            return Ok(new { showtimeReportCount = group.ShowtimeReportCount });
        }

        [HttpGet("/.well-known/apple-app-site-association")]
        [AllowAnonymous]
        public IActionResult GetAppleAppSiteAssociation()
        {
            var association = new
            {
                applinks = new
                {
                    apps = new string[] { },
                    details = new[]
                    {
                        new
                        {
                            appID = "8J48NY9S42.com.newfahrenheit45.Moviespaces",
                            paths = new[] { "/space/*" }
                        }
                    }
                }
            };

            return new JsonResult(association) { ContentType = "application/json" };
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

        // Host-only: lets a "tentative crowdfund" rental host add the real
        // confirmation link once they actually buy the room, without
        // recreating the Space.
        [HttpPost("{id}/booking-url")]
        public async Task<IActionResult> UpdateBookingUrl(Guid id, [FromBody] UpdateBookingUrlRequest req)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            group.BookingUrl = req.BookingUrl?.Trim() ?? "";
            await _db.SaveChangesAsync();

            return Ok(new { bookingUrl = group.BookingUrl });
        }

        // Host-only: permanently deletes the Space. GroupMembers cascade-delete
        // via the FK (required relationship, EF's default Cascade behavior).
        // Note: group_messages (Supabase-direct, not EF-owned) has no FK back
        // to Groups, so any chat history is left orphaned rather than cleaned
        // up here — harmless, just not reclaimed.
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteGroup(Guid id)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            _db.Groups.Remove(group);
            await _db.SaveChangesAsync();

            return Ok();
        }

        // Host-only: hands the host role to an existing member instead of
        // deleting the Space. The outgoing host stays on as a regular member.
        [HttpPost("{id}/transfer-ownership")]
        public async Task<IActionResult> TransferOwnership(Guid id, [FromBody] TransferOwnershipRequest req)
        {
            var userId = GetUserId();
            var group = await _db.Groups
                .Include(g => g.Members)
                .FirstOrDefaultAsync(g => g.Id == id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            var newHost = group.Members.FirstOrDefault(m => m.UserId == req.NewHostUserId);
            if (newHost == null)
                return BadRequest(new { error = "That member is not part of this Space." });

            group.UserId = newHost.UserId;
            group.HostName = newHost.Name;
            await _db.SaveChangesAsync();

            return Ok(new { hostName = group.HostName });
        }
    }

    public record CreateGroupRequest(
        string HostName,
        int? CinemaId,
        string CinemaName,
        int? FilmId,
        string FilmName,
        string ShowTime,
        string ShowDate,
        string? BookingUrl,
        string? SpaceType,
        long? TotalCostCents,
        int? MaxCapacity,
        string[]? PostActivities,
        string? HangoutNotes,
        string? GooglePlaceId,
        double? TheaterLatitude,
        double? TheaterLongitude,
        int? TmdbMovieId,
        DateTime? ScreeningTime
    );

    public record JoinGroupRequest(string Name);
    public record UpdateBookingUrlRequest(string? BookingUrl);
    public record TransferOwnershipRequest(string NewHostUserId);
}
