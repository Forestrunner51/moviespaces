using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // The CineMind puzzle catalog: films with the DIRECTOR and CAST that
    // puzzle generation needs to find shared-person connections.
    //
    // Deliberately separate from `now_playing_movies`, which the showtime
    // ingest owns — that table is upserted by title and purged as showtimes
    // expire, so a puzzle referencing one of its rows could have the row
    // vanish underneath it. This catalog is append-mostly and stable, which
    // is what a deterministic daily puzzle requires.
    //
    // Populated from OMDb, not TMDB: TMDb's free tier bars commercial use
    // (the documented reason this project migrated off it), and OMDb returns
    // `Director` and `Actors` directly, which is all the puzzle engine needs.
    // TmdbId is kept nullable purely so the column exists if a future
    // provider swap wants it.
    [Table("cinemind_movies")]
    public class CineMindMovie
    {
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("imdb_id")]
        [MaxLength(20)]
        public string ImdbId { get; set; } = "";

        [Column("tmdb_id")]
        public int? TmdbId { get; set; }

        [Column("title")]
        [MaxLength(255)]
        public string Title { get; set; } = "";

        [Column("release_year")]
        public int ReleaseYear { get; set; }

        [Column("poster_path")]
        public string? PosterPath { get; set; }

        [Column("director")]
        [MaxLength(255)]
        public string? Director { get; set; }

        // JSON array of actor names, e.g. ["Tom Hardy","Cillian Murphy"].
        // Stored as JSON rather than a join table because the puzzle engine
        // only ever needs set-intersection over names — never per-actor
        // records, filmographies, or IDs.
        [Column("cast_json")]
        public string CastJson { get; set; } = "[]";

        // JSON array of genres, e.g. ["Action","Sci-Fi"] — same reasoning as
        // CastJson. Used by Roulette's genre filter; the daily puzzle engine
        // doesn't touch this at all.
        [Column("genres_json")]
        public string GenresJson { get; set; } = "[]";

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
