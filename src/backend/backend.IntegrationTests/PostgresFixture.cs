using Npgsql;
using Testcontainers.PostgreSql;

namespace Backend.IntegrationTests;

// One Postgres for the whole collection. Either the server named by
// MOVIESPACES_TEST_PG (assumed superuser — the RLS tests create roles and
// schemas) or a throwaway postgres:16 container.
//
// Every test class in the "postgres" collection shares this instance AND the
// ApiFactory built on it, so the EF migrations run once per test run. Tests
// isolate by using fresh Guids for every group and user rather than by
// truncating tables, which keeps them safe to run in any order.
public sealed class PostgresFixture : IAsyncLifetime
{
    private PostgreSqlContainer? _container;

    public string ConnectionString { get; private set; } = "";
    public ApiFactory Api { get; private set; } = null!;

    // The API's own connection (owner of the EF tables). Superuser on both
    // paths, which matches Supabase: `postgres` owns the EF tables there too,
    // and a table owner bypasses RLS on it — the property the SECURITY
    // DEFINER chat function relies on to read "Groups"/"GroupMembers".
    public NpgsqlConnection OpenConnection()
    {
        var conn = new NpgsqlConnection(ConnectionString);
        conn.Open();
        return conn;
    }

    public async Task InitializeAsync()
    {
        // Every test is Skipped in this case; don't pay for a container that
        // nothing will use (xUnit still constructs collection fixtures).
        if (IntegrationEnvironment.SkipReason != null) return;

        if (IntegrationEnvironment.ExplicitConnectionString is { } explicitCs)
        {
            ConnectionString = explicitCs;
        }
        else
        {
            _container = new PostgreSqlBuilder("postgres:16-alpine")
                .WithDatabase("moviespaces_test")
                .WithUsername("postgres")
                .WithPassword("postgres")
                .Build();
            await _container.StartAsync();
            ConnectionString = _container.GetConnectionString();
        }

        Api = new ApiFactory(ConnectionString);
        // Force the host to build now. Program.cs runs MigrateAsync during
        // startup, so after this the EF schema exists — which the Supabase
        // SQL in ChatRlsTests depends on ("Groups" must exist before the
        // membership function that reads it can be created).
        using var client = Api.CreateClient();
        var health = await client.GetAsync("/health");
        health.EnsureSuccessStatusCode();
    }

    public async Task DisposeAsync()
    {
        if (Api != null) await Api.DisposeAsync();
        if (_container != null) await _container.DisposeAsync();
    }
}

[CollectionDefinition("postgres")]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>
{
}
