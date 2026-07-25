using System.ComponentModel.DataAnnotations;

namespace Backend.Models;

// Persistent cache for SerpApi Google showtime lookups. SerpApi bills per
// search, so we never hit it twice for the same movie+location inside the
// freshness window — every cache hit is a search we didn't pay for. Unlike
// the in-memory IMemoryCache used for TMDb, showtimes are cached in Postgres
// so the savings survive a redeploy/cold-start (Render's free tier sleeps).
public class ShowtimeCache
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // Normalized "movietitle_location" (e.g. "dune 2_frisco, tx"). Unique-
    // indexed so the upsert on a cache miss can't create duplicate rows.
    [Required]
    [MaxLength(200)]
    public string CacheKey { get; set; } = string.Empty;

    // Serialized JSON of List<TheaterDto> — the already-parsed theater list,
    // not SerpApi's raw payload, so a cache hit needs no re-parsing.
    [Required]
    public string DataJson { get; set; } = string.Empty;

    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
