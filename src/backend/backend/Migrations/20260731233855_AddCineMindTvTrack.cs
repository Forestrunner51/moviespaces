using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddCineMindTvTrack : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "cinemind_tv_shows",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    imdb_id = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    release_year = table.Column<int>(type: "integer", nullable: false),
                    poster_path = table.Column<string>(type: "text", nullable: true),
                    cast_json = table.Column<string>(type: "text", nullable: false),
                    genres_json = table.Column<string>(type: "text", nullable: false),
                    plot = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cinemind_tv_shows", x => x.id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "cinemind_tv_shows");
        }
    }
}
