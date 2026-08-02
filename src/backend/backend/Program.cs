using Backend.Data;
using Backend.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
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
});

builder.Services.AddHttpClient();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<PushNotificationService>();
builder.Services.AddSingleton<OmdbClient>();
builder.Services.AddSingleton<IProfanityFilterService, ProfanityFilterService>();
builder.Services.AddSingleton<IDailyPuzzleService, DailyPuzzleService>();
builder.Services.AddSingleton<CineMindCatalogService>();
builder.Services.AddHostedService<ReminderBackgroundService>();
builder.Services.AddHostedService<CineMindReminderService>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
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
// Partitioned per authenticated user where possible, falling back to remote IP
// for anonymous callers, so one abusive client can't consume everyone's budget.
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
});
// ---------------------

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

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));

var app = builder.Build();

app.UseCors("AllowReactApp");
app.UseAuthentication();
app.UseAuthorization();
// After authentication so the limiter can partition on the caller's user id
// (see LimitPartitionKey) rather than lumping every signed-in user behind one
// shared IP bucket.
app.UseRateLimiter();
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
        logger.LogError(ex, "An error occurred executing database migrations.");
    }
}
app.Run("http://*:5123");
