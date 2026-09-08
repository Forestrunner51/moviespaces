using Npgsql;

namespace Backend.IntegrationTests;

// Applies the project's hand-written Supabase migrations (supabase/migrations/
// *.sql, in filename order) to the test database, on top of the EF schema.
//
// A plain postgres image has none of the Supabase platform pieces those files
// lean on, so a minimal shim is installed first: the anon/authenticated/
// service_role roles, an `auth` schema with a `users` table and the real
// `auth.uid()` definition (reads the JWT claims GUC), and a `storage` schema
// with `buckets`, `objects` and `foldername()`. The shim mirrors only what
// the migrations touch — it is not a Supabase emulator.
//
// Running every file, in order, is itself a test: the v1 of
// 20260904_chat_requires_confirmed.sql errored on apply in production because
// it used PascalCase names for snake_case columns, and nothing caught it. Now
// the same mistake fails this fixture with the filename in the message.
public static class SupabaseSchema
{
    private const string Shim = """
        do $$
        begin
          if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
          if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
          if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
        end $$;

        create schema if not exists auth;
        create table if not exists auth.users (
          id uuid primary key,
          email text,
          raw_user_meta_data jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        );
        -- Supabase's own definition: the sub claim from request.jwt.claims.
        create or replace function auth.uid() returns uuid
        language sql stable
        as $$
          select coalesce(
            nullif(current_setting('request.jwt.claim.sub', true), ''),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          )::uuid
        $$;
        create or replace function auth.role() returns text
        language sql stable
        as $$
          select coalesce(
            nullif(current_setting('request.jwt.claim.role', true), ''),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
          )::text
        $$;

        create schema if not exists storage;
        create table if not exists storage.buckets (
          id text primary key,
          name text not null,
          public boolean not null default false,
          file_size_limit bigint,
          allowed_mime_types text[]
        );
        create table if not exists storage.objects (
          id uuid primary key default gen_random_uuid(),
          bucket_id text references storage.buckets (id),
          name text,
          owner uuid,
          created_at timestamptz not null default now()
        );
        alter table storage.objects enable row level security;
        create or replace function storage.foldername(name text) returns text[]
        language plpgsql
        as $$
        declare _parts text[];
        begin
          select string_to_array(name, '/') into _parts;
          return _parts[1:array_length(_parts, 1) - 1];
        end
        $$;

        -- Supabase creates this publication on every project; the realtime
        -- migration adds tables to it. Creating it needs no logical WAL.
        do $$
        begin
          if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
            create publication supabase_realtime;
          end if;
        end $$;

        grant usage on schema public, auth, storage to anon, authenticated, service_role;
        grant execute on function auth.uid() to anon, authenticated, service_role;
        grant execute on function auth.role() to anon, authenticated, service_role;
        """;

    // Supabase grants these by default privilege; a plain image does not.
    // Applied AFTER the migrations so every table they create is covered.
    private const string Grants = """
        grant all on all tables in schema public to anon, authenticated, service_role;
        grant all on all sequences in schema public to anon, authenticated, service_role;
        grant execute on all functions in schema public to anon, authenticated, service_role;
        grant all on all tables in schema storage to anon, authenticated, service_role;
        """;

    public static async Task ApplyAsync(NpgsqlConnection conn)
    {
        await Exec(conn, Shim, "shim");

        var dir = FindMigrationsDir();
        var files = Directory.GetFiles(dir, "*.sql").OrderBy(f => Path.GetFileName(f), StringComparer.Ordinal).ToList();
        Assert.NotEmpty(files);
        foreach (var file in files)
            await Exec(conn, await File.ReadAllTextAsync(file), Path.GetFileName(file));

        await Exec(conn, Grants, "grants");
    }

    private static async Task Exec(NpgsqlConnection conn, string sql, string label)
    {
        try
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            await cmd.ExecuteNonQueryAsync();
        }
        catch (PostgresException ex)
        {
            throw new Xunit.Sdk.XunitException(
                $"Supabase SQL '{label}' failed to apply: {ex.SqlState} {ex.MessageText}" +
                (ex.Position > 0 ? $" (at char {ex.Position})" : ""));
        }
    }

    // Walk up from the test assembly to the repo root (the directory holding
    // supabase/migrations) so this works from `dotnet test` in any cwd.
    private static string FindMigrationsDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            var candidate = Path.Combine(dir.FullName, "supabase", "migrations");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate supabase/migrations above " + AppContext.BaseDirectory);
    }

    // Runs `sql` the way PostgREST would for a signed-in user: as the
    // `authenticated` role with the JWT claims GUC set, inside one transaction
    // that is rolled back afterwards (SET LOCAL and set_config(..., true) are
    // transaction-scoped, so nothing leaks between calls).
    public static async Task<T> AsUserAsync<T>(NpgsqlConnection conn, Guid userId, Func<NpgsqlConnection, Task<T>> body)
    {
        await using var tx = await conn.BeginTransactionAsync();
        try
        {
            await using (var cmd = new NpgsqlCommand(
                "set local role authenticated; " +
                "select set_config('request.jwt.claims', @claims, true);", conn))
            {
                cmd.Parameters.AddWithValue("claims", $"{{\"sub\":\"{userId}\",\"role\":\"authenticated\"}}");
                await cmd.ExecuteNonQueryAsync();
            }
            return await body(conn);
        }
        finally
        {
            await tx.RollbackAsync();
        }
    }

    // Same as AsUserAsync but COMMITS, for writes the test wants to keep
    // (e.g. a user inserting a message the policy should allow).
    public static async Task AsUserCommitAsync(NpgsqlConnection conn, Guid userId, Func<NpgsqlConnection, Task> body)
    {
        await using var tx = await conn.BeginTransactionAsync();
        await using (var cmd = new NpgsqlCommand(
            "set local role authenticated; " +
            "select set_config('request.jwt.claims', @claims, true);", conn))
        {
            cmd.Parameters.AddWithValue("claims", $"{{\"sub\":\"{userId}\",\"role\":\"authenticated\"}}");
            await cmd.ExecuteNonQueryAsync();
        }
        try
        {
            await body(conn);
            await tx.CommitAsync();
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }
}
