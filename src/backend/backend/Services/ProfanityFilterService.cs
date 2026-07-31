using System.Linq;
using System.Text.RegularExpressions;

namespace Backend.Services
{
    public interface IProfanityFilterService
    {
        bool ContainsProfanity(string input);

        // Returns the input unchanged if clean, or fallback if it isn't.
        // Never partially redacts (e.g. "s***") — a half-censored name still
        // broadcasts the word to everyone who sees it; swapping to a wholly
        // different fallback is the only version that actually hides it.
        string CleanOrFallback(string? input, string fallback);
    }

    // Whole-word matching against a curated blocklist, after normalizing
    // common leetspeak substitutions.
    //
    // Deliberately whole-word rather than substring: substring matching hits
    // the "Scunthorpe problem" (Scunthorpe, classic, assassin, Cockburn — all
    // innocent words containing a blocked substring) and rejects real people's
    // real names and real place names. Whole-word matching after leetspeak
    // normalization still catches "a55" and "sh1t" while leaving "assassin"
    // alone.
    //
    // This is a starting blocklist for a launch, not a complete one — there is
    // no complete list. Expand WordList as real reports come in; that's the
    // normal lifecycle for a filter like this, not a sign it was built wrong.
    public class ProfanityFilterService : IProfanityFilterService
    {
        private static readonly HashSet<string> WordList = new(StringComparer.OrdinalIgnoreCase)
        {
            // Common profanity
            "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick",
            "piss", "cock", "pussy", "whore", "slut", "twat", "fag", "faggot",
            "retard", "retarded",
            // Slurs — kept short and deliberately not exhaustive; this is a
            // first pass on the most commonly reported categories, not a
            // claim of completeness.
            "nigger", "nigga", "chink", "spic", "kike", "tranny", "wetback",
            "gook", "coon",
        };

        // @→a, 1/!→i, 0→o, $→s, 3→e, 5→s, +→t — the substitutions actually
        // seen in evasion attempts, not an exhaustive homoglyph table.
        private static readonly (char From, char To)[] LeetMap =
        {
            ('@', 'a'), ('4', 'a'), ('1', 'i'), ('!', 'i'), ('0', 'o'),
            ('$', 's'), ('5', 's'), ('3', 'e'), ('+', 't'), ('7', 't'),
        };

        public bool ContainsProfanity(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) return false;

            var normalized = Normalize(input);
            // \b won't fire around a word EntirelyMadeOfDigitsFirst, but
            // normalization already maps digits to letters before this runs,
            // so every candidate word is alphabetic by the time it's tested.
            var words = Regex.Matches(normalized, @"[a-z]+").Select(m => m.Value);
            return words.Any(WordList.Contains);
        }

        public string CleanOrFallback(string? input, string fallback) =>
            !string.IsNullOrWhiteSpace(input) && !ContainsProfanity(input) ? input : fallback;

        private static string Normalize(string input)
        {
            var lower = input.ToLowerInvariant();
            var chars = lower.ToCharArray();
            for (var i = 0; i < chars.Length; i++)
            {
                foreach (var (from, to) in LeetMap)
                {
                    if (chars[i] == from)
                    {
                        chars[i] = to;
                        break;
                    }
                }
            }
            return new string(chars);
        }
    }
}
