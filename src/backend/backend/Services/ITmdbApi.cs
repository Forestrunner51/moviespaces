using Backend.Models;
using Refit;

namespace Backend.Services
{
    public interface ITmdbApi
    {
        // v3 auth: the API key goes on every request as ?api_key=..., rather
        // than as a Bearer token (which needs the separate v4 Read Access Token).
        [Get("/search/movie")]
        Task<TmdbSearchResponse> SearchMoviesAsync(
            [AliasAs("query")] string query,
            [AliasAs("api_key")] string apiKey,
            [AliasAs("page")] int page = 1);

        [Get("/movie/{id}")]
        Task<TmdbMovie> GetMovieAsync(int id, [AliasAs("api_key")] string apiKey);
    }
}
