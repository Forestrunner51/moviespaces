using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Backend.Data;
using Backend.Models;
using Microsoft.EntityFrameworkCore;
using Stripe;

namespace Backend.Controllers
{
    // Safety net, not the primary state-transition path — CaptureAllAsync/
    // ReleaseAllAsync (called directly from PledgeController/SpaceController/
    // the deadline sweep) already update our DB whenever *we* initiate a
    // capture or cancel. This endpoint exists for the case Stripe reports
    // asynchronously that we otherwise wouldn't learn about — e.g. a card
    // declining after the client attempts to confirm the authorization.
    [ApiController]
    [Route("api/stripe/webhook")]
    [AllowAnonymous]
    public class StripeWebhookController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IConfiguration _config;
        private readonly ILogger<StripeWebhookController> _logger;

        public StripeWebhookController(AppDbContext db, IConfiguration config, ILogger<StripeWebhookController> logger)
        {
            _db = db;
            _config = config;
            _logger = logger;
        }

        [HttpPost]
        public async Task<IActionResult> Handle()
        {
            var json = await new StreamReader(Request.Body).ReadToEndAsync();
            var webhookSecret = _config["Stripe:WebhookSecret"];

            Event stripeEvent;
            try
            {
                stripeEvent = EventUtility.ConstructEvent(
                    json,
                    Request.Headers["Stripe-Signature"],
                    webhookSecret
                );
            }
            catch (StripeException ex)
            {
                _logger.LogWarning(ex, "Stripe webhook signature verification failed.");
                return BadRequest();
            }

            switch (stripeEvent.Type)
            {
                case "payment_intent.payment_failed":
                    await HandleFailedAsync(stripeEvent);
                    break;
                case "payment_intent.canceled":
                    await HandleCanceledAsync(stripeEvent);
                    break;
                case "payment_intent.succeeded":
                    await HandleSucceededAsync(stripeEvent);
                    break;
            }

            return Ok();
        }

        private async Task<SpacePledge?> FindPledgeAsync(Event stripeEvent)
        {
            if (stripeEvent.Data.Object is not PaymentIntent intent) return null;
            return await _db.SpacePledges.FirstOrDefaultAsync(p => p.StripeIntentId == intent.Id);
        }

        private async Task HandleFailedAsync(Event stripeEvent)
        {
            var pledge = await FindPledgeAsync(stripeEvent);
            if (pledge == null || pledge.Status != "authorized") return;

            pledge.Status = "failed";
            pledge.UpdatedAt = DateTime.UtcNow;

            // The authorization never actually succeeded, so this pledge's
            // amount was never really "in" — back it out of the space total.
            // NOTE: if the space had already flipped to 'successful' before
            // this event arrives, current_amount can end up short of what was
            // actually captured — a known gap of the optimistic-accounting
            // approach here, not fully reconciled in this pass.
            await _db.Spaces
                .Where(s => s.Id == pledge.SpaceId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.CurrentAmount, s => s.CurrentAmount - pledge.PledgeAmount)
                    .SetProperty(s => s.UpdatedAt, DateTime.UtcNow));

            await _db.SaveChangesAsync();
        }

        private async Task HandleCanceledAsync(Event stripeEvent)
        {
            var pledge = await FindPledgeAsync(stripeEvent);
            if (pledge == null || pledge.Status != "authorized") return;

            pledge.Status = "released";
            pledge.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        private async Task HandleSucceededAsync(Event stripeEvent)
        {
            var pledge = await FindPledgeAsync(stripeEvent);
            if (pledge == null || pledge.Status == "captured") return;

            pledge.Status = "captured";
            pledge.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }
    }
}
