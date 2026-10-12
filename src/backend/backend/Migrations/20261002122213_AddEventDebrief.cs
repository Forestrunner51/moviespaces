using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    // "How was it?" after a Space's showtime: debrief_sent is the one-shot
    // guard for the push (mirroring reminder_sent for the one that goes out
    // beforehand), and EventResponses records who answered and whether they
    // made it. One row per person per Space, enforced by the unique index.
    public partial class AddEventDebrief : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "debrief_sent",
                table: "Groups",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "EventResponses",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Attended = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventResponses", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EventResponses_GroupId_UserId",
                table: "EventResponses",
                columns: new[] { "GroupId", "UserId" },
                unique: true);

            // Supabase auto-exposes every public table through PostgREST with
            // the app's anon key, so a new table without RLS is readable by
            // anyone holding a key that ships inside the mobile app. RLS with
            // no policies denies every role except the owner, which is what
            // this backend connects as. Missed three times before
            // RlsCoverageTests started failing the build for it.
            migrationBuilder.Sql("ALTER TABLE \"EventResponses\" ENABLE ROW LEVEL SECURITY;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EventResponses");

            migrationBuilder.DropColumn(
                name: "debrief_sent",
                table: "Groups");
        }
    }
}
