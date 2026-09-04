using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;

namespace Backend.Services
{
    // Populates the CineMind puzzle catalog from OMDb.
    //
    // The seed list is a curated set of IMDb ids rather than a "popular
    // movies" API call, for the same reason MoviesController's carousel is:
    // OMDb has no popularity or list endpoint at all, only search and
    // lookup-by-id. Curation is also a feature here — puzzles need films with
    // real cast/director overlap, and a random popularity slice gives you
    // scattered one-off titles that share nobody, which makes The Connection
    // and Cast Deduct ungeneratable.
    //
    // Films are deliberately clustered around recurring collaborators
    // (Nolan/Scorsese/Villeneuve casts, the Marvel and Tarantino ensembles)
    // so shared-person links exist densely enough to build a puzzle every day
    // without repeating the same four titles.
    public class CineMindCatalogService
    {
        private readonly OmdbClient _omdb;
        private readonly ILogger<CineMindCatalogService> _logger;

        public CineMindCatalogService(OmdbClient omdb, ILogger<CineMindCatalogService> logger)
        {
            _omdb = omdb;
            _logger = logger;
        }

        private static readonly string[] SeedImdbIds =
        {
            // Nolan — heavy cast reuse (Caine, Murphy, Hardy, Bale)
            "tt0468569", // The Dark Knight
            "tt1375666", // Inception
            "tt0816692", // Interstellar
            "tt1345836", // The Dark Knight Rises
            "tt0372784", // Batman Begins
            "tt0482571", // The Prestige
            "tt5013056", // Dunkirk
            "tt6723592", // Tenet
            "tt15398776", // Oppenheimer

            // Villeneuve — Gosling, Chalamet, Zendaya, Ferguson
            "tt1160419", // Dune
            "tt15239678", // Dune: Part Two
            "tt1856101", // Blade Runner 2049
            "tt2543164", // Arrival
            "tt3315342", // Logan (Jackman/Stewart bridge)

            // Scorsese — DiCaprio, De Niro, Pesci
            "tt0407887", // The Departed
            "tt0993846", // The Wolf of Wall Street
            "tt1130884", // Shutter Island
            "tt0099685", // Goodfellas
            "tt0075314", // Taxi Driver
            "tt1302006", // The Irishman

            // Tarantino — Jackson, Travolta, Waltz, Pitt, DiCaprio
            "tt0110912", // Pulp Fiction
            "tt0105236", // Reservoir Dogs
            "tt0361748", // Inglourious Basterds
            "tt1853728", // Django Unchained
            "tt7131622", // Once Upon a Time in Hollywood

            // Marvel — very dense ensemble overlap
            "tt4154796", // Avengers: Endgame
            "tt4154756", // Avengers: Infinity War
            "tt0848228", // The Avengers
            "tt1825683", // Black Panther
            "tt10872600", // Spider-Man: No Way Home
            "tt6791350", // Guardians of the Galaxy Vol. 3
            "tt0371746", // Iron Man

            // Modern prestige / awards
            "tt6751668", // Parasite
            "tt6710474", // Everything Everywhere All at Once
            "tt1517268", // Barbie
            "tt2582802", // Whiplash
            "tt0947798", // Black Swan
            "tt1130080", // The Wrestler (Aronofsky link)
            "tt0180093", // Requiem for a Dream
            "tt7286456", // Joker
            "tt8267604", // Parasite-era Bong / spare
            "tt1745960", // Top Gun: Maverick

            // Canon / broad recognition
            "tt0111161", // The Shawshank Redemption
            "tt0068646", // The Godfather
            "tt0071562", // The Godfather Part II
            "tt0137523", // Fight Club
            "tt0109830", // Forrest Gump
            "tt0133093", // The Matrix
            "tt0120737", // LOTR: Fellowship
            "tt0167261", // LOTR: Two Towers
            "tt0167260", // LOTR: Return of the King
            "tt0245429", // Spirited Away
            "tt0114369", // Se7en
            "tt0102926", // The Silence of the Lambs
            "tt0088763", // Back to the Future
            "tt0076759", // Star Wars
            "tt0080684", // The Empire Strikes Back
            "tt0499549", // Avatar
            "tt1630029", // Avatar: The Way of Water
            "tt0120815", // Saving Private Ryan
            "tt0108052", // Schindler's List
            "tt0073486", // One Flew Over the Cuckoo's Nest

            // Wes Anderson — recurring troupe (Murray, Schwartzman, Wilson)
            "tt2278388", // The Grand Budapest Hotel
            "tt0265666", // The Royal Tenenbaums
            "tt5104604", // Isle of Dogs
            "tt0130827", // Rushmore

            // Coen Brothers
            "tt0477348", // No Country for Old Men
            "tt0116282", // Fargo
            "tt0118715", // The Big Lebowski
            "tt0190590", // O Brother, Where Art Thou?

            // Fincher — beyond the two already listed above
            "tt2267998", // Gone Girl
            "tt0443706", // Zodiac
            "tt1285016", // The Social Network

            // Paul Thomas Anderson
            "tt0469494", // There Will Be Blood
            "tt0118749", // Boogie Nights
            "tt5776858", // Phantom Thread

            // Spielberg
            "tt0107290", // Jurassic Park
            "tt0083866", // E.T. the Extra-Terrestrial
            "tt0073195", // Jaws
            "tt0264464", // Catch Me If You Can

            // Pixar / family — near-zero overlap with the rest of the catalog
            // on purpose, so a Mystery Movie pick from here reads as a clean
            // change of pace rather than another awards-cluster title.
            "tt0114709", // Toy Story
            "tt1049413", // Up
            "tt2096673", // Inside Out
            "tt2380307", // Coco
            "tt0266543", // Finding Nemo

            // Horror — its own dense little cluster (Peele, A24)
            "tt5052448", // Get Out
            "tt7784604", // Hereditary
            "tt6644200", // A Quiet Place
            "tt1396484", // It

            // Harry Potter — same three leads across the run
            "tt0241527", // Harry Potter and the Sorcerer's Stone
            "tt0295297", // Harry Potter and the Chamber of Secrets
            "tt1201607", // Harry Potter and the Deathly Hallows: Part 2

            // Greta Gerwig
            "tt4925292", // Lady Bird
            "tt3281548", // Little Women

            // A24 / modern indie
            "tt5727208", // Uncut Gems
            "tt8772262", // Midsommar
            "tt4975722", // Moonlight

            // Animation beyond Pixar
            "tt4633694", // Spider-Man: Into the Spider-Verse
            "tt0126029", // Shrek

            // Recent awards — 2023/24 cycle, not yet represented
            "tt5537002", // Killers of the Flower Moon
            "tt14230458", // Poor Things
            "tt14849194", // The Holdovers

            // Animation, cast-dense — the original 7-title Animation genre had
            // no franchise with 4+ films sharing a voice actor, so Roulette's
            // "Animation" pill could never build a genre-pure Connection or
            // Cast Deduct challenge (see BuildConnectionForMovie/
            // BuildCastDeductForMovie's >=4-film and shared-cast requirements).
            // These are franchises specifically, not just more animated films,
            // so the same voice cast recurs across enough entries to clear
            // that bar within the genre alone.
            "tt0120363", // Toy Story 2 (Hanks/Allen)
            "tt0435761", // Toy Story 3 (Hanks/Allen)
            "tt1979376", // Toy Story 4 (Hanks/Allen)
            "tt0298148", // Shrek 2 (Myers/Murphy/Diaz/Banderas)
            "tt0413267", // Shrek the Third (Myers/Murphy/Diaz/Banderas)
            "tt0892791", // Shrek Forever After (Myers/Murphy/Diaz/Banderas)
            "tt1323594", // Despicable Me (Carell)
            "tt1690953", // Despicable Me 2 (Carell)
            "tt3469046", // Despicable Me 3 (Carell)
            "tt2293640", // Minions (Carell cameo/franchise link)
            "tt0441773", // Kung Fu Panda (Black/Jolie/Hoffman)
            "tt1302011", // Kung Fu Panda 2 (Black/Jolie/Hoffman)
            "tt2267968", // Kung Fu Panda 3 (Black/Jolie/Hoffman)
            "tt2294629", // Frozen (Menzel/Bell/Groff)
            "tt4520988", // Frozen II (Menzel/Bell/Groff)

            // Comedy, cast-dense — the Apatow/Ferrell/Rogen circles reuse the
            // same performers relentlessly, which is exactly what Connection
            // and Cast Deduct need. Before these, Comedy leaned on the Wes
            // Anderson and Coen clusters alone.
            "tt0829482", // Superbad (Hill/Cera/Rogen)
            "tt0478311", // Knocked Up (Rogen/Rudd)
            "tt0405422", // The 40-Year-Old Virgin (Carell/Rogen/Rudd)
            "tt0357413", // Anchorman (Ferrell/Carell/Rudd)
            "tt0838283", // Step Brothers (Ferrell/Reilly)
            "tt0415306", // Talladega Nights (Ferrell/Reilly)
            "tt1245492", // This Is the End (Rogen/Hill/Franco)
            "tt0942385", // Tropic Thunder (Stiller/Downey/Black)
            "tt1478338", // Bridesmaids (Wiig/McCarthy)
            "tt1119646", // The Hangover (Galifianakis/Cooper/Helms)

            // Adventure, franchise-clustered — same reasoning: sequels
            // guarantee the shared-cast density a one-off blockbuster can't.
            "tt0082971", // Raiders of the Lost Ark (Ford)
            "tt0087469", // Indiana Jones and the Temple of Doom (Ford)
            "tt0097576", // Indiana Jones and the Last Crusade (Ford/Connery)
            "tt0325980", // Pirates of the Caribbean: The Curse of the Black Pearl
            "tt0383574", // Pirates of the Caribbean: Dead Man's Chest
            "tt0449088", // Pirates of the Caribbean: At World's End
            "tt0304141", // Harry Potter and the Prisoner of Azkaban
            "tt0330373", // Harry Potter and the Goblet of Fire
            "tt0903624", // The Hobbit: An Unexpected Journey
            "tt0369610", // Jurassic World

            // Carousel-only titles. These are here to back SurpriseMeImdbIds
            // below rather than for puzzle density — the carousel renders from
            // catalog rows now, so anything it shows has to exist as a row.
            "tt1877830", // The Batman
            "tt2911666", // John Wick
            "tt9362722", // Spider-Man: Across the Spider-Verse
            "tt9114286", // Black Panther: Wakanda Forever
            "tt10648342", // Thor: Love and Thunder
            "tt0816711", // World War Z
            "tt1596363", // The Girl with the Dragon Tattoo
            "tt5433140", // Fast & Furious Presents: Hobbs & Shaw

            // ── Popularity expansion (films) — generated 2026-09-04 from the official
            // IMDb datasets (title.basics + title.ratings), ranked by vote
            // count (>=80k votes, adult excluded) so every entry is a real id
            // AND a title people actually recognize. Regenerate the same way
            // rather than hand-adding ids.
            "tt0172495", // Gladiator (2000)
            "tt0120689", // The Green Mile (1999)
            "tt0209144", // Memento (2000)
            "tt0120338", // Titanic (1997)
            "tt0120382", // The Truman Show (1998)
            "tt2015381", // Guardians of the Galaxy (2014)
            "tt0110413", // Léon: The Professional (1994)
            "tt0910970", // WALL·E (2008)
            "tt0266697", // Kill Bill: Vol. 1 (2003)
            "tt0103064", // Terminator 2: Judgment Day (1991)
            "tt0169547", // American Beauty (1999)
            "tt0120586", // American History X (1998)
            "tt0110357", // The Lion King (1994)
            "tt1431045", // Deadpool (2016)
            "tt0434409", // V for Vendetta (2005)
            "tt0114814", // The Usual Suspects (1995)
            "tt0081505", // The Shining (1980)
            "tt0119217", // Good Will Hunting (1997)
            "tt0086190", // Star Wars: Episode VI - Return of the Jedi (1983)
            "tt1392190", // Mad Max: Fury Road (2015)
            "tt0338013", // Eternal Sunshine of the Spotless Mind (2004)
            "tt0112573", // Braveheart (1995)
            "tt0167404", // The Sixth Sense (1999)
            "tt1392170", // The Hunger Games (2012)
            "tt0198781", // Monsters, Inc. (2001)
            "tt0078748", // Alien (1979)
            "tt0268978", // A Beautiful Mind (2001)
            "tt1675434", // The Intouchables (2011)
            "tt0095016", // Die Hard (1988)
            "tt2488496", // Star Wars: Episode VII - The Force Awakens (2015)
            "tt0086250", // Scarface (1983)
            "tt3659388", // The Martian (2015)
            "tt0253474", // The Pianist (2002)
            "tt2395427", // Avengers: Age of Ultron (2015)
            "tt0088247", // The Terminator (1984)
            "tt0050083", // 12 Angry Men (1957)
            "tt0145487", // Spider-Man (2002)
            "tt1843866", // Captain America: The Winter Soldier (2014)
            "tt0458339", // Captain America: The First Avenger (2011)
            "tt0208092", // Snatch (2000)
            "tt1300854", // Iron Man 3 (2013)
            "tt0800369", // Thor (2011)
            "tt0382932", // Ratatouille (2007)
            "tt1663202", // The Revenant (2015)
            "tt1392214", // Prisoners (2013)
            "tt1228705", // Iron Man 2 (2010)
            "tt3498820", // Captain America: Civil War (2016)
            "tt0066921", // A Clockwork Orange (1971)
            "tt0120915", // Star Wars: Episode I - The Phantom Menace (1999)
            "tt0121766", // Star Wars: Episode III - Revenge of the Sith (2005)
            "tt0416449", // 300 (2006)
            "tt0246578", // Donnie Darko (2001)
            "tt0317705", // The Incredibles (2004)
            "tt1010048", // Slumdog Millionaire (2008)
            "tt3501632", // Thor: Ragnarok (2017)
            "tt0892769", // How to Train Your Dragon (2010)
            "tt1454468", // Gravity (2013)
            "tt0060196", // The Good, the Bad and the Ugly (1966)
            "tt1211837", // Doctor Strange (2016)
            "tt0083658", // Blade Runner (1982)
            "tt8946378", // Knives Out (2019)
            "tt0480249", // I Am Legend (2007)
            "tt2084970", // The Imitation Game (2014)
            "tt0317248", // City of God (2002)
            "tt0378194", // Kill Bill: Vol. 2 (2004)
            "tt0770828", // Man of Steel (2013)
            "tt1205489", // Gran Torino (2008)
            "tt0093058", // Full Metal Jacket (1987)
            "tt0144084", // American Psycho (2000)
            "tt0090605", // Aliens (1986)
            "tt0211915", // Amélie (2001)
            "tt3896198", // Guardians of the Galaxy: Vol. 2 (2017)
            "tt2250912", // Spider-Man: Homecoming (2017)
            "tt0121765", // Star Wars: Episode II - Attack of the Clones (2002)
            "tt0401792", // Sin City (2005)
            "tt0118799", // Life Is Beautiful (1997)
            "tt0113277", // Heat (1995)
            "tt1631867", // Edge of Tomorrow (2014)
            "tt0316654", // Spider-Man 2 (2004)
            "tt2975590", // Batman v Superman: Dawn of Justice (2016)
            "tt1877832", // X-Men: Days of Future Past (2014)
            "tt2024544", // 12 Years a Slave (2013)
            "tt0478970", // Ant-Man (2015)
            "tt0054215", // Psycho (1960)
            "tt0062622", // 2001: A Space Odyssey (1968)
            "tt1981115", // Thor: The Dark World (2013)
            "tt0948470", // The Amazing Spider-Man (2012)
            "tt8579674", // 1917 (2019)
            "tt2802144", // Kingsman: The Secret Service (2014)
            "tt1951264", // The Hunger Games: Catching Fire (2013)
            "tt1074638", // Skyfall (2012)
            "tt1670345", // Now You See Me (2013)
            "tt1045658", // Silver Linings Playbook (2012)
            "tt0078788", // Apocalypse Now (1979)
            "tt3783958", // La La Land (2016)
            "tt0117951", // Trainspotting (1996)
            "tt0780504", // Drive (2011)
            "tt0405159", // Million Dollar Baby (2004)
            "tt1270798", // X-Men: First Class (2011)
            "tt1386697", // Suicide Squad (2016)
            "tt3748528", // Rogue One: A Star Wars Story (2016)
            "tt1170358", // The Hobbit: The Desolation of Smaug (2013)
            "tt1136608", // District 9 (2009)
            "tt5463162", // Deadpool 2 (2018)
            "tt0099785", // Home Alone (1990)
            "tt0421715", // The Curious Case of Benjamin Button (2008)
            "tt0381061", // Casino Royale (2006)
            "tt0457430", // Pan's Labyrinth (2006)
            "tt0451279", // Wonder Woman (2017)
            "tt0107048", // Groundhog Day (1993)
            "tt1504320", // The King's Speech (2010)
            "tt1798709", // Her (2013)
            "tt0364569", // Oldboy (2003)
            "tt3460252", // The Hateful Eight (2015)
            "tt2527336", // Star Wars: Episode VIII - The Last Jedi (2017)
            "tt0418279", // Transformers (2007)
            "tt0413300", // Spider-Man 3 (2007)
            "tt1637725", // Ted (2012)
            "tt0988045", // Sherlock Holmes (2009)
            "tt0373889", // Harry Potter and the Order of the Phoenix (2007)
            "tt1446714", // Prometheus (2012)
            "tt0454876", // Life of Pi (2012)
            "tt0120903", // X-Men (2000)
            "tt2562232", // Birdman or (The Unexpected Virtue of Ignorance) (2014)
            "tt6966692", // Green Book (2018)
            "tt0332280", // The Notebook (2004)
            "tt0075148", // Rocky (1976)
            "tt0758758", // Into the Wild (2007)
            "tt0162222", // Cast Away (2000)
            "tt2119532", // Hacksaw Ridge (2016)
            "tt3890160", // Baby Driver (2017)
            "tt0440963", // The Bourne Ultimatum (2007)
            "tt0114746", // 12 Monkeys (1995)
            "tt0240772", // Ocean's Eleven (2001)
            "tt2872718", // Nightcrawler (2014)
            "tt11286314", // Don't Look Up (2021)
            "tt0936501", // Taken (2008)
            "tt0234215", // The Matrix Reloaded (2003)
            "tt0926084", // Harry Potter and the Deathly Hallows: Part 1 (2010)
            "tt1156398", // Zombieland (2009)
            "tt6320628", // Spider-Man: Far from Home (2019)
            "tt1024648", // Argo (2012)
            "tt4154664", // Captain Marvel (2019)
            "tt0119654", // Men in Black (1997)
            "tt0417741", // Harry Potter and the Half-Blood Prince (2009)
            "tt0097165", // Dead Poets Society (1989)
            "tt0119488", // L.A. Confidential (1997)
            "tt0034583", // Casablanca (1942)
            "tt1232829", // 21 Jump Street (2012)
            "tt0116629", // Independence Day (1996)
            "tt1219289", // Limitless (2011)
            "tt1727824", // Bohemian Rhapsody (2018)
            "tt0120735", // Lock, Stock and Two Smoking Barrels (1998)
            "tt1343092", // The Great Gatsby (2013)
            "tt2948356", // Zootopia (2016)
            "tt0332452", // Troy (2004)
            "tt0470752", // Ex Machina (2014)
            "tt0365748", // Shaun of the Dead (2004)
            "tt0796366", // Star Trek (2009)
            "tt1276104", // Looper (2012)
            "tt1457767", // The Conjuring (2013)
            "tt0450259", // Blood Diamond (2006)
            "tt0454921", // The Pursuit of Happyness (2006)
            "tt4972582", // Split (2016)
            "tt0096874", // Back to the Future Part II (1989)
            "tt1570728", // Crazy, Stupid, Love. (2011)
            "tt0112641", // Casino (1995)
            "tt0181689", // Minority Report (2002)
            "tt1022603", // 500 Days of Summer (2009)
            "tt2310332", // The Hobbit: The Battle of the Five Armies (2014)
            "tt1250777", // Kick-Ass (2010)
            "tt0343818", // I, Robot (2004)
            "tt0258463", // The Bourne Identity (2002)
            "tt0290334", // X2: X-Men United (2003)
            "tt2713180", // Fury (2014)
            "tt1270797", // Venom (2018)
            "tt0409459", // Watchmen (2009)
            "tt5027774", // Three Billboards Outside Ebbing, Missouri (2017)
            "tt1298650", // Pirates of the Caribbean: On Stranger Tides (2011)
            "tt1318514", // Rise of the Planet of the Apes (2011)
            "tt0071853", // Monty Python and the Holy Grail (1975)
            "tt1872181", // The Amazing Spider-Man 2 (2014)
            "tt1659337", // The Perks of Being a Wallflower (2012)
            "tt0356910", // Mr. & Mrs. Smith (2005)
            "tt6263850", // Deadpool & Wolverine (2024)
            "tt1483013", // Oblivion (2013)
            "tt0095953", // Rain Man (1988)
            "tt0945513", // Source Code (2011)
            "tt1950186", // Ford v Ferrari (2019)
            "tt1411697", // The Hangover Part II (2011)
            "tt2872732", // Lucy (2014)
            "tt0314331", // Love Actually (2003)
            "tt10811166", // The Kashmir Files (2022)
            "tt0242653", // The Matrix Revolutions (2003)
            "tt0376994", // X-Men: The Last Stand (2006)
            "tt4425200", // John Wick: Chapter 2 (2017)
            "tt0367594", // Charlie and the Chocolate Factory (2005)
            "tt0800080", // The Incredible Hulk (2008)
            "tt2179136", // American Sniper (2014)
            "tt0467406", // Juno (2007)
            "tt0458525", // X-Men Origins: Wolverine (2009)
            "tt0047396", // Rear Window (1954)
            "tt0425112", // Hot Fuzz (2007)
            "tt0268380", // Ice Age (2002)
            "tt1790864", // The Maze Runner (2014)
            "tt0458352", // The Devil Wears Prada (2006)
            "tt0206634", // Children of Men (2006)
            "tt0099487", // Edward Scissorhands (1990)
            "tt1229238", // Mission: Impossible - Ghost Protocol (2011)
            "tt1979320", // Rush (2013)
            "tt0449059", // Little Miss Sunshine (2006)
            "tt1663662", // Pacific Rim (2013)
            "tt2245084", // Big Hero 6 (2014)
            "tt0092099", // Top Gun (1986)
            "tt0289879", // The Butterfly Effect (2004)
            "tt1477834", // Aquaman (2018)
            "tt0038650", // It's a Wonderful Life (1946)
            "tt9419884", // Doctor Strange in the Multiverse of Madness (2022)
            "tt0289043", // 28 Days Later (2002)
            "tt0057012", // Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964)
            "tt0398286", // Tangled (2010)
            "tt1951265", // The Hunger Games: Mockingjay - Part 1 (2014)
            "tt0790636", // Dallas Buyers Club (2013)
            "tt0119116", // The Fifth Element (1997)
            "tt1677720", // Ready Player One (2018)
            "tt2527338", // Star Wars: Episode IX - The Rise of Skywalker (2019)
            "tt3397884", // Sicario (2015)
            "tt0317219", // Cars (2006)
            "tt12593682", // Bullet Train (2022)
            "tt3183660", // Fantastic Beasts and Where to Find Them (2016)
            "tt0448157", // Hancock (2008)
            "tt0362227", // The Terminal (2004)
            "tt1895587", // Spotlight (2015)
            "tt0335266", // Lost in Translation (2003)
            "tt0084787", // The Thing (1982)
            "tt1099212", // Twilight (2008)
            "tt1291584", // Warrior (2011)
            "tt1568346", // The Girl with the Dragon Tattoo (2011)
            "tt11564570", // Glass Onion (2022)
            "tt1454029", // The Help (2011)
            "tt12042730", // Project Hail Mary (2026)
            "tt0327056", // Mystic River (2003)
            "tt1723121", // We're the Millers (2013)
            "tt1430132", // The Wolverine (2013)
            "tt0099088", // Back to the Future Part III (1990)
            "tt0139654", // Training Day (2001)
            "tt0117060", // Mission: Impossible (1996)
            "tt1535109", // Captain Phillips (2013)
            "tt1840309", // Divergent (2014)
            "tt31193180", // Sinners (2025)
            "tt1800241", // American Hustle (2013)
            "tt0347149", // Howl's Moving Castle (2004)
            "tt0372183", // The Bourne Supremacy (2004)
            "tt0367882", // Indiana Jones and the Kingdom of the Crystal Skull (2008)
            "tt0319262", // The Day After Tomorrow (2004)
            "tt1210166", // Moneyball (2011)
            "tt0387564", // Saw (2004)
            "tt2103281", // Dawn of the Planet of the Apes (2014)
            "tt9764362", // The Menu (2022)
            "tt0407304", // War of the Worlds (2005)
            "tt1408101", // Star Trek Into Darkness (2013)
            "tt2283362", // Jumanji: Welcome to the Jungle (2017)
            "tt2980516", // The Theory of Everything (2014)
            "tt0217505", // Gangs of New York (2002)
            "tt0974015", // Justice League (2017)
            "tt0325710", // The Last Samurai (2003)
            "tt0101414", // Beauty and the Beast (1991)
            "tt0120616", // The Mummy (1999)
            "tt0093773", // Predator (1987)
            "tt5095030", // Ant-Man and the Wasp (2018)
            "tt0103639", // Aladdin (1992)
            "tt1515091", // Sherlock Holmes: A Game of Shadows (2011)
            "tt1772341", // Wreck-It Ralph (2012)
            "tt1355644", // Passengers (2016)
            "tt0070047", // The Exorcist (1973)
            "tt0830515", // Quantum of Solace (2008)
            "tt2379713", // Spectre (2015)
            "tt0446029", // Scott Pilgrim vs. the World (2010)
            "tt9376612", // Shang-Chi and the Legend of the Ten Rings (2021)
            "tt0887912", // The Hurt Locker (2008)
            "tt3385516", // X-Men: Apocalypse (2016)
            "tt0780536", // In Bruges (2008)
            "tt6264654", // Free Guy (2021)
            "tt0033467", // Citizen Kane (1941)
            "tt1259521", // The Cabin in the Woods (2011)
            "tt1535108", // Elysium (2013)
            "tt0092005", // Stand by Me (1986)
            "tt2382320", // No Time to Die (2021)
            "tt2584384", // Jojo Rabbit (2019)
            "tt0765429", // American Gangster (2007)
            "tt0377092", // Mean Girls (2004)
            "tt1499658", // Horrible Bosses (2011)
            "tt0093779", // The Princess Bride (1987)
            "tt0087332", // Ghostbusters (1984)
            "tt0119698", // Princess Mononoke (1997)
            "tt0382625", // The Da Vinci Code (2006)
            "tt1187043", // 3 Idiots (2009)
            "tt3480822", // Black Widow (2021)
            "tt1637688", // In Time (2011)
            "tt6146586", // John Wick: Chapter 3 - Parabellum (2019)
            "tt0351283", // Madagascar (2005)
            "tt1217209", // Brave (2012)
            "tt3170832", // Room (2015)
            "tt0120591", // Armageddon (1998)
            "tt0443453", // Borat (2006)
            "tt0119567", // The Lost World: Jurassic Park (1997)
            "tt5580390", // The Shape of Water (2017)
            "tt0319061", // Big Fish (2003)
            "tt12361974", // Zack Snyder's Justice League (2021)
            "tt0088847", // The Breakfast Club (1985)
            "tt0119174", // The Game (1997)
            "tt0091763", // Platoon (1986)
            "tt0110475", // The Mask (1994)
            "tt0315327", // Bruce Almighty (2003)
            "tt0360717", // King Kong (2005)
            "tt1605783", // Midnight in Paris (2011)
            "tt0369339", // Collateral (2004)
            "tt0086879", // Amadeus (1984)
            "tt0163651", // American Pie (1999)
            "tt0105695", // Unforgiven (1992)
            "tt0032138", // The Wizard of Oz (1939)
            "tt1014759", // Alice in Wonderland (2010)
            "tt0455944", // The Equalizer (2014)
            "tt0217869", // Unbreakable (2000)
            "tt33764258", // The Odyssey (2026)
            "tt0831387", // Godzilla (2014)
            "tt0232500", // The Fast and the Furious (2001)
            "tt6334354", // The Suicide Squad (2021)
            "tt8367814", // The Gentlemen (2019)
            "tt0375679", // Crash (2004)
            "tt0052357", // Vertigo (1958)
            "tt0363771", // The Chronicles of Narnia: The Lion, the Witch and the Wardrobe (2005)
            "tt0104431", // Home Alone 2: Lost in New York (1992)
            "tt17526714", // The Substance (2024)
            "tt0147800", // 10 Things I Hate About You (1999)
            "tt0099674", // The Godfather Part III (1990)
            "tt1399103", // Transformers: Dark of the Moon (2011)
            "tt0265086", // Black Hawk Down (2001)
            "tt1055369", // Transformers: Revenge of the Fallen (2009)
            "tt2948372", // Soul (2020)
            "tt0840361", // The Town (2010)
            "tt0117571", // Scream (1996)
            "tt1517451", // A Star Is Born (2018)
            "tt0118971", // The Devil's Advocate (1997)
            "tt2381249", // Mission: Impossible - Rogue Nation (2015)
            "tt3521164", // Moana (2016)
            "tt1282140", // Easy A (2010)
            "tt1060277", // Cloverfield (2008)
            "tt0109686", // Dumb and Dumber (1994)
            "tt0405094", // The Lives of Others (2006)
            "tt0361862", // The Machinist (2004)
            "tt2294449", // 22 Jump Street (2014)
            "tt2820852", // Furious 7 (2015)
            "tt1905041", // Fast & Furious 6 (2013)
            "tt30144839", // One Battle After Another (2025)
            "tt2194499", // About Time (2013)
            "tt0349903", // Ocean's Twelve (2004)
            "tt5950044", // Superman (2025)
            "tt0181852", // Terminator 3: Rise of the Machines (2003)
            "tt0096283", // My Neighbor Totoro (1988)
            "tt1596343", // Fast Five (2011)
            "tt0337978", // Live Free or Die Hard (2007)
            "tt0120663", // Eyes Wide Shut (1999)
            "tt9032400", // Eternals (2021)
            "tt0120912", // Men in Black II (2002)
            "tt0079470", // Monty Python's Life of Brian (1979)
            "tt0096895", // Batman (1989)
            "tt0166924", // Mulholland Drive (2001)
            "tt0112864", // Die Hard with a Vengeance (1995)
            "tt0230600", // The Others (2001)
            "tt0493464", // Wanted (2008)
            "tt0119094", // Face/Off (1997)
            "tt1453405", // Monsters University (2013)
            "tt0454848", // Inside Man (2006)
            "tt0317919", // Mission: Impossible III (2006)
            "tt1587310", // Maleficent (2014)
            "tt2582846", // The Fault in Our Stars (2014)
            "tt1542344", // 127 Hours (2010)
            "tt0111257", // Speed (1994)
            "tt2737304", // Bird Box (2018)
            "tt1190080", // 2012 (2009)
            "tt0328107", // Man on Fire (2004)
            "tt1706620", // Snowpiercer (2013)
            "tt4912910", // Mission: Impossible - Fallout (2018)
            "tt3799694", // The Nice Guys (2016)
            "tt1632708", // Friends with Benefits (2011)
            "tt0094721", // Beetlejuice (1988)
            "tt0388795", // Brokeback Mountain (2005)
            "tt1490017", // The Lego Movie (2014)
            "tt1951266", // The Hunger Games: Mockingjay - Part 2 (2015)
            "tt0343660", // 50 First Dates (2004)
            "tt0091042", // Ferris Bueller's Day Off (1986)
            "tt0113497", // Jumanji (1995)
            "tt10366206", // John Wick: Chapter 4 (2023)
            "tt0286106", // Signs (2002)
            "tt0448115", // Shazam! (2019)
            "tt0120755", // Mission: Impossible II (2000)
            "tt2106476", // The Hunt (2012)
            "tt0477347", // Night at the Museum (2006)
            "tt0162661", // Sleepy Hollow (1999)
            "tt1409024", // Men in Black 3 (2012)
            "tt0107688", // The Nightmare Before Christmas (1993)
            "tt3778644", // Solo: A Star Wars Story (2018)
            "tt0081398", // Raging Bull (1980)
            "tt0360486", // Constantine (2005)
            "tt0338751", // The Aviator (2004)
            "tt0087843", // Once Upon a Time in America (1984)
            "tt0100405", // Pretty Woman (1990)
            "tt0964517", // The Fighter (2010)
            "tt0317740", // The Italian Job (2003)
            "tt0099423", // Die Hard 2 (1990)
            "tt0408236", // Sweeney Todd: The Demon Barber of Fleet Street (2007)
            "tt1068680", // Yes Man (2008)
            "tt0119396", // Jackie Brown (1997)
            "tt1646971", // How to Train Your Dragon 2 (2014)
            "tt0443543", // The Illusionist (2006)
            "tt0298130", // The Ring (2002)
            "tt4649466", // Kingsman: The Golden Circle (2017)
            "tt0047478", // Seven Samurai (1954)
            "tt5311514", // Your Name. (2016)
            "tt7888964", // Nobody (2021)
            "tt0363163", // Downfall (2004)
            "tt1041829", // The Proposal (2009)
            "tt2140479", // The Accountant (2016)
            "tt0396269", // Wedding Crashers (2005)
            "tt1907668", // Flight (2012)
            "tt6857112", // Us (2019)
            "tt2798920", // Annihilation (2018)
            "tt1182345", // Moon (2009)
            "tt6208148", // Snow White (2025)
            "tt26581740", // Weapons (2025)
            "tt0095327", // Grave of the Fireflies (1988)
            "tt0438488", // Terminator Salvation (2009)
            "tt0790724", // Jack Reacher (2012)
            "tt0395169", // Hotel Rwanda (2004)
            "tt0389860", // Click (2006)
            "tt0878804", // The Blind Side (2009)
            "tt1790809", // Pirates of the Caribbean: Dead Men Tell No Tales (2017)
            "tt0496806", // Ocean's Thirteen (2007)
            "tt16311594", // F1: The Movie (2025)
            "tt0125439", // Notting Hill (1999)
            "tt1104001", // Tron: Legacy (2010)
            "tt0077416", // The Deer Hunter (1978)
            "tt1179933", // 10 Cloverfield Lane (2016)
            "tt1371111", // Cloud Atlas (2012)
            "tt0064116", // Once Upon a Time in the West (1968)
            "tt4881806", // Jurassic World: Fallen Kingdom (2018)
            "tt1748122", // Moonrise Kingdom (2012)
            "tt0100802", // Total Recall (1990)
            "tt0433035", // Real Steel (2011)
            "tt0117500", // The Rock (1996)
            "tt1065073", // Boyhood (2014)
            "tt0112471", // Before Sunrise (1995)
            "tt1650062", // Super 8 (2011)
            "tt1320253", // The Expendables (2010)
            "tt0414387", // Pride & Prejudice (2005)
            "tt0212338", // Meet the Parents (2000)
            "tt0368891", // National Treasure (2004)
            "tt0110148", // Interview with the Vampire: The Vampire Chronicles (1994)
            "tt0887883", // Burn After Reading (2008)
            "tt0884328", // The Mist (2007)
            "tt0071315", // Chinatown (1974)
            "tt2788710", // The Interview (2014)
            "tt1403865", // True Grit (2010)
            "tt0822854", // Shooter (2007)
            "tt0120667", // Fantastic Four (2005)
            "tt3731562", // Kong: Skull Island (2017)
            "tt3606756", // Incredibles 2 (2018)
            "tt0359950", // The Secret Life of Walter Mitty (2013)
            "tt0105323", // Scent of a Woman (1992)
            "tt0163025", // Jurassic Park III (2001)
            "tt0910936", // Pineapple Express (2008)
            "tt7653254", // Marriage Story (2019)
            "tt1231583", // Due Date (2010)
            "tt0116367", // From Dusk Till Dawn (1996)
            "tt0167190", // Hellboy (2004)
            "tt1591095", // Insidious (2010)
            "tt0213149", // Pearl Harbor (2001)
            "tt1645170", // The Dictator (2012)
            "tt0053125", // North by Northwest (1959)
            "tt0120601", // Being John Malkovich (1999)
            "tt0209163", // The Mummy Returns (2001)
            "tt0457939", // The Holiday (2006)
            "tt1951261", // The Hangover Part III (2013)
            "tt0463854", // 28 Weeks Later (2007)
            "tt0119528", // Liar Liar (1997)
            "tt3110958", // Now You See Me 2 (2016)
            "tt0462538", // The Simpsons Movie (2007)
            "tt0238380", // Equilibrium (2002)
            "tt1707386", // Les Misérables (2012)
            "tt5726616", // Call Me by Your Name (2017)
            "tt0472043", // Apocalypto (2006)
            "tt1037705", // The Book of Eli (2010)
            "tt4034228", // Manchester by the Sea (2016)
            "tt1193138", // Up in the Air (2009)
            "tt2771200", // Beauty and the Beast (2017)
            "tt0399295", // Lord of War (2005)
            "tt7349950", // It: Chapter Two (2019)
            "tt0332379", // School of Rock (2003)
            "tt0320661", // Kingdom of Heaven (2005)
        };

        // The "Surprise Me" carousel pool — films flagged surprise_me = true
        // by the seed below, which MoviesController.NowPlaying then shuffles
        // weekly and takes 10 from.
        //
        // Curated separately from SeedImdbIds on purpose: that list optimises
        // for shared cast/director density so puzzles can be generated, this
        // one for "what would someone actually want to watch tonight". Every
        // id here must also appear above, or it has no catalog row to flag —
        // SeedAsync logs a warning if that invariant breaks.
        private static readonly HashSet<string> SurpriseMeImdbIds = new(StringComparer.OrdinalIgnoreCase)
        {
            "tt1160419",  // Dune (2021)
            "tt15398776", // Oppenheimer
            "tt1517268",  // Barbie
            "tt1877830",  // The Batman
            "tt1745960",  // Top Gun: Maverick
            "tt10872600", // Spider-Man: No Way Home
            "tt4154796",  // Avengers: Endgame
            "tt0468569",  // The Dark Knight
            "tt1375666",  // Inception
            "tt0816692",  // Interstellar
            "tt6791350",  // Guardians of the Galaxy Vol. 3
            "tt9362722",  // Spider-Man: Across the Spider-Verse
            "tt0111161",  // The Shawshank Redemption
            "tt0110912",  // Pulp Fiction
            "tt0137523",  // Fight Club
            "tt0109830",  // Forrest Gump
            "tt0133093",  // The Matrix
            "tt0245429",  // Spirited Away
            "tt0993846",  // The Wolf of Wall Street
            "tt2911666",  // John Wick
            "tt1345836",  // The Dark Knight Rises
            "tt0816711",  // World War Z
            "tt1596363",  // The Girl with the Dragon Tattoo
            "tt0499549",  // Avatar
            "tt1630029",  // Avatar: The Way of Water
            "tt6710474",  // Everything Everywhere All at Once
            "tt15239678", // Dune: Part Two
            "tt10648342", // Thor: Love and Thunder
            "tt9114286",  // Black Panther: Wakanda Forever
            "tt5433140",  // Fast & Furious Presents: Hobbs & Shaw
        };

        // TV track for the mystery challenge — since 2026-09-03 the mystery
        // slot draws from BOTH catalogs (~1 day in 3 is a show, with the
        // full difficulty ladder), so this pool needs enough depth that TV
        // days don't cycle the same handful of answers. Still shorter than
        // the movie catalog, which also feeds Connection/Chronos/CastDeduct.
        private static readonly string[] SeedTvImdbIds =
        {
            "tt0903747", // Breaking Bad
            "tt0944947", // Game of Thrones
            "tt4574334", // Stranger Things
            "tt0386676", // The Office (US)
            "tt0108778", // Friends
            "tt2861424", // Rick and Morty
            "tt1520211", // The Walking Dead
            "tt0475784", // Westworld
            "tt2356777", // True Detective
            "tt1475582", // Sherlock
            "tt0141842", // The Sopranos
            "tt0455275", // Prison Break
            "tt1190634", // The Boys
            "tt0413573", // Grey's Anatomy
            "tt0898266", // The Big Bang Theory
            "tt3107288", // The Crown
            "tt6468322", // Money Heist
            "tt2306299", // Vikings
            "tt1839578", // Peaky Blinders
            "tt0417299", // Avatar: The Last Airbender
            "tt0121955", // South Park
            "tt2707408", // Narcos
            "tt1533395", // Modern Family
            "tt0412142", // House
            "tt1442437", // Curb Your Enthusiasm
            "tt7366338", // Chernobyl
            "tt9140554", // Cobra Kai
            "tt5788792", // The Marvelous Mrs. Maisel
            "tt7908628", // Bridgerton
            "tt0121220", // Sex and the City
            "tt0306414", // The Wire
            "tt0411008", // Lost
            "tt3032476", // Better Call Saul
            "tt7660850", // Succession
            "tt10986410", // Ted Lasso
            "tt8111088", // The Mandalorian
            "tt3581920", // The Last of Us
            "tt11198330", // House of the Dragon
            "tt10919420", // Squid Game
            "tt13443470", // Wednesday
            "tt0773262", // Dexter
            "tt0804503", // Mad Men
            "tt2085059", // Black Mirror
            "tt0096697", // The Simpsons
            "tt0182576", // Family Guy
            "tt0098904", // Seinfeld
            "tt0460649", // How I Met Your Mother
            "tt2467372", // Brooklyn Nine-Nine
            "tt1266020", // Parks and Recreation
            "tt0367279", // Arrested Development
            "tt1312171", // The Umbrella Academy
            "tt5180504", // The Witcher
            "tt5071412", // Ozark
            "tt5290382", // Mindhunter
            "tt2802850", // Fargo
            "tt0098936", // Twin Peaks
            "tt0106179", // The X-Files
            "tt0285331", // 24
            "tt1796960", // Homeland
            "tt1606375", // Downton Abbey
            "tt11280740", // Severance
            "tt14452776", // The Bear
            "tt8772296", // Euphoria
            "tt0472954", // It's Always Sunny in Philadelphia
            "tt1439629", // Community
            "tt0844441", // True Blood
            "tt1632701", // Suits
            "tt1124373", // Sons of Anarchy
            "tt5753856", // Dark
            "tt5834204", // The Handmaid's Tale
            "tt0238784", // Gilmore Girls
            "tt0098800", // The Fresh Prince of Bel-Air

            // ── Popularity expansion (TV) — generated 2026-09-04 from the official
            // IMDb datasets (title.basics + title.ratings), ranked by vote
            // count (>=80k votes, adult excluded) so every entry is a real id
            // AND a title people actually recognize. Regenerate the same way
            // rather than hand-adding ids.
            "tt2442560", // Peaky Blinders (2013)
            "tt2560140", // Attack on Titan (2013)
            "tt10048342", // The Queen's Gambit (2020)
            "tt0185906", // Band of Brothers (2001)
            "tt1856010", // House of Cards (2013)
            "tt0460681", // Supernatural (2005)
            "tt3322312", // Daredevil (2015)
            "tt0877057", // Death Note (2006)
            "tt4158110", // Mr. Robot (2015)
            "tt2193021", // Arrow (2012)
            "tt11126994", // Arcane (2021)
            "tt7631058", // The Lord of the Rings: The Rings of Power (2022)
            "tt9140560", // WandaVision (2021)
            "tt7767422", // Sex Education (2019)
            "tt12637874", // Fallout (2024)
            "tt4052886", // Lucifer (2016)
            "tt1405406", // The Vampire Diaries (2009)
            "tt7335184", // You (2018)
            "tt0388629", // One Piece (1999)
            "tt1844624", // American Horror Story (2011)
            "tt6741278", // Invincible (2021)
            "tt1837492", // 13 Reasons Why (2017)
            "tt2372162", // Orange Is the New Black (2013)
            "tt1586680", // Shameless (2011)
            "tt6763664", // The Haunting of Hill House (2018)
            "tt13406094", // The White Lotus (2021)
            "tt4236770", // Yellowstone (2018)
            "tt14392248", // Aspirants (2021)
            "tt10234724", // Moon Knight (2022)
            "tt31806037", // Adolescence (2025)
            "tt5675620", // The Punisher (2017)
            "tt2243973", // Hannibal (2013)
            "tt9288030", // Reacher (2022)
            "tt2661044", // The 100 (2014)
            "tt0303461", // Firefly (2002)
            "tt2741602", // The Blacklist (2013)
            "tt0369179", // Two and a Half Men (2003)
            "tt1442449", // Spartacus (2010)
            "tt0285403", // Scrubs (2001)
            "tt9208876", // The Falcon and the Winter Soldier (2021)
            "tt9253284", // Andor (2022)
            "tt4786824", // The Crown (2016)
            "tt27497448", // A Knight of the Seven Kingdoms (2026)
            "tt0149460", // Futurama (1999)
            "tt1119644", // Fringe (2008)
            "tt8466564", // Obi-Wan Kenobi (2022)
            "tt1826940", // New Girl (2011)
            "tt0813715", // Heroes (2006)
            "tt0436992", // Doctor Who (2005)
            "tt1355642", // Fullmetal Alchemist: Brotherhood (2009)
            "tt3749900", // Gotham (2014)
            "tt5687612", // Fleabag (2016)
            "tt2788316", // Shōgun (2024)
            "tt1843230", // Once Upon a Time (2011)
            "tt6257970", // The End of the F***ing World (2017)
            "tt10160804", // Hawkeye (2021)
            "tt15435876", // The Penguin (2024)
            "tt3920596", // Big Little Lies (2017)
            "tt1196946", // The Mentalist (2008)
            "tt7221388", // Cobra Kai (2018)
            "tt0452046", // Criminal Minds (2005)
            "tt2357547", // Jessica Jones (2015)
            "tt3398228", // BoJack Horseman (2014)
            "tt2364582", // Agents of S.H.I.E.L.D. (2013)
            "tt0795176", // Planet Earth (2006)
            "tt9335498", // Demon Slayer: Kimetsu no Yaiba (2019)
            "tt14688458", // Silo (2023)
            "tt8740790", // Bridgerton (2020)
            "tt9561862", // Love, Death & Robots (2019)
            "tt0988824", // Naruto: Shippuden (2007)
            "tt4508902", // One Punch Man (2015)
            "tt10155688", // Mare of Easttown (2021)
            "tt13207736", // Monster (2022)
            "tt4955642", // The Good Place (2016)
            "tt12343534", // Jujutsu Kaisen (2020)
            "tt0979432", // Boardwalk Empire (2010)
            "tt0397442", // Gossip Girl (2007)
            "tt13668894", // The Book of Boba Fett (2021)
            "tt10857160", // She Hulk: Attorney at Law (2022)
            "tt1751634", // The Sandman (2022)
            "tt11737520", // One Piece (2023)
            "tt0384766", // Rome (2005)
            "tt11691774", // Only Murders in the Building (2021)
            "tt9813792", // From (2022)
            "tt3006802", // Outlander (2014)
            "tt2261227", // Altered Carbon (2018)
            "tt2098220", // Hunter X Hunter (2011)
            "tt0165598", // That '70s Show (1998)
            "tt2401256", // The Night Of (2016)
            "tt13146488", // Peacemaker (2022)
            "tt5057054", // Jack Ryan (2018)
            "tt13649112", // Baby Reindeer (2024)
            "tt0904208", // Californication (2007)
            "tt3230854", // The Expanse (2015)
            "tt0460627", // Bones (2005)
            "tt4179452", // The Last Kingdom (2015)
            "tt1578873", // Pretty Little Liars (2010)
            "tt1219024", // Castle (2009)
            "tt0407362", // Battlestar Galactica (2004)
            "tt0387199", // Entourage (2004)
            "tt13016388", // 3 Body Problem (2024)
            "tt1865718", // Gravity Falls (2012)
            "tt2575988", // Silicon Valley (2014)
            "tt8420184", // The Last Dance (2020)
            "tt13210838", // The Gentlemen (2024)
            "tt1567432", // Teen Wolf (2011)
            "tt0214341", // Dragon Ball Z (1996)
            "tt3205802", // How to Get Away with Murder (2014)
            "tt14403178", // Beef (2023)
            "tt0364845", // NCIS (2003)
            "tt0487831", // The IT Crowd (2006)
            "tt1486217", // Archer (2009)
            "tt3526078", // Schitt's Creek (2015)
            "tt5491994", // Planet Earth II (2016)
            "tt0118276", // Buffy the Vampire Slayer (1997)
            "tt5555260", // This Is Us (2016)
            "tt12392504", // Scam 1992: The Harshad Mehta Story (2020)
            "tt0409591", // Naruto (2002)
            "tt10574558", // Midnight Mass (2021)
            "tt0213338", // Cowboy Bebop (1998)
            "tt7493974", // Bodyguard (2018)
            "tt2431438", // Sense8 (2015)
            "tt22202452", // Pluribus (2025)
            "tt7657124", // The Heroes (2008)
            "tt8398600", // After Life (2019)
            "tt13991232", // 1883 (2021)
            "tt0248654", // Six Feet Under (2001)
            "tt0264235", // Curb Your Enthusiasm (2000)
            "tt31938062", // The Pitt (2025)
            "tt5420376", // Riverdale (2017)
            "tt7462410", // The Wheel of Time (2021)
            "tt0193676", // Freaks and Geeks (1999)
            "tt1474684", // Luther (2010)
            "tt3647998", // Taboo (2017)
            "tt13918776", // The Night Agent (2023)
            "tt10168312", // What If...? (2021)
            "tt0212671", // Malcolm in the Middle (2000)
            "tt2632424", // The Originals (2013)
            "tt1327801", // Glee (2009)
            "tt0159206", // Sex and the City (1998)
            "tt2531336", // Lupin (2021)
            "tt7137906", // When They See Us (2019)
            "tt14164730", // Dexter: New Blood (2021)
            "tt0279600", // Smallville (2001)
            "tt13159924", // Gen V (2023)
            "tt0410975", // Desperate Housewives (2004)
            "tt7016936", // Killing Eve (2018)
            "tt3743822", // Fear the Walking Dead (2015)
            "tt0099864", // IT (1990)
            "tt1358522", // White Collar (2009)
            "tt33043892", // Dexter: Resurrection (2025)
            "tt0934814", // Chuck (2007)
            "tt5875444", // Slow Horses (2022)
            "tt1695360", // The Legend of Korra (2012)
            "tt6048596", // The Sinner (2017)
            "tt0096657", // Mr. Bean (1990)
            "tt6226232", // Young Sheldon (2017)
            "tt7203552", // The Morning Show (2019)
            "tt10795658", // Alice in Borderland (2020)
            "tt0092455", // Star Trek: The Next Generation (1987)
            "tt3322310", // Iron Fist (2017)
            "tt2017109", // Banshee (2013)
            "tt3322314", // Luke Cage (2016)
            "tt10233448", // Vinland Saga (2019)
            "tt0458290", // Star Wars: The Clone Wars (2008)
            "tt7049682", // Watchmen (2019)
            "tt4301160", // Black Bird (2022)
            "tt0203259", // Law & Order: Special Victims Unit (1999)
            "tt5171438", // Star Trek: Discovery (2017)
            "tt10970552", // The Haunting of Bly Manor (2020)
            "tt12262202", // The Acolyte (2024)
            "tt0397306", // American Dad! (2005)
            "tt5348176", // Barry (2018)
            "tt0374463", // The Pacific (2010)
            "tt13622776", // Ahsoka (2023)
            "tt8962124", // Emily in Paris (2020)
            "tt2249364", // Broadchurch (2013)
            "tt26693803", // King the Land (2023)
            "tt1399664", // The Night Manager (2016)
            "tt1830617", // Grimm (2011)
            "tt2649356", // Sharp Objects (2018)
            "tt2395695", // Cosmos: A Spacetime Odyssey (2014)
            "tt2628232", // Penny Dreadful (2014)
            "tt0496424", // 30 Rock (2006)
            "tt0103359", // Batman: The Animated Series (1992)
            "tt7909970", // Unbelievable (2019)
            "tt1628033", // Top Gear (2002)
            "tt15567174", // The Fall of the House of Usher (2023)
            "tt24053860", // The Day of the Jackal (2024)
            "tt1870479", // The Newsroom (2012)
            "tt1305826", // Adventure Time (2010)
            "tt1235099", // Lie to Me (2009)
            "tt4016454", // Supergirl (2015)
            "tt1637727", // The Killing (2011)
            "tt7587890", // The Rookie (2018)
            "tt12590266", // Cyberpunk: Edgerunners (2022)
            "tt2699128", // The Leftovers (2014)
            "tt0290978", // The Office (2001)
            "tt10857164", // Ms. Marvel (2022)
            "tt2294189", // The Fall (2013)
            "tt1489428", // Justified (2010)
            "tt6470478", // The Good Doctor (2017)
            "tt15677150", // Shrinking (2023)
            "tt1837642", // Revenge (2011)
            "tt0348914", // Deadwood (2004)
            "tt11743610", // The Terminal List (2022)
            "tt4230076", // The Defenders (2017)
            "tt4635282", // The OA (2016)
            "tt0804484", // Foundation (2021)
            "tt0206512", // SpongeBob SquarePants (1999)
            "tt2191671", // Elementary (2012)
            "tt1869454", // Good Omens (2019)
            "tt2375692", // Black Sails (2014)
            "tt2188671", // Bates Motel (2013)
            "tt14650074", // Dhindora (2021)
            "tt5626028", // My Hero Academia (2016)
            "tt1740299", // The Man in the High Castle (2015)
            "tt2149175", // The Americans (2013)
            "tt2403776", // Shadow and Bone (2021)
            "tt2234222", // Orphan Black (2013)
            "tt2879552", // 11.22.63 (2016)
            "tt9319668", // 1899 (2022)
            "tt0439100", // Weeds (2005)
            "tt11337908", // Maid (2021)
            "tt31510819", // MobLand (2025)
            "tt0491738", // Psych (2006)
            "tt1043813", // Titans (2018)
            "tt21209876", // Solo Leveling (2024)
            "tt16358384", // Tulsa King (2022)
            "tt7569592", // Chilling Adventures of Sabrina (2018)
            "tt1553656", // Under the Dome (2013)
            "tt12004706", // Panchayat (2020)
            "tt8550800", // The Outsider (2020)
            "tt8134470", // The Undoing (2020)
            "tt4270492", // Billions (2016)
            "tt0092400", // Married... with Children (1987)
            "tt27995114", // Dept. Q (2025)
            "tt9059760", // Normal People (2020)
            "tt19244304", // It: Welcome to Derry (2025)
            "tt0118421", // Oz (1997)
            "tt7520794", // Russian Doll (2019)
            "tt0460091", // My Name Is Earl (2005)
            "tt14954666", // The Idol (2023)
            "tt11041332", // Yellowjackets (2021)
            "tt5296406", // Designated Survivor (2016)
            "tt1845307", // 2 Broke Girls (2011)
            "tt18923754", // Daredevil: Born Again (2025)
            "tt4532368", // Legends of Tomorrow (2016)
            "tt14186672", // Landman (2024)
            "tt6315640", // Atypical (2017)
            "tt0112159", // Neon Genesis Evangelion (1995)
            "tt5232792", // Lost in Space (2018)
            "tt9544034", // The Family Man (2019)
            "tt35495073", // Heated Rivalry (2025)
            "tt1548850", // Misfits (2009)
            "tt10293938", // Outer Banks (2020)
            "tt7949218", // See (2019)
            "tt0072500", // Fawlty Towers (1975)
            "tt8064302", // Dead to Me (2019)
            "tt2934286", // Halo (2022)
            "tt13616990", // Chainsaw Man (2022)
            "tt14986406", // Bleach: Thousand-Year Blood War (2022)
            "tt10813940", // Ginny & Georgia (2021)
            "tt0118480", // Stargate SG-1 (1997)
            "tt5691552", // The Orville (2017)
            "tt0052520", // The Twilight Zone (1959)
            "tt3007572", // Locke & Key (2020)
            "tt13623632", // Alien: Earth (2025)
            "tt5189670", // Making a Murderer (2015)
            "tt0994314", // Code Geass: Lelouch of the Rebellion (2006)
            "tt13309742", // Blue Eye Samurai (2023)
            "tt8421350", // Manifest (2018)
            "tt18335752", // 1923 (2022)
            "tt3530232", // Last Week Tonight with John Oliver (2014)
            "tt0362359", // The O.C. (2003)
            "tt0112130", // Pride and Prejudice (1995)
            "tt5114356", // Legion (2017)
            "tt0106004", // Frasier (1993)
            "tt1831164", // Leyla and Mecnun (2011)
            "tt1561755", // Bob's Burgers (2011)
            "tt7134908", // Elite (2018)
            "tt2788432", // American Crime Story (2016)
            "tt0312172", // Monk (2002)
            "tt8714904", // Narcos: Mexico (2018)
            "tt8806524", // Star Trek: Picard (2020)
            "tt0060028", // Star Trek (1966)
            "tt1220617", // The Inbetweeners (2008)
            "tt0840196", // Skins (2007)
            "tt0200276", // The West Wing (1999)
            "tt13833978", // The Lincoln Lawyer (2022)
            "tt17491088", // The Diplomat (2023)
            "tt2249007", // Ray Donovan (2013)
            "tt4288182", // Atlanta (2016)
            "tt9815454", // Unorthodox (2020)
            "tt0158552", // Charmed (1998)
            "tt1462059", // Falling Skies (2011)
            "tt6524350", // Big Mouth (2017)
            "tt1898069", // American Gods (2017)
            "tt3502248", // Bosch (2014)
            "tt6077448", // Sacred Games (2018)
        };

        // Upserts every seed film. Idempotent and safe to re-run: existing
        // rows are refreshed rather than duplicated (ImdbId is unique).
        //
        // OMDb's free tier has a daily request cap, so this is a deliberate
        // one-shot admin action rather than something that runs per request.
        public async Task<(int Added, int Updated, int Failed)> SeedAsync(AppDbContext db)
        {
            // A carousel id with no seed entry would silently never appear —
            // the flag has nothing to attach to. Worth a warning rather than a
            // throw: it costs one carousel slot, not a working seed run.
            var orphaned = SurpriseMeImdbIds
                .Except(SeedImdbIds, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (orphaned.Count > 0)
            {
                _logger.LogWarning(
                    "SurpriseMeImdbIds contains {Count} id(s) missing from SeedImdbIds, so they can never be "
                    + "flagged or shown: {Ids}", orphaned.Count, string.Join(", ", orphaned));
            }

            var existing = await db.CineMindMovies.ToDictionaryAsync(m => m.ImdbId, StringComparer.OrdinalIgnoreCase);
            int added = 0, updated = 0, failed = 0;

            foreach (var imdbId in SeedImdbIds.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var entry = await _omdb.LookupCatalogEntryAsync(imdbId);
                if (entry == null || entry.ReleaseYear == 0)
                {
                    failed++;
                    continue;
                }

                var castJson = JsonSerializer.Serialize(entry.Cast);
                var genresJson = JsonSerializer.Serialize(entry.Genres);
                // Assigned rather than OR'd on the update path: the seed list
                // is the source of truth, so removing an id from
                // SurpriseMeImdbIds and re-seeding has to actually pull that
                // film off the carousel.
                var surpriseMe = SurpriseMeImdbIds.Contains(imdbId);

                if (existing.TryGetValue(imdbId, out var row))
                {
                    row.Title = entry.Title;
                    row.ReleaseYear = entry.ReleaseYear;
                    row.PosterPath = entry.PosterUrl ?? row.PosterPath;
                    row.Director = entry.Director ?? row.Director;
                    row.CastJson = castJson;
                    row.GenresJson = genresJson;
                    row.Plot = entry.Plot ?? row.Plot;
                    row.SurpriseMe = surpriseMe;
                    updated++;
                }
                else
                {
                    db.CineMindMovies.Add(new CineMindMovie
                    {
                        ImdbId = entry.ImdbId,
                        Title = entry.Title,
                        ReleaseYear = entry.ReleaseYear,
                        PosterPath = entry.PosterUrl,
                        Director = entry.Director,
                        CastJson = castJson,
                        GenresJson = genresJson,
                        Plot = entry.Plot,
                        SurpriseMe = surpriseMe,
                        CreatedAt = DateTime.UtcNow,
                    });
                    added++;
                }
            }

            await db.SaveChangesAsync();
            _logger.LogInformation(
                "CineMind catalog seed: {Added} added, {Updated} updated, {Failed} failed.",
                added, updated, failed);

            return (added, updated, failed);
        }

        // Same idempotent upsert-by-ImdbId pattern as SeedAsync, against the
        // separate TV table — see SeedTvImdbIds for why it's a much shorter
        // list, and CineMindTvShow for why there's no Director field to set.
        public async Task<(int Added, int Updated, int Failed)> SeedTvAsync(AppDbContext db)
        {
            var existing = await db.CineMindTvShows.ToDictionaryAsync(m => m.ImdbId, StringComparer.OrdinalIgnoreCase);
            int added = 0, updated = 0, failed = 0;

            foreach (var imdbId in SeedTvImdbIds.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var entry = await _omdb.LookupCatalogEntryAsync(imdbId, mediaType: "series");
                if (entry == null || entry.ReleaseYear == 0)
                {
                    failed++;
                    continue;
                }

                var castJson = JsonSerializer.Serialize(entry.Cast);
                var genresJson = JsonSerializer.Serialize(entry.Genres);

                if (existing.TryGetValue(imdbId, out var row))
                {
                    row.Title = entry.Title;
                    row.ReleaseYear = entry.ReleaseYear;
                    row.PosterPath = entry.PosterUrl ?? row.PosterPath;
                    row.CastJson = castJson;
                    row.GenresJson = genresJson;
                    row.Plot = entry.Plot ?? row.Plot;
                    updated++;
                }
                else
                {
                    db.CineMindTvShows.Add(new CineMindTvShow
                    {
                        ImdbId = entry.ImdbId,
                        Title = entry.Title,
                        ReleaseYear = entry.ReleaseYear,
                        PosterPath = entry.PosterUrl,
                        CastJson = castJson,
                        GenresJson = genresJson,
                        Plot = entry.Plot,
                        CreatedAt = DateTime.UtcNow,
                    });
                    added++;
                }
            }

            await db.SaveChangesAsync();
            _logger.LogInformation(
                "CineMind TV catalog seed: {Added} added, {Updated} updated, {Failed} failed.",
                added, updated, failed);

            return (added, updated, failed);
        }
    }
}
