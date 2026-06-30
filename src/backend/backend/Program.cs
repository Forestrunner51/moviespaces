using Backend.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;

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

var app = builder.Build();

app.UseCors("AllowReactApp");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    try
    {
        var context = services.GetRequiredService<AppDbContext>();
        await context.Database.MigrateAsync();
    }
    catch (Exception ex)
    {
        var logger = services.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "An error occurred creating the DB.");
    }
}

app.Run("http://*:5123");
