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

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Partial unique index — Slug is nullable (legacy rows predate it),
        // and a unique index over a nullable column in Postgres already
        // treats multiple NULLs as distinct, so no extra filter is needed.
        builder.Entity<Group>()
            .HasIndex(g => g.Slug)
            .IsUnique();
    }
}
