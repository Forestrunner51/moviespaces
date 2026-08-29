using Backend.Models;

namespace backend.Tests;

public class GroupRulesTests
{
    private static readonly DateTime Now = new(2026, 8, 29, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void ScreeningTime_InThePast_HasPassed()
    {
        Assert.True(GroupRules.ScreeningTimeHasPassed(Now.AddMinutes(-1), Now));
    }

    [Fact]
    public void ScreeningTime_ExactlyNow_HasPassed()
    {
        Assert.True(GroupRules.ScreeningTimeHasPassed(Now, Now));
    }

    [Fact]
    public void ScreeningTime_InTheFuture_HasNotPassed()
    {
        Assert.False(GroupRules.ScreeningTimeHasPassed(Now.AddMinutes(1), Now));
        Assert.False(GroupRules.ScreeningTimeHasPassed(Now.AddDays(30), Now));
    }
}
