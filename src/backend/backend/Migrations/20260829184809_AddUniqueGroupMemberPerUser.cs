using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddUniqueGroupMemberPerUser : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The app-level "already a member?" check was racy, so duplicate
            // (GroupId, user_id) rows may already exist. Keep the earliest
            // row per pair (ctid as a tiebreak for identical JoinedAt) and
            // drop the rest, or the unique index below would fail to build
            // and take the deploy down with it. Guest rows (user_id = '')
            // are outside the index's filter and are left alone.
            migrationBuilder.Sql(@"
                DELETE FROM ""GroupMembers"" gm
                USING ""GroupMembers"" keep
                WHERE gm.""GroupId"" = keep.""GroupId""
                  AND gm.""user_id"" = keep.""user_id""
                  AND gm.""user_id"" <> ''
                  AND (keep.""JoinedAt"", keep.ctid) < (gm.""JoinedAt"", gm.ctid);
            ");

            migrationBuilder.CreateIndex(
                name: "IX_GroupMembers_GroupId_user_id",
                table: "GroupMembers",
                columns: new[] { "GroupId", "user_id" },
                unique: true,
                filter: "\"user_id\" <> ''");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_GroupMembers_GroupId_user_id",
                table: "GroupMembers");
        }
    }
}
