using Backend.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Backend.IntegrationTests;

// Every table this backend owns must have row-level security ENABLED, with
// no policies — that is what keeps Supabase's auto-generated REST API (which
// runs as anon/authenticated and respects RLS) from serving these tables to
// anyone holding the app's public anon key. The .NET connection is the table
// owner and bypasses RLS, so this costs the API nothing.
//
// The rule was applied by hand in two migrations (July 31, Aug 18) and then
// forgotten for the four tables added on Sept 4 — Supabase's advisor caught
// GroupBans, AppEvents, LaunchSignups (which holds email addresses) and
// SiteCounters wide open. This test turns "remember to add the ALTER TABLE"
// into a failing build: add an entity, forget the migration, and the next
// `dotnet test` names the table.
[Collection("postgres")]
public sealed class RlsCoverageTests
{
    private readonly PostgresFixture _pg;

    public RlsCoverageTests(PostgresFixture pg)
    {
        _pg = pg;
    }

    [IntegrationFact]
    public async Task Every_EF_owned_table_has_row_level_security_enabled()
    {
        // The model, not a hand-kept list: whatever EF will create is what
        // must be locked. __EFMigrationsHistory is EF's own bookkeeping table
        // and is included because it too is auto-exposed by PostgREST.
        List<string> tables;
        using (var scope = _pg.Api.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            tables = db.Model.GetEntityTypes()
                .Select(e => e.GetTableName())
                .Where(t => t != null)
                .Select(t => t!)
                .Distinct()
                .Append("__EFMigrationsHistory")
                .OrderBy(t => t, StringComparer.Ordinal)
                .ToList();
        }
        Assert.NotEmpty(tables);

        var unprotected = new List<string>();
        using var conn = _pg.OpenConnection();
        foreach (var table in tables)
        {
            await using var cmd = new NpgsqlCommand(
                "select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
                "where n.nspname = 'public' and c.relname = @t and c.relkind = 'r'", conn);
            cmd.Parameters.AddWithValue("t", table);
            var result = await cmd.ExecuteScalarAsync();
            if (result is not bool enabled)
                unprotected.Add($"{table} (table not found in public schema)");
            else if (!enabled)
                unprotected.Add(table);
        }

        Assert.True(unprotected.Count == 0,
            "These EF-owned tables are readable through Supabase's REST API with the public anon key. " +
            "Add `ALTER TABLE \"<name>\" ENABLE ROW LEVEL SECURITY;` in a migration (see EnableRowLevelSecurity): " +
            string.Join(", ", unprotected));
    }
}
