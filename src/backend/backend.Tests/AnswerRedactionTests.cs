using System.Text.Json;
using Backend.Models;
using Backend.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Backend.Tests;

// The daily puzzle is one shared puzzle for everyone, so the answer key
// leaking would break the format for the whole player base at once, not just
// for the leaker. ToClientView is the only thing standing between the stored
// payload (which holds every answer) and the response body.
//
// These assert against the SERIALIZED view rather than its properties: the
// risk isn't "did someone read the wrong field", it's "did an answer end up
// in the JSON at all" — including via a field added later that nobody
// remembered to strip.
public class AnswerRedactionTests
{
    private static DailyPuzzleService Service() =>
        new(
            new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["CineMind:PuzzleSalt"] = "test-salt",
                })
                .Build(),
            NullLogger<DailyPuzzleService>.Instance);

    private static string SerializedView(DailyPuzzlePayload payload)
    {
        var puzzle = new DailyPuzzle
        {
            PuzzleDate = new DateOnly(2026, 8, 6),
            PuzzleNumber = 218,
            ChallengePayloadJson = "{}",
        };
        return JsonSerializer.Serialize(Service().ToClientView(puzzle, payload));
    }

    [Fact]
    public void Client_view_never_contains_the_connection_answer()
    {
        var payload = PuzzleFixtures.Payload();

        // The answer is legitimately present as one of the multiple-choice
        // options, so its mere presence proves nothing — what must not appear
        // is a field identifying WHICH option is right.
        var json = SerializedView(payload);

        Assert.DoesNotContain("\"Answer\"", json);
        Assert.DoesNotContain("\"answer\"", json);
    }

    [Fact]
    public void Client_view_never_contains_the_mystery_answer_or_title()
    {
        var payload = PuzzleFixtures.Payload();

        var json = SerializedView(payload);

        // Mystery Movie/TV hide only the target's identity — every other clue
        // is meant to be seen. These two are the identity.
        Assert.DoesNotContain("tt-mystery", json);
        Assert.DoesNotContain("The Mystery Film", json);
    }

    [Fact]
    public void Chronos_view_omits_release_years_because_the_year_IS_the_answer()
    {
        // Chronos asks the player to order films by release year. Shipping the
        // years — even unrendered — hands over the solution to anyone reading
        // the response body, which is why ChronosMovie exists separately from
        // PuzzleMovie.
        var payload = PuzzleFixtures.Payload();

        var view = Service().ToClientView(
            new DailyPuzzle { PuzzleDate = new DateOnly(2026, 8, 6), PuzzleNumber = 1 },
            payload);
        var chronosJson = JsonSerializer.Serialize(view.Chronos);

        Assert.DoesNotContain("ReleaseYear", chronosJson);
        Assert.DoesNotContain("1990", chronosJson);
        Assert.DoesNotContain("2020", chronosJson);
    }

    [Fact]
    public void Chronos_view_omits_the_correct_order()
    {
        var view = Service().ToClientView(
            new DailyPuzzle { PuzzleDate = new DateOnly(2026, 8, 6), PuzzleNumber = 1 },
            PuzzleFixtures.Payload());

        Assert.DoesNotContain("CorrectOrder", JsonSerializer.Serialize(view.Chronos));
    }

    [Fact]
    public void Client_view_still_carries_what_the_player_needs_to_play()
    {
        // The mirror of the assertions above — redaction that also stripped
        // the posters/options would "pass" every test here while shipping an
        // unplayable puzzle.
        var view = Service().ToClientView(
            new DailyPuzzle { PuzzleDate = new DateOnly(2026, 8, 6), PuzzleNumber = 218 },
            PuzzleFixtures.Payload());

        Assert.Equal(218, view.PuzzleNumber);
        Assert.Equal(4, view.Connection.Movies.Count);
        Assert.Contains("Tom Hardy", view.Connection.Options);
        Assert.Equal(4, view.Chronos.Movies.Count);
        Assert.Contains("Cillian Murphy", view.CastDeduct.Options);
        Assert.Equal(2021, view.MysteryMovie.ReleaseYear);
        Assert.Equal("tv", view.MysteryTv.MediaType);
    }
}
