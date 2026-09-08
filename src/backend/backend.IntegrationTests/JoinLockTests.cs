using System.Net;
using System.Net.Http.Json;
using Backend.Data;
using Backend.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Backend.IntegrationTests;

// The seat-taking guarantee: however many people tap Join at the same
// instant, a Space never exceeds MaxCapacity and nobody is seated twice.
//
// GroupController does this with SELECT ... FOR UPDATE on the group row plus
// the unique (GroupId, UserId) index as a backstop. Under Postgres
// read-committed, a transaction alone is NOT enough — two concurrent COUNTs
// both see N-1 and both insert — which is exactly why this needs a real
// database rather than the in-memory provider.
[Collection("postgres")]
public sealed class JoinLockTests
{
    private readonly PostgresFixture _pg;

    public JoinLockTests(PostgresFixture pg)
    {
        _pg = pg;
    }

    private static string NewUser() => Guid.NewGuid().ToString();

    private async Task<Group> CreateHostedSpaceAsync(string hostId, int capacity)
    {
        using var scope = _pg.Api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var group = new Group
        {
            HostName = "Host",
            UserId = hostId,
            FilmName = "Integration Test Film",
            CinemaName = "Test Cinema",
            ShowDate = "Tomorrow",
            ShowTime = "7:00 PM",
            ScreeningTime = DateTime.UtcNow.AddDays(1),
            MaxCapacity = capacity,
            SpaceCode = "TST" + Random.Shared.Next(100, 999),
        };
        // Same as CreateGroup: the host holds a confirmed seat.
        group.Members.Add(new GroupMember { GroupId = group.Id, Name = "Host", UserId = hostId, Confirmed = true });
        db.Groups.Add(group);
        await db.SaveChangesAsync();
        return group;
    }

    private async Task<int> MemberCountAsync(Guid groupId)
    {
        using var scope = _pg.Api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.GroupMembers.CountAsync(m => m.GroupId == groupId);
    }

    [IntegrationFact]
    public async Task Concurrent_joins_never_exceed_capacity()
    {
        const int capacity = 4; // host + 3 seats
        var group = await CreateHostedSpaceAsync(NewUser(), capacity);

        var joiners = Enumerable.Range(0, 12).Select(_ => NewUser()).ToList();
        var responses = await Task.WhenAll(joiners.Select(async userId =>
        {
            using var client = _pg.Api.ClientFor(userId);
            return await client.PostAsJsonAsync($"/api/group/{group.Id}/join", new { Name = "Joiner" });
        }));

        var seated = responses.Count(r => r.StatusCode == HttpStatusCode.OK);
        var refused = responses.Count(r => r.StatusCode == HttpStatusCode.BadRequest);

        Assert.Equal(capacity - 1, seated);
        Assert.Equal(joiners.Count - (capacity - 1), refused);
        Assert.Equal(capacity, await MemberCountAsync(group.Id));
    }

    [IntegrationFact]
    public async Task Same_user_joining_concurrently_is_seated_exactly_once()
    {
        var group = await CreateHostedSpaceAsync(NewUser(), capacity: 40);
        var userId = NewUser();

        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
        {
            using var client = _pg.Api.ClientFor(userId);
            return await client.PostAsJsonAsync($"/api/group/{group.Id}/join", new { Name = "Twin Tapper" });
        }));

        // Every response is either "seated" or "you're already in" — never a
        // 500 from the unique index, and never a silent duplicate row.
        Assert.All(responses, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }));
        Assert.Contains(responses, r => r.StatusCode == HttpStatusCode.OK);

        using var scope = _pg.Api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.GroupMembers.CountAsync(m => m.GroupId == group.Id && m.UserId == userId));
    }

    [IntegrationFact]
    public async Task Crew_seats_never_exceed_six_under_concurrent_match_joins()
    {
        // Start a theater crew the way the app does: POST /api/group/match
        // with a concrete showing.
        var starter = NewUser();
        var showing = DateTime.UtcNow.AddDays(2);
        Guid crewId;
        using (var client = _pg.Api.ClientFor(starter))
        {
            var res = await client.PostAsJsonAsync("/api/group/match", new
            {
                MovieTitle = "Integration Crew Film",
                ImdbId = "tt" + Random.Shared.Next(1000000, 9999999),
                HostName = "Starter",
                Kind = "theater",
                CinemaName = "Lock Test Cinema",
                ScreeningTime = showing,
                ShowDate = "Soon",
                ShowTime = "8:00 PM",
            });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var body = await res.Content.ReadFromJsonAsync<MatchResponse>();
            Assert.NotNull(body);
            crewId = body!.groupId;
        }

        // Fifteen strangers pick that crew from the "already forming" list at
        // the same moment. Read the crew's film key back so the join carries
        // the same identity the starter used.
        string imdbId;
        using (var scope = _pg.Api.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var crew = await db.Groups.SingleAsync(g => g.Id == crewId);
            Assert.Equal(GroupController_MatchCrewSize, crew.MaxCapacity);
            imdbId = crew.MatchMovieKey!.Replace("theater:imdb:", "");
        }

        var responses = await Task.WhenAll(Enumerable.Range(0, 15).Select(async _ =>
        {
            using var client = _pg.Api.ClientFor(NewUser());
            return await client.PostAsJsonAsync("/api/group/match", new
            {
                MovieTitle = "Integration Crew Film",
                ImdbId = imdbId,
                HostName = "Joiner",
                Kind = "theater",
                JoinGroupId = crewId,
            });
        }));

        var seated = responses.Count(r => r.StatusCode == HttpStatusCode.OK);
        Assert.Equal(GroupController_MatchCrewSize - 1, seated);
        Assert.Equal(GroupController_MatchCrewSize, await MemberCountAsync(crewId));
    }

    // Mirrors GroupController.MatchCrewSize, which is public const there.
    private static int GroupController_MatchCrewSize => Backend.Controllers.GroupController.MatchCrewSize;

    private sealed record MatchResponse(Guid groupId);
}
