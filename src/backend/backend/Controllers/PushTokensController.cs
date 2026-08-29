using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;
using Backend.Services;
using System.Security.Claims;
using System.Text.Json;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class PushTokensController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly PushNotificationService _pushNotificationService;
        private readonly ILogger<PushTokensController> _logger;

        public PushTokensController(
            AppDbContext db,
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            PushNotificationService pushNotificationService,
            ILogger<PushTokensController> logger)
        {
            _db = db;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _pushNotificationService = pushNotificationService;
            _logger = logger;
        }

        private string GetUserId() =>
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? "";

        [HttpPost]
        public async Task<IActionResult> RegisterToken([FromBody] RegisterPushTokenRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Token)) return BadRequest(new { error = "Token is required." });
            // Only a real Expo token shape ("ExponentPushToken[...]") is
            // accepted. The column is unbounded text and this token gets
            // POSTed back to Expo on every fan-out, so without this any user
            // could store a request-body-sized blob as their "token".
            if (!PushRules.IsValidExpoPushToken(req.Token)) return BadRequest(new { error = "Token is not a valid push token." });

            var userId = GetUserId();

            // A device token belongs to exactly one signed-in account at a
            // time. Signing into several accounts on one phone left each
            // account holding a row with the SAME device token — and every
            // all-users fan-out (e.g. the CineMind daily reminder) then hit
            // that phone once per account: the "3 identical notifications"
            // bug. Claiming the token here evicts other accounts' copies.
            var stolen = await _db.PushTokens
                .Where(t => t.Token == req.Token && t.UserId != userId)
                .ToListAsync();
            _db.PushTokens.RemoveRange(stolen);

            var existing = await _db.PushTokens.FirstOrDefaultAsync(t => t.UserId == userId);

            if (existing == null)
            {
                _db.PushTokens.Add(new PushToken { UserId = userId, Token = req.Token, UpdatedAt = DateTime.UtcNow });
            }
            else
            {
                existing.Token = req.Token;
                existing.UpdatedAt = DateTime.UtcNow;
            }

            await _db.SaveChangesAsync();
            return Ok();
        }

        // Turning off "Push Notifications" in Settings calls this — removing
        // the row is what actually stops pushes (every send path here just
        // looks up tokens for the target user id), not a client-side flag
        // the server has no way to honor.
        [HttpDelete]
        public async Task<IActionResult> UnregisterToken()
        {
            var userId = GetUserId();
            var existing = await _db.PushTokens.FirstOrDefaultAsync(t => t.UserId == userId);
            if (existing != null)
            {
                _db.PushTokens.Remove(existing);
                await _db.SaveChangesAsync();
            }
            return Ok();
        }

        // Direct messages live entirely in Supabase (messages table) — the
        // .NET side has no way to observe a new DM on its own, same reason
        // GroupController has "notify-message" for group chat. The client
        // calls this right after a successful send. Since this DB has no
        // visibility into Supabase's friendships table, we verify an accepted
        // friendship via a Supabase REST call (service role key) before
        // sending — otherwise any authenticated user could push-spam an
        // arbitrary user with a spoofed sender name.
        // Rate-limited alongside the friendship check: the gate stops
        // non-friends, but nothing stopped an actual friend from driving a
        // push notification loop at someone.
        [HttpPost("notify-dm")]
        [EnableRateLimiting("write-heavy")]
        public async Task<IActionResult> NotifyDirectMessage([FromBody] NotifyDmRequest req)
        {
            var senderId = GetUserId();
            if (string.IsNullOrEmpty(senderId) || string.IsNullOrWhiteSpace(req.RecipientUserId))
            {
                return BadRequest(new { error = "recipientUserId is required." });
            }

            // SECURITY: RecipientUserId is attacker-controlled and gets
            // interpolated into a PostgREST filter in AreFriendsAsync. Without
            // this check it's a query-injection vector — a crafted value can
            // break out of the `or=(...)` filter or append extra query params
            // (e.g. overriding `status=eq.accepted`), which would make the
            // friendship check pass for a non-friend and defeat the exact
            // push-spam protection that method exists to provide.
            //
            // Every Supabase user id is a UUID, so requiring one here removes
            // the whole class rather than trying to escape the payload.
            if (!Guid.TryParse(req.RecipientUserId, out var recipientGuid))
            {
                return BadRequest(new { error = "recipientUserId must be a valid user id." });
            }
            var recipientUserId = recipientGuid.ToString();

            var isFriend = await AreFriendsAsync(senderId, recipientUserId);
            if (!isFriend) return Forbid();

            // The sender's display name lives in Supabase (profiles), which
            // this DB can't see — so it comes from the client, capped to the
            // same ceiling as every other name so it can't be used to ship a
            // request-sized blob into someone's notification tray. Preview
            // is null-safe for the same reason (both come off the body).
            var senderName = PushRules.CapSenderName(req.SenderName);
            var rawPreview = req.Preview ?? "";
            var preview = rawPreview.Length > 120 ? rawPreview.Substring(0, 120) + "…" : rawPreview;
            await _pushNotificationService.NotifyUserAsync(
                _db, recipientUserId, $"💬 {senderName}", preview,
                PushRules.DirectMessageData(senderId));
            return Ok();
        }

        // Both ids MUST already be validated as GUIDs by the caller — this
        // builds a PostgREST filter by string interpolation, so anything that
        // can contain a comma, parenthesis or ampersand changes the query's
        // meaning. The parse below is a second gate rather than a substitute
        // for validating at the entry point.
        private async Task<bool> AreFriendsAsync(string userIdA, string userIdB)
        {
            if (!Guid.TryParse(userIdA, out _) || !Guid.TryParse(userIdB, out _))
            {
                _logger.LogWarning("Refusing friendship lookup for non-GUID user id.");
                return false;
            }

            var supabaseUrl = _configuration["Supabase:Url"];
            var serviceRoleKey = _configuration["Supabase:ServiceRoleKey"];
            if (string.IsNullOrEmpty(supabaseUrl) || string.IsNullOrEmpty(serviceRoleKey))
            {
                _logger.LogError("Cannot verify friendship: Supabase:ServiceRoleKey is not configured.");
                return false;
            }

            var authorityUrl = supabaseUrl.EndsWith("/") ? supabaseUrl : $"{supabaseUrl}/";
            var filter =
                $"or=(and(requester_id.eq.{userIdA},receiver_id.eq.{userIdB}),and(requester_id.eq.{userIdB},receiver_id.eq.{userIdA}))";
            var url = $"{authorityUrl}rest/v1/friendships?select=id&status=eq.accepted&{filter}";

            var client = _httpClientFactory.CreateClient();
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Add("apikey", serviceRoleKey);
            request.Headers.Add("Authorization", $"Bearer {serviceRoleKey}");

            var response = await client.SendAsync(request);
            if (!response.IsSuccessStatusCode) return false;

            var body = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() > 0;
        }
    }

    public record RegisterPushTokenRequest(string Token);
    public record NotifyDmRequest(string RecipientUserId, string SenderName, string Preview);
}
