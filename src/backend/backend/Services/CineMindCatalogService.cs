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
        };

        // TV track for Mystery Movie (Easy only, for now). Much shorter than
        // the movie catalog on purpose — this only ever needs one unused show
        // per day (unlike the movie catalog, which needs enough density for
        // Connection/Chronos/CastDeduct too), so ~20 mainstream, widely-known
        // shows is plenty to start. Will feel repetitive sooner than the
        // movie catalog if never expanded — same disclosed tradeoff already
        // accepted for the movie list at launch size.
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
