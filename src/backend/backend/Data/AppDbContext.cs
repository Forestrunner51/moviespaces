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
    public DbSet<Space> Spaces => Set<Space>();
    public DbSet<SpacePledge> SpacePledges => Set<SpacePledge>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // "spaces"/"space_pledges" are created and owned by the Supabase SQL
        // migration (supabase/migrations/20260717_crowdfunded_spaces.sql), not
        // by EF Core migrations — exclude them so `dotnet ef migrations add`
        // never generates a CREATE TABLE for tables that already exist.
        modelBuilder.Entity<Space>().ToTable("spaces", t => t.ExcludeFromMigrations());
        modelBuilder.Entity<SpacePledge>().ToTable("space_pledges", t => t.ExcludeFromMigrations());
    }
}
