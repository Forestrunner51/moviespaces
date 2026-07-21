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
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<AccountController> _logger;

        public AccountController(
            AppDbContext db,
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            ILogger<AccountController> logger)
        {
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
        // side is a separate database with no such FK, so it's cleaned up
        // manually first. Hosted Spaces are deleted outright (same as the
        // existing host "Delete Space" action) rather than orphaned or
        // transferred — there's no one left to consent to taking them over.
        [HttpDelete]
        public async Task<IActionResult> DeleteAccount()
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId))
            {
                return Unauthorized(new { error = "User identity could not be extracted from the token." });
            }

            var hostedGroups = await _db.Groups.Where(g => g.UserId == userId).ToListAsync();
            _db.Groups.RemoveRange(hostedGroups);

            var memberships = await _db.GroupMembers.Where(m => m.UserId == userId).ToListAsync();
            _db.GroupMembers.RemoveRange(memberships);

            var pushToken = await _db.PushTokens.FirstOrDefaultAsync(t => t.UserId == userId);
            if (pushToken != null) _db.PushTokens.Remove(pushToken);

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
