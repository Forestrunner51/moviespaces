using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    // Supabase flagged all 9 tables below as "RLS Disabled in Public" —
    // Critical. This backend connects to Postgres as the `postgres` role
    // (see appsettings.json's PostgresConnection), which bypasses RLS by
    // design, so this migration doesn't change anything for the .NET API.
    //
    // What it DOES change: Supabase auto-exposes every table in the `public`
    // schema through its own REST API (PostgREST), executed as the `anon` /
    // `authenticated` roles — and those DO respect RLS. With RLS off and no
    // policies, anyone holding the project's public anon key (shipped inside
    // the compiled app, not a secret) could hit
    // https://<project>.supabase.co/rest/v1/Groups (or any of these tables)
    // directly and read/write it, completely bypassing every authorization
    // check in GroupController/GameController — ownership checks, membership
    // gates, the catalog/seed admin secret, all of it.
    //
    // Enabling RLS with zero permissive policies denies every role except
    // the table owner / BYPASSRLS roles — i.e. it locks PostgREST out
    // entirely while leaving this backend's own connection untouched. No
    // policies are added because nothing outside this backend is meant to
    // read these tables directly; if that ever changes for a specific table,
    // add a scoped policy for it then, rather than leaving every table open
    // "just in case" something someday needs direct access.
    //
    // MovieSpaces is dead — created in the very first migration
    // (InitialCreate) and superseded twelve days later by Groups, never
    // dropped, not referenced anywhere in the current model. Included here
    // rather than left exposed just because nothing currently reads it.
    public partial class EnableRowLevelSecurity : Migration
    {
        private static readonly string[] Tables =
        {
            "\"Groups\"",
            "\"GroupMembers\"",
            "\"MovieSpaces\"",
            "\"PushTokens\"",
            "\"__EFMigrationsHistory\"",
            "cinemind_movies",
            "cinemind_reminder_log",
            "daily_puzzles",
            "user_daily_progress",
        };

        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var table in Tables)
            {
                migrationBuilder.Sql($"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;");
            }
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in Tables)
            {
                migrationBuilder.Sql($"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;");
            }
        }
    }
}
