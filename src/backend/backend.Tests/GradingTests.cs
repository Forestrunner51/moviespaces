using Backend.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Backend.Tests;

// Grading is where a bug is least likely to be noticed and most damaging:
// a wrong score is persisted, counted into the streak, and published to the
// global leaderboard, and unlike a crash nobody reports it.
public class GradingTests
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

    [Fact]
    public void A_perfect_submission_scores_exactly_MaxScore()
    {
        var payload = PuzzleFixtures.Payload();

        var result = Service().Grade(payload, PuzzleFixtures.PerfectAnswers(payload), 60_000);

        Assert.Equal(DailyPuzzleService.MaxScore, result.Score);
        Assert.True(result.Connection.Correct);
        Assert.True(result.Chronos.Correct);
        Assert.True(result.CastDeduct.Correct);
        Assert.True(result.MysteryMovie.Correct);
        Assert.True(result.MysteryTv.Correct);
    }

    [Fact]
    public void An_empty_submission_scores_zero_and_reveals_every_answer()
    {
        var payload = PuzzleFixtures.Payload();

        var result = Service().Grade(
            payload, new SubmittedAnswers(null, null, null), 60_000);

        Assert.Equal(0, result.Score);
        // CorrectAnswer is populated only when wrong — that's what the results
        // screen renders as "Answer: …".
        Assert.Equal("Tom Hardy", result.Connection.CorrectAnswer);
        Assert.Equal("Cillian Murphy", result.CastDeduct.CorrectAnswer);
        Assert.Equal("The Mystery Film", result.MysteryMovie.CorrectAnswer);
    }

    [Fact]
    public void A_correct_answer_does_not_leak_the_answer_back()
    {
        // The inverse of the above: on a correct challenge CorrectAnswer must
        // stay null, so the results payload of someone who got it right can't
        // be handed to someone who hasn't played.
        var payload = PuzzleFixtures.Payload();

        var result = Service().Grade(payload, PuzzleFixtures.PerfectAnswers(payload), 1000);

        Assert.Null(result.Connection.CorrectAnswer);
        Assert.Null(result.Chronos.CorrectAnswer);
        Assert.Null(result.MysteryMovie.CorrectAnswer);
    }

    [Fact]
    public void Text_answers_are_case_and_whitespace_insensitive()
    {
        // The player picks from options rather than typing, but the comparison
        // is documented as forgiving and the client could round-trip whitespace.
        var payload = PuzzleFixtures.Payload();

        var result = Service().Grade(
            payload,
            new SubmittedAnswers("  tom hardy  ", null, "CILLIAN MURPHY"),
            1000);

        Assert.True(result.Connection.Correct);
        Assert.True(result.CastDeduct.Correct);
    }

    [Fact]
    public void Chronos_requires_the_exact_order()
    {
        var payload = PuzzleFixtures.Payload();
        var reversed = Enumerable.Reverse(payload.Chronos.CorrectOrder).ToList();

        var result = Service().Grade(
            payload, new SubmittedAnswers(null, reversed, null), 1000);

        Assert.False(result.Chronos.Correct);
        Assert.Equal(0, result.Chronos.Points);
    }

    [Fact]
    public void Chronos_rejects_a_partial_ordering()
    {
        // Fewer films than the puzzle asked for must not grade as correct just
        // because the ones present happen to be in order.
        var payload = PuzzleFixtures.Payload();
        var partial = payload.Chronos.CorrectOrder.Take(2).ToList();

        var result = Service().Grade(
            payload, new SubmittedAnswers(null, partial, null), 1000);

        Assert.False(result.Chronos.Correct);
    }

    [Theory]
    // easy: 4 attempts, 100/75/50/25
    [InlineData("easy", 1, 100)]
    [InlineData("easy", 2, 75)]
    [InlineData("easy", 3, 50)]
    [InlineData("easy", 4, 25)]
    // medium: 3 attempts, 100/60/30
    [InlineData("medium", 1, 100)]
    [InlineData("medium", 2, 60)]
    [InlineData("medium", 3, 30)]
    // hard: 2 attempts, 100/40
    [InlineData("hard", 1, 100)]
    [InlineData("hard", 2, 40)]
    // An unrecognised or absent difficulty grades as easy rather than throwing
    // or zeroing — an older client that doesn't send the field still scores.
    [InlineData("nonsense", 2, 75)]
    [InlineData(null, 2, 75)]
    public void Mystery_points_scale_with_attempts_per_difficulty(
        string? difficulty, int attemptsUsed, int expectedPoints)
    {
        var payload = PuzzleFixtures.Payload();

        var result = Service().Grade(
            payload,
            new SubmittedAnswers(
                null, null, null,
                MysteryMovieGuess: payload.MysteryMovie.Answer,
                MysteryMovieAttemptsUsed: attemptsUsed,
                MysteryMovieDifficulty: difficulty),
            1000);

        Assert.Equal(expectedPoints, result.MysteryMovie.Points);
    }

    [Theory]
    [InlineData("easy")]
    [InlineData("medium")]
    [InlineData("hard")]
    public void Every_difficulty_tops_out_at_the_same_score(string difficulty)
    {
        // Load-bearing invariant, not a style preference: the leaderboard's
        // percentile maths and the stats endpoint's "perfect score" both assume
        // a single fixed MaxScore for every player. A difficulty that could
        // score higher would silently break both.
        var payload = PuzzleFixtures.Payload();

        var result = Service().Grade(
            payload,
            new SubmittedAnswers(
                payload.Connection.Answer,
                payload.Chronos.CorrectOrder,
                payload.CastDeduct.Answer,
                MysteryMovieGuess: payload.MysteryMovie.Answer,
                MysteryMovieAttemptsUsed: 1,
                MysteryMovieDifficulty: difficulty,
                MysteryTvGuess: payload.MysteryTv.Answer,
                MysteryTvAttemptsUsed: 1),
            1000);

        Assert.Equal(DailyPuzzleService.MaxScore, result.Score);
    }

    [Fact]
    public void A_wrong_mystery_guess_scores_zero_regardless_of_attempts()
    {
        var payload = PuzzleFixtures.Payload();

        var result = Service().Grade(
            payload,
            new SubmittedAnswers(
                null, null, null,
                MysteryMovieGuess: "tt-some-other-film",
                MysteryMovieAttemptsUsed: 1,
                MysteryMovieDifficulty: "easy"),
            1000);

        Assert.False(result.MysteryMovie.Correct);
        Assert.Equal(0, result.MysteryMovie.Points);
    }

    [Fact]
    public void Time_taken_is_carried_through_untouched()
    {
        var result = Service().Grade(
            PuzzleFixtures.Payload(), new SubmittedAnswers(null, null, null), 123_456);

        Assert.Equal(123_456, result.TimeTakenMs);
    }

    // ── Roulette practice grading ─────────────────────────────────────────
    //
    // Shares the grading helpers with the daily puzzle but must never award
    // streak/leaderboard state — it returns a bare ChallengeResult, and these
    // pin that it grades the same way the daily equivalent does.

    [Fact]
    public void Practice_connection_grades_like_the_daily_one()
    {
        var challenge = PuzzleFixtures.Connection();

        var right = Service().GradePracticeChallenge(
            "connection", challenge, new SubmittedAnswers("Tom Hardy", null, null));
        var wrong = Service().GradePracticeChallenge(
            "connection", challenge, new SubmittedAnswers("Wrong A", null, null));

        Assert.True(right.Correct);
        Assert.False(wrong.Correct);
        Assert.Equal("Tom Hardy", wrong.CorrectAnswer);
    }

    [Fact]
    public void Practice_chronos_grades_on_exact_order()
    {
        var challenge = PuzzleFixtures.Chronos();

        var right = Service().GradePracticeChallenge(
            "chronos", challenge, new SubmittedAnswers(null, challenge.CorrectOrder, null));
        var wrong = Service().GradePracticeChallenge(
            "chronos", challenge,
            new SubmittedAnswers(null, Enumerable.Reverse(challenge.CorrectOrder).ToList(), null));

        Assert.True(right.Correct);
        Assert.False(wrong.Correct);
    }

    [Fact]
    public void An_unknown_practice_challenge_type_throws_rather_than_scoring()
    {
        // Silently returning "incorrect" for a type the server doesn't
        // recognise would hide a real deployment mismatch behind a wrong answer.
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            Service().GradePracticeChallenge(
                "not-a-type", PuzzleFixtures.Connection(), new SubmittedAnswers(null, null, null)));
    }
}
