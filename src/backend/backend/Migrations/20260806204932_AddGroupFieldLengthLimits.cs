using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddGroupFieldLengthLimits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Hand-written rather than the AlterColumn calls EF scaffolded.
            //
            // `ALTER COLUMN ... TYPE character varying(n)` is a hard ERROR in
            // Postgres if any existing row is longer than n — it does not
            // truncate. These columns were unbounded `text` with no validation
            // anywhere, so there is no guarantee production doesn't already
            // hold something over the limit.
            //
            // That failure mode is unusually bad here: Program.cs deliberately
            // catches and logs MigrateAsync exceptions instead of crashing, so
            // a failed migration would leave the app running against a stale
            // schema with only a log line to show for it — the exact silent
            // half-applied state this project has already been bitten by.
            //
            // `USING LEFT(col, n)` truncates in place instead, so the migration
            // is unconditionally safe to apply. Truncation only ever affects a
            // value already past a deliberately generous ceiling (see
            // GroupFieldLimits), and NULL survives untouched — LEFT(NULL, n)
            // is NULL.
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"slug\" TYPE character varying(150) "
                + "USING LEFT(\"slug\", 150);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"season_episode_info\" TYPE character varying(200) "
                + "USING LEFT(\"season_episode_info\", 200);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"poster_path\" TYPE character varying(2048) "
                + "USING LEFT(\"poster_path\", 2048);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"post_activities\" TYPE character varying(500) "
                + "USING LEFT(\"post_activities\", 500);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"hangout_notes\" TYPE character varying(1000) "
                + "USING LEFT(\"hangout_notes\", 1000);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"google_place_id\" TYPE character varying(200) "
                + "USING LEFT(\"google_place_id\", 200);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"genre_category\" TYPE character varying(64) "
                + "USING LEFT(\"genre_category\", 64);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"Status\" TYPE character varying(32) "
                + "USING LEFT(\"Status\", 32);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"ShowTime\" TYPE character varying(60) "
                + "USING LEFT(\"ShowTime\", 60);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"ShowDate\" TYPE character varying(60) "
                + "USING LEFT(\"ShowDate\", 60);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"HostName\" TYPE character varying(100) "
                + "USING LEFT(\"HostName\", 100);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"FilmName\" TYPE character varying(200) "
                + "USING LEFT(\"FilmName\", 200);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"CinemaName\" TYPE character varying(250) "
                + "USING LEFT(\"CinemaName\", 250);");
            migrationBuilder.Sql(
                "ALTER TABLE \"Groups\" ALTER COLUMN \"BookingUrl\" TYPE character varying(2048) "
                + "USING LEFT(\"BookingUrl\", 2048);");
            migrationBuilder.Sql(
                "ALTER TABLE \"GroupMembers\" ALTER COLUMN \"Name\" TYPE character varying(100) "
                + "USING LEFT(\"Name\", 100);");
            migrationBuilder.Sql(
                "ALTER TABLE \"GroupMembers\" ALTER COLUMN \"GuestToken\" TYPE character varying(200) "
                + "USING LEFT(\"GuestToken\", 200);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "Groups",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(150)",
                oldMaxLength: 150,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "season_episode_info",
                table: "Groups",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "poster_path",
                table: "Groups",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(2048)",
                oldMaxLength: 2048,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "post_activities",
                table: "Groups",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "hangout_notes",
                table: "Groups",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "google_place_id",
                table: "Groups",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "genre_category",
                table: "Groups",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "Groups",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32);

            migrationBuilder.AlterColumn<string>(
                name: "ShowTime",
                table: "Groups",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(60)",
                oldMaxLength: 60);

            migrationBuilder.AlterColumn<string>(
                name: "ShowDate",
                table: "Groups",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(60)",
                oldMaxLength: 60);

            migrationBuilder.AlterColumn<string>(
                name: "HostName",
                table: "Groups",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "FilmName",
                table: "Groups",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200);

            migrationBuilder.AlterColumn<string>(
                name: "CinemaName",
                table: "Groups",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(250)",
                oldMaxLength: 250);

            migrationBuilder.AlterColumn<string>(
                name: "BookingUrl",
                table: "Groups",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(2048)",
                oldMaxLength: 2048);

            migrationBuilder.AlterColumn<string>(
                name: "Name",
                table: "GroupMembers",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "GuestToken",
                table: "GroupMembers",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);
        }
    }
}
