using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Backend.Data;
using Backend.Models;
using Microsoft.Extensions.DependencyInjection;

namespace Backend.IntegrationTests;

// What the API hands to people who aren't signed in.
//
// GET /api/group/open needs no account. Before the 2026-10-10 audit it served
// a watch party's free-text venue ("Sarah's Apartment, Unit 4B"), its
// geocoded coordinates, notes, and attendees' full names to anyone on the
// internet. And every endpoint that resolves a group by its 6-character
// SpaceCode (the only credential on a private Space) was limited only by the
// global 300/min/IP limiter.
[Collection("postgres")]
public sealed class PublicExposureTests
{
    private readonly PostgresFixture _pg;

    public PublicExposureTests(PostgresFixture pg)
    {
        _pg = pg;
    }

    // A distinct filmId per test isolates its rows in the shared open feed.
    private static int NewFilmId() => Random.Shared.Next(1_000_000, int.MaxValue);

    private HttpClient AnonymousClient()
    {
        var client = _pg.Api.CreateClient();
        // Own rate-limit bucket, so these tests can't starve (or be starved by) others.
        client.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.250.{Random.Shared.Next(1, 255)}.{Random.Shared.Next(1, 255)}");
        return client;
    }

    private async Task<Group> NewSpaceAsync(int filmId, Action<Group> shape)
    {
        using var scope = _pg.Api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var hostId = Guid.NewGuid().ToString();
        var group = new Group
        {
            HostName = "Sarah Connor",
            UserId = hostId,
            FilmId = filmId,
            FilmName = "Exposure Test",
            ScreeningTime = DateTime.UtcNow.AddHours(3),
            MaxCapacity = 10,
        };
        shape(group);
        group.Members.Add(new GroupMember { GroupId = group.Id, Name = "Sarah Connor", UserId = hostId, Confirmed = true });
        db.Groups.Add(group);
        await db.SaveChangesAsync();
        return group;
    }

    private async Task<JsonElement> OpenFeedEntryAsync(HttpClient client, int filmId)
    {
        var feed = await client.GetFromJsonAsync<JsonElement>($"/api/group/open?filmId={filmId}");
        return Assert.Single(feed.EnumerateArray());
    }

    [IntegrationFact]
    public async Task Signed_out_visitors_do_not_see_a_home_venue()
    {
        var filmId = NewFilmId();
        await NewSpaceAsync(filmId, g =>
        {
            g.CinemaName = "Sarah's Apartment, 12 Elm St Unit 4B";
            g.TheaterLatitude = 30.27;
            g.TheaterLongitude = -97.74;
            g.HangoutNotes = "Buzz 4B, door code 1984";
        });

        using var client = AnonymousClient();
        var entry = await OpenFeedEntryAsync(client, filmId);

        Assert.DoesNotContain("Elm", entry.GetProperty("cinemaName").GetString());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("theaterLatitude").ValueKind);
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("theaterLongitude").ValueKind);
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("hangoutNotes").ValueKind);
        Assert.Equal("Sarah", entry.GetProperty("hostName").GetString());
        Assert.Equal("Sarah", entry.GetProperty("members")[0].GetProperty("name").GetString());
    }

    [IntegrationFact]
    public async Task Signed_in_users_still_see_the_venue()
    {
        var filmId = NewFilmId();
        await NewSpaceAsync(filmId, g => g.CinemaName = "Sarah's Apartment, 12 Elm St Unit 4B");

        using var client = _pg.Api.ClientFor(Guid.NewGuid().ToString());
        var entry = await OpenFeedEntryAsync(client, filmId);

        Assert.Equal("Sarah's Apartment, 12 Elm St Unit 4B", entry.GetProperty("cinemaName").GetString());
        Assert.Equal("Sarah Connor", entry.GetProperty("hostName").GetString());
    }

    [IntegrationFact]
    public async Task A_google_places_theater_stays_visible_to_signed_out_visitors()
    {
        var filmId = NewFilmId();
        await NewSpaceAsync(filmId, g =>
        {
            g.CinemaName = "AMC Barton Creek 14";
            g.GooglePlaceId = "ChIJ-test-place";
            g.TheaterLatitude = 30.25;
        });

        using var client = AnonymousClient();
        var entry = await OpenFeedEntryAsync(client, filmId);

        Assert.Equal("AMC Barton Creek 14", entry.GetProperty("cinemaName").GetString());
        Assert.Equal(30.25, entry.GetProperty("theaterLatitude").GetDouble());
    }

    [IntegrationFact]
    public async Task Code_lookups_are_throttled_per_ip()
    {
        using var client = AnonymousClient();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 21; i++)
        {
            using var res = await client.GetAsync($"/api/group/resolve/ZZZZ{i:D2}");
            statuses.Add(res.StatusCode);
        }

        Assert.All(statuses.Take(20), s => Assert.Equal(HttpStatusCode.NotFound, s));
        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[20]);
    }
}
