using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // TV counterpart to CineMindMovie, for the Mystery Movie challenge's TV
    // track — deliberately a separate table, not a MediaType column on
    // CineMindMovie, because the two catalogs are used differently: the movie
    // catalog backs 4 challenge types (Connection/Chronos/CastDeduct/Mystery),
    // this one only ever backs a single Mystery-style guessing round. No
    // Director column: OMDb's Director field for a series lookup usually
    // reflects one episode, not the show, and is unreliable enough that
    // showing it as a "clue" would often just be wrong.
    [Table("cinemind_tv_shows")]
    public class CineMindTvShow
    {
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("imdb_id")]
        [MaxLength(20)]
        public string ImdbId { get; set; } = "";

        [Column("title")]
        [MaxLength(255)]
        public string Title { get; set; } = "";

        // First-air year — OMDb returns e.g. "2016–2019" for an ended series;
        // only the start year is kept, same parsing as the movie catalog.
        [Column("release_year")]
        public int ReleaseYear { get; set; }

        [Column("poster_path")]
        public string? PosterPath { get; set; }

        [Column("cast_json")]
        public string CastJson { get; set; } = "[]";

        [Column("genres_json")]
        public string GenresJson { get; set; } = "[]";

        [Column("plot")]
        public string? Plot { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
