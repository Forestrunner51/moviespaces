namespace Backend.Services
{
    // ── Stored payload (includes answers — never sent to a client raw) ──

    public record PuzzleMovie(string ImdbId, string Title, int ReleaseYear, string? PosterPath);

    // Challenge 1 — four films sharing one person; the player names the link.
    public record ConnectionChallenge(
        List<PuzzleMovie> Movies,
        string Answer,             // the shared person's name
        string LinkKind,           // "actor" | "director"
        List<string> Options);     // multiple choice, answer included, shuffled

    // Challenge 2 — order four films oldest → newest.
    public record ChronosChallenge(
        List<PuzzleMovie> Movies,      // presented shuffled
        List<string> CorrectOrder);    // ImdbIds, oldest first

    // Challenge 3 — name the actor shared by exactly two films.
    public record CastDeductChallenge(
        PuzzleMovie MovieA,
        PuzzleMovie MovieB,
        string Answer,
        List<string> Options);

    public record DailyPuzzlePayload(
        ConnectionChallenge Connection,
        ChronosChallenge Chronos,
        CastDeductChallenge CastDeduct);

    // ── Client-facing (answers stripped) ──

    public record ConnectionView(List<PuzzleMovie> Movies, string LinkKind, List<string> Options);

    // Deliberately NOT PuzzleMovie: the release year is the answer to Chronos,
    // so sending it — even unrendered — hands the solution to anyone reading
    // the response body. The client only needs enough to draw the row.
    public record ChronosMovie(string ImdbId, string Title, string? PosterPath);
    public record ChronosView(List<ChronosMovie> Movies);
    public record CastDeductView(PuzzleMovie MovieA, PuzzleMovie MovieB, List<string> Options);

    public record PuzzleView(
        int PuzzleNumber,
        string PuzzleDate,
        ConnectionView Connection,
        ChronosView Chronos,
        CastDeductView CastDeduct);

    // ── Submission ──

    public record SubmittedAnswers(
        string? ConnectionAnswer,
        List<string>? ChronosOrder,   // ImdbIds, oldest first
        string? CastDeductAnswer);

    // DisplayName is optional: an older client that doesn't send it still
    // submits fine and simply shows as "Player" on the global leaderboard.
    public record SubmitRequest(SubmittedAnswers Answers, int TimeTakenMs, string? DisplayName = null);

    public record ChallengeResult(bool Correct, int Points, string? CorrectAnswer);

    public record SubmitResult(
        int Score,
        int MaxScore,
        int TimeTakenMs,
        int StreakCount,
        int PercentileRank,
        ChallengeResult Connection,
        ChallengeResult Chronos,
        ChallengeResult CastDeduct);
}
