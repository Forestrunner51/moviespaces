using Backend.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient();

// 1. First, set up the CORS configuration options
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// 2. Register your operational controllers (ONCE only)
builder.Services.AddControllers();

// 3. Register your Database Context with validation
var connectionString = builder.Configuration.GetConnectionString("PostgresConnection");

if (string.IsNullOrEmpty(connectionString))
{
    throw new InvalidOperationException("CRITICAL: 'PostgresConnection' string was not found in appsettings.json!");
}

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));

var app = builder.Build();

// 4. PIPELINE ORDER MATTERS: UseRouting must come first implicitly, then Cors, then Authorization, then Controllers
app.UseCors("AllowReactApp");

app.UseAuthorization();

app.MapControllers();

using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    try
    {
        var context = services.GetRequiredService<AppDbContext>(); // Replace with your actual DbContext class name
        await context.Database.EnsureCreatedAsync();
        // OR use: await context.Database.MigrateAsync(); if you have migrations set up
    }
    catch (Exception ex)
    {
        var logger = services.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "An error occurred creating the DB.");
    }
}

app.Run("http://*:5123");
