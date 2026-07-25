namespace Backend.Models;

// Response envelope. `Source` tells the client where the data came from:
//   "cache" — served from ShowtimeCache (fresh within the last 6h)
//   "live"  — freshly fetched from SerpApi and cached this request
//   "none"  — SerpApi failed or returned no showtimes block (empty list)
public record ShowtimeResponseDto(string Source, List<TheaterDto> Theaters);

// TicketUrl is SerpApi's own booking link for the theater when present;
// empty string when SerpApi didn't provide one (the client then builds a
// fallback search link on its side via ticket-links.ts).
public record TheaterDto(
    string Name,
    string Address,
    List<ShowingDto> Showings,
    string TicketUrl
);

// One screening format at a theater and the times it plays, e.g.
// Type "IMAX", Times ["7:15pm", "10:30pm"].
public record ShowingDto(string Type, List<string> Times);
