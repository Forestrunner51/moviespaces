using Backend.Services;

namespace Backend.Tests;

// Shared builders for a structurally valid puzzle payload.
//
// Deliberately hand-built rather than generated through DailyPuzzleService's
// own Generate(): these tests need to assert things ABOUT generation and
// grading, so constructing the input independently is what makes them able to
// catch a regression in that code rather than moving in lockstep with it.
internal static class PuzzleFixtures
{
    public static PuzzleMovie Movie(string id, int year = 2000) =>
        new(id, $"Title {id}", year, $"https://poster/{id}.jpg");

    public static ConnectionChallenge Connection(string answer = "Tom Hardy") =>
        new(
            new List<PuzzleMovie> { Movie("tt1"), Movie("tt2"), Movie("tt3"), Movie("tt4") },
            answer,
            "actor",
            new List<string> { "Wrong A", answer, "Wrong B", "Wrong C" });

    // Presented deliberately out of order so a test asserting the correct
    // sequence isn't accidentally satisfied by the presentation order.
    public static ChronosChallenge Chronos() =>
        new(
            new List<PuzzleMovie>
            {
                Movie("tt-c3", 2010),
                Movie("tt-c1", 1990),
                Movie("tt-c4", 2020),
                Movie("tt-c2", 2000),
            },
            new List<string> { "tt-c1", "tt-c2", "tt-c3", "tt-c4" });

    public static CastDeductChallenge CastDeduct(string answer = "Cillian Murphy") =>
        new(
            Movie("tt-a"),
            Movie("tt-b"),
            answer,
            new List<string> { "Wrong A", answer, "Wrong B", "Wrong C" });

    public static MysteryMovieChallenge Mystery(
        string mediaType = "movie", string answer = "tt-mystery") =>
        new(
            mediaType,
            answer,
            "The Mystery Film",
            mediaType == "tv" ? null : "Denis Villeneuve",
            new List<string> { "Actor One", "Actor Two" },
            new List<string> { "Sci-Fi" },
            2021,
            "A plot.",
            "https://poster/mystery.jpg");

    // Tagged with the current version, mirroring what Generate() persists —
    // an untagged fixture would exercise the legacy fallback path instead of
    // the normal one.
    public static DailyPuzzlePayload Payload() =>
        new(
            Connection(), Chronos(), CastDeduct(), Mystery(), Mystery("tv", "tt-mystery-tv"),
            DailyPuzzlePayload.CurrentSchemaVersion);

    // Every answer correct, at one attempt each on easy — the maximum-score
    // submission.
    public static SubmittedAnswers PerfectAnswers(DailyPuzzlePayload p) =>
        new(
            ConnectionAnswer: p.Connection.Answer,
            ChronosOrder: p.Chronos.CorrectOrder,
            CastDeductAnswer: p.CastDeduct.Answer,
            MysteryMovieGuess: p.MysteryMovie.Answer,
            MysteryMovieAttemptsUsed: 1,
            MysteryMovieDifficulty: "easy",
            MysteryTvGuess: p.MysteryTv.Answer,
            MysteryTvAttemptsUsed: 1);
}
