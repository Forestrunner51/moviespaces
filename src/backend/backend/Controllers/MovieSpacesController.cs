using Backend.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class MovieSpacesController : ControllerBase
{
    private readonly AppDbContext _context;

    // EF Core automatically injects your database context here
    public MovieSpacesController(AppDbContext context)
    {
        _context = context;
    }

    // GET: api/moviespaces (To read all records)
    [HttpGet]
    public async Task<ActionResult<IEnumerable<MovieSpace>>> GetMovieSpaces()
    {
        return await _context.MovieSpaces.ToListAsync();
    }

    // POST: api/moviespaces (To write a new record)
    [HttpPost]
    public async Task<IActionResult> CreateMovieSpace([FromBody] MovieSpace newMovieSpace)
    {
        if (string.IsNullOrEmpty(newMovieSpace.Title))
        {
            return BadRequest("Title is required.");
        }

        // 1. Stage the new object in memory
        _context.MovieSpaces.Add(newMovieSpace);

        // 2. Commit the changes to your Docker Postgres database
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetMovieSpaces), new { id = newMovieSpace.Id }, newMovieSpace);
    }
}
