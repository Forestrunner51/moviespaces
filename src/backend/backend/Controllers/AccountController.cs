using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using System.Security.Claims;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class AccountController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly Backend.Services.PushNotificationService _pushNotifications;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<AccountController> _logger;

        public AccountController(
            AppDbContext db,
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            Backend.Services.PushNotificationService pushNotifications,
            ILogger<AccountController> logger)
        {
            _pushNotifications = pushNotifications;
            _db = db;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        private string GetUserId() =>
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? "";

        // Permanently deletes the account. Supabase-owned data (profile,
        // friendships, chat messages, reports, blocks, etc.) cascades
        // automatically once the auth.users row is gone — those tables all
        // have `references auth.users (id) on delete cascade`. The EF/Postgres
        // side is a separate database with no such FK, so EVERY table keyed by
        // this UserId must be cleared here by hand. Missing one leaves the
        // user's data behind after they asked for deletion — which both breaks
        // the promise in our privacy policy and fails Apple's account-deletion
        // completeness requirement (5.1.1(v)). The full set: Groups they host
        // (members notified first), their GroupMemberships, PushTokens,
        // CineMind progress, GroupBans naming them, AppEvents rows, their
        // storage files (avatar + space photos), and finally the auth user —
        // whose deletion cascades the whole Supabase side (profile, DMs,
        // group messages, friendships, read markers).
        // progress (which carries their display name and shows on the global
        // leaderboard), their Roulette spin history, and their CineMind
        // PuzzleFirstSeen timing rows. Hosted Spaces are
        // deleted outright (same as the host "Delete Space" action) — there's
        // no one left to consent to taking them over.
        [HttpDelete]
        public async Task<IActionResult> DeleteAccount()
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId))
            {
                return Unauthorized(new { error = "User identity could not be extracted from the token." });
            }

            var hostedGroups = await _db.Groups.Where(g => g.UserId == userId).ToListAsync();
            // Members' plans must not silently vanish: deleting the host's
            // account deletes everything they host (5.1.1 completeness), so
            // tell the people who confirmed those plans first. Passed and
            // already-cancelled events skipped — nothing there to cancel.
            foreach (var hosted in hostedGroups)
            {
                var isPast = hosted.ScreeningTime != null && hosted.ScreeningTime < DateTime.UtcNow;
                if (isPast || hosted.Status == "cancelled") continue;
                await _pushNotifications.NotifyMembersAsync(
                    _db, hosted.Id,
                    "❌ Space cancelled",
                    $"{hosted.FilmName} was cancelled — the host closed their account.",
                    excludeUserId: userId);
            }
            _db.Groups.RemoveRange(hostedGroups);

            var memberships = await _db.GroupMembers.Where(m => m.UserId == userId).ToListAsync();
            _db.GroupMembers.RemoveRange(memberships);

            var pushToken = await _db.PushTokens.FirstOrDefaultAsync(t => t.UserId == userId);
            if (pushToken != null) _db.PushTokens.Remove(pushToken);

            // CineMind progress carries the player's display name and is what
            // renders their name+score on the public global leaderboard — it
            // must go, or a deleted user keeps appearing there.
            var progress = await _db.UserDailyProgress.Where(p => p.UserId == userId).ToListAsync();
            _db.UserDailyProgress.RemoveRange(progress);

            var spins = await _db.RouletteSpinHistory.Where(s => s.UserId == userId).ToListAsync();
            _db.RouletteSpinHistory.RemoveRange(spins);

            // Server-side CineMind timing rows — keyed by UserId like the rest.
            var firstSeen = await _db.PuzzleFirstSeen.Where(p => p.UserId == userId).ToListAsync();
            _db.PuzzleFirstSeen.RemoveRange(firstSeen);

            // The last EF stragglers: bans naming this user (a bare id with
            // no FK anywhere) and their behavioral event rows. Both are
            // personal identifiers that must not outlive the account.
            var hostedIds = hostedGroups.Select(g => g.Id).ToList();
            await _db.GroupBans
                .Where(b => b.UserId == userId || hostedIds.Contains(b.GroupId))
                .ExecuteDeleteAsync();
            await _db.AppEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();

            await _db.SaveChangesAsync();

            var supabaseUrl = _configuration["Supabase:Url"];
            var serviceRoleKey = _configuration["Supabase:ServiceRoleKey"];
            if (string.IsNullOrEmpty(supabaseUrl) || string.IsNullOrEmpty(serviceRoleKey))
            {
                _logger.LogError("Cannot delete Supabase auth user {UserId}: Supabase:ServiceRoleKey is not configured.", userId);
                return StatusCode(500, new { error = "Account data was cleared, but the account itself couldn't be fully deleted. Please contact support." });
            }

            var authorityUrl = supabaseUrl.EndsWith("/") ? supabaseUrl : $"{supabaseUrl}/";
            var client = _httpClientFactory.CreateClient();

            // Storage BEFORE the auth user: (a) the avatar is the user's face
            // on a PUBLIC url and must actually stop resolving — "delete your
            // account" that leaves the photo up fails 5.1.1(v) in the way a
            // reviewer can check; (b) on schemas where storage.objects.owner
            // FKs auth.users without cascade, deleting the objects first is
            // what keeps the auth delete from 500ing for exactly the users
            // who uploaded a photo. Best-effort: a storage hiccup shouldn't
            // block the deletion itself.
            async Task StorageDeleteAsync(string bucket, string[] paths)
            {
                try
                {
                    var del = new HttpRequestMessage(HttpMethod.Delete, $"{authorityUrl}storage/v1/object/{bucket}")
                    {
                        Content = System.Net.Http.Json.JsonContent.Create(new { prefixes = paths }),
                    };
                    del.Headers.Add("apikey", serviceRoleKey);
                    del.Headers.Add("Authorization", $"Bearer {serviceRoleKey}");
                    var delResp = await client.SendAsync(del);
                    if (!delResp.IsSuccessStatusCode && delResp.StatusCode != System.Net.HttpStatusCode.NotFound)
                        _logger.LogWarning("Storage delete {Bucket} for {UserId} returned {Status}.", bucket, userId, (int)delResp.StatusCode);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Storage delete {Bucket} for {UserId} failed.", bucket, userId);
                }
            }
            await StorageDeleteAsync("avatars", new[] { $"{userId}.jpg" });
            try
            {
                // space-photos live under <uid>/<timestamp>.jpg — list then batch-delete.
                var list = new HttpRequestMessage(HttpMethod.Post, $"{authorityUrl}storage/v1/object/list/space-photos")
                {
                    Content = System.Net.Http.Json.JsonContent.Create(new { prefix = $"{userId}/", limit = 200 }),
                };
                list.Headers.Add("apikey", serviceRoleKey);
                list.Headers.Add("Authorization", $"Bearer {serviceRoleKey}");
                var listResp = await client.SendAsync(list);
                if (listResp.IsSuccessStatusCode)
                {
                    var items = await listResp.Content.ReadFromJsonAsync<List<System.Text.Json.JsonElement>>() ?? new();
                    var paths = items
                        .Select(i => i.TryGetProperty("name", out var n) ? n.GetString() : null)
                        .Where(n => !string.IsNullOrEmpty(n))
                        .Select(n => $"{userId}/{n}")
                        .ToArray();
                    if (paths.Length > 0) await StorageDeleteAsync("space-photos", paths);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "space-photos cleanup for {UserId} failed.", userId);
            }

            var request = new HttpRequestMessage(HttpMethod.Delete, $"{authorityUrl}auth/v1/admin/users/{userId}");
            request.Headers.Add("apikey", serviceRoleKey);
            request.Headers.Add("Authorization", $"Bearer {serviceRoleKey}");

            var response = await client.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                _logger.LogError("Failed to delete Supabase auth user {UserId}: {Status} {Body}", userId, response.StatusCode, body);
                return StatusCode(500, new { error = "Account data was cleared, but the account itself couldn't be fully deleted. Please contact support." });
            }

            return Ok();
        }
    }
}
