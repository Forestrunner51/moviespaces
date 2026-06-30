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

// --- DYNAMIC DATABASE MIGRATION RECONCILIATION LOOP ---
using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    try
    {
        var context = services.GetRequiredService<AppDbContext>();

        // 1. Ensure the tracking table exists explicitly in the public schema
        await context.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""__EFMigrationsHistory"" (
                ""MigrationId"" character varying(150) NOT NULL CONSTRAINT ""PK___EFMigrationsHistory"" PRIMARY KEY,
                ""ProductVersion"" character varying(32) NOT NULL
            );
        ");

        // 2. Query the metadata table via ADO.NET abstraction layer to check historical logs
        var recordCheckCommand = context.Database.GetDbConnection().CreateCommand();
        recordCheckCommand.CommandText = @"SELECT COUNT(1) FROM ""__EFMigrationsHistory"" WHERE ""MigrationId"" = '20260522223223_InitialCreate';";

        if (context.Database.GetDbConnection().State != System.Data.ConnectionState.Open)
        {
            await context.Database.GetDbConnection().OpenAsync();
        }

        long historyCount = 0;
        var result = await recordCheckCommand.ExecuteScalarAsync();
        if (result != null)
        {
            historyCount = Convert.ToInt64(result);
        }

        // 3. If missing, seed it dynamically so EF Core knows the table footprint is already taken care of
        if (historyCount == 0)
        {
            await context.Database.ExecuteSqlRawAsync(@"
                INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
                VALUES ('20260522223223_InitialCreate', '10.0.8')
                ON CONFLICT DO NOTHING;
            ");
            Console.WriteLine("✅ Seeded InitialCreate history log entry into Render Postgres.");
        }

        // 4. Safely run the migration engine over the rest of the pending structural delta changes
        await context.Database.MigrateAsync();
        Console.WriteLine("🚀 All pending database migrations applied successfully!");
    }
    catch (Exception ex)
    {
        var logger = services.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "An error occurred executing database migrations.");
    }
}
// -----------------------------------------------------------------------

app.Run("http://*:5123");
