using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Backend.Data;
using Backend.Models;
using Backend.Services;
using System.Security.Claims;
using Stripe;

namespace Backend.Controllers
{
    // Pledging authorizes (holds) a card via Stripe with CaptureMethod=manual,
    // returning a client_secret for the RN app to confirm client-side with the
    // Stripe SDK. Once a space's goal is hit, every authorized pledge on it
    // gets captured immediately (see PledgeSettlementService); the Stripe
    // webhook (StripeWebhookController) is a safety net for asynchronous
    // failures Stripe reports after the fact.
    [ApiController]
    [Route("api/space/{spaceId}/pledges")]
    [Authorize]
    public class PledgeController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly PledgeSettlementService _settlement;
        private readonly ILogger<PledgeController> _logger;

        public PledgeController(AppDbContext db, PledgeSettlementService settlement, ILogger<PledgeController> logger)
        {
            _db = db;
            _settlement = settlement;
            _logger = logger;
        }

        private string GetUserId() =>
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? "";

        [HttpGet]
        public async Task<IActionResult> GetPledges(Guid spaceId)
        {
            if (!Guid.TryParse(GetUserId(), out var userId))
                return Unauthorized(new { error = "User identity could not be extracted from the token." });

            var space = await _db.Spaces.FindAsync(spaceId);
            if (space == null) return NotFound();

            // Only the creator and people who've pledged can see who else pledged
            // and for how much — not just any authenticated user.
            var isCreator = space.CreatorId == userId;
            var hasPledged = await _db.SpacePledges.AnyAsync(p => p.SpaceId == spaceId && p.UserId == userId);
            if (!isCreator && !hasPledged) return Forbid();

            var pledges = await _db.SpacePledges
                .Where(p => p.SpaceId == spaceId)
                .OrderByDescending(p => p.CreatedAt)
                .Select(p => new
                {
                    p.Id,
                    p.UserId,
                    p.PledgeAmount,
                    p.Status,
                    p.CreatedAt,
                })
                .ToListAsync();

            return Ok(pledges);
        }

        [HttpPost]
        public async Task<IActionResult> CreatePledge(Guid spaceId, [FromBody] CreatePledgeRequest req)
        {
            if (!Guid.TryParse(GetUserId(), out var userId))
                return Unauthorized(new { error = "User identity could not be extracted from the token." });

            if (req.Amount <= 0)
                return BadRequest(new { error = "Pledge amount must be greater than zero." });

            var space = await _db.Spaces.FindAsync(spaceId);
            if (space == null) return NotFound(new { error = "Space not found." });
            if (space.Status != "funding")
                return BadRequest(new { error = "This space is no longer accepting pledges." });
            if (DateTime.UtcNow >= space.Deadline)
                return BadRequest(new { error = "The funding deadline has passed." });

            var alreadyPledged = await _db.SpacePledges
                .AnyAsync(p => p.SpaceId == spaceId && p.UserId == userId);
            if (alreadyPledged)
                return BadRequest(new { error = "You've already pledged to this space." });

            if (space.MaxParticipants.HasValue)
            {
                // One pledge per user (enforced above + the DB unique constraint),
                // so pledge count == participant count. Excludes failed/released
                // pledges — those don't hold a slot. A last-slot race between two
                // concurrent requests is possible but acceptable for now — worth a
                // DB-level check constraint/trigger if this needs to be airtight.
                var participantCount = await _db.SpacePledges
                    .CountAsync(p => p.SpaceId == spaceId && p.Status != "failed" && p.Status != "released");
                if (participantCount >= space.MaxParticipants.Value)
                    return BadRequest(new { error = "This space has reached its maximum number of participants." });
            }

            PaymentIntent intent;
            try
            {
                var service = new PaymentIntentService();
                intent = await service.CreateAsync(new PaymentIntentCreateOptions
                {
                    Amount = (long)(req.Amount * 100),
                    Currency = "usd",
                    CaptureMethod = "manual",
                    Metadata = new Dictionary<string, string>
                    {
                        { "space_id", spaceId.ToString() },
                        { "user_id", userId.ToString() },
                    },
                });
            }
            catch (StripeException ex)
            {
                _logger.LogError(ex, "Stripe PaymentIntent creation failed for space {SpaceId}.", spaceId);
                return BadRequest(new { error = ex.StripeError?.Message ?? "Payment authorization failed." });
            }

            var pledge = new SpacePledge
            {
                SpaceId = spaceId,
                UserId = userId,
                PledgeAmount = req.Amount,
                StripeIntentId = intent.Id,
                Status = "authorized",
            };

            _db.SpacePledges.Add(pledge);
            await _db.SaveChangesAsync();

            // Atomic increment — avoids a lost-update race if two people pledge
            // at the same moment.
            await _db.Spaces
                .Where(s => s.Id == spaceId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.CurrentAmount, s => s.CurrentAmount + req.Amount)
                    .SetProperty(s => s.UpdatedAt, DateTime.UtcNow));

            // Conditional flip to 'successful' once the goal is hit — the WHERE
            // clause + checking rowsUpdated makes this safe if two pledges cross
            // the goal at once, only one actually wins and triggers a capture.
            var rowsUpdated = await _db.Spaces
                .Where(s => s.Id == spaceId && s.Status == "funding" && s.CurrentAmount >= s.TargetAmount)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.Status, "successful")
                    .SetProperty(s => s.UpdatedAt, DateTime.UtcNow));

            if (rowsUpdated > 0)
            {
                await _settlement.CaptureAllAsync(spaceId);
            }

            return Ok(new { pledgeId = pledge.Id, clientSecret = intent.ClientSecret });
        }
    }

    public record CreatePledgeRequest(decimal Amount);
}
