using Microsoft.EntityFrameworkCore;
using Backend.Models;

namespace Backend.Data;

// This represents a physical row in your database table
public class MovieSpace
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public required string Description { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// This acts as the gateway to your database
public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    // This property automatically maps to a "MovieSpaces" table in Postgres
    public DbSet<MovieSpace> MovieSpaces => Set<MovieSpace>();
    public DbSet<Group> Groups { get; set; }
    public DbSet<GroupMember> GroupMembers { get; set; }
    public DbSet<PushToken> PushTokens { get; set; }

    // CineMind — the daily cinema puzzle game.
    public DbSet<CineMindMovie> CineMindMovies => Set<CineMindMovie>();
    public DbSet<CineMindTvShow> CineMindTvShows => Set<CineMindTvShow>();
    public DbSet<DailyPuzzle> DailyPuzzles => Set<DailyPuzzle>();
    public DbSet<UserDailyProgress> UserDailyProgress => Set<UserDailyProgress>();
    public DbSet<CineMindReminderLog> CineMindReminderLog => Set<CineMindReminderLog>();
    public DbSet<RouletteSpinHistory> RouletteSpinHistory => Set<RouletteSpinHistory>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Partial unique index — Slug is nullable (legacy rows predate it),
        // and a unique index over a nullable column in Postgres already
        // treats multiple NULLs as distinct, so no extra filter is needed.
        builder.Entity<Group>()
            .HasIndex(g => g.Slug)
            .IsUnique();

        // Same nullable-unique reasoning as Slug — legacy rows have none.
        // Length matches SpaceCodeAlphabet's fixed 6-char codes with room for
        // the (extremely unlikely) 8-char fallback in GenerateUniqueSpaceCodeAsync.
        builder.Entity<Group>()
            .Property(g => g.SpaceCode)
            .HasMaxLength(10);

        builder.Entity<Group>()
            .HasIndex(g => g.SpaceCode)
            .IsUnique();

        // ── CineMind ───────────────────────────────────────────────────────

        // One catalog row per film; the seed is idempotent and re-runs upsert
        // against this.
        builder.Entity<CineMindMovie>()
            .HasIndex(m => m.ImdbId)
            .IsUnique();

        // THE once-per-day rule, enforced by the database rather than by an
        // application check. Two concurrent submits would both pass a
        // "have you played?" read and double-score; this makes the second one
        // fail outright.
        builder.Entity<UserDailyProgress>()
            .HasIndex(p => new { p.UserId, p.PuzzleDate })
            .IsUnique();

        // Serves the per-day leaderboard and percentile queries.
        builder.Entity<UserDailyProgress>()
            .HasIndex(p => p.PuzzleDate);

        // Every read of this table is "what has THIS user seen since date X",
        // and every prune is "delete rows older than X" — both covered by the
        // same composite. Not unique: a film legitimately reappears once its
        // seven days are up, and a repeat is expected rather than an error
        // once a thin genre pool is exhausted (see BuildPracticeSpinAsync).
        builder.Entity<RouletteSpinHistory>()
            .HasIndex(h => new { h.UserId, h.SeenAt });
    }
}
