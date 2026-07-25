namespace Backend.Models;

// Clean, client-facing showtime shape parsed out of MovieGlu's filmShowTimes
// response. `Source` is "live" (freshly fetched), "cache" (in-memory hit), or
// "none" (no data / lookup failed → client shows manual entry).
public record ShowtimeResponseDto(string Source, List<ShowtimeTheaterDto> Theaters);

public record ShowtimeTheaterDto(
    string Name,
    string Address,
    List<ShowingDto> Showings
);

// One screening format at a theater (e.g. "Standard", "IMAX") and its times.
public record ShowingDto(string Type, List<ShowingTimeDto> Times);

// A single showtime plus MovieGlu's booking link when one is provided.
public record ShowingTimeDto(string Time, string? BookingUrl);
