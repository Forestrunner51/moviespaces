using System.Text.RegularExpressions;
using Backend.Models;

namespace Backend.Services
{
    // Small, pure rules shared by the push endpoints and the notification
    // service. Kept dependency-free so backend.Tests can cover them without
    // a database or HTTP harness.
    public static partial class PushRules
    {
        // Expo push tokens look like "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
        // (the "ExpoPushToken[...]" spelling is the same format under its
        // newer name). Anything else is never deliverable and would only be
        // POSTed to Expo on every fan-out until the DeviceNotRegistered
        // cleanup happened to catch it.
        [GeneratedRegex(@"^Expo(nent)?PushToken\[[^\]]+\]$")]
        private static partial Regex ExpoTokenRegex();

        public static bool IsValidExpoPushToken(string? token) =>
            !string.IsNullOrWhiteSpace(token) && token.Length <= 512 && ExpoTokenRegex().IsMatch(token);

        // A sender name goes straight into a push title. It's either a
        // client-supplied string or a GroupMember.Name / Group.HostName (both
        // already capped at GroupFieldLimits.Name), so this normalizes every
        // source to the same ceiling and the same blank fallback.
        public const string DefaultSenderName = "Someone";

        public static string CapSenderName(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return DefaultSenderName;
            var trimmed = name.Trim();
            return trimmed.Length > GroupFieldLimits.Name
                ? trimmed.Substring(0, GroupFieldLimits.Name)
                : trimmed;
        }

        // Every push carries a `data` object the mobile client routes on
        // (tap → open the right screen). Builders live here so each send
        // site can't drift on key names.
        public static Dictionary<string, object> GroupMessageData(Guid groupId) =>
            new() { ["type"] = "group_message", ["groupId"] = groupId.ToString() };

        public static Dictionary<string, object> DirectMessageData(string senderUserId) =>
            new() { ["type"] = "dm", ["userId"] = senderUserId };

        public static Dictionary<string, object> GroupData(string type, Guid groupId) =>
            new() { ["type"] = type, ["groupId"] = groupId.ToString() };

        public static Dictionary<string, object> TypeOnlyData(string type) =>
            new() { ["type"] = type };
    }
}
