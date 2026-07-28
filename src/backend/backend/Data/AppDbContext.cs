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
    public DbSet<NowPlayingMovie> NowPlayingMovies => Set<NowPlayingMovie>();
    public DbSet<Showtime> Showtimes => Set<Showtime>();
    public DbSet<MetroScrapeLog> MetroScrapeLogs => Set<MetroScrapeLog>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Partial unique index — Slug is nullable (legacy rows predate it),
        // and a unique index over a nullable column in Postgres already
        // treats multiple NULLs as distinct, so no extra filter is needed.
        builder.Entity<Group>()
            .HasIndex(g => g.Slug)
            .IsUnique();

        // Title is the only stable identifier the scraper gives us, so it's
        // the upsert target for the nightly ingest.
        builder.Entity<NowPlayingMovie>()
            .HasIndex(m => m.Title)
            .IsUnique();

        // Npgsql maps DateTime to `timestamptz` by default, which REJECTS a
        // DateTimeKind.Unspecified value at write time. Scraped showtimes are
        // local wall-clock with no known offset (see the Showtime model), so
        // the column has to be `timestamp without time zone` or every ingest
        // throws.
        builder.Entity<Showtime>()
            .Property(s => s.StartsAt)
            .HasColumnType("timestamp without time zone");

        builder.Entity<Showtime>()
            .HasOne(s => s.Movie)
            .WithMany(m => m.Showtimes)
            .HasForeignKey(s => s.MovieId)
            .OnDelete(DeleteBehavior.Cascade);

        // Makes the nightly ingest idempotent — see Showtime for why.
        builder.Entity<Showtime>()
            .HasIndex(s => new { s.MovieId, s.TheaterName, s.StartsAt })
            .IsUnique();

        // Serves the app's "what's playing, soonest first" read path.
        builder.Entity<Showtime>()
            .HasIndex(s => new { s.MovieId, s.StartsAt });
    }
}
