using Backend.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using Stripe;
using Refit;
using Backend.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHttpClient();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
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

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));

// Pledge authorization for the crowdfunded-spaces feature needs this.
var stripeSecretKey = builder.Configuration["Stripe:SecretKey"];
if (string.IsNullOrEmpty(stripeSecretKey))
{
    throw new InvalidOperationException("CRITICAL: 'Stripe:SecretKey' was not found in configuration!");
}
StripeConfiguration.ApiKey = stripeSecretKey;

// Verifies StripeWebhookController's incoming event signatures. Set this to
// the "Signing secret" shown after creating the webhook endpoint in the
// Stripe dashboard (Developers > Webhooks > Add endpoint, pointing at
// <your-backend-url>/api/stripe/webhook).
var stripeWebhookSecret = builder.Configuration["Stripe:WebhookSecret"];
if (string.IsNullOrEmpty(stripeWebhookSecret))
{
    throw new InvalidOperationException("CRITICAL: 'Stripe:WebhookSecret' was not found in configuration!");
}

builder.Services.AddScoped<PledgeSettlementService>();
builder.Services.AddHostedService<SpaceDeadlineSweepService>();

// TMDB is the movie data source for crowdfunded spaces (spaces.movie_id/
// movie_title/movie_poster_url) — using the v3 api_key (sent per-request as a
// query param by ITmdbApi), not the v4 Bearer Read Access Token.
var tmdbApiKey = builder.Configuration["Tmdb:ApiKey"];
if (string.IsNullOrEmpty(tmdbApiKey))
{
    throw new InvalidOperationException("CRITICAL: 'Tmdb:ApiKey' was not found in configuration!");
}
builder.Services
    .AddRefitClient<ITmdbApi>()
    .ConfigureHttpClient(c =>
    {
        c.BaseAddress = new Uri("https://api.themoviedb.org/3");
    });

var app = builder.Build();

app.UseCors("AllowReactApp");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

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
