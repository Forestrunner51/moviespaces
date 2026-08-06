using System.Text.Json;
using Backend.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Backend.Tests;

// Regression suite for the stored-payload schema problem that produced two
// separate production bugs in one week:
//
//   1. A puzzle row written before the MysteryTv track existed deserialized
//      "successfully" with null members (System.Text.Json fills a missing
//      property rather than throwing), and the first code path to read past
//      days' payloads — repeat avoidance — dereferenced them and 500'd every
//      request to /puzzles/today.
//
//   2. The fix for (1) added a SchemaVersion tag and rejected anything that
//      didn't match. That would have discarded the CURRENT day's row on
//      deploy — a row that predates the tag but is otherwise complete —
//      causing GetOrCreateTodayAsync to regenerate a different puzzle
//      mid-day and re-grade already-submitted answers against the new
//      answers.
//
// Both directions are pinned here: incomplete payloads must be rejected, and
// complete-but-untagged payloads must still be accepted.
public class PayloadDeserializationTests
{
    private static DailyPuzzleService Service() =>
        new(
            new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["CineMind:PuzzleSalt"] = "test-salt",
                })
                .Build(),
            NullLogger<DailyPuzzleService>.Instance);

    // Serializing the real record is what a real row looks like — building the
    // JSON by hand would let the test drift from the actual on-disk shape.
    private static string CurrentJson() =>
        JsonSerializer.Serialize(PuzzleFixtures.Payload());

    private static string JsonWithout(string propertyName)
    {
        var node = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(CurrentJson())!;
        node.Remove(propertyName);
        return JsonSerializer.Serialize(node);
    }

    [Fact]
    public void RoundTrips_a_payload_written_by_the_current_schema()
    {
        var result = Service().DeserializePayload(CurrentJson());

        Assert.NotNull(result);
        Assert.Equal(DailyPuzzlePayload.CurrentSchemaVersion, result!.SchemaVersion);
        Assert.Equal("Tom Hardy", result.Connection.Answer);
        Assert.Equal("tt-mystery-tv", result.MysteryTv.Answer);
    }

    [Fact]
    public void Accepts_a_complete_payload_that_predates_SchemaVersion()
    {
        // The exact shape of today's already-generated row at the moment the
        // versioning change deploys: every field the current code reads is
        // present, but the version tag has never been written, so it
        // deserializes as 0. Rejecting this would delete and regenerate a
        // live puzzle out from under players who already submitted.
        var json = JsonWithout("SchemaVersion");

        var result = Service().DeserializePayload(json);

        Assert.NotNull(result);
        Assert.Equal(0, result!.SchemaVersion);
        Assert.Equal("Tom Hardy", result.Connection.Answer);
    }

    [Theory]
    [InlineData("MysteryTv")]     // the field whose absence caused the original 500
    [InlineData("MysteryMovie")]
    [InlineData("Connection")]
    [InlineData("Chronos")]
    [InlineData("CastDeduct")]
    public void Rejects_an_untagged_payload_that_is_missing_a_challenge(string missing)
    {
        // Untagged AND incomplete — a genuinely old-shaped row. Must come back
        // null so callers take their existing "unusable payload" path
        // (regenerate / skip the day) instead of dereferencing a null member.
        var node = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(CurrentJson())!;
        node.Remove("SchemaVersion");
        node.Remove(missing);

        var result = Service().DeserializePayload(JsonSerializer.Serialize(node));

        Assert.Null(result);
    }

    [Fact]
    public void Rejects_a_payload_whose_challenge_is_explicitly_null()
    {
        // Distinct from an absent property: some serializers emit an explicit
        // null. Both have to be treated the same way.
        var node = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(CurrentJson())!;
        node.Remove("SchemaVersion");
        node["MysteryTv"] = JsonSerializer.Deserialize<JsonElement>("null");

        Assert.Null(Service().DeserializePayload(JsonSerializer.Serialize(node)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("{")]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    public void Returns_null_rather_than_throwing_on_malformed_json(string json)
    {
        // The pre-existing contract: a corrupt row must never propagate an
        // exception to the request. GetOrCreateTodayAsync relies on getting
        // null back so it can log and regenerate.
        var exception = Record.Exception(() => Service().DeserializePayload(json));

        Assert.Null(exception);
    }
}
