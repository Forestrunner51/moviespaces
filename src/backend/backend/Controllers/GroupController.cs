using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Backend.Data;
using Backend.Models;
using Backend.Services;
using System.Security.Claims;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class GroupController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly ILogger<GroupController> _logger;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly PushNotificationService _pushNotificationService;
        private readonly IProfanityFilterService _profanityFilter;

        public GroupController(
            AppDbContext db,
            ILogger<GroupController> logger,
            IHttpClientFactory httpClientFactory,
            PushNotificationService pushNotificationService,
            IProfanityFilterService profanityFilter)
        {
            _db = db;
            _logger = logger;
            _httpClientFactory = httpClientFactory;
            _pushNotificationService = pushNotificationService;
            _profanityFilter = profanityFilter;
        }

        // Shared by every write path that persists host-supplied text, so a
        // value over its column's limit comes back as a readable 400 instead
        // of a DbUpdateException the client can't act on.
        //
        // EVERY endpoint that writes one of these columns must call this.
        // These columns used to be unbounded `text`; once they became
        // varchar(n) (see the AddGroupFieldLengthLimits migration), any write
        // path without a check became a latent 500 — which is exactly what
        // EditGroup and UpdateBookingUrl were until this was factored out of
        // CreateGroup.
        private static string? CheckLength(string? value, int limit, string label) =>
            (value?.Length ?? 0) > limit
                ? $"{label} is too long (max {limit} characters)."
                : null;

        // BookingUrl is opened directly in members' in-app browsers, so it
        // must be a real absolute http(s) URL — never a javascript:, file:,
        // or custom scheme, and never a relative fragment.
        private static bool IsWebUrl(string value) =>
            Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);

        // Returns a message for the first host-supplied field exceeding its
        // column limit, or null if everything fits. See GroupFieldLimits for
        // why the ceilings exist and why they're this generous.
        //
        // Reports one field at a time rather than collecting all of them: the
        // realistic case is a single pasted blob, and a one-line message is
        // more actionable in an alert than a list.
        private static string? FirstFieldOverLimit(CreateGroupRequest req) =>
            CheckLength(req.HostName, GroupFieldLimits.Name, "Your name")
            ?? CheckLength(req.FilmName, GroupFieldLimits.Title, "The title")
            ?? CheckLength(req.CinemaName, GroupFieldLimits.VenueName, "The venue name")
            ?? CheckLength(req.ShowDate, GroupFieldLimits.ShortLabel, "The date")
            ?? CheckLength(req.ShowTime, GroupFieldLimits.ShortLabel, "The time")
            ?? CheckLength(req.HangoutNotes, GroupFieldLimits.Notes, "The notes")
            ?? CheckLength(req.BookingUrl, GroupFieldLimits.Url, "The booking link")
            ?? CheckLength(req.PosterPath, GroupFieldLimits.Url, "The poster link")
            ?? CheckLength(req.SeasonEpisodeInfo, GroupFieldLimits.Title, "The season/episode info")
            // These two also end up in varchar(n) columns (see the
            // AddGroupFieldLengthLimits migration) — they were the write paths
            // this list missed, which meant a guaranteed DbUpdateException 500.
            ?? CheckLength(req.GooglePlaceId, 200, "The venue id")
            ?? CheckLength(
                req.PostActivities is { Length: > 0 } ? string.Join(",", req.PostActivities) : null,
                500, "The activities list");

        // Same, for the partial-edit path. Only the fields EditGroup actually
        // writes — a null field means "don't change this", so it can't overflow.
        private static string? FirstFieldOverLimit(EditGroupRequest req) =>
            CheckLength(req.FilmName, GroupFieldLimits.Title, "The title")
            ?? CheckLength(req.CinemaName, GroupFieldLimits.VenueName, "The venue name")
            ?? CheckLength(req.ShowDate, GroupFieldLimits.ShortLabel, "The date")
            ?? CheckLength(req.ShowTime, GroupFieldLimits.ShortLabel, "The time")
            ?? CheckLength(req.HangoutNotes, GroupFieldLimits.Notes, "The notes");

        // ScreeningTime is written to a `timestamptz` column, and Npgsql throws
        // when handed a DateTime whose Kind is Unspecified. System.Text.Json
        // yields Unspecified for any ISO timestamp the client sends without a
        // 'Z'/offset — so this normalizes to UTC defensively, turning a latent
        // 500-on-create into a safe write. The app's client already sends UTC
        // with a 'Z' (Kind = Utc, a no-op here); this covers everything else.
        private static DateTime? ToUtc(DateTime? dt) => dt?.Kind switch
        {
            null => null,
            DateTimeKind.Utc => dt,
            DateTimeKind.Local => dt.Value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(dt!.Value, DateTimeKind.Utc),
        };

        // Human-readable share id, e.g. "friday-movie-night-a8f1". The random
        // suffix makes collisions negligible without a uniqueness retry loop
        // — good enough for a purely additive, non-critical identifier.
        private static string GenerateSlug(string title)
        {
            var slug = (title ?? "").ToLowerInvariant().Trim();
            slug = System.Text.RegularExpressions.Regex.Replace(slug, "[^a-z0-9]+", "-").Trim('-');
            if (string.IsNullOrEmpty(slug)) slug = "space";
            if (slug.Length > 40) slug = slug.Substring(0, 40).Trim('-');
            var suffix = Guid.NewGuid().ToString("N").Substring(0, 4);
            return $"{slug}-{suffix}";
        }

        // Excludes visually ambiguous characters (0/O, 1/I/L) — a code meant
        // to be read aloud or typed by hand shouldn't hinge on telling those
        // apart. Unlike GenerateSlug's "good enough" random suffix, a bare
        // 6-char code has a real collision chance at any meaningful scale, so
        // this checks the database and retries rather than trusting the odds.
        private const string SpaceCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

        private async Task<string> GenerateUniqueSpaceCodeAsync()
        {
            // SECURITY: this code is the sole credential gating a private
            // Space's join paths, so it must come from a CSPRNG — Random.Shared
            // is a predictable stream an attacker can characterize by creating
            // Spaces of their own and observing consecutive outputs.
            for (var attempt = 0; attempt < 10; attempt++)
            {
                var code = new string(Enumerable.Range(0, 6)
                    .Select(_ => SpaceCodeAlphabet[
                        System.Security.Cryptography.RandomNumberGenerator.GetInt32(SpaceCodeAlphabet.Length)])
                    .ToArray());

                if (!await _db.Groups.AnyAsync(g => g.SpaceCode == code)) return code;
            }

            // Astronomically unlikely with a 32^6 space, but a code that
            // silently fails to be unique is worse than one that's ugly.
            return $"{Guid.NewGuid():N}"[..8].ToUpperInvariant();
        }

        private Task NotifyMembersAsync(Guid groupId, string title, string body, string? excludeUserId = null) =>
            _pushNotificationService.NotifyMembersAsync(_db, groupId, title, body, excludeUserId);

        private string GetUserId() =>
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? "";

        [HttpPost]
        [EnableRateLimiting("write-heavy")]
        public async Task<IActionResult> CreateGroup([FromBody] CreateGroupRequest req)
        {
            var userId = GetUserId();

            // Same bounds EditGroup enforces, plus a ceiling. Without the floor,
            // maxCapacity: 0 creates a Space that is permanently unjoinable and
            // hidden from /open; without the ceiling, int.MaxValue disables the
            // capacity guard the guest-join rate limit relies on as the real
            // bound on junk-member rows per Space.
            if (req.MaxCapacity.HasValue && (req.MaxCapacity.Value < 1 || req.MaxCapacity.Value > 5000))
                return BadRequest(new { error = "Capacity must be between 1 and 5000." });

            var spaceType = req.SpaceType == "private_rental" ? "private_rental" : "public_gathering";
            // Allow-listed rather than trusting the client string verbatim —
            // this ends up in filter queries, so an unrecognized value should
            // collapse to a safe default rather than create an unfilterable
            // one-off category.
            var validEventCategories = new HashSet<string> { "movie", "tv", "sports", "gaming", "awards", "other" };
            var eventCategory = spaceType == "private_rental" && validEventCategories.Contains(req.EventCategory ?? "")
                ? req.EventCategory
                : spaceType == "private_rental" ? "other" : "movie";
            // Cost is optional — a watch party/venue can legitimately be free
            // (TotalCostCents null/0 means "Free to Attend" in the UI), it's
            // only invalid if a negative number sneaks through somehow.
            if (spaceType == "private_rental" && req.TotalCostCents.HasValue && req.TotalCostCents.Value < 0)
                return BadRequest(new { error = "Cost can't be negative." });

            // FilmName is only user-freeform for a "other" private_rental
            // activity (no FilmId/TmdbMovieId — the host typed it rather than
            // picking from a search result). Real movie/TV titles from OMDb
            // are never filtered: a legitimate title landing on the blocklist
            // would be a false positive we can't let block a real search
            // result, and titles aren't identity the way a host's own name is.
            // Checked before anything is written so an over-long field comes
            // back as a readable 400 instead of a DbUpdateException (a 500 the
            // client can do nothing with) or a silent truncation. The client
            // caps these inputs too — this is the enforcement that survives a
            // caller that isn't the app.
            var tooLong = FirstFieldOverLimit(req);
            if (tooLong != null) return BadRequest(new { error = tooLong });

            // Same rule UpdateBookingUrl enforces — see IsWebUrl.
            var bookingUrl = req.BookingUrl?.Trim() ?? "";
            if (bookingUrl.Length > 0 && !IsWebUrl(bookingUrl))
                return BadRequest(new { error = "The booking link must be a full web address (starting with https://)." });

            var filmNameIsFreeform = req.FilmId == null && req.TmdbMovieId == null;
            var cleanFilmName = filmNameIsFreeform
                ? _profanityFilter.CleanOrFallback(req.FilmName, "Group Activity")
                : req.FilmName;
            var cleanHostName = _profanityFilter.CleanOrFallback(req.HostName, "A Movie Fan");
            var cleanHangoutNotes = _profanityFilter.ContainsProfanity(req.HangoutNotes ?? "")
                ? null
                : req.HangoutNotes;

            var group = new Group
            {
                Slug = GenerateSlug(cleanFilmName),
                SpaceCode = await GenerateUniqueSpaceCodeAsync(),
                HostName = cleanHostName,
                UserId = userId,
                CinemaId = req.CinemaId,
                CinemaName = req.CinemaName,
                FilmId = req.FilmId,
                FilmName = cleanFilmName,
                ShowTime = req.ShowTime,
                ShowDate = req.ShowDate,
                BookingUrl = bookingUrl,
                SpaceType = spaceType,
                TotalCostCents = spaceType == "private_rental" ? req.TotalCostCents : null,
                MaxCapacity = req.MaxCapacity ?? 40,
                PostActivities = req.PostActivities != null && req.PostActivities.Length > 0
                    ? string.Join(",", req.PostActivities)
                    : null,
                HangoutNotes = req.PostActivities != null && req.PostActivities.Length > 0
                    ? cleanHangoutNotes
                    : null,
                GooglePlaceId = req.GooglePlaceId,
                TheaterLatitude = req.TheaterLatitude,
                TheaterLongitude = req.TheaterLongitude,
                TmdbMovieId = req.TmdbMovieId,
                PosterPath = req.PosterPath,
                ScreeningTime = ToUtc(req.ScreeningTime),
                SeasonEpisodeInfo = string.IsNullOrWhiteSpace(req.SeasonEpisodeInfo) ? null : req.SeasonEpisodeInfo.Trim(),
                EventCategory = eventCategory,
                IsPrivate = req.IsPrivate ?? false,
            };

            // Invariant: IsPrivate is only meaningful when there's a code to
            // enforce it with. Every join path (JoinGroup, JoinGroupWeb, the
            // /space/{id} gate) rejects unconditionally when SpaceCode is null,
            // so a private Space without one would be permanently unjoinable by
            // anyone but its host. GenerateUniqueSpaceCodeAsync always returns a
            // value today — this makes that dependency explicit rather than
            // incidental, so the pair can't drift apart later.
            if (string.IsNullOrWhiteSpace(group.SpaceCode)) group.IsPrivate = false;

            group.Members.Add(new GroupMember
            {
                GroupId = group.Id,
                Name = cleanHostName,
                UserId = userId,
                Confirmed = true
            });

            _db.Groups.Add(group);
            await _db.SaveChangesAsync();

            return Ok(new { groupId = group.Id });
        }

        // GET /api/group/resolve/{code}
        //
        // Separate from GetGroup's Guid-or-Slug fallback rather than folded
        // into it: SpaceCode is short and could theoretically collide with a
        // legacy Slug's shape, and this only needs to hand back an id for the
        // "I have a code" join screen to route with — not the full Space.
        // AllowAnonymous: entering a code is how someone joins before they're
        // a member, same as opening a /space/{id} link.
        [HttpGet("resolve/{code}")]
        [AllowAnonymous]
        public async Task<IActionResult> ResolveSpaceCode(string code)
        {
            var normalized = code.Trim().ToUpperInvariant();
            var group = await _db.Groups.FirstOrDefaultAsync(g => g.SpaceCode == normalized);
            if (group == null) return NotFound(new { error = "No Space found with that code." });
            if (group.Status == "cancelled")
                return BadRequest(new { error = "This Space has been cancelled." });

            return Ok(new { groupId = group.Id, filmName = group.FilmName, hostName = group.HostName });
        }

        // Guid (every programmatic caller), Slug (the friendlier deep-link
        // form), or SpaceCode (a share/onboarding link using the short code,
        // e.g. moviespaces.onrender.com/space/HORROR) — in that order, so a
        // 6-char SpaceCode can never accidentally shadow a real Guid or Slug.
        //
        // AsNoTracking: both callers (GetGroup, SpaceInvitePage) are read-only
        // and GetGroup redacts SpaceCode off the returned instance before
        // serializing it. Without this, that redaction would be a pending
        // change on a tracked entity — one stray SaveChangesAsync in the same
        // request scope would persist the null and destroy the real code.
        private async Task<Group?> ResolveGroupAsync(string id)
        {
            if (Guid.TryParse(id, out var groupId))
                return await _db.Groups.AsNoTracking().Include(g => g.Members).FirstOrDefaultAsync(g => g.Id == groupId);

            var bySlug = await _db.Groups.AsNoTracking().Include(g => g.Members).FirstOrDefaultAsync(g => g.Slug == id);
            if (bySlug != null) return bySlug;

            var normalizedCode = id.Trim().ToUpperInvariant();
            return await _db.Groups.AsNoTracking().Include(g => g.Members).FirstOrDefaultAsync(g => g.SpaceCode == normalizedCode);
        }

        // POST /api/group/community-spaces/seed
        //
        // One-shot admin action, same gating pattern (and same shared secret)
        // as CineMind's catalog/seed — an unauthenticated endpoint that
        // creates rows would let anyone spam the community list.
        [HttpPost("community-spaces/seed")]
        [AllowAnonymous]
        public async Task<IActionResult> SeedCommunitySpaces([FromServices] IConfiguration configuration)
        {
            var expected = configuration["CineMind:AdminSecret"];
            if (string.IsNullOrWhiteSpace(expected))
                return StatusCode(500, new { error = "CineMind:AdminSecret is not configured." });

            Request.Headers.TryGetValue("x-admin-secret", out var provided);
            if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(provided.ToString()),
                    System.Text.Encoding.UTF8.GetBytes(expected)))
                return Unauthorized(new { error = "Unauthorized" });

            // (DisplayName, SpaceCode, GenreCategory). Built through the
            // normal Group entity rather than raw SQL specifically so every
            // NOT NULL column gets its real C# default (HostName, Status,
            // MaxCapacity, ...) instead of this list having to enumerate and
            // stay in sync with the full Groups schema by hand.
            var defaults = new[]
            {
                ("Blockbuster Film Society", "BLOCKB", "Blockbusters"),
                ("Horror Night Den", "HORROR", "Horror"),
                ("Sci-Fi Projectors", "SCIFI9", "Sci-Fi"),
                ("Action Junkies", "ACTION", "Action"),
                ("Arthouse & Indie Circle", "INDIE1", "Indie"),
                ("Pop Culture Cinephiles", "POPCOR", "General"),
            };

            var existingCodes = await _db.Groups
                .Where(g => g.IsPublic)
                .Select(g => g.SpaceCode)
                .ToListAsync();

            int added = 0;
            foreach (var (name, code, genreCategory) in defaults)
            {
                if (existingCodes.Contains(code)) continue;

                var group = new Group
                {
                    HostName = "MovieSpaces",
                    FilmName = name,
                    Slug = GenerateSlug(name),
                    SpaceCode = code,
                    IsPublic = true,
                    GenreCategory = genreCategory,
                    SpaceType = "public_gathering",
                    // High enough that "full" never realistically blocks
                    // onboarding auto-join for a themed community club.
                    MaxCapacity = 5000,
                    // Left null deliberately — see the hasPassed/isPast
                    // exemption for IsPublic Spaces in the client, which
                    // treats an evergreen club as never "past" regardless.
                    ScreeningTime = null,
                };
                _db.Groups.Add(group);
                added++;
            }

            if (added > 0) await _db.SaveChangesAsync();
            return Ok(new { added, total = defaults.Length });
        }

        // POST /api/group/community-clubs — anyone can create a public community
        // club (a themed, evergreen Space others discover and join). The
        // user-facing counterpart to the admin seed above: same Group shape
        // (IsPublic, no screening time, high capacity) but owned by the creator,
        // and guarded because it's user-generated content — name is profanity-
        // filtered, genre is allow-listed, and one account is capped so it can't
        // spam the public directory.
        [HttpPost("community-clubs")]
        [EnableRateLimiting("write-heavy")]
        public async Task<IActionResult> CreateCommunityClub([FromBody] CreateClubRequest req)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });

            var name = (req.Name ?? "").Trim();
            if (name.Length == 0) return BadRequest(new { error = "Give your club a name." });
            var lenError = CheckLength(name, GroupFieldLimits.Title, "The club name");
            if (lenError != null) return BadRequest(new { error = lenError });

            // Allow-listed to the genres the app has icons/posters for; anything
            // else collapses to General rather than creating an unfilterable one-off.
            var validGenres = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                { "Blockbusters", "Horror", "Sci-Fi", "Action", "Indie", "General" };
            var genre = validGenres.Contains(req.GenreCategory ?? "") ? req.GenreCategory! : "General";

            // Cap clubs per creator so one account can't flood the public
            // directory (match groups excluded — they're not browsable clubs).
            var owned = await _db.Groups.CountAsync(g => g.IsPublic && g.MatchMovieKey == null && g.UserId == userId);
            if (owned >= 5)
                return BadRequest(new { error = "You've reached the limit of 5 clubs. Delete one to create another." });

            var cleanName = _profanityFilter.CleanOrFallback(name, "Movie Club");
            var cleanHost = _profanityFilter.CleanOrFallback(req.HostName ?? "", "A Movie Fan");

            var club = new Group
            {
                Slug = GenerateSlug(cleanName),
                SpaceCode = await GenerateUniqueSpaceCodeAsync(),
                HostName = cleanHost,
                UserId = userId,
                FilmName = cleanName,
                IsPublic = true,
                GenreCategory = genre,
                SpaceType = "public_gathering",
                MaxCapacity = 5000,
                ScreeningTime = null,
            };
            club.Members.Add(new GroupMember { GroupId = club.Id, Name = cleanHost, UserId = userId, Confirmed = true });
            _db.Groups.Add(club);
            await _db.SaveChangesAsync();
            return Ok(new { groupId = club.Id });
        }

        // POST /api/group/match — Match mode: pick a movie you want to see and
        // land in THE open group for that movie. The first person for a film
        // creates the group; everyone after joins it (up to a small cap), so
        // people who want the same movie converge into one crew instead of each
        // starting their own. No waiting pool — you're grouped instantly, which
        // is what makes it usable before there's user density.
        public const int MatchCrewSize = 6;

        // Two kinds of crew: meet at a theater showing (public_gathering) or a
        // hosted watch party at someone's venue (private_rental). They're
        // different plans, so they're different crews even for the same film
        // — the kind is part of the key. Namespaced so an imdb id and a
        // freeform title can never collide in the same column.
        private static (string key, bool isVenue) BuildMatchKey(string? kind, string? imdbId, string title)
        {
            var isVenue = string.Equals(kind, "venue", StringComparison.OrdinalIgnoreCase);
            var kindTag = isVenue ? "venue" : "theater";
            var key = kindTag + ":" + (!string.IsNullOrWhiteSpace(imdbId)
                ? "imdb:" + imdbId!.Trim().ToLowerInvariant()
                : "title:" + title.ToLowerInvariant());
            return (key, isVenue);
        }

        // Every live crew for a film + kind (not cancelled, showtime not yet
        // passed). Includes full ones — callers that need room filter on
        // Members.Count; the already-seated check must see full crews too.
        private async Task<List<Group>> LiveCrewsAsync(string key)
        {
            var now = DateTime.UtcNow;
            return await _db.Groups
                .Include(g => g.Members)
                .Where(g => g.MatchMovieKey == key
                    && g.Status != "cancelled"
                    && (g.ScreeningTime == null || g.ScreeningTime > now))
                .ToListAsync();
        }

        // GET /api/group/match/open?kind=theater&imdbId=tt123&title=...
        // Crews already forming for a film, so the match screen can offer
        // "join this one" before asking someone to pick their own showing.
        [HttpGet("match/open")]
        public async Task<IActionResult> OpenMatchCrews([FromQuery] string? kind, [FromQuery] string? imdbId, [FromQuery] string? title)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });
            var t = (title ?? "").Trim();
            if (t.Length == 0 && string.IsNullOrWhiteSpace(imdbId)) return BadRequest(new { error = "Pick a movie." });
            var (key, _) = BuildMatchKey(kind, imdbId, t);
            var crews = await LiveCrewsAsync(key);
            return Ok(crews
                .Where(g => g.Members.Count < g.MaxCapacity || g.Members.Any(m => m.UserId == userId))
                .OrderBy(g => g.ScreeningTime ?? DateTime.MaxValue)
                .Select(g => new
                {
                    id = g.Id,
                    cinemaName = g.CinemaName,
                    showDate = g.ShowDate,
                    showTime = g.ShowTime,
                    screeningTime = g.ScreeningTime,
                    theaterLatitude = g.TheaterLatitude,
                    theaterLongitude = g.TheaterLongitude,
                    hostName = g.HostName,
                    memberCount = g.Members.Count,
                    ticketCount = g.Members.Count(m => m.HasTicket),
                    maxCapacity = g.MaxCapacity,
                    alreadyIn = g.Members.Any(m => m.UserId == userId),
                }));
        }

        // POST /api/group/{id}/ticket — the caller's own "ticket in hand"
        // flag on a crew they're seated in. Self-reported; social, not a gate.
        [HttpPost("{id}/ticket")]
        public async Task<IActionResult> SetTicket(Guid id, [FromBody] TicketRequest req)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });
            var isTheaterCrew = await _db.Groups.AnyAsync(g => g.Id == id && g.MatchMovieKey != null && g.SpaceType == "public_gathering");
            if (!isTheaterCrew) return BadRequest(new { error = "Tickets are tracked for theater crews only." });
            var member = await _db.GroupMembers.FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == userId);
            if (member == null) return Forbid();
            member.HasTicket = req.HasTicket;
            await _db.SaveChangesAsync();
            return Ok(new { hasTicket = member.HasTicket });
        }

        [HttpPost("match")]
        [EnableRateLimiting("write-heavy")]
        public async Task<IActionResult> MatchForMovie([FromBody] MatchRequest req)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });

            var title = (req.MovieTitle ?? "").Trim();
            if (title.Length == 0) return BadRequest(new { error = "Pick a movie to match on." });
            var lenError = CheckLength(title, GroupFieldLimits.Title, "The movie title");
            if (lenError != null) return BadRequest(new { error = lenError });

            var (key, isVenue) = BuildMatchKey(req.Kind, req.ImdbId, title);
            var cleanHost = _profanityFilter.CleanOrFallback(req.HostName ?? "", "A Movie Fan");
            // Ticket-in-hand only means something for a theater showing.
            var hasTicket = !isVenue && req.HasTicket == true;
            var candidates = await LiveCrewsAsync(key);

            // One crew per film+kind per person. Already seated somewhere —
            // including a crew that has since filled — go back there. This
            // runs before either branch below so "join B" or "start a twin"
            // can't seat someone twice for the same film.
            var mine = candidates.FirstOrDefault(g => g.Members.Any(m => m.UserId == userId));
            if (mine != null)
                return Ok(new { groupId = mine.Id, alreadyIn = true, memberCount = mine.Members.Count });

            // Explicit join of a crew picked from the "already forming" list.
            if (req.JoinGroupId.HasValue)
            {
                var target = candidates.FirstOrDefault(g => g.Id == req.JoinGroupId.Value);
                if (target == null)
                    return BadRequest(new { error = "That crew is no longer open — pick another or start your own." });
                if (target.Members.Count >= target.MaxCapacity)
                    return BadRequest(new { error = "That crew just filled up — pick another or start your own." });
                // _db.GroupMembers.Add, not target.Members.Add: target is tracked
                // and GroupMember.Id is client-generated, so the navigation route
                // marks the row Modified (UPDATE → 0 rows → 500). EF fixup still
                // appends it to target.Members, so the count below is post-add.
                _db.GroupMembers.Add(new GroupMember { GroupId = target.Id, Name = cleanHost, UserId = userId, Confirmed = true, HasTicket = hasTicket });
                await _db.SaveChangesAsync();
                return Ok(new { groupId = target.Id, joined = true, memberCount = target.Members.Count });
            }

            // Starting a crew with a concrete showing. A crew is always born
            // with a plan — the client never sends a showing-less request, and
            // a crew with no time is the empty-group experience this flow
            // exists to avoid.
            var cinema = (req.CinemaName ?? "").Trim();
            if (cinema.Length == 0 || !req.ScreeningTime.HasValue)
                return BadRequest(new { error = isVenue ? "Name the place and pick a time." : "Pick a showing first." });
            var cinemaErr = CheckLength(cinema, GroupFieldLimits.VenueName, "The venue name");
            if (cinemaErr != null) return BadRequest(new { error = cinemaErr });
            var showDate = (req.ShowDate ?? "").Trim();
            var showTime = (req.ShowTime ?? "").Trim();
            var dateErr = CheckLength(showDate, GroupFieldLimits.ShortLabel, "The date label")
                ?? CheckLength(showTime, GroupFieldLimits.ShortLabel, "The time label");
            if (dateErr != null) return BadRequest(new { error = dateErr });
            var when = ToUtc(req.ScreeningTime);
            if (when <= DateTime.UtcNow)
                return BadRequest(new { error = "That showing has already started — pick a later one." });
            // Compare and store the same (cleaned) string, or a venue that
            // trips the filter would never converge with itself.
            var cleanCinema = _profanityFilter.CleanOrFallback(cinema, isVenue ? "A private venue" : cinema);

            // Theater crews converge: same theater (from the showtimes data) +
            // same showing is the same plan, so join it rather than spawn a
            // twin. Venue crews never converge — "Home, 8 PM" from two people
            // in two cities is two different plans.
            if (!isVenue)
            {
                var twin = candidates.FirstOrDefault(g =>
                    g.Members.Count < g.MaxCapacity
                    && string.Equals(g.CinemaName, cleanCinema, StringComparison.OrdinalIgnoreCase)
                    && g.ScreeningTime == when);
                if (twin != null)
                {
                    _db.GroupMembers.Add(new GroupMember { GroupId = twin.Id, Name = cleanHost, UserId = userId, Confirmed = true, HasTicket = hasTicket });
                    await _db.SaveChangesAsync();
                    return Ok(new { groupId = twin.Id, joined = true, memberCount = twin.Members.Count });
                }
            }

            var crew = new Group
            {
                Slug = GenerateSlug(title),
                SpaceCode = await GenerateUniqueSpaceCodeAsync(),
                HostName = cleanHost,
                UserId = userId,
                FilmName = title,
                PosterPath = req.PosterPath,
                MatchMovieKey = key,
                IsPublic = true,
                SpaceType = isVenue ? "private_rental" : "public_gathering",
                EventCategory = "movie",
                // Small cap — a crew is intimate, not a 5000-person club; a
                // fresh one spawns once this fills. Six is the Timeleft
                // dinner-table number.
                MaxCapacity = MatchCrewSize,
                CinemaName = cleanCinema,
                ShowDate = showDate,
                ShowTime = showTime,
                ScreeningTime = when,
                TheaterLatitude = req.TheaterLatitude,
                TheaterLongitude = req.TheaterLongitude,
            };
            crew.Members.Add(new GroupMember { GroupId = crew.Id, Name = cleanHost, UserId = userId, Confirmed = true, HasTicket = hasTicket });
            _db.Groups.Add(crew);
            await _db.SaveChangesAsync();
            return Ok(new { groupId = crew.Id, created = true, memberCount = 1 });
        }

        // GET /api/group/community-spaces/discover?genres=Horror,Sci-Fi
        //
        // Browse-before-joining: onboarding shows these as preview cards and
        // joining is an explicit tap (POST /{id}/join, already built —
        // there's no reason for this to duplicate that logic). No genres
        // querystring means "show every public club," which is what a
        // general Discover entry point outside onboarding would want.
        [HttpGet("community-spaces/discover")]
        public async Task<IActionResult> DiscoverCommunitySpaces([FromQuery] string? genres)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });

            var requested = (genres ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            // Filtered in memory, not in the query — see the same
            // OrdinalIgnoreCase/SQL-translation note on the join endpoint.
            var allPublicClubs = await _db.Groups.Include(g => g.Members)
                // MatchMovieKey == null excludes Match-mode groups — they're
                // IsPublic (for evergreen treatment) but aren't browsable clubs.
                .Where(g => g.IsPublic && g.MatchMovieKey == null)
                .ToListAsync();
            var clubs = requested.Count == 0
                ? allPublicClubs
                : allPublicClubs.Where(g => g.GenreCategory != null && requested.Contains(g.GenreCategory)).ToList();

            // A representative poster per club: a real film from the club's
            // genre, so a club card shows movie art instead of a bare icon.
            // Chosen deterministically by the club id (stable across reloads,
            // not a new film every fetch). Clubs whose genre has no catalog
            // films fall back to the icon the client already renders.
            var neededGenres = clubs
                .Where(c => c.GenreCategory != null)
                .Select(c => c.GenreCategory!)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var postersByGenre = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            if (neededGenres.Count > 0)
            {
                var catalog = await _db.CineMindMovies
                    .Where(m => m.PosterPath != null && m.PosterPath != "")
                    .Select(m => new { m.GenresJson, m.PosterPath })
                    .ToListAsync();
                foreach (var m in catalog)
                {
                    List<string>? filmGenres;
                    try { filmGenres = JsonSerializer.Deserialize<List<string>>(m.GenresJson); }
                    catch { filmGenres = null; }
                    if (filmGenres == null) continue;
                    foreach (var g in filmGenres)
                    {
                        if (!neededGenres.Contains(g)) continue;
                        if (!postersByGenre.TryGetValue(g, out var list)) postersByGenre[g] = list = new();
                        list.Add(m.PosterPath!);
                    }
                }
            }
            string? PosterForClub(Group club)
            {
                if (club.GenreCategory != null
                    && postersByGenre.TryGetValue(club.GenreCategory, out var posters)
                    && posters.Count > 0)
                {
                    return posters[(int)((uint)club.Id.GetHashCode() % (uint)posters.Count)];
                }
                return null;
            }

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var allMemberIds = clubs
                .SelectMany(c => c.Members.Select(m => m.UserId))
                .Where(id => !string.IsNullOrEmpty(id))
                .Distinct()
                .ToList();

            // One query across every club's members rather than one query per
            // club — cheap either way at this scale (a handful of clubs), but
            // free to avoid.
            var todayScores = await _db.UserDailyProgress
                .Where(p => p.PuzzleDate == today && allMemberIds.Contains(p.UserId))
                .Select(p => new { p.UserId, p.Score })
                .ToListAsync();
            var scoresByUser = todayScores.ToLookup(s => s.UserId, s => s.Score);

            var ranked = clubs
                .Select(club =>
                {
                    var memberIds = club.Members.Select(m => m.UserId).Where(id => !string.IsNullOrEmpty(id));
                    var clubScores = memberIds.SelectMany(id => scoresByUser[id]).ToList();
                    return new
                    {
                        club,
                        memberCount = club.Members.Count,
                        playedTodayCount = clubScores.Count,
                        todayAvgScore = clubScores.Count > 0 ? (int?)Math.Round(clubScores.Average()) : null,
                        isJoined = club.Members.Any(m => m.UserId == userId),
                    };
                })
                // Most active today first, then biggest — a quiet club with
                // more total members but nobody active today isn't actually
                // the more "alive" pick to lead with.
                .OrderByDescending(r => r.playedTodayCount)
                .ThenByDescending(r => r.memberCount)
                .Select(r => new
                {
                    id = r.club.Id,
                    displayName = r.club.FilmName,
                    spaceCode = r.club.SpaceCode,
                    genreCategory = r.club.GenreCategory,
                    posterPath = PosterForClub(r.club),
                    memberCount = r.memberCount,
                    playedTodayCount = r.playedTodayCount,
                    todayAvgScore = r.todayAvgScore,
                    isJoined = r.isJoined,
                })
                .ToList();

            return Ok(new { spaces = ranked });
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetGroup(string id, [FromQuery] string? code)
        {
            var group = await ResolveGroupAsync(id);
            if (group == null) return NotFound();

            // SECURITY: SpaceCode is the credential that satisfies the private-Space
            // gate in JoinGroup/JoinGroupWeb. This endpoint is reachable by ANY
            // authenticated user with a group id (no membership required), so
            // returning the code here handed out the very secret that gate checks —
            // fetch the Space, read spaceCode, join. Only people already inside
            // (host or joined member) get to see the code they're meant to share.
            var userId = GetUserId();
            var isInsider = !string.IsNullOrEmpty(userId)
                && (group.UserId == userId || (group.Members?.Any(m => m.UserId == userId) ?? false));

            // Captured before the redaction below nulls it — the attendee-list
            // check still needs to compare against the real code.
            var actualCode = group.SpaceCode;
            var presentedCode = (code ?? "").Trim();
            var presentedValidCode = !string.IsNullOrEmpty(presentedCode)
                && string.Equals(presentedCode, actualCode, StringComparison.OrdinalIgnoreCase);

            if (!isInsider) group.SpaceCode = null;

            // The attendee list is gated the same way the public /space/{id}
            // invite page is. Previously only that page was gated, so a private
            // Space stayed fully readable — venue, host, and every attendee's
            // name — to any signed-in user holding a forwarded groupId, which is
            // precisely what IsPrivate is meant to prevent. Enough detail
            // survives for an invited-but-not-yet-joined user to see what
            // they're joining; who else is going does not.
            if (group.IsPrivate && !isInsider && !presentedValidCode)
            {
                group.Members = new List<GroupMember>();
                group.MembersHidden = true;
            }

            return Ok(group);
        }

        [HttpGet("/space/{id}")]
        [AllowAnonymous]
        public async Task<IActionResult> SpaceInvitePage(
            string id,
            [FromQuery] string? code,
            [FromServices] IConfiguration configuration)
        {
            var group = await ResolveGroupAsync(id);
            if (group == null) return NotFound();

            // A private Space's contents are gated here too, not just its join
            // call. This page is anonymous and renders the full attendee list,
            // so without this check a forwarded URL with no code still exposed
            // everything about an invite-only Space — exactly the "a known link
            // alone isn't enough" property IsPrivate is supposed to guarantee.
            // Resolving *by* the code counts as presenting it (that's how
            // /space/HORROR-style links work).
            var presentedCode = (code ?? "").Trim();
            var resolvedByCode = string.Equals(id.Trim(), group.SpaceCode, StringComparison.OrdinalIgnoreCase);
            if (group.IsPrivate
                && !resolvedByCode
                && !string.Equals(presentedCode, group.SpaceCode, StringComparison.OrdinalIgnoreCase))
            {
                return Content(BuildPrivateSpaceGatePage(), "text/html");
            }

            // SECURITY: HTML-encode all user-controlled strings before interpolating into
            // the page. FilmName / HostName / member Name are user-supplied (group creation,
            // join, join-web) and this page is public + unauthenticated, so unescaped values
            // here are a stored-XSS vector for every visitor who opens the invite link.
            var filmName = WebUtility.HtmlEncode(group.FilmName);
            var cinemaName = WebUtility.HtmlEncode(group.CinemaName);
            var hostName = WebUtility.HtmlEncode(group.HostName);
            var showTime = WebUtility.HtmlEncode(group.ShowTime);
            var showDate = WebUtility.HtmlEncode(group.ShowDate);
            var posterUrl = WebUtility.HtmlEncode(group.PosterPath ?? "");
            // HTML-encoded only for the markup below. The copy of this value
            // that goes into the inline <script> is JsonSerializer-encoded at
            // the point of use instead — HtmlEncode is the wrong escaper for a
            // JS string context, and only happened to be safe here because
            // SpaceCode is drawn from a fixed [A-Z2-9] alphabet.
            var joinCode = WebUtility.HtmlEncode(group.SpaceCode ?? "");
            var iosStoreUrl = WebUtility.HtmlEncode(configuration["AppLinks:IosStoreUrl"] ?? "");
            var androidStoreUrl = WebUtility.HtmlEncode(configuration["AppLinks:AndroidStoreUrl"] ?? "");

            var html = $@"
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='utf-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1'>
            <title>{filmName} - MovieSpaces</title>
            <meta property='og:title' content='{filmName} - MovieSpaces'>
            <meta property='og:description' content='{hostName} is watching {filmName} at {cinemaName} on {showDate} at {showTime}. Join them!'>
            {(string.IsNullOrEmpty(posterUrl) ? "" : $@"<meta property='og:image' content='{posterUrl}'>
            <meta name='twitter:card' content='summary_large_image'>")}
            <style>
                * {{ margin: 0; padding: 0; box-sizing: border-box; }}
                body {{ font-family: -apple-system, sans-serif; background: #111; color: #fff; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }}
                .card {{ background: #1a1a1a; border-radius: 16px; padding: 32px; max-width: 400px; width: 100%; text-align: center; }}
                .emoji {{ font-size: 48px; margin-bottom: 16px; }}
                h1 {{ font-size: 24px; font-weight: bold; margin-bottom: 8px; }}
                .details {{ color: #888; font-size: 14px; margin-bottom: 8px; }}
                .host {{ color: #aaa; font-size: 14px; margin-bottom: 24px; }}
                .members {{ background: #222; border-radius: 8px; padding: 12px; margin-bottom: 24px; }}
                .members-title {{ font-size: 12px; color: #666; margin-bottom: 8px; }}
                .member {{ font-size: 14px; color: #ccc; padding: 4px 0; }}
                input {{ width: 100%; padding: 14px; border-radius: 8px; border: none; background: #222; color: #fff; font-size: 16px; margin-bottom: 12px; outline: none; }}
                input::placeholder {{ color: #555; }}
                button {{ width: 100%; padding: 16px; border-radius: 8px; border: none; background: #E50914; color: #fff; font-size: 18px; font-weight: bold; cursor: pointer; }}
                .app-link {{ margin-top: 16px; font-size: 12px; color: #555; text-decoration: none; display: block; }}
                .confirmed {{ color: #34C759; font-size: 24px; margin-bottom: 8px; }}
                .error {{ color: #FF6B81; font-size: 14px; margin-top: 12px; min-height: 18px; }}
                .divider {{ border-top: 1px solid #2a2a2a; margin: 24px 0 20px; }}
                .get-app-title {{ font-size: 13px; color: #888; margin-bottom: 12px; }}
                .store {{ display: block; padding: 13px; border-radius: 8px; background: #222; color: #fff; text-decoration: none; font-size: 15px; font-weight: 600; margin-bottom: 8px; border: 1px solid #333; }}
            </style>
        </head>
        <body>
            <div class='card'>
                <div class='emoji'>🎬</div>
                <h1>{filmName}</h1>
                <p class='details'>{cinemaName} • {showTime}</p>
                <p class='details'>{showDate}</p>
                <p class='host'>Hosted by {hostName}</p>

                <div class='members'>
                    <div class='members-title'>WHO'S GOING ({group.Members.Count})</div>
                    {string.Join("", group.Members.Select(m => $"<div class='member'>{(m.Confirmed ? "✓" : "○")} {WebUtility.HtmlEncode(m.Name)}</div>"))}
                </div>

                <div id='form'>
                    <input type='text' id='name' placeholder='Your name' maxlength='{GroupFieldLimits.Name}' />
                    <button id='joinBtn' onclick='joinSpace()'>🎟 I'm In!</button>
                    <div class='error' id='error'></div>
                </div>
                <div id='success' style='display:none'>
                    <div class='confirmed'>✓ You're in!</div>
                    <p style='color:#888'>The host will be notified.</p>
                </div>

                <div class='divider'></div>
                <div class='get-app-title'>Get the app to chat, RSVP and see who's going</div>
                <a href='moviespaces://space/{group.Id}' class='store'>Open in the MovieSpaces App</a>
                {(string.IsNullOrEmpty(iosStoreUrl) ? "" : $"<a href='{iosStoreUrl}' class='store'>Download for iPhone</a>")}
                {(string.IsNullOrEmpty(androidStoreUrl) ? "" : $"<a href='{androidStoreUrl}' class='store'>Download for Android</a>")}
                {(string.IsNullOrEmpty(joinCode) ? "" : $"<p class='app-link'>Space code: <strong>{joinCode}</strong></p>")}
            </div>

            <script>
                // No automatic redirect to the moviespaces:// scheme. This page
                // exists for people who DON'T have the app, and firing an
                // unhandled custom scheme at them produced ERR_UNKNOWN_URL_SCHEME
                // on Android Chrome / a 'Cannot Open Page' dialog on iOS Safari —
                // a quarter-second after landing, before they'd read anything.
                // Opening the app is now an explicit tap (the link above);
                // anyone who already has it gets there via the verified
                // universal/app link without ever seeing this page.

                // Stable per-browser id so a repeat visit updates the same
                // membership instead of creating a second one, and so two
                // different guests sharing a first name stay distinct.
                function guestToken() {{
                    let t = null;
                    try {{ t = localStorage.getItem('ms_guest_token'); }} catch (e) {{}}
                    if (!t) {{
                        t = (crypto.randomUUID && crypto.randomUUID()) ||
                            (Date.now() + '-' + Math.random().toString(16).slice(2));
                        try {{ localStorage.setItem('ms_guest_token', t); }} catch (e) {{}}
                    }}
                    return t;
                }}

                async function joinSpace() {{
                    const name = document.getElementById('name').value.trim();
                    const errorEl = document.getElementById('error');
                    const btn = document.getElementById('joinBtn');
                    errorEl.textContent = '';
                    if (!name) {{
                        errorEl.textContent = 'Enter your name first.';
                        return;
                    }}

                    btn.disabled = true;
                    btn.textContent = 'Joining...';
                    try {{
                        const res = await fetch('/api/group/{group.Id}/join-web', {{
                            method: 'POST',
                            headers: {{ 'Content-Type': 'application/json' }},
                            body: JSON.stringify({{
                                name: name,
                                spaceCode: {JsonSerializer.Serialize(group.SpaceCode)},
                                guestToken: guestToken()
                            }})
                        }});

                        if (res.ok) {{
                            document.getElementById('form').style.display = 'none';
                            document.getElementById('success').style.display = 'block';
                            return;
                        }}
                        // Previously there was no else branch at all, so a full
                        // Space, a cancelled one, or a private-code rejection
                        // made this button silently do nothing.
                        const body = await res.json().catch(() => null);
                        errorEl.textContent = (body && body.error) || 'Could not join. Please try again.';
                    }} catch (e) {{
                        errorEl.textContent = 'Network error — please try again.';
                    }} finally {{
                        btn.disabled = false;
                        btn.textContent = '🎟 I\'m In!';
                    }}
                }}
            </script>
        </body>
        </html>";

            return Content(html, "text/html");
        }

        // Shown instead of the full invite page when someone opens a private
        // Space's link without the code. Deliberately reveals nothing about the
        // Space — no title, venue, host or attendee list — since leaking those
        // to anyone holding a forwarded URL is the exact thing IsPrivate exists
        // to prevent. No group-specific data is interpolated, so there's
        // nothing here to encode.
        private static string BuildPrivateSpaceGatePage() => @"
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='utf-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1'>
            <title>Private Space - MovieSpaces</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: -apple-system, sans-serif; background: #111; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
                .card { background: #1a1a1a; border-radius: 16px; padding: 32px; max-width: 400px; width: 100%; text-align: center; }
                .emoji { font-size: 48px; margin-bottom: 16px; }
                h1 { font-size: 22px; font-weight: bold; margin-bottom: 12px; }
                p { color: #888; font-size: 14px; line-height: 20px; }
            </style>
        </head>
        <body>
            <div class='card'>
                <div class='emoji'>&#128274;</div>
                <h1>This Space is private</h1>
                <p>Ask the host for their invite link or 6-character Space code, then open it in the MovieSpaces app to join.</p>
            </div>
        </body>
        </html>";

        [HttpGet("search")]
        public async Task<IActionResult> SearchSpaces([FromQuery] int filmId)
        {
            var spaces = await _db.Groups
                .AsNoTracking()
                .Include(g => g.Members)
                .Where(g => g.FilmId == filmId && g.Status == "pending")
                // Same rule as GetOpenSpaces: a private Space must never
                // surface in a browse/search feed — being listed at all leaks
                // what IsPrivate exists to hide.
                .Where(g => !g.IsPrivate)
                .OrderByDescending(g => g.CreatedAt)
                .ToListAsync();

            // SpaceCode is the private-join credential elsewhere; browse feeds
            // never need it. AsNoTracking above makes this a pure serialization
            // redaction, not a pending entity change.
            foreach (var space in spaces) space.SpaceCode = null;

            return Ok(spaces);
        }

        // NEW: General "open spaces" feed for the Explore tab. Unlike SearchSpaces (which
        // requires a filmId), this returns all open/pending spaces across films, optionally
        // narrowed by filmId and/or cinemaId. No auth required so Explore can show this to
        // signed-out browsers too.
        [HttpGet("open")]
        [AllowAnonymous]
        public async Task<IActionResult> GetOpenSpaces([FromQuery] int? filmId, [FromQuery] int? cinemaId)
        {
            var query = _db.Groups
                .AsNoTracking()
                .Include(g => g.Members)
                .Where(g => g.Status == "pending")
                // IsPrivate is independent of SpaceType — either a real
                // theater screening or a custom-venue watch party can be
                // marked invite-only at creation. Excluded from the one feed
                // anyone can browse without already having been invited;
                // JoinGroup itself also enforces the SpaceCode for these (see
                // its own comment), so this isn't just hiding from browse.
                .Where(g => !g.IsPrivate)
                // Community Spaces (IsPublic) are deliberately excluded here
                // too, not just IsPrivate ones — they're evergreen genre
                // clubs, not a real time/place gathering, and mixing them into
                // "nearby public gatherings" was drowning out actual local
                // screenings (a club with no ScreeningTime and effectively
                // unlimited capacity never expires or fills up the way a real
                // event does). They have their own discovery path instead:
                // GET community-spaces/discover, surfaced via Home's "My
                // Community Clubs" and Explore's "Browse Community Clubs".
                //
                // create-space.tsx (the only creation path for a real Space)
                // always sets ScreeningTime now, so a null one here means this
                // row predates that column and is guaranteed stale — hidden
                // rather than showing an already-past Space forever.
                .Where(g => !g.IsPublic)
                .Where(g => g.ScreeningTime != null && g.ScreeningTime >= DateTime.UtcNow)
                // Capacity guard — don't surface a Space nobody can actually
                // join anymore. MaxCapacity always has a value (defaults to
                // 40 at creation), so there's no need to special-case 0/null.
                .Where(g => g.Members.Count(m => m.Confirmed) < g.MaxCapacity);

            if (filmId.HasValue)
                query = query.Where(g => g.FilmId == filmId.Value);

            if (cinemaId.HasValue)
                query = query.Where(g => g.CinemaId == cinemaId.Value);

            var spaces = await query
                .OrderBy(g => g.ScreeningTime)
                .Take(50)
                .ToListAsync();

            // This endpoint is anonymous — even though only non-private Spaces
            // are listed, their join codes are share credentials the host hands
            // out, not something the open feed should broadcast. AsNoTracking
            // above makes this a pure serialization redaction.
            foreach (var space in spaces) space.SpaceCode = null;

            return Ok(spaces);
        }

        [HttpGet("mine")]
        [Authorize]
        public async Task<IActionResult> GetMySpaces()
        {
            try
            {
                string userId = GetUserId();

                if (string.IsNullOrEmpty(userId))
                {
                    return Unauthorized(new { error = "User identity could not be extracted from the token." });
                }

                var mySpaces = await _db.Groups
                    .Include(g => g.Members)
                    .Where(g => g.UserId == userId || g.Members.Any(m => m.UserId == userId))
                    .OrderByDescending(g => g.CreatedAt)
                    .ToListAsync();

                return Ok(mySpaces);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "An error occurred while fetching user spaces.");
                return StatusCode(500, new { error = "Internal server error occurred." });
            }
        }

        [HttpPost("{id}/join")]
        public async Task<IActionResult> JoinGroup(Guid id, [FromBody] JoinGroupRequest req)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            // Guard: don't add a duplicate GroupMember row if this user already joined.
            var existing = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == userId);
            if (existing != null)
            {
                return Ok(new { memberId = existing.Id });
            }

            // Real access control, not just "hidden from Explore" — a known
            // groupId alone (a forwarded link, a guessed guid) isn't enough
            // for a private Space; the caller has to actually present the
            // matching SpaceCode. In practice the host never reaches this
            // check at all (CreateGroup adds them as a confirmed GroupMember
            // up front, so the existing-member guard above already returns
            // early for them) — group.UserId != userId here is just defensive
            // redundancy, not the thing actually exempting them.
            if (group.IsPrivate && group.UserId != userId)
            {
                var providedCode = (req.SpaceCode ?? "").Trim();
                if (!string.Equals(providedCode, group.SpaceCode, StringComparison.OrdinalIgnoreCase))
                    return StatusCode(403, new { error = "This Space is private — enter it using the invite code." });
            }

            // Enforce the advertised capacity/status here — the UI shows
            // "X / Y spots filled" and hides full Spaces from Explore, but
            // nothing stopped a direct call to this endpoint from over-filling
            // a Space or joining a cancelled one.
            if (group.Status == "cancelled")
                return BadRequest(new { error = "This Space has been cancelled." });

            var memberCount = await _db.GroupMembers.CountAsync(m => m.GroupId == id);
            if (memberCount >= group.MaxCapacity)
                return BadRequest(new { error = "This Space is already full." });

            // Same cap the anonymous JoinGroupWeb path enforces — GroupMember.Name
            // is varchar(100), so without this an over-long name is a 500 rather
            // than a readable error.
            var tooLong = CheckLength(req.Name, GroupFieldLimits.Name, "Your name");
            if (tooLong != null) return BadRequest(new { error = tooLong });

            var member = new GroupMember
            {
                GroupId = id,
                Name = _profanityFilter.CleanOrFallback(req.Name, "A Movie Fan"),
                UserId = userId,
                Confirmed = false
            };

            _db.GroupMembers.Add(member);
            await _db.SaveChangesAsync();

            return Ok(new { memberId = member.Id });
        }

        [HttpPost("{id}/join-web")]
        [AllowAnonymous]
        [EnableRateLimiting("guest-join")]
        public async Task<IActionResult> JoinGroupWeb(Guid id, [FromBody] JoinGroupRequest req)
        {
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            // Anonymous endpoint, so this is the only thing standing between a
            // stranger and an arbitrarily long name rendered into the public
            // invite page's attendee list.
            if ((req.Name?.Length ?? 0) > GroupFieldLimits.Name)
                return BadRequest(new { error = $"Name is too long (max {GroupFieldLimits.Name} characters)." });
            if ((req.GuestToken?.Length ?? 0) > 200)
                return BadRequest(new { error = "Invalid guest token." });

            // Cleaned once, up front — the de-dupe check below compares
            // against Names already stored cleaned, so comparing against the
            // raw, uncleaned request would never match on a repeat submit
            // from the same person and create a duplicate member row.
            var cleanName = _profanityFilter.CleanOrFallback(req.Name, "A Movie Fan");

            // Access gates run BEFORE the returning-guest branch below. That
            // branch writes (it renames the matched member) and returns early,
            // so with the gates after it, a caller presenting a guest token
            // could update a name in a private or cancelled Space without ever
            // passing the SpaceCode check. The invite page always resends the
            // code, so a legitimate returning guest still clears this.
            //
            // Same SpaceCode enforcement as the authenticated join path — web
            // joiners have no UserId to exempt as "the host" (a host always
            // joins through the authenticated app, never this endpoint), so
            // this check applies unconditionally for a private Space here.
            if (group.IsPrivate)
            {
                var providedCode = (req.SpaceCode ?? "").Trim();
                if (!string.Equals(providedCode, group.SpaceCode, StringComparison.OrdinalIgnoreCase))
                    return StatusCode(403, new { error = "This Space is private — enter it using the invite code." });
            }

            // Same capacity/status enforcement as the authenticated join path.
            if (group.Status == "cancelled")
                return BadRequest(new { error = "This Space has been cancelled." });

            // De-dupe on the browser's stable guest token when it sent one.
            // Name-based de-duping (the previous behaviour, kept only as a
            // fallback for a client that sends no token) is genuinely wrong:
            // two different guests both called "Alex" collapsed into a single
            // membership — the second silently received the first's memberId
            // and never actually joined — while one guest who typed "alex" and
            // then "Alex Smith" ended up as two separate members.
            var guestToken = string.IsNullOrWhiteSpace(req.GuestToken) ? null : req.GuestToken.Trim();
            var existing = guestToken != null
                ? await _db.GroupMembers.FirstOrDefaultAsync(m =>
                    m.GroupId == id && m.GuestToken == guestToken)
                : await _db.GroupMembers.FirstOrDefaultAsync(m =>
                    m.GroupId == id && m.UserId == "" && m.GuestToken == null
                    && m.Name.ToLower() == cleanName.Trim().ToLower());
            if (existing != null)
            {
                // A returning guest may have typed a different name than last
                // time; keep the latest rather than silently ignoring it.
                if (existing.Name != cleanName)
                {
                    existing.Name = cleanName;
                    await _db.SaveChangesAsync();
                }
                return Ok(new { memberId = existing.Id });
            }

            // Capacity is checked after the returning-guest branch on purpose:
            // someone already in a full Space re-opening the invite page should
            // resolve to their existing membership, not get "already full".
            var memberCount = await _db.GroupMembers.CountAsync(m => m.GroupId == id);
            if (memberCount >= group.MaxCapacity)
                return BadRequest(new { error = "This Space is already full." });

            var member = new GroupMember
            {
                GroupId = id,
                Name = cleanName,
                UserId = "",
                GuestToken = guestToken,
                // Confirmed, like before: a web guest has no way to come back
                // and RSVP later, so leaving them pending would stall the
                // host's "waiting for N confirmations" gate forever. The
                // member list marks them as web guests (see group.tsx) so the
                // host can tell this apart from a real in-app confirmation.
                Confirmed = true
            };

            _db.GroupMembers.Add(member);
            await _db.SaveChangesAsync();

            return Ok(new { memberId = member.Id });
        }

        // A member confirms/cancels their own RSVP (group.tsx's "Confirm
        // You're Going" / "Tap to Cancel" button); the host may additionally
        // toggle any member's RSVP. Without an ownership check here at all,
        // any authenticated user could flip anyone's RSVP on any Space just
        // by knowing the memberId — so the caller must be either the host or
        // the member being confirmed.
        [HttpPost("{id}/confirm/{memberId}")]
        public async Task<IActionResult> ConfirmMember(Guid id, Guid memberId)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            var member = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.Id == memberId && m.GroupId == id);
            if (member == null) return NotFound();

            if (group.UserId != userId && member.UserId != userId) return Forbid();

            member.Confirmed = true;
            await _db.SaveChangesAsync();

            return Ok();
        }

        [HttpPost("{id}/unconfirm/{memberId}")]
        public async Task<IActionResult> UnconfirmMember(Guid id, Guid memberId)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            var member = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.Id == memberId && m.GroupId == id);
            if (member == null) return NotFound();

            if (group.UserId != userId && member.UserId != userId) return Forbid();

            member.Confirmed = false;
            await _db.SaveChangesAsync();

            return Ok();
        }

        // Was [AllowAnonymous] with an unbounded "+= 1" write per call and no
        // dedupe — anyone on the internet could loop this to hammer the DB and
        // inflate any Space's "flagged as possibly outdated" counter until it
        // looked untrustworthy. The only caller is group.tsx's Report action,
        // which already goes through authFetch, so requiring a token costs
        // nothing; the rate-limit policy caps it further.
        [HttpPost("{id}/report-showtime")]
        [EnableRateLimiting("write-heavy")]
        public async Task<IActionResult> ReportShowtime(Guid id)
        {
            var userId = GetUserId();
            var group = await _db.Groups
                .Include(g => g.Members)
                .FirstOrDefaultAsync(g => g.Id == id);
            if (group == null) return NotFound();

            // Members only — "flagged by N members" is the claim the UI makes,
            // and without this gate any authenticated user could brand a
            // stranger's Space "possibly outdated" from a handful of accounts.
            var isMember = group.UserId == userId || group.Members.Any(m => m.UserId == userId);
            if (!isMember) return Forbid();

            group.ShowtimeReportCount += 1;
            await _db.SaveChangesAsync();

            return Ok(new { showtimeReportCount = group.ShowtimeReportCount });
        }

        // Group chat itself lives in Supabase (group_messages), not this
        // backend/EF database — the .NET side has no way to observe a new
        // message on its own. The client calls this right after a successful
        // send so the (EF-owned) push token / membership data can be used to
        // notify everyone else in the Space.
        // Rate-limited: this fans a push out to every member of the Space, so
        // it's the highest-amplification endpoint in the app — one request
        // becomes N notifications on N devices.
        [HttpPost("{id}/notify-message")]
        [EnableRateLimiting("write-heavy")]
        public async Task<IActionResult> NotifyNewMessage(Guid id, [FromBody] NotifyMessageRequest req)
        {
            var senderId = GetUserId();

            // Gate on membership: only someone actually in the Space (host or a
            // joined member) may fan a "new message" push out to everyone else.
            // Otherwise any authenticated user could spam arbitrary sender names
            // and previews to every member of any group id they guess.
            var group = await _db.Groups
                .Include(g => g.Members)
                .FirstOrDefaultAsync(g => g.Id == id);
            if (group == null) return NotFound();
            var isMember = group.UserId == senderId || group.Members.Any(m => m.UserId == senderId);
            if (!isMember) return Forbid();

            // Null-safe: both come straight off the request body, so a client
            // omitting either shouldn't produce a 500.
            var senderName = string.IsNullOrWhiteSpace(req.SenderName) ? "Someone" : req.SenderName;
            var rawPreview = req.Preview ?? "";
            var preview = rawPreview.Length > 120 ? rawPreview.Substring(0, 120) + "…" : rawPreview;
            await NotifyMembersAsync(id, $"💬 {senderName}", preview, excludeUserId: senderId);
            return Ok();
        }

        [HttpGet("/.well-known/apple-app-site-association")]
        [AllowAnonymous]
        public IActionResult GetAppleAppSiteAssociation()
        {
            var association = new
            {
                applinks = new
                {
                    apps = new string[] { },
                    details = new[]
                    {
                        new
                        {
                            appID = "8J48NY9S42.com.newfahrenheit45.Moviespaces",
                            paths = new[] { "/space/*" }
                        }
                    }
                }
            };

            return new JsonResult(association) { ContentType = "application/json" };
        }

        // The Android counterpart to the Apple association file above. app.json
        // declares an autoVerify:true intent filter for https://<host>/space,
        // but Android only honours it if this file verifies — without it,
        // verification silently fails and every https invite link opens the
        // browser even when the app is installed. Returns 404 rather than an
        // empty statement list until the signing fingerprints are configured,
        // since a malformed/empty file is worse than an absent one.
        [HttpGet("/.well-known/assetlinks.json")]
        [AllowAnonymous]
        public IActionResult GetAndroidAssetLinks([FromServices] IConfiguration configuration)
        {
            var package = configuration["AppLinks:AndroidPackageName"];
            var fingerprints = (configuration["AppLinks:AndroidSha256Fingerprints"] ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (string.IsNullOrWhiteSpace(package) || fingerprints.Length == 0)
                return NotFound();

            var statements = new[]
            {
                new
                {
                    relation = new[] { "delegate_permission/common.handle_all_urls" },
                    target = new
                    {
                        @namespace = "android_app",
                        package_name = package,
                        sha256_cert_fingerprints = fingerprints,
                    },
                },
            };

            return new JsonResult(statements) { ContentType = "application/json" };
        }

        [HttpPost("{id}/book")]
        public async Task<IActionResult> BookGroup(Guid id)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            group.Status = "booked";
            await _db.SaveChangesAsync();

            await NotifyMembersAsync(
                id,
                "🎉 Your Space is booked!",
                $"{group.FilmName} at {group.CinemaName} — {group.ShowDate} at {group.ShowTime}."
            );

            return Ok();
        }

        // Host-only: reverts an accidental/premature "Mark Group Booked".
        // Deliberately doesn't re-notify members — an unbook isn't good news
        // worth pushing to everyone the way a booking confirmation is.
        [HttpPost("{id}/unbook")]
        public async Task<IActionResult> UnbookGroup(Guid id)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            group.Status = "pending";
            await _db.SaveChangesAsync();

            return Ok();
        }

        // Host-only: lets a "tentative crowdfund" rental host add the real
        // confirmation link once they actually buy the room, without
        // recreating the Space.
        [HttpPost("{id}/booking-url")]
        public async Task<IActionResult> UpdateBookingUrl(Guid id, [FromBody] UpdateBookingUrlRequest req)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            var tooLong = CheckLength(req.BookingUrl, GroupFieldLimits.Url, "The link");
            if (tooLong != null) return BadRequest(new { error = tooLong });

            // Members tap this link straight into an in-app browser, so only
            // web URLs are storable — a javascript:/file:/custom-scheme value
            // has no legitimate use as a ticket link. Empty clears the link.
            var trimmedUrl = req.BookingUrl?.Trim() ?? "";
            if (trimmedUrl.Length > 0 && !IsWebUrl(trimmedUrl))
                return BadRequest(new { error = "The link must be a full web address (starting with https://)." });

            group.BookingUrl = trimmedUrl;
            await _db.SaveChangesAsync();

            return Ok(new { bookingUrl = group.BookingUrl });
        }

        // Host-only: edits the core event details after creation. Previously
        // the only mutations available post-creation were book/unbook/cancel/
        // delete/transfer — nothing let a host fix a wrong showtime, correct a
        // typo, raise capacity, or update the venue name. That made
        // ShowtimeReportCount ("Flagged by N members as possibly outdated")
        // pointless: members could flag a stale showtime, but the host had no
        // way to actually correct it short of deleting the whole Space and
        // losing every RSVP, the chat history, and the invite links already
        // sent out.
        //
        // Every field is optional and only overwrites when present, so a
        // partial edit (e.g. just fixing the time) doesn't require the client
        // to resend everything else.
        [HttpPost("{id}/edit")]
        public async Task<IActionResult> EditGroup(Guid id, [FromBody] EditGroupRequest req)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();
            // Match-mode crews have no real host — "host" is just whoever
            // tapped the movie first, and if they never come back the crew
            // would be stuck with no way to set a theater or showtime. Any
            // seated member can fill in the where/when for a crew.
            var isCrewMember = group.MatchMovieKey != null
                && !string.IsNullOrEmpty(userId)
                && await _db.GroupMembers.AnyAsync(m => m.GroupId == id && m.UserId == userId);
            if (group.UserId != userId && !isCrewMember) return Forbid();

            // A crew's film is its identity (MatchMovieKey) and its size is
            // fixed — nobody, host included, gets to retitle the crew or
            // open it to 5000 seats (MatchForMovie would keep seating
            // strangers into it). Crews edit the where/when only.
            if (group.MatchMovieKey != null)
                req = req with { FilmName = null, MaxCapacity = null };

            if (req.MaxCapacity.HasValue)
            {
                // Same 1..5000 window CreateGroup enforces.
                if (req.MaxCapacity.Value < 1 || req.MaxCapacity.Value > 5000)
                    return BadRequest(new { error = "Capacity must be between 1 and 5000." });
                var memberCount = await _db.GroupMembers.CountAsync(m => m.GroupId == id);
                if (req.MaxCapacity.Value < memberCount)
                    return BadRequest(new { error = $"Capacity can't be less than the {memberCount} people already in this Space." });
            }

            if (req.TotalCostCents.HasValue && req.TotalCostCents.Value < 0)
                return BadRequest(new { error = "Cost can't be negative." });

            var tooLong = FirstFieldOverLimit(req);
            if (tooLong != null) return BadRequest(new { error = tooLong });

            // A corrected showtime is exactly what ShowtimeReportCount exists to
            // prompt — resetting it here is what makes fixing the flag
            // actually visible, instead of the count staying stuck at whatever
            // it was before the correction.
            var showtimeChanged =
                (req.ShowDate != null && req.ShowDate != group.ShowDate) ||
                (req.ShowTime != null && req.ShowTime != group.ShowTime) ||
                (req.ScreeningTime.HasValue && req.ScreeningTime != group.ScreeningTime);

            if (req.FilmName != null)
            {
                // Same rule CreateGroup uses: only filter freeform titles (no
                // real catalog id backing them). A real movie/TV title from
                // OMDb should never be able to trip the profanity filter.
                var filmNameIsFreeform = group.FilmId == null && group.TmdbMovieId == null;
                group.FilmName = filmNameIsFreeform
                    ? _profanityFilter.CleanOrFallback(req.FilmName, group.FilmName)
                    : req.FilmName;
            }
            if (req.CinemaName != null) group.CinemaName = req.CinemaName.Trim();
            if (req.ShowDate != null) group.ShowDate = req.ShowDate.Trim();
            if (req.ShowTime != null) group.ShowTime = req.ShowTime.Trim();
            if (req.ScreeningTime.HasValue) group.ScreeningTime = ToUtc(req.ScreeningTime);
            if (req.MaxCapacity.HasValue) group.MaxCapacity = req.MaxCapacity.Value;
            if (req.TotalCostCents.HasValue) group.TotalCostCents = req.TotalCostCents.Value;
            if (req.HangoutNotes != null)
            {
                group.HangoutNotes = _profanityFilter.ContainsProfanity(req.HangoutNotes)
                    ? group.HangoutNotes
                    : req.HangoutNotes.Trim();
            }

            if (showtimeChanged)
            {
                group.ShowtimeReportCount = 0;

                // ReminderSent is a one-way latch that ReminderBackgroundService
                // sets after firing the "starting soon" push. That was safe while
                // a Space's time couldn't change post-creation — now that it can,
                // leaving it set means rescheduling an event whose reminder
                // already went out silently gets no reminder at its new time.
                // Resetting is safe: the service only picks up Spaces inside its
                // 2-hour window, so a past or far-future time just won't match.
                group.ReminderSent = false;
            }

            await _db.SaveChangesAsync();

            if (showtimeChanged)
            {
                // Attribute to whoever actually made the change — for a crew
                // that can be any seated member, not the host.
                var editorName = group.UserId == userId
                    ? group.HostName
                    : (await _db.GroupMembers
                        .Where(m => m.GroupId == id && m.UserId == userId)
                        .Select(m => m.Name)
                        .FirstOrDefaultAsync()) ?? group.HostName;
                await NotifyMembersAsync(
                    id,
                    "Showtime updated",
                    $"{editorName} updated {group.FilmName}'s date/time to {group.ShowDate} at {group.ShowTime}.",
                    excludeUserId: userId
                );
            }

            return Ok(group);
        }

        // Host-only: removes someone from the Space without deleting or
        // cancelling the whole thing. Previously the only member-removal path
        // was the member leaving on their own (or blocking, which is
        // account-level and only hides content — it was never actually
        // possible for a host to remove someone from their own event.
        [HttpPost("{id}/remove-member/{memberId}")]
        public async Task<IActionResult> RemoveMember(Guid id, Guid memberId)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            var member = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.Id == memberId && m.GroupId == id);
            if (member == null) return NotFound();

            // A host removes members, not themselves — Cancel/Delete/Hand Off
            // Ownership already cover every case of a host leaving their own
            // Space, and removing the host row here would leave the Space
            // with no owner.
            if (member.UserId == group.UserId) return BadRequest(new { error = "The host can't be removed. Use Hand Off Ownership instead." });

            _db.GroupMembers.Remove(member);
            await _db.SaveChangesAsync();

            return Ok();
        }

        // Host-only: permanently deletes the Space. GroupMembers cascade-delete
        // via the FK (required relationship, EF's default Cascade behavior).
        // Note: group_messages (Supabase-direct, not EF-owned) has no FK back
        // to Groups, so any chat history is left orphaned rather than cleaned
        // up here — harmless, just not reclaimed.
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteGroup(Guid id)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            _db.Groups.Remove(group);
            await _db.SaveChangesAsync();

            return Ok();
        }

        // Host-only: hands the host role to an existing member instead of
        // deleting the Space. The outgoing host stays on as a regular member.
        [HttpPost("{id}/transfer-ownership")]
        public async Task<IActionResult> TransferOwnership(Guid id, [FromBody] TransferOwnershipRequest req)
        {
            var userId = GetUserId();
            var group = await _db.Groups
                .Include(g => g.Members)
                .FirstOrDefaultAsync(g => g.Id == id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            // Web guests are stored with UserId == "" — without this guard,
            // newHostUserId: "" matches one of them and sets group.UserId to
            // "", which no JWT subject can ever equal again: every host-only
            // action is permanently locked out and the Space is orphaned.
            if (string.IsNullOrWhiteSpace(req.NewHostUserId))
                return BadRequest(new { error = "The new host must be a member with an account." });

            var newHost = group.Members.FirstOrDefault(m => m.UserId == req.NewHostUserId);
            if (newHost == null)
                return BadRequest(new { error = "That member is not part of this Space." });

            group.UserId = newHost.UserId;
            group.HostName = newHost.Name;
            await _db.SaveChangesAsync();

            return Ok(new { hostName = group.HostName });
        }

        // Host-only: flags the Space as cancelled (distinct from DeleteGroup —
        // this keeps the Space and its history around, just marks it dead and
        // tells everyone who'd confirmed attendance).
        [HttpPost("{id}/cancel")]
        public async Task<IActionResult> CancelGroup(Guid id)
        {
            var userId = GetUserId();
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();
            if (group.UserId != userId) return Forbid();

            group.Status = "cancelled";
            await _db.SaveChangesAsync();

            await NotifyMembersAsync(
                id,
                "❌ Space cancelled",
                $"{group.HostName} cancelled {group.FilmName} at {group.CinemaName}."
            );

            return Ok();
        }

        // Removes the caller's own membership. The per-person cost split is
        // derived client-side from confirmed member count, so nothing else
        // needs recalculating server-side.
        [HttpPost("{id}/leave")]
        public async Task<IActionResult> LeaveGroup(Guid id)
        {
            var userId = GetUserId();
            var member = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == userId);
            if (member == null) return NotFound();

            _db.GroupMembers.Remove(member);
            await _db.SaveChangesAsync();

            return Ok();
        }
    }

    public record CreateGroupRequest(
        string HostName,
        int? CinemaId,
        string CinemaName,
        int? FilmId,
        string FilmName,
        string ShowTime,
        string ShowDate,
        string? BookingUrl,
        string? SpaceType,
        long? TotalCostCents,
        int? MaxCapacity,
        string[]? PostActivities,
        string? HangoutNotes,
        string? GooglePlaceId,
        double? TheaterLatitude,
        double? TheaterLongitude,
        int? TmdbMovieId,
        DateTime? ScreeningTime,
        string? SeasonEpisodeInfo,
        string? PosterPath,
        string? EventCategory,
        bool? IsPrivate
    );

    // Anyone-can-create community club: just a name + genre. HostName is the
    // creator's display name for the "created by" label (falls back if blank).
    public record CreateClubRequest(string Name, string? GenreCategory, string? HostName);

    // Match mode: the movie you want to see. ImdbId when picked from search
    // (exact match key), PosterPath for the group card, HostName for membership.
    // Kind: "theater" (default) or "venue" — see MatchForMovie. Either
    // JoinGroupId (join a listed crew) or a showing (CinemaName + ScreeningTime
    // + ShowDate/ShowTime [+ coordinates]) to start one.
    public record MatchRequest(
        string MovieTitle,
        string? ImdbId,
        string? PosterPath,
        string? HostName,
        string? Kind,
        Guid? JoinGroupId,
        string? CinemaName,
        DateTime? ScreeningTime,
        string? ShowDate,
        string? ShowTime,
        double? TheaterLatitude,
        double? TheaterLongitude,
        bool? HasTicket);

    public record TicketRequest(bool HasTicket);

    // SpaceCode is only checked when joining a private Space (see JoinGroup)
    // — optional so the request shape stays the same for every public join.
    // GuestToken is web-only (see JoinGroupWeb): a stable per-browser id that
    // gives accountless joiners something to de-dupe on other than their name.
    public record JoinGroupRequest(string Name, string? SpaceCode = null, string? GuestToken = null);
    public record UpdateBookingUrlRequest(string? BookingUrl);

    // Every field optional — EditGroup only overwrites what's present, so a
    // client can send just the one thing being fixed.
    public record EditGroupRequest(
        string? FilmName,
        string? CinemaName,
        string? ShowTime,
        string? ShowDate,
        DateTime? ScreeningTime,
        int? MaxCapacity,
        long? TotalCostCents,
        string? HangoutNotes
    );
    public record NotifyMessageRequest(string SenderName, string Preview);
    public record TransferOwnershipRequest(string NewHostUserId);
}
