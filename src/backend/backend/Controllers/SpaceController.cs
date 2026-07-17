using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Backend.Data;
using Backend.Models;
using Backend.Services;
using System.Security.Claims;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class SpaceController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly PledgeSettlementService _settlement;
        private readonly ILogger<SpaceController> _logger;

        public SpaceController(AppDbContext db, PledgeSettlementService settlement, ILogger<SpaceController> logger)
        {
            _db = db;
            _settlement = settlement;
            _logger = logger;
        }

        private string GetUserId() =>
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? "";

        [HttpPost]
        public async Task<IActionResult> CreateSpace([FromBody] CreateSpaceRequest req)
        {
            if (!Guid.TryParse(GetUserId(), out var userId))
                return Unauthorized(new { error = "User identity could not be extracted from the token." });

            if (req.Deadline >= req.Showtime)
                return BadRequest(new { error = "Deadline must be before the showtime." });
            if (req.TargetAmount <= 0)
                return BadRequest(new { error = "Target amount must be greater than zero." });
            if (req.MaxParticipants.HasValue && req.MaxParticipants.Value <= 0)
                return BadRequest(new { error = "Max participants must be greater than zero." });

            var space = new Space
            {
                MovieId = req.MovieId,
                MovieTitle = req.MovieTitle,
                MoviePosterUrl = req.MoviePosterUrl,
                TheaterId = req.TheaterId,
                TheaterName = req.TheaterName,
                Showtime = req.Showtime,
                TargetAmount = req.TargetAmount,
                Deadline = req.Deadline,
                MaxParticipants = req.MaxParticipants,
                CreatorId = userId,
            };

            _db.Spaces.Add(space);
            await _db.SaveChangesAsync();

            return Ok(new { spaceId = space.Id });
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetSpace(Guid id)
        {
            var space = await _db.Spaces
                .Include(s => s.Pledges)
                .FirstOrDefaultAsync(s => s.Id == id);

            if (space == null) return NotFound();
            return Ok(space);
        }

        [HttpGet("mine")]
        public async Task<IActionResult> GetMySpaces()
        {
            try
            {
                if (!Guid.TryParse(GetUserId(), out var userId))
                    return Unauthorized(new { error = "User identity could not be extracted from the token." });

                var mySpaces = await _db.Spaces
                    .Include(s => s.Pledges)
                    .Where(s => s.CreatorId == userId || s.Pledges.Any(p => p.UserId == userId))
                    .OrderByDescending(s => s.CreatedAt)
                    .ToListAsync();

                return Ok(mySpaces);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "An error occurred while fetching the user's crowdfunded spaces.");
                return StatusCode(500, new { error = "Internal server error occurred." });
            }
        }

        [HttpGet("open")]
        [AllowAnonymous]
        public async Task<IActionResult> GetOpenSpaces(
            [FromQuery] string? movieId,
            [FromQuery] string? theaterId,
            [FromQuery] DateTime? showtime)
        {
            var query = _db.Spaces.Where(s => s.Status == "funding");

            if (!string.IsNullOrEmpty(movieId))
                query = query.Where(s => s.MovieId == movieId);

            if (!string.IsNullOrEmpty(theaterId))
                query = query.Where(s => s.TheaterId == theaterId);

            // Exact match — used by the showtime feed (movie.tsx) to find
            // crowdfund spaces tied to one specific cinema+time slot, same as
            // how open Groups are already scoped there.
            if (showtime.HasValue)
                query = query.Where(s => s.Showtime == showtime.Value);

            var spaces = await query
                .OrderBy(s => s.Deadline)
                .Take(50)
                .ToListAsync();

            return Ok(spaces);
        }

        [HttpPost("{id}/cancel")]
        public async Task<IActionResult> CancelSpace(Guid id)
        {
            if (!Guid.TryParse(GetUserId(), out var userId))
                return Unauthorized(new { error = "User identity could not be extracted from the token." });

            var space = await _db.Spaces.FindAsync(id);
            if (space == null) return NotFound();
            if (space.CreatorId != userId) return Forbid();
            if (space.Status != "funding")
                return BadRequest(new { error = "Only spaces still funding can be cancelled." });

            space.Status = "cancelled";
            space.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            await _settlement.ReleaseAllAsync(id);

            return Ok();
        }
    }

    public record CreateSpaceRequest(
        string MovieId,
        string MovieTitle,
        string? MoviePosterUrl,
        string TheaterId,
        string TheaterName,
        DateTime Showtime,
        decimal TargetAmount,
        DateTime Deadline,
        int? MaxParticipants
    );
}
