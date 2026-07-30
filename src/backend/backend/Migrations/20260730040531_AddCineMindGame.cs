using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddCineMindGame : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "cinemind_movies",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    imdb_id = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    tmdb_id = table.Column<int>(type: "integer", nullable: true),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    release_year = table.Column<int>(type: "integer", nullable: false),
                    poster_path = table.Column<string>(type: "text", nullable: true),
                    director = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    cast_json = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cinemind_movies", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "daily_puzzles",
                columns: table => new
                {
                    puzzle_date = table.Column<DateOnly>(type: "date", nullable: false),
                    puzzle_number = table.Column<int>(type: "integer", nullable: false),
                    challenge_payload_json = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_daily_puzzles", x => x.puzzle_date);
                });

            migrationBuilder.CreateTable(
                name: "user_daily_progress",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    puzzle_date = table.Column<DateOnly>(type: "date", nullable: false),
                    time_taken_ms = table.Column<int>(type: "integer", nullable: false),
                    score = table.Column<int>(type: "integer", nullable: false),
                    guess_history_json = table.Column<string>(type: "text", nullable: false),
                    completed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    streak_count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_daily_progress", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_cinemind_movies_imdb_id",
                table: "cinemind_movies",
                column: "imdb_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_daily_progress_puzzle_date",
                table: "user_daily_progress",
                column: "puzzle_date");

            migrationBuilder.CreateIndex(
                name: "IX_user_daily_progress_user_id_puzzle_date",
                table: "user_daily_progress",
                columns: new[] { "user_id", "puzzle_date" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "cinemind_movies");

            migrationBuilder.DropTable(
                name: "daily_puzzles");

            migrationBuilder.DropTable(
                name: "user_daily_progress");
        }
    }
}
