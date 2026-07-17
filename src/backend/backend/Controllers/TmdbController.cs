using Microsoft.AspNetCore.Mvc;
using Backend.Services;
using Refit;

namespace Backend.Controllers
{
    // Movie search/lookup for creating a crowdfunded Space. Separate from
    // MovieGluController, which is a different provider used for the
    // existing free Group flow's cinema/showtime data.
    [ApiController]
    [Route("api/[controller]")]
    [Microsoft.AspNetCore.Authorization.Authorize]
    public class TmdbController : ControllerBase
    {
        private readonly ITmdbApi _tmdb;
        private readonly string _apiKey;
        private readonly ILogger<TmdbController> _logger;

        public TmdbController(ITmdbApi tmdb, IConfiguration config, ILogger<TmdbController> logger)
        {
            _tmdb = tmdb;
            _apiKey = config["Tmdb:ApiKey"] ?? "";
            _logger = logger;
        }

        [HttpGet("search")]
        public async Task<IActionResult> SearchMovies([FromQuery] string query, [FromQuery] int page = 1)
        {
            if (string.IsNullOrWhiteSpace(query))
                return BadRequest(new { error = "Query is required." });

            try
            {
                var result = await _tmdb.SearchMoviesAsync(query, _apiKey, page);
                return Ok(result);
            }
            catch (ApiException ex)
            {
                _logger.LogError(ex, "TMDB search failed for query {Query}.", query);
                return StatusCode((int)ex.StatusCode, new { error = "TMDB lookup failed." });
            }
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetMovie(int id)
        {
            try
            {
                var movie = await _tmdb.GetMovieAsync(id, _apiKey);
                return Ok(movie);
            }
            catch (ApiException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return NotFound();
            }
            catch (ApiException ex)
            {
                _logger.LogError(ex, "TMDB lookup failed for movie {MovieId}.", id);
                return StatusCode((int)ex.StatusCode, new { error = "TMDB lookup failed." });
            }
        }
    }
}
