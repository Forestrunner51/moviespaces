using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Backend.IntegrationTests;

// Boots the real Program.cs against the test database, with two swaps:
//
//   1. Authentication. Production validates Supabase JWTs against Supabase's
//      JWKS, which would need a live Supabase and a way to mint tokens. The
//      test scheme below reads the caller's user id from an `X-Test-User`
//      header instead and issues the same NameIdentifier claim the
//      controllers' GetUserId() reads. Registered as the DEFAULT scheme so
//      [Authorize] never consults the Bearer handler.
//
//   2. Hosted services. The reminder pollers and the scrape scheduler are
//      removed — they'd run against the test DB and add nothing to what these
//      tests assert.
//
// Everything else — rate limiting, CORS, Kestrel limits, the SaveChanges
// interceptor, migrate-on-boot — is the production pipeline.
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public const string UserHeader = "X-Test-User";
    private readonly string _connectionString;

    public ApiFactory(string connectionString)
    {
        _connectionString = connectionString;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:PostgresConnection", _connectionString);
        // Program.cs throws without this; the value is only used to build the
        // JWT authority URL, which the test scheme never contacts.
        builder.UseSetting("Supabase:Url", "https://integration-tests.invalid");
        builder.UseSetting("Sentry:Dsn", "");
        builder.UseSetting("Showtimes:Enabled", "false");

        builder.ConfigureTestServices(services =>
        {
            foreach (var hosted in services.Where(d => d.ServiceType == typeof(IHostedService)).ToList())
                services.Remove(hosted);

            services.AddAuthentication(TestAuthHandler.Scheme)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.Scheme, _ => { });
        });
    }

    // A client that acts as `userId` on every request.
    public HttpClient ClientFor(string userId)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(UserHeader, userId);
        return client;
    }
}

public sealed class TestAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public new const string Scheme = "Test";

    public TestAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(ApiFactory.UserHeader, out var user) || string.IsNullOrWhiteSpace(user))
            return Task.FromResult(AuthenticateResult.NoResult());

        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.ToString()),
            new Claim("sub", user.ToString()),
        }, Scheme);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
