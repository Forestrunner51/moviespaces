using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    // Same finding, same fix as EnableRowLevelSecurity (2026-07-31) and
    // EnableRlsOnCineMindTvShows (2026-08-02) — see the first for the full
    // reasoning. ScrapedShowtimes and PuzzleFirstSeen were both created
    // 2026-08-14 (AddScrapedShowtimes / AddPuzzleFirstSeen), after those
    // migrations ran, so neither was ever covered — exactly the gap that left
    // cinemind_tv_shows exposed once before. Supabase's advisor flagged both
    // as "RLS Disabled in Public" (Critical).
    //
    // Enabling RLS with zero permissive policies denies every role except the
    // table owner / BYPASSRLS roles — it locks Supabase's PostgREST (anon /
    // authenticated) out entirely, while this backend's own Postgres
    // connection (the `postgres` role, which bypasses RLS by design) is
    // unaffected. Nothing outside this backend reads these tables directly.
    //
    // Both names are PascalCase, so they must be double-quoted — unquoted,
    // Postgres folds the identifier to lowercase and the ALTER can't find it.
    public partial class EnableRlsOnScrapedShowtimesAndPuzzleFirstSeen : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"ScrapedShowtimes\" ENABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("ALTER TABLE \"PuzzleFirstSeen\" ENABLE ROW LEVEL SECURITY;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"ScrapedShowtimes\" DISABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("ALTER TABLE \"PuzzleFirstSeen\" DISABLE ROW LEVEL SECURITY;");
        }
    }
}
