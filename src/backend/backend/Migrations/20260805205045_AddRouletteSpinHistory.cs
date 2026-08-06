using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddRouletteSpinHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "roulette_spin_history",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    imdb_id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    challenge_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    seen_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_roulette_spin_history", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_roulette_spin_history_user_id_seen_at",
                table: "roulette_spin_history",
                columns: new[] { "user_id", "seen_at" });

            // Same reasoning as EnableRowLevelSecurity (2026-07-31) and
            // EnableRlsOnCineMindTvShows: every table in this database has RLS
            // on with no permissive policies, which locks Supabase's PostgREST
            // (anon/authenticated roles) out entirely while leaving this
            // backend's own `postgres` connection unaffected, since it bypasses
            // RLS by design. It matters more here than for the catalog tables —
            // this one is keyed by user_id and would otherwise let any
            // authenticated client read every other player's spin history.
            migrationBuilder.Sql("ALTER TABLE roulette_spin_history ENABLE ROW LEVEL SECURITY;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "roulette_spin_history");
        }
    }
}
