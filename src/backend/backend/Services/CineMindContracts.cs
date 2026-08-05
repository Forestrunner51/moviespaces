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

    // Challenge 4 — Mystery Movie. Guess the hidden film (or, for the TV
    // track, show) from progressively revealed clues. Difficulty (chosen
    // client-side, reported back at grading time) controls how many attempts
    // are allowed and how many clue tiers get shown — see
    // DailyPuzzleService.GradeMysteryItem for the actual scoring curve.
    //
    // Every field here except Answer and AnswerTitle is NOT secret —
    // revealing facts about the target IS the gameplay, not a leak. The
    // client gets every clue upfront and controls reveal timing locally; the
    // only thing withheld until solved/failed is the target's own identity.
    //
    // Reused for both the movie (challenge 4) and TV (challenge 5) targets
    // rather than two near-identical types — the only structural difference
    // is Director, which is always null for a TV entry (OMDb's Director
    // field is unreliable for a series — see CineMindTvShow). MediaType
    // tells the client which catalog to search for guesses and which label
    // to show ("🎬 Movie" vs "📺 TV Show").
    //
    // Tiers use only fields OMDb actually provides — no tagline field exists
    // in its schema at all, so tiers are built from what's real: Year(+
    // Director for movies), Genres, Plot, then Cast+Poster.
    public record MysteryMovieChallenge(
        string MediaType,        // "movie" | "tv"
        string Answer,           // target ImdbId — the one thing kept hidden
        string AnswerTitle,      // shown only after solved/failed, for the reveal
        string? Director,        // always null when MediaType == "tv"
        List<string> Cast,
        List<string> Genres,
        int ReleaseYear,
        string? Plot,
        string? PosterPath);

    public record DailyPuzzlePayload(
        ConnectionChallenge Connection,
        ChronosChallenge Chronos,
        CastDeductChallenge CastDeduct,
        MysteryMovieChallenge MysteryMovie,
        MysteryMovieChallenge MysteryTv);

    // ── Roulette (practice, single ad-hoc challenge) ──
    //
    // Deliberately reuses ConnectionChallenge/ChronosChallenge/CastDeductChallenge
    // and their *View counterparts below rather than inventing parallel types —
    // a practice challenge is structurally identical to a daily one, just built
    // around a chosen movie instead of a seeded date, and graded once instead
    // of stored per-user.

    // No ReleaseYear, unlike PuzzleMovie — deliberately, and for the same
    // reason ChronosMovie has none: when the spin's challenge type happens to
    // be Chronos, this movie IS one of the four the player is ordering, so
    // showing its year here would hand over one of the four answers before
    // the challenge even starts. The reveal card only ever needs poster +
    // title anyway; per-challenge views carry whatever year info is actually
    // safe to show for that challenge type.
    public record RouletteMovie(string ImdbId, string Title, string? PosterPath);

    // Challenge is one of ConnectionChallenge/ChronosChallenge/CastDeductChallenge
    // (holds the answer — server-side only, never returned to the client).
    //
    // No "was this genre-pure?" flag: when a genre is requested, every film in
    // the challenge comes from that genre or the spin isn't built at all (see
    // BuildPracticeSpinAsync). There is no mixed-genre outcome to report.
    public record PracticeSpin(string SpinId, RouletteMovie Movie, string ChallengeType, object Challenge);

    // Challenge here is the matching *View type (answer stripped).
    public record PracticeSpinView(RouletteMovie Movie, string ChallengeType, object Challenge);

    public record PracticeGradeRequest(string SpinId, SubmittedAnswers Answer);

    // ── Client-facing (answers stripped) ──

    public record ConnectionView(List<PuzzleMovie> Movies, string LinkKind, List<string> Options);

    // Deliberately NOT PuzzleMovie: the release year is the answer to Chronos,
    // so sending it — even unrendered — hands the solution to anyone reading
    // the response body. The client only needs enough to draw the row.
    public record ChronosMovie(string ImdbId, string Title, string? PosterPath);
    public record ChronosView(List<ChronosMovie> Movies);
    public record CastDeductView(PuzzleMovie MovieA, PuzzleMovie MovieB, List<string> Options);

    // No Answer/AnswerTitle — see MysteryMovieChallenge for why everything
    // else here is safe to send whole.
    public record MysteryMovieView(
        string MediaType,
        string? Director,
        List<string> Cast,
        List<string> Genres,
        int ReleaseYear,
        string? Plot,
        string? PosterPath);

    public record PuzzleView(
        int PuzzleNumber,
        string PuzzleDate,
        ConnectionView Connection,
        ChronosView Chronos,
        CastDeductView CastDeduct,
        MysteryMovieView MysteryMovie,
        MysteryMovieView MysteryTv);

    // ── Submission ──

    public record SubmittedAnswers(
        string? ConnectionAnswer,
        List<string>? ChronosOrder,   // ImdbIds, oldest first
        string? CastDeductAnswer,
        // Defaulted, not required: Roulette also reuses SubmittedAnswers for
        // its (Connection/Chronos/CastDeduct-only) practice challenges, which
        // never populate these.
        string? MysteryMovieGuess = null,   // final guessed ImdbId, or null if given up
        int MysteryMovieAttemptsUsed = 0,   // 1-4
        // "easy" | "medium" | "hard" — chosen client-side before the first
        // guess and reported back here; unrecognized/missing values grade as
        // easy. Every difficulty still tops out at 100 pts (see
        // DailyPuzzleService.GradeMysteryItem) — harder means fewer attempts
        // and fewer clue tiers shown, not a bigger prize, so the leaderboard
        // and "perfect score" never need to know which difficulty was played.
        string? MysteryMovieDifficulty = null,
        // TV track is Easy-only for now, so no difficulty field for it.
        string? MysteryTvGuess = null,
        int MysteryTvAttemptsUsed = 0);

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
        ChallengeResult CastDeduct,
        ChallengeResult MysteryMovie,
        ChallengeResult MysteryTv,
        // The UserDailyProgress row's own id, not a separate generated
        // token — it's already an unguessable Guid and doesn't leak the
        // Supabase user id the way using UserId in a public URL would.
        // Filled in by the controller (which owns the row); left as
        // Guid.Empty here so Grade() itself stays pure or DB access.
        Guid ShareId = default);
}
