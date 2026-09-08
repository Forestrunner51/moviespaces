using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    // Supabase's advisor flagged these four as "RLS Disabled in Public" —
    // Critical — on 2026-09-08. All four were added on 2026-09-04, after the
    // two earlier RLS migrations (EnableRowLevelSecurity, 07-31, and
    // EnableRlsOnScrapedShowtimesAndPuzzleFirstSeen, 08-18) had each locked
    // down the tables that existed at the time. Nothing re-applied the rule
    // to new tables, so each landed auto-exposed through PostgREST: verified
    // by reading SiteCounters and counting LaunchSignups (which holds email
    // addresses) with nothing but the app's public anon key.
    //
    // Same fix as before — enable RLS with no policies, which denies every
    // role except the table owner. This backend connects as the owner and is
    // unaffected. See EnableRowLevelSecurity for the full reasoning.
    //
    // The recurrence is now caught by backend.IntegrationTests
    // RlsCoverageTests, which asserts relrowsecurity for every table in the
    // EF model, so the next new entity fails the build until its migration
    // includes this ALTER.
    public partial class EnableRlsOnRemainingTables : Migration
    {
        private static readonly string[] Tables =
        {
            "\"AppEvents\"",
            "\"GroupBans\"",
            "\"LaunchSignups\"",
            "\"SiteCounters\"",
        };

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var table in Tables)
            {
                migrationBuilder.Sql($"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in Tables)
            {
                migrationBuilder.Sql($"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;");
            }
        }
    }
}
