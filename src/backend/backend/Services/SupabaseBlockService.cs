using System.Text.Json;

namespace Backend.Services
{
    // Reads the Supabase-owned `blocks` table so the push paths can respect a
    // block.
    //
    // WHY OVER HTTP: the EF/Postgres database and the Supabase project are two
    // separate databases (see AccountController.DeleteAccount). `blocks`,
    // `profiles` and `friendships` live only on the Supabase side, so there is
    // no local table to join against — the same reason
    // PushTokensController.AreFriendsAsync checks friendships over PostgREST.
    // The service-role key bypasses RLS, which is required here: the blocks
    // select policy only ever shows a row to its own blocker.
    //
    // WHY IT MATTERS: RLS already hides a blocked person's messages inside the
    // app, in both directions. Push notifications are the one delivery path
    // that doesn't go through Postgres — the .NET backend fans them out from
    // its own member tables — so without this lookup a blocked person's
    // message text still lands on the blocker's lock screen. That is exactly
    // the "remove it from the user's feed instantly" precaution App Review
    // asks for under guideline 1.2.
    public class SupabaseBlockService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<SupabaseBlockService> _logger;

        public SupabaseBlockService(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            ILogger<SupabaseBlockService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        // Every user id with a block in EITHER direction with this user — the
        // same both-ways rule as the client's blocked_peer_ids() RPC. A block
        // has to silence both sides, or the blocked person still hears from
        // someone who has muted them.
        //
        // Returns an EMPTY set when the lookup can't be made (no key, network
        // failure, non-GUID input). That fails OPEN: a transient Supabase
        // blip means a notification that should have been suppressed goes out,
        // rather than every group push in the app silently disappearing. The
        // in-app content stays hidden either way — RLS enforces that in the
        // database and doesn't depend on this call.
        public async Task<HashSet<string>> BlockedPeerIdsAsync(string userId, CancellationToken ct = default)
        {
            var empty = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(userId)) return empty;

            // Both ids are interpolated into a PostgREST filter below. Every
            // Supabase user id is a UUID, so requiring one removes the whole
            // query-injection class rather than trying to escape the payload
            // (same gate, and same reasoning, as AreFriendsAsync).
            if (!Guid.TryParse(userId, out var userGuid)) return empty;
            var id = userGuid.ToString();

            var supabaseUrl = _configuration["Supabase:Url"];
            var serviceRoleKey = _configuration["Supabase:ServiceRoleKey"];
            if (string.IsNullOrEmpty(supabaseUrl) || string.IsNullOrEmpty(serviceRoleKey))
            {
                _logger.LogError(
                    "Cannot apply blocks to notifications: Supabase:ServiceRoleKey is not configured.");
                return empty;
            }

            var authorityUrl = supabaseUrl.EndsWith('/') ? supabaseUrl : $"{supabaseUrl}/";
            var url =
                $"{authorityUrl}rest/v1/blocks?select=blocker_id,blocked_id" +
                $"&or=(blocker_id.eq.{id},blocked_id.eq.{id})";

            try
            {
                var client = _httpClientFactory.CreateClient();
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.Add("apikey", serviceRoleKey);
                request.Headers.Add("Authorization", $"Bearer {serviceRoleKey}");

                using var response = await client.SendAsync(request, ct);
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning(
                        "Block lookup failed with status {Status}; notification sent unfiltered.",
                        (int)response.StatusCode);
                    return empty;
                }

                var body = await response.Content.ReadAsStringAsync(ct);
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) return empty;

                var peers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var row in doc.RootElement.EnumerateArray())
                {
                    // One side of each row is this user; the other is the peer.
                    foreach (var key in new[] { "blocker_id", "blocked_id" })
                    {
                        if (row.TryGetProperty(key, out var value) &&
                            value.GetString() is { } peer &&
                            !string.Equals(peer, id, StringComparison.OrdinalIgnoreCase))
                        {
                            peers.Add(peer);
                        }
                    }
                }
                return peers;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Block lookup threw; notification sent unfiltered.");
                return empty;
            }
        }

        // Convenience for the one-recipient case (DMs).
        public async Task<bool> IsBlockedEitherWayAsync(string userIdA, string userIdB, CancellationToken ct = default)
        {
            var peers = await BlockedPeerIdsAsync(userIdA, ct);
            return peers.Contains(userIdB);
        }
    }
}
