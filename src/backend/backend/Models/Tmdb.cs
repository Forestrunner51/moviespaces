using System.Text.Json.Serialization;

namespace Backend.Models
{
    public class TmdbMovie
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";

        [JsonPropertyName("poster_path")]
        public string? PosterPath { get; set; }

        public string? Overview { get; set; }

        [JsonPropertyName("release_date")]
        public string? ReleaseDate { get; set; }

        [JsonPropertyName("vote_average")]
        public double VoteAverage { get; set; }
    }

    public class TmdbSearchResponse
    {
        public int Page { get; set; }
        public List<TmdbMovie> Results { get; set; } = new();

        [JsonPropertyName("total_results")]
        public int TotalResults { get; set; }

        [JsonPropertyName("total_pages")]
        public int TotalPages { get; set; }
    }
}
