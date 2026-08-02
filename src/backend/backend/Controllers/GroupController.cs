using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
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
            var random = Random.Shared;
            for (var attempt = 0; attempt < 10; attempt++)
            {
                var code = new string(Enumerable.Range(0, 6)
                    .Select(_ => SpaceCodeAlphabet[random.Next(SpaceCodeAlphabet.Length)])
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
        public async Task<IActionResult> CreateGroup([FromBody] CreateGroupRequest req)
        {
            var userId = GetUserId();

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
                BookingUrl = req.BookingUrl ?? "",
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
                ScreeningTime = req.ScreeningTime,
                SeasonEpisodeInfo = string.IsNullOrWhiteSpace(req.SeasonEpisodeInfo) ? null : req.SeasonEpisodeInfo.Trim(),
                EventCategory = eventCategory,
            };

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
        private async Task<Group?> ResolveGroupAsync(string id)
        {
            if (Guid.TryParse(id, out var groupId))
                return await _db.Groups.Include(g => g.Members).FirstOrDefaultAsync(g => g.Id == groupId);

            var bySlug = await _db.Groups.Include(g => g.Members).FirstOrDefaultAsync(g => g.Slug == id);
            if (bySlug != null) return bySlug;

            var normalizedCode = id.Trim().ToUpperInvariant();
            return await _db.Groups.Include(g => g.Members).FirstOrDefaultAsync(g => g.SpaceCode == normalizedCode);
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
                .Where(g => g.IsPublic)
                .ToListAsync();
            var clubs = requested.Count == 0
                ? allPublicClubs
                : allPublicClubs.Where(g => g.GenreCategory != null && requested.Contains(g.GenreCategory)).ToList();

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
                    memberCount = r.memberCount,
                    playedTodayCount = r.playedTodayCount,
                    todayAvgScore = r.todayAvgScore,
                    isJoined = r.isJoined,
                })
                .ToList();

            return Ok(new { spaces = ranked });
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetGroup(string id)
        {
            var group = await ResolveGroupAsync(id);
            if (group == null) return NotFound();
            return Ok(group);
        }

        [HttpGet("/space/{id}")]
        [AllowAnonymous]
        public async Task<IActionResult> SpaceInvitePage(string id)
        {
            var group = await ResolveGroupAsync(id);
            if (group == null) return NotFound();

            // SECURITY: HTML-encode all user-controlled strings before interpolating into
            // the page. FilmName / HostName / member Name are user-supplied (group creation,
            // join, join-web) and this page is public + unauthenticated, so unescaped values
            // here are a stored-XSS vector for every visitor who opens the invite link.
            var filmName = WebUtility.HtmlEncode(group.FilmName);
            var cinemaName = WebUtility.HtmlEncode(group.CinemaName);
            var hostName = WebUtility.HtmlEncode(group.HostName);
            var showTime = WebUtility.HtmlEncode(group.ShowTime);
            var showDate = WebUtility.HtmlEncode(group.ShowDate);

            var html = $@"
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='utf-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1'>
            <title>{filmName} - MovieSpaces</title>
            <meta property='og:title' content='{filmName} - MovieSpaces'>
            <meta property='og:description' content='{hostName} is watching {filmName} at {cinemaName} on {showDate} at {showTime}. Join them!'>
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
                    <input type='text' id='name' placeholder='Your name' />
                    <button onclick='joinSpace()'>🎟 I'm In!</button>
                </div>
                <div id='success' style='display:none'>
                    <div class='confirmed'>✓ You're in!</div>
                    <p style='color:#888'>The host will be notified.</p>
                </div>
                <a href='moviespaces://space/{group.Id}' class='app-link'>Open in the MovieSpaces App</a>
            </div>

            <script>
                const appLink = 'moviespaces://space/{group.Id}';
                setTimeout(() => {{ window.location = appLink; }}, 250);

                async function joinSpace() {{
                    const name = document.getElementById('name').value.trim();
                    if (!name) return;

                    const res = await fetch('/api/group/{group.Id}/join-web', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{ name }})
                    }});

                    if (res.ok) {{
                        document.getElementById('form').style.display = 'none';
                        document.getElementById('success').style.display = 'block';
                    }}
                }}
            </script>
        </body>
        </html>";

            return Content(html, "text/html");
        }

        [HttpGet("search")]
        public async Task<IActionResult> SearchSpaces([FromQuery] int filmId)
        {
            var spaces = await _db.Groups
                .Include(g => g.Members)
                .Where(g => g.FilmId == filmId && g.Status == "pending")
                .OrderByDescending(g => g.CreatedAt)
                .ToListAsync();

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
                .Include(g => g.Members)
                .Where(g => g.Status == "pending")
                // Private rentals are invite-only by design (a SpaceCode or
                // direct link is meant to be the only way in — see
                // join-by-code.tsx's own comment on this) — this is the
                // enforcement of that: excluded from the one feed anyone can
                // browse without already having been invited. JoinGroup
                // itself still has no separate check, same trust model as
                // sharing a link today — this only stops "found by
                // scrolling," not "someone forwarded me the link."
                .Where(g => g.SpaceType != "private_rental")
                // create-space.tsx (the only creation path) always sets
                // ScreeningTime now, so a null one means this row predates
                // that column and is guaranteed stale — hide it rather than
                // showing an already-past Space forever. Public Community
                // Spaces are the one deliberate exception: they have no
                // ScreeningTime by design (there's no single event), and
                // without this OR they'd be permanently invisible in Explore
                // — the only place a user who skipped onboarding could ever
                // find and join one.
                .Where(g => g.IsPublic || (g.ScreeningTime != null && g.ScreeningTime >= DateTime.UtcNow))
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

            return Ok(spaces);
        }

        // GET /api/group/search-by-title?title=...
        //
        // Freeform private-rental titles (a Virtual "UFC 305" watch party,
        // say) have no catalog id the way a real movie/TV pick does, so
        // there's nothing today stopping two hosts from independently
        // creating the exact same event as two disconnected Spaces. This is
        // a nudge, not a hard block: surfaced client-side as "these already
        // exist, join one instead?" rather than preventing creation outright
        // — a same-named-but-different event is plausible enough (two
        // different friend groups' "Movie Night") that blocking would be
        // wrong more often than it'd help.
        [HttpGet("search-by-title")]
        [AllowAnonymous]
        public async Task<IActionResult> SearchByTitle([FromQuery] string? title)
        {
            var normalized = title?.Trim() ?? "";
            if (normalized.Length < 3) return Ok(new { spaces = Array.Empty<object>() });

            // Escape ILIKE's own wildcard characters — a title that happens
            // to contain a literal "%" or "_" (rare, but real event names do
            // sometimes have them) shouldn't be treated as a pattern itself.
            var escaped = normalized.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
            var pattern = $"%{escaped}%";
            var matches = await _db.Groups
                .Include(g => g.Members)
                .Where(g => g.Status == "pending" && !g.IsPublic)
                .Where(g => g.ScreeningTime == null || g.ScreeningTime >= DateTime.UtcNow)
                .Where(g => EF.Functions.ILike(g.FilmName, pattern))
                .OrderByDescending(g => g.CreatedAt)
                .Take(5)
                .Select(g => new
                {
                    g.Id,
                    g.FilmName,
                    g.HostName,
                    g.ShowDate,
                    g.ShowTime,
                    memberCount = g.Members.Count,
                })
                .ToListAsync();

            return Ok(new { spaces = matches });
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

            // Enforce the advertised capacity/status here — the UI shows
            // "X / Y spots filled" and hides full Spaces from Explore, but
            // nothing stopped a direct call to this endpoint from over-filling
            // a Space or joining a cancelled one.
            if (group.Status == "cancelled")
                return BadRequest(new { error = "This Space has been cancelled." });

            var memberCount = await _db.GroupMembers.CountAsync(m => m.GroupId == id);
            if (memberCount >= group.MaxCapacity)
                return BadRequest(new { error = "This Space is already full." });

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
        public async Task<IActionResult> JoinGroupWeb(Guid id, [FromBody] JoinGroupRequest req)
        {
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            // Cleaned once, up front — the de-dupe check below compares
            // against Names already stored cleaned, so comparing against the
            // raw, uncleaned request would never match on a repeat submit
            // from the same person and create a duplicate member row.
            var cleanName = _profanityFilter.CleanOrFallback(req.Name, "A Movie Fan");

            // Guard: web joiners have no UserId, so de-dupe on name instead (case-insensitive)
            // to avoid double-joins if the page reloads or the deep-link redirect races the click.
            var existing = await _db.GroupMembers
                .FirstOrDefaultAsync(m => m.GroupId == id
                    && m.UserId == ""
                    && m.Name.ToLower() == cleanName.Trim().ToLower());
            if (existing != null)
            {
                return Ok(new { memberId = existing.Id });
            }

            // Same capacity/status enforcement as the authenticated join path.
            if (group.Status == "cancelled")
                return BadRequest(new { error = "This Space has been cancelled." });

            var memberCount = await _db.GroupMembers.CountAsync(m => m.GroupId == id);
            if (memberCount >= group.MaxCapacity)
                return BadRequest(new { error = "This Space is already full." });

            var member = new GroupMember
            {
                GroupId = id,
                Name = cleanName,
                UserId = "",
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

        [HttpPost("{id}/report-showtime")]
        [AllowAnonymous]
        public async Task<IActionResult> ReportShowtime(Guid id)
        {
            var group = await _db.Groups.FindAsync(id);
            if (group == null) return NotFound();

            group.ShowtimeReportCount += 1;
            await _db.SaveChangesAsync();

            return Ok(new { showtimeReportCount = group.ShowtimeReportCount });
        }

        // Group chat itself lives in Supabase (group_messages), not this
        // backend/EF database — the .NET side has no way to observe a new
        // message on its own. The client calls this right after a successful
        // send so the (EF-owned) push token / membership data can be used to
        // notify everyone else in the Space.
        [HttpPost("{id}/notify-message")]
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

            var preview = req.Preview.Length > 120 ? req.Preview.Substring(0, 120) + "…" : req.Preview;
            await NotifyMembersAsync(id, $"💬 {req.SenderName}", preview, excludeUserId: senderId);
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

            group.BookingUrl = req.BookingUrl?.Trim() ?? "";
            await _db.SaveChangesAsync();

            return Ok(new { bookingUrl = group.BookingUrl });
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
        string? EventCategory
    );

    public record JoinGroupRequest(string Name);
    public record UpdateBookingUrlRequest(string? BookingUrl);
    public record NotifyMessageRequest(string SenderName, string Preview);
    public record TransferOwnershipRequest(string NewHostUserId);
}
