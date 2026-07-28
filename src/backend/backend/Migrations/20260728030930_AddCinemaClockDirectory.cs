using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddCinemaClockDirectory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "cinemaclock_theaters",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    metro_slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    url = table.Column<string>(type: "text", nullable: false),
                    address = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    latitude = table.Column<double>(type: "double precision", nullable: true),
                    longitude = table.Column<double>(type: "double precision", nullable: true),
                    last_verified_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cinemaclock_theaters", x => x.id);
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

            migrationBuilder.CreateIndex(
                name: "IX_cinemaclock_theaters_metro_slug",
                table: "cinemaclock_theaters",
                column: "metro_slug");

            migrationBuilder.CreateIndex(
                name: "IX_cinemaclock_theaters_metro_slug_url",
                table: "cinemaclock_theaters",
                columns: new[] { "metro_slug", "url" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "cinemaclock_theaters");

            migrationBuilder.DropTable(
                name: "theater_scrape_logs");
        }
    }
}
