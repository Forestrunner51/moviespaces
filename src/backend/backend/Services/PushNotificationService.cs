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
        public async Task NotifyMembersAsync(AppDbContext db, Guid groupId, string title, string body, string? excludeUserId = null)
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

                await SendExpoPushAsync(tokens, title, body);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send push notifications for group {GroupId}", groupId);
            }
        }

        // Same best-effort push, but to a single user by id rather than every
        // member of a group — used for DM notifications, which have no group
        // to fan out to.
        public async Task NotifyUserAsync(AppDbContext db, string userId, string title, string body)
        {
            try
            {
                var tokens = await db.PushTokens
                    .Where(t => t.UserId == userId)
                    .Select(t => t.Token)
                    .ToListAsync();

                if (tokens.Count == 0) return;

                await SendExpoPushAsync(tokens, title, body);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send push notification to user {UserId}", userId);
            }
        }

        // Same best-effort push to an explicit set of users. Used by the daily
        // CineMind reminder, which fans out to everyone who plays rather than
        // to the members of one group.
        public async Task<int> NotifyUsersAsync(AppDbContext db, List<string> userIds, string title, string body)
        {
            try
            {
                if (userIds.Count == 0) return 0;

                var tokens = await db.PushTokens
                    .Where(t => userIds.Contains(t.UserId))
                    .Select(t => t.Token)
                    .ToListAsync();

                if (tokens.Count == 0) return 0;

                await SendExpoPushAsync(tokens, title, body);
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

        private async Task SendExpoPushAsync(List<string> tokens, string title, string body)
        {
            var client = _httpClientFactory.CreateClient();

            for (var i = 0; i < tokens.Count; i += ExpoBatchSize)
            {
                var messages = tokens
                    .Skip(i)
                    .Take(ExpoBatchSize)
                    .Select(token => new
                    {
                        to = token,
                        sound = "default",
                        title,
                        body,
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
                    await client.SendAsync(request);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Expo push batch starting at {Offset} failed.", i);
                }
            }
        }
    }
}
