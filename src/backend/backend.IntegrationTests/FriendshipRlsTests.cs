using Npgsql;

namespace Backend.IntegrationTests;

// Friendships gate DMs: the messages INSERT policy only lets you write to
// someone you have an 'accepted' friendship with. So the friendships policies
// are what stop a stranger from messaging anyone in the app. Until
// 20261010_friendship_forgery_and_storage_listing.sql they didn't: a user
// could insert a request that was already 'accepted', and the receiver of any
// request could rewrite its requester_id to a stranger before accepting.
//
// Also covers the storage half of that file: bucket objects are listable
// only by their owner (the images themselves are served by public URL).
[Collection("postgres")]
public sealed class FriendshipRlsTests : IAsyncLifetime
{
    private readonly PostgresFixture _pg;
    private NpgsqlConnection _conn = null!;

    // Shared with ChatRlsTests' gate would be nicer, but the migrations are
    // idempotent, so applying them once per class is just a little slower.
    private static readonly SemaphoreSlim _applyGate = new(1, 1);
    private static bool _applied;

    public FriendshipRlsTests(PostgresFixture pg)
    {
        _pg = pg;
    }

    public async Task InitializeAsync()
    {
        if (IntegrationEnvironment.SkipReason != null) return;
        _conn = _pg.OpenConnection();
        await _applyGate.WaitAsync();
        try
        {
            if (!_applied)
            {
                await SupabaseSchema.ApplyAsync(_conn);
                _applied = true;
            }
        }
        finally
        {
            _applyGate.Release();
        }
    }

    public async Task DisposeAsync()
    {
        if (_conn != null) await _conn.DisposeAsync();
    }

    // ── helpers ──────────────────────────────────────────────────────────

    // handle_new_user() creates the matching profiles row, which friendships
    // and messages reference.
    private async Task<Guid> NewAuthUserAsync()
    {
        var id = Guid.NewGuid();
        await using var cmd = new NpgsqlCommand(
            "insert into auth.users (id, email, raw_user_meta_data) values (@id, @email, '{\"full_name\":\"Tester\"}')", _conn);
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("email", $"{id}@test.invalid");
        await cmd.ExecuteNonQueryAsync();
        return id;
    }

    // Runs `sql` as `asUser` and commits. Returns rows affected, or null if
    // RLS (or the ids trigger) refused it with 42501.
    private async Task<int?> TryAsUserAsync(Guid asUser, string sql, params (string name, object value)[] args)
    {
        try
        {
            int rows = 0;
            await SupabaseSchema.AsUserCommitAsync(_conn, asUser, async c =>
            {
                await using var cmd = new NpgsqlCommand(sql, c);
                foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);
                rows = await cmd.ExecuteNonQueryAsync();
            });
            return rows;
        }
        catch (PostgresException ex) when (ex.SqlState == "42501")
        {
            return null;
        }
    }

    private Task<int?> RequestAsync(Guid from, Guid to, string status = "pending") =>
        TryAsUserAsync(from,
            "insert into public.friendships (requester_id, receiver_id, status) values (@f, @t, @s)",
            ("f", from), ("t", to), ("s", status));

    private Task<int?> AcceptAsync(Guid asUser, Guid requester, Guid receiver) =>
        TryAsUserAsync(asUser,
            "update public.friendships set status = 'accepted', updated_at = now() where requester_id = @r and receiver_id = @v",
            ("r", requester), ("v", receiver));

    private Task<int?> DmAsync(Guid from, Guid to) =>
        TryAsUserAsync(from,
            "insert into public.messages (sender_id, receiver_id, content) values (@f, @t, 'hi')",
            ("f", from), ("t", to));

    // Read as the table owner, so it shows the real state regardless of RLS.
    private async Task<string?> StatusAsync(Guid requester, Guid receiver)
    {
        await using var cmd = new NpgsqlCommand(
            "select status from public.friendships where requester_id = @r and receiver_id = @v", _conn);
        cmd.Parameters.AddWithValue("r", requester);
        cmd.Parameters.AddWithValue("v", receiver);
        return (string?)await cmd.ExecuteScalarAsync();
    }

    // ── tests ────────────────────────────────────────────────────────────

    [IntegrationFact]
    public async Task Request_then_accept_then_dm_still_works()
    {
        var alice = await NewAuthUserAsync();
        var bob = await NewAuthUserAsync();

        Assert.Equal(1, await RequestAsync(alice, bob));
        Assert.Null(await DmAsync(alice, bob)); // pending isn't friends yet
        Assert.Equal(1, await AcceptAsync(bob, alice, bob));
        Assert.Equal("accepted", await StatusAsync(alice, bob));
        Assert.Equal(1, await DmAsync(alice, bob));
        Assert.Equal(1, await DmAsync(bob, alice));
    }

    [IntegrationFact]
    public async Task A_request_cannot_be_inserted_already_accepted()
    {
        var attacker = await NewAuthUserAsync();
        var victim = await NewAuthUserAsync();

        Assert.Null(await RequestAsync(attacker, victim, status: "accepted"));
        Assert.Null(await StatusAsync(attacker, victim));
        Assert.Null(await DmAsync(attacker, victim));
    }

    [IntegrationFact]
    public async Task The_requester_cannot_accept_their_own_request()
    {
        var alice = await NewAuthUserAsync();
        var bob = await NewAuthUserAsync();
        Assert.Equal(1, await RequestAsync(alice, bob));

        // The USING clause hides the row from the requester: 0 rows, no error.
        Assert.Equal(0, await AcceptAsync(alice, alice, bob));
        Assert.Equal("pending", await StatusAsync(alice, bob));
    }

    [IntegrationFact]
    public async Task The_receiver_cannot_rewrite_who_sent_the_request()
    {
        // The attacker gets a request from an account they control, then
        // tries to retarget it at the victim and accept in one update.
        var attacker = await NewAuthUserAsync();
        var sockPuppet = await NewAuthUserAsync();
        var victim = await NewAuthUserAsync();
        Assert.Equal(1, await RequestAsync(sockPuppet, attacker));

        var rewritten = await TryAsUserAsync(attacker,
            "update public.friendships set requester_id = @v, status = 'accepted' where requester_id = @s and receiver_id = @a",
            ("v", victim), ("s", sockPuppet), ("a", attacker));

        Assert.Null(rewritten);
        Assert.Null(await StatusAsync(victim, attacker));
        Assert.Equal("pending", await StatusAsync(sockPuppet, attacker));
        Assert.Null(await DmAsync(attacker, victim));
    }

    [IntegrationFact]
    public async Task An_accepted_friendship_cannot_be_flipped_back_or_edited()
    {
        var alice = await NewAuthUserAsync();
        var bob = await NewAuthUserAsync();
        Assert.Equal(1, await RequestAsync(alice, bob));
        Assert.Equal(1, await AcceptAsync(bob, alice, bob));

        // Only pending rows are updatable; unfriending is a DELETE.
        var flipped = await TryAsUserAsync(bob,
            "update public.friendships set status = 'pending' where requester_id = @a and receiver_id = @b",
            ("a", alice), ("b", bob));
        Assert.Equal(0, flipped);
        Assert.Equal("accepted", await StatusAsync(alice, bob));
    }

    [IntegrationFact]
    public async Task Storage_objects_are_listable_only_by_their_owner()
    {
        var alice = await NewAuthUserAsync();
        var bob = await NewAuthUserAsync();

        await using (var seed = new NpgsqlCommand("""
            insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true), ('space-photos', 'space-photos', true)
              on conflict (id) do nothing;
            insert into storage.objects (bucket_id, name, owner) values
              ('avatars', @a || '.jpg', @aid), ('space-photos', @a || '/cover.jpg', @aid);
            """, _conn))
        {
            seed.Parameters.AddWithValue("a", alice.ToString());
            seed.Parameters.AddWithValue("aid", alice);
            await seed.ExecuteNonQueryAsync();
        }

        Task<long> VisibleAsync(Guid asUser) => SupabaseSchema.AsUserAsync(_conn, asUser, async c =>
        {
            await using var cmd = new NpgsqlCommand(
                "select count(*) from storage.objects where bucket_id in ('avatars', 'space-photos') and name like @p", c);
            cmd.Parameters.AddWithValue("p", alice + "%");
            return (long)(await cmd.ExecuteScalarAsync())!;
        });

        Assert.Equal(2, await VisibleAsync(alice));
        Assert.Equal(0, await VisibleAsync(bob));
    }
}
