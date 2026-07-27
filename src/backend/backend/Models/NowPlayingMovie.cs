using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // A film currently playing in theaters, discovered by the nightly Apify
    // CinemaClock scrape and enriched with metadata from OMDb.
    //
    // Title is the natural key: the scraper only gives us a display title, so
    // that's the only thing we can dedupe on across runs (upsert target).
    //
    // NOTE: the spec this was built from named the metadata column `tmdb_id`.
    // This project deliberately moved off TMDb (its free tier bars commercial
    // use) to OMDb, so we store OMDb's `imdbId` instead — which is also what
    // the rest of the app already uses as its movie identifier. There is no
    // `backdrop_url` for the same reason: OMDb has no backdrop concept, and a
    // column that can never be populated is just dead schema.
    [Table("now_playing_movies")]
    public class NowPlayingMovie
    {
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("title")]
        [MaxLength(255)]
        public string Title { get; set; } = "";

        [Column("imdb_id")]
        public string? ImdbId { get; set; }

        [Column("overview")]
        public string? Overview { get; set; }

        [Column("poster_url")]
        public string? PosterUrl { get; set; }

        [Column("vote_average")]
        public decimal? VoteAverage { get; set; }

        [Column("release_date")]
        public DateTime? ReleaseDate { get; set; }

        [Column("updated_at")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public List<Showtime> Showtimes { get; set; } = new();
    }
}
