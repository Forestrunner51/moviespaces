using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class RemoveCinemaClockShowtimes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "cinemaclock_theaters");

            migrationBuilder.DropTable(
                name: "metro_scrape_logs");

            migrationBuilder.DropTable(
                name: "showtimes");

            migrationBuilder.DropTable(
                name: "theater_scrape_logs");

            migrationBuilder.DropTable(
                name: "now_playing_movies");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "cinemaclock_theaters",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    address = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    last_verified_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    latitude = table.Column<double>(type: "double precision", nullable: true),
                    longitude = table.Column<double>(type: "double precision", nullable: true),
                    metro_slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    url = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cinemaclock_theaters", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "metro_scrape_logs",
                columns: table => new
                {
                    metro_slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    last_row_count = table.Column<int>(type: "integer", nullable: false),
                    last_scraped_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_metro_scrape_logs", x => x.metro_slug);
                });

            migrationBuilder.CreateTable(
                name: "now_playing_movies",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    imdb_id = table.Column<string>(type: "text", nullable: true),
                    overview = table.Column<string>(type: "text", nullable: true),
                    poster_url = table.Column<string>(type: "text", nullable: true),
                    release_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    vote_average = table.Column<decimal>(type: "numeric", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_now_playing_movies", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "theater_scrape_logs",
                columns: table => new
                {
                    theater_id = table.Column<Guid>(type: "uuid", nullable: false),
                    last_scraped_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_theater_scrape_logs", x => x.theater_id);
                });

            migrationBuilder.CreateTable(
                name: "showtimes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    movie_id = table.Column<Guid>(type: "uuid", nullable: false),
                    booking_link = table.Column<string>(type: "text", nullable: true),
                    city = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    format = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    showtime = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    theater_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    zip_code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true)
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
                name: "IX_cinemaclock_theaters_metro_slug",
                table: "cinemaclock_theaters",
                column: "metro_slug");

            migrationBuilder.CreateIndex(
                name: "IX_cinemaclock_theaters_metro_slug_url",
                table: "cinemaclock_theaters",
                columns: new[] { "metro_slug", "url" },
                unique: true);

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
    }
}
