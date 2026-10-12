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
        private readonly SupabaseBlockService _blocks;
        private readonly ILogger<PushTokensController> _logger;

        public PushTokensController(
            AppDbContext db,
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            PushNotificationService pushNotificationService,
            SupabaseBlockService blocks,
            ILogger<PushTokensController> logger)
        {
            _db = db;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _pushNotificationService = pushNotificationService;
            _blocks = blocks;
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

            // A block doesn't end a friendship, so a blocked pair can still be
            // "friends" here while RLS hides every message they send each
            // other. Without this the DM's text would still arrive as a push.
            //
            // 200, not 403: the response goes back to the SENDER, and a
            // distinguishable status would tell them they've been blocked.
            // The push is simply not sent.
            if (await _blocks.IsBlockedEitherWayAsync(senderId, recipientUserId))
            {
                return Ok();
            }

            // SECURITY: the name and text come from Supabase, never the body.
            // req.SenderName/req.Preview used to be pushed as-is, so any friend
            // could put arbitrary text under any name in someone's
            // notification tray. The app inserts the message before calling
            // this, so the newest message from sender to recipient IS the
            // preview; with no recent one there is nothing to notify about.
            // (The body fields are still accepted, and ignored, so builds
            // already in the App Store keep working.)
            var latest = await SupabaseGetArrayAsync(
                $"messages?select=content,created_at&sender_id=eq.{senderId}&receiver_id=eq.{recipientUserId}" +
                "&order=created_at.desc&limit=1");
            if (latest is not { } rows || rows.GetArrayLength() == 0) return Ok();
            var message = rows[0];
            if (!message.TryGetProperty("created_at", out var createdAt)
                || !createdAt.TryGetDateTimeOffset(out var sentAt)
                || DateTimeOffset.UtcNow - sentAt > DmNotifyWindow)
            {
                return Ok();
            }

            var profile = await SupabaseGetArrayAsync($"profiles?select=display_name&id=eq.{senderId}");
            var displayName = profile is { } p && p.GetArrayLength() > 0
                && p[0].TryGetProperty("display_name", out var dn) && dn.ValueKind == JsonValueKind.String
                ? dn.GetString()
                : null;

            var senderName = PushRules.CapSenderName(displayName);
            var rawPreview = message.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
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

            var filter =
                $"or=(and(requester_id.eq.{userIdA},receiver_id.eq.{userIdB}),and(requester_id.eq.{userIdB},receiver_id.eq.{userIdA}))";
            var rows = await SupabaseGetArrayAsync($"friendships?select=id&status=eq.accepted&{filter}");
            return rows is { } r && r.GetArrayLength() > 0;
        }

        // How old the newest DM may be and still count as "the message this
        // notify call is about". The app calls notify right after its insert
        // returns, so seconds is normal; the slack covers a slow network.
        private static readonly TimeSpan DmNotifyWindow = TimeSpan.FromMinutes(2);

        // GET {Supabase}/rest/v1/{pathAndQuery} with the service role key
        // (bypasses RLS). Returns the JSON array, or null on any failure.
        // Same caveat as AreFriendsAsync: every id interpolated into
        // pathAndQuery must already be a validated GUID.
        private async Task<JsonElement?> SupabaseGetArrayAsync(string pathAndQuery)
        {
            var supabaseUrl = _configuration["Supabase:Url"];
            var serviceRoleKey = _configuration["Supabase:ServiceRoleKey"];
            if (string.IsNullOrEmpty(supabaseUrl) || string.IsNullOrEmpty(serviceRoleKey))
            {
                _logger.LogError("Cannot query Supabase: Supabase:ServiceRoleKey is not configured.");
                return null;
            }

            var authorityUrl = supabaseUrl.EndsWith("/") ? supabaseUrl : $"{supabaseUrl}/";
            var client = _httpClientFactory.CreateClient();
            var request = new HttpRequestMessage(HttpMethod.Get, $"{authorityUrl}rest/v1/{pathAndQuery}");
            request.Headers.Add("apikey", serviceRoleKey);
            request.Headers.Add("Authorization", $"Bearer {serviceRoleKey}");

            var response = await client.SendAsync(request);
            if (!response.IsSuccessStatusCode) return null;

            var body = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.ValueKind == JsonValueKind.Array ? doc.RootElement.Clone() : null;
        }
    }

    public record RegisterPushTokenRequest(string Token);
    // SenderName and Preview are ignored (read from Supabase instead) but still
    // accepted: shipped app builds send them.
    public record NotifyDmRequest(string RecipientUserId, string? SenderName = null, string? Preview = null);
}
