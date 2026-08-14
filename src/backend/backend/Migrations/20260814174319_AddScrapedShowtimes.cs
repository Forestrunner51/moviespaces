using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddScrapedShowtimes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ScrapedShowtimes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    theater_slug = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    theater_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    latitude = table.Column<double>(type: "double precision", nullable: true),
                    longitude = table.Column<double>(type: "double precision", nullable: true),
                    movie_title = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    movie_slug = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    show_date = table.Column<DateOnly>(type: "date", nullable: false),
                    start_minutes = table.Column<int>(type: "integer", nullable: false),
                    scraped_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScrapedShowtimes", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ScrapedShowtimes_theater_slug_show_date",
                table: "ScrapedShowtimes",
                columns: new[] { "theater_slug", "show_date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ScrapedShowtimes");
        }
    }
}
