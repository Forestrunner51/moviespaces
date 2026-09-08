using System.Diagnostics;

namespace Backend.IntegrationTests;

// Decides, once per test run, whether a Postgres can be had at all. Used by
// [IntegrationFact] at discovery time to mark tests Skipped (not failed) on a
// machine with neither MOVIESPACES_TEST_PG nor a Docker daemon — that keeps
// `npm run check` infrastructure-free, which AGENTS.md promises.
public static class IntegrationEnvironment
{
    public const string ConnectionStringVar = "MOVIESPACES_TEST_PG";
    public const string ForceSkipVar = "MOVIESPACES_SKIP_INTEGRATION";

    private static readonly Lazy<string?> _skipReason = new(Probe);

    // Null means "run"; otherwise the reason shown in the test output.
    public static string? SkipReason => _skipReason.Value;

    public static string? ExplicitConnectionString =>
        Environment.GetEnvironmentVariable(ConnectionStringVar) is { Length: > 0 } cs ? cs : null;

    private static string? Probe()
    {
        if (Environment.GetEnvironmentVariable(ForceSkipVar) == "1")
            return $"{ForceSkipVar}=1 set.";
        if (ExplicitConnectionString != null)
            return null;
        return DockerReachable()
            ? null
            : $"No Docker daemon reachable and {ConnectionStringVar} is not set — integration tests need a real Postgres.";
    }

    // `docker info` is the one probe that agrees with Testcontainers about
    // DOCKER_HOST, contexts, and Desktop's per-user socket path, without
    // reimplementing that resolution here. Any failure — CLI missing, daemon
    // down, hung — counts as unreachable.
    private static bool DockerReachable()
    {
        try
        {
            using var proc = Process.Start(new ProcessStartInfo("docker", "info --format {{.ServerVersion}}")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            });
            if (proc == null) return false;
            if (!proc.WaitForExit(TimeSpan.FromSeconds(8)))
            {
                try { proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
                return false;
            }
            return proc.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }
}

// A [Fact] that turns into a Skip when no database is available.
[AttributeUsage(AttributeTargets.Method)]
public sealed class IntegrationFactAttribute : FactAttribute
{
    public IntegrationFactAttribute()
    {
        Skip = IntegrationEnvironment.SkipReason;
    }
}
