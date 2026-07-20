using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class RemoveMovieGluAddGooglePlaces : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "google_place_id",
                table: "Groups",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "screening_time",
                table: "Groups",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "theater_latitude",
                table: "Groups",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "theater_longitude",
                table: "Groups",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "tmdb_movie_id",
                table: "Groups",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "google_place_id",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "screening_time",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "theater_latitude",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "theater_longitude",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "tmdb_movie_id",
                table: "Groups");
        }
    }
}
