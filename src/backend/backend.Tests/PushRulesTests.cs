using Backend.Models;
using Backend.Services;

namespace backend.Tests;

public class PushRulesTests
{
    [Theory]
    [InlineData("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")]
    [InlineData("ExpoPushToken[abc-DEF_123]")]
    public void ValidExpoTokens_Accepted(string token)
    {
        Assert.True(PushRules.IsValidExpoPushToken(token));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("ExponentPushToken[]")]
    [InlineData("ExponentPushToken[abc")]
    [InlineData("ExponentPushToken[abc]extra")]
    [InlineData("exponentpushtoken[abc]")]
    [InlineData("apns-device-token-hex")]
    [InlineData("<script>alert(1)</script>")]
    public void InvalidExpoTokens_Rejected(string? token)
    {
        Assert.False(PushRules.IsValidExpoPushToken(token));
    }

    [Fact]
    public void OverlongToken_Rejected()
    {
        var token = "ExponentPushToken[" + new string('a', 600) + "]";
        Assert.False(PushRules.IsValidExpoPushToken(token));
    }

    [Theory]
    [InlineData(null, "Someone")]
    [InlineData("", "Someone")]
    [InlineData("   ", "Someone")]
    [InlineData("  Ola  ", "Ola")]
    public void CapSenderName_BlankFallsBack_AndTrims(string? input, string expected)
    {
        Assert.Equal(expected, PushRules.CapSenderName(input));
    }

    [Fact]
    public void CapSenderName_TruncatesToNameLimit()
    {
        var input = new string('x', GroupFieldLimits.Name + 50);
        var result = PushRules.CapSenderName(input);
        Assert.Equal(GroupFieldLimits.Name, result.Length);
    }

    [Fact]
    public void CapSenderName_AtLimit_Unchanged()
    {
        var input = new string('y', GroupFieldLimits.Name);
        Assert.Equal(input, PushRules.CapSenderName(input));
    }

    [Fact]
    public void RoutingPayloads_CarryTypeAndIds()
    {
        var groupId = Guid.NewGuid();
        var msg = PushRules.GroupMessageData(groupId);
        Assert.Equal("group_message", msg["type"]);
        Assert.Equal(groupId.ToString(), msg["groupId"]);

        var dm = PushRules.DirectMessageData("user-1");
        Assert.Equal("dm", dm["type"]);
        Assert.Equal("user-1", dm["userId"]);

        Assert.Equal("group_booked", PushRules.GroupData("group_booked", groupId)["type"]);
        Assert.Equal("cinemind_reminder", PushRules.TypeOnlyData("cinemind_reminder")["type"]);
    }

    [Fact]
    public void ParseDeadTokens_PicksOnlyDeviceNotRegistered_InRequestOrder()
    {
        var batch = new List<string> { "ExponentPushToken[a]", "ExponentPushToken[b]", "ExponentPushToken[c]" };
        const string body = """
            {"data":[
              {"status":"ok","id":"1"},
              {"status":"error","message":"not registered","details":{"error":"DeviceNotRegistered"}},
              {"status":"error","message":"too big","details":{"error":"MessageTooBig"}}
            ]}
            """;

        var dead = PushNotificationService.ParseDeadTokens(body, batch);

        Assert.Equal(new[] { "ExponentPushToken[b]" }, dead);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{}")]
    [InlineData("{\"data\":\"nope\"}")]
    [InlineData("{\"errors\":[{\"code\":\"PUSH_TOO_MANY_EXPERIENCE_IDS\"}]}")]
    public void ParseDeadTokens_MalformedOrErrorBody_DropsNothing(string body)
    {
        var batch = new List<string> { "ExponentPushToken[a]" };
        Assert.Empty(PushNotificationService.ParseDeadTokens(body, batch));
    }

    [Fact]
    public void ParseDeadTokens_MoreTicketsThanTokens_DoesNotThrow()
    {
        var batch = new List<string> { "ExponentPushToken[a]" };
        const string body = """{"data":[{"status":"ok"},{"status":"error","details":{"error":"DeviceNotRegistered"}}]}""";
        Assert.Empty(PushNotificationService.ParseDeadTokens(body, batch));
    }
}
