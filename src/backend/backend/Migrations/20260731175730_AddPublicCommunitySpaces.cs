using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddPublicCommunitySpaces : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "genre_category",
                table: "Groups",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_public",
                table: "Groups",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "genre_category",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "is_public",
                table: "Groups");
        }
    }
}
