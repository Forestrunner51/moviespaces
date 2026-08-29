using Backend.Data;
using Backend.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;
using Sentry.AspNetCore;
using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// Self-disables when Dsn is null/empty (unset in appsettings/env), so this is
// safe to leave unconfigured in local dev.
builder.WebHost.UseSentry(options =>
{
    options.Dsn = builder.Configuration["Sentry:Dsn"];
    options.TracesSampleRate = 1.0;
    // Turn on the Sentry Logs product. With this set, the app's existing
    // ILogger calls (e.g. the scraper's LogInformation/LogWarning/LogError,
    // which already use structured "{Placeholder}" params — the best-practice
    // form) forward to Sentry as searchable logs, not just error events.
    options.EnableLogs = true;
});

builder.Services.AddHttpClient();
// Every outbound call (Expo push, Supabase REST, OMDb, Google Places, the
// showtimes scrape) goes through the factory's default client. HttpClient's
// own default is 100 seconds, which on a single Render instance means one
// hung upstream can pin a request thread for nearly two minutes. 10s is
// well above any of these APIs' normal latency.
builder.Services.ConfigureHttpClientDefaults(http =>
    http.ConfigureHttpClient(client => client.Timeout = TimeSpan.FromSeconds(10)));
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<PushNotificationService>();
builder.Services.AddSingleton<OmdbClient>();
builder.Services.AddSingleton<IProfanityFilterService, ProfanityFilterService>();
builder.Services.AddSingleton<IDailyPuzzleService, DailyPuzzleService>();
builder.Services.AddSingleton<CineMindCatalogService>();
builder.Services.AddHostedService<ReminderBackgroundService>();
builder.Services.AddHostedService<CineMindReminderService>();
builder.Services.AddSingleton<ShowtimesScraperService>();
// Registered as a singleton AND a hosted service so ShowtimesController can
// resolve the same instance for its admin-triggered manual scrape — a bare
// AddHostedService registration isn't injectable into controllers.
builder.Services.AddSingleton<ShowtimesScrapeBackgroundService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<ShowtimesScrapeBackgroundService>());

// --- CORS ---
//
// This was AllowAnyOrigin(), which let any page on the internet call every
// endpoint and *read the response*. Bearer-token auth means that isn't the
// classic cookie-CSRF hole — a random site can't ride an existing session —
// but it did mean a token leaked anywhere (a copy-pasted log, a malicious
// in-app browser, an XSS on some unrelated page) could be driven against this
// API straight from a web page, with the results readable.
//
// Restricting origins is safe for the mobile app specifically because CORS is
// a *browser* mechanism: React Native's fetch sends no Origin header and
// enforces no preflight, so iOS/Android are unaffected by anything here. The
// backend's own server-rendered pages (/space/{id}, /cinemind-result/{id},
// /legal/*) are same-origin — note the join-web fetch in GroupController uses
// a relative URL — so they don't need an entry either.
//
// That leaves Expo's web dev server as the only genuine cross-origin caller.
// Configurable so deploying an actual web build later is an env var
// (Cors__AllowedOrigins__0=...) rather than a code change.
var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>();
if (corsOrigins == null || corsOrigins.Length == 0)
{
    // Expo web's default ports — 8081 for SDK 50+, 19006 for older/`--web`.
    corsOrigins = new[]
    {
        "http://localhost:8081",
        "http://localhost:19006",
        "http://127.0.0.1:8081",
        "http://127.0.0.1:19006",
    };
}

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        // AllowAnyHeader/AllowAnyMethod stay — the hole was the origin
        // wildcard, and once the caller is pinned to a known origin those two
        // grant nothing extra. Credentials are deliberately NOT allowed: auth
        // is a bearer token in a header, so cookies are never needed, and
        // leaving them off keeps this immune to cookie-based CSRF entirely.
        policy.WithOrigins(corsOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// Render terminates TLS at its own proxy and forwards to this app, so without
// this the per-connection RemoteIpAddress is the *proxy's* address for every
// request. That matters specifically because the rate limiter below partitions
// anonymous callers by IP: every anonymous request — including GET
// /api/group/open, which Home and Explore both hit on plain fetch — would
// otherwise share a single bucket and start 429ing real users under very
// modest traffic.
//
// ForwardLimit 1 = trust exactly one hop (Render's proxy). The known-proxy
// lists are cleared because a PaaS proxy has no stable address to pin. The
// tradeoff is that X-Forwarded-For can be spoofed to dodge a rate limit; that
// is strictly better than the alternative here, and rate limiting is not the
// only control on any of these endpoints.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

// --- RATE LIMITING ---
//
// There was none at all before this. Three things needed protecting:
//   1. Metered third-party APIs behind our own endpoints (OMDb's daily quota,
//      Google Places' per-request billing). [Authorize] keeps out randos, but
//      one free account could still drain the quota or run up the bill.
//   2. Unbounded DB writes (report-showtime).
//   3. The instance itself — this runs as a single Render instance, so a
//      modest flood is enough to make the app unavailable for everyone.
//
// The limiter runs BEFORE authentication (see the middleware order below), so
// at partition time nobody has been authenticated yet and every caller is
// keyed by remote IP — the user-id branches are kept so the key is right if
// the order ever changes, but today the IP fallback is what applies.
static string LimitPartitionKey(HttpContext http) =>
    http.User.FindFirstValue(ClaimTypes.NameIdentifier)
    ?? http.User.FindFirstValue("sub")
    ?? http.Connection.RemoteIpAddress?.ToString()
    ?? "anonymous";

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Applies to every endpoint that doesn't opt into a named policy. Generous
    // on purpose — the app polls (group.tsx refetches every 5s, chat every 4s),
    // so this has to sit well above normal foreground usage and only catch
    // genuine floods.
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
        RateLimitPartition.GetFixedWindowLimiter(LimitPartitionKey(http), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 300,
            Window = TimeSpan.FromMinutes(1),
        }));

    // Endpoints that cost real money per call (OMDb, Google Places). Well above
    // what the debounced search boxes generate by hand, far below what a script
    // needs to burn a daily quota.
    options.AddPolicy("metered-api", http =>
        RateLimitPartition.GetFixedWindowLimiter(LimitPartitionKey(http), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 60,
            Window = TimeSpan.FromMinutes(1),
        }));

    // Unbounded-write endpoints. A real user reports a bad showtime once, not
    // ten times a minute.
    options.AddPolicy("write-heavy", http =>
        RateLimitPartition.GetFixedWindowLimiter(LimitPartitionKey(http), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
        }));

    // Anonymous guest joins (POST /api/group/{id}/join-web). Writes a
    // GroupMember row with no authentication at all, so the only partition key
    // available is the caller's IP — which is also why this isn't just
    // "write-heavy": that policy's limit of 10 is tuned for one authenticated
    // user, and a group of friends joining from a single café/venue Wi-Fi all
    // share one IP bucket here. 30/min stays comfortably above any plausible
    // real-world group joining together while still making it impractical to
    // fill someone's Space with junk guests.
    //
    // Capacity (MaxCapacity, enforced in JoinGroupWeb) bounds total rows per
    // Space, so this isn't guarding unbounded DB growth — it's guarding
    // against a targeted flood filling a real host's event in seconds.
    options.AddPolicy("guest-join", http =>
        RateLimitPartition.GetFixedWindowLimiter(LimitPartitionKey(http), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
        }));
});
// ---------------------

// Nothing here accepts a file upload — images go to Supabase Storage directly
// from the client, never through this API — so every request body is JSON that
// should comfortably fit in a few KB. Kestrel's default ceiling is ~30MB,
// which for a JSON-only API is just an invitation to POST 30MB of text at an
// endpoint and make a single free-tier instance chew on it. 256KB is orders of
// magnitude above the largest legitimate request (a Space with full notes) and
// turns that into an immediate 413.
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 256 * 1024;
});

builder.Services.AddControllers();

// --- MODERN ASYMMETRIC SUPABASE JWT AUTHENTICATION SETUP ---
var supabaseUrl = builder.Configuration["Supabase:Url"];
if (string.IsNullOrEmpty(supabaseUrl))
{
    throw new InvalidOperationException("CRITICAL: 'Supabase:Url' was not found in configuration!");
}

// Format the required OIDC token authority base route
string authorityUrl = supabaseUrl.EndsWith("/") ? $"{supabaseUrl}auth/v1" : $"{supabaseUrl}/auth/v1";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Points .NET directly to Supabase's open signing key verification endpoints
        options.Authority = authorityUrl;
        options.MetadataAddress = $"{authorityUrl}/.well-known/openid-configuration";

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true, // Verifies token signatures using Supabase's public keys
            ValidateIssuer = true,
            ValidIssuer = authorityUrl,
            ValidateAudience = true,
            ValidAudience = "authenticated", // Standard audience string set by Supabase Auth
            ValidateLifetime = true
        };

        options.Events = new JwtBearerEvents
        {
            OnChallenge = async context =>
            {
                context.HandleResponse();
                context.Response.StatusCode = 401;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync("{\"error\":\"Unauthorized\"}");
            }
        };
    });
// -----------------------------------------------------------

builder.Services.AddAuthorization();

var connectionString = builder.Configuration.GetConnectionString("PostgresConnection");
if (string.IsNullOrEmpty(connectionString))
{
    throw new InvalidOperationException("CRITICAL: 'PostgresConnection' string was not found in appsettings.json!");
}

// Logs schema-level metadata for any failed SaveChanges (see the interceptor)
// so redacted DbUpdateExceptions become one identifiable line.
builder.Services.AddSingleton<PostgresErrorLoggingInterceptor>();
builder.Services.AddDbContext<AppDbContext>((sp, options) =>
    options
        .UseNpgsql(connectionString)
        .AddInterceptors(sp.GetRequiredService<PostgresErrorLoggingInterceptor>()));

var app = builder.Build();

// Must run before anything that reads the client IP or scheme — notably the
// rate limiter's anonymous partition key.
app.UseForwardedHeaders();

app.UseCors("AllowReactApp");
// Before authentication on purpose: an unauthenticated flood is throttled
// per IP before it costs a JWT signature check (and a possible JWKS refresh)
// per request. The cost is that signed-in users behind one NAT share an IP
// bucket — the global limit is generous enough (300/min) that this only
// bites an actual flood.
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// Anonymous, no database work — this exists to be pinged cheaply.
//
// Render's free tier spins the instance down after ~15 minutes idle, which
// costs the next real user a ~30s cold start AND stops background services
// (the daily CineMind reminder) from running on time. An external uptime
// pinger hitting this on a schedule keeps the instance warm.
// Exempt from rate limiting: this is what keeps the instance warm, and a
// throttled 429 here would look like a health failure to the uptime pinger.
app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    utc = DateTime.UtcNow,
})).AllowAnonymous().DisableRateLimiting();

// Applies any migrations not yet recorded in __EFMigrationsHistory. The DB is
// already fully migrated, so on a normal boot this is a single cheap check.
//
// A failure here is fatal on purpose: it's logged and then rethrown so the
// process exits non-zero and Render marks the deploy failed (keeping the
// previous healthy instance up). Swallowing it used to boot an app whose
// schema didn't match its code, which then failed one request at a time.
using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    try
    {
        var context = services.GetRequiredService<AppDbContext>();
        await context.Database.MigrateAsync();
        Console.WriteLine("🚀 Database structure is completely aligned and up-to-date!");
    }
    catch (Exception ex)
    {
        var logger = services.GetRequiredService<ILogger<Program>>();
        logger.LogCritical(ex, "Database migration failed; refusing to start.");
        throw;
    }
}

// Render injects PORT and routes traffic to it; the Dockerfile sets nothing
// else, so this is the single place the listening port is decided. Local
// `dotnet run` gets the same fallback unless launchSettings' applicationUrl
// (ASPNETCORE_URLS) is in play, which Kestrel honors ahead of an explicit
// Run(url) only when we don't pass one — so only pass one when PORT is set.
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(port))
{
    app.Run($"http://*:{port}");
}
else if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ASPNETCORE_URLS"))
    && app.Configuration["urls"] == null)
{
    app.Run("http://*:10000");
}
else
{
    app.Run();
}
