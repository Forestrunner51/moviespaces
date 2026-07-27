using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
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

            var userId = GetUserId();
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
        [HttpPost("notify-dm")]
        public async Task<IActionResult> NotifyDirectMessage([FromBody] NotifyDmRequest req)
        {
            var senderId = GetUserId();
            if (string.IsNullOrEmpty(senderId) || string.IsNullOrWhiteSpace(req.RecipientUserId))
            {
                return BadRequest(new { error = "recipientUserId is required." });
            }

            var isFriend = await AreFriendsAsync(senderId, req.RecipientUserId);
            if (!isFriend) return Forbid();

            var preview = req.Preview.Length > 120 ? req.Preview.Substring(0, 120) + "…" : req.Preview;
            await _pushNotificationService.NotifyUserAsync(_db, req.RecipientUserId, $"💬 {req.SenderName}", preview);
            return Ok();
        }

        private async Task<bool> AreFriendsAsync(string userIdA, string userIdB)
        {
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
