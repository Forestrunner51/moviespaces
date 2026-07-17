using Backend.Data;
using Microsoft.EntityFrameworkCore;
using Stripe;

namespace Backend.Services
{
    // Shared Stripe capture/release logic used by PledgeController (a space
    // hitting its goal), SpaceController (creator cancels), and
    // SpaceDeadlineSweepService (an expired, under-funded space).
    public class PledgeSettlementService
    {
        private readonly AppDbContext _db;
        private readonly ILogger<PledgeSettlementService> _logger;
        private readonly PaymentIntentService _stripe = new();

        public PledgeSettlementService(AppDbContext db, ILogger<PledgeSettlementService> logger)
        {
            _db = db;
            _logger = logger;
        }

        // Charges every still-authorized pledge on a space that hit its goal.
        public async Task CaptureAllAsync(Guid spaceId)
        {
            var pledges = await _db.SpacePledges
                .Where(p => p.SpaceId == spaceId && p.Status == "authorized")
                .ToListAsync();

            foreach (var pledge in pledges)
            {
                try
                {
                    await _stripe.CaptureAsync(pledge.StripeIntentId);
                    pledge.Status = "captured";
                }
                catch (StripeException ex)
                {
                    // Most likely the client never finished confirming the
                    // authorization on their end, so there's nothing to capture.
                    _logger.LogError(ex, "Failed to capture pledge {PledgeId} ({IntentId}).", pledge.Id, pledge.StripeIntentId);
                    pledge.Status = "failed";
                }
                pledge.UpdatedAt = DateTime.UtcNow;
            }

            await _db.SaveChangesAsync();
        }

        // Releases every still-authorized hold on a space that was cancelled
        // or missed its funding goal by the deadline.
        public async Task ReleaseAllAsync(Guid spaceId)
        {
            var pledges = await _db.SpacePledges
                .Where(p => p.SpaceId == spaceId && p.Status == "authorized")
                .ToListAsync();

            foreach (var pledge in pledges)
            {
                try
                {
                    await _stripe.CancelAsync(pledge.StripeIntentId);
                }
                catch (StripeException ex)
                {
                    // Already captured/canceled on Stripe's side isn't fatal —
                    // log it and still mark our record released so it stops
                    // showing as outstanding.
                    _logger.LogWarning(ex, "Stripe cancel failed for pledge {PledgeId} ({IntentId}) — marking released anyway.", pledge.Id, pledge.StripeIntentId);
                }
                pledge.Status = "released";
                pledge.UpdatedAt = DateTime.UtcNow;
            }

            await _db.SaveChangesAsync();
        }
    }
}
