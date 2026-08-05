using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;

namespace Backend.Services
{
    // Populates the CineMind puzzle catalog from OMDb.
    //
    // The seed list is a curated set of IMDb ids rather than a "popular
    // movies" API call, for the same reason MoviesController's carousel is:
    // OMDb has no popularity or list endpoint at all, only search and
    // lookup-by-id. Curation is also a feature here — puzzles need films with
    // real cast/director overlap, and a random popularity slice gives you
    // scattered one-off titles that share nobody, which makes The Connection
    // and Cast Deduct ungeneratable.
    //
    // Films are deliberately clustered around recurring collaborators
    // (Nolan/Scorsese/Villeneuve casts, the Marvel and Tarantino ensembles)
    // so shared-person links exist densely enough to build a puzzle every day
    // without repeating the same four titles.
    public class CineMindCatalogService
    {
        private readonly OmdbClient _omdb;
        private readonly ILogger<CineMindCatalogService> _logger;

        public CineMindCatalogService(OmdbClient omdb, ILogger<CineMindCatalogService> logger)
        {
            _omdb = omdb;
            _logger = logger;
        }

        private static readonly string[] SeedImdbIds =
        {
            // Nolan — heavy cast reuse (Caine, Murphy, Hardy, Bale)
            "tt0468569", // The Dark Knight
            "tt1375666", // Inception
            "tt0816692", // Interstellar
            "tt1345836", // The Dark Knight Rises
            "tt0372784", // Batman Begins
            "tt0482571", // The Prestige
            "tt5013056", // Dunkirk
            "tt6723592", // Tenet
            "tt15398776", // Oppenheimer

            // Villeneuve — Gosling, Chalamet, Zendaya, Ferguson
            "tt1160419", // Dune
            "tt15239678", // Dune: Part Two
            "tt1856101", // Blade Runner 2049
            "tt2543164", // Arrival
            "tt3315342", // Logan (Jackman/Stewart bridge)

            // Scorsese — DiCaprio, De Niro, Pesci
            "tt0407887", // The Departed
            "tt0993846", // The Wolf of Wall Street
            "tt1130884", // Shutter Island
            "tt0099685", // Goodfellas
            "tt0075314", // Taxi Driver
            "tt1302006", // The Irishman

            // Tarantino — Jackson, Travolta, Waltz, Pitt, DiCaprio
            "tt0110912", // Pulp Fiction
            "tt0105236", // Reservoir Dogs
            "tt0361748", // Inglourious Basterds
            "tt1853728", // Django Unchained
            "tt7131622", // Once Upon a Time in Hollywood

            // Marvel — very dense ensemble overlap
            "tt4154796", // Avengers: Endgame
            "tt4154756", // Avengers: Infinity War
            "tt0848228", // The Avengers
            "tt1825683", // Black Panther
            "tt10872600", // Spider-Man: No Way Home
            "tt6791350", // Guardians of the Galaxy Vol. 3
            "tt0371746", // Iron Man

            // Modern prestige / awards
            "tt6751668", // Parasite
            "tt6710474", // Everything Everywhere All at Once
            "tt1517268", // Barbie
            "tt2582802", // Whiplash
            "tt0947798", // Black Swan
            "tt1130080", // The Wrestler (Aronofsky link)
            "tt0180093", // Requiem for a Dream
            "tt7286456", // Joker
            "tt8267604", // Parasite-era Bong / spare
            "tt1745960", // Top Gun: Maverick

            // Canon / broad recognition
            "tt0111161", // The Shawshank Redemption
            "tt0068646", // The Godfather
            "tt0071562", // The Godfather Part II
            "tt0137523", // Fight Club
            "tt0109830", // Forrest Gump
            "tt0133093", // The Matrix
            "tt0120737", // LOTR: Fellowship
            "tt0167261", // LOTR: Two Towers
            "tt0167260", // LOTR: Return of the King
            "tt0245429", // Spirited Away
            "tt0114369", // Se7en
            "tt0102926", // The Silence of the Lambs
            "tt0088763", // Back to the Future
            "tt0076759", // Star Wars
            "tt0080684", // The Empire Strikes Back
            "tt0499549", // Avatar
            "tt1630029", // Avatar: The Way of Water
            "tt0120815", // Saving Private Ryan
            "tt0108052", // Schindler's List
            "tt0073486", // One Flew Over the Cuckoo's Nest

            // Wes Anderson — recurring troupe (Murray, Schwartzman, Wilson)
            "tt2278388", // The Grand Budapest Hotel
            "tt0265666", // The Royal Tenenbaums
            "tt5104604", // Isle of Dogs
            "tt0130827", // Rushmore

            // Coen Brothers
            "tt0477348", // No Country for Old Men
            "tt0116282", // Fargo
            "tt0118715", // The Big Lebowski
            "tt0190590", // O Brother, Where Art Thou?

            // Fincher — beyond the two already listed above
            "tt2267998", // Gone Girl
            "tt0443706", // Zodiac
            "tt1285016", // The Social Network

            // Paul Thomas Anderson
            "tt0469494", // There Will Be Blood
            "tt0118749", // Boogie Nights
            "tt5776858", // Phantom Thread

            // Spielberg
            "tt0107290", // Jurassic Park
            "tt0083866", // E.T. the Extra-Terrestrial
            "tt0073195", // Jaws
            "tt0264464", // Catch Me If You Can

            // Pixar / family — near-zero overlap with the rest of the catalog
            // on purpose, so a Mystery Movie pick from here reads as a clean
            // change of pace rather than another awards-cluster title.
            "tt0114709", // Toy Story
            "tt1049413", // Up
            "tt2096673", // Inside Out
            "tt2380307", // Coco
            "tt0266543", // Finding Nemo

            // Horror — its own dense little cluster (Peele, A24)
            "tt5052448", // Get Out
            "tt7784604", // Hereditary
            "tt6644200", // A Quiet Place
            "tt1396484", // It

            // Harry Potter — same three leads across the run
            "tt0241527", // Harry Potter and the Sorcerer's Stone
            "tt0295297", // Harry Potter and the Chamber of Secrets
            "tt1201607", // Harry Potter and the Deathly Hallows: Part 2

            // Greta Gerwig
            "tt4925292", // Lady Bird
            "tt3281548", // Little Women

            // A24 / modern indie
            "tt5727208", // Uncut Gems
            "tt8772262", // Midsommar
            "tt4975722", // Moonlight

            // Animation beyond Pixar
            "tt4633694", // Spider-Man: Into the Spider-Verse
            "tt0126029", // Shrek

            // Recent awards — 2023/24 cycle, not yet represented
            "tt5537002", // Killers of the Flower Moon
            "tt14230458", // Poor Things
            "tt14849194", // The Holdovers

            // Animation, cast-dense — the original 7-title Animation genre had
            // no franchise with 4+ films sharing a voice actor, so Roulette's
            // "Animation" pill could never build a genre-pure Connection or
            // Cast Deduct challenge (see BuildConnectionForMovie/
            // BuildCastDeductForMovie's >=4-film and shared-cast requirements).
            // These are franchises specifically, not just more animated films,
            // so the same voice cast recurs across enough entries to clear
            // that bar within the genre alone.
            "tt0120363", // Toy Story 2 (Hanks/Allen)
            "tt0435761", // Toy Story 3 (Hanks/Allen)
            "tt1979376", // Toy Story 4 (Hanks/Allen)
            "tt0298148", // Shrek 2 (Myers/Murphy/Diaz/Banderas)
            "tt0413267", // Shrek the Third (Myers/Murphy/Diaz/Banderas)
            "tt0892791", // Shrek Forever After (Myers/Murphy/Diaz/Banderas)
            "tt1323594", // Despicable Me (Carell)
            "tt1690953", // Despicable Me 2 (Carell)
            "tt3469046", // Despicable Me 3 (Carell)
            "tt2293640", // Minions (Carell cameo/franchise link)
            "tt0441773", // Kung Fu Panda (Black/Jolie/Hoffman)
            "tt1302011", // Kung Fu Panda 2 (Black/Jolie/Hoffman)
            "tt2267968", // Kung Fu Panda 3 (Black/Jolie/Hoffman)
            "tt2294629", // Frozen (Menzel/Bell/Groff)
            "tt4520988", // Frozen II (Menzel/Bell/Groff)

            // Comedy, cast-dense — the Apatow/Ferrell/Rogen circles reuse the
            // same performers relentlessly, which is exactly what Connection
            // and Cast Deduct need. Before these, Comedy leaned on the Wes
            // Anderson and Coen clusters alone.
            "tt0829482", // Superbad (Hill/Cera/Rogen)
            "tt0478311", // Knocked Up (Rogen/Rudd)
            "tt0405422", // The 40-Year-Old Virgin (Carell/Rogen/Rudd)
            "tt0357413", // Anchorman (Ferrell/Carell/Rudd)
            "tt0838283", // Step Brothers (Ferrell/Reilly)
            "tt0415306", // Talladega Nights (Ferrell/Reilly)
            "tt1245492", // This Is the End (Rogen/Hill/Franco)
            "tt0942385", // Tropic Thunder (Stiller/Downey/Black)
            "tt1478338", // Bridesmaids (Wiig/McCarthy)
            "tt1119646", // The Hangover (Galifianakis/Cooper/Helms)

            // Adventure, franchise-clustered — same reasoning: sequels
            // guarantee the shared-cast density a one-off blockbuster can't.
            "tt0082971", // Raiders of the Lost Ark (Ford)
            "tt0087469", // Indiana Jones and the Temple of Doom (Ford)
            "tt0097576", // Indiana Jones and the Last Crusade (Ford/Connery)
            "tt0325980", // Pirates of the Caribbean: The Curse of the Black Pearl
            "tt0383574", // Pirates of the Caribbean: Dead Man's Chest
            "tt0449088", // Pirates of the Caribbean: At World's End
            "tt0304141", // Harry Potter and the Prisoner of Azkaban
            "tt0330373", // Harry Potter and the Goblet of Fire
            "tt0903624", // The Hobbit: An Unexpected Journey
            "tt0369610", // Jurassic World
        };

        // TV track for Mystery Movie (Easy only, for now). Shorter than the
        // movie catalog on purpose — this only ever needs one unused show per
        // day (unlike the movie catalog, which needs enough density for
        // Connection/Chronos/CastDeduct too).
        private static readonly string[] SeedTvImdbIds =
        {
            "tt0903747", // Breaking Bad
            "tt0944947", // Game of Thrones
            "tt4574334", // Stranger Things
            "tt0386676", // The Office (US)
            "tt0108778", // Friends
            "tt2861424", // Rick and Morty
            "tt1520211", // The Walking Dead
            "tt0475784", // Westworld
            "tt2356777", // True Detective
            "tt1475582", // Sherlock
            "tt0141842", // The Sopranos
            "tt0455275", // Prison Break
            "tt1190634", // The Boys
            "tt0413573", // Grey's Anatomy
            "tt0898266", // The Big Bang Theory
            "tt3107288", // The Crown
            "tt6468322", // Money Heist
            "tt2306299", // Vikings
            "tt1839578", // Peaky Blinders
            "tt0417299", // Avatar: The Last Airbender
            "tt0121955", // South Park
            "tt2707408", // Narcos
            "tt1533395", // Modern Family
            "tt0412142", // House
            "tt1442437", // Curb Your Enthusiasm
            "tt7366338", // Chernobyl
            "tt9140554", // Cobra Kai
            "tt5788792", // The Marvelous Mrs. Maisel
            "tt7908628", // Bridgerton
            "tt0121220", // Sex and the City
        };

        // Upserts every seed film. Idempotent and safe to re-run: existing
        // rows are refreshed rather than duplicated (ImdbId is unique).
        //
        // OMDb's free tier has a daily request cap, so this is a deliberate
        // one-shot admin action rather than something that runs per request.
        public async Task<(int Added, int Updated, int Failed)> SeedAsync(AppDbContext db)
        {
            var existing = await db.CineMindMovies.ToDictionaryAsync(m => m.ImdbId, StringComparer.OrdinalIgnoreCase);
            int added = 0, updated = 0, failed = 0;

            foreach (var imdbId in SeedImdbIds.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var entry = await _omdb.LookupCatalogEntryAsync(imdbId);
                if (entry == null || entry.ReleaseYear == 0)
                {
                    failed++;
                    continue;
                }

                var castJson = JsonSerializer.Serialize(entry.Cast);
                var genresJson = JsonSerializer.Serialize(entry.Genres);

                if (existing.TryGetValue(imdbId, out var row))
                {
                    row.Title = entry.Title;
                    row.ReleaseYear = entry.ReleaseYear;
                    row.PosterPath = entry.PosterUrl ?? row.PosterPath;
                    row.Director = entry.Director ?? row.Director;
                    row.CastJson = castJson;
                    row.GenresJson = genresJson;
                    row.Plot = entry.Plot ?? row.Plot;
                    updated++;
                }
                else
                {
                    db.CineMindMovies.Add(new CineMindMovie
                    {
                        ImdbId = entry.ImdbId,
                        Title = entry.Title,
                        ReleaseYear = entry.ReleaseYear,
                        PosterPath = entry.PosterUrl,
                        Director = entry.Director,
                        CastJson = castJson,
                        GenresJson = genresJson,
                        Plot = entry.Plot,
                        CreatedAt = DateTime.UtcNow,
                    });
                    added++;
                }
            }

            await db.SaveChangesAsync();
            _logger.LogInformation(
                "CineMind catalog seed: {Added} added, {Updated} updated, {Failed} failed.",
                added, updated, failed);

            return (added, updated, failed);
        }

        // Same idempotent upsert-by-ImdbId pattern as SeedAsync, against the
        // separate TV table — see SeedTvImdbIds for why it's a much shorter
        // list, and CineMindTvShow for why there's no Director field to set.
        public async Task<(int Added, int Updated, int Failed)> SeedTvAsync(AppDbContext db)
        {
            var existing = await db.CineMindTvShows.ToDictionaryAsync(m => m.ImdbId, StringComparer.OrdinalIgnoreCase);
            int added = 0, updated = 0, failed = 0;

            foreach (var imdbId in SeedTvImdbIds.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var entry = await _omdb.LookupCatalogEntryAsync(imdbId, mediaType: "series");
                if (entry == null || entry.ReleaseYear == 0)
                {
                    failed++;
                    continue;
                }

                var castJson = JsonSerializer.Serialize(entry.Cast);
                var genresJson = JsonSerializer.Serialize(entry.Genres);

                if (existing.TryGetValue(imdbId, out var row))
                {
                    row.Title = entry.Title;
                    row.ReleaseYear = entry.ReleaseYear;
                    row.PosterPath = entry.PosterUrl ?? row.PosterPath;
                    row.CastJson = castJson;
                    row.GenresJson = genresJson;
                    row.Plot = entry.Plot ?? row.Plot;
                    updated++;
                }
                else
                {
                    db.CineMindTvShows.Add(new CineMindTvShow
                    {
                        ImdbId = entry.ImdbId,
                        Title = entry.Title,
                        ReleaseYear = entry.ReleaseYear,
                        PosterPath = entry.PosterUrl,
                        CastJson = castJson,
                        GenresJson = genresJson,
                        Plot = entry.Plot,
                        CreatedAt = DateTime.UtcNow,
                    });
                    added++;
                }
            }

            await db.SaveChangesAsync();
            _logger.LogInformation(
                "CineMind TV catalog seed: {Added} added, {Updated} updated, {Failed} failed.",
                added, updated, failed);

            return (added, updated, failed);
        }
    }
}
