namespace Backend.Models
{
    // Pure, DB-free rules about a Space's schedule, shared by every write
    // path that sets a ScreeningTime (CreateGroup's MatchForMovie sibling,
    // EditGroup) so they can't disagree — and so backend.Tests can pin them.
    public static class GroupRules
    {
        public const string ScreeningTimePassedMessage =
            "That showing has already started — pick a later one.";

        // A showing that has already started (or starts right now) isn't a
        // plan anyone can still join. Both instants must be UTC.
        public static bool ScreeningTimeHasPassed(DateTime screeningTimeUtc, DateTime nowUtc) =>
            screeningTimeUtc <= nowUtc;
    }
}
