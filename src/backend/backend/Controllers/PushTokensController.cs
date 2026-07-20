using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;
using System.Security.Claims;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class PushTokensController : ControllerBase
    {
        private readonly AppDbContext _db;

        public PushTokensController(AppDbContext db)
        {
            _db = db;
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
    }

    public record RegisterPushTokenRequest(string Token);
}
