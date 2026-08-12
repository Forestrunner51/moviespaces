using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Backend.Controllers
{
    // ⚠️ TEMPORARY / THROWAWAY — DELETE THIS FILE once the AMC key is confirmed.
    //
    // Added only to verify that the AMC vendor key stored in the Render
    // environment (env var AMC__ApiKey → config key AMC:ApiKey) actually
    // authenticates against AMC's API from the production environment. It
    // returns ONLY diagnostic status — never the key itself. keyLength vs
    // keyTrimmedLength reveals stray whitespace in the stored variable without
    // exposing a single character of the secret.
    [ApiController]
    public class DebugController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;

        public DebugController(IHttpClientFactory httpClientFactory, IConfiguration configuration)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
        }

        [HttpGet("/debug/amc-check")]
        [AllowAnonymous]
        public async Task<IActionResult> AmcCheck()
        {
            var key = _configuration["AMC:ApiKey"] ?? "";
            if (string.IsNullOrWhiteSpace(key))
            {
                return Ok(new
                {
                    keyConfigured = false,
                    keyLength = 0,
                    note = "AMC:ApiKey is empty/missing in this environment.",
                });
            }

            try
            {
                var client = _httpClientFactory.CreateClient();
                var request = new HttpRequestMessage(
                    HttpMethod.Get,
                    "https://api.amctheatres.com/v2/movies?page-number=1&page-size=1");
                // Inside the try: Headers.Add throws FormatException on an
                // illegal header char (e.g. a key pasted with an interior
                // newline), and this endpoint exists precisely to diagnose a
                // mis-stored key — it must report that, not 500 on it. Trim
                // handles surrounding whitespace; the length fields still
                // reveal whether any was present.
                request.Headers.Add("X-AMC-Vendor-Key", key.Trim());

                var response = await client.SendAsync(request);
                var body = await response.Content.ReadAsStringAsync();
                var snippet = body.Length > 200 ? body.Substring(0, 200) : body;
                return Ok(new
                {
                    keyConfigured = true,
                    keyLength = key.Length,
                    keyTrimmedLength = key.Trim().Length,
                    amcStatus = (int)response.StatusCode,
                    amcOk = response.IsSuccessStatusCode,
                    // AMC error bodies contain only an error id/code/message
                    // (e.g. 12005 "Unauthorized VendorKey") — no credential —
                    // so a short snippet is safe and tells us exactly what AMC
                    // said.
                    amcBodySnippet = snippet,
                });
            }
            catch (Exception ex)
            {
                return Ok(new
                {
                    keyConfigured = true,
                    keyLength = key.Length,
                    error = ex.Message,
                });
            }
        }
    }
}
