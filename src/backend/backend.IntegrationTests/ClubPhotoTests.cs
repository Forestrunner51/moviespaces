using System.Net;
using System.Net.Http.Json;
using Backend.Data;
using Backend.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Backend.IntegrationTests;

// POST /api/group/{id}/club-photo — who may set a club's cover image.
//
// The photo is the most visible thing about a club in Discover, and a club
// can hold thousands of members, so this is a real authorization boundary
// rather than a cosmetic setting. It also shares the PosterPath column with
// every other Space type, so the "clubs only" half matters just as much: a
// crew's poster is the film's real art and a member must not overwrite it.
[Collection("postgres")]
public sealed class ClubPhotoTests
{
    private readonly PostgresFixture _pg;

    public ClubPhotoTests(PostgresFixture pg)
    {
        _pg = pg;
    }

    private static string NewUser() => Guid.NewGuid().ToString();
    private const string Photo = "https://example.test/club-cover.jpg";

    private async Task<Group> NewGroupAsync(string hostId, Action<Group> shape, params string[] memberIds)
    {
        using var scope = _pg.Api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var group = new Group
        {
            HostName = "Host",
            UserId = hostId,
            FilmName = "Photo Test",
            MaxCapacity = 5000,
        };
        shape(group);
        group.Members.Add(new GroupMember { GroupId = group.Id, Name = "Host", UserId = hostId, Confirmed = true });
        foreach (var m in memberIds)
            group.Members.Add(new GroupMember { GroupId = group.Id, Name = "Member", UserId = m, Confirmed = true });
        db.Groups.Add(group);
        await db.SaveChangesAsync();
        return group;
    }

    private Task<Group> NewClubAsync(string hostId, params string[] memberIds) =>
        NewGroupAsync(hostId, g =>
        {
            g.IsPublic = true;
            g.GenreCategory = "Horror";
            g.ScreeningTime = null;
        }, memberIds);

    private async Task<string?> PosterOf(Guid groupId)
    {
        using var scope = _pg.Api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Groups.Where(g => g.Id == groupId).Select(g => g.PosterPath).SingleAsync();
    }

    private async Task<HttpResponseMessage> SetPhotoAsync(Guid groupId, string asUser, string? url)
    {
        using var client = _pg.Api.ClientFor(asUser);
        return await client.PostAsJsonAsync($"/api/group/{groupId}/club-photo", new { PhotoUrl = url });
    }

    [IntegrationFact]
    public async Task Host_can_set_and_clear_the_club_photo()
    {
        var host = NewUser();
        var club = await NewClubAsync(host);

        var set = await SetPhotoAsync(club.Id, host, Photo);
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        Assert.Equal(Photo, await PosterOf(club.Id));

        // Empty clears it, restoring the genre-derived fallback.
        var cleared = await SetPhotoAsync(club.Id, host, "");
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        Assert.Null(await PosterOf(club.Id));
    }

    [IntegrationFact]
    public async Task A_member_who_is_not_the_host_cannot_change_it()
    {
        var host = NewUser();
        var member = NewUser();
        var club = await NewClubAsync(host, member);

        var res = await SetPhotoAsync(club.Id, member, Photo);
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Null(await PosterOf(club.Id));
    }

    [IntegrationFact]
    public async Task A_stranger_cannot_change_it()
    {
        var club = await NewClubAsync(NewUser());

        var res = await SetPhotoAsync(club.Id, NewUser(), Photo);
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Null(await PosterOf(club.Id));
    }

    [IntegrationFact]
    public async Task A_crews_film_poster_cannot_be_overwritten_through_this_endpoint()
    {
        // A crew is IsPublic like a club, so "is it public" is not a
        // sufficient check on its own — MatchMovieKey is what separates them.
        var starter = NewUser();
        var crew = await NewGroupAsync(starter, g =>
        {
            g.IsPublic = true;
            g.MatchMovieKey = "theater:imdb:tt0000002";
            g.PosterPath = "https://example.test/real-film-art.jpg";
            g.MaxCapacity = 6;
            g.ScreeningTime = DateTime.UtcNow.AddDays(1);
        });

        var res = await SetPhotoAsync(crew.Id, starter, Photo);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("https://example.test/real-film-art.jpg", await PosterOf(crew.Id));
    }

    [IntegrationFact]
    public async Task A_hosted_space_is_not_a_club_either()
    {
        var host = NewUser();
        var space = await NewGroupAsync(host, g => g.ScreeningTime = DateTime.UtcNow.AddDays(1));

        var res = await SetPhotoAsync(space.Id, host, Photo);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [IntegrationFact]
    public async Task A_non_web_url_is_refused()
    {
        var host = NewUser();
        var club = await NewClubAsync(host);

        // The URL is rendered in an <Image>; javascript:/file:/data: are not
        // things we hand to a renderer.
        foreach (var bad in new[] { "javascript:alert(1)", "file:///etc/passwd", "not a url" })
        {
            var res = await SetPhotoAsync(club.Id, host, bad);
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        }
        Assert.Null(await PosterOf(club.Id));
    }

    [IntegrationFact]
    public async Task An_overlong_url_is_refused_rather_than_hitting_the_column_limit()
    {
        var host = NewUser();
        var club = await NewClubAsync(host);

        var tooLong = "https://example.test/" + new string('a', GroupFieldLimits.Url);
        var res = await SetPhotoAsync(club.Id, host, tooLong);
        // A clear 400, not the DbUpdateException-shaped 500 the varchar cap
        // produced before CheckLength was applied to every write path.
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Null(await PosterOf(club.Id));
    }
}
