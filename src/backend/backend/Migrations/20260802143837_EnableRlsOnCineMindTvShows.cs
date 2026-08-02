using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    // Same finding, same fix as EnableRowLevelSecurity (2026-07-31) — see that
    // migration's comment for the full reasoning. cinemind_tv_shows just
    // didn't exist yet when that migration ran; AddCineMindTvTrack created it
    // a few hours later the same night and nothing ever went back to cover
    // it. Confirmed it's the only table created after that migration that
    // isn't already in its list (AddEventCategoryToGroups/AddIsPrivateToGroups
    // /AddMysteryMovieChallenge all just add columns to Groups, already RLS'd).
    //
    // Enabling RLS with zero permissive policies denies every role except the
    // table owner / BYPASSRLS roles — locks Supabase's PostgREST (anon /
    // authenticated roles) out entirely, while this backend's own Postgres
    // connection (the `postgres` role, which bypasses RLS by design) is
    // completely unaffected.
    public partial class EnableRlsOnCineMindTvShows : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE cinemind_tv_shows ENABLE ROW LEVEL SECURITY;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE cinemind_tv_shows DISABLE ROW LEVEL SECURITY;");
        }
    }
}
