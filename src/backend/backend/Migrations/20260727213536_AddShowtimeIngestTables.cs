using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddShowtimeIngestTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "now_playing_movies",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    imdb_id = table.Column<string>(type: "text", nullable: true),
                    overview = table.Column<string>(type: "text", nullable: true),
                    poster_url = table.Column<string>(type: "text", nullable: true),
                    vote_average = table.Column<decimal>(type: "numeric", nullable: true),
                    release_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_now_playing_movies", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "showtimes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    movie_id = table.Column<Guid>(type: "uuid", nullable: false),
                    theater_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    showtime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    booking_link = table.Column<string>(type: "text", nullable: true),
                    format = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    zip_code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_showtimes", x => x.id);
                    table.ForeignKey(
                        name: "FK_showtimes_now_playing_movies_movie_id",
                        column: x => x.movie_id,
                        principalTable: "now_playing_movies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_now_playing_movies_title",
                table: "now_playing_movies",
                column: "title",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_showtimes_movie_id_showtime",
                table: "showtimes",
                columns: new[] { "movie_id", "showtime" });

            migrationBuilder.CreateIndex(
                name: "IX_showtimes_movie_id_theater_name_showtime",
                table: "showtimes",
                columns: new[] { "movie_id", "theater_name", "showtime" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "showtimes");

            migrationBuilder.DropTable(
                name: "now_playing_movies");
        }
    }
}
