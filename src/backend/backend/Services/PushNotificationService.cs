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

                var messages = tokens.Select(token => new
                {
                    to = token,
                    sound = "default",
                    title,
                    body,
                });

                var client = _httpClientFactory.CreateClient();
                var request = new HttpRequestMessage(HttpMethod.Post, "https://exp.host/--/api/v2/push/send")
                {
                    Content = new StringContent(JsonSerializer.Serialize(messages), Encoding.UTF8, "application/json"),
                };
                request.Headers.Add("Accept", "application/json");
                await client.SendAsync(request);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send push notifications for group {GroupId}", groupId);
            }
        }
    }
}
