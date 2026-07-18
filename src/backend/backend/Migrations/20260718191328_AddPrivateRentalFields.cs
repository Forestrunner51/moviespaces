using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddPrivateRentalFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "FilmId",
                table: "Groups",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AlterColumn<int>(
                name: "CinemaId",
                table: "Groups",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddColumn<int>(
                name: "max_capacity",
                table: "Groups",
                type: "integer",
                nullable: false,
                defaultValue: 40);

            migrationBuilder.AddColumn<string>(
                name: "space_type",
                table: "Groups",
                type: "text",
                nullable: false,
                defaultValue: "public_gathering");

            migrationBuilder.AddColumn<long>(
                name: "total_cost_cents",
                table: "Groups",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "max_capacity",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "space_type",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "total_cost_cents",
                table: "Groups");

            migrationBuilder.AlterColumn<int>(
                name: "FilmId",
                table: "Groups",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "CinemaId",
                table: "Groups",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);
        }
    }
}
