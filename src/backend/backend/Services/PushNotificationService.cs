using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Backend.Data;

namespace Backend.Services
{
    // Shared by GroupController (booking/cancel/message notifications, which
    // already have a request-scoped AppDbContext) and ReminderBackgroundService
    // (which owns its own scope) — the DbContext is passed in rather than
    // injected here so this can stay a singleton alongside IHttpClientFactory.
    public class PushNotificationService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<PushNotificationService> _logger;

        public PushNotificationService(IHttpClientFactory httpClientFactory, ILogger<PushNotificationService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        // Fire-and-forget-ish: best-effort push via Expo's push API. Missing
        // tokens (member never opened the app / denied permission / no
        // native build with expo-notifications yet) are silently skipped —
        // this should never block the caller's own action.
        //
        // `data` is the routing payload the app reads on tap (see PushRules
        // for the builders); null falls back to {type:"group"}.
        public async Task NotifyMembersAsync(AppDbContext db, Guid groupId, string title, string body, string? excludeUserId = null, Dictionary<string, object>? data = null)
        {
            try
            {
                var memberUserIds = await db.GroupMembers
                    .Where(m => m.GroupId == groupId && m.UserId != "" && m.UserId != excludeUserId)
                    .Select(m => m.UserId)
                    .Distinct()
                    .ToListAsync();

                if (memberUserIds.Count == 0) return;

                var tokens = await db.PushTokens
                    .Where(t => memberUserIds.Contains(t.UserId))
                    .Select(t => t.Token)
                    .ToListAsync();

                if (tokens.Count == 0) return;

                await SendExpoPushAsync(db, tokens, title, body, data ?? PushRules.GroupData("group", groupId));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send push notifications for group {GroupId}", groupId);
            }
        }

        // Same best-effort push, but to a single user by id rather than every
        // member of a group — used for DM notifications, which have no group
        // to fan out to.
        public async Task NotifyUserAsync(AppDbContext db, string userId, string title, string body, Dictionary<string, object>? data = null)
        {
            try
            {
                var tokens = await db.PushTokens
                    .Where(t => t.UserId == userId)
                    .Select(t => t.Token)
                    .ToListAsync();

                if (tokens.Count == 0) return;

                await SendExpoPushAsync(db, tokens, title, body, data ?? PushRules.TypeOnlyData("user"));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send push notification to user {UserId}", userId);
            }
        }

        // Same best-effort push to an explicit set of users. Used by the daily
        // CineMind reminder, which fans out to everyone who plays rather than
        // to the members of one group.
        public async Task<int> NotifyUsersAsync(AppDbContext db, List<string> userIds, string title, string body, Dictionary<string, object>? data = null)
        {
            try
            {
                if (userIds.Count == 0) return 0;

                var tokens = await db.PushTokens
                    .Where(t => userIds.Contains(t.UserId))
                    .Select(t => t.Token)
                    .ToListAsync();

                if (tokens.Count == 0) return 0;

                await SendExpoPushAsync(db, tokens, title, body, data ?? PushRules.TypeOnlyData("broadcast"));
                return tokens.Count;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send push notifications to {Count} users", userIds.Count);
                return 0;
            }
        }

        // Expo rejects more than 100 messages in a single request, so this
        // chunks rather than assuming the caller's list is small. Group pushes
        // never came close; a game-wide daily reminder does.
        private const int ExpoBatchSize = 100;

        private async Task SendExpoPushAsync(AppDbContext db, List<string> tokens, string title, string body, Dictionary<string, object> data)
        {
            // Single choke point for every send path: one physical device gets
            // one push regardless of how many account rows resolved to its
            // token (see PushTokensController's claim-on-register for how
            // those duplicates arise in the first place).
            tokens = tokens.Distinct().ToList();

            var client = _httpClientFactory.CreateClient();
            var deadTokens = new List<string>();

            for (var i = 0; i < tokens.Count; i += ExpoBatchSize)
            {
                var batch = tokens.Skip(i).Take(ExpoBatchSize).ToList();
                var messages = batch
                    .Select(token => new
                    {
                        to = token,
                        sound = "default",
                        title,
                        body,
                        data,
                    });

                var request = new HttpRequestMessage(HttpMethod.Post, "https://exp.host/--/api/v2/push/send")
                {
                    Content = new StringContent(JsonSerializer.Serialize(messages), Encoding.UTF8, "application/json"),
                };
                request.Headers.Add("Accept", "application/json");

                // One bad batch shouldn't cost every later one — a partial
                // send beats none.
                try
                {
                    using var response = await client.SendAsync(request);
                    var responseBody = await response.Content.ReadAsStringAsync();
                    if (!response.IsSuccessStatusCode)
                    {
                        _logger.LogWarning("Expo push batch starting at {Offset} returned {Status}.", i, (int)response.StatusCode);
                        continue;
                    }
                    deadTokens.AddRange(ParseDeadTokens(responseBody, batch));
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Expo push batch starting at {Offset} failed.", i);
                }
            }

            if (deadTokens.Count > 0) await RemoveDeadTokensAsync(db, deadTokens);
        }

        // Expo answers a send with one ticket per message, in request order:
        //   {"data":[{"status":"ok","id":"..."},
        //            {"status":"error","message":"...","details":{"error":"DeviceNotRegistered"}}]}
        // DeviceNotRegistered means the app was uninstalled or the token was
        // revoked — Expo asks senders to stop using it, and every later
        // fan-out to it is wasted. Returns the tokens in `batch` whose ticket
        // says so. Internal so the parsing is unit-testable without HTTP.
        internal static List<string> ParseDeadTokens(string responseBody, List<string> batch)
        {
            var dead = new List<string>();
            try
            {
                using var doc = JsonDocument.Parse(responseBody);
                if (!doc.RootElement.TryGetProperty("data", out var tickets) || tickets.ValueKind != JsonValueKind.Array)
                    return dead;

                var index = 0;
                foreach (var ticket in tickets.EnumerateArray())
                {
                    if (index >= batch.Count) break;
                    var token = batch[index++];
                    if (ticket.ValueKind != JsonValueKind.Object) continue;
                    if (!ticket.TryGetProperty("status", out var status) || status.GetString() != "error") continue;
                    if (ticket.TryGetProperty("details", out var details)
                        && details.ValueKind == JsonValueKind.Object
                        && details.TryGetProperty("error", out var code)
                        && code.GetString() == "DeviceNotRegistered")
                    {
                        dead.Add(token);
                    }
                }
            }
            catch (JsonException)
            {
                // A malformed body is Expo's problem, not a reason to drop
                // anyone's token.
            }
            return dead;
        }

        private async Task RemoveDeadTokensAsync(AppDbContext db, List<string> deadTokens)
        {
            try
            {
                var removed = await db.PushTokens
                    .Where(t => deadTokens.Contains(t.Token))
                    .ExecuteDeleteAsync();
                _logger.LogInformation("Removed {Count} push token(s) Expo reported as DeviceNotRegistered.", removed);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to remove {Count} dead push token(s).", deadTokens.Count);
            }
        }
    }
}
