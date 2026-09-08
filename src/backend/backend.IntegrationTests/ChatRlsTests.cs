using Backend.Data;
using Backend.Models;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Backend.IntegrationTests;

// Who can read and write a group chat, as enforced by the Supabase RLS
// policies on public.group_messages — which call is_group_message_member(),
// a SECURITY DEFINER function that reads the EF-owned "Groups" and
// "GroupMembers" tables. This is the one place the two halves of the data
// model meet, and until now it had no automated coverage: the rule lived in
// a hand-applied SQL file and was checked by opening the app.
//
// The rule (20260904_chat_requires_confirmed.sql):
//   · the host, always
//   · a member who is Confirmed
//   · any member of a crew (match_movie_key set)
//   · any member of a club (is_public without match_movie_key)
//   · any member once the event has passed
// plus, from 20260829: messages from someone you have a block with are hidden.
[Collection("postgres")]
public sealed class ChatRlsTests : IAsyncLifetime
{
    private readonly PostgresFixture _pg;
    private NpgsqlConnection _conn = null!;

    // Applied once per test run, guarded across the (sequential) tests in
    // this collection. The fixture already booted the API, so the EF tables
    // the membership function reads exist.
    private static readonly SemaphoreSlim _applyGate = new(1, 1);
    private static bool _applied;

    public ChatRlsTests(PostgresFixture pg)
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

    private async Task<Group> NewGroupAsync(Guid hostId, Action<Group>? shape = null, params (Guid userId, bool confirmed)[] members)
    {
        using var scope = _pg.Api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var group = new Group
        {
            HostName = "Host",
            UserId = hostId.ToString(),
            FilmName = "RLS Film",
            CinemaName = "RLS Cinema",
            ScreeningTime = DateTime.UtcNow.AddDays(1),
            MaxCapacity = 40,
        };
        shape?.Invoke(group);
        group.Members.Add(new GroupMember { GroupId = group.Id, Name = "Host", UserId = hostId.ToString(), Confirmed = true });
        foreach (var (userId, confirmed) in members)
            group.Members.Add(new GroupMember { GroupId = group.Id, Name = "Member", UserId = userId.ToString(), Confirmed = confirmed });
        db.Groups.Add(group);
        await db.SaveChangesAsync();
        return group;
    }

    // Inserted as the table owner (bypasses RLS) — the fixture for "what is in
    // the chat", independent of whether the sender could write it.
    private async Task SeedMessageAsync(Guid groupId, Guid senderId, string content)
    {
        await using var cmd = new NpgsqlCommand(
            "insert into public.group_messages (group_type, group_id, sender_id, content) values ('group', @g, @s, @c)", _conn);
        cmd.Parameters.AddWithValue("g", groupId);
        cmd.Parameters.AddWithValue("s", senderId);
        cmd.Parameters.AddWithValue("c", content);
        await cmd.ExecuteNonQueryAsync();
    }

    private Task<long> VisibleCountAsync(Guid groupId, Guid asUser) =>
        SupabaseSchema.AsUserAsync(_conn, asUser, async c =>
        {
            await using var cmd = new NpgsqlCommand(
                "select count(*) from public.group_messages where group_type = 'group' and group_id = @g", c);
            cmd.Parameters.AddWithValue("g", groupId);
            return (long)(await cmd.ExecuteScalarAsync())!;
        });

    // True if the insert was allowed, false if RLS refused it (42501).
    private async Task<bool> TryInsertAsync(Guid groupId, Guid asUser)
    {
        try
        {
            await SupabaseSchema.AsUserCommitAsync(_conn, asUser, async c =>
            {
                await using var cmd = new NpgsqlCommand(
                    "insert into public.group_messages (group_type, group_id, sender_id, content) values ('group', @g, @s, 'hi')", c);
                cmd.Parameters.AddWithValue("g", groupId);
                cmd.Parameters.AddWithValue("s", asUser);
                await cmd.ExecuteNonQueryAsync();
            });
            return true;
        }
        catch (PostgresException ex) when (ex.SqlState == "42501")
        {
            return false;
        }
    }

    // ── tests ────────────────────────────────────────────────────────────

    [IntegrationFact]
    public async Task Host_and_confirmed_member_can_read_and_write_a_hosted_space()
    {
        var host = await NewAuthUserAsync();
        var confirmed = await NewAuthUserAsync();
        var group = await NewGroupAsync(host, members: new[] { (confirmed, true) });
        await SeedMessageAsync(group.Id, host, "welcome");

        Assert.Equal(1, await VisibleCountAsync(group.Id, host));
        Assert.Equal(1, await VisibleCountAsync(group.Id, confirmed));
        Assert.True(await TryInsertAsync(group.Id, host));
        Assert.True(await TryInsertAsync(group.Id, confirmed));
    }

    [IntegrationFact]
    public async Task Unconfirmed_member_of_a_future_hosted_space_is_locked_out()
    {
        var host = await NewAuthUserAsync();
        var pending = await NewAuthUserAsync();
        var group = await NewGroupAsync(host, members: new[] { (pending, false) });
        await SeedMessageAsync(group.Id, host, "you can't see this yet");

        // The client hides the Chat button; this is the server saying no to a
        // push deep link or a raw API call that bypasses the button.
        Assert.Equal(0, await VisibleCountAsync(group.Id, pending));
        Assert.False(await TryInsertAsync(group.Id, pending));
    }

    [IntegrationFact]
    public async Task Non_member_sees_nothing_and_cannot_post()
    {
        var host = await NewAuthUserAsync();
        var stranger = await NewAuthUserAsync();
        var group = await NewGroupAsync(host);
        await SeedMessageAsync(group.Id, host, "members only");

        Assert.Equal(0, await VisibleCountAsync(group.Id, stranger));
        Assert.False(await TryInsertAsync(group.Id, stranger));
    }

    [IntegrationFact]
    public async Task Crew_member_chats_without_confirming()
    {
        var starter = await NewAuthUserAsync();
        var seated = await NewAuthUserAsync();
        var crew = await NewGroupAsync(starter,
            g => { g.MatchMovieKey = "theater:imdb:tt0000001"; g.IsPublic = true; g.MaxCapacity = 6; },
            (seated, false));
        await SeedMessageAsync(crew.Id, starter, "who's bringing snacks");

        // Taking a seat IS the commitment — Confirmed is irrelevant for crews.
        Assert.Equal(1, await VisibleCountAsync(crew.Id, seated));
        Assert.True(await TryInsertAsync(crew.Id, seated));
    }

    [IntegrationFact]
    public async Task Club_member_chats_without_confirming()
    {
        var owner = await NewAuthUserAsync();
        var member = await NewAuthUserAsync();
        var club = await NewGroupAsync(owner,
            g => { g.IsPublic = true; g.GenreCategory = "Horror"; g.ScreeningTime = null; g.MaxCapacity = 5000; },
            (member, false));
        await SeedMessageAsync(club.Id, owner, "weekly pick?");

        // A club is a room, not an event — there is nothing to confirm.
        Assert.Equal(1, await VisibleCountAsync(club.Id, member));
        Assert.True(await TryInsertAsync(club.Id, member));
    }

    [IntegrationFact]
    public async Task Unconfirmed_member_can_read_history_once_the_event_has_passed()
    {
        var host = await NewAuthUserAsync();
        var pending = await NewAuthUserAsync();
        var past = await NewGroupAsync(host,
            g => g.ScreeningTime = DateTime.UtcNow.AddHours(-3),
            (pending, false));
        await SeedMessageAsync(past.Id, host, "great film");

        Assert.Equal(1, await VisibleCountAsync(past.Id, pending));
    }

    [IntegrationFact]
    public async Task Messages_are_hidden_across_a_block_in_both_directions()
    {
        var host = await NewAuthUserAsync();
        var alice = await NewAuthUserAsync();
        var bob = await NewAuthUserAsync();
        var group = await NewGroupAsync(host, members: new[] { (alice, true), (bob, true) });
        await SeedMessageAsync(group.Id, alice, "from alice");
        await SeedMessageAsync(group.Id, bob, "from bob");
        await SeedMessageAsync(group.Id, host, "from host");

        Assert.Equal(3, await VisibleCountAsync(group.Id, alice));
        Assert.Equal(3, await VisibleCountAsync(group.Id, bob));

        // Bob blocks Alice, through the blocks table's own insert policy.
        await SupabaseSchema.AsUserCommitAsync(_conn, bob, async c =>
        {
            await using var cmd = new NpgsqlCommand(
                "insert into public.blocks (blocker_id, blocked_id) values (@b, @a)", c);
            cmd.Parameters.AddWithValue("b", bob);
            cmd.Parameters.AddWithValue("a", alice);
            await cmd.ExecuteNonQueryAsync();
        });

        // Each still sees their own message and the host's, but not the other's.
        Assert.Equal(2, await VisibleCountAsync(group.Id, bob));
        Assert.Equal(2, await VisibleCountAsync(group.Id, alice));
        // Unaffected third parties see everything.
        Assert.Equal(3, await VisibleCountAsync(group.Id, host));
    }

    [IntegrationFact]
    public async Task A_member_cannot_post_as_someone_else()
    {
        var host = await NewAuthUserAsync();
        var member = await NewAuthUserAsync();
        var group = await NewGroupAsync(host, members: new[] { (member, true) });

        // sender_id must equal auth.uid(): spoofing the host is refused.
        var allowed = false;
        try
        {
            await SupabaseSchema.AsUserCommitAsync(_conn, member, async c =>
            {
                await using var cmd = new NpgsqlCommand(
                    "insert into public.group_messages (group_type, group_id, sender_id, content) values ('group', @g, @host, 'spoofed')", c);
                cmd.Parameters.AddWithValue("g", group.Id);
                cmd.Parameters.AddWithValue("host", host);
                await cmd.ExecuteNonQueryAsync();
            });
            allowed = true;
        }
        catch (PostgresException ex) when (ex.SqlState == "42501") { }

        Assert.False(allowed);
    }
}
