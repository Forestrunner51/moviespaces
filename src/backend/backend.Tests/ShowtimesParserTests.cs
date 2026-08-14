using Backend.Services;
using Xunit;

namespace Backend.Tests
{
    // Pins the ShowtimesScraperService parsing contract against fixture
    // markup copied verbatim from a real cinemaclock.com theater page
    // (2026-08-14). If the site restructures, these tests keep describing
    // what the parser USED to rely on — update the fixture from a fresh page
    // alongside the parser.
    public class ShowtimesParserTests
    {
        private static readonly DateOnly Today = new(2026, 8, 14);

        // Trimmed to the structural essentials the parser depends on:
        // a JSON-LD MovieTheater block, a moviedesc block with the title,
        // and a filall block with a "today" section plus two future days.
        private const string TheaterPageFixture = """
            <html><head>
            <script type="application/ld+json">{
             "@context": "http://schema.org",
             "@type": "MovieTheater",
             "geo": {"@type": "GeoCoordinates", "latitude": "33.070779", "longitude": "-96.691688"},
             "name": "Cinemark Legacy & XD"
            }</script>
            </head><body>
            <div class='moviedesc'>
              <h3 class='movietitle short' data-sort='agadha2026'><a class='okienko' href='/movies/agadha-2026'>Agadha</a></h3>
            </div>
            <div data-earliest-date="20260814" class="filall fil2d fio280552">
              <h4 class="cinemaname insidem"><a class="okienko" href="/movie-theaters/cinemark-legacy-xd">Cinemark Legacy &amp;&nbsp;XD</a></h4>
              <p class="times"><u>Today <span class="timesdate">Aug 14</span></u><i><span class="tix tod" data-time="2330" id="tix1">11:30pm<em>&nbsp;(late&nbsp;night)</em> </span></i></p>
              <p class="timesother">
                <s><u>Sat <span class="timesdate">Aug 15</span></u><i><span class="tix" data-time="925" id="tix2">9:25am </span> <span class="tix" data-time="1900" id="tix3">7:00 </span></i></s>
                <s><u>Sun <span class="timesdate">Aug 16</span></u><i><span class="tix" data-time="1440" id="tix4">2:40 </span></i></s>
              </p>
            </div>
            <div class='moviedesc'>
              <h3 class='movietitle short'><a class='okienko' href='/movies/the-brink-of-war-2026'>The Brink of War</a></h3>
            </div>
            <div class="filall fio280553">
              <p class="times"><u>Today <span class="timesdate">Aug 14</span></u><i><span class="tix tod" data-time="1330" id="tix5">1:30 </span></i></p>
            </div>
            </body></html>
            """;

        [Fact]
        public void ParsesTheaterIdentityFromJsonLd()
        {
            var (name, lat, lng) = ShowtimesScraperService.ParseTheaterJsonLd(TheaterPageFixture);
            Assert.Equal("Cinemark Legacy & XD", name);
            Assert.NotNull(lat);
            Assert.NotNull(lng);
            Assert.Equal(33.070779, lat!.Value, 6);
            Assert.Equal(-96.691688, lng!.Value, 6);
        }

        [Fact]
        public void ParsesMoviesWithTheirOwnShowtimes()
        {
            var result = ShowtimesScraperService.ParseTheaterPage("cinemark-legacy-xd", TheaterPageFixture, Today);
            Assert.NotNull(result);

            var agadha = result!.Showings.Where(s => s.MovieTitle == "Agadha").ToList();
            var brink = result.Showings.Where(s => s.MovieTitle == "The Brink of War").ToList();

            // 1 today + 2 Saturday + 1 Sunday for the first movie; the second
            // movie's single time must NOT bleed into the first (the parser
            // walks blocks in document order tracking the current movie).
            Assert.Equal(4, agadha.Count);
            Assert.Single(brink);
            Assert.Equal("agadha-2026", agadha[0].MovieSlug);
        }

        [Fact]
        public void ParsesDataTimeAsMinutesAndResolvesDates()
        {
            var result = ShowtimesScraperService.ParseTheaterPage("cinemark-legacy-xd", TheaterPageFixture, Today)!;
            var agadha = result.Showings.Where(s => s.MovieTitle == "Agadha").ToList();

            // Today 11:30pm → 23*60+30, dated Aug 14.
            Assert.Contains(agadha, s => s.ShowDate == new DateOnly(2026, 8, 14) && s.StartMinutes == 23 * 60 + 30);
            // Sat 9:25am (data-time="925" — three digits) → 565, dated Aug 15.
            Assert.Contains(agadha, s => s.ShowDate == new DateOnly(2026, 8, 15) && s.StartMinutes == 9 * 60 + 25);
            // Sat 7:00pm → 1140.
            Assert.Contains(agadha, s => s.ShowDate == new DateOnly(2026, 8, 15) && s.StartMinutes == 19 * 60);
            // Sun 2:40pm → 880, dated Aug 16.
            Assert.Contains(agadha, s => s.ShowDate == new DateOnly(2026, 8, 16) && s.StartMinutes == 14 * 60 + 40);
        }

        [Fact]
        public void FutureDayWrapperIsNotDoubleCounted()
        {
            // The <p class="timesother"> wrapper contains the same <s> day
            // nodes the parser selects individually — a naive selector counts
            // Saturday's times twice.
            var result = ShowtimesScraperService.ParseTheaterPage("cinemark-legacy-xd", TheaterPageFixture, Today)!;
            var satTimes = result.Showings
                .Where(s => s.MovieTitle == "Agadha" && s.ShowDate == new DateOnly(2026, 8, 15))
                .ToList();
            Assert.Equal(2, satTimes.Count);
        }

        [Fact]
        public void PageWithoutTheaterJsonLdIsUnparseableNotEmpty()
        {
            var result = ShowtimesScraperService.ParseTheaterPage(
                "whatever", "<html><body><p>redesigned site</p></body></html>", Today);
            Assert.Null(result);
        }

        [Theory]
        [InlineData("Aug 15", 2026, 8, 15)]
        [InlineData("Aug 14", 2026, 8, 14)]
        // Yesterday resolves backward (overnight cache), not to next year.
        [InlineData("Aug 13", 2026, 8, 13)]
        public void ResolveDatePicksNearestForwardDate(string text, int y, int mo, int d)
        {
            Assert.Equal(new DateOnly(y, mo, d), ShowtimesScraperService.ResolveDate(text, Today));
        }

        [Fact]
        public void ResolveDateRollsOverYearEnd()
        {
            // On Dec 30, "Jan 2" must mean next year's January.
            var dec30 = new DateOnly(2026, 12, 30);
            Assert.Equal(new DateOnly(2027, 1, 2), ShowtimesScraperService.ResolveDate("Jan 2", dec30));
        }

        [Fact]
        public void ParsesTheaterSlugsFromDirectory()
        {
            const string directory = """
                <a href="/movie-theaters/cinemark-legacy-xd">Cinemark</a>
                <a href="/movie-theaters/amc-northpark-15">AMC</a>
                <a href="/movie-theaters/cinemark-legacy-xd">Cinemark again</a>
                <a href="/dallas-tx/movie-theaters">directory self-link</a>
                """;
            var slugs = ShowtimesScraperService.ParseTheaterSlugs(directory);
            Assert.Equal(new[] { "cinemark-legacy-xd", "amc-northpark-15" }, slugs);
        }
    }
}
