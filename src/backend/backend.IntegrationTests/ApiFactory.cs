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

    // A client that acts as `userId` on every request, from its own IP.
    //
    // The IP matters. Program.cs runs the rate limiter BEFORE authentication,
    // so every caller is partitioned by remote address, and TestServer gives
    // every request the same (null) one — which put all of a test class's
    // requests in one bucket and made the 10/min "write-heavy" policy start
    // returning 429 partway through a run. That is not what these tests are
    // asserting, and it made them order-dependent.
    //
    // Rather than switch the limiter off (which would stop exercising the
    // real middleware pipeline), give each simulated user its own address —
    // which is also what fifteen strangers racing for a crew seat actually
    // look like. Program.cs clears the known-proxy list and trusts one
    // forwarded hop, so X-Forwarded-For is what UseForwardedHeaders reads.
    public HttpClient ClientFor(string userId)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(UserHeader, userId);
        client.DefaultRequestHeaders.Add("X-Forwarded-For", IpFor(userId));
        return client;
    }

    // Deterministic per user id, inside the 10.0.0.0/8 private range.
    private static string IpFor(string userId)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(userId));
        return $"10.{hash[0]}.{hash[1]}.{(hash[2] == 0 ? 1 : hash[2])}";
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
